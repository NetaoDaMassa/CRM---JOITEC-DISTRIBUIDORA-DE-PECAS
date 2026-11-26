// Créditos Odin + Pagamentos Odin (Financeiro) — pedido do João, 2026-11-26.
// Regras compartilhadas: etapas dos pagamentos, cálculo da comissão e a
// integração com Pedidos (o pedido com revenda + valor + comissão gera
// sozinho um registro em Pagamentos Odin).
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, ordemDetalhes, ordemMaquinas, ordens, revendaFinanceiroHistorico, revendaPagamentos, revendas } from '../db/schema.js'
import { agoraSqlite } from './dataBr.js'

export const SLUG_ODIN = 'odin-compressores'

export const ETAPAS_PAGAMENTO = [
  { value: 'comissao_registrada', label: 'Comissão registrada', labelGarantia: 'Pagamento registrado', soComissao: false },
  { value: 'aguardando_instalacao', label: 'Aguardando liberação da instalação', soComissao: true },
  { value: 'instalacao_liberada', label: 'Instalação liberada', soComissao: true },
  { value: 'nf_solicitada', label: 'NF de serviço solicitada', soComissao: false },
  { value: 'aguardando_nf', label: 'Aguardando recebimento da NF', soComissao: false },
  { value: 'nf_conferencia', label: 'NF recebida / em conferência', soComissao: false },
  { value: 'pagamento_agendado', label: 'Pagamento agendado', soComissao: false },
  { value: 'pagamento_realizado', label: 'Pagamento realizado', soComissao: false },
  { value: 'concluido', label: 'Concluído', soComissao: false },
] as const
export type EtapaPagamento = (typeof ETAPAS_PAGAMENTO)[number]['value']
export const ETAPAS_PAGAMENTO_VALORES = ETAPAS_PAGAMENTO.map((e) => e.value) as [EtapaPagamento, ...EtapaPagamento[]]
// Daqui pra frente o dinheiro já saiu — o pedido não mexe mais no valor.
export const ETAPAS_PAGAS: EtapaPagamento[] = ['pagamento_realizado', 'concluido']

export function etapasDoTipo(tipo: 'comissao' | 'garantia'): EtapaPagamento[] {
  return ETAPAS_PAGAMENTO.filter((e) => tipo === 'comissao' || !e.soComissao).map((e) => e.value)
}

export function rotuloEtapa(stage: string, tipo: 'comissao' | 'garantia' = 'comissao'): string {
  const e = ETAPAS_PAGAMENTO.find((x) => x.value === stage)
  if (!e) return stage
  return tipo === 'garantia' && 'labelGarantia' in e ? e.labelGarantia : e.label
}

export const ETAPAS_CREDITO = [
  { value: 'analise', label: 'Em análise' },
  { value: 'aprovacao', label: 'Aguardando aprovação' },
  { value: 'aprovado', label: 'Crédito liberado' },
  { value: 'recusado', label: 'Recusado' },
] as const

export function calcularComissao(valorPedido: number | null | undefined, modalidade: 'percentual' | 'fixo' | null | undefined, valor: number | null | undefined): number | null {
  if (!modalidade || valor == null || !(valor > 0)) return null
  if (modalidade === 'fixo') return Math.round(valor * 100) / 100
  if (valorPedido == null || !(valorPedido > 0)) return null
  return Math.round(valorPedido * valor) / 100
}

export function ehVendaDireta(revenda: string): boolean {
  return /^odin(\s+compressores)?$/i.test(revenda.trim())
}

