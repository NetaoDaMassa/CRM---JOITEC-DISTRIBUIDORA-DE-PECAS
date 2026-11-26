// WhatsApp → captura de leads (Fase 1, pedido do João 2026-11-25).
// Uma sessão do WhatsApp POR EMPRESA, separada da sessão dos avisos aos
// vendedores (session.ts, que continua igual). Só ESCUTA: não envia nada, não
// marca como lida e não fica "online" (o celular continua notificando).
//
// - Liga/desliga por empresa na tela WhatsApp → captura (configuracoes
//   wa_captura_<empresaId>_ativa), sem deploy.
// - Login salvo em disco: WA_CAPTURA_DIR (padrão: pasta "wa-captura" ao lado do
//   banco, que no Docker já é volume) /empresa-<id>. Sobrevive a restart e deploy.
// - Ao conectar NÃO puxa o histórico antigo: só mensagens novas viram lead.
// - Em dev (DESLIGAR_AGENDADOR=1) ou com WA_CAPTURA_DESLIGADA=1 não sobe
//   sozinha no boot, para o computador não brigar com a sessão da VPS.
import fs from 'fs'
import path from 'path'
import pino from 'pino'
// Baileys 7 só aqui (a sessão dos avisos continua na 6.7): com a 6.7 o WhatsApp
// aceitava o QR e derrubava o aparelho logo depois de conectar (2026-11-25).
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers, type WASocket } from 'baileys7'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { users, notifications } from '../../db/schema.js'
import { getConfigBool, getConfigTexto, setConfig } from '../configuracoes.js'
import { extrairMensagem, registrarMensagem, numeroDoJid, consertarLeadsSemNumero } from './capturaLeads.js'

export type EstadoCaptura = 'desligada' | 'desconectado' | 'conectando' | 'aguardando_qr' | 'conectado'

type Sessao = {
  empresaId: number
  sock: WASocket | null
  estado: EstadoCaptura
  qr: string | null
  precisaParear: boolean
  numero: string | null
  tentativas: number
  timer: NodeJS.Timeout | null
  iniciando: Promise<void> | null
  parando: boolean
  ultimoEvento: string
  conectadoEm: string | null
  caiuEm: string | null // fora do ar desde (null = conectado)
  avisouQueda: boolean
  quedas: { de: string; ate: string | null; motivo: string }[]
  contagem: { recebidas: number; enviadas: number; leadsCriados: number; ignoradas: number; erros: number }
}

const sessoes = new Map<number, Sessao>()
const logger = pino({ level: process.env.WA_CAPTURA_LOG || 'error' })
const chaveAtiva = (empresaId: number) => `wa_captura_${empresaId}_ativa`
const desligadaGeral = () => process.env.WA_CAPTURA_DESLIGADA === '1'

function pastaBase(): string {
  if (process.env.WA_CAPTURA_DIR) return process.env.WA_CAPTURA_DIR
  const url = process.env.DATABASE_URL ?? 'file:./joitec_crm.db'
  const arquivo = url.replace(/^file:/, '')
  return path.join(path.dirname(path.resolve(arquivo)), 'wa-captura')
}
const pastaDa = (empresaId: number) => path.join(pastaBase(), `empresa-${empresaId}`)

function sessao(empresaId: number): Sessao {
  let s = sessoes.get(empresaId)
  if (!s) {
    s = { empresaId, sock: null, estado: 'desligada', qr: null, precisaParear: false, numero: null, tentativas: 0, timer: null, iniciando: null, parando: false, ultimoEvento: '', conectadoEm: null, caiuEm: null, avisouQueda: false, quedas: [], contagem: { recebidas: 0, enviadas: 0, leadsCriados: 0, ignoradas: 0, erros: 0 } }
    sessoes.set(empresaId, s)
  }
  return s
}
const log = (s: Sessao, msg: string, erro = false) => {
  s.ultimoEvento = `${new Date().toISOString()} ${msg}`
  ;(erro ? console.error : console.log)(`[wa-captura empresa ${s.empresaId}] ${msg}`)
}

export async function capturaAtiva(empresaId: number) {
  return getConfigBool(chaveAtiva(empresaId), false)
}

export function statusCaptura(empresaId: number) {
  const s = sessao(empresaId)
  return {
    estado: s.estado,
    qr: s.estado === 'conectado' ? null : s.qr,
    precisaParear: s.precisaParear,
    numero: s.numero,
    conectadoEm: s.conectadoEm,
    caiuEm: s.caiuEm,
    quedas: s.quedas.slice(-5).reverse(),
    ultimoEvento: s.ultimoEvento,
    contagem: s.contagem,
    temLoginSalvo: fs.existsSync(path.join(pastaDa(empresaId), 'creds.json')),
  }
}

