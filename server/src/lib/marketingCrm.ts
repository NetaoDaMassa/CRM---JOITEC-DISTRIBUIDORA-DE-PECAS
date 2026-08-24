// Ponte com o CRM de marketing (odin-tubos-crm) — os dois backends rodam em
// projetos docker-compose isolados na mesma VPS e não dividem rede interna,
// então essa consulta é feita por HTTPS público + chave fixa (mesmo padrão
// do endpoint /api/tracking daquele CRM).
export interface ResumoLeadsNovoMarketing {
  companySlug: string
  companyName: string
  generatedAt: string
  totalLeadsNovo: number
  semVendedor: number
  vendedores: { username: string; name: string; leadsNovo: number }[]
}

export async function buscarLeadsNovoMarketing(companySlug: string): Promise<ResumoLeadsNovoMarketing | null> {
  const baseUrl = process.env.MARKETING_CRM_URL
  const apiKey = process.env.MARKETING_CRM_API_KEY
  if (!baseUrl || !apiKey) return null

  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/integracoes/leads-novo?companySlug=${encodeURIComponent(companySlug)}`
    const res = await fetch(url, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    return (await res.json()) as ResumoLeadsNovoMarketing
  } catch (err) {
    console.error('[marketingCrm] falha ao buscar leads "Novo":', err)
    return null
  }
}

export interface ResumoAnalyticsMarketing {
  companySlug: string
  companyName: string
  totalVisitors: number
  totalPageViews: number
  topPages: { url: string; title: string | null; views: number }[]
  clicksByType: { trackId: string; count: number }[]
  whatsappClicks: number
  avgTimeOnPageSeconds: number | null
  bounceRate: number
  leads: number
  leadsBySource: { campaign: string; source: string | null; visitors: number; leads: number }[]
}

export interface SerieDiariaAnalyticsMarketing {
  companySlug: string
  serie: { date: string; pageViews: number; visitors: number; leads: number }[]
}

function baseUrlEApiKey(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.MARKETING_CRM_URL
  const apiKey = process.env.MARKETING_CRM_API_KEY
  if (!baseUrl || !apiKey) return null
  return { baseUrl, apiKey }
}

// Resumo do site (visitas, cliques por botão, bounce rate, tempo de tela, leads por
// origem) — alimenta a tela "Analytics" do Joitec CRM (`router/analytics.ts`).
export async function buscarAnalyticsResumo(
  companySlug: string,
  dateFrom?: string,
  dateTo?: string
): Promise<ResumoAnalyticsMarketing | null> {
  const cfg = baseUrlEApiKey()
  if (!cfg) return null

  try {
    const params = new URLSearchParams({ companySlug })
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    const url = `${cfg.baseUrl.replace(/\/$/, '')}/api/integracoes/analytics-resumo?${params}`
    const res = await fetch(url, { headers: { 'x-api-key': cfg.apiKey }, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    return (await res.json()) as ResumoAnalyticsMarketing
  } catch (err) {
    console.error('[marketingCrm] falha ao buscar resumo de analytics:', err)
    return null
  }
}

export async function buscarAnalyticsSerieDiaria(
  companySlug: string,
  dateFrom?: string,
  dateTo?: string
): Promise<SerieDiariaAnalyticsMarketing | null> {
  const cfg = baseUrlEApiKey()
  if (!cfg) return null

  try {
    const params = new URLSearchParams({ companySlug })
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    const url = `${cfg.baseUrl.replace(/\/$/, '')}/api/integracoes/analytics-serie-diaria?${params}`
    const res = await fetch(url, { headers: { 'x-api-key': cfg.apiKey }, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    return (await res.json()) as SerieDiariaAnalyticsMarketing
  } catch (err) {
    console.error('[marketingCrm] falha ao buscar série diária de analytics:', err)
    return null
  }
}
