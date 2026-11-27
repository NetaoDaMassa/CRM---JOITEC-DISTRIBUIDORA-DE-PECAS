// Consulta/Solicitação de Crédito liberada pra TODOS os vendedores de algumas
// empresas (pedido do João, 2026-11-27) — por regra, não pessoa por pessoa,
// pra vendedor novo já entrar com acesso. Quem tiver exceção "remove" dessa
// chave em Permissões fica de fora. Odin Compressores: só quem tiver a chave
// liberada (Agatha, Andreia, Roberto — exceção "add"). Compretec: em análise
// (muito cliente CPF na loja), por enquanto só com a chave.
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, users, usuarioExcecoes } from '../db/schema.js'

export const FEATURE_CREDITO = 'solicitacao_credito'
export const EMPRESAS_CREDITO_TODOS_VENDEDORES = new Set(['joitec', 'joitec-automacao', 'odin-tubos'])

export async function creditoLiberadoPelaEmpresa(userId: number): Promise<boolean> {
  const [u] = await db
    .select({ role: users.role, slug: empresas.slug })
    .from(users)
    .innerJoin(empresas, eq(empresas.id, users.empresaId))
    .where(eq(users.id, userId))
  if (!u || u.role !== 'vendor' || !EMPRESAS_CREDITO_TODOS_VENDEDORES.has(u.slug)) return false
  const tirado = await db.query.usuarioExcecoes.findFirst({
    where: and(eq(usuarioExcecoes.userId, userId), eq(usuarioExcecoes.feature, FEATURE_CREDITO), eq(usuarioExcecoes.modo, 'remove')),
  })
  return !tirado
}
