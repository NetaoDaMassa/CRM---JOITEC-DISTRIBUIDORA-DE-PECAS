import { limparCnpj } from './cnpj.js'

export interface CnpjLookupResult {
  razaoSocial: string
  municipio: string
  uf: string
  situacao: string
  telefone: string | null
  // Endereço completo — a BrasilAPI já devolve isso (vem da própria Receita),
  // só não estava sendo aproveitado. Cadastro completo automático a partir
  // do CNPJ, pedido do João, 2026-09-15 (evita redigitar endereço na mão pra
  // depois puxar certo na hora de gerar o Pedido).
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cep: string | null
  email: string | null
  // Usados no enriquecimento do lead da Meta (2026-10-27).
  nomeFantasia: string | null
  atividade: string | null
  dataAbertura: string | null
  porte: string | null
  // Optante pelo Simples Nacional (null = a Receita não informou) — sugere o
  // grupo tributário no cadastro que vai pro SAP (2026-11-12).
  simples: boolean | null
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
    logradouro?: string
    numero?: string
    complemento?: string
    bairro?: string
    cep?: string
    email?: string
    nome_fantasia?: string
    cnae_fiscal_descricao?: string
    data_inicio_atividade?: string
    porte?: string
    opcao_pelo_simples?: boolean | null
  }
  return {
    razaoSocial: data.razao_social ?? '',
    municipio: data.municipio ?? '',
    uf: data.uf ?? '',
    situacao: data.descricao_situacao_cadastral ?? '',
    telefone: data.ddd_telefone_1 || null,
    logradouro: data.logradouro || null,
    numero: data.numero || null,
    complemento: data.complemento || null,
    bairro: data.bairro || null,
    cep: data.cep || null,
    email: data.email || null,
    nomeFantasia: data.nome_fantasia || null,
    atividade: data.cnae_fiscal_descricao || null,
    dataAbertura: data.data_inicio_atividade || null,
    porte: data.porte || null,
    simples: typeof data.opcao_pelo_simples === 'boolean' ? data.opcao_pelo_simples : null,
  }
}

// CEP → endereço (Izabelly, 2026-11-13: "puxar o CEP automático"). BrasilAPI
// e, se falhar, ViaCEP — ambas gratuitas e sem chave.
export interface CepResult { cep: string; rua: string; bairro: string; cidade: string; uf: string }
export async function buscarCep(cep: string): Promise<CepResult | null> {
  const d = (cep ?? '').replace(/\D/g, '')
  if (d.length !== 8) return null
  const ua = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${d}`, { headers: ua, signal: AbortSignal.timeout(6000) })
    if (r.ok) {
      const j = (await r.json()) as { street?: string; neighborhood?: string; city?: string; state?: string }
      if (j.city) return { cep: d, rua: j.street ?? '', bairro: j.neighborhood ?? '', cidade: j.city, uf: j.state ?? '' }
    }
  } catch {}
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { headers: ua, signal: AbortSignal.timeout(6000) })
    if (r.ok) {
      const j = (await r.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }
      if (!j.erro && j.localidade) return { cep: d, rua: j.logradouro ?? '', bairro: j.bairro ?? '', cidade: j.localidade, uf: j.uf ?? '' }
    }
  } catch {}
  return null
}
