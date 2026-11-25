// WhatsApp → captura de leads (Fase 1, pedido do João 2026-11-25).
// Recebe as mensagens da sessão de captura (captura.ts) e:
//  - número novo que MANDOU mensagem → cria lead na etapa "Novo", origem
//    "whatsapp", vendedor pela mesma regra de DDD/rodízio dos leads da Meta
//    (findOrCreateLeadFromTrackingDetalhado → getVendorByDDD);
//  - número que já é lead da empresa → só junta a mensagem na conversa
//    (sem duplicar, casando com e sem o 9º dígito);
//  - mensagem que a empresa mandou pelo celular → entra na conversa como
//    "enviada", mas nunca cria lead.
// Só leitura: nada aqui envia mensagem nem marca como lida.
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { leads, leadHistory, leadWhatsappMensagens } from '../../db/schema.js'
import { findOrCreateLeadFromTrackingDetalhado } from '../leadsTrackingService.js'

export type MensagemCapturada = {
  id: string
  jid: string
  deMim: boolean
  pushName: string
  telefone: string | null // só dígitos, com 55 quando é do Brasil
  tipo: string
  texto: string
  enviadaEm: string // ISO
}

// ---------- extrair o que importa da mensagem do Baileys ----------
type Qualquer = Record<string, any>

/** Tira os "envelopes" (mensagem temporária, ver uma vez, documento com legenda...). */
function desembrulhar(m: Qualquer | null | undefined): Qualquer | null {
  let x = m
  for (let i = 0; i < 5 && x; i++) {
    const dentro = x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message || x.viewOnceMessageV2Extension?.message || x.documentWithCaptionMessage?.message
    if (!dentro) break
    x = dentro
  }
  return x || null
}

/** Tipo e texto legível. null = não é conteúdo (reação, edição, protocolo, chave de grupo...). */
export function conteudoDaMensagem(bruta: Qualquer | null | undefined): { tipo: string; texto: string } | null {
  const m = desembrulhar(bruta)
  if (!m) return null
  const leg = (t?: string) => (t ? ` ${String(t).trim()}` : '')
  if (typeof m.conversation === 'string' && m.conversation.trim()) return { tipo: 'texto', texto: m.conversation }
  if (m.extendedTextMessage?.text) return { tipo: 'texto', texto: m.extendedTextMessage.text }
  if (m.imageMessage) return { tipo: 'imagem', texto: `[Imagem]${leg(m.imageMessage.caption)}` }
  if (m.videoMessage) return { tipo: 'video', texto: `[Vídeo]${leg(m.videoMessage.caption)}` }
  if (m.audioMessage) return { tipo: 'audio', texto: m.audioMessage.ptt ? '[Áudio de voz]' : '[Áudio]' }
  if (m.documentMessage) return { tipo: 'documento', texto: `[Documento]${leg(m.documentMessage.fileName || m.documentMessage.title)}${leg(m.documentMessage.caption)}` }
  if (m.stickerMessage) return { tipo: 'figurinha', texto: '[Figurinha]' }
  if (m.locationMessage || m.liveLocationMessage) {
    const l = m.locationMessage || m.liveLocationMessage
    return { tipo: 'localizacao', texto: `[Localização]${leg(l.name)}${leg(l.address)}` }
  }
  if (m.contactMessage) return { tipo: 'contato', texto: `[Contato]${leg(m.contactMessage.displayName)}` }
  if (m.contactsArrayMessage) return { tipo: 'contato', texto: `[Contatos]${leg(m.contactsArrayMessage.displayName)}` }
  if (m.buttonsResponseMessage) return { tipo: 'texto', texto: m.buttonsResponseMessage.selectedDisplayText || '[Resposta de botão]' }
  if (m.listResponseMessage) return { tipo: 'texto', texto: m.listResponseMessage.title || '[Resposta de lista]' }
  if (m.templateButtonReplyMessage) return { tipo: 'texto', texto: m.templateButtonReplyMessage.selectedDisplayText || '[Resposta de botão]' }
  if (m.pollCreationMessage || m.pollCreationMessageV3) return { tipo: 'enquete', texto: `[Enquete]${leg((m.pollCreationMessage || m.pollCreationMessageV3).name)}` }
  // Sem conteúdo para o vendedor: reação, edição, apagada, protocolo, chave de grupo, voto de enquete...
  return null
}

const soDigitos = (s: string) => String(s || '').replace(/\D/g, '')
/** Número de um jid do WhatsApp ("554799990000:12@s.whatsapp.net" → "554799990000"). */
function numeroDoJid(jid?: string | null): string | null {
  if (!jid || !/@s\.whatsapp\.net$/.test(jid)) return null
  return soDigitos(jid.split('@')[0].split(':')[0]) || null
}

