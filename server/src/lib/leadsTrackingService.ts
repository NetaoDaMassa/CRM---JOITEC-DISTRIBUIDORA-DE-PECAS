import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, leadHistory, notifications, leadCampaigns } from '../db/schema.js'
import { getVendorByDDD, getRegionIdByDDD } from './leadsRoundRobin.js'
import { buscarCnpj } from './brasilApi.js'
import { cnpjValido, limparCnpj } from './cnpj.js'

// O que o Apps Script da planilha do Meta Ads manda além de nome/telefone/
// e-mail (ver routes/tracking.ts). Pedido do João, 2026-10-27.
export interface MetaDadosLead {
  campanha?: string
  conjunto?: string
  anuncio?: string
  formulario?: string
  plataforma?: string
  preenchidoEm?: string
  respostas?: Record<string, string>
}

interface FindOrCreateLeadFromTrackingInput {
  empresaId: number
  name?: string
  phone: string
  email?: string
  company?: string
  observations?: string
  source: string
  utmCampaign?: string
  city?: string
  cnpj?: string
  metaDados?: MetaDadosLead
}

// Resposta da pergunta "qual compressor possui atualmente?" (o nome da coluna
// na planilha muda conforme o texto da pergunta, então procura por
// "compressor" no nome da pergunta).
function acharCompressorAtual(respostas: Record<string, string> | undefined): string | null {
  if (!respostas) return null
  const chave = Object.keys(respostas).find((k) => k.toLowerCase().includes('compressor'))
  const valor = chave ? respostas[chave]?.trim() : ''
  return valor ? valor.slice(0, 500) : null
}

// Consulta o CNPJ na Receita (BrasilAPI) e guarda no lead — roda depois de
// responder o Apps Script (não segura a planilha esperando a BrasilAPI).
// Preenche empresa/cidade só se estiverem vazias ou se a "empresa" for só o
// próprio CNPJ digitado.
export async function enriquecerLeadComReceita(leadId: number): Promise<void> {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) })
  if (!lead?.cnpj || lead.dadosReceita) return
  try {
    const dados = await buscarCnpj(lead.cnpj)
    if (!dados || !dados.razaoSocial) return
    const empresaEhCnpj = !lead.company || limparCnpj(lead.company) === lead.cnpj
    await db
      .update(leads)
      .set({
        dadosReceita: JSON.stringify(dados),
        company: empresaEhCnpj ? dados.nomeFantasia || dados.razaoSocial : lead.company,
        city: lead.city || (dados.municipio ? `${dados.municipio}${dados.uf ? `/${dados.uf}` : ''}` : null),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(leads.id, leadId))
  } catch (err) {
    console.error('[leads/receita]', leadId, err)
  }
}

// Casa o utm_campaign do anúncio com o nome de uma campanha já cadastrada
// (Marketing > Campanhas) — sem bater, o lead nasce sem campanha vinculada
// de propósito (nunca cria campanha sozinho, ver leadCampaigns.naoVinculados
// pra descobrir o que falta cadastrar). Comparação sem acento/maiúscula pra
// não depender de digitar idêntico ao configurado no anúncio.
async function encontrarCampanhaPorUtm(empresaId: number, utmCampaign: string | undefined): Promise<number | null> {
  if (!utmCampaign?.trim()) return null
  const alvo = utmCampaign.trim().toLowerCase()
  const campanhas = await db.query.leadCampaigns.findMany({ where: eq(leadCampaigns.empresaId, empresaId), columns: { id: true, name: true } })
  return campanhas.find((c) => c.name.trim().toLowerCase() === alvo)?.id ?? null
}

// Separa DDD (2 primeiros dígitos, removendo o 55 do Brasil se presente) do
// número local — leads.ddd é NOT NULL, sem DDD válido não dá pra criar o
// lead. Mesma lógica do sistema de origem
// (odin-tubos-crm--master/server/src/lib/trackingLeadService.ts), mas
// agora também devolve o número local pra `leads.phone` nunca guardar o DDD
// embutido — o formulário do site manda o telefone cru, do jeito que a
// pessoa digitou (DDD junto, às vezes com parênteses/traço), e guardar isso
// direto duplicava o DDD na ficha do lead e quebrava o link do WhatsApp.
export function parseTelefone(phoneRaw: string): { ddd: number; phone: string } | null {
  const digits = phoneRaw.replace(/\D/g, '')
  const local = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits
  if (local.length < 10) return null
  const ddd = parseInt(local.slice(0, 2), 10)
  if (ddd < 11 || ddd > 99) return null
  return { ddd, phone: local.slice(2) }
}

