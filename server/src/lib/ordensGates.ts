// Regras (gates) que travam o avanço de etapa do módulo de Ordens, e o
// helper central que avança etapa gravando histórico + auditoria com trava
// otimista — portado do comportamento de app/services/order_service.py e
// app/services/stage_service.py do odincrm.duckdns.org. Centralizado aqui
// (diferente do resto do CRM, que insere histórico inline em cada router)
// porque são 10+ etapas com gate próprio cada uma — vale a pena não repetir.

import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  ordens,
  ordemHistorico,
  ordemLiberacaoFinanceira,
  ordemAnexos,
  ordemPreparacao,
  ordemAprovacaoFrete,
  ordemFreteFinalizado,
  ordemConferencia,
  ordemColeta,
  ordemFaturamento,
} from '../db/schema.js'
import { registrarAuditoria } from './auditoria.js'
import { agoraSqlite } from './dataBr.js'
import { getStageSequence, getNextStage, STAGE_LABELS, CONFIRMATION_RESET_ORDER, type Stage, type OrderType } from './ordensStages.js'

type OrdemRow = typeof ordens.$inferSelect

type GateResult = { ok: true } | { ok: false; motivo: string }

async function checkLiberacaoFinanceiraAprovada(ordem: OrdemRow): Promise<GateResult> {
  const lib = await db.query.ordemLiberacaoFinanceira.findFirst({ where: eq(ordemLiberacaoFinanceira.ordemId, ordem.id) })
  if (!lib?.aprovado) return { ok: false, motivo: 'Liberação financeira ainda não foi aprovada' }
  return { ok: true }
}

async function checkAnexoStagePedidoExiste(ordem: OrdemRow): Promise<GateResult> {
  const anexo = await db.query.ordemAnexos.findFirst({ where: and(eq(ordemAnexos.ordemId, ordem.id), eq(ordemAnexos.stage, 'pedido')) })
  if (!anexo) return { ok: false, motivo: 'Anexe o pedido oficial (etapa "Pedido") antes de avançar' }
  return { ok: true }
}

async function checkPreparacaoAprovada(ordem: OrdemRow): Promise<GateResult> {
  const prep = await db.query.ordemPreparacao.findFirst({ where: eq(ordemPreparacao.ordemId, ordem.id) })
  if (!prep?.aprovadoGestor) return { ok: false, motivo: 'Preparação ainda não foi aprovada pelo gestor' }
  return { ok: true }
}

async function checkFreteAprovadoEFinalizado(ordem: OrdemRow): Promise<GateResult> {
  const aprovacao = await db.query.ordemAprovacaoFrete.findFirst({ where: eq(ordemAprovacaoFrete.ordemId, ordem.id) })
  if (!aprovacao || !(aprovacao.cotacaoSelecionadaId || aprovacao.retiradaLocal || aprovacao.semFrete)) {
    return { ok: false, motivo: 'Escolha uma cotação, retirada local ou "sem frete" antes de avançar' }
  }
  const finalizado = await db.query.ordemFreteFinalizado.findFirst({ where: eq(ordemFreteFinalizado.ordemId, ordem.id) })
  if (!finalizado?.confirmado) return { ok: false, motivo: 'Frete ainda não foi confirmado como finalizado' }
  return { ok: true }
}

// Só existe etapa/gate de conferência pra pedido tipo "máquina" — "peça"
// não tem "conferencia" na sequência (vai direto de faturamento pra
// coleta), então esse gate precisa ser um no-op nesse caso.
async function checkConferenciaConfirmada(ordem: OrdemRow): Promise<GateResult> {
  if (ordem.orderType !== 'maquina') return { ok: true }
  const conf = await db.query.ordemConferencia.findFirst({ where: eq(ordemConferencia.ordemId, ordem.id) })
  if (!conf?.confirmado) return { ok: false, motivo: 'Conferência ainda não foi confirmada' }
  return { ok: true }
}

async function checkColetaConfirmada(ordem: OrdemRow): Promise<GateResult> {
  const coleta = await db.query.ordemColeta.findFirst({ where: eq(ordemColeta.ordemId, ordem.id) })
  if (!coleta?.confirmado) return { ok: false, motivo: 'Coleta ainda não foi confirmada' }
  return { ok: true }
}

const GATES: Partial<Record<Stage, (ordem: OrdemRow) => Promise<GateResult>>> = {
  pedido: checkLiberacaoFinanceiraAprovada,
  cotacao_frete: checkAnexoStagePedidoExiste,
  frete_finalizado: checkPreparacaoAprovada,
  faturamento: checkFreteAprovadoEFinalizado,
  coleta: checkConferenciaConfirmada,
  rastreio: checkColetaConfirmada,
}

async function inserirHistorico(params: {
  ordemId: number
  userId: number
  action: string
  description: string
  stage: string | null
  fieldName?: string
  oldValue?: string
  newValue?: string
}) {
  const { ordemId, userId, ...rest } = params
  await db.insert(ordemHistorico).values({ ordemId, userId, ...rest })
}

