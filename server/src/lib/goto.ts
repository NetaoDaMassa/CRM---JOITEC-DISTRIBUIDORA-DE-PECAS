import WebSocket from 'ws'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, funilMensal, registroContato, empresas, gotoLigacoesProcessadas, gotoLogIntegracao } from '../db/schema.js'
import { getConfigTexto, getConfigNumero, setConfig, apagarConfig } from './configuracoes.js'
import { mesReferenciaAtual, agoraSqlite } from './dataBr.js'

// O telefone físico GoTo Connect atende tanto a Joitec Distribuidora quanto
// a Joitec Automação (mesma linha/recepção) — por isso o casamento de
// ligação busca cliente nas duas. Odin Tubos e Odin Compressores ficam de
// fora por enquanto (linha telefônica separada, sem essa integração).
const SLUGS_EMPRESAS_INTEGRACAO = ['joitec', 'joitec-automacao']

let empresaIdsIntegracaoCache: number[] | null = null
async function obterEmpresaIdsIntegracao(): Promise<number[]> {
  if (empresaIdsIntegracaoCache) return empresaIdsIntegracaoCache
  const linhas = await db.query.empresas.findMany({ where: inArray(empresas.slug, SLUGS_EMPRESAS_INTEGRACAO) })
  if (linhas.length === 0) throw new Error('Nenhuma empresa Joitec encontrada — GoTo Connect precisa delas pra casar telefone com cliente.')
  empresaIdsIntegracaoCache = linhas.map((e) => e.id)
  return empresaIdsIntegracaoCache
}

const TOKEN_URL = 'https://authentication.logmeininc.com/oauth/token'
const AUTHORIZE_URL = 'https://authentication.logmeininc.com/oauth/authorize'
const ME_URL = 'https://api.goto.com/users/v1/me'
const CHANNEL_URL = 'https://webrtc.jive.com/notification-channel/v1/channels/joitec-crm-canal'
// Call Events Report API — substitui a antiga Call Events API (STARTING/ENDING
// em tempo real): assina um evento único REPORT_SUMMARY por chamada, com
// duração, direção e participantes já prontos, buscado sob demanda em
// /reports/{conversationSpaceId} quando a notificação chega pelo canal.
const REPORT_SUBSCRIPTIONS_URL = 'https://api.goto.com/call-events-report/v1/subscriptions'
const REPORT_URL_BASE = 'https://api.goto.com/call-events-report/v1/reports'

// O canal de notificação expira em 1200s (20min) e a API não documenta um
// endpoint de renovação — a estratégia é recriar tudo (canal + assinatura +
// WebSocket) periodicamente, um pouco antes de expirar, em vez de tentar
// prorrogar o mesmo canal.
const RENOVAR_CANAL_MS = 18 * 60 * 1000

let wsAtual: WebSocket | null = null
let timerRenovacao: NodeJS.Timeout | null = null

// Segunda camada de proteção contra duplicata, além da idempotência por
// conversationSpaceId persistida em banco (ver processarRelatorioDeChamada):
// durante instabilidade de rede a GoTo já mandou o mesmo relatório mais de
// uma vez em janelas curtas — por isso também não registra duas ligações
// automáticas pro mesmo cliente dentro dessa janela de tempo.
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
// mandava `scope` nenhum, e nesse caso a GoTo concede TODOS os escopos
// configurados no app (developer.goto.com), sem garantia nenhuma daqui.
// cr.v1.read = ler dados de "click-to-call"/relatórios de chamada;
// call-events.v1.notifications.manage = criar/gerenciar assinatura de
// eventos de chamada (canal WebSocket + Call Events Report API).
//
// users.v1.read foi adicionado depois — sem ele, GET /users/v1/me (usado só
// pra descobrir o accountKey da conta, ver buscarAccountKey) passou a dar
// 403 AUTHZ_INSUFFICIENT_SCOPE assim que paramos de mandar "todos os
// escopos configurados" por omissão. Confirmado em teste real de produção.
const GOTO_SCOPES = 'cr.v1.read call-events.v1.notifications.manage users.v1.read'

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

