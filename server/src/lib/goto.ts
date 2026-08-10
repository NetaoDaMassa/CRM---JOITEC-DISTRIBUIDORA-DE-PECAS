import WebSocket from 'ws'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, funilMensal, registroContato, empresas } from '../db/schema.js'
import { getConfigTexto, getConfigNumero, setConfig, apagarConfig } from './configuracoes.js'
import { mesReferenciaAtual, agoraSqlite } from './dataBr.js'

let empresaJoitecIdCache: number | null = null
async function obterEmpresaJoitecId(): Promise<number> {
  if (empresaJoitecIdCache) return empresaJoitecIdCache
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'joitec') })
  if (!empresa) throw new Error('Empresa Joitec não encontrada — GoTo Connect precisa dela pra casar telefone com cliente.')
  empresaJoitecIdCache = empresa.id
  return empresa.id
}

const TOKEN_URL = 'https://authentication.logmeininc.com/oauth/token'
const AUTHORIZE_URL = 'https://authentication.logmeininc.com/oauth/authorize'
const ME_URL = 'https://api.goto.com/users/v1/me'
const CHANNEL_URL = 'https://webrtc.jive.com/notification-channel/v1/channels/joitec-crm-canal'
const SUBSCRIPTIONS_URL = 'https://api.goto.com/call-events/v1/subscriptions'

// O canal de notificação expira em 1200s (20min) e a API não documenta um
// endpoint de renovação — a estratégia é recriar tudo (canal + assinatura +
// WebSocket) periodicamente, um pouco antes de expirar, em vez de tentar
// prorrogar o mesmo canal.
const RENOVAR_CANAL_MS = 18 * 60 * 1000

let wsAtual: WebSocket | null = null
let timerRenovacao: NodeJS.Timeout | null = null
let callIdsProcessados = new Set<string>()

// A API de eventos da GoTo não manda a duração da chamada pronta — só os
// eventos STARTING/ENDING. Pra filtrar ligação curta (não atendida, caiu na
// hora) sem contar como tentativa de contato, a duração é medida aqui mesmo:
// guarda o instante do STARTING e compara com o ENDING do mesmo callId.
const callStartTimes = new Map<string, number>()

// Segunda camada de proteção contra duplicata, além do dedup por callId
// acima: durante instabilidade de rede (canal reconectando repetidamente em
// sequência), a GoTo às vezes reenvia o estado da mesma ligação com um
// state.id novo a cada reconexão — o dedup por callId não pega porque o id
// realmente é diferente a cada vez. Por isso também não registra duas
// ligações automáticas pro mesmo cliente dentro dessa janela de tempo.
const JANELA_DEDUP_MS = 3 * 60 * 1000
const ultimoRegistroPorCliente = new Map<number, number>()

function clientId(): string {
  const id = process.env.GOTO_CLIENT_ID
  if (!id) throw new Error('GOTO_CLIENT_ID não configurado no .env')
  return id
}

function clientSecret(): string {
  const secret = process.env.GOTO_CLIENT_SECRET
  if (!secret) throw new Error('GOTO_CLIENT_SECRET não configurado no .env')
  return secret
}

function redirectUri(): string {
  const uri = process.env.GOTO_REDIRECT_URI
  if (!uri) throw new Error('GOTO_REDIRECT_URI não configurado no .env')
  return uri
}

// Escopos pedidos explicitamente na autorização — antes disso a URL não
// mandava `scope` nenhum, então o que era concedido dependia inteiramente
// da configuração do app no developer.goto.com, sem garantia nenhuma daqui.
// cr.v1.read = ler dados de "click-to-call"/relatórios de chamada;
// call-events.v1.notifications.manage = criar/gerenciar assinatura de
// eventos de chamada (canal WebSocket hoje, webhook de report depois).
const GOTO_SCOPES = 'cr.v1.read call-events.v1.notifications.manage'

export function montarUrlAutorizacao(): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: GOTO_SCOPES,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64')
}

