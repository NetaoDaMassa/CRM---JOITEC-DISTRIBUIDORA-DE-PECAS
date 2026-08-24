import { limparCnpj } from './cnpj.js'

export interface CnpjLookupResult {
  razaoSocial: string
  municipio: string
  uf: string
  situacao: string
  telefone: string | null
}

// BrasilAPI: gratuita, sem chave, dados públicos da Receita Federal. Não traz
// Inscrição Estadual (cada SEFAZ estadual tem a sua própria base, sem API
// nacional unificada) — esse campo continua manual.
export async function buscarCnpj(cnpj: string): Promise<CnpjLookupResult | null> {
  const limpo = limparCnpj(cnpj)
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${limpo}`, {
    headers: {
      Accept: 'application/json',
      // Sem User-Agent de navegador, o WAF da BrasilAPI bloqueia com 403
      // (bloqueio de bot/datacenter) — reproduzido rodando direto na VPS.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  })
  if (!res.ok) return null
  const data = (await res.json()) as {
    razao_social?: string
    municipio?: string
    uf?: string
    descricao_situacao_cadastral?: string
    ddd_telefone_1?: string
  }
  return {
    razaoSocial: data.razao_social ?? '',
    municipio: data.municipio ?? '',
    uf: data.uf ?? '',
    situacao: data.descricao_situacao_cadastral ?? '',
    telefone: data.ddd_telefone_1 || null,
  }
}
