// Pós-venda da Compretec Loja Física (João, 2026-11-27): "clientes não voltam
// a comprar muito, temos que marcar manutenção". O vendedor cadastra o
// compressor vendido (pistão/parafuso) e o CRM agenda o contato:
//   - 1º contato: 30 dias depois da venda da máquina;
//   - depois do 1º contato, cada nova compra do cliente (venda, serviço ou
//     material) marca o próximo para 90 dias depois dela.
// O próximo contato também vira um compromisso (ligação) na agenda do
// vendedor, então aparece no card do cliente e avisa no horário.
import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clienteMaquinas, clienteMaquinaContatos, compromissos, vendas } from '../db/schema.js'
import { agoraSqlite } from './dataBr.js'

export const SLUG_POS_VENDA_LOJA = 'compretec-loja-fisica'
export const DIAS_PRIMEIRO_CONTATO = 30
export const DIAS_APOS_COMPRA = 90

export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

const TIPO_LABEL = { pistao: 'pistão', parafuso: 'parafuso', outro: '' } as const

type Maquina = typeof clienteMaquinas.$inferSelect

/** Deixa a agenda do vendedor igual ao próximo contato da máquina. */
export async function sincronizarCompromisso(m: Maquina, clienteNome?: string): Promise<void> {
  const atual = m.compromissoId ? await db.query.compromissos.findFirst({ where: eq(compromissos.id, m.compromissoId) }) : null
  const aberto = atual && !atual.concluido && !atual.deletedAt ? atual : null
  if (m.status !== 'ativo' || !m.proximoContato || !m.vendedorId) {
    if (aberto) await db.update(compromissos).set({ deletedAt: agoraSqlite(), updatedAt: agoraSqlite() }).where(eq(compromissos.id, aberto.id))
    return
  }
  // 9h de Brasília = 12h UTC (compromissos.dataHora é UTC).
  const dataHora = `${m.proximoContato} 12:00:00`
  const titulo = `Pós-venda: manutenção do compressor${TIPO_LABEL[m.tipo] ? ` ${TIPO_LABEL[m.tipo]}` : ''} ${m.modelo}`.slice(0, 200)
  const descricao = `${clienteNome ? `${clienteNome} — ` : ''}ligar para oferecer a manutenção/revisão do compressor${m.numeroSerie ? ` (série ${m.numeroSerie})` : ''}. Registre o contato na coluna Pós-venda do Kanban.`
  if (aberto) {
    if (aberto.dataHora !== dataHora || aberto.vendedorId !== m.vendedorId || aberto.titulo !== titulo) {
      await db.update(compromissos).set({ dataHora, vendedorId: m.vendedorId, titulo, descricao, notificado: false, updatedAt: agoraSqlite() }).where(eq(compromissos.id, aberto.id))
    }
    return
  }
  const [novo] = await db
    .insert(compromissos)
    .values({ vendedorId: m.vendedorId, clienteId: m.clienteId, tipo: 'ligacao', titulo, descricao, dataHora })
    .returning({ id: compromissos.id })
  await db.update(clienteMaquinas).set({ compromissoId: novo.id }).where(eq(clienteMaquinas.id, m.id))
}

/**
 * Regra dos 90 dias: máquina que já teve o 1º contato e o cliente comprou
 * de novo depois da data-base → próximo contato = compra + 90 dias.
 * Roda quando a coluna é aberta (barato: poucas máquinas por empresa).
 */
export async function aplicarNovasCompras(empresaId: number): Promise<number> {
  const ativas = await db.query.clienteMaquinas.findMany({ where: and(eq(clienteMaquinas.empresaId, empresaId), eq(clienteMaquinas.status, 'ativo')) })
  if (!ativas.length) return 0
  const comContato = new Set(
    (
      await db
        .selectDistinct({ id: clienteMaquinaContatos.maquinaId })
        .from(clienteMaquinaContatos)
        .where(inArray(clienteMaquinaContatos.maquinaId, ativas.map((m) => m.id)))
    ).map((r) => r.id)
  )
  let mudou = 0
  for (const m of ativas) {
    if (!comContato.has(m.id)) continue
    const base = m.baseData ?? m.dataVenda
    // Data da venda em Brasília (data_fechamento é UTC).
    const diaBr = sql<string>`date(${vendas.dataFechamento}, '-3 hours')`
    const [ultima] = await db
      .select({ dia: diaBr })
      .from(vendas)
      .where(and(eq(vendas.clienteId, m.clienteId), isNull(vendas.deletedAt), gt(diaBr, base), m.vendaId ? ne(vendas.id, m.vendaId) : sql`1=1`))
      .orderBy(desc(vendas.dataFechamento))
      .limit(1)
    if (!ultima?.dia) continue
    const proximo = somarDias(ultima.dia, DIAS_APOS_COMPRA)
    await db.update(clienteMaquinas).set({ proximoContato: proximo, baseData: ultima.dia, baseMotivo: 'nova_compra', updatedAt: agoraSqlite() }).where(eq(clienteMaquinas.id, m.id))
    await sincronizarCompromisso({ ...m, proximoContato: proximo, baseData: ultima.dia, baseMotivo: 'nova_compra' })
    mudou++
  }
  return mudou
}