interface TokenResponse {
  access_token: string
  token_type: string
  refresh_token: string
  expires_in: number
  scope: string
  principal: string
}

async function salvarTokens(tokens: TokenResponse): Promise<void> {
  const expiraEm = Date.now() + tokens.expires_in * 1000
  await setConfig('goto_access_token', tokens.access_token)
  // A GoTo nem sempre devolve um refresh_token novo na renovação — só
  // sobrescreve o salvo se vier um de verdade, senão mantém o antigo
  // (senão vira a string "undefined" e quebra a conexão pra sempre).
  if (tokens.refresh_token) {
    await setConfig('goto_refresh_token', tokens.refresh_token)
  }
  await setConfig('goto_expira_em', String(expiraEm))
  await setConfig('goto_email', tokens.principal)
  // Antes esse campo vinha na resposta e era descartado — sem isso não
  // tinha como confirmar, sem ir no painel da GoTo, se os escopos pedidos
  // em GOTO_SCOPES foram realmente concedidos.
  await setConfig('goto_scope', tokens.scope ?? '')
  console.log(`[goto] token salvo — scope concedido: "${tokens.scope ?? '(vazio)'}"`)
}

// Primeira troca do código de autorização (callback do OAuth) por
// access_token + refresh_token — depois disso o refresh_token mantém a
// conexão viva por ~30 dias, sendo rotacionado a cada uso.
export async function trocarCodigoPorToken(code: string): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() }),
  })
  if (!res.ok) throw new Error(`Falha ao trocar código por token: ${res.status} ${await res.text()}`)
  const tokens = (await res.json()) as TokenResponse
  await salvarTokens(tokens)

  const accountKey = await buscarAccountKey(tokens.access_token)
  await setConfig('goto_account_key', accountKey)
}

async function renovarAccessToken(): Promise<string> {
  const refreshToken = await getConfigTexto('goto_refresh_token')
  if (!refreshToken) throw new Error('Sem refresh_token salvo — reconecte a conta GoTo.')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!res.ok) throw new Error(`Falha ao renovar token: ${res.status} ${await res.text()}`)
  const tokens = (await res.json()) as TokenResponse
  await salvarTokens(tokens)
  return tokens.access_token
}

// access_token dura 3600s — pede um novo com uns 5min de folga antes de
// vencer, pra nunca fazer uma chamada com token expirado no meio.
export async function obterAccessTokenValido(): Promise<string> {
  const expiraEmStr = await getConfigTexto('goto_expira_em')
  const accessToken = await getConfigTexto('goto_access_token')
  const expiraEm = expiraEmStr ? Number(expiraEmStr) : 0

  if (accessToken && Date.now() < expiraEm - 5 * 60 * 1000) return accessToken
  return renovarAccessToken()
}

async function buscarAccountKey(accessToken: string): Promise<string> {
  const res = await fetch(ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Falha ao buscar accountKey: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { items: { accountKey: string }[] }
  const accountKey = data.items[0]?.accountKey
  if (!accountKey) throw new Error('Resposta de users/v1/me não trouxe accountKey')
  return accountKey
}

export async function statusConexao(): Promise<{ conectado: boolean; email: string | null }> {
  const email = await getConfigTexto('goto_email')
  const refreshToken = await getConfigTexto('goto_refresh_token')
  return { conectado: !!refreshToken, email }
}

export async function desconectar(): Promise<void> {
  pararListener()
  for (const chave of ['goto_access_token', 'goto_refresh_token', 'goto_expira_em', 'goto_email', 'goto_account_key']) {
    await apagarConfig(chave)
  }
}

interface CanalResponse {
  channelId: string
  channelData: { channelURL: string }
}

async function criarCanal(accessToken: string): Promise<CanalResponse> {
  const res = await fetch(CHANNEL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationTag: 'joitec-crm', channelType: 'WebSockets' }),
  })
  if (!res.ok) throw new Error(`Falha ao criar canal de notificação: ${res.status} ${await res.text()}`)
  return res.json() as Promise<CanalResponse>
}

