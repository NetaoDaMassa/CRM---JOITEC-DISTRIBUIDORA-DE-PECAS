// Teste da captura de leads do WhatsApp SEM WhatsApp de verdade: simula as
// mensagens do Baileys contra uma CÓPIA do banco.
// Uso: DATABASE_URL=file:./teste_captura.db npx tsx src/scripts/testarCapturaWhatsapp.ts
import path from 'path'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, leadWhatsappMensagens, clientes, notifications, users } from '../db/schema.js'
import { extrairMensagem, registrarMensagem, conversaDoLead, consertarLeadsSemNumero, telefoneNoTexto, TIPO_ILEGIVEL, clientesComMensagemNova, marcarMensagensVistas } from '../lib/whatsapp/capturaLeads.js'
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

// 17) caso Iractan (26/11): Meta antes; WhatsApp com número ESCONDIDO (@lid) mas telefone no texto
ok(telefoneNoTexto('Phone number: +5512981249925') === '5512981249925' && telefoneNoTexto('Telefone: (47) 99911-2233') === '5547999112233' && telefoneNoTexto('oi') === null, 'lê telefone escrito na mensagem')
const meta17 = await findOrCreateLeadFromTrackingDetalhado({ empresaId: EMP, name: 'Iractan Teste', phone: '(12) 98124-9925', source: 'meta_ads_lead' })
await db.update(leads).set({ ddd: 12, phone: '981249925' }).where(eq(leads.id, meta17!.id)) // igual ao lead real da Meta
const texto17 = 'Olá! Preenchi seu formulário e gostaria de saber mais sobre sua empresa.\n\nVocê trabalha com compressor de ar?: Sou assistente técnico\nPhone number: +5512981249925\nEmail: x@y.com'
const r17 = await enviar(msg('263148401610998@lid', texto17, { push: 'Iractan' }))
ok(r17?.acao === 'anexada' && r17.leadId === meta17?.id, `@lid sem número + telefone no formulário cai no lead da Meta (não duplica) [${r17?.acao} #${r17?.leadId} vs #${meta17?.id}]`)
// 18) mensagem ilegível (CIPHERTEXT) de contato novo: vira lead mesmo assim; depois chega legível e troca o texto
const mid18 = id()
const r18 = await enviar({ key: { remoteJid: '5511977776666@s.whatsapp.net', fromMe: false, id: mid18 }, pushName: 'Pedro Teste', messageTimestamp: Math.floor(Date.now() / 1000), message: null, messageStubType: 2, messageStubParameters: ['No session record'] })
ok(r18?.acao === 'criado', 'mensagem que não deu para abrir AINDA cria o lead')
const r18b = await enviar(msg('5511977776666@s.whatsapp.net', 'Quero o cabeçote ODV20', { mid: mid18 }))
const c18 = await conversaDoLead(EMP, r18!.leadId!)
ok(r18b?.acao === 'anexada' && c18.length === 1 && c18[0].texto === 'Quero o cabeçote ODV20' && c18[0].tipo !== TIPO_ILEGIVEL, 'quando o WhatsApp reenvia legível, o texto é trocado (sem duplicar)')
// 19) @lid sem número nenhum → lead sem número; vigia descobre o número depois (mapa do WhatsApp)
const r19 = await enviar(msg('999000111222@lid', 'bom dia, tem tubo?', { push: 'Sem Numero' }))
const l19 = await db.query.leads.findFirst({ where: eq(leads.id, r19!.leadId!) })
ok(r19?.acao === 'criado' && !l19?.phone, 'lid sem número cria lead sem número')
const n19 = await consertarLeadsSemNumero(EMP, async (jid) => (jid === '999000111222@lid' ? '5548991112222' : null))
const l19b = await db.query.leads.findFirst({ where: eq(leads.id, r19!.leadId!) })
ok(n19 >= 1 && l19b?.phone === '48991112222' && l19b?.ddd === 48, `vigia completa o número do lead (${l19b?.ddd} ${l19b?.phone})`)
// 20) lid sem número, mas o número já é de outro lead → junta e tira o duplicado
const meta20 = await findOrCreateLeadFromTrackingDetalhado({ empresaId: EMP, name: 'Já Existia', phone: '(31) 98355-8980', source: 'meta_ads_lead' })
const r20 = await enviar(msg('270454124216444@lid', 'olá', { push: 'RW' }))
await consertarLeadsSemNumero(EMP, async (jid) => (jid === '270454124216444@lid' ? '553183558980' : null))
const l20 = await db.query.leads.findFirst({ where: eq(leads.id, r20!.leadId!) })
const c20 = await conversaDoLead(EMP, meta20!.id)
ok(!!l20?.deletedAt && c20.some((m) => m.texto === 'olá'), 'duplicado sem número sai e a conversa vai para o lead que já existia')

// 21) cliente da carteira/prospecção manda mensagem → selo + sininho do vendedor; some quando o vendedor abre
const vend = await db.query.users.findFirst({ where: eq(users.empresaId, EMP), columns: { id: true } })
const insC = await db.insert(clientes).values({ empresaId: EMP, razaoSocial: 'AD PARTS TESTE', codigo: 'TST' + Date.now(), telefoneWhatsapp: '81988887777', vendedorAtualId: vend!.id } as any)
const cli = Number(insC.lastInsertRowid)
const r21 = await enviar(msg('5581988887777@s.whatsapp.net', 'Preciso de um orçamento', { push: 'Augusto' }))
await enviar(msg('5581988887777@s.whatsapp.net', 'PPR azul 1/4', { push: 'Augusto' }))
const novas = await clientesComMensagemNova(EMP, vend!.id)
const n21 = novas.find((x) => x.clienteId === cli)
ok(r21?.acao === 'cliente' && Number(n21?.qtd) === 2, `selo: cliente com 2 mensagens novas (${n21?.qtd})`)
const avisos = await db.select().from(notifications).where(and(eq(notifications.clienteId, cli), eq(notifications.type, 'whatsapp_cliente')))
ok(avisos.length === 1 && avisos[0].vendedorId === vend!.id && !avisos[0].read, `sininho: 1 aviso para o vendedor dono (${avisos.length})`)
await marcarMensagensVistas(EMP, cli, vend!.id)
const depois = (await clientesComMensagemNova(EMP, vend!.id)).find((x) => x.clienteId === cli)
const avisosDepois = await db.select().from(notifications).where(and(eq(notifications.clienteId, cli), eq(notifications.type, 'whatsapp_cliente')))
ok(!depois && avisosDepois.every((a) => a.read), 'vendedor abriu o card: selo some e aviso fica lido')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO CERTO')
process.exit(falhas ? 1 : 0)
