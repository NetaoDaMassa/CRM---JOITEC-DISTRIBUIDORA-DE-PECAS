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
import { leads, leadHistory, leadWhatsappMensagens, clientes, clienteTelefones, notifications } from '../../db/schema.js'
import { findOrCreateLeadFromTrackingDetalhado, acharLeadPorTelefone } from '../leadsTrackingService.js'
import { getVendorByDDD, getRegionIdByDDD } from '../leadsRoundRobin.js'

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
export const TIPO_ILEGIVEL = 'ilegivel'
export const TEXTO_ILEGIVEL = '[Mensagem que o CRM não conseguiu abrir — veja a conversa no celular]'
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
export function numeroDoJid(jid?: string | null): string | null {
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
  let conteudo = conteudoDaMensagem(msg.message)
  // Mensagem que o WhatsApp entregou mas não deu para abrir (CIPHERTEXT = 2,
  // comum na 1ª mensagem de contato novo): NÃO descarta — o contato vira lead
  // do mesmo jeito e, se o WhatsApp reenviar legível, o texto é trocado depois.
  if (!conteudo && !msg.message && Number(msg.messageStubType) === 2) conteudo = { tipo: TIPO_ILEGIVEL, texto: TEXTO_ILEGIVEL }
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

// ---------- mensagem de formulário da Meta ----------
// Quem preenche o formulário do anúncio e clica para falar no WhatsApp manda um
// texto pronto ("Olá! Preenchi seu formulário... Full name: ... City: ...").
// Lê esses campos para o lead já nascer completo (João, 2026-11-25).
export type DadosFormulario = { nome?: string; cidade?: string; email?: string; cnpj?: string; respostas: Record<string, string> }
export function lerFormularioMeta(texto: string): DadosFormulario | null {
  if (!/preenchi|formul[aá]rio|full name|nome completo/i.test(texto)) return null
  const respostas: Record<string, string> = {}
  for (const linha of texto.split(/\n/)) {
    const m = linha.match(/^\s*([^:]{2,80}?)\s*\??\s*:\s*(.+?)\s*$/)
    if (m) respostas[m[1].replace(/\?$/, '').trim()] = m[2].trim()
  }
  const pega = (re: RegExp) => Object.entries(respostas).find(([k]) => re.test(k))?.[1]
  const cnpj = (texto.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/) || [])[0]?.replace(/\D/g, '')
  const dados: DadosFormulario = {
    nome: pega(/full name|nome completo|^nome$/i),
    cidade: pega(/^city$|cidade/i),
    email: pega(/e-?mail/i),
    cnpj: cnpj && cnpj.length === 14 ? cnpj : undefined,
    respostas,
  }
  return Object.keys(respostas).length >= 2 ? dados : null
}

/** Telefone que a pessoa escreveu na mensagem ("Phone number: +55 12 98124-9925"). Só dígitos com 55. */
export function telefoneNoTexto(texto: string): string | null {
  const m = String(texto || '').match(/(?:phone(?:\s*number)?|telefone|celular|whats\s*app|fone)\s*\??\s*:\s*(\+?[\d\s().-]{10,20})/i)
  if (!m) return null
  let d = soDigitos(m[1])
  if (d.length === 10 || d.length === 11) d = '55' + d
  return telefoneBr(d) ? d : null
}

// ---------- achar o lead ----------

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
  return acharLeadPorTelefone(empresaId, tel.ddd, tel.local)
}

// ---------- achar cliente da carteira ----------
const limpaSql = (col: unknown) => sql`replace(replace(replace(replace(replace(replace(coalesce(${col}, ''), '-', ''), ' ', ''), '(', ''), ')', ''), '+', ''), '.', '')`

async function clientePorJid(empresaId: number, jid: string) {
  const r = await db
    .select({ id: leadWhatsappMensagens.clienteId })
    .from(leadWhatsappMensagens)
    .where(and(eq(leadWhatsappMensagens.empresaId, empresaId), eq(leadWhatsappMensagens.jid, jid), sql`${leadWhatsappMensagens.clienteId} IS NOT NULL`))
    .orderBy(desc(leadWhatsappMensagens.id))
    .limit(1)
  return r[0]?.id ?? null
}