// --- Log estruturado de integração ---------------------------------------
// Toda chamada HTTP feita à GoTo (sucesso ou erro) e todo payload de webhook
// recebido bruto são gravados em goto_log_integracao — pra dar visibilidade
// real na hora de acompanhar uma ligação de teste, sem depender só de log de
// console (que se perde no restart do container).

const CAMPOS_SECRETOS = ['access_token', 'refresh_token', 'code', 'client_secret']

function redigirObjeto(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(redigirObjeto)
  if (obj && typeof obj === 'object') {
    const copia: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      copia[k] = CAMPOS_SECRETOS.includes(k) ? '[REDACTED]' : redigirObjeto(v)
    }
    return copia
  }
  return obj
}

function redigir(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null
  let texto: string
  if (typeof valor === 'string') {
    texto = valor
    try {
      texto = JSON.stringify(redigirObjeto(JSON.parse(texto)))
    } catch {
      // corpo não é JSON (ex: urlencoded do token endpoint) — redige por regex mesmo assim
      for (const campo of CAMPOS_SECRETOS) {
        texto = texto.replace(new RegExp(`(${campo}=)[^&\\s]+`, 'gi'), '$1[REDACTED]')
      }
    }
  } else {
    texto = JSON.stringify(redigirObjeto(valor))
  }
  return texto.length > 5000 ? texto.slice(0, 5000) + '…(truncado)' : texto
}

async function registrarLogIntegracao(entrada: {
  operacao: string
  metodo?: string
  url?: string
  statusCode?: number
  requestBody?: unknown
  responseBody?: unknown
  sucesso: boolean
  erro?: string
}): Promise<void> {
  try {
    await db.insert(gotoLogIntegracao).values({
      operacao: entrada.operacao,
      metodo: entrada.metodo ?? null,
      url: entrada.url ?? null,
      statusCode: entrada.statusCode ?? null,
      requestBody: redigir(entrada.requestBody),
      responseBody: redigir(entrada.responseBody),
      sucesso: entrada.sucesso,
      erro: entrada.erro ?? null,
    })
  } catch (err) {
    // Log é observabilidade, não pode derrubar o fluxo principal por causa dele.
    console.error('[goto] falha ao gravar log de integração (não interrompe o fluxo):', err)
  }
}

// Wrapper único usado por toda chamada HTTP à API da GoTo — garante que
// nenhuma chamada fica sem log estruturado, em sucesso ou erro.
async function chamarApiGoto(operacao: string, url: string, init: RequestInit): Promise<Response> {
  const metodo = init.method ?? 'GET'
  try {
    const res = await fetch(url, init)
    let responseBody: string | null = null
    try {
      responseBody = await res.clone().text()
    } catch {
      responseBody = null
    }
    await registrarLogIntegracao({
      operacao,
      metodo,
      url,
      statusCode: res.status,
      requestBody: init.body,
      responseBody,
      sucesso: res.ok || res.status === 207,
    })
    return res
  } catch (err) {
    await registrarLogIntegracao({
      operacao,
      metodo,
      url,
      requestBody: init.body,
      sucesso: false,
      erro: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
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
  const res = await chamarApiGoto('trocar_codigo_por_token', TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() }).toString(),
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

  const res = await chamarApiGoto('renovar_access_token', TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
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
  const res = await chamarApiGoto('buscar_account_key', ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
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
  const res = await chamarApiGoto('criar_canal', CHANNEL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationTag: 'joitec-crm', channelType: 'WebSockets' }),
  })
  if (!res.ok) throw new Error(`Falha ao criar canal de notificação: ${res.status} ${await res.text()}`)
  return res.json() as Promise<CanalResponse>
}

async function criarAssinaturaReport(accessToken: string, channelId: string, accountKey: string): Promise<void> {
  const res = await chamarApiGoto('criar_assinatura_report', REPORT_SUBSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ channelId, accountKeys: [accountKey], eventTypes: ['REPORT_SUMMARY'] }),
  })
  // A API retorna 207 Multi-Status mesmo em sucesso (mesmo comportamento da antiga Call Events API).
  if (!res.ok && res.status !== 207) {
    throw new Error(`Falha ao assinar Call Events Report: ${res.status} ${await res.text()}`)
  }
}

