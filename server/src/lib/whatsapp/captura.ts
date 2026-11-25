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
import { getConfigBool, setConfig } from '../configuracoes.js'
import { extrairMensagem, registrarMensagem } from './capturaLeads.js'

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
    s = { empresaId, sock: null, estado: 'desligada', qr: null, precisaParear: false, numero: null, tentativas: 0, timer: null, iniciando: null, parando: false, ultimoEvento: '', conectadoEm: null, contagem: { recebidas: 0, enviadas: 0, leadsCriados: 0, ignoradas: 0, erros: 0 } }
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
    }
    if (u.connection === 'close') {
      s.sock = null
      const codigo = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
      const erro = u.lastDisconnect?.error as { message?: string; data?: unknown } | undefined
      const detalhe = `${erro?.message || ''} ${erro?.data ? JSON.stringify(erro.data).slice(0, 300) : ''}`.trim()
      if (s.parando) { s.estado = 'desligada'; return }
      if (codigo === DisconnectReason.loggedOut) {
        s.estado = 'desconectado'
        s.precisaParear = true
        log(s, `DESCONECTADO no celular (logout). Precisa ler o QR code de novo na tela WhatsApp → captura. [${detalhe}]`, true)
        limparLogin(s.empresaId)
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
      if (!state.creds.registered) {
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

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    // 'append' = histórico/sincronização; só 'notify' é mensagem nova de verdade.
    if (type !== 'notify') return
    for (const bruta of messages) {
      let m
      try { m = extrairMensagem(bruta) } catch { m = null }
      if (!m) { s.contagem.ignoradas++; continue }
      registrarMensagem(s.empresaId, m)
        .then((r) => {
          if (r.acao === 'duplicada') return
          if (m.deMim) s.contagem.enviadas++
          else s.contagem.recebidas++
          if (r.acao === 'criado') {
            s.contagem.leadsCriados++
            log(s, `lead #${r.leadId} criado (${m.pushName || m.telefone || m.jid})${r.vendorId ? ` → vendedor ${r.vendorId}` : ' sem vendedor (distribuir)'}`)
          } else if (r.acao === 'cliente') {
            console.log(`[wa-captura empresa ${s.empresaId}] mensagem de cliente da carteira #${r.clienteId} (não vira lead)`)
          } else if (r.acao === 'anexada') {
            console.log(`[wa-captura empresa ${s.empresaId}] mensagem ${m.deMim ? 'enviada' : 'recebida'} anexada ao lead #${r.leadId}`)
          }
        })
        .catch((e) => { s.contagem.erros++; log(s, `erro ao gravar mensagem: ${(e as Error).message}`, true) })
    }
  })
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
