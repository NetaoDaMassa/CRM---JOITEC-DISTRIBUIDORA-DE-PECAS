// Distribuição dos leads que chegam pelo WhatsApp interno (captura).
// Padrão: vendedor pelo DDD (mesma regra dos leads da Meta).
// Modo "vendedor" (João, 2026-11-27, Compretec Loja Física): ignora DDD/região
// e reveza entre os vendedores escolhidos — 1 pro Thiago, 1 pro Marcos, e
// assim vai. Lista vazia = todos os vendedores ativos da empresa.
// Config em `configuracoes`:
//   wa_captura_<id>_distribuicao = JSON { modo: 'ddd' | 'vendedor', vendedores: number[] }
//   wa_captura_<id>_rodizio_idx  = de quem é a vez
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { users } from '../../db/schema.js'
import { getConfigNumero, getConfigTexto, setConfig } from '../configuracoes.js'

export type ModoDistribuicao = 'ddd' | 'vendedor'
export type DistribuicaoWhatsapp = { modo: ModoDistribuicao; vendedores: number[] }

// Empresas que já nascem no rodízio por vendedor (até alguém mudar na tela).
const PADRAO_RODIZIO = new Set([7]) // Compretec Loja Física

const chaveDistribuicao = (empresaId: number) => `wa_captura_${empresaId}_distribuicao`
const chaveIdx = (empresaId: number) => `wa_captura_${empresaId}_rodizio_idx`

export async function distribuicaoWhatsapp(empresaId: number): Promise<DistribuicaoWhatsapp> {
  const txt = await getConfigTexto(chaveDistribuicao(empresaId))
  if (txt) {
    try {
      const j = JSON.parse(txt)
      return {
        modo: j?.modo === 'vendedor' ? 'vendedor' : 'ddd',
        vendedores: Array.isArray(j?.vendedores) ? j.vendedores.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [],
      }
    } catch { /* config estragada: cai no padrão */ }
  }
  return { modo: PADRAO_RODIZIO.has(empresaId) ? 'vendedor' : 'ddd', vendedores: [] }
}

export async function salvarDistribuicaoWhatsapp(empresaId: number, d: DistribuicaoWhatsapp): Promise<void> {
  await setConfig(chaveDistribuicao(empresaId), JSON.stringify({ modo: d.modo, vendedores: [...new Set(d.vendedores)] }))
}

/** Vendedores ativos da empresa (opções da tela). */
export async function vendedoresDaEmpresa(empresaId: number) {
  return db
    .select({ id: users.id, nome: users.name, ativo: users.isActive })
    .from(users)
    .where(and(eq(users.empresaId, empresaId), eq(users.role, 'vendor')))
    .orderBy(asc(users.name))
}

/** Fila do rodízio na ordem em que vai sair (só vendedores ativos). */
export async function filaDoRodizio(empresaId: number): Promise<{ id: number; nome: string }[]> {
  const d = await distribuicaoWhatsapp(empresaId)
  if (!d.vendedores.length) {
    return (await vendedoresDaEmpresa(empresaId)).filter((v) => v.ativo).map((v) => ({ id: v.id, nome: v.nome }))
  }
  const ativos = await db
    .select({ id: users.id, nome: users.name })
    .from(users)
    .where(and(eq(users.empresaId, empresaId), eq(users.isActive, true), inArray(users.id, d.vendedores)))
  const porId = new Map(ativos.map((v) => [v.id, v]))
  return d.vendedores.map((id) => porId.get(id)).filter((v): v is { id: number; nome: string } => !!v)
}

/** De quem é a vez agora (sem avançar) — para a tela mostrar. */
export async function proximoDaVez(empresaId: number): Promise<{ id: number; nome: string } | null> {
  const fila = await filaDoRodizio(empresaId)
  if (!fila.length) return null
  return fila[(await getConfigNumero(chaveIdx(empresaId), 0)) % fila.length]
}

// Um de cada vez por empresa: duas mensagens chegando juntas não podem cair
// no mesmo vendedor.
const travas = new Map<number, Promise<unknown>>()

/** Pega o vendedor da vez e passa a vez para o próximo. null = ninguém na fila. */
export async function vendedorDaVez(empresaId: number): Promise<number | null> {
  const anterior = travas.get(empresaId) ?? Promise.resolve()
  const atual = anterior.catch(() => undefined).then(async () => {
    const fila = await filaDoRodizio(empresaId)
    if (!fila.length) return null
    const idx = (await getConfigNumero(chaveIdx(empresaId), 0)) % fila.length
    await setConfig(chaveIdx(empresaId), (idx + 1) % fila.length)
    return fila[idx].id
  })
  travas.set(empresaId, atual)
  return atual
}

/** Usado pela captura: no modo "vendedor" devolve o escolhedor; no modo DDD, undefined (regra de sempre). */
export async function escolhedorDeVendedor(empresaId: number): Promise<(() => Promise<number | null>) | undefined> {
  const d = await distribuicaoWhatsapp(empresaId)
  return d.modo === 'vendedor' ? () => vendedorDaVez(empresaId) : undefined
}
