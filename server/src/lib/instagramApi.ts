// Chamadas à Graph API da Meta pra automação de Instagram — OAuth (Facebook
// Login for Business), private reply em comentário e mensagem direta.
// Pedido do João, 2026-09-21.
//
// IMPORTANTE — não testado contra a API real: escrito seguindo a
// documentação pública da Meta (Graph API v21.0, Instagram Messaging API),
// mas nunca chamado de verdade porque não existe ainda um Meta App/conta de
// teste conectada. Antes de confiar em produção, testar cada chamada com
// uma conta de desenvolvedor/teste (ver checklist que passei fora do
// código). Os pontos mais prováveis de precisar ajuste fino se algo não
// bater: o endpoint exato de envio de DM (`/me/messages` vs
// `/{ig-business-account-id}/messages` — a Meta já mudou isso entre
// versões) e o formato exato do campo `instagram_business_account` na
// resposta de `/me/accounts`.
import crypto from 'crypto'
import { decryptSecret } from './crypto.js'

const GRAPH_VERSION = 'v21.0'
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`

function appId(): string {
  const id = process.env.INSTAGRAM_APP_ID
  if (!id) throw new Error('INSTAGRAM_APP_ID não configurado no .env')
  return id
}

function appSecret(): string {
  const secret = process.env.INSTAGRAM_APP_SECRET
  if (!secret) throw new Error('INSTAGRAM_APP_SECRET não configurado no .env')
  return secret
}

function redirectUri(): string {
  const uri = process.env.INSTAGRAM_REDIRECT_URI
  if (!uri) throw new Error('INSTAGRAM_REDIRECT_URI não configurado no .env')
  return uri
}

// Escopos pedidos pelo João — precisam estar aprovados no App Review da
// Meta pra funcionar com conta de cliente de verdade (ver aviso de
// compliance no router/instagram.ts).
const SCOPES = ['instagram_manage_messages', 'instagram_manage_comments', 'pages_manage_metadata', 'pages_read_engagement', 'pages_show_list'].join(',')

// `state` carrega o empresaId (assinado com o App Secret, formato
// "<empresaId>.<hmac>") pra o callback saber de qual empresa era o pedido
// de conexão sem precisar de sessão/cookie no meio do redirect OAuth.
export function assinarState(empresaId: number): string {
  const hmac = crypto.createHmac('sha256', appSecret()).update(String(empresaId)).digest('hex')
  return `${empresaId}.${hmac}`
}

export function validarState(state: string): number | null {
  const [empresaIdStr, hmacRecebido] = state.split('.')
  if (!empresaIdStr || !hmacRecebido) return null
  const hmacEsperado = crypto.createHmac('sha256', appSecret()).update(empresaIdStr).digest('hex')
  const bufA = Buffer.from(hmacRecebido)
  const bufB = Buffer.from(hmacEsperado)
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) return null
  return Number(empresaIdStr)
}

export function montarUrlAutorizacao(empresaId: number): string {
  const params = new URLSearchParams({
    client_id: appId(),
    redirect_uri: redirectUri(),
    scope: SCOPES,
    response_type: 'code',
    state: assinarState(empresaId),
  })
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`
}

interface ContaInstagramConectada {
  igBusinessAccountId: string
  igPageId: string
  igUsername: string | null
  pageAccessToken: string
}

// Troca o `code` do OAuth por um token de usuário de longa duração, acha a
// primeira Página com conta profissional de Instagram vinculada e devolve o
// token DA PÁGINA (não do usuário) — é esse que assina os envios depois.
// Se o usuário administra mais de uma Página elegível, pega a primeira; não
// tem seletor pro João escolher ainda (fica pra uma v2 se precisar).
export async function trocarCodigoEAcharConta(code: string): Promise<ContaInstagramConectada> {
  const tokenCurtoRes = await fetch(
    `${GRAPH_URL}/oauth/access_token?${new URLSearchParams({
      client_id: appId(),
      redirect_uri: redirectUri(),
      client_secret: appSecret(),
      code,
    })}`
  )
  const tokenCurto = (await tokenCurtoRes.json()) as { access_token?: string; error?: { message: string } }
  if (!tokenCurto.access_token) throw new Error(tokenCurto.error?.message ?? 'Falha ao trocar code por token')

  const tokenLongoRes = await fetch(
    `${GRAPH_URL}/oauth/access_token?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId(),
      client_secret: appSecret(),
      fb_exchange_token: tokenCurto.access_token,
    })}`
  )
  const tokenLongo = (await tokenLongoRes.json()) as { access_token?: string; error?: { message: string } }
  if (!tokenLongo.access_token) throw new Error(tokenLongo.error?.message ?? 'Falha ao gerar token de longa duração')

  const paginasRes = await fetch(`${GRAPH_URL}/me/accounts?access_token=${tokenLongo.access_token}&fields=id,name,access_token,instagram_business_account`)
  const paginas = (await paginasRes.json()) as {
    data?: { id: string; name: string; access_token: string; instagram_business_account?: { id: string } }[]
    error?: { message: string }
  }
  if (!paginas.data) throw new Error(paginas.error?.message ?? 'Falha ao listar Páginas do Facebook')

  const paginaComInstagram = paginas.data.find((p) => p.instagram_business_account?.id)
  if (!paginaComInstagram?.instagram_business_account) {
    throw new Error('Nenhuma Página do Facebook com conta profissional de Instagram vinculada foi encontrada nessa conta')
  }

  const igId = paginaComInstagram.instagram_business_account.id
  const usernameRes = await fetch(`${GRAPH_URL}/${igId}?fields=username&access_token=${paginaComInstagram.access_token}`)
  const usernameJson = (await usernameRes.json()) as { username?: string }

  return {
    igBusinessAccountId: igId,
    igPageId: paginaComInstagram.id,
    igUsername: usernameJson.username ?? null,
    pageAccessToken: paginaComInstagram.access_token,
  }
}

export async function enviarPrivateReply(commentId: string, pageAccessTokenEnc: string, mensagem: string): Promise<void> {
  const token = decryptSecret(pageAccessTokenEnc)
  const res = await fetch(`${GRAPH_URL}/${commentId}/private_replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: mensagem, access_token: token }),
  })
  if (!res.ok) {
    const erro = await res.text()
    throw new Error(`Falha ao enviar private reply: ${erro}`)
  }
}

export async function enviarMensagemDireta(igUserId: string, pageAccessTokenEnc: string, mensagem: string): Promise<void> {
  const token = decryptSecret(pageAccessTokenEnc)
  const res = await fetch(`${GRAPH_URL}/me/messages?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: igUserId }, message: { text: mensagem } }),
  })
  if (!res.ok) {
    const erro = await res.text()
    throw new Error(`Falha ao enviar mensagem direta: ${erro}`)
  }
}
