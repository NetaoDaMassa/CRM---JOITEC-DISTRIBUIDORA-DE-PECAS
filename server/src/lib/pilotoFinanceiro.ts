import { getConfigTexto, setConfig } from './configuracoes.js'

// Piloto das mudanças do financeiro (João, 2026-11-16: "não posso soltar pra
// todo mundo"). As regras novas que mexem em telas que todos usam (trava do
// PIX, trava dos isentos, pedir link de pagamento, cotação sem cadastro,
// regras novas do cadastro) só valem pra quem está nesta lista — ou pra
// todos quando `todos` = true. Telas novas do financeiro continuam liberadas
// pessoa a pessoa em Funções e permissões.
const CHAVE = 'financeiro_piloto'
export type Piloto = { todos: boolean; usuarios: number[] }

let cache: { em: number; v: Piloto } | null = null

export async function lerPiloto(): Promise<Piloto> {
  if (cache && Date.now() - cache.em < 30_000) return cache.v
  let v: Piloto = { todos: false, usuarios: [] }
  const raw = await getConfigTexto(CHAVE)
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<Piloto>
      v = { todos: !!p.todos, usuarios: Array.isArray(p.usuarios) ? p.usuarios.filter((n) => Number.isInteger(n)) : [] }
    } catch {
      /* mantém vazio */
    }
  }
  cache = { em: Date.now(), v }
  return v
}

export async function salvarPiloto(p: Piloto): Promise<void> {
  await setConfig(CHAVE, JSON.stringify({ todos: p.todos, usuarios: [...new Set(p.usuarios)] }))
  cache = null
}

export async function noPiloto(userId: number | null | undefined): Promise<boolean> {
  if (!userId) return false
  const p = await lerPiloto()
  return p.todos || p.usuarios.includes(userId)
}

// Pra filtrar muitas linhas de uma vez (ex.: vendas por vendedor).
export async function filtroPiloto(): Promise<(userId: number | null | undefined) => boolean> {
  const p = await lerPiloto()
  const set = new Set(p.usuarios)
  return (id) => p.todos || (!!id && set.has(id))
}
