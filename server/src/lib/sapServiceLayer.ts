// Conexão com o SAP Business One pelo Service Layer (API REST/OData do
// próprio SAP) — pedido do João, 2026-10-29. Substitui, aos poucos, as
// planilhas que ele exportava do SAP e mandava pra importar.
//
// Só CONSULTA: além de Login/Logout, este módulo só faz GET. O usuário
// (`integracao.frete`, licença Indirect) é compartilhado com a integração de
// frete — por isso o CRM nunca grava nada nem mexe na sessão dos outros
// (Logout encerra só a sessão aberta aqui).
//
// Configuração no .env do servidor: SAP_SL_URL (…:50000/b1s/v1),
// SAP_SL_COMPANYDB (SBO_ODIN_PRD; o usuário não está liberado no
// SBO_ODIN_TST10), SAP_SL_USER, SAP_SL_PASSWORD.

export interface SapSessao {
  get<T = unknown>(caminho: string): Promise<T>
  // Segue o odata.nextLink até o fim. `porPagina` vira o Prefer:
  // odata.maxpagesize (padrão do Service Layer é 20).
  getTodos<T = unknown>(caminho: string, porPagina?: number): Promise<T[]>
}

export function sapConfigurado(): boolean {
  return Boolean(process.env.SAP_SL_URL && process.env.SAP_SL_COMPANYDB && process.env.SAP_SL_USER && process.env.SAP_SL_PASSWORD)
}

// Abre uma sessão, roda `fn` e fecha a sessão no fim, mesmo se der erro.
export async function comSessaoSap<T>(fn: (sap: SapSessao) => Promise<T>): Promise<T> {
  if (!sapConfigurado()) throw new Error('SAP não configurado (SAP_SL_URL / SAP_SL_COMPANYDB / SAP_SL_USER / SAP_SL_PASSWORD no .env)')
  const base = process.env.SAP_SL_URL!.replace(/\/+$/, '')

  const login = await fetch(`${base}/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      CompanyDB: process.env.SAP_SL_COMPANYDB,
      UserName: process.env.SAP_SL_USER,
      Password: process.env.SAP_SL_PASSWORD,
    }),
  })
  if (!login.ok) throw new Error(`Login no SAP recusado (HTTP ${login.status}): ${mensagemErro(await login.text())}`)
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')

  const buscar = async (url: string, porPagina?: number) => {
    const headers: Record<string, string> = { Cookie: cookie }
    if (porPagina) headers.Prefer = `odata.maxpagesize=${porPagina}`
    const r = await fetch(url, { headers })
    const texto = await r.text()
    if (!r.ok) throw new Error(`SAP respondeu HTTP ${r.status} em ${url.slice(base.length)}: ${mensagemErro(texto)}`)
    return JSON.parse(texto)
  }

  const sessao: SapSessao = {
    get: (caminho) => buscar(`${base}${caminho}`),
    async getTodos(caminho, porPagina = 500) {
      const todos = []
      let url: string | null = `${base}${caminho}`
      while (url) {
        const j = await buscar(url, porPagina)
        todos.push(...j.value)
        const proximo: string | undefined = j['odata.nextLink'] ?? j['@odata.nextLink']
        // nextLink vem relativo ("Invoices?$skip=500" ou "/b1s/v1/Invoices?...")
        url = proximo ? `${base}/${proximo.replace(/^\/?b1s\/v[12]\//, '')}` : null
      }
      return todos
    },
  }

  try {
    return await fn(sessao)
  } finally {
    await fetch(`${base}/Logout`, { method: 'POST', headers: { Cookie: cookie } }).catch(() => {})
  }
}

function mensagemErro(texto: string): string {
  try {
    return JSON.parse(texto)?.error?.message?.value ?? texto.slice(0, 300)
  } catch {
    return texto.slice(0, 300)
  }
}

// Data do SAP ("2026-10-28T00:00:00Z") → "2026-10-28".
export function dataSap(d: string): string {
  return d.slice(0, 10)
}