async function buscarRelatorioChamada(accessToken: string, conversationSpaceId: string): Promise<RelatorioChamada> {
  const res = await chamarApiGoto('buscar_relatorio_chamada', `${REPORT_URL_BASE}/${conversationSpaceId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Falha ao buscar relatório da chamada ${conversationSpaceId}: ${res.status} ${await res.text()}`)
  return (await res.json()) as RelatorioChamada
}

interface RelatorioParticipante {
  type?: {
    value?: string
    number?: string
    name?: string
    caller?: { name?: string; number?: string }
    callee?: { name?: string; number?: string }
  }
}

interface RelatorioChamada {
  conversationSpaceId: string
  callCreated: string
  callEnded?: string
  direction?: 'INBOUND' | 'OUTBOUND'
  accountKey?: string
  participants?: RelatorioParticipante[]
}

// No relatório, o participante PHONE_NUMBER carrega o número externo dentro
// de `caller` (ligação recebida) ou `callee` (ligação feita pela Joitec) —
// qual dos dois usar é decidido pelo campo `direction` do próprio relatório.
function extrairNumeroExternoDoRelatorio(relatorio: RelatorioChamada): string | null {
  const participantes = relatorio.participants ?? []
  const telefone = participantes.find((p) => p.type?.value === 'PHONE_NUMBER')
  if (!telefone?.type) return null
  if (relatorio.direction === 'OUTBOUND') {
    return telefone.type.callee?.number ?? telefone.type.number ?? null
  }
  return telefone.type.caller?.number ?? telefone.type.number ?? null
}

function soDigitos(v: string): string {
  return v.replace(/\D/g, '')
}

interface ResultadoRegistro {
  clienteId?: number
  registroContatoId?: number
  motivoNaoRegistrado?: string
}