/** Liga a sessão (gera QR se ainda não pareou). */
export async function iniciarCaptura(empresaId: number): Promise<void> {
  const s = sessao(empresaId)
  if (s.estado === 'conectado' || s.estado === 'conectando' || s.estado === 'aguardando_qr') return
  if (s.iniciando) return s.iniciando
  s.parando = false
  s.iniciando = abrir(s).finally(() => { s.iniciando = null })
  return s.iniciando
}

async function abrir(s: Sessao): Promise<void> {
  const dir = pastaDa(s.empresaId)
  fs.mkdirSync(dir, { recursive: true })
  s.estado = 'conectando'
  const { state, saveCreds } = await useMultiFileAuthState(dir)
  let version: [number, number, number] | undefined
  try { version = (await fetchLatestBaileysVersion()).version } catch { version = undefined }

  const sock = makeWASocket({
    auth: state,
    version,
    logger,
    // Nome padrão de navegador: com nome inventado o celular removia o aparelho
    // logo depois de conectar ("device_removed", 2026-11-25). Aparece no
    // celular como "Chrome (Ubuntu)".
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false, // celular continua recebendo notificação
    // Aceita a sincronização inicial que o celular manda ao conectar (recusar
    // também pode fazer o celular desistir), mas syncFullHistory=false mantém
    // pequena, e conversa antiga NÃO vira lead: só eventos 'notify' são lidos.
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  })
  s.sock = sock
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (u) => {
    if (s.sock !== sock) return
    if (u.qr) {
      s.qr = u.qr
      s.estado = 'aguardando_qr'
      log(s, 'aguardando leitura do QR code (WhatsApp → Aparelhos conectados)')
    }
    if (u.connection === 'open') {
      s.estado = 'conectado'
      s.qr = null
      s.precisaParear = false
      s.tentativas = 0
      s.conectadoEm = new Date().toISOString()
      s.numero = (sock.user?.id || '').split(':')[0].split('@')[0] || null
      log(s, `conectado (${s.numero || 'número ?'})`)
      const q = s.quedas[s.quedas.length - 1]
      if (q && !q.ate) q.ate = s.conectadoEm
      if (s.caiuEm && s.avisouQueda) void avisarAdmins(s, 'WhatsApp → leads voltou', `A captura do WhatsApp (${s.numero || 'empresa ' + s.empresaId}) voltou a funcionar. Mensagens recebidas enquanto estava fora entram agora.`)
      s.caiuEm = null
      s.avisouQueda = false
      void marcarDesde(s.empresaId)
    }
    if (u.connection === 'close') {
      s.sock = null
      if (!s.parando && !s.caiuEm) {
        s.caiuEm = new Date().toISOString()
        s.quedas.push({ de: s.caiuEm, ate: null, motivo: String((u.lastDisconnect?.error as { message?: string } | undefined)?.message || 'conexão caiu').slice(0, 120) })
        if (s.quedas.length > 20) s.quedas.shift()
      }
      const codigo = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
      const erro = u.lastDisconnect?.error as { message?: string; data?: unknown } | undefined
      const detalhe = `${erro?.message || ''} ${erro?.data ? JSON.stringify(erro.data).slice(0, 300) : ''}`.trim()
      if (s.parando) { s.estado = 'desligada'; return }
      if (codigo === DisconnectReason.loggedOut) {
        s.estado = 'desconectado'
        s.precisaParear = true
        log(s, `DESCONECTADO no celular (logout). Precisa ler o QR code de novo na tela WhatsApp → captura. [${detalhe}]`, true)
        limparLogin(s.empresaId)
        s.avisouQueda = true
        void avisarAdmins(s, 'WhatsApp → leads DESCONECTADO', `O celular desconectou a captura do WhatsApp (${s.numero || 'empresa ' + s.empresaId}). Mensagens novas NÃO estão virando lead. Abra Marketing → WhatsApp → leads e leia o QR code de novo.`)
        return
      }
      s.estado = 'desconectado'
      // Logo depois de ler o QR o WhatsApp pede para reconectar (515): tem que
      // ser NA HORA — se demorar, o celular desiste e desliga o aparelho.
      if (codigo === DisconnectReason.restartRequired) {
        log(s, 'QR lido, reconectando…')
        if (s.timer) { clearTimeout(s.timer); s.timer = null }
        setTimeout(() => iniciarCaptura(s.empresaId).catch((e) => log(s, `falha ao reconectar: ${(e as Error).message}`, true)), 300)
        return
      }
      // Ainda não pareado (QR expirou sem ninguém ler): não fica tentando
      // sozinho; a tela gera um QR novo quando clicar em "Mostrar QR".
      // Pareado pelo QR o Baileys deixa creds.registered=false; quem diz se já
      // pareou é creds.me. (Antes só olhava registered e, quando a conexão caía,
      // achava que era "QR expirou" e NÃO reconectava — ficou fora 3h49→9h30 em 26/11.)
      if (!state.creds.registered && !state.creds.me?.id) {
        s.qr = null
        log(s, 'QR expirou sem ser lido. Clique em "Mostrar QR" para gerar outro.')
        return
      }
      const espera = Math.min(300_000, 5_000 * 2 ** Math.min(s.tentativas, 6))
      s.tentativas++
      log(s, `conexão caiu (código ${codigo ?? '?'} ${detalhe}). Tentando de novo em ${Math.round(espera / 1000)}s`, true)
      if (s.timer) clearTimeout(s.timer)
      s.timer = setTimeout(() => { s.timer = null; iniciarCaptura(s.empresaId).catch((e) => log(s, `falha ao reconectar: ${(e as Error).message}`, true)) }, espera)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // 'notify' = mensagem nova. 'append' = mensagem que chegou enquanto a
    // captura estava fora do ar (o WhatsApp entrega quando reconecta) — antes
    // era descartada e o lead se perdia. Só aceita 'append' de depois que a
    // captura foi ligada e dos últimos 3 dias (conversa antiga não vira lead;
    // repetida não duplica: o id da mensagem é único).
    const desde = type === 'append' ? await desdeQuando(s.empresaId) : 0
    for (const bruta of messages) {
      let m
      try { m = extrairMensagem(bruta) } catch { m = null }
      if (!m) {
        s.contagem.ignoradas++
        const k = (bruta as { key?: { remoteJid?: string } })?.key
        if (k?.remoteJid && !/@g\.us$|@broadcast$|@newsletter$/.test(k.remoteJid)) {
          const b = bruta as { messageStubType?: number; message?: Record<string, unknown> | null }
          console.log(`[wa-captura empresa ${s.empresaId}] ignorada (${type}) ${k.remoteJid} stub=${b.messageStubType ?? '-'} campos=${Object.keys(b.message || {}).join(',') || '-'}`)
        }
        continue
      }
      if (type === 'append') {
        const t = Date.parse(m.enviadaEm)
        if (!(t >= desde && t >= Date.now() - 3 * 86_400_000)) continue
      } else if (type !== 'notify') continue
      // WhatsApp escondeu o número (@lid): pergunta ao próprio WhatsApp qual é.
      if (!m.telefone && /@lid$/.test(m.jid)) {
        const pn = await numeroDoLidPara(sock, m.jid)
        if (pn) m = { ...m, telefone: pn }
      }
      const msg = m
      registrarMensagem(s.empresaId, msg)
        .then((r) => {
          if (r.acao === 'duplicada') return
          if (msg.deMim) s.contagem.enviadas++
          else s.contagem.recebidas++
          if (r.acao === 'criado') {
            s.contagem.leadsCriados++
            log(s, `lead #${r.leadId} criado (${msg.pushName || msg.telefone || msg.jid})${r.vendorId ? ` → vendedor ${r.vendorId}` : ' sem vendedor (distribuir)'}`)
          } else if (r.acao === 'cliente') {
            console.log(`[wa-captura empresa ${s.empresaId}] mensagem de cliente da carteira #${r.clienteId} (não vira lead)`)
          } else if (r.acao === 'anexada') {
            console.log(`[wa-captura empresa ${s.empresaId}] mensagem ${msg.deMim ? 'enviada' : 'recebida'} anexada ao lead #${r.leadId}`)
          }
        })
        .catch((e) => { s.contagem.erros++; log(s, `erro ao gravar mensagem: ${(e as Error).message}`, true) })
    }
  })
}

