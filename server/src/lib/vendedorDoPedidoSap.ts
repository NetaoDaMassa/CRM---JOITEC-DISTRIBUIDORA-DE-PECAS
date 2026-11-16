import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { getConfigTexto } from './configuracoes.js'
import { naoEhVendedorPessoa, nomeDoSap } from './sapVendedoresNovos.js'

// Venda do SAP conta pra QUEM FEZ O PEDIDO (decisão do João, 2026-11-16:
// "isso cair para quem fez o pedido no sap" — as empresas do grupo atendem os
// mesmos clientes e o cadastro do CRM pode estar na carteira de outra pessoa,
// ex.: pedido 9511 da Luana no Bráulio, cadastro da tatiane).
// Vendedor do SAP → login do CRM na MESMA empresa:
//   1. ligação manual em `sap_vendedores_crm` ({códigoSAP: userId}), se o
//      usuário for dessa empresa;
//   2. pelo nome: primeiro nome igual (aceita 1 letra de diferença —
//      "YASMIM" × "Yasmin") e, quando os dois têm sobrenome, um em comum
//      ("YASMIM RIBEIRO DE RAMOS" × "Yasmin Ramos", não "Yasmin Salles").
//      Só vale se achar UMA pessoa.
// Só login de VENDEDOR (gestor/admin como o Jaciel faz pedido pelos outros).
// Sem login (representante, "BIANCA GRATÃO - PPR", JOITEC…) → null: fica a
// regra antiga (dona do cadastro).

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')
const palavras = (t: string) =>
  semAcento(nomeDoSap(t))
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .filter((x) => x.length > 2 && !['das', 'dos'].includes(x))

function umaLetra(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false
  // distância de edição ≤ 1
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const ra = a.slice(i + (a.length >= b.length ? 1 : 0))
  const rb = b.slice(i + (b.length >= a.length ? 1 : 0))
  return ra === rb
}

export function mesmaPessoaSap(nomeCrm: string, nomeSap: string): boolean {
  const a = palavras(nomeCrm)
  const b = palavras(nomeSap)
  if (!a.length || !b.length || !umaLetra(a[0], b[0])) return false
  if (a.length === 1 || b.length === 1) return true
  return a.slice(1).some((x) => b.includes(x))
}

export async function montarVendedorDoPedido(nomesSap: Map<number, string>): Promise<(empresaId: number, codigoSap: number) => number | null> {
  let ligados: Record<string, number> = {}
  try {
    const j = JSON.parse((await getConfigTexto('sap_vendedores_crm')) ?? '{}')
    if (j && typeof j === 'object') ligados = j
  } catch {
    /* sem ligação manual */
  }
  const lista = await db
    .select({ id: users.id, name: users.name, empresaId: users.empresaId })
    .from(users)
    .where(and(eq(users.isActive, true), eq(users.role, 'vendor')))
  const cache = new Map<string, number | null>()
  return (empresaId, codigoSap) => {
    const k = `${empresaId}|${codigoSap}`
    if (cache.has(k)) return cache.get(k)!
    let r: number | null = null
    const manual = Number(ligados[String(codigoSap)])
    if (manual && lista.some((u) => u.id === manual && u.empresaId === empresaId)) r = manual
    else {
      const nome = nomesSap.get(codigoSap)
      if (nome && codigoSap > 0 && !naoEhVendedorPessoa(nome) && !/\bPPR\b/i.test(nome)) {
        const achados = lista.filter((u) => u.empresaId === empresaId && mesmaPessoaSap(u.name, nome))
        if (achados.length === 1) r = achados[0].id
      }
    }
    cache.set(k, r)
    return r
  }
}
