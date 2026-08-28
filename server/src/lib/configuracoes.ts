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

// Booleano guardado como texto '1'/'0' (também aceita 'true'/'false' por
// tolerância). Ausente = padrão.
export async function getConfigBool(chave: string, padrao: boolean): Promise<boolean> {
  const row = await db.query.configuracoes.findFirst({ where: eq(configuracoes.chave, chave) })
  if (!row) return padrao
  return row.valor === '1' || row.valor.toLowerCase() === 'true'
}

// true só se a chave AINDA não existe na tabela (usado pelo seed inicial:
// só semeia o que nunca foi definido, nunca sobrescreve).
export async function configExiste(chave: string): Promise<boolean> {
  const row = await db.query.configuracoes.findFirst({ where: eq(configuracoes.chave, chave), columns: { chave: true } })
  return !!row
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