export function formatarBrl(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function textoComissao(modalidade: 'percentual' | 'fixo', valor: number): string {
  return modalidade === 'percentual' ? `${String(valor).replace('.', ',')}%` : formatarBrl(valor)
}

export async function registrarHistoricoRevenda(p: { tipo: 'credito' | 'pagamento' | 'movimento'; refId: number; revendaId?: number | null; userId?: number | null; descricao: string; stage?: string | null }) {
  await db.insert(revendaFinanceiroHistorico).values({
    tipo: p.tipo,
    refId: p.refId,
    revendaId: p.revendaId ?? null,
    userId: p.userId ?? null,
    descricao: p.descricao,
    stage: p.stage ?? null,
  })
}

async function acharRevendaPorNome(empresaId: number, nome: string) {
  const r = await db
    .select({ id: revendas.id, nome: revendas.nome })
    .from(revendas)
    .where(and(eq(revendas.empresaId, empresaId), sql`lower(trim(${revendas.nome})) = ${nome.trim().toLowerCase()}`))
    .limit(1)
  return r[0] ?? null
}

// Chamado sempre que os dados do pedido são salvos (etapa Pedido). Cria,
// atualiza ou cancela o pagamento da comissão daquele pedido. Nunca mexe
// no valor depois que o pagamento foi feito — só registra o aviso.
export async function sincronizarPagamentoDoPedido(ordemId: number, userId: number | null) {
  const ordem = await db.query.ordens.findFirst({ where: eq(ordens.id, ordemId) })
  if (!ordem) return
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ordem.empresaId), columns: { slug: true } })
  if (empresa?.slug !== SLUG_ODIN) return
  const det = await db.query.ordemDetalhes.findFirst({ where: eq(ordemDetalhes.ordemId, ordemId) })
  const existente = await db.query.revendaPagamentos.findFirst({ where: eq(revendaPagamentos.ordemId, ordemId) })

  // "ODIN COMPRESSORES" no campo revenda = venda direta (sem revenda) —
  // aparece assim em vários pedidos reais, às vezes com "5%" anotado.
  const revendaBruta = det?.revenda?.trim() ?? ''
  const revendaNome = ehVendaDireta(revendaBruta) ? '' : revendaBruta
  const valorComissao = calcularComissao(det?.valorPedido, det?.comissaoModalidade, det?.comissaoValor)
  const completo = !!revendaNome && valorComissao != null && ordem.status !== 'cancelado'

  if (!completo) {
    if (existente && existente.status === 'ativo' && !ETAPAS_PAGAS.includes(existente.stage as EtapaPagamento)) {
      if (existente.stage === 'comissao_registrada') {
        await db.update(revendaPagamentos).set({ status: 'cancelado', cancelMotivo: 'Revenda ou comissão tirada do pedido', updatedAt: agoraSqlite() }).where(eq(revendaPagamentos.id, existente.id))
        await registrarHistoricoRevenda({ tipo: 'pagamento', refId: existente.id, revendaId: existente.revendaId, userId, descricao: 'Cancelado sozinho: a revenda ou a comissão foi tirada do pedido', stage: existente.stage })
      } else {
        await registrarHistoricoRevenda({ tipo: 'pagamento', refId: existente.id, revendaId: existente.revendaId, userId, descricao: '⚠️ A revenda ou a comissão foi tirada do pedido — confira se este pagamento ainda vale', stage: existente.stage })
      }
    }
    return
  }

  const revenda = await acharRevendaPorNome(ordem.empresaId, revendaNome)
  const cliente = ordem.clienteId ? await db.query.clientes.findFirst({ where: eq(clientes.id, ordem.clienteId), columns: { razaoSocial: true } }) : null
  const maquinas = await db.query.ordemMaquinas.findMany({ where: eq(ordemMaquinas.ordemId, ordemId), columns: { modelo: true, numeroSerie: true } })
  const equipamento = maquinas.map((m) => (m.numeroSerie ? `${m.modelo} (série ${m.numeroSerie})` : m.modelo)).join(', ') || null
  const novos = {
    revendaId: revenda?.id ?? null,
    revendaNome: revenda?.nome ?? revendaNome,
    clienteId: ordem.clienteId,
    clienteNome: cliente?.razaoSocial ?? null,
    numeroPedido: det?.numeroPedido?.trim() || null,
    equipamento,
    valorVenda: det?.valorPedido ?? null,
    comissaoModalidade: det!.comissaoModalidade,
    comissaoPercentual: det!.comissaoModalidade === 'percentual' ? det!.comissaoValor : null,
    valor: valorComissao!,
  }

  if (!existente) {
    const r = await db.insert(revendaPagamentos).values({ empresaId: ordem.empresaId, tipo: 'comissao', origem: 'automatico', ordemId, stage: 'comissao_registrada', criadoPor: userId, responsavelId: null, ...novos })
    const id = Number(r.lastInsertRowid)
    await registrarHistoricoRevenda({ tipo: 'pagamento', refId: id, revendaId: novos.revendaId, userId, descricao: `Gerado sozinho pelo Pedido #${ordemId}: comissão de ${textoComissao(novos.comissaoModalidade!, det!.comissaoValor!)} = ${formatarBrl(novos.valor)}`, stage: 'comissao_registrada' })
    return
  }

  const mudancas: string[] = []
  if (existente.revendaNome !== novos.revendaNome) mudancas.push(`revenda «${existente.revendaNome}» → «${novos.revendaNome}»`)
  if ((existente.valorVenda ?? null) !== novos.valorVenda) mudancas.push(`valor da venda ${formatarBrl(existente.valorVenda)} → ${formatarBrl(novos.valorVenda)}`)
  if (existente.valor !== novos.valor) mudancas.push(`comissão ${formatarBrl(existente.valor)} → ${formatarBrl(novos.valor)}`)
  if ((existente.numeroPedido ?? null) !== novos.numeroPedido) mudancas.push(`nº do pedido «${existente.numeroPedido ?? '—'}» → «${novos.numeroPedido ?? '—'}»`)
  if ((existente.equipamento ?? null) !== novos.equipamento) mudancas.push('equipamento')
  if ((existente.clienteNome ?? null) !== novos.clienteNome) mudancas.push('cliente')
  const reativar = existente.status === 'cancelado'
  if (!mudancas.length && !reativar) return

  if (ETAPAS_PAGAS.includes(existente.stage as EtapaPagamento)) {
    await registrarHistoricoRevenda({ tipo: 'pagamento', refId: existente.id, revendaId: existente.revendaId, userId, descricao: `⚠️ O pedido mudou depois do pagamento (nada foi alterado aqui): ${mudancas.join('; ')}`, stage: existente.stage })
    return
  }
  await db
    .update(revendaPagamentos)
    .set({ ...novos, ...(reativar ? { status: 'ativo' as const, cancelMotivo: null, stage: 'comissao_registrada' } : {}), updatedAt: agoraSqlite() })
    .where(eq(revendaPagamentos.id, existente.id))
  await registrarHistoricoRevenda({
    tipo: 'pagamento',
    refId: existente.id,
    revendaId: novos.revendaId,
    userId,
    descricao: `${reativar ? 'Reaberto' : 'Atualizado'} pelo Pedido #${ordemId}${mudancas.length ? `: ${mudancas.join('; ')}` : ''}`,
    stage: reativar ? 'comissao_registrada' : existente.stage,
  })
}

// Pedido cancelado: a comissão que ainda nem andou é cancelada junto; se já
// andou, só fica o aviso no histórico (o Financeiro decide).
export async function aoCancelarPedido(ordemId: number, userId: number | null, motivo: string) {
  const p = await db.query.revendaPagamentos.findFirst({ where: eq(revendaPagamentos.ordemId, ordemId) })
  if (!p || p.status !== 'ativo') return
  if (p.stage === 'comissao_registrada' || p.stage === 'aguardando_instalacao') {
    await db.update(revendaPagamentos).set({ status: 'cancelado', cancelMotivo: `Pedido cancelado: ${motivo}`, updatedAt: agoraSqlite() }).where(eq(revendaPagamentos.id, p.id))
    await registrarHistoricoRevenda({ tipo: 'pagamento', refId: p.id, revendaId: p.revendaId, userId, descricao: `Cancelado sozinho: Pedido #${ordemId} cancelado (${motivo})`, stage: p.stage })
  } else {
    await registrarHistoricoRevenda({ tipo: 'pagamento', refId: p.id, revendaId: p.revendaId, userId, descricao: `⚠️ O Pedido #${ordemId} foi cancelado (${motivo}) — confira se este pagamento ainda vale`, stage: p.stage })
  }
}
