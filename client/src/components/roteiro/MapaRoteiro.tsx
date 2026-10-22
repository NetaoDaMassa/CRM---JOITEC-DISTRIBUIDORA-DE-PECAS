// Mapa do roteiro — OpenStreetMap (grátis) via Leaflet. Casa = 🏠, paradas
// numeradas na ordem do caminho, linha ligando tudo (ida e volta).
import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { PontoMapa } from './util'

export type ParadaMapa = PontoMapa & { numero: number | string; nome: string; status?: 'pendente' | 'visitada' | 'pulada' | 'extra' }

const COR: Record<string, string> = { pendente: '#d4a017', visitada: '#16a34a', pulada: '#6b7280', extra: '#7c3aed' }

function icone(texto: string | number, cor: string) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${cor};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 12px system-ui;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)">${texto}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}
const iconeCasa = L.divIcon({
  className: '',
  html: '<div style="background:#0f172a;width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)">🏠</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
})
const iconeEu = L.divIcon({
  className: '',
  html: '<div style="background:#2563eb;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,.35)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

function Enquadrar({ pontos }: { pontos: PontoMapa[] }) {
  const map = useMap()
  const chave = pontos.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|')
  useEffect(() => {
    if (!pontos.length) return
    if (pontos.length === 1) map.setView([pontos[0].lat, pontos[0].lng], 14)
    else map.fitBounds(L.latLngBounds(pontos.map((p) => [p.lat, p.lng])), { padding: [30, 30] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])
  return null
}

export default function MapaRoteiro({ casa, paradas, eu, altura = 320 }: { casa: PontoMapa | null; paradas: ParadaMapa[]; eu?: PontoMapa | null; altura?: number }) {
  const todos = [...(casa ? [casa] : []), ...paradas, ...(eu ? [eu] : [])]
  const linha = [...(casa ? [casa] : []), ...paradas.filter((p) => p.status !== 'pulada'), ...(casa && paradas.length ? [casa] : [])].map((p) => [p.lat, p.lng] as [number, number])
  const centro: [number, number] = todos.length ? [todos[0].lat, todos[0].lng] : [-23.55, -46.63]
  return (
    <div className="rounded-xl overflow-hidden border border-dark-600 relative z-0" style={{ height: altura }}>
      <MapContainer center={centro} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {linha.length > 1 && <Polyline positions={linha} pathOptions={{ color: '#d4a017', weight: 3, dashArray: '6 6' }} />}
        {casa && (
          <Marker position={[casa.lat, casa.lng]} icon={iconeCasa}>
            <Tooltip>Casa (saída e volta)</Tooltip>
          </Marker>
        )}
        {paradas.map((p, i) => (
          <Marker key={i} position={[p.lat, p.lng]} icon={icone(p.numero, COR[p.status ?? 'pendente'])}>
            <Tooltip>{`${p.numero}. ${p.nome}`}</Tooltip>
          </Marker>
        ))}
        {eu && (
          <Marker position={[eu.lat, eu.lng]} icon={iconeEu}>
            <Tooltip>Você está aqui</Tooltip>
          </Marker>
        )}
        <Enquadrar pontos={todos} />
      </MapContainer>
    </div>
  )
}