async function numeroDoLidPara(sock: WASocket, jid: string): Promise<string | null> {
  try {
    const pn = await (sock as unknown as { signalRepository?: { lidMapping?: { getPNForLID(l: string): Promise<string | null> } } }).signalRepository?.lidMapping?.getPNForLID(jid)
    return numeroDoJid(pn ? pn.replace(/:\d+@/, '@') : null)
  } catch { return null }
}

const chaveDesde = (empresaId: number) => `wa_captura_${empresaId}_desde`
async function marcarDesde(empresaId: number) {
  try { if (!(await getConfigTexto(chaveDesde(empresaId)))) await setConfig(chaveDesde(empresaId), new Date().toISOString()) } catch { /* ok */ }
}
async function desdeQuando(empresaId: number): Promise<number> {
  const v = await getConfigTexto(chaveDesde(empresaId)).catch(() => null)
  // Sem registro (captura ligada antes desta versão): considera 25/11, quando ela entrou no ar.
  return Date.parse(v || '2026-11-25T00:00:00Z') || 0
}

/** Sininho para os super admins (queda longa / desconectado no celular). */
async function avisarAdmins(s: Sessao, titulo: string, mensagem: string) {
  try {
    const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.superAdmin, true), eq(users.isActive, true)))
    for (const a of admins) await db.insert(notifications).values({ vendedorId: a.id, type: 'whatsapp_captura', title: titulo, message: mensagem })
    log(s, `aviso aos admins: ${titulo}`)
  } catch (e) {
    console.error(`[wa-captura empresa ${s.empresaId}] falha ao avisar admins:`, (e as Error).message)
  }
}

