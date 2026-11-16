import { limparCnpj } from './cnpj.js'

// Inscrição Estadual a partir do CNPJ (pedido do João, 2026-11-16).
// A BrasilAPI (Receita) não traz IE — cada SEFAZ tem a sua base. A API
// pública do CNPJ.ws junta isso (via SINTEGRA/CCC) e é gratuita, sem chave,
// mas limitada a ~3 consultas por minuto por IP. Por isso: cache em memória
// e timeout curto — se falhar, o campo só fica pra preencher na mão, nunca
// trava a consulta da Receita.

export interface InscricaoEstadualInfo {
  ie: string
  uf: string
  ativa: boolean
}

export interface InscricaoEstadualResultado {
  /** IE sugerida: a ativa no estado do CNPJ; senão, qualquer ativa. */
  sugerida: string | null
  /** Todas as IEs que a base conhece (inclusive baixadas / outros estados). */
  todas: InscricaoEstadualInfo[]
}

const CACHE_MS = 24 * 60 * 60 * 1000
const cache = new Map<string, { em: number; valor: InscricaoEstadualResultado }>()

export async function buscarInscricaoEstadual(cnpj: string, ufDoCnpj?: string | null): Promise<InscricaoEstadualResultado | null> {
  const limpo = limparCnpj(cnpj)
  if (limpo.length !== 14) return null
  const emCache = cache.get(limpo)
  if (emCache && Date.now() - emCache.em < CACHE_MS) return escolher(emCache.valor.todas, ufDoCnpj)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`https://publica.cnpj.ws/cnpj/${limpo}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; CRM)' },
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      estabelecimento?: {
        estado?: { sigla?: string }
        inscricoes_estaduais?: { inscricao_estadual?: string; ativo?: boolean; estado?: { sigla?: string } }[]
      }
    }
    const todas: InscricaoEstadualInfo[] = (data.estabelecimento?.inscricoes_estaduais ?? [])
      .filter((i) => i.inscricao_estadual)
      .map((i) => ({ ie: String(i.inscricao_estadual).trim(), uf: i.estado?.sigla ?? '', ativa: i.ativo === true }))
    const valor = escolher(todas, ufDoCnpj ?? data.estabelecimento?.estado?.sigla)
    cache.set(limpo, { em: Date.now(), valor })
    return valor
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function escolher(todas: InscricaoEstadualInfo[], uf?: string | null): InscricaoEstadualResultado {
  const ativas = todas.filter((i) => i.ativa)
  const doEstado = uf ? ativas.find((i) => i.uf.toUpperCase() === uf.toUpperCase()) : undefined
  return { sugerida: (doEstado ?? ativas[0])?.ie ?? null, todas }
}
