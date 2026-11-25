// Teste da captura de leads do WhatsApp SEM WhatsApp de verdade: simula as
// mensagens do Baileys contra uma CÓPIA do banco.
// Uso: DATABASE_URL=file:./teste_captura.db npx tsx src/scripts/testarCapturaWhatsapp.ts
import path from 'path'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, leadWhatsappMensagens } from '../db/schema.js'
import { extrairMensagem, registrarMensagem, conversaDoLead } from '../lib/whatsapp/capturaLeads.js'
import { findOrCreateLeadFromTrackingDetalhado } from '../lib/leadsTrackingService.js'

if (!String(process.env.DATABASE_URL).includes('teste')) throw new Error('Rode só contra uma cópia (DATABASE_URL com "teste")')
await migrate(db, { migrationsFolder: path.resolve('drizzle') })
const EMP = 4
let n = 0
const id = () => `TESTE${Date.now()}${n++}`
const msg = (jid: string, texto: string, o: { fromMe?: boolean; push?: string; mid?: string; extra?: object; message?: object } = {}) => ({
  key: { remoteJid: jid, fromMe: !!o.fromMe, id: o.mid || id(), ...(o.extra || {}) },
  pushName: o.push,
  messageTimestamp: Math.floor(Date.now() / 1000) + n,
  message: o.message || { conversation: texto },
})
let falhas = 0
const ok = (cond: unknown, nome: string) => { console.log(`${cond ? '✅' : '❌'} ${nome}`); if (!cond) falhas++ }
async function enviar(b: any) { const m = extrairMensagem(b); return m ? registrarMensagem(EMP, m) : null }