/** Cliente da carteira da empresa com o mesmo telefone (principal ou extra; com/sem 9 e 55). */
export async function clientePorTelefone(empresaId: number, tel: TelefoneBr) {
  const formas = tel.variantes.flatMap((v) => [`${tel.ddd}${v}`, `55${tel.ddd}${v}`])
  const lista = sql.join(formas.map((v) => sql`${v}`), sql`, `)
  const principal = await db
    .select({ id: clientes.id })
    .from(clientes)
    .where(and(eq(clientes.empresaId, empresaId), isNull(clientes.deletedAt), sql`${limpaSql(clientes.telefoneWhatsapp)} IN (${lista})`))
    .orderBy(desc(clientes.id))
    .limit(1)
  if (principal[0]) return principal[0].id
  const extra = await db
    .select({ id: clientes.id })
    .from(clienteTelefones)
    .innerJoin(clientes, eq(clientes.id, clienteTelefones.clienteId))
    .where(and(eq(clientes.empresaId, empresaId), isNull(clientes.deletedAt), sql`${limpaSql(clienteTelefones.numero)} IN (${lista})`))
    .orderBy(desc(clientes.id))
    .limit(1)
  return extra[0]?.id ?? null
}

// ---------- fila por contato (2 mensagens seguidas não criam 2 leads) ----------
const filas = new Map<string, Promise<unknown>>()
function emFila<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const p = (filas.get(chave) || Promise.resolve()).catch(() => {}).then(fn)
  filas.set(chave, p)
  p.finally(() => { if (filas.get(chave) === p) filas.delete(chave) }).catch(() => {})
  return p
}

export type ResultadoCaptura = { acao: 'duplicada' | 'anexada' | 'criado' | 'sem_lead' | 'cliente'; leadId: number | null; clienteId?: number | null; vendorId?: number | null }

/** Grava a mensagem e cria/acha o lead. Idempotente pelo id da mensagem. */
export function registrarMensagem(empresaId: number, m: MensagemCapturada): Promise<ResultadoCaptura> {
  return emFila(`${empresaId}:${m.jid}`, () => registrarAgora(empresaId, m))
}

