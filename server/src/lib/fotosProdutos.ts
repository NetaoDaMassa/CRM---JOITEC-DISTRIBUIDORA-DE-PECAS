// Fotos dos produtos (tabela item_fotos). Semente: recortes do catálogo da
// Joitec (data/fotosProdutos.ts) — entra só o que ainda não tem foto, nunca
// passa por cima de uma foto enviada por um admin.
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { itemFotos } from '../db/schema.js'
import { FOTOS_CATALOGO_JOITEC } from '../data/fotosProdutos.js'

export async function semearFotosCatalogo(): Promise<void> {
  const linhas = Object.entries(FOTOS_CATALOGO_JOITEC).map(([itemCodigo, url]) => ({ itemCodigo, url, origem: 'catalogo' as const }))
  for (let i = 0; i < linhas.length; i += 200) await db.insert(itemFotos).values(linhas.slice(i, i + 200)).onConflictDoNothing()
}

export async function fotosPorItem(): Promise<Map<string, string>> {
  const linhas = await db.select({ item: itemFotos.itemCodigo, url: itemFotos.url }).from(itemFotos)
  return new Map(linhas.map((l) => [l.item, l.url]))
}

export const contarFotos = async () => (await db.select({ n: sql<number>`count(*)` }).from(itemFotos))[0]?.n ?? 0