/** Converte a mensagem do Baileys no formato da captura. null = ignorar. */
export function extrairMensagem(msg: Qualquer): MensagemCapturada | null {
  const key = msg?.key || {}
  const jid: string = key.remoteJid || ''
  if (!jid || !key.id) return null
  // Grupo, status, lista de transmissão, canal: não é lead.
  if (/@g\.us$|@broadcast$|@newsletter$/.test(jid) || jid === 'status@broadcast') return null
  if (!/@s\.whatsapp\.net$|@lid$/.test(jid)) return null
  const conteudo = conteudoDaMensagem(msg.message)
  if (!conteudo) return null
  // WhatsApp está trocando o número por identificador "@lid": tenta os campos
  // alternativos que trazem o número de verdade.
  const telefone = numeroDoJid(jid) || numeroDoJid(key.senderPn) || numeroDoJid(key.remoteJidAlt) || numeroDoJid(key.participantPn) || numeroDoJid(key.participantAlt)
  const seg = Number(typeof msg.messageTimestamp === 'object' && msg.messageTimestamp ? msg.messageTimestamp.low ?? msg.messageTimestamp.toNumber?.() : msg.messageTimestamp) || Math.floor(Date.now() / 1000)
  return {
    id: String(key.id),
    jid,
    deMim: !!key.fromMe,
    pushName: key.fromMe ? '' : String(msg.pushName || '').trim().slice(0, 80),
    telefone,
    tipo: conteudo.tipo,
    texto: conteudo.texto.slice(0, 4000),
    enviadaEm: new Date(seg * 1000).toISOString(),
  }
}

// ---------- telefone ----------
export type TelefoneBr = { ddd: number; local: string; variantes: string[] }
/** Separa DDD e número local de um número brasileiro (55 + DDD + 8/9 dígitos). null = internacional/inválido. */
export function telefoneBr(digitos: string | null): TelefoneBr | null {
  if (!digitos) return null
  const d = soDigitos(digitos)
  if (!d.startsWith('55') || (d.length !== 12 && d.length !== 13)) return null
  const ddd = Number(d.slice(2, 4))
  if (ddd < 11 || ddd > 99) return null
  let local = d.slice(4)
  // Celular antigo sem o 9 (8 dígitos começando com 6-9): guarda com o 9.
  if (local.length === 8 && /^[6-9]/.test(local)) local = '9' + local
  const sem9 = local.length === 9 && local.startsWith('9') ? local.slice(1) : null
  const variantes = [local, ...(sem9 ? [sem9] : [])]
  return { ddd, local, variantes }
}

// ---------- achar o lead ----------
const telefoneLimpoSql = sql`replace(replace(replace(replace(replace(replace(coalesce(${leads.phone}, ''), '-', ''), ' ', ''), '(', ''), ')', ''), '+', ''), '.', '')`

async function leadPorJid(empresaId: number, jid: string) {
  const r = await db
    .select({ id: leads.id })
    .from(leadWhatsappMensagens)
    .innerJoin(leads, eq(leads.id, leadWhatsappMensagens.leadId))
    .where(and(eq(leadWhatsappMensagens.empresaId, empresaId), eq(leadWhatsappMensagens.jid, jid), isNull(leads.deletedAt)))
    .orderBy(desc(leadWhatsappMensagens.id))
    .limit(1)
  return r[0]?.id ?? null
}

/** Lead da empresa com o mesmo telefone (com/sem 9; com o DDD junto ou separado). */
export async function leadPorTelefone(empresaId: number, tel: TelefoneBr) {
  const comDdd = tel.variantes.map((v) => `${tel.ddd}${v}`)
  const comPais = comDdd.map((v) => `55${v}`)
  const r = await db
    .select({ id: leads.id, ddd: leads.ddd })
    .from(leads)
    .where(and(
      eq(leads.empresaId, empresaId),
      isNull(leads.deletedAt),
      sql`(${telefoneLimpoSql} IN (${sql.join([...comDdd, ...comPais].map((v) => sql`${v}`), sql`, `)})
        OR (${telefoneLimpoSql} IN (${sql.join(tel.variantes.map((v) => sql`${v}`), sql`, `)}) AND (${leads.ddd} = ${tel.ddd} OR ${leads.ddd} IS NULL)))`,
    ))
    .orderBy(desc(leads.id))
    .limit(1)
  return r[0]?.id ?? null
}

