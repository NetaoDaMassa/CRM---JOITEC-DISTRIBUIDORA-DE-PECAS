// Sessão única de WhatsApp via Baileys — primeira integração de envio
// automático do CRM. Hoje só a usa a automação de "aviso de leads novos"
// (ver avisoLeadsNovos.ts). Escopo: Joitec. Se um dia outra empresa precisar
// de uma sessão própria, dá pra parametrizar o diretório por um nome de
// sessão; por ora é uma só.
//
// - Credenciais em disco (useMultiFileAuthState) → no Docker isso é um volume
//   (WA_SESSION_DIR=/app/wa-session), senão o pareamento se perde a cada deploy.
// - Pareamento: na 1ª subida com AVISO_LEADS_ENABLED=true, o QR sai no log.
//   Escaneia UMA vez com o WhatsApp do número que vai enviar. Depois reconecta
//   sozinho.
// - NÃO sobe sozinha no boot: só quando alguém chama ensureStarted() (o
//   scheduler, quando a automação está ligada; ou o script manual, fora de
//   dry run). Assim a máquina de dev não briga pela mesma sessão da VPS.

import fs from 'fs'
import path from 'path'
import pino from 'pino'
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
} from 'baileys'
import qrcode from 'qrcode-terminal'
import { variantesBr } from './telefone.js'

type Estado = 'desconectado' | 'conectando' | 'conectado'

let sock: WASocket | null = null
let estado: Estado = 'desconectado'
let iniciando: Promise<void> | null = null
let reconectarTimer: NodeJS.Timeout | null = null
let precisaParear = false

const logger = pino({ level: 'silent' })

function sessionDir(): string {
  return process.env.WA_SESSION_DIR || path.resolve('wa-session')
}

export function getStatus(): Estado {
  return estado
}

// true = deu logout no celular / credenciais inválidas → precisa escanear o QR
// de novo. A automação usa isso pra avisar o admin com a mensagem certa.
export function precisaPareamento(): boolean {
  return precisaParear
}

export async function ensureStarted(): Promise<void> {
  if (estado === 'conectado' || estado === 'conectando') return
  if (iniciando) return iniciando
  iniciando = iniciar().finally(() => {
    iniciando = null
  })
  return iniciando
}

async function iniciar(): Promise<void> {
  const dir = sessionDir()
  fs.mkdirSync(dir, { recursive: true })

  estado = 'conectando'
  const { state, saveCreds } = await useMultiFileAuthState(dir)

  let version: [number, number, number] | undefined
  try {
    version = (await fetchLatestBaileysVersion()).version
  } catch {
    // sem internet pra checar a versão do WhatsApp Web — o Baileys usa a
    // versão embutida dele. Não é erro fatal.
    version = undefined
  }

  sock = makeWASocket({
    auth: state,
    version,
    logger,
    browser: ['Joitec CRM', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('\n[whatsapp] Escaneie o QR abaixo com o WhatsApp do número que vai ENVIAR os avisos')
      console.log('[whatsapp] (WhatsApp → Aparelhos conectados → Conectar um aparelho):\n')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      estado = 'conectado'
      precisaParear = false
      console.log('[whatsapp] sessão conectada')
    }

    if (connection === 'close') {
      estado = 'desconectado'
      const codigo = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
      if (codigo === DisconnectReason.loggedOut) {
        precisaParear = true
        console.error('[whatsapp] sessão encerrada no celular (logout). Apague a pasta da sessão e pareie o QR de novo.')
        // não reconecta: as credenciais não valem mais
        return
      }
      console.warn(`[whatsapp] conexão caiu (código ${codigo ?? 'desconhecido'}). Tentando reconectar em 15s...`)
      agendarReconexao()
    }
  })
}

function agendarReconexao(): void {
  if (reconectarTimer) return
  reconectarTimer = setTimeout(() => {
    reconectarTimer = null
    ensureStarted().catch((err) => console.error('[whatsapp] falha ao reconectar:', err))
  }, 15_000)
}

// Espera até a sessão conectar (ou estourar o tempo). Retorna se conectou.
export async function aguardarConexao(timeoutMs = 60_000): Promise<boolean> {
  const limite = Date.now() + timeoutMs
  while (Date.now() < limite) {
    if (estado === 'conectado') return true
    if (precisaParear) return false
    await new Promise((r) => setTimeout(r, 1000))
  }
  return estado === 'conectado'
}

// Descobre o JID real do número testando as variantes BR (com e sem o 9).
// Retorna null se nenhuma existir no WhatsApp.
async function resolverJid(numero: string): Promise<string | null> {
  if (!sock) return null
  for (const variante of variantesBr(numero)) {
    try {
      const res = await sock.onWhatsApp(`+${variante}`)
      const achou = res?.find((r) => r.exists)
      if (achou?.jid) return achou.jid
    } catch {
      // tenta a próxima variante
    }
  }
  return null
}

// Envia um texto simples. Lança se a sessão não estiver conectada ou se o
// número não existir no WhatsApp — quem chama trata (a automação registra a
// falha e segue pros outros).
export async function enviarTexto(numero: string, texto: string): Promise<void> {
  if (!sock || estado !== 'conectado') {
    throw new Error('sessão do WhatsApp não está conectada')
  }
  const jid = await resolverJid(numero)
  if (!jid) {
    throw new Error(`número não encontrado no WhatsApp: ${numero}`)
  }
  await sock.sendMessage(jid, { text: texto })
}

// Encerra a sessão de propósito (usado pelo script manual pra o processo
// conseguir sair — o socket aberto segura o Node vivo).
export async function pararSessao(): Promise<void> {
  if (reconectarTimer) {
    clearTimeout(reconectarTimer)
    reconectarTimer = null
  }
  try {
    sock?.end(undefined)
  } catch {
    // ignora
  }
  sock = null
  estado = 'desconectado'
}
