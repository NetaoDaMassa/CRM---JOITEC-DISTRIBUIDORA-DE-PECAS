import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { cadastrosClientesSap, carteiraHistorico, clientes } from '../db/schema.js'

// Etiqueta "chegou na carteira" no card do Kanban (João, 2026-11-17): cliente
// que entrou na carteira do vendedor nos últimos DIAS dias — transferido pra
// ele, cliente novo ou cadastro aprovado pelo financeiro. Vale pra todas as
// empresas e usa o carteira_historico (toda entrada de cliente numa carteira
// grava uma linha ali: transferência, cadastro, aprovação, lead, SAP).
export const DIAS_CHEGOU_NA_CARTEIRA = 30
export type MotivoChegada = 'aprovado' | 'novo' | 'banco' | 'transferido'
export type ChegouNaCarteira = { motivo: MotivoChegada; em: string }

function utc(s: string): number {
  return new Date(`${s.replace(' ', 'T').slice(0, 19)}Z`).getTime()
}

// Map "clienteId:vendedorId" → chegada (só a mais recente, dentro da janela).
export async function chegadasNaCarteira(pares: { clienteId: number; vendedorId: number }[]): Promise<Map<string, ChegouNaCarteira>> {
  const out = new Map<string, ChegouNaCarteira>()
  if (!pares.length) return out
  const querido = new Set(pares.map((p) => `${p.clienteId}:${p.vendedorId}`))
  const desde = new Date(Date.now() - DIAS_CHEGOU_NA_CARTEIRA * 86400000).toISOString().slice(0, 19).replace('T', ' ')
  // Só as entradas dos últimos dias (poucas) — depois o histórico só desses clientes.
  const recentes = (
    await db
      .select({ clienteId: carteiraHistorico.clienteId, vendedorId: carteiraHistorico.vendedorId, createdAt: carteiraHistorico.createdAt })
      .from(carteiraHistorico)
      .where(gte(carteiraHistorico.createdAt, desde))
      .orderBy(desc(carteiraHistorico.createdAt))
  ).filter((h) => querido.has(`${h.clienteId}:${h.vendedorId}`))
  if (!recentes.length) return out
  const historico: { clienteId: number; vendedorId: number; createdAt: string }[] = []
  const doHistorico = [...new Set(recentes.map((h) => h.clienteId))]
  for (let i = 0; i < doHistorico.length; i += 500)
    historico.push(
      ...(await db
        .select({ clienteId: carteiraHistorico.clienteId, vendedorId: carteiraHistorico.vendedorId, createdAt: carteiraHistorico.createdAt })
        .from(carteiraHistorico)
        .where(inArray(carteiraHistorico.clienteId, doHistorico.slice(i, i + 500))))
    )
  const ids = [...new Set(recentes.map((h) => h.clienteId))]
  const criadoEm = new Map<number, string>()
  const doBanco = new Set<number>()
  const aprovadoEm = new Map<number, string>()
  for (let i = 0; i < ids.length; i += 500) {
    const fatia = ids.slice(i, i + 500)
    for (const c of await db.select({ id: clientes.id, createdAt: clientes.createdAt, origemBanco: clientes.origemBanco }).from(clientes).where(inArray(clientes.id, fatia))) {
      criadoEm.set(c.id, c.createdAt)
      if (c.origemBanco) doBanco.add(c.id)
    }
    for (const a of await db
      .select({ clienteId: cadastrosClientesSap.clienteId, aprovadoEm: cadastrosClientesSap.aprovadoEm })
      .from(cadastrosClientesSap)
      .where(and(inArray(cadastrosClientesSap.clienteId, fatia), eq(cadastrosClientesSap.status, 'aprovado'), gte(cadastrosClientesSap.aprovadoEm, desde.slice(0, 10)))))
      if (a.clienteId && a.aprovadoEm) aprovadoEm.set(a.clienteId, a.aprovadoEm)
  }
  for (const h of recentes) {
    const chave = `${h.clienteId}:${h.vendedorId}`
    if (!querido.has(chave) || out.has(chave)) continue // histórico vem do mais novo pro mais velho
    const anteriorDeOutro = historico.some((x) => x.clienteId === h.clienteId && x.vendedorId !== h.vendedorId && x.createdAt < h.createdAt)
    const criado = criadoEm.get(h.clienteId)
    const novo = !!criado && Math.abs(utc(criado) - utc(h.createdAt)) < 2 * 86400000
    // Banco de clientes: cliente antigo sem vendedor antes (ou marcado com o banco de origem) que o gestor passou pra carteira.
    const motivo: MotivoChegada = aprovadoEm.has(h.clienteId) ? 'aprovado' : novo && !anteriorDeOutro ? 'novo' : doBanco.has(h.clienteId) || !anteriorDeOutro ? 'banco' : 'transferido'
    out.set(chave, { motivo, em: h.createdAt })
  }
  return out
}