async function assinarEventosDeChamada(accessToken: string, channelId: string, accountKey: string): Promise<void> {
  const res = await fetch(SUBSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ channelId, accountKeys: [{ id: accountKey, events: ['STARTING', 'ENDING'] }] }),
  })
  // A API retorna 207 Multi-Status mesmo em sucesso.
  if (!res.ok && res.status !== 207) {
    throw new Error(`Falha ao assinar eventos de chamada: ${res.status} ${await res.text()}`)
  }
}

interface ParticipanteEvento {
  type?: { value?: string; number?: string; name?: string; callee?: { name?: string; number?: string } }
}

interface ConteudoChamada {
  metadata?: { direction?: string; accountKey?: string; dialString?: string }
  state?: { id?: string; type?: string; participants?: ParticipanteEvento[] }
}

// A mensagem real do websocket vem num envelope bem mais aninhado do que o
// exemplo simplificado da documentação — o evento de chamada de verdade fica
// em `data.content`, não solto na raiz.
interface EnvelopeGoTo {
  data?: { source?: string; type?: string; content?: ConteudoChamada }
}

// O `number` de um participante PHONE_NUMBER é o número de tronco/saída da
// operadora, não o do cliente — o número de quem realmente está do outro
// lado da ligação vem em `callee.number`. E pra ligações que terminam rápido
// o estado final às vezes nem inclui mais o participante PHONE_NUMBER, só o
// LINE interno — por isso `metadata.dialString` (o número discado) é a
// fonte mais confiável e é sempre checado primeiro.
function extrairNumeroExterno(conteudo: ConteudoChamada): string | null {
  if (conteudo.metadata?.dialString) return conteudo.metadata.dialString

  const participantes = conteudo.state?.participants ?? []
  for (const p of participantes) {
    if (p.type?.value !== 'PHONE_NUMBER') continue
    if (p.type.callee?.number) return p.type.callee.number
    if (p.type.number) return p.type.number
  }
  return null
}

function soDigitos(v: string): string {
  return v.replace(/\D/g, '')
}