// Acha lead da empresa pelo telefone sem depender de como foi digitado: com ou
// sem o 9º dígito, com traço/parênteses, com o DDD junto ou separado. Usado
// pelo lead da Meta/site E pela captura do WhatsApp — antes a Meta comparava o
// texto exato e duplicava quando o WhatsApp tinha criado o lead com o 9
// (João, 2026-11-25).
export async function acharLeadPorTelefone(empresaId: number, ddd: number, localBruto: string): Promise<number | null> {
  let local = String(localBruto || '').replace(/\D/g, '')
  if (!local) return null
  if (local.length === 8 && /^[6-9]/.test(local)) local = '9' + local
  const variantes = [local, ...(local.length === 9 && local.startsWith('9') ? [local.slice(1)] : [])]
  const comDdd = variantes.flatMap((v) => [`${ddd}${v}`, `55${ddd}${v}`])
  const limpo = sql`replace(replace(replace(replace(replace(replace(coalesce(${leads.phone}, ''), '-', ''), ' ', ''), '(', ''), ')', ''), '+', ''), '.', '')`
  const r = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(
      eq(leads.empresaId, empresaId),
      isNull(leads.deletedAt),
      sql`(${limpo} IN (${sql.join(comDdd.map((v) => sql`${v}`), sql`, `)})
        OR (${limpo} IN (${sql.join(variantes.map((v) => sql`${v}`), sql`, `)}) AND (${leads.ddd} = ${ddd} OR ${leads.ddd} IS NULL)))`,
    ))
    .orderBy(desc(leads.id))
    .limit(1)
  return r[0]?.id ?? null
}

// Chamada a partir de POST /api/tracking/events (rota pública, sem sessão de
// usuário logado) quando um formulário do site tem telefone — cria (ou
// reaproveita, se já existe) o lead correspondente, com o mesmo rodízio por
// DDD usado em leads.create.
export async function findOrCreateLeadFromTracking(input: FindOrCreateLeadFromTrackingInput): Promise<number | null> {
  return (await findOrCreateLeadFromTrackingDetalhado(input))?.id ?? null
}

// Igual, mas diz se o lead foi criado agora (a loja virtual usa isso pra
// avisar o vendedor quando um lead que já existia volta e compra/abandona).
export async function findOrCreateLeadFromTrackingDetalhado(
  input: FindOrCreateLeadFromTrackingInput
): Promise<{ id: number; criado: boolean; vendorId: number | null } | null> {
  const { empresaId, email, name, company, observations, source, utmCampaign, metaDados } = input
  const cnpjLimpo = input.cnpj ? limparCnpj(input.cnpj) : ''
  const cnpj = cnpjLimpo && cnpjValido(cnpjLimpo) ? cnpjLimpo : null
  const compressorAtual = acharCompressorAtual(metaDados?.respostas)

  const parsed = parseTelefone(input.phone)
  if (!parsed) return null
  const { ddd, phone } = parsed

  const idExistente = await acharLeadPorTelefone(empresaId, ddd, phone)
  const existing = idExistente ? await db.query.leads.findFirst({ where: eq(leads.id, idExistente) }) : undefined
  if (existing) {
    // Mesma pessoa preenchendo de novo (ou lead antigo de antes de existir
    // isso): completa o que estiver faltando, nunca sobrescreve.
    // Lead que nasceu pela mensagem do WhatsApp (só as respostas, sem campanha):
    // quando a planilha da Meta chega depois, completa com campanha/anúncio.
    let metaAntigo: MetaDadosLead | null = null
    try { metaAntigo = existing.metaDados ? JSON.parse(existing.metaDados) : null } catch { metaAntigo = null }
    const completarCampanha = !!(metaDados?.campanha && metaAntigo && !metaAntigo.campanha)
    if (metaDados && (!existing.metaDados || completarCampanha || (cnpj && !existing.cnpj) || (compressorAtual && !existing.compressorAtual))) {
      await db
        .update(leads)
        .set({
          metaDados: completarCampanha ? JSON.stringify({ ...metaAntigo, ...metaDados, respostas: { ...(metaAntigo?.respostas || {}), ...(metaDados.respostas || {}) } }) : existing.metaDados ?? JSON.stringify(metaDados),
          cnpj: existing.cnpj ?? cnpj,
          compressorAtual: existing.compressorAtual ?? compressorAtual,
          city: existing.city ?? (input.city?.trim() || null),
        })
        .where(eq(leads.id, existing.id))
      if (cnpj && !existing.dadosReceita) void enriquecerLeadComReceita(existing.id)
    }
    return { id: existing.id, criado: false, vendorId: existing.vendorId ?? null }
  }

  const vendorId = await getVendorByDDD(ddd, empresaId)
  const regionId = await getRegionIdByDDD(ddd, empresaId)
  const campaignId = await encontrarCampanhaPorUtm(empresaId, utmCampaign)

  const result = await db.insert(leads).values({
    empresaId,
    name: name?.trim() || 'Lead do site',
    phone,
    ddd,
    email: email || null,
    company: company?.trim() || null,
    observations: observations?.trim() || null,
    city: input.city?.trim() || null,
    cnpj,
    compressorAtual,
    metaDados: metaDados ? JSON.stringify(metaDados) : null,
    source,
    vendorId,
    regionId,
    campaignId,
    assignedAt: vendorId ? new Date().toISOString() : null,
    statusChangedAt: new Date().toISOString(),
  })

  const leadId = Number(result.lastInsertRowid)

  await db.insert(leadHistory).values({
    empresaId,
    leadId,
    action: 'criado',
    toStatus: 'novo',
    details: `Lead criado via tracking (${source})${vendorId ? ' e atribuído ao vendedor' : ' sem vendedor'}`,
  })

  if (vendorId) {
    await db.insert(notifications).values({
      vendedorId: vendorId,
      leadId,
      type: 'lead_assigned',
      title: 'Novo lead atribuído',
      message: `${name?.trim() || 'Um novo lead'} foi distribuído para você agora (origem: ${source}).`,
    })
  }

  if (cnpj) void enriquecerLeadComReceita(leadId)

  return { id: leadId, criado: true, vendorId: vendorId ?? null }
}
