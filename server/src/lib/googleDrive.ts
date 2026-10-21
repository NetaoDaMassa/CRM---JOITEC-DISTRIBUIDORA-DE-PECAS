// Google Drive de Arquivos/Mídia — conexão OAuth e chamadas à API REST
// (sem o pacote `googleapis`, que é enorme; só fetch). Pedido do João,
// 2026-10-21: o que entra em Arquivos/Mídia vai pro Drive da conta
// joitecpublicidade@gmail.com, pra equipe abrir pelo Drive também.
//
// Credenciais do "cliente OAuth" (tipo Aplicativo da Web) do projeto
// CRM-JOITEC no Google Cloud: GOOGLE_DRIVE_CLIENT_ID / _SECRET /
// _REDIRECT_URI no .env. Escopo drive.file: o CRM só enxerga os arquivos e
// pastas que ele mesmo criou — nunca o resto do Drive da conta.
import crypto from 'crypto'
import fs from 'fs'
import { Readable } from 'stream'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { googleDriveConexao } from '../db/schema.js'

const ESCOPOS = ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'].join(' ')
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
export const MIME_PASTA = 'application/vnd.google-apps.folder'

export function driveConfigurado(): boolean {
  return !!(process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET && process.env.GOOGLE_DRIVE_REDIRECT_URI)
}

function env(nome: string): string {
  const v = process.env[nome]
  if (!v) throw new Error(`${nome} não configurado no .env`)
  return v
}

// ── Token criptografado no banco ──────────────────────────────────────────
// Chave derivada do JWT_SECRET (sempre existe no servidor) — não depende de
// mais uma variável de ambiente só pra isso.
function chave(): Buffer {
  return crypto.createHash('sha256').update(`google-drive:${env('JWT_SECRET')}`).digest()
}
export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv)
  const dado = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), dado].map((b) => b.toString('base64')).join('.')
}
function decifrar(valor: string): string {
  const [iv, tag, dado] = valor.split('.').map((p) => Buffer.from(p, 'base64'))
  const d = crypto.createDecipheriv('aes-256-gcm', chave(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(dado), d.final()]).toString('utf8')
}

// ── OAuth ─────────────────────────────────────────────────────────────────
// `state` = "<userId>.<expira>.<hmac>" — o callback é um redirect do Google,
// sem header de login nosso; isso garante que o pedido saiu do CRM e de
// quem (só superAdmin pede, ver router/googleDrive.ts).
export function assinarState(userId: number): string {
  const corpo = `${userId}.${Date.now() + 15 * 60 * 1000}`
  const hmac = crypto.createHmac('sha256', env('JWT_SECRET')).update(corpo).digest('hex')
  return `${corpo}.${hmac}`
}
export function validarState(state: string): number | null {
  const [userId, expira, hmac] = state.split('.')
  if (!userId || !expira || !hmac || Number(expira) < Date.now()) return null
  const esperado = crypto.createHmac('sha256', env('JWT_SECRET')).update(`${userId}.${expira}`).digest('hex')
  if (hmac.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(esperado))) return null
  return Number(userId)
}

export function urlAutorizacao(userId: number): string {
  const params = new URLSearchParams({
    client_id: env('GOOGLE_DRIVE_CLIENT_ID'),
    redirect_uri: env('GOOGLE_DRIVE_REDIRECT_URI'),
    response_type: 'code',
    scope: ESCOPOS,
    // offline + consent = sempre devolve refresh token (senão, numa
    // reconexão, o Google não manda de novo e a conexão não funcionaria).
    access_type: 'offline',
    prompt: 'consent select_account',
    state: assinarState(userId),
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function trocarCodigo(code: string): Promise<{ refreshToken: string; email: string | null }> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_DRIVE_CLIENT_ID'),
      client_secret: env('GOOGLE_DRIVE_CLIENT_SECRET'),
      redirect_uri: env('GOOGLE_DRIVE_REDIRECT_URI'),
      grant_type: 'authorization_code',
    }),
  })
  const dados = (await resp.json()) as { refresh_token?: string; id_token?: string; error?: string; error_description?: string }
  if (!resp.ok || !dados.refresh_token) throw new Error(`Google recusou a troca do código: ${dados.error_description ?? dados.error ?? resp.status}`)
  // E-mail vem dentro do id_token (JWT assinado pelo Google; aqui só pra
  // mostrar "conectado como", não é usado pra autorizar nada).
  let email: string | null = null
  try {
    email = JSON.parse(Buffer.from(dados.id_token!.split('.')[1], 'base64url').toString()).email ?? null
  } catch {
    email = null
  }
  return { refreshToken: dados.refresh_token, email }
}