// Casa o número da GoTo com o telefone salvo do cliente comparando os
// últimos 8 dígitos — a planilha importada nem sempre tem o DDI/DDD
// completo, então uma comparação exata falharia com frequência.
//
// NÃO ALTERAR esta lógica de matching (numeroBate) — mantida exatamente como
// estava antes da migração pra Call Events Report API.
async function registrarLigacaoAutomatica(numeroExterno: string, duracaoMs: number | null): Promise<ResultadoRegistro> {
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
    return { motivoNaoRegistrado: 'numero_invalido' }
  }
  const sufixo11 = digitos.length >= 11 ? digitos.slice(-11) : null
  const sufixo10 = digitos.slice(-10)
  console.log(`[goto] relatório de chamada recebido — número bruto "${numeroExterno}", comparando pelos últimos 10-11 dígitos ("${sufixo10}")`)

  function numeroBate(numeroCliente: string): boolean {
    const d = soDigitos(numeroCliente)
    if (d.length < 10) return false // telefone do cliente ainda incompleto — não arrisca casar
    if (sufixo11 && d.length >= 11 && d.slice(-11) === sufixo11) return true
    return d.slice(-10) === sufixo10
  }

  // O telefone físico GoTo Connect atende Joitec Distribuidora e Joitec
  // Automação (mesma linha) — o casamento de ligação busca cliente nas duas
  // empresas, mas nunca em Odin Tubos/Odin Compressores (linha separada).
  const empresaIds = await obterEmpresaIdsIntegracao()
  const todosClientes = await db.query.clientes.findMany({
    where: and(isNull(clientes.deletedAt), inArray(clientes.empresaId, empresaIds)),
    columns: { id: true, telefoneWhatsapp: true, vendedorAtualId: true },
    with: { telefonesExtras: { columns: { numero: true } } },
  })
  const clientesQueBatem = todosClientes.filter(
    (c) => (c.telefoneWhatsapp && numeroBate(c.telefoneWhatsapp)) || c.telefonesExtras.some((t) => numeroBate(t.numero))
  )
  if (clientesQueBatem.length === 0) {
    console.log(`[goto] nenhum cliente da Joitec com telefone batendo com "${sufixo10}" — ligação não registrada`)
    return { motivoNaoRegistrado: 'cliente_nao_encontrado' }
  }
  if (clientesQueBatem.length > 1) {
    console.log(
      `[goto] AMBÍGUO: ${clientesQueBatem.length} clientes com telefone batendo com "${sufixo10}" (ids: ${clientesQueBatem.map((c) => c.id).join(', ')}) — não registra pra não arriscar atribuir errado`
    )
    return { motivoNaoRegistrado: 'numero_ambiguo' }
  }
  const cliente = clientesQueBatem[0]
  if (!cliente.vendedorAtualId) {
    console.log(`[goto] cliente ${cliente.id} encontrado pelo telefone, mas sem vendedor atribuído — ligação não registrada`)
    return { clienteId: cliente.id, motivoNaoRegistrado: 'cliente_sem_vendedor' }
  }

  const agora = Date.now()
  const ultimoRegistro = ultimoRegistroPorCliente.get(cliente.id)
  if (ultimoRegistro !== undefined && agora - ultimoRegistro < JANELA_DEDUP_MS) {
    console.log(`[goto] ligação duplicada pro cliente ${cliente.id} ignorada (dentro da janela de dedup)`)
    return { clienteId: cliente.id, motivoNaoRegistrado: 'duplicada_janela_dedup' }
  }
  ultimoRegistroPorCliente.set(cliente.id, agora)

  const funil = await db.query.funilMensal.findFirst({
    where: and(eq(funilMensal.clienteId, cliente.id), eq(funilMensal.mesReferencia, mesReferenciaAtual()), isNull(funilMensal.deletedAt)),
  })
  if (!funil) return { clienteId: cliente.id, motivoNaoRegistrado: 'sem_funil_mes_atual' }

  const duracaoTexto = duracaoMs !== null ? ` (duração: ${Math.round(duracaoMs / 1000)}s)` : ''
  const [registro] = await db
    .insert(registroContato)
    .values({
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
    .returning({ id: registroContato.id })
  await db
    .update(funilMensal)
    .set({ qtdTentativasContato: funil.qtdTentativasContato + 1, dataUltimoContato: agoraSqlite() })
    .where(eq(funilMensal.id, funil.id))

  console.log(`[goto] ligação registrada automaticamente pro cliente ${cliente.id}`)
  return { clienteId: cliente.id, registroContatoId: registro?.id }
}

// Idempotência via banco (não em memória): a "reserva" do conversationSpaceId
// é feita com onConflictDoNothing() ANTES de qualquer processamento — se
// rowsAffected vier 0, é porque outra notificação (reconexão do canal,
// reenvio da GoTo) já reservou esse mesmo id antes, então ignora sem
// reprocessar. Isso sobrevive a restart do container, ao contrário do Set em
// memória usado antes.
async function processarRelatorioDeChamada(conversationSpaceId: string): Promise<void> {
  const claim = await db.insert(gotoLigacoesProcessadas).values({ conversationSpaceId }).onConflictDoNothing()
  if (claim.rowsAffected === 0) {
    console.log(`[goto] conversationSpaceId ${conversationSpaceId} já processado, ignorando duplicata`)
    return
  }

  try {
    const accessToken = await obterAccessTokenValido()
    const relatorio = await buscarRelatorioChamada(accessToken, conversationSpaceId)
    const numeroExterno = extrairNumeroExternoDoRelatorio(relatorio)
    const duracaoMs =
      relatorio.callEnded && relatorio.callCreated
        ? new Date(relatorio.callEnded).getTime() - new Date(relatorio.callCreated).getTime()
        : null

    if (!numeroExterno) {
      await db
        .update(gotoLigacoesProcessadas)
        .set({
          direcao: relatorio.direction ?? null,
          duracaoSegundos: duracaoMs !== null ? Math.round(duracaoMs / 1000) : null,
          status: 'concluido',
          motivoNaoRegistrado: 'numero_externo_nao_encontrado_no_relatorio',
          payloadBruto: redigir(relatorio),
          atualizadoEm: agoraSqlite(),
        })
        .where(eq(gotoLigacoesProcessadas.conversationSpaceId, conversationSpaceId))
      console.log(`[goto] relatório ${conversationSpaceId} não trouxe número externo, ignorando`)
      return
    }

    const resultado = await registrarLigacaoAutomatica(numeroExterno, duracaoMs)

    await db
      .update(gotoLigacoesProcessadas)
      .set({
        direcao: relatorio.direction ?? null,
        numeroExterno,
        duracaoSegundos: duracaoMs !== null ? Math.round(duracaoMs / 1000) : null,
        clienteId: resultado.clienteId ?? null,
        registroContatoId: resultado.registroContatoId ?? null,
        status: 'concluido',
        motivoNaoRegistrado: resultado.motivoNaoRegistrado ?? null,
        payloadBruto: redigir(relatorio),
        atualizadoEm: agoraSqlite(),
      })
      .where(eq(gotoLigacoesProcessadas.conversationSpaceId, conversationSpaceId))
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err)
    console.error(`[goto] erro ao processar relatório ${conversationSpaceId}:`, err)
    await db
      .update(gotoLigacoesProcessadas)
      .set({ status: 'erro', motivoNaoRegistrado: mensagem, atualizadoEm: agoraSqlite() })
      .where(eq(gotoLigacoesProcessadas.conversationSpaceId, conversationSpaceId))
  }
}