// Casa o número da GoTo com o telefone salvo do cliente comparando os
// últimos 8 dígitos — a planilha importada nem sempre tem o DDI/DDD
// completo, então uma comparação exata falharia com frequência.
async function registrarLigacaoAutomatica(numeroExterno: string, callId: string, duracaoMs: number | null): Promise<void> {
  if (callIdsProcessados.has(callId)) return
  callIdsProcessados.add(callId)

  // A API da GoTo não diz se a ligação foi atendida por uma pessoa ou caiu
  // na caixa postal — só dá pra medir a duração. Isso já causou o problema
  // de caixa postal (que costuma durar mais que a saudação + recado) sendo
  // contada como "ligação efetiva" só por ter passado dos 15s. Duração
  // curta continua um sinal confiável de "não atendeu" (auto-resolvida, sem
  // precisar o vendedor confirmar); duração longa (ou não medida) vira
  // sempre pendente — só conta como efetiva quando o vendedor confirma
  // "Respondeu" no card, porque só ele sabe se falou com o cliente de
  // verdade ou ouviu a gravação da caixa postal.
  const duracaoMinimaMs = (await getConfigNumero('goto_duracao_minima_segundos', 15)) * 1000
  const provavelmenteNaoAtendida = duracaoMs !== null && duracaoMs < duracaoMinimaMs
  const efetiva = false
  const resultadoAuto = provavelmenteNaoAtendida ? ('nao_respondeu' as const) : undefined

  const digitos = soDigitos(numeroExterno)

  // Comparar só os últimos 8 dígitos (sem DDD) já causou uma ligação
  // registrada no cliente ERRADO na prática: dois clientes com DDDs
  // diferentes (ex: 47 e 18) podem ter o mesmo final de 8 dígitos por
  // coincidência, e o `.find()` pegava o primeiro que batesse, às cegas.
  // Agora exige pelo menos 10 dígitos em comum (DDD + número) — se o
  // telefone salvo do cliente ainda não tem DDD completo, ele simplesmente
  // não entra na comparação (mais seguro não casar do que casar errado).
  if (digitos.length < 10) {
    console.log(`[goto] número da chamada com menos de 10 dígitos ("${digitos}") — não dá pra casar com segurança, ignorando`)
    return
  }
  const sufixo11 = digitos.length >= 11 ? digitos.slice(-11) : null
  const sufixo10 = digitos.slice(-10)
  console.log(`[goto] evento de chamada recebido — número bruto "${numeroExterno}", comparando pelos últimos 10-11 dígitos ("${sufixo10}")`)

  function numeroBate(numeroCliente: string): boolean {
    const d = soDigitos(numeroCliente)
    if (d.length < 10) return false // telefone do cliente ainda incompleto — não arrisca casar
    if (sufixo11 && d.length >= 11 && d.slice(-11) === sufixo11) return true
    return d.slice(-10) === sufixo10
  }

  // A integração GoTo Connect é o telefone físico da Joitec — não virou
  // multi-empresa (só ela tem esse número/contrato), então o casamento de
  // ligação sempre busca só nos clientes da empresa Joitec.
  const empresaJoitecId = await obterEmpresaJoitecId()
  const todosClientes = await db.query.clientes.findMany({
    where: and(isNull(clientes.deletedAt), eq(clientes.empresaId, empresaJoitecId)),
    columns: { id: true, telefoneWhatsapp: true, vendedorAtualId: true },
    with: { telefonesExtras: { columns: { numero: true } } },
  })
  const clientesQueBatem = todosClientes.filter(
    (c) => (c.telefoneWhatsapp && numeroBate(c.telefoneWhatsapp)) || c.telefonesExtras.some((t) => numeroBate(t.numero))
  )
  if (clientesQueBatem.length === 0) {
    console.log(`[goto] nenhum cliente da Joitec com telefone batendo com "${sufixo10}" — ligação não registrada`)
    return
  }
  if (clientesQueBatem.length > 1) {
    console.log(
      `[goto] AMBÍGUO: ${clientesQueBatem.length} clientes com telefone batendo com "${sufixo10}" (ids: ${clientesQueBatem.map((c) => c.id).join(', ')}) — não registra pra não arriscar atribuir errado`
    )
    return
  }
  const cliente = clientesQueBatem[0]
  if (!cliente.vendedorAtualId) {
    console.log(`[goto] cliente ${cliente.id} encontrado pelo telefone, mas sem vendedor atribuído — ligação não registrada`)
    return
  }

  const agora = Date.now()
  const ultimoRegistro = ultimoRegistroPorCliente.get(cliente.id)
  if (ultimoRegistro !== undefined && agora - ultimoRegistro < JANELA_DEDUP_MS) {
    console.log(`[goto] ligação duplicada pro cliente ${cliente.id} ignorada (dentro da janela de dedup)`)
    return
  }
  ultimoRegistroPorCliente.set(cliente.id, agora)

  const funil = await db.query.funilMensal.findFirst({
    where: and(eq(funilMensal.clienteId, cliente.id), eq(funilMensal.mesReferencia, mesReferenciaAtual()), isNull(funilMensal.deletedAt)),
  })
  if (!funil) return

  const duracaoTexto = duracaoMs !== null ? ` (duração: ${Math.round(duracaoMs / 1000)}s)` : ''
  await db.insert(registroContato).values({
    funilMensalId: funil.id,
    vendedorId: funil.vendedorId,
    tipo: 'ligacao',
    duracaoSegundos: duracaoMs !== null ? Math.round(duracaoMs / 1000) : null,
    efetiva,
    resultado: resultadoAuto,
    observacao: provavelmenteNaoAtendida
      ? `Ligação muito curta — provavelmente não atendida.${duracaoTexto}`
      : `Ligação captada automaticamente pela integração GoTo Connect — confirme se você conversou com o cliente ou se caiu na caixa postal.${duracaoTexto}`,
  })
  await db
    .update(funilMensal)
    .set({ qtdTentativasContato: funil.qtdTentativasContato + 1, dataUltimoContato: agoraSqlite() })
    .where(eq(funilMensal.id, funil.id))

  console.log(`[goto] ligação registrada automaticamente pro cliente ${cliente.id}`)
}

