import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, leadHistory, leadContactAttempts, leadCampaigns, leadRegions, leadTrackingVisitors, users } from '../db/schema.js'
import { businessHoursElapsedMs, toLocalDateKey, toUtcISO } from './businessHours.js'
import { isTerminalStatus } from './leadsStatus.js'
import { regiaoDaUf, ufDoDdd } from './dddUf.js'

// Relatório de Leads refeito no padrão dos relatórios novos (pedido do João,
// 2026-10-20: "muito incompleto e raso"). O servidor devolve UMA linha por
// lead já enriquecida (canal, campanha, UF, etapa mais alta que alcançou,
// 1º contato...) e a tela cruza os filtros na hora — trocar canal, vendedor,
// campanha, estado etc. não precisa voltar no servidor.

export type CanalLead =
  | 'meta_ads'
  | 'google_ads'
  | 'site'
  | 'instagram'
  | 'whatsapp'
  | 'email'
  | 'loja_online'
  | 'indicacao'
  | 'grupo'
  | 'outros'
  | 'manual'

// Funil "de verdade": a etapa mais alta que o lead já alcançou (pelo
// histórico), não a etapa de hoje — um lead perdido em negociação conta
// como "chegou na negociação".
const ORDEM_ETAPA: Record<string, number> = {
  novo: 0,
  novo_consumidor_final: 0,
  abordagem: 1,
  qualificado: 2,
  em_negociacao: 3,
  ganho: 4,
}

type Visitante = { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null }

// `source` é texto livre (o vendedor digita "INSTA", "face", "Whatsapp da
// Joitec"...) e os automáticos gravam o tipo do evento (form_submit,
// meta_ads_lead, brevo_clicado, ecommerce_*...). Junta com o canal da
// campanha e o UTM da visita ao site pra chegar num canal só.
export function classificarCanal(source: string | null, campanhaCanal: string | null, visita: Visitante | null): CanalLead {
  const s = (source ?? '').toLowerCase().trim()
  const utm = (visita?.utmSource ?? '').toLowerCase()
  const meio = (visita?.utmMedium ?? '').toLowerCase()
  const pago = ['cpc', 'paid', 'ppc', 'ads'].some((m) => meio.includes(m))

  if (s === 'meta_ads_lead' || campanhaCanal === 'facebook' || campanhaCanal === 'instagram') return 'meta_ads'
  if (pago && (utm.includes('google') || utm === 'gads')) return 'google_ads'
  if (pago && (utm === 'fb' || utm === 'ig' || utm.includes('facebook') || utm.includes('instagram') || utm.includes('meta'))) return 'meta_ads'
  if (campanhaCanal === 'google' || s.includes('google')) return 'google_ads'
  if (s.startsWith('ecommerce')) return 'loja_online'
  if (s.startsWith('brevo') || s.includes('e-mail') || s.includes('email')) return 'email'
  if (s === 'duplicado') return 'grupo'
  if (s.startsWith('insta') || utm.includes('instagram') || utm === 'ig') return 'instagram'
  if (s.startsWith('face') || s.includes('meta')) return 'meta_ads'
  if (s.includes('whats') || campanhaCanal === 'whatsapp') return 'whatsapp'
  if (['form_submit', 'ebook_download', 'blog_signup', 'site'].includes(s) || campanhaCanal === 'site') return 'site'
  if (s.includes('indica') || campanhaCanal === 'indicacao') return 'indicacao'
  if (!s || s === '.' || s === 'nao consta') return 'manual'
  return 'outros'
}

// Data/hora de Brasília a partir do texto UTC do banco.
function localDe(raw: string) {
  const d = new Date(new Date(toUtcISO(raw)).getTime() - 3 * 60 * 60 * 1000)
  return { data: d.toISOString().slice(0, 10), hora: d.getUTCHours(), diaSemana: d.getUTCDay() }
}