interface EnvelopeNotificacaoGoTo {
  data?: { source?: string; type?: string; content?: { conversationSpaceId?: string } }
}

// Extraída à parte (em vez de inline no handler do WebSocket) pra poder ser
// testada diretamente com um payload fake, sem precisar mockar a conexão
// websocket inteira. Loga o payload bruto ANTES de qualquer parsing —
// mesmo uma notificação que falhe ao processar fica registrada.
export function processarNotificacaoRecebida(raw: string): void {
  registrarLogIntegracao({ operacao: 'notificacao_recebida', responseBody: raw, sucesso: true })

  // Mensagens de controle do próprio canal (não são eventos de chamada) — a
  // recriação completa já é feita pelo timer de renovação, então aqui só loga.
  if (raw === 'WEBSOCKET_REFRESH_REQUIRED' || raw === 'WEBSOCKET_TO_BE_CLOSED') {
    console.log(`[goto] canal sinalizou "${raw}" — recriação completa já agendada pelo timer de renovação`)
    return
  }

  let envelope: EnvelopeNotificacaoGoTo
  try {
    envelope = JSON.parse(raw) as EnvelopeNotificacaoGoTo
  } catch {
    console.log('[goto] mensagem recebida não é JSON válido, ignorando:', raw)
    return
  }

  if (envelope.data?.source !== 'call-events-report') return
  const conversationSpaceId = envelope.data.content?.conversationSpaceId
  if (!conversationSpaceId) {
    console.log('[goto] notificação call-events-report sem conversationSpaceId, ignorando')
    return
  }

  processarRelatorioDeChamada(conversationSpaceId).catch((err) => {
    console.error('[goto] erro não tratado em processarRelatorioDeChamada:', err)
  })
}

async function conectarWebSocket(channelURL: string): Promise<void> {
  wsAtual?.close()
  const ws = new WebSocket(channelURL)
  wsAtual = ws

  ws.on('open', () => console.log('[goto] websocket de eventos de chamada conectado'))
  ws.on('message', (raw) => processarNotificacaoRecebida(raw.toString()))
  ws.on('error', (err) => console.error('[goto] erro no websocket:', err))
  ws.on('close', () => console.log('[goto] websocket de eventos de chamada desconectado'))
}

async function configurarCanalEAssinatura(): Promise<void> {
  const accessToken = await obterAccessTokenValido()
  const accountKey = await getConfigTexto('goto_account_key')
  if (!accountKey) throw new Error('Sem accountKey salvo — reconecte a conta GoTo.')

  const canal = await criarCanal(accessToken)
  await criarAssinaturaReport(accessToken, canal.channelId, accountKey)
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
}
