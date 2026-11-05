// Meta diária de LIGAÇÕES EFETIVAS por vendedor (pedido do João, 2026-11-05).
// Soma toda ligação efetiva do ramal: lead, carteira, prospecção ou número
// fora do CRM. Ligação entre colegas (ramal → ramal) não conta. Uma meta por
// empresa Odin; Odin Tubos começa em 30, as outras em 0 (= sem meta). Quem tem
// conta em mais de uma empresa fica com a maior. Usado no contador do topo,
// no relatório de Ligações e no quadro "Hoje" do Kanban.
import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { contasVinculadas, empresas, pabxLigacoesProcessadas, pabxRamais, users } from '../db/schema.js'
import { getConfigNumero } from './configuracoes.js'
import { hojeBrString } from './dataBr.js'
import { SLUGS_EMPRESAS_PABX } from './pabxone360.js'

export const chaveMeta = (empresaId: number) => `pabxone360_meta_efetivas_dia_${empresaId}`

export async function metasPorEmpresa(): Promise<Map<number, number>> {
  const es = await db.query.empresas.findMany({ where: inArray(empresas.slug, SLUGS_EMPRESAS_PABX), columns: { id: true, slug: true } })
  const m = new Map<number, number>()
  for (const e of es) m.set(e.id, await getConfigNumero(chaveMeta(e.id), e.slug === 'odin-tubos' ? 30 : 0))
  return m
}

export async function metaDaPessoa(ids: number[], metas: Map<number, number>): Promise<number> {
  const us = await db.query.users.findMany({ where: inArray(users.id, ids), columns: { empresaId: true } })
  return Math.max(0, ...us.map((u) => (u.empresaId ? (metas.get(u.empresaId) ?? 0) : 0)))
}

export async function idsDaPessoa(userId: number): Promise<number[]> {
  const v = await db.query.contasVinculadas.findMany({ where: eq(contasVinculadas.userId, userId) })
  return [userId, ...v.map((x) => x.contaVinculadaId)]
}

// null = pessoa sem ramal ou empresa sem meta.
export async function metaEfetivasHoje(userId: number, metas?: Map<number, number>): Promise<{ meta: number; efetivas: number } | null> {
  const ids = await idsDaPessoa(userId)
  const temRamal = await db.query.pabxRamais.findFirst({ where: inArray(pabxRamais.userId, ids), columns: { id: true } })
  if (!temRamal) return null
  const meta = await metaDaPessoa(ids, metas ?? (await metasPorEmpresa()))
  if (!meta) return null
  const hoje = hojeBrString()
  const inicio = new Date(`${hoje}T03:00:00Z`)
  const fim = new Date(inicio.getTime() + 24 * 3600e3 - 1000)
  const sqlite = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19)
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(pabxLigacoesProcessadas)
    .where(
      and(
        inArray(pabxLigacoesProcessadas.userId, ids),
        eq(pabxLigacoesProcessadas.efetiva, true),
        isNotNull(pabxLigacoesProcessadas.numeroExterno),
        gte(pabxLigacoesProcessadas.dataHora, sqlite(inicio)),
        lte(pabxLigacoesProcessadas.dataHora, sqlite(fim))
      )
    )
  return { meta, efetivas: Number(r?.n ?? 0) }
}
