// Integração de teste com a API da PABXONE360 (telefonia da Odin Tubos e
// Conexões) — pedido do João pra ver tentativas de ligação x ligações
// efetivas. Só REST + polling (a API não tem webhook, diferente da GoTo
// Connect em goto.ts), autenticação por header "usuario"/"token" fixos por
// conta, não OAuth. Ainda é só teste: os dois ramais cadastrados (201/202)
// são compartilhados entre várias vendedoras, não dá pra atribuir a
// ligação a uma vendedora específica ainda — por isso essa lib só devolve
// um resumo agregado da empresa, sem tentar gravar em registro_contato
// (que exige vendedorId/funilMensalId certos). Quando mais ramais forem
// cadastrados 1-por-pessoa, isso vira a integração de verdade.
const BASE_URL = 'https://pabxone360.com.br/suite/api'

export interface ChamadaPabx {
  chamadaId: string
  dataHora: string
  ramal: string | null
  origem: string
  destino: string
  sipCode: string
  duracaoSegundos: number
  efetiva: boolean
}

function paraDataBr(data: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(data.getDate())}/${pad(data.getMonth() + 1)}/${data.getFullYear()}`
}

function paraHoraBr(data: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(data.getHours())}:${pad(data.getMinutes())}`
}

// "00:01:06" -> 66. Formato sempre HH:MM:SS (sem casas decimais) no campo
// "duracao" — "duracao_real" tem vírgula com milissegundos, não usamos.
function duracaoParaSegundos(duracao: string): number {
  const partes = duracao.split(':').map(Number)
  if (partes.length !== 3 || partes.some(Number.isNaN)) return 0
  const [h, m, s] = partes
  return h * 3600 + m * 60 + s
}

// "odin-202" (ramal de origem OU destino, dependendo se é ligação feita ou
// recebida) -> "202". Ligação em fila sem operador (ex: "DID -> FILA") não
// tem ramal nenhum nos dois campos — não dá pra saber quem atenderia.
function extrairRamal(...campos: string[]): string | null {
  for (const campo of campos) {
    const m = campo.match(/-(\d+)$/)
    if (m) return m[1]
  }
  return null
}

interface CdrBruto {
  chamada_id: string
  data: string
  origem: string
  destino: string
  duracao: string
  sip_code: string
}

async function buscarPagina(
  usuario: string,
  token: string,
  dataInicio: Date,
  dataFim: Date,
  posInicial: number
): Promise<{ dados: CdrBruto[]; total: number }> {
  const params = new URLSearchParams({
    data_inicial: paraDataBr(dataInicio),
    hora_inicial: paraHoraBr(dataInicio),
    data_final: paraDataBr(dataFim),
    hora_final: paraHoraBr(dataFim),
    quantidade: '1000',
    pos_registro_inicial: String(posInicial),
  })
  const resposta = await fetch(`${BASE_URL}/listar_historico_chamada?${params}`, {
    headers: { usuario, token, Accept: 'application/json' },
  })
  if (!resposta.ok) throw new Error(`PABXONE360: falha na API (${resposta.status})`)
  const corpo = await resposta.json()
  if (corpo.http_response_code === 404) return { dados: [], total: 0 }
  if (corpo.http_response_code !== 200) throw new Error(`PABXONE360: ${corpo.mensagem || 'erro desconhecido'}`)
  return { dados: corpo.dados ?? [], total: Number(corpo.qtd_total_resultados ?? 0) }
}

// Período máximo de 2 meses por chamada (limite da própria API) e no
// máximo 1000 resultados por página — pagina com pos_registro_inicial até
// esgotar. Duração mínima pra contar como "efetiva" é a mesma ideia (e
// mesmo padrão de nome de config) já usada em goto.ts pra GoTo Connect.
export async function buscarChamadasPabxone360(
  usuario: string,
  token: string,
  dataInicio: Date,
  dataFim: Date,
  duracaoMinimaSegundos: number
): Promise<ChamadaPabx[]> {
  const todas: CdrBruto[] = []
  let pos = 0
  while (true) {
    const { dados, total } = await buscarPagina(usuario, token, dataInicio, dataFim, pos)
    todas.push(...dados)
    pos += dados.length
    if (dados.length === 0 || pos >= total) break
  }

  return todas.map((c) => {
    const duracaoSegundos = duracaoParaSegundos(c.duracao)
    return {
      chamadaId: c.chamada_id,
      dataHora: c.data,
      ramal: extrairRamal(c.origem, c.destino),
      origem: c.origem,
      destino: c.destino,
      sipCode: c.sip_code,
      duracaoSegundos,
      // SIP 200 = chamada conectada de verdade (487/404/486 etc. são
      // "não atendeu"/"não existe"/"ocupado" — nunca viram conversa real).
      efetiva: c.sip_code === '200' && duracaoSegundos >= duracaoMinimaSegundos,
    }
  })
}
