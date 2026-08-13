// Integração com a API pública do Aton ERP (sistema usado pela Compretec
// E-commerce e Compretec Loja Física) — busca pedidos de venda por período
// pra alimentar "vendas hoje"/"vendas no mês"/faturamento no Painel
// Financeiro, já que essas duas empresas não têm vendedor/funil cadastrado
// no CRM (venda acontece 100% no Aton). Cada loja tem seu próprio token —
// não existe filtro de "empresa" dentro de uma chamada.
const ATON_BASE_URL = 'https://api.ambarxcall.com.br/AtonSNIsapi.dll/atonerp'
const ATON_LIMIT = 50

// Só conta pedido com nota fiscal emitida como venda de verdade — mesmo
// critério que o resto do Painel Financeiro usa (venda "fechada"), decisão
// confirmada com o João em vez de contar PENDENTE/ABERTA (pedido ainda em
// andamento, pode nem virar venda).
const POSICAO_VENDA_CONFIRMADA = 'EMITIDO'

// `posicao` (filtrada na chamada, sempre EMITIDO) e `status` são campos
// INDEPENDENTES — um pedido cancelado no marketplace depois de ter nota
// emitida continua com posicao=EMITIDO, só o `status` muda (visto na prática:
// "CANCELADO NO MARKETPLACE"). Sem checar `status`, pedido cancelado/estornado
// entrava na soma de faturamento igual venda de verdade — só "NORMAL" conta.
const STATUS_VENDA_VALIDA = 'NORMAL'

type AtonPedido = { total_pedido: number; status: string }
type AtonRespostaPedidos = {
  status: string
  mensagem: string
  resultado?: { total: number; offset: number; limit: number; pedidos: AtonPedido[] }
}

function paraFormatoBr(dataIso: string): string {
  const [ano, mes, dia] = dataIso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

async function buscarPaginaPedidos(token: string, dataInicialBr: string, dataFinalBr: string, offset: number): Promise<AtonRespostaPedidos> {
  const resposta = await fetch(`${ATON_BASE_URL}/pedidosvenda/consulta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({
      tipo_data: 'data_pedido',
      data_inicial: dataInicialBr,
      data_final: dataFinalBr,
      posicao: POSICAO_VENDA_CONFIRMADA,
      offset,
      limit: ATON_LIMIT,
    }),
  })
  if (!resposta.ok) throw new Error(`Aton ERP respondeu ${resposta.status}`)
  return resposta.json()
}

// A API da Aton é instável em chamadas longas (ISAPI legado) — de vez em
// quando uma página no meio de uma sequência falha com erro passageiro.
// Tenta de novo algumas vezes antes de desistir só daquela página (nunca
// derruba o total inteiro por causa de 1 página ruim entre 50+).
const MAX_TENTATIVAS_PAGINA = 3

async function buscarPaginaComRetry(
  token: string,
  dataInicialBr: string,
  dataFinalBr: string,
  offset: number
): Promise<AtonRespostaPedidos | null> {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_PAGINA; tentativa++) {
    try {
      return await buscarPaginaPedidos(token, dataInicialBr, dataFinalBr, offset)
    } catch (err) {
      if (tentativa === MAX_TENTATIVAS_PAGINA) {
        console.error(`[atonErp] desistindo da página ${offset} após ${MAX_TENTATIVAS_PAGINA} tentativas:`, err)
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * tentativa))
    }
  }
  return null
}

// Busca páginas em lotes concorrentes (não uma de cada vez) — em dias de
// bastante volume (Compretec passa de 2000 pedidos/mês, 50+ páginas de 50),
// buscar sequencialmente levava mais de 1 minuto, tempo demais pra um
// painel que atualiza a cada 30s.
const CONCORRENCIA_PAGINAS = 5

async function buscarVendasAton(token: string, dataInicialIso: string, dataFinalIso: string): Promise<{ quantidade: number; valor: number }> {
  const dataInicialBr = paraFormatoBr(dataInicialIso)
  const dataFinalBr = paraFormatoBr(dataFinalIso)

  let quantidade = 0
  let valor = 0
  function somarPagina(pagina: AtonRespostaPedidos | null) {
    for (const pedido of pagina?.resultado?.pedidos ?? []) {
      if (pedido.status !== STATUS_VENDA_VALIDA) continue
      quantidade++
      valor += pedido.total_pedido ?? 0
    }
  }

  const primeira = await buscarPaginaComRetry(token, dataInicialBr, dataFinalBr, 1)
  if (!primeira) throw new Error('Aton ERP indisponível (falhou já na primeira página)')
  somarPagina(primeira)

  const total = primeira.resultado?.total ?? 0
  const totalPaginas = Math.ceil(total / ATON_LIMIT)

  for (let inicioLote = 2; inicioLote <= totalPaginas; inicioLote += CONCORRENCIA_PAGINAS) {
    const offsetsDoLote = Array.from({ length: Math.min(CONCORRENCIA_PAGINAS, totalPaginas - inicioLote + 1) }, (_, i) => inicioLote + i)
    const paginas = await Promise.all(offsetsDoLote.map((offset) => buscarPaginaComRetry(token, dataInicialBr, dataFinalBr, offset)))
    paginas.forEach(somarPagina)
  }

  return { quantidade, valor }
}

// Cache curto em memória — o Painel Financeiro reconsulta a cada 30s
// (client/src/pages/PainelFinanceiro.tsx), e não faz sentido bater na API
// externa nessa frequência. 5min de folga é imperceptível numa TV de
// acompanhamento, e se a Aton estiver fora do ar a última leitura boa
// continua servindo em vez de zerar o card.
type CacheEntry = { expiraEm: number; dados: { quantidade: number; valor: number } }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000

export async function buscarVendasAtonComCache(
  token: string,
  dataInicialIso: string,
  dataFinalIso: string
): Promise<{ quantidade: number; valor: number } | null> {
  const chave = `${token}:${dataInicialIso}:${dataFinalIso}`
  const emCache = cache.get(chave)
  if (emCache && emCache.expiraEm > Date.now()) return emCache.dados

  try {
    const dados = await buscarVendasAton(token, dataInicialIso, dataFinalIso)
    cache.set(chave, { expiraEm: Date.now() + CACHE_TTL_MS, dados })
    return dados
  } catch (err) {
    console.error('[atonErp] falha ao buscar vendas:', err)
    return emCache?.dados ?? null
  }
}
