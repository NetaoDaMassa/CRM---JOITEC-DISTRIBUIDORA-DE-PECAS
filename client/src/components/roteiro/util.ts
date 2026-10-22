// Roteiro do dia — utilitários da tela (links de navegação, rótulos).
// Navegação é só link (grátis, sem chave de API): abre o app do Google Maps
// ou o Waze no celular do vendedor com as paradas na ordem.

export type PontoMapa = { lat: number; lng: number }

// O link do Google Maps aceita no máximo 9 paradas intermediárias — roteiro
// maior vira mais de um link (parte 1 termina onde a parte 2 começa).
export function linksGoogleMaps(casa: PontoMapa | null, paradas: PontoMapa[]): string[] {
  const pontos = [...(casa ? [casa] : []), ...paradas, ...(casa ? [casa] : [])]
  if (pontos.length < 2) return []
  const fmt = (p: PontoMapa) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
  const links: string[] = []
  let i = 0
  while (i < pontos.length - 1) {
    const trecho = pontos.slice(i, i + 11) // origem + 9 paradas + destino
    const origem = trecho[0]
    const destino = trecho[trecho.length - 1]
    const meio = trecho.slice(1, -1)
    links.push(
      `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${fmt(origem)}&destination=${fmt(destino)}` +
        (meio.length ? `&waypoints=${encodeURIComponent(meio.map(fmt).join('|'))}` : ''),
    )
    i += trecho.length - 1
  }
  return links
}

export function linkWaze(p: PontoMapa): string {
  return `https://waze.com/ul?ll=${p.lat.toFixed(6)},${p.lng.toFixed(6)}&navigate=yes`
}

export function linkGoogleUmLugar(p: PontoMapa): string {
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
}

export const OBJETIVOS_ROTEIRO = ['Prospecção de clientes', 'Fechar proposta', 'Retorno combinado', 'Recuperar cliente', 'Pós venda', 'Manutenção', 'Visita marketing', 'Demonstrar máquina']

export const MOTIVOS_PULO = ['Cliente fechado', 'Responsável ausente', 'Remarcado com o cliente', 'Sem tempo (dia atrasou)', 'Trânsito / problema no carro', 'Outro']

export const RESULTADOS_VISITA = [
  { value: 'gerar_proposta', label: 'Gerar proposta' },
  { value: 'follow_up', label: 'Retorno marcado' },
  { value: 'sem_interesse', label: 'Sem interesse' },
  { value: 'nao_encontrado', label: 'Não encontrado' },
] as const

export const STATUS_ROTEIRO: Record<string, { label: string; cor: string }> = {
  rascunho: { label: 'Rascunho (não enviado)', cor: 'text-dark-300 bg-dark-700/60 border-dark-500' },
  enviado: { label: 'Aguardando aprovação', cor: 'text-amber-300 claro:text-amber-700 bg-amber-500/10 border-amber-500/40' },
  aprovado: { label: 'Aprovado', cor: 'text-green-300 claro:text-green-700 bg-green-500/10 border-green-500/40' },
  devolvido: { label: 'Devolvido para ajuste', cor: 'text-red-300 claro:text-red-700 bg-red-500/10 border-red-500/40' },
}

export const FONTE_LOCALIZACAO: Record<string, string> = {
  gps_visita: 'Local confirmado por GPS',
  endereco: 'Local pelo endereço',
  cidade: 'Local aproximado (só a cidade)',
  manual: 'Local marcado no mapa',
}

export function dataBr(iso: string): string {
  return iso.slice(0, 10).split('-').reverse().join('/')
}

export function diaSemana(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' })
}

export function horaBrDeUtc(ts: string | null): string | null {
  if (!ts) return null
  return new Date(ts.replace(' ', 'T') + 'Z').toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

export function obterGps(): Promise<PontoMapa | null> {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => ok({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => ok(null),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  })
}
