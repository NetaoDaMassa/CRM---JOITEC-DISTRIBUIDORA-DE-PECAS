import WebSocket from 'ws'
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, gotoLigacoesProcessadas, gotoLogIntegracao, gotoRamais, pabxLigacoesProcessadas } from '../db/schema.js'
import { getConfigTexto, getConfigNumero, setConfig, apagarConfig } from './configuracoes.js'
import { agoraSqlite } from './dataBr.js'
import { registrarChamadasNoCrm, type ChamadaPabx } from './pabxone360.js'

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
// recording.v1.read (2026-11-05) = baixar a gravação pra ouvir no CRM;
// calls.v2.initiate fica pedido já pro botão Ligar (próxima etapa).
const GOTO_SCOPES = 'cr.v1.read call-events.v1.notifications.manage users.v1.read recording.v1.read calls.v2.initiate'

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

export async function statusConexao(): Promise<{ conectado: boolean; email: string | null; gravacoes: boolean }> {
  const email = await getConfigTexto('goto_email')
  const refreshToken = await getConfigTexto('goto_refresh_token')
  const escopo = (await getConfigTexto('goto_scope')) ?? ''
  return { conectado: !!refreshToken, email, gravacoes: escopo.includes('recording.v1.read') }
}

// Áudio de uma gravação da GoTo (recording.v1.read). Dois passos (spec
// oficial, confirmado em produção 2026-11-05): GET /content devolve um
// ticket curto {token: {token, expires}}; GET /content/{ticket} (com o
// login) redireciona (302) pro arquivo — MP3.
export async function baixarGravacaoGoto(recordingId: string): Promise<{ audio: Buffer; tipo: string }> {
  const accessToken = await obterAccessTokenValido()
  const base = `https://api.goto.com/recording/v1/recordings/${encodeURIComponent(recordingId)}/content`
  const r = await fetch(base, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) })
  if (r.status === 403) throw new Error('A GoTo não liberou as gravações — reconecte a GoTo em Configurações (permissão de gravações)')
  if (r.status === 400 || r.status === 404) throw new Error('Gravação ainda não disponível na GoTo — tente em alguns minutos')
  if (!r.ok) throw new Error(`GoTo não devolveu a gravação (${r.status})`)
  const corpo = (await r.json()) as { token?: { token?: string } | string }
  const ticket = typeof corpo.token === 'string' ? corpo.token : corpo.token?.token
  if (!ticket) throw new Error('GoTo não mandou o acesso à gravação')
  const link = await fetch(`${base}/${encodeURIComponent(ticket)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const destino = link.headers.get('location')
  if (!destino) throw new Error(`GoTo não devolveu o link da gravação (${link.status})`)
  const arq = await fetch(destino, { signal: AbortSignal.timeout(60_000) })
  if (!arq.ok) throw new Error(`Não consegui baixar a gravação (${arq.status})`)
  return { audio: Buffer.from(await arq.arrayBuffer()), tipo: arq.headers.get('content-type') ?? '' }
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

// --- Ligação da GoTo → motor comum da central (pabxone360.ts) ------------
// Desde 2026-11-05 a GoTo usa o mesmo motor da PABXONE360 das Odin: quem
// ligou pelo ramal (goto_ramais), atendida/não atendida sozinha, cliente da
// carteira, lead ou prospect, número em mais de um cadastro, e a ligação vai
// pro relatório "Ligações" e pro card (pabx_ligacoes_processadas, id
// "goto:<conversationSpaceId>"). Antes: registrava sempre no dono do card,
// tudo "aguardando confirmação", sem leads/prospecção.

interface ParticipanteCompleto {
  id?: string
  recordings?: { id: string; startTimestamp?: string }[]
  type?: RelatorioParticipante['type'] & { extensionNumber?: string; name?: string }
}
interface EstadoChamada {
  type?: string
  timestamp?: string
  participants?: { id?: string; status?: { value?: string } }[]
}

const paraSqliteUtc = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 19)

export function relatorioParaChamada(relatorio: RelatorioChamada, segundosAtendida: number): ChamadaPabx {
  const participantes = (relatorio.participants ?? []) as ParticipanteCompleto[]
  const estados = ((relatorio as unknown as { callStates?: EstadoChamada[] }).callStates ?? [])
  const linhas = participantes.filter((p) => p.type?.value === 'LINE')
  const telefone = participantes.find((p) => p.type?.value === 'PHONE_NUMBER')
  // Ramal de quem falou: a linha com gravação (atendeu/ligou de verdade);
  // senão a primeira linha (ligação recebida que tocou em vários ramais).
  const linha = linhas.find((l) => l.recordings?.length) ?? linhas[0]
  // Atendeu = a chamada ficou ACTIVE (o lado externo começa a gravar no
  // atendimento). Tempo de conversa = do atendimento até o fim.
  const ativo = estados.find((e) => e.type === 'ACTIVE')?.timestamp ?? telefone?.recordings?.[0]?.startTimestamp ?? null
  const fim = relatorio.callEnded ?? null
  const total = fim ? Math.max(0, Math.round((new Date(fim).getTime() - new Date(relatorio.callCreated).getTime()) / 1000)) : 0
  const conversa = ativo && fim ? Math.max(0, Math.round((new Date(fim).getTime() - new Date(ativo).getTime()) / 1000)) : 0
  const conectou = !!ativo
  const efetiva = conectou && conversa >= segundosAtendida
  // Gravação: a do ramal (pega a ligação toda); senão a do lado externo.
  const gravacao = linha?.recordings?.[0]?.id ?? telefone?.recordings?.[0]?.id ?? null
  return {
    chamadaId: `goto:${relatorio.conversationSpaceId}`,
    dataHora: relatorio.callCreated,
    dataHoraUtc: paraSqliteUtc(relatorio.callCreated),
    ramal: linha?.type?.extensionNumber ?? null,
    origem: '',
    destino: '',
    sipCode: '',
    duracaoSegundos: conectou ? conversa : total,
    efetiva,
    status: efetiva ? 'atendida' : conectou ? 'curta' : 'nao_atendida',
    linkGravacao: conectou && gravacao ? `goto:${gravacao}` : null,
    resumo: null,
    transcricao: null,
    fonte: 'GoTo',
    numeroExterno: extrairNumeroExternoDoRelatorio(relatorio),
    direcao: relatorio.direction ?? 'OUTBOUND',
  }
}

// Ramal + nome que vieram na ligação: entra na lista de ramais sozinho
// (o admin só escolhe o vendedor).
async function anotarRamais(relatorio: RelatorioChamada): Promise<void> {
  for (const p of (relatorio.participants ?? []) as ParticipanteCompleto[]) {
    const ramal = p.type?.value === 'LINE' ? p.type.extensionNumber : undefined
    if (!ramal) continue
    await db
      .insert(gotoRamais)
      .values({ ramal, nome: p.type?.name ?? null })
      .onConflictDoUpdate({ target: gotoRamais.ramal, set: { nome: p.type?.name ?? null, atualizadoEm: agoraSqlite() } })
  }
}

async function segundosParaAtendida(): Promise<number> {
  const v = await getConfigNumero('goto_duracao_minima_segundos', 15)
  return v > 0 ? v : 15
}

// Idempotência via banco (não em memória): a "reserva" do conversationSpaceId
// é feita com onConflictDoNothing() ANTES de qualquer processamento — se
// rowsAffected vier 0, é porque outra notificação (reconexão do canal,
// reenvio da GoTo) já reservou esse mesmo id antes, então ignora sem
// reprocessar. `reprocessar` = nova tentativa de uma que deu erro.
async function processarRelatorioDeChamada(conversationSpaceId: string, reprocessar = false): Promise<void> {
  if (!reprocessar) {
    const claim = await db.insert(gotoLigacoesProcessadas).values({ conversationSpaceId }).onConflictDoNothing()
    if (claim.rowsAffected === 0) {
      console.log(`[goto] conversationSpaceId ${conversationSpaceId} já processado, ignorando duplicata`)
      return
    }
  }

  try {
    const accessToken = await obterAccessTokenValido()
    const relatorio = await buscarRelatorioChamada(accessToken, conversationSpaceId)
    await anotarRamais(relatorio).catch((e) => console.error('[goto] ramais:', e))
    const chamada = relatorioParaChamada(relatorio, await segundosParaAtendida())
    const ramais = new Map((await db.select().from(gotoRamais)).map((r) => [r.ramal, r.userId]))
    const [resultado] = await registrarChamadasNoCrm([chamada], await obterEmpresaIdsIntegracao(), ramais)

    await db
      .update(gotoLigacoesProcessadas)
      .set({
        direcao: chamada.direcao ?? null,
        numeroExterno: chamada.numeroExterno ?? null,
        duracaoSegundos: chamada.duracaoSegundos,
        clienteId: resultado?.clienteId ?? null,
        registroContatoId: resultado?.registroContatoId ?? null,
        status: 'concluido',
        motivoNaoRegistrado: resultado ? (resultado.motivoNaoRegistrado ?? null) : 'ja_registrada',
        payloadBruto: redigir(relatorio),
        atualizadoEm: agoraSqlite(),
      })
      .where(eq(gotoLigacoesProcessadas.conversationSpaceId, conversationSpaceId))
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err)
    console.error(`[goto] erro ao processar relatório ${conversationSpaceId}:`, mensagem)
    await db
      .update(gotoLigacoesProcessadas)
      .set({ status: 'erro', motivoNaoRegistrado: mensagem, tentativas: sql`${gotoLigacoesProcessadas.tentativas} + 1`, atualizadoEm: agoraSqlite() })
      .where(eq(gotoLigacoesProcessadas.conversationSpaceId, conversationSpaceId))
  }
}

// Ligações da GoTo que entraram antes de guardar a gravação (Etapa 1,
// 2026-11-05): pega o id da gravação do relatório já salvo.
export async function completarGravacoesGoto(): Promise<number> {
  const semLink = await db
    .select({ id: pabxLigacoesProcessadas.id, chamadaId: pabxLigacoesProcessadas.chamadaId })
    .from(pabxLigacoesProcessadas)
    .where(
      and(
        sql`${pabxLigacoesProcessadas.chamadaId} like 'goto:%'`,
        isNull(pabxLigacoesProcessadas.linkGravacao),
        inArray(pabxLigacoesProcessadas.statusChamada, ['atendida', 'curta'])
      )
    )
    .limit(500)
  let n = 0
  for (const l of semLink) {
    const [g] = await db
      .select({ p: gotoLigacoesProcessadas.payloadBruto })
      .from(gotoLigacoesProcessadas)
      .where(eq(gotoLigacoesProcessadas.conversationSpaceId, l.chamadaId.slice(5)))
    const id = g?.p?.match(/"recordings":\[\{"id":"([^"]+)"/)?.[1]
    if (!id) continue
    await db.update(pabxLigacoesProcessadas).set({ linkGravacao: `goto:${id}` }).where(eq(pabxLigacoesProcessadas.id, l.id))
    n++
  }
  return n
}

// Ligação que deu erro ao buscar (rede, relatório ainda não pronto): tenta
// de novo a cada rodada, até 5 vezes, nas últimas 48h (scheduler, 5 min).
export async function reprocessarErrosGoto(): Promise<number> {
  const { conectado } = await statusConexao()
  if (!conectado) return 0
  const limite = new Date(Date.now() - 48 * 3600_000).toISOString().replace('T', ' ').slice(0, 19)
  const comErro = await db
    .select({ id: gotoLigacoesProcessadas.conversationSpaceId })
    .from(gotoLigacoesProcessadas)
    .where(and(eq(gotoLigacoesProcessadas.status, 'erro'), lt(gotoLigacoesProcessadas.tentativas, 5), gte(gotoLigacoesProcessadas.criadoEm, limite)))
    .limit(50)
  for (const c of comErro) await processarRelatorioDeChamada(c.id, true)
  return comErro.length
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
