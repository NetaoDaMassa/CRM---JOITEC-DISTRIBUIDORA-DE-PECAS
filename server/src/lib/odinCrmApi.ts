// Integração com o CRM da Odin Compressores (sistema próprio, separado —
// roda em https://odincrm.duckdns.org, FastAPI + Postgres). Busca o
// faturamento do mês pra somar no card "Odin Compressores / Comprefer" do
// Painel Financeiro, já que as vendas reais da Odin Compressores acontecem
// nesse sistema, não no Joitec CRM (aqui ela é só uma empresa cadastrada
// sem vendedor ativo). Só existe relatório por mês inteiro (sem filtro de
// dia) — por isso essa integração soma só em "vendas do mês", nunca em
// "vendas hoje".
const ODIN_CRM_BASE_URL = 'https://odincrm.duckdns.org'

type OdinCrmFaturamento = { period: string; total_value: number; order_count: number }

async function login(email: string, senha: string): Promise<string> {
  const resposta = await fetch(`${ODIN_CRM_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  })
  if (!resposta.ok) throw new Error(`Odin CRM: login falhou (${resposta.status})`)
  const dados = await resposta.json()
  return dados.access_token
}

async function buscarFaturamentoMes(email: string, senha: string, mesReferencia: string): Promise<{ quantidade: number; valor: number }> {
  const token = await login(email, senha)
  const resposta = await fetch(`${ODIN_CRM_BASE_URL}/api/reports/faturamento?period=${mesReferencia}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resposta.ok) throw new Error(`Odin CRM: relatório de faturamento falhou (${resposta.status})`)
  const dados: OdinCrmFaturamento = await resposta.json()
  return { quantidade: dados.order_count, valor: dados.total_value }
}

// Mesmo padrão de cache do atonErp.ts — o Painel Financeiro reconsulta a
// cada 30s, não faz sentido logar de novo nessa frequência. Se a Odin CRM
// estiver fora do ar, a última leitura boa continua servindo em vez de
// zerar o card.
type CacheEntry = { expiraEm: number; dados: { quantidade: number; valor: number } }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000

export async function buscarFaturamentoOdinCrmComCache(
  email: string,
  senha: string,
  mesReferencia: string
): Promise<{ quantidade: number; valor: number } | null> {
  const chave = `${email}:${mesReferencia}`
  const emCache = cache.get(chave)
  if (emCache && emCache.expiraEm > Date.now()) return emCache.dados

  try {
    const dados = await buscarFaturamentoMes(email, senha, mesReferencia)
    cache.set(chave, { expiraEm: Date.now() + CACHE_TTL_MS, dados })
    return dados
  } catch (err) {
    console.error('[odinCrmApi] falha ao buscar faturamento:', err)
    return emCache?.dados ?? null
  }
}