// ---------- fila por contato (2 mensagens seguidas não criam 2 leads) ----------
const filas = new Map<string, Promise<unknown>>()
function emFila<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const p = (filas.get(chave) || Promise.resolve()).catch(() => {}).then(fn)
  filas.set(chave, p)
  p.finally(() => { if (filas.get(chave) === p) filas.delete(chave) }).catch(() => {})
  return p
}

export type ResultadoCaptura = { acao: 'duplicada' | 'anexada' | 'criado' | 'sem_lead'; leadId: number | null; vendorId?: number | null }

/** Grava a mensagem e cria/acha o lead. Idempotente pelo id da mensagem. */
export function registrarMensagem(empresaId: number, m: MensagemCapturada): Promise<ResultadoCaptura> {
  return emFila(`${empresaId}:${m.jid}`, () => registrarAgora(empresaId, m))
}

async function registrarAgora(empresaId: number, m: MensagemCapturada): Promise<ResultadoCaptura> {
  const ja = await db.query.leadWhatsappMensagens.findFirst({
    where: and(eq(leadWhatsappMensagens.empresaId, empresaId), eq(leadWhatsappMensagens.waMessageId, m.id)),
    columns: { id: true, leadId: true },
  })
  if (ja) return { acao: 'duplicada', leadId: ja.leadId }

  const tel = telefoneBr(m.telefone)
  let leadId: number | null = (await leadPorJid(empresaId, m.jid)) ?? (tel ? await leadPorTelefone(empresaId, tel) : null)
  let acao: ResultadoCaptura['acao'] = leadId ? 'anexada' : 'sem_lead'
  let vendorId: number | null | undefined

  if (!leadId && !m.deMim) {
    const nome = m.pushName || (tel ? `(${tel.ddd}) ${tel.local}` : m.telefone || 'Contato do WhatsApp')
    const obs = `Primeira mensagem no WhatsApp: "${m.texto.slice(0, 300)}"`
    if (tel) {
      const r = await findOrCreateLeadFromTrackingDetalhado({ empresaId, name: nome, phone: `${tel.ddd}${tel.local}`, source: 'whatsapp', observations: obs })
      leadId = r?.id ?? null
      vendorId = r?.vendorId ?? null
      acao = r?.criado ? 'criado' : 'anexada'
    } else {
      // Número internacional ou escondido (@lid sem número): cria sem vendedor
      // para alguém distribuir na mão.
      const ins = await db.insert(leads).values({
        empresaId,
        name: nome,
        phone: m.telefone,
        ddd: null,
        source: 'whatsapp',
        observations: `${obs}\n${m.telefone ? 'Número internacional' : 'WhatsApp não mostrou o número (contato com identificador oculto)'} — distribuir manualmente.`,
        statusChangedAt: new Date().toISOString(),
      })
      leadId = Number(ins.lastInsertRowid)
      vendorId = null
      acao = 'criado'
      await db.insert(leadHistory).values({ empresaId, leadId, action: 'criado', toStatus: 'novo', details: 'Lead criado pelo WhatsApp sem DDD válido — distribuir manualmente' })
    }
  }

  await db
    .insert(leadWhatsappMensagens)
    .values({
      empresaId,
      leadId,
      waMessageId: m.id,
      jid: m.jid,
      telefone: m.telefone,
      direcao: m.deMim ? 'enviada' : 'recebida',
      tipo: m.tipo,
      texto: m.texto,
      pushName: m.pushName || null,
      enviadaEm: m.enviadaEm,
    })
    .onConflictDoNothing()

  // Mensagens que a empresa mandou antes de o número virar lead: liga agora.
  if (leadId && acao === 'criado') {
    await db.update(leadWhatsappMensagens).set({ leadId }).where(and(eq(leadWhatsappMensagens.empresaId, empresaId), eq(leadWhatsappMensagens.jid, m.jid), isNull(leadWhatsappMensagens.leadId)))
  }
  return { acao, leadId, vendorId }
}

/** Conversa de um lead, em ordem (para a ficha do lead). */
export async function conversaDoLead(empresaId: number, leadId: number) {
  return db
    .select({ id: leadWhatsappMensagens.id, direcao: leadWhatsappMensagens.direcao, tipo: leadWhatsappMensagens.tipo, texto: leadWhatsappMensagens.texto, pushName: leadWhatsappMensagens.pushName, enviadaEm: leadWhatsappMensagens.enviadaEm })
    .from(leadWhatsappMensagens)
    .where(and(eq(leadWhatsappMensagens.empresaId, empresaId), eq(leadWhatsappMensagens.leadId, leadId)))
    .orderBy(leadWhatsappMensagens.enviadaEm, leadWhatsappMensagens.id)
    .limit(1000)
}