// Vigia a cada 2 min: (1) captura ligada e fora do ar → reconecta (não depende
// do servidor reiniciar); (2) fora do ar há 10+ min → avisa no sininho;
// (3) conserta leads que nasceram sem número quando o número aparecer.
let vigia: NodeJS.Timeout | null = null
function ligarVigia(empresaIds: number[]) {
  if (vigia) return
  vigia = setInterval(async () => {
    for (const id of empresaIds) {
      try {
        if (!(await capturaAtiva(id))) continue
        const s = sessao(id)
        const pareado = fs.existsSync(path.join(pastaDa(id), 'creds.json'))
        if (s.estado === 'desconectado' && pareado && !s.timer && !s.iniciando && !s.precisaParear) {
          log(s, 'vigia: captura fora do ar, reconectando')
          s.estado = 'desligada'
          await iniciarCaptura(id)
        }
        if (s.estado !== 'conectado' && s.caiuEm && !s.avisouQueda && Date.now() - Date.parse(s.caiuEm) > 10 * 60_000) {
          s.avisouQueda = true
          await avisarAdmins(s, 'WhatsApp → leads fora do ar', `A captura do WhatsApp (${s.numero || 'empresa ' + id}) está fora do ar desde ${new Date(s.caiuEm).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}. O CRM está tentando reconectar sozinho; se não voltar, abra Marketing → WhatsApp → leads.`)
        }
        if (s.estado === 'conectado' && s.sock) {
          const sock = s.sock
          await consertarLeadsSemNumero(id, (jid) => numeroDoLidPara(sock, jid))
        }
      } catch (e) {
        console.error(`[wa-captura] vigia empresa ${id}:`, (e as Error).message)
      }
    }
  }, 2 * 60_000)
  vigia.unref?.()
}

function limparLogin(empresaId: number) {
  try {
    const dir = pastaDa(empresaId)
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir)) fs.rmSync(path.join(dir, e), { recursive: true, force: true })
  } catch (e) {
    console.error(`[wa-captura empresa ${empresaId}] falha ao limpar login:`, e)
  }
}

/** Fecha a conexão sem apagar o login (desligar a captura). */
export async function pararCaptura(empresaId: number): Promise<void> {
  const s = sessao(empresaId)
  s.parando = true
  if (s.timer) { clearTimeout(s.timer); s.timer = null }
  try { s.sock?.end(undefined) } catch { /* ok */ }
  s.sock = null
  s.qr = null
  s.estado = 'desligada'
}

/** Sai do WhatsApp e apaga o login (para trocar de número). */
export async function desconectarCaptura(empresaId: number): Promise<void> {
  const s = sessao(empresaId)
  try { await s.sock?.logout() } catch { /* já estava fora */ }
  await pararCaptura(empresaId)
  limparLogin(empresaId)
  s.numero = null
  s.precisaParear = false
  log(s, 'desconectado e login apagado (troca de número)')
}

export async function ligarDesligarCaptura(empresaId: number, ativa: boolean) {
  await setConfig(chaveAtiva(empresaId), ativa ? 1 : 0)
  if (ativa) await iniciarCaptura(empresaId)
  else await pararCaptura(empresaId)
}

/** No boot do servidor: sobe as empresas que estão com a captura ligada. */
export async function iniciarCapturasAtivas(empresaIds: number[]) {
  if (desligadaGeral()) { console.log('[wa-captura] desligada (WA_CAPTURA_DESLIGADA=1)'); return }
  if (process.env.DESLIGAR_AGENDADOR === '1') { console.log('[wa-captura] não sobe sozinha em dev (DESLIGAR_AGENDADOR=1)'); return }
  ligarVigia(empresaIds)
  for (const id of empresaIds) {
    try {
      if (await capturaAtiva(id)) {
        console.log(`[wa-captura] ligando empresa ${id}`)
        await iniciarCaptura(id)
      }
    } catch (e) {
      console.error(`[wa-captura] falha ao ligar empresa ${id}:`, e)
    }
  }
}