// 1) número novo → lead
const r1 = await enviar(msg('5547999112233@s.whatsapp.net', 'Oi, quero orçamento de compressor', { push: 'Carlos Teste' }))
const l1 = r1?.leadId ? await db.query.leads.findFirst({ where: eq(leads.id, r1.leadId) }) : null
ok(r1?.acao === 'criado', 'número novo cria lead')
ok(l1?.empresaId === EMP && l1?.status === 'novo' && l1?.source === 'whatsapp', 'lead na Odin Compressores, etapa Novo, origem whatsapp')
ok(l1?.ddd === 47 && l1?.phone === '999112233' && l1?.name === 'Carlos Teste', `DDD/telefone/nome certos (${l1?.ddd} ${l1?.phone} ${l1?.name})`)
console.log('   vendedor pelo DDD:', l1?.vendorId ?? 'nenhum (região sem vendedor nesta cópia)')
// 2) mesma pessoa de novo
const r2 = await enviar(msg('5547999112233@s.whatsapp.net', 'É pra oficina', { push: 'Carlos Teste' }))
ok(r2?.acao === 'anexada' && r2.leadId === r1?.leadId, 'segunda mensagem não duplica')
// 3) mesmo número sem o 9
const r3 = await enviar(msg('554799112233@s.whatsapp.net', 'oi de novo'))
ok(r3?.acao === 'anexada' && r3.leadId === r1?.leadId, 'mesmo número sem o 9 cai no mesmo lead')
// 4) resposta pelo celular
const r4 = await enviar(msg('5547999112233@s.whatsapp.net', 'Bom dia Carlos! Qual modelo?', { fromMe: true }))
ok(r4?.acao === 'anexada' && r4.leadId === r1?.leadId, 'resposta pelo celular entra como enviada')
// 5) mensagem repetida (reconexão)
const mid = id()
await enviar(msg('5547999112233@s.whatsapp.net', 'repetida', { mid }))
const r5 = await enviar(msg('5547999112233@s.whatsapp.net', 'repetida', { mid }))
ok(r5?.acao === 'duplicada', 'mesma mensagem 2x grava 1x')
// 6) grupo, status, reação, protocolo
ok(extrairMensagem(msg('120363000000@g.us', 'grupo')) === null, 'grupo ignorado')
ok(extrairMensagem(msg('status@broadcast', 'status')) === null, 'status ignorado')
ok(extrairMensagem(msg('5547999112233@s.whatsapp.net', '', { message: { reactionMessage: { text: '👍' } } })) === null, 'reação ignorada')
ok(extrairMensagem(msg('5547999112233@s.whatsapp.net', '', { message: { protocolMessage: { type: 0 } } })) === null, 'mensagem de sistema ignorada')
// 7) mídia
const im = extrairMensagem(msg('5547999112233@s.whatsapp.net', '', { message: { imageMessage: { caption: 'foto da placa' } } }))
ok(im?.tipo === 'imagem' && im.texto === '[Imagem] foto da placa', 'imagem vira "[Imagem] legenda"')
// 8) empresa mandou primeiro para número que não é lead → não cria; cliente responde → cria e junta
const r8a = await enviar(msg('5511988887777@s.whatsapp.net', 'Olá, aqui é da Odin', { fromMe: true }))
ok(r8a?.acao === 'sem_lead' && r8a.leadId === null, 'mensagem nossa não cria lead')
const r8b = await enviar(msg('5511988887777@s.whatsapp.net', 'Oi! Tenho interesse', { push: 'Ana SP' }))
const conv8 = r8b?.leadId ? await conversaDoLead(EMP, r8b.leadId) : []
ok(r8b?.acao === 'criado' && conv8.length === 2, 'quando o cliente responde, vira lead e a mensagem anterior entra na conversa')
// 9) identificador oculto (@lid) com número alternativo
const r9 = await enviar(msg('123456789012345@lid', 'oi', { push: 'Lid Com Numero', extra: { senderPn: '5548991234567@s.whatsapp.net' } }))
const l9 = r9?.leadId ? await db.query.leads.findFirst({ where: eq(leads.id, r9.leadId) }) : null
ok(l9?.ddd === 48 && l9?.phone === '991234567', '@lid usa o número alternativo (senderPn)')
// 10) @lid sem número → lead sem vendedor
const r10 = await enviar(msg('999999999999999@lid', 'oi', { push: 'Sem Numero' }))
const l10 = r10?.leadId ? await db.query.leads.findFirst({ where: eq(leads.id, r10.leadId) }) : null
ok(r10?.acao === 'criado' && !l10?.vendorId && l10?.ddd === null, '@lid sem número cria lead sem vendedor para distribuir')
// 11) internacional
const r11 = await enviar(msg('14155550100@s.whatsapp.net', 'hello', { push: 'Gringo' }))
const l11 = r11?.leadId ? await db.query.leads.findFirst({ where: eq(leads.id, r11.leadId) }) : null
ok(r11?.acao === 'criado' && !l11?.vendorId && /internacional/i.test(l11?.observations || ''), 'internacional cria sem vendedor e marca para distribuir')
// 12) lead antigo cadastrado com traço e sem o 9
const ins = await db.insert(leads).values({ empresaId: EMP, name: 'Lead antigo teste', phone: '9150-7887', ddd: 47, source: 'manual' })
const antigo = Number(ins.lastInsertRowid)
const r12 = await enviar(msg('5547991507887@s.whatsapp.net', 'lembra de mim?'))
ok(r12?.acao === 'anexada' && r12.leadId === antigo, 'casa com lead antigo salvo "9150-7887"')
// 13) outra empresa não é tocada
const outra = await db.select().from(leadWhatsappMensagens).where(and(eq(leadWhatsappMensagens.empresaId, 1)))
ok(outra.length === 0, 'nada gravado em outra empresa')
// 14) ordem da conversa
const conv1 = await conversaDoLead(EMP, r1!.leadId!)
ok(conv1.length >= 5 && conv1.some((m) => m.direcao === 'enviada'), `conversa do lead tem ${conv1.length} mensagens (recebidas e enviadas)`)
// 15) formulário da Meta mandado no WhatsApp ANTES da planilha da Meta
const textoForm = 'Olá! Preenchi seu formulário e gostaria de saber mais sobre sua empresa.\n\nVocê possui CNPJ ativo? se sim, Qual seria ?: 14648824000187\nFull name: Jeferson Rodrigues\nQual é o seu tipo de negócio?: Revenda\nCity: Apucarana\nPhone number: +554399166973\nEmail: kartjef12@gmail.com'
const r15 = await enviar(msg('554399166973@s.whatsapp.net', textoForm, { push: 'Jef' }))
const l15 = r15?.leadId ? await db.query.leads.findFirst({ where: eq(leads.id, r15.leadId) }) : null
ok(r15?.acao === 'criado' && l15?.name === 'Jeferson Rodrigues' && l15?.city === 'Apucarana' && l15?.email === 'kartjef12@gmail.com' && l15?.cnpj === '14648824000187', `lê nome/cidade/e-mail/CNPJ do formulário (${l15?.name}, ${l15?.city}, ${l15?.email}, ${l15?.cnpj})`)
const meta15 = await findOrCreateLeadFromTrackingDetalhado({ empresaId: EMP, name: 'Jeferson Rodrigues', phone: '+554399166973', source: 'meta_ads_lead', metaDados: { campanha: 'Campanha PPR', anuncio: 'Vídeo 1', respostas: { 'Qual é o seu tipo de negócio?': 'Revenda' } } })
const l15b = await db.query.leads.findFirst({ where: eq(leads.id, r15!.leadId!) })
ok(meta15?.id === r15?.leadId && meta15?.criado === false, 'planilha da Meta chegando depois NÃO duplica (número com/sem 9)')
ok(/Campanha PPR/.test(l15b?.metaDados || ''), 'campanha da Meta completa o lead que veio do WhatsApp')
// 16) Meta antes, WhatsApp depois
const meta16 = await findOrCreateLeadFromTrackingDetalhado({ empresaId: EMP, name: 'Maria Meta', phone: '(41) 99876-5432', source: 'meta_ads_lead' })
const r16 = await enviar(msg('5541998765432@s.whatsapp.net', textoForm.replace('+554399166973', '+5541998765432'), { push: 'Maria' }))
ok(meta16?.criado && r16?.acao === 'anexada' && r16.leadId === meta16.id, 'Meta antes e WhatsApp depois cai no mesmo lead')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO CERTO')
process.exit(falhas ? 1 : 0)