async function registrarAgora(empresaId: number, m: MensagemCapturada): Promise<ResultadoCaptura> {
  const ja = await db.query.leadWhatsappMensagens.findFirst({
    where: and(eq(leadWhatsappMensagens.empresaId, empresaId), eq(leadWhatsappMensagens.waMessageId, m.id)),
    columns: { id: true, leadId: true, tipo: true },
  })
  if (ja) {
    if (ja.tipo === TIPO_ILEGIVEL && m.tipo !== TIPO_ILEGIVEL) {
      await db.update(leadWhatsappMensagens).set({ tipo: m.tipo, texto: m.texto, ...(m.telefone ? { telefone: m.telefone } : {}) }).where(eq(leadWhatsappMensagens.id, ja.id))
      return { acao: 'anexada', leadId: ja.leadId }
    }
    return { acao: 'duplicada', leadId: ja.leadId }
  }
  // Número escondido (@lid): usa o telefone que a pessoa escreveu (formulário da Meta).
  if (!m.telefone && !m.deMim) m = { ...m, telefone: telefoneNoTexto(m.texto) }

  const tel = telefoneBr(m.telefone)
  let leadId: number | null = (await leadPorJid(empresaId, m.jid)) ?? (tel ? await leadPorTelefone(empresaId, tel) : null)
  let acao: ResultadoCaptura['acao'] = leadId ? 'anexada' : 'sem_lead'
  let vendorId: number | null | undefined
  // Já é cliente da carteira? Então a conversa vai para o cliente e não vira lead.
  const clienteId = leadId ? null : ((await clientePorJid(empresaId, m.jid)) ?? (tel ? await clientePorTelefone(empresaId, tel) : null))
  if (clienteId) acao = 'cliente'

  if (!leadId && !clienteId && !m.deMim) {
    const form = lerFormularioMeta(m.texto)
    const nome = form?.nome || m.pushName || (tel ? `(${tel.ddd}) ${tel.local}` : m.telefone || 'Contato do WhatsApp')
    const obs = `Primeira mensagem no WhatsApp: "${m.texto.slice(0, 600)}"`
    if (tel) {
      const r = await findOrCreateLeadFromTrackingDetalhado({
        empresaId, name: nome, phone: `${tel.ddd}${tel.local}`, source: 'whatsapp', observations: obs,
        email: form?.email, city: form?.cidade, cnpj: form?.cnpj,
        metaDados: form ? { formulario: 'Respostas enviadas pelo WhatsApp', respostas: form.respostas } : undefined,
      })
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
      clienteId,
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

  // Cliente da carteira/prospecção mandou mensagem: avisa o vendedor dono no
  // sininho (1 aviso por conversa enquanto ele não abrir o card).
  if (acao === 'cliente' && clienteId && !m.deMim) await avisarVendedorDoCliente(empresaId, clienteId, m).catch((e) => console.error('[wa-captura] aviso vendedor:', (e as Error).message))

  // Mensagens que a empresa mandou antes de o número virar lead: liga agora.
  if (leadId && acao === 'criado') {
    await db.update(leadWhatsappMensagens).set({ leadId }).where(and(eq(leadWhatsappMensagens.empresaId, empresaId), eq(leadWhatsappMensagens.jid, m.jid), isNull(leadWhatsappMensagens.leadId)))
  }
  return { acao, leadId, clienteId, vendorId }
}

async function avisarVendedorDoCliente(empresaId: number, clienteId: number, m: MensagemCapturada) {
  const c = await db.query.clientes.findFirst({ where: eq(clientes.id, clienteId), columns: { razaoSocial: true, vendedorAtualId: true } })
  if (!c?.vendedorAtualId) return
  const ja = await db.query.notifications.findFirst({
    where: and(eq(notifications.vendedorId, c.vendedorAtualId), eq(notifications.clienteId, clienteId), eq(notifications.type, 'whatsapp_cliente'), eq(notifications.read, false)),
    columns: { id: true },
  })
  if (ja) return
  await db.insert(notifications).values({
    vendedorId: c.vendedorAtualId,
    clienteId,
    type: 'whatsapp_cliente',
    title: `💬 ${c.razaoSocial} mandou mensagem no WhatsApp`,
    message: `"${m.texto.slice(0, 160)}" — abra o card do cliente para ver a conversa.`,
  })
}

/** Clientes com mensagem recebida que o vendedor dono ainda não viu (selo nos cards). */
export async function clientesComMensagemNova(empresaId: number, vendedorId: number | null) {
  return db
    .select({ clienteId: leadWhatsappMensagens.clienteId, qtd: sql<number>`count(*)`, ultima: sql<string>`max(${leadWhatsappMensagens.enviadaEm})`, texto: sql<string>`(select x.texto from lead_whatsapp_mensagens x where x.cliente_id = ${leadWhatsappMensagens.clienteId} and x.direcao = 'recebida' order by x.enviada_em desc limit 1)` })
    .from(leadWhatsappMensagens)
    .innerJoin(clientes, eq(clientes.id, leadWhatsappMensagens.clienteId))
    .where(and(
      eq(leadWhatsappMensagens.empresaId, empresaId),
      eq(leadWhatsappMensagens.direcao, 'recebida'),
      isNull(leadWhatsappMensagens.vistaEm),
      sql`${leadWhatsappMensagens.enviadaEm} >= ${new Date(Date.now() - 30 * 86_400_000).toISOString()}`,
      ...(vendedorId ? [eq(clientes.vendedorAtualId, vendedorId)] : []),
    ))
    .groupBy(leadWhatsappMensagens.clienteId)
}

/** Vendedor abriu o card: mensagens recebidas viram "vistas" e o aviso do sininho é lido. */
export async function marcarMensagensVistas(empresaId: number, clienteId: number, vendedorId: number | null) {
  const r = await db.update(leadWhatsappMensagens).set({ vistaEm: new Date().toISOString() })
    .where(and(eq(leadWhatsappMensagens.empresaId, empresaId), eq(leadWhatsappMensagens.clienteId, clienteId), eq(leadWhatsappMensagens.direcao, 'recebida'), isNull(leadWhatsappMensagens.vistaEm)))
  if (vendedorId) await db.update(notifications).set({ read: true }).where(and(eq(notifications.vendedorId, vendedorId), eq(notifications.clienteId, clienteId), eq(notifications.type, 'whatsapp_cliente'), eq(notifications.read, false)))
  return Number(r.rowsAffected ?? 0)
}

/** Conversa de um cliente da carteira, em ordem (para a ficha do cliente). */
export async function conversaDoCliente(empresaId: number, clienteId: number) {
  return db
    .select({ id: leadWhatsappMensagens.id, direcao: leadWhatsappMensagens.direcao, tipo: leadWhatsappMensagens.tipo, texto: leadWhatsappMensagens.texto, pushName: leadWhatsappMensagens.pushName, enviadaEm: leadWhatsappMensagens.enviadaEm, vistaEm: leadWhatsappMensagens.vistaEm })
    .from(leadWhatsappMensagens)
    .where(and(eq(leadWhatsappMensagens.empresaId, empresaId), eq(leadWhatsappMensagens.clienteId, clienteId)))
    .orderBy(leadWhatsappMensagens.enviadaEm, leadWhatsappMensagens.id)
    .limit(1000)
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


// ---------- lead que nasceu sem número (WhatsApp escondeu: "@lid") ----------
// Roda a cada poucos minutos (captura.ts). Assim que o número aparecer — pelo
// mapa do próprio WhatsApp (lid → número) ou pelo telefone escrito na mensagem
// — o lead é consertado sozinho: se já existe lead/cliente com esse número, a
// conversa vai para ele e o lead sem número sai (não fica duplicado); se não,
// o lead ganha o telefone e o vendedor pelo DDD (João, 2026-11-26: "preciso que
// todos venham", sem ninguém conferir na mão).
export async function consertarLeadsSemNumero(
  empresaId: number,
  numeroDoLid: (jid: string) => Promise<string | null>
): Promise<number> {
  const semNumero = await db
    .select({ id: leads.id, vendorId: leads.vendorId })
    .from(leads)
    .where(and(eq(leads.empresaId, empresaId), eq(leads.source, 'whatsapp'), isNull(leads.phone), isNull(leads.deletedAt), sql`${leads.createdAt} >= datetime('now', '-30 days')`))
    .limit(50)
  let consertados = 0
  for (const l of semNumero) {
    try {
      const msgs = await db
        .select({ jid: leadWhatsappMensagens.jid, telefone: leadWhatsappMensagens.telefone, texto: leadWhatsappMensagens.texto })
        .from(leadWhatsappMensagens)
        .where(and(eq(leadWhatsappMensagens.empresaId, empresaId), eq(leadWhatsappMensagens.leadId, l.id)))
        .orderBy(leadWhatsappMensagens.id)
        .limit(30)
      if (!msgs.length) continue
      const jid = msgs[0].jid
      let numero: string | null = msgs.find((x) => x.telefone)?.telefone ?? null
      if (!numero && /@lid$/.test(jid)) numero = await numeroDoLid(jid).catch(() => null)
      if (!numero) for (const x of msgs) { numero = telefoneNoTexto(x.texto); if (numero) break }
      const tel = telefoneBr(numero)
      if (!tel) continue
      await db.update(leadWhatsappMensagens).set({ telefone: numero }).where(and(eq(leadWhatsappMensagens.empresaId, empresaId), eq(leadWhatsappMensagens.jid, jid), isNull(leadWhatsappMensagens.telefone)))
      const outro = await acharLeadPorTelefone(empresaId, tel.ddd, tel.local)
      const cliente = outro && outro !== l.id ? null : await clientePorTelefone(empresaId, tel)
      const agora = new Date().toISOString()
      if ((outro && outro !== l.id) || cliente) {
        await db.update(leadWhatsappMensagens)
          .set(outro && outro !== l.id ? { leadId: outro } : { leadId: null, clienteId: cliente })
          .where(and(eq(leadWhatsappMensagens.empresaId, empresaId), eq(leadWhatsappMensagens.leadId, l.id)))
        await db.update(leads).set({ deletedAt: agora }).where(eq(leads.id, l.id))
        const destino = outro && outro !== l.id ? `lead #${outro}` : `cliente da carteira #${cliente}`
        await db.insert(leadHistory).values({ empresaId, leadId: l.id, action: 'unificado', details: `WhatsApp tinha escondido o número (${tel.ddd}) ${tel.local}; conversa juntada no ${destino} — este lead duplicado foi retirado` })
        if (outro && outro !== l.id) await db.insert(leadHistory).values({ empresaId, leadId: outro, action: 'whatsapp', details: `Conversa do WhatsApp juntada a este lead (vinha do lead #${l.id}, sem número)` })
        console.log(`[wa-captura empresa ${empresaId}] lead #${l.id} sem número juntado ao ${destino}`)
      } else {
        const vendorId = l.vendorId ?? (await getVendorByDDD(tel.ddd, empresaId))
        const regionId = await getRegionIdByDDD(tel.ddd, empresaId)
        await db.update(leads).set({ phone: `${tel.ddd}${tel.local}`, ddd: tel.ddd, vendorId, regionId, ...(vendorId && !l.vendorId ? { assignedAt: agora } : {}) }).where(eq(leads.id, l.id))
        await db.insert(leadHistory).values({ empresaId, leadId: l.id, action: 'whatsapp', details: `Número descoberto: (${tel.ddd}) ${tel.local}${vendorId && !l.vendorId ? ' — vendedor definido pelo DDD' : ''}` })
        console.log(`[wa-captura empresa ${empresaId}] lead #${l.id} ganhou o número (${tel.ddd}) ${tel.local}${vendorId ? ` → vendedor ${vendorId}` : ''}`)
      }
      consertados++
    } catch (e) {
      console.error(`[wa-captura empresa ${empresaId}] falha ao consertar lead #${l.id}:`, (e as Error).message)
    }
  }
  return consertados
}
