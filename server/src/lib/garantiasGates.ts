// Avançar/mover etapa + histórico do módulo de Garantias — mesmo padrão de
// ordensGates.ts, mas sem gates obrigatórios por etapa nesta primeira
// versão (testar antes de travar o fluxo com pré-requisitos — pedido do
// João, 2026-10-02). Ao entrar em 'oficina', cria a linha em
// garantiaOficina (pré-preenchendo modelo/nº série/cliente a partir da
// própria garantia) se ainda não existir.

import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { garantias, garantiaHistorico, garantiaOficina, clientes } from '../db/schema.js'
import { registrarAuditoria } from './auditoria.js'
import { agoraSqlite } from './dataBr.js'
import { getStageSequence, getNextStage, STAGE_LABELS, type Stage } from './garantiasStages.js'

type GarantiaRow = typeof garantias.$inferSelect

async function inserirHistorico(params: {
  garantiaId: number
  userId: number
  action: string
  description: string
  stage: string | null
  fieldName?: string
  oldValue?: string
  newValue?: string
}) {
  const { garantiaId, userId, ...rest } = params
  await db.insert(garantiaHistorico).values({ garantiaId, userId, ...rest })
}

async function garantirOficina(garantia: GarantiaRow) {
  const existente = await db.query.garantiaOficina.findFirst({ where: eq(garantiaOficina.garantiaId, garantia.id) })
  if (existente) return
  const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, garantia.clienteId) })
  await db.insert(garantiaOficina).values({
    garantiaId: garantia.id,
    modelo: garantia.modeloMaquina,
    numeroSerie: garantia.numeroSerie,
    nomeCliente: cliente?.razaoSocial ?? null,
  })
}

export async function avancarEtapaGarantia(params: { garantiaId: number; empresaId: number; userId: number }): Promise<GarantiaRow> {
  const { garantiaId, empresaId, userId } = params
  const garantia = await db.query.garantias.findFirst({ where: and(eq(garantias.id, garantiaId), eq(garantias.empresaId, empresaId)) })
  if (!garantia) throw new TRPCError({ code: 'NOT_FOUND', message: 'Processo de garantia não encontrado' })
  if (garantia.status !== 'ativo') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Processo não está ativo' })

  const proximo = getNextStage(garantia.stage, garantia.comRetorno)
  if (!proximo) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Processo já está na última etapa' })

  const upd = await db
    .update(garantias)
    .set({ stage: proximo, versao: garantia.versao + 1, updatedAt: agoraSqlite() })
    .where(and(eq(garantias.id, garantiaId), eq(garantias.versao, garantia.versao)))
  if (upd.rowsAffected === 0) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Processo foi alterado por outra pessoa — recarregue a página' })
  }

  if (proximo === 'oficina') await garantirOficina(garantia)

  await inserirHistorico({
    garantiaId,
    userId,
    action: 'stage_change',
    fieldName: 'stage',
    oldValue: garantia.stage,
    newValue: proximo,
    description: `Avançou de "${STAGE_LABELS[garantia.stage as Stage] ?? garantia.stage}" para "${STAGE_LABELS[proximo]}"`,
    stage: proximo,
  })
  await registrarAuditoria({
    tabela: 'garantias',
    registroId: garantiaId,
    acao: 'mudar_etapa',
    campo: 'stage',
    valorAnterior: garantia.stage,
    valorNovo: proximo,
    alteradoPor: userId,
  })

  return { ...garantia, stage: proximo, versao: garantia.versao + 1 }
}

export async function moverEtapaGarantia(params: { garantiaId: number; empresaId: number; userId: number; novaEtapa: string }): Promise<GarantiaRow> {
  const { garantiaId, empresaId, userId, novaEtapa } = params
  const garantia = await db.query.garantias.findFirst({ where: and(eq(garantias.id, garantiaId), eq(garantias.empresaId, empresaId)) })
  if (!garantia) throw new TRPCError({ code: 'NOT_FOUND', message: 'Processo de garantia não encontrado' })
  if (garantia.status !== 'ativo') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Processo não está ativo' })

  const sequencia = getStageSequence(garantia.comRetorno)
  if (!sequencia.includes(novaEtapa as Stage)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Etapa inválida pra esse tipo de processo' })

  const upd = await db
    .update(garantias)
    .set({ stage: novaEtapa, versao: garantia.versao + 1, updatedAt: agoraSqlite() })
    .where(and(eq(garantias.id, garantiaId), eq(garantias.versao, garantia.versao)))
  if (upd.rowsAffected === 0) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Processo foi alterado por outra pessoa — recarregue a página' })
  }

  if (novaEtapa === 'oficina') await garantirOficina(garantia)

  await inserirHistorico({
    garantiaId,
    userId,
    action: 'stage_change',
    fieldName: 'stage',
    oldValue: garantia.stage,
    newValue: novaEtapa,
    description: `Etapa alterada manualmente de "${STAGE_LABELS[garantia.stage as Stage] ?? garantia.stage}" para "${STAGE_LABELS[novaEtapa as Stage] ?? novaEtapa}"`,
    stage: novaEtapa,
  })
  await registrarAuditoria({
    tabela: 'garantias',
    registroId: garantiaId,
    acao: 'mudar_etapa',
    campo: 'stage',
    valorAnterior: garantia.stage,
    valorNovo: novaEtapa,
    alteradoPor: userId,
  })

  return { ...garantia, stage: novaEtapa, versao: garantia.versao + 1 }
}

export async function registrarHistoricoGarantia(params: { garantiaId: number; userId: number; action: string; description: string; stage?: string | null }) {
  await inserirHistorico({ ...params, stage: params.stage ?? null })
}
