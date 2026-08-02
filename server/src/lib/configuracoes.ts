import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { configuracoes } from '../db/schema.js'

export async function getConfigNumero(chave: string, padrao: number): Promise<number> {
  const row = await db.query.configuracoes.findFirst({ where: eq(configuracoes.chave, chave) })
  if (!row) return padrao
  const num = Number(row.valor)
  return Number.isNaN(num) ? padrao : num
}

export async function getConfigTexto(chave: string): Promise<string | null> {
  const row = await db.query.configuracoes.findFirst({ where: eq(configuracoes.chave, chave) })
  return row?.valor ?? null
}

export async function apagarConfig(chave: string): Promise<void> {
  await db.delete(configuracoes).where(eq(configuracoes.chave, chave))
}

export async function setConfig(chave: string, valor: string | number): Promise<void> {
  const valorStr = String(valor)
  const existente = await db.query.configuracoes.findFirst({ where: eq(configuracoes.chave, chave) })
  if (existente) {
    await db.update(configuracoes).set({ valor: valorStr, updatedAt: new Date().toISOString() }).where(eq(configuracoes.chave, chave))
  } else {
    await db.insert(configuracoes).values({ chave, valor: valorStr })
  }
}