export async function revogar(refreshTokenEnc: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decifrar(refreshTokenEnc))}`, { method: 'POST' }).catch(() => {})
}

// Access token dura ~1h — guarda em memória e renova sozinho.
let tokenCache: { token: string; expira: number } | null = null
export function limparTokenCache() {
  tokenCache = null
}
async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expira > Date.now() + 60_000) return tokenCache.token
  const conexao = await db.query.googleDriveConexao.findFirst({ where: eq(googleDriveConexao.id, 1) })
  if (!conexao) throw new Error('Google Drive não conectado')
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_DRIVE_CLIENT_ID'),
      client_secret: env('GOOGLE_DRIVE_CLIENT_SECRET'),
      refresh_token: decifrar(conexao.refreshTokenEnc),
      grant_type: 'refresh_token',
    }),
  })
  const dados = (await resp.json()) as { access_token?: string; expires_in?: number; error?: string }
  if (!resp.ok || !dados.access_token) throw new Error(`Não deu pra renovar o acesso ao Google Drive (${dados.error ?? resp.status}) — reconecte em Configurações`)
  tokenCache = { token: dados.access_token, expira: Date.now() + (dados.expires_in ?? 3600) * 1000 }
  return tokenCache.token
}

async function chamar<T>(url: string, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!resp.ok) throw new Error(`Google Drive ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  return (resp.status === 204 ? {} : await resp.json()) as T
}

// ── Pastas e arquivos ─────────────────────────────────────────────────────
// Nome no Drive não pode ter "'" sem escape em consultas — aqui só usamos
// ids, então o nome vai cru.
export async function criarPasta(nome: string, paiId: string | null): Promise<string> {
  const r = await chamar<{ id: string }>(`${API}/files?fields=id`, {
    method: 'POST',
    body: JSON.stringify({ name: nome, mimeType: MIME_PASTA, ...(paiId ? { parents: [paiId] } : {}) }),
  })
  return r.id
}

// Existe e não está na lixeira? (alguém pode ter apagado à mão no Drive)
export async function existe(id: string): Promise<boolean> {
  try {
    const r = await chamar<{ trashed?: boolean }>(`${API}/files/${id}?fields=id,trashed`)
    return !r.trashed
  } catch (err) {
    if (String(err).includes('Google Drive 404')) return false
    throw err
  }
}

// Ajusta nome, pasta-mãe e (arquivo) bloqueio de download de um item que já
// existe no Drive.
export async function atualizar(id: string, dados: { nome: string; paiId: string; bloquearDownload?: boolean }): Promise<void> {
  const atual = await chamar<{ parents?: string[] }>(`${API}/files/${id}?fields=parents`)
  const params = new URLSearchParams({ fields: 'id' })
  const outrosPais = (atual.parents ?? []).filter((p) => p !== dados.paiId)
  if (!(atual.parents ?? []).includes(dados.paiId)) params.set('addParents', dados.paiId)
  if (outrosPais.length) params.set('removeParents', outrosPais.join(','))
  await chamar(`${API}/files/${id}?${params.toString()}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: dados.nome,
      ...(dados.bloquearDownload !== undefined ? { copyRequiresWriterPermission: dados.bloquearDownload } : {}),
    }),
  })
}

// "Qualquer pessoa com o link pode ver" — vale pra tudo que está dentro.
export async function abrirPraQuemTemLink(id: string): Promise<void> {
  await chamar(`${API}/files/${id}/permissions?fields=id`, {
    method: 'POST',
    body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }),
  })
}

// Upload "resumable" lendo do disco em streaming (arquivos de até 300 MB —
// nunca carrega o arquivo inteiro na memória).
export async function enviarArquivo(caminho: string, dados: { nome: string; paiId: string; mime: string | null; bloquearDownload: boolean }): Promise<string> {
  const tamanho = fs.statSync(caminho).size
  const inicio = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(tamanho),
      ...(dados.mime ? { 'X-Upload-Content-Type': dados.mime } : {}),
    },
    body: JSON.stringify({ name: dados.nome, parents: [dados.paiId], copyRequiresWriterPermission: dados.bloquearDownload }),
  })
  const sessao = inicio.headers.get('location')
  if (!inicio.ok || !sessao) throw new Error(`Google Drive ${inicio.status} ao iniciar envio: ${(await inicio.text()).slice(0, 300)}`)
  const resp = await fetch(sessao, {
    method: 'PUT',
    headers: { 'Content-Length': String(tamanho), ...(dados.mime ? { 'Content-Type': dados.mime } : {}) },
    body: Readable.toWeb(fs.createReadStream(caminho)) as ReadableStream,
    duplex: 'half',
  } as RequestInit)
  if (!resp.ok) throw new Error(`Google Drive ${resp.status} ao enviar: ${(await resp.text()).slice(0, 300)}`)
  return ((await resp.json()) as { id: string }).id
}

export const linkPasta = (id: string) => `https://drive.google.com/drive/folders/${id}`
export const linkArquivo = (id: string) => `https://drive.google.com/file/d/${id}/view`
