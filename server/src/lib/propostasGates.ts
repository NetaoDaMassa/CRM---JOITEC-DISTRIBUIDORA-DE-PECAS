// Regras de negócio do funil de Propostas — portadas de
// app/routers/propostas.py do odincrm.duckdns.org. Diferente de
// ordensGates.ts (sequência linear fixa com etapas fora de ordem só via
// "mover"), aqui proposta→negociacao→fechado é o caminho normal mas
// perdido/chamar_depois/convertido são alcançados por ação explícita a
// qualquer momento — não há uma "próxima etapa" única.
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { propostas, propostaArquivos, propostaHistorico, notifications, users } from '../db/schema.js'
import { registrarAuditoria } from './auditoria.js'
import { agoraSqlite } from './dataBr.js'

type PropostaRow = typeof propostas.$inferSelect

export function assertDonoOuGestor(proposta: PropostaRow, userId: number, role: 'admin' | 'vendor') {
  if (role === 'admin') return
  if (proposta.vendedorId !== userId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão' })
}

// Só entra em "negociacao" vindo de "proposta" se já tiver o PDF anexado —
// mesma regra do endpoint original (file_category='proposta_pdf' ou mime
// contendo "pdf").
export async function checkPodeIrParaNegociacao(propostaId: number): Promise<{ ok: boolean; motivo?: string }> {
  const arquivos = await db.query.propostaArquivos.findMany({ where: eq(propostaArquivos.propostaId, propostaId) })
  const temPdf = arquivos.some((a) => a.fileCategory === 'proposta_pdf' || (a.tipoArquivo?.includes('pdf') ?? false))
  if (!temPdf) return { ok: false, motivo: 'Anexe o PDF da proposta antes de avançar para Negociação' }
  return { ok: true }
}

export async function mudarEtapaProposta(params: { propostaId: number; empresaId: number; userId: number; novaEtapa: string; nota?: string }) {
  const { propostaId, empresaId, userId, novaEtapa, nota } = params
  const proposta = await db.query.propostas.findFirst({ where: and(eq(propostas.id, propostaId), eq(propostas.empresaId, empresaId)) })
  if (!proposta) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposta não encontrada' })

  if (novaEtapa === 'negociacao' && proposta.stage === 'proposta') {
    const r = await checkPodeIrParaNegociacao(propostaId)
    if (!r.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: r.motivo })
  }
  if (novaEtapa === 'chamar_depois' && !proposta.dataRetorno) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe a data de retorno antes de mover para Chamar Depois' })
  }

  const limpaDataRetorno = novaEtapa !== 'chamar_depois' && proposta.stage === 'chamar_depois'

  const upd = await db
    .update(propostas)
    .set({ stage: novaEtapa as PropostaRow['stage'], dataRetorno: limpaDataRetorno ? null : proposta.dataRetorno, versao: proposta.versao + 1, updatedAt: agoraSqlite() })
    .where(and(eq(propostas.id, propostaId), eq(propostas.versao, proposta.versao)))
  if (upd.rowsAffected === 0) throw new TRPCError({ code: 'CONFLICT', message: 'Proposta foi alterada por outra pessoa — recarregue a página' })

  await db.insert(propostaHistorico).values({ propostaId, userId, etapaAnterior: proposta.stage, etapaNova: novaEtapa, nota })
  await registrarAuditoria({ tabela: 'propostas', registroId: propostaId, acao: 'mudar_etapa', campo: 'stage', valorAnterior: proposta.stage, valorNovo: novaEtapa, alteradoPor: userId })

  return { ...proposta, stage: novaEtapa }
}

// Broadcast pra todos os admins da empresa — equivalente a
// notification_service.notify_managers() do odincrm. O `notifications` do
// Joitec CRM é por-usuário (não tem uma tabela de broadcast), então insere
// uma linha por admin.
export async function notificarGestores(empresaId: number, title: string, message: string, type: 'info' | 'warning' | 'error' | 'success' = 'info') {
  const admins = await db.query.users.findMany({ where: and(eq(users.empresaId, empresaId), eq(users.role, 'admin'), eq(users.isActive, true)) })
  for (const admin of admins) {
    await db.insert(notifications).values({ vendedorId: admin.id, title, message, type })
  }
}
