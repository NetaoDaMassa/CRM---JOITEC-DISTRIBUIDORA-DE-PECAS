import { and, desc, eq, lte } from 'drizzle-orm'
import { db } from '../db/client.js'
import { metasMensais } from '../db/schema.js'

type MetaRow = typeof metasMensais.$inferSelect
export type MetaVigente = MetaRow & { herdadaDe: string | null }

// A meta de um vendedor passou a valer indefinidamente até alguém trocar.
// Antes cada linha de `metas_mensais` valia só pro seu `mes_referencia`, e
// como o gestor não redigita as metas todo dia 1º, no começo de cada mês o
// dashboard do vendedor e o Painel de TV mostravam "0% de R$ 0" mesmo pra
// quem já tinha vendas — foi o que o João viu no Guilherme (Joitec
// Distribuidora) em setembro/2026. Agora, se não existe linha pro mês
// pedido, cai na linha mais recente de um mês anterior. `herdadaDe` diz de
// qual mês a meta veio (null = foi definida pro próprio mês), só pra tela
// de Metas conseguir mostrar "herdada de agosto".
//
// `mes_referencia` é texto YYYY-MM-01, então comparação lexicográfica com
// `<=` equivale a comparação de data.

export async function metaVigente(vendedorId: number, mesReferencia: string): Promise<MetaVigente | null> {
  const [m] = await db.query.metasMensais.findMany({
    where: and(eq(metasMensais.vendedorId, vendedorId), lte(metasMensais.mesReferencia, mesReferencia)),
    orderBy: [desc(metasMensais.mesReferencia)],
    limit: 1,
  })
  if (!m) return null
  return { ...m, herdadaDe: m.mesReferencia === mesReferencia ? null : m.mesReferencia }
}

export async function metasVigentesPorVendedor(mesReferencia: string): Promise<Map<number, MetaVigente>> {
  const linhas = await db.query.metasMensais.findMany({
    where: lte(metasMensais.mesReferencia, mesReferencia),
    orderBy: [desc(metasMensais.mesReferencia)],
  })
  const mapa = new Map<number, MetaVigente>()
  for (const m of linhas) {
    if (mapa.has(m.vendedorId)) continue // já é a mais recente desse vendedor
    mapa.set(m.vendedorId, { ...m, herdadaDe: m.mesReferencia === mesReferencia ? null : m.mesReferencia })
  }
  return mapa
}
