import { and, eq, isNull } from 'drizzle-orm'
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

// Chamada a partir de POST /api/tracking/events (rota pública, sem sessão de
// usuário logado) quando um formulário do site tem telefone — cria (ou
// reaproveita, se já existe) o lead correspondente, com o mesmo rodízio por
// DDD usado em leads.create.
export async function findOrCreateLeadFromTracking(
  input: FindOrCreateLeadFromTrackingInput
): Promise<number | null> {
  const { empresaId, email, name, company, observations, source, utmCampaign, metaDados } = input
  const cnpjLimpo = input.cnpj ? limparCnpj(input.cnpj) : ''
  const cnpj = cnpjLimpo && cnpjValido(cnpjLimpo) ? cnpjLimpo : null
  const compressorAtual = acharCompressorAtual(metaDados?.respostas)

  const parsed = parseTelefone(input.phone)
  if (!parsed) return null
  const { ddd, phone } = parsed

  const existing = await db.query.leads.findFirst({
    where: and(eq(leads.empresaId, empresaId), eq(leads.phone, phone), isNull(leads.deletedAt)),
  })
  if (existing) {
    // Mesma pessoa preenchendo de novo (ou lead antigo de antes de existir
    // isso): completa o que estiver faltando, nunca sobrescreve.
    if (metaDados && (!existing.metaDados || (cnpj && !existing.cnpj) || (compressorAtual && !existing.compressorAtual))) {
      await db
        .update(leads)
        .set({
          metaDados: existing.metaDados ?? JSON.stringify(metaDados),
          cnpj: existing.cnpj ?? cnpj,
          compressorAtual: existing.compressorAtual ?? compressorAtual,
          city: existing.city ?? (input.city?.trim() || null),
        })
        .where(eq(leads.id, existing.id))
      if (cnpj && !existing.dadosReceita) void enriquecerLeadComReceita(existing.id)
    }
    return existing.id
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
      type: 'lead_assigned',
      title: 'Novo lead atribuído',
      message: `${name?.trim() || 'Um novo lead'} foi distribuído para você agora (origem: ${source}).`,
    })
  }

  if (cnpj) void enriquecerLeadComReceita(leadId)

  return leadId
}
