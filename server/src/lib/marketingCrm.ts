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