// Extraída à parte (em vez de inline no handler do WebSocket) pra poder ser
// testada diretamente com um payload fake, sem precisar de uma ligação real
// ou de mockar a conexão websocket inteira.
export function processarEventoRecebido(raw: string): void {
  try {
    const envelope = JSON.parse(raw) as EnvelopeGoTo
    const conteudo = envelope.data?.content
    const callId = conteudo?.state?.id
    if (!conteudo || !callId) {
      console.log('[goto] evento recebido sem conteúdo/callId reconhecível:', raw.slice(0, 500))
      return
    }

    if (conteudo.state?.type === 'STARTING') {
      console.log(`[goto] STARTING recebido (callId ${callId})`)
      callStartTimes.set(callId, Date.now())
      return
    }
    if (conteudo.state?.type !== 'ENDING') {
      console.log(`[goto] evento de tipo "${conteudo.state?.type}" ignorado (só trata STARTING/ENDING)`)
      return
    }

    // Sem STARTING correspondente (ex: reconexão do canal no meio da
    // ligação) não dá pra medir duração — nesse caso registra mesmo assim,
    // pra não arriscar perder uma ligação de verdade por causa disso.
    const inicio = callStartTimes.get(callId)
    callStartTimes.delete(callId)
    const duracaoMs = inicio !== undefined ? Date.now() - inicio : null

    const numero = extrairNumeroExterno(conteudo)
    console.log(`[goto] ENDING recebido (callId ${callId}) — número extraído: ${numero ?? 'NENHUM'} — metadata: ${JSON.stringify(conteudo.metadata)}`)
    if (numero) registrarLigacaoAutomatica(numero, callId, duracaoMs).catch((err) => console.error('[goto] erro ao registrar ligação:', err))
    else console.log('[goto] não foi possível extrair o número externo desse evento — ligação não registrada')
  } catch (err) {
    console.error('[goto] erro ao processar evento de chamada:', err)
  }
}

async function conectarWebSocket(channelURL: string): Promise<void> {
  wsAtual?.close()
  const ws = new WebSocket(channelURL)
  wsAtual = ws

  ws.on('open', () => console.log('[goto] websocket de eventos de chamada conectado'))
  ws.on('message', (raw) => processarEventoRecebido(raw.toString()))
  ws.on('error', (err) => console.error('[goto] erro no websocket:', err))
  ws.on('close', () => console.log('[goto] websocket de eventos de chamada desconectado'))
}

async function configurarCanalEAssinatura(): Promise<void> {
  const accessToken = await obterAccessTokenValido()
  const accountKey = await getConfigTexto('goto_account_key')
  if (!accountKey) throw new Error('Sem accountKey salvo — reconecte a conta GoTo.')

  const canal = await criarCanal(accessToken)
  await assinarEventosDeChamada(accessToken, canal.channelId, accountKey)
  await conectarWebSocket(canal.channelData.channelURL)
}

export async function iniciarListener(): Promise<void> {
  const { conectado } = await statusConexao()
  if (!conectado) return

  try {
    await configurarCanalEAssinatura()
  } catch (err) {
    console.error('[goto] falha ao iniciar listener de eventos de chamada:', err)
  }

  if (timerRenovacao) clearInterval(timerRenovacao)
  timerRenovacao = setInterval(() => {
    configurarCanalEAssinatura().catch((err) => console.error('[goto] falha ao renovar canal:', err))
  }, RENOVAR_CANAL_MS)
}

export function pararListener(): void {
  if (timerRenovacao) clearInterval(timerRenovacao)
  timerRenovacao = null
  wsAtual?.close()
  wsAtual = null
  callIdsProcessados = new Set()
}