export async function avancarEtapaPedido(params: { ordemId: number; empresaId: number; userId: number }): Promise<OrdemRow> {
  const { ordemId, empresaId, userId } = params
  const ordem = await db.query.ordens.findFirst({ where: and(eq(ordens.id, ordemId), eq(ordens.empresaId, empresaId)) })
  if (!ordem) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pedido não encontrado' })
  if (ordem.status !== 'ativo') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pedido não está ativo' })

  const proximo = getNextStage(ordem.stage, ordem.orderType as OrderType)
  if (!proximo) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pedido já está na última etapa' })

  const gate = GATES[proximo]
  if (gate) {
    const resultado = await gate(ordem)
    if (!resultado.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: resultado.motivo })
  }

  const upd = await db
    .update(ordens)
    .set({ stage: proximo, versao: ordem.versao + 1, updatedAt: agoraSqlite() })
    .where(and(eq(ordens.id, ordemId), eq(ordens.versao, ordem.versao)))
  if (upd.rowsAffected === 0) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Pedido foi alterado por outra pessoa — recarregue a página' })
  }

  await inserirHistorico({
    ordemId,
    userId,
    action: 'stage_change',
    fieldName: 'stage',
    oldValue: ordem.stage,
    newValue: proximo,
    description: `Avançou de "${STAGE_LABELS[ordem.stage as Stage] ?? ordem.stage}" para "${STAGE_LABELS[proximo]}"`,
    stage: proximo,
  })
  await registrarAuditoria({
    tabela: 'ordens',
    registroId: ordemId,
    acao: 'mudar_etapa',
    campo: 'stage',
    valorAnterior: ordem.stage,
    valorNovo: proximo,
    alteradoPor: userId,
  })

  return { ...ordem, stage: proximo, versao: ordem.versao + 1 }
}

async function resetConfirmacoes(ordemId: number, novoIndex: number, sequencia: readonly Stage[]) {
  for (const stage of CONFIRMATION_RESET_ORDER) {
    const idxStage = sequencia.indexOf(stage)
    if (idxStage === -1 || idxStage <= novoIndex) continue
    if (stage === 'frete_finalizado') {
      await db.update(ordemFreteFinalizado).set({ confirmado: false, confirmadoPor: null, confirmadoEm: null }).where(eq(ordemFreteFinalizado.ordemId, ordemId))
    } else if (stage === 'faturamento') {
      await db.update(ordemFaturamento).set({ pagamentoConfirmado: false, confirmadoPor: null, confirmadoEm: null }).where(eq(ordemFaturamento.ordemId, ordemId))
    } else if (stage === 'conferencia') {
      await db.update(ordemConferencia).set({ confirmado: false, confirmadoPor: null, confirmadoEm: null }).where(eq(ordemConferencia.ordemId, ordemId))
    } else if (stage === 'coleta') {
      await db.update(ordemColeta).set({ confirmado: false, confirmadoPor: null, confirmadoEm: null }).where(eq(ordemColeta.ordemId, ordemId))
    }
  }
}

// Pulo livre de etapa — só gestor (checado no router, adminProcedure). Não
// passa pelos GATES (é o próprio gestor decidindo pular a regra), mas
// reseta confirmações das etapas que ficaram pra trás quando o pulo é pra
// trás, senão um pedido "confirmado" numa etapa que ele nem visitou de novo
// fica com o flag de confirmação errado.
export async function moverEtapaPedido(params: { ordemId: number; empresaId: number; userId: number; novaEtapa: string }): Promise<OrdemRow> {
  const { ordemId, empresaId, userId, novaEtapa } = params
  const ordem = await db.query.ordens.findFirst({ where: and(eq(ordens.id, ordemId), eq(ordens.empresaId, empresaId)) })
  if (!ordem) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pedido não encontrado' })
  if (ordem.status !== 'ativo') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pedido não está ativo' })

  const sequencia = getStageSequence(ordem.orderType as OrderType)
  const idxAtual = sequencia.indexOf(ordem.stage as Stage)
  const idxNovo = sequencia.indexOf(novaEtapa as Stage)
  if (idxNovo === -1) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Etapa inválida pra esse tipo de pedido' })

  const upd = await db
    .update(ordens)
    .set({ stage: novaEtapa, versao: ordem.versao + 1, updatedAt: agoraSqlite() })
    .where(and(eq(ordens.id, ordemId), eq(ordens.versao, ordem.versao)))
  if (upd.rowsAffected === 0) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Pedido foi alterado por outra pessoa — recarregue a página' })
  }

  if (idxNovo < idxAtual) await resetConfirmacoes(ordemId, idxNovo, sequencia)

  await inserirHistorico({
    ordemId,
    userId,
    action: 'stage_change',
    fieldName: 'stage',
    oldValue: ordem.stage,
    newValue: novaEtapa,
    description: `Etapa alterada manualmente de "${STAGE_LABELS[ordem.stage as Stage] ?? ordem.stage}" para "${STAGE_LABELS[novaEtapa as Stage] ?? novaEtapa}"`,
    stage: novaEtapa,
  })
  await registrarAuditoria({
    tabela: 'ordens',
    registroId: ordemId,
    acao: 'mudar_etapa',
    campo: 'stage',
    valorAnterior: ordem.stage,
    valorNovo: novaEtapa,
    alteradoPor: userId,
  })

  return { ...ordem, stage: novaEtapa, versao: ordem.versao + 1 }
}

export async function registrarHistoricoOrdem(params: {
  ordemId: number
  userId: number
  action: string
  description: string
  stage?: string | null
}) {
  await inserirHistorico({ ...params, stage: params.stage ?? null })
}