export async function linhasPainelLeads(empresaId: number, desde: string, ate: string) {
  const todos = await db.query.leads.findMany({
    where: and(eq(leads.empresaId, empresaId), isNull(leads.deletedAt)),
  })
  // Entra quem chegou no período pedido OU fechou nele (venda de um lead
  // antigo conta em "Vendas fechadas").
  const doPeriodo = todos.filter((l) => {
    const entrada = toLocalDateKey(toUtcISO(l.createdAt))
    if (entrada >= desde && entrada <= ate) return true
    if (isTerminalStatus(l.status) && l.statusChangedAt) {
      const fech = toLocalDateKey(toUtcISO(l.statusChangedAt))
      return fech >= desde && fech <= ate
    }
    return false
  })
  const ids = doPeriodo.map((l) => l.id)
  if (!ids.length) return []

  const [campanhas, regioes, vendedores, tentativas, historico, visitas] = await Promise.all([
    db.query.leadCampaigns.findMany({ where: eq(leadCampaigns.empresaId, empresaId), columns: { id: true, name: true, channel: true } }),
    db.query.leadRegions.findMany({ where: eq(leadRegions.empresaId, empresaId), columns: { id: true, name: true } }),
    db.query.users.findMany({ columns: { id: true, name: true } }),
    db.query.leadContactAttempts.findMany({
      where: inArray(leadContactAttempts.leadId, ids),
      columns: { leadId: true, result: true, channel: true, createdAt: true },
      orderBy: (c, { asc }) => [asc(c.createdAt)],
    }),
    db.query.leadHistory.findMany({
      where: and(eq(leadHistory.empresaId, empresaId), inArray(leadHistory.leadId, ids)),
      columns: { leadId: true, action: true, toStatus: true },
    }),
    db.query.leadTrackingVisitors.findMany({
      where: and(eq(leadTrackingVisitors.empresaId, empresaId), inArray(leadTrackingVisitors.leadId, ids)),
      columns: { leadId: true, utmSource: true, utmMedium: true, utmCampaign: true },
    }),
  ])
  const campanhaPorId = new Map(campanhas.map((c) => [c.id, c]))
  const regiaoPorId = new Map(regioes.map((r) => [r.id, r.name]))
  const nomeUsuario = new Map(vendedores.map((u) => [u.id, u.name]))

  // Visita com UTM tem prioridade sobre a sem UTM (o mesmo lead pode ter
  // vindo de mais de um navegador).
  const visitaPorLead = new Map<number, Visitante>()
  for (const v of visitas) {
    if (v.leadId == null) continue
    const atual = visitaPorLead.get(v.leadId)
    if (!atual || (!atual.utmSource && v.utmSource)) visitaPorLead.set(v.leadId, v)
  }

  const tentPorLead = new Map<number, { total: number; confirmadas: number; primeiraConfirmada: string | null; whatsapp: number; ligacao: number }>()
  for (const t of tentativas) {
    let e = tentPorLead.get(t.leadId)
    if (!e) {
      e = { total: 0, confirmadas: 0, primeiraConfirmada: null, whatsapp: 0, ligacao: 0 }
      tentPorLead.set(t.leadId, e)
    }
    e.total++
    if (t.channel === 'whatsapp') e.whatsapp++
    if (t.channel === 'ligacao') e.ligacao++
    if (t.result) {
      e.confirmadas++
      if (!e.primeiraConfirmada) e.primeiraConfirmada = t.createdAt
    }
  }

  const etapaMaxPorLead = new Map<number, number>()
  const transferPorLead = new Map<number, number>()
  for (const h of historico) {
    if (h.toStatus && ORDEM_ETAPA[h.toStatus] !== undefined) {
      etapaMaxPorLead.set(h.leadId, Math.max(etapaMaxPorLead.get(h.leadId) ?? 0, ORDEM_ETAPA[h.toStatus]))
    }
    if (h.action === 'transferido' || h.action === 'reatribuicao_automatica') transferPorLead.set(h.leadId, (transferPorLead.get(h.leadId) ?? 0) + 1)
  }

  const hoje = toLocalDateKey(new Date().toISOString())

  return doPeriodo.map((l) => {
    const campanha = l.campaignId ? campanhaPorId.get(l.campaignId) ?? null : null
    const visita = visitaPorLead.get(l.id) ?? null
    const tent = tentPorLead.get(l.id)
    const uf = ufDoDdd(l.ddd)
    const entrada = localDe(l.createdAt)
    const fechado = isTerminalStatus(l.status) && l.statusChangedAt
    const etapaMax = Math.max(etapaMaxPorLead.get(l.id) ?? 0, ORDEM_ETAPA[l.status] ?? 0)
    const contatado = (tent?.confirmadas ?? 0) > 0 || etapaMax >= 2
    const motivo = l.status === 'perdido' ? l.lossReason : l.status === 'desqualificado' ? l.disqualifyReason : l.status === 'consumidor_final' ? l.finalConsumerReason : null
    return {
      id: l.id,
      nome: l.name,
      empresa: l.company,
      cidade: l.city,
      uf,
      regiaoBr: regiaoDaUf(uf),
      regiaoLead: l.regionId ? regiaoPorId.get(l.regionId) ?? null : null,
      segmento: l.segment ?? 'outros',
      status: l.status,
      vendedorId: l.vendorId,
      vendedor: l.vendorId ? nomeUsuario.get(l.vendorId) ?? 'Sem vendedor' : 'Sem vendedor',
      canal: classificarCanal(l.source, campanha?.channel ?? null, visita),
      origemTexto: l.source,
      campanha: campanha?.name ?? visita?.utmCampaign ?? null,
      dataEntrada: entrada.data,
      horaEntrada: entrada.hora,
      diaSemanaEntrada: entrada.diaSemana,
      dataFechamento: fechado ? toLocalDateKey(toUtcISO(l.statusChangedAt!)) : null,
      diasAteFechar: fechado ? Math.max(0, (new Date(toUtcISO(l.statusChangedAt!)).getTime() - new Date(toUtcISO(l.createdAt)).getTime()) / 86400000) : null,
      primeiroContatoHoras: tent?.primeiraConfirmada ? businessHoursElapsedMs(l.createdAt, tent.primeiraConfirmada) / 3600000 : null,
      tentativas: tent?.total ?? 0,
      tentativasWhats: tent?.whatsapp ?? 0,
      tentativasLigacao: tent?.ligacao ?? 0,
      contatado,
      etapaMax,
      valorOrcado: l.orderValue,
      valorFinal: l.finalOrderValue,
      motivo,
      transferencias: transferPorLead.get(l.id) ?? 0,
      proximoContato: l.nextContactAt,
      atrasado: !isTerminalStatus(l.status) && !!l.nextContactAt && l.nextContactAt.slice(0, 10) < hoje,
      pprVerde: l.tagPprVerde,
      outrasLinhas: l.tagOutrasLinhas,
      convertido: l.convertidoParaClienteId ? 'carteira' : l.convertidoParaPropostaId ? 'proposta' : null,
    }
  })
}

export type LinhaPainelLead = Awaited<ReturnType<typeof linhasPainelLeads>>[number]
