import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { trpc } from '../lib/trpc'
import { formatarMoeda } from '../lib/moeda'
import { Esqueleto } from './ui/Visual'

// Topo da ficha do cliente no design novo (teste): etiquetas, 4 números e
// as compras dos últimos 12 meses (CRM + SAP).

function dataBr(d: string | null) {
  return d ? d.slice(0, 10).split('-').reverse().join('/') : '—'
}

function Numero({ rotulo, valor, detalhe, alerta }: { rotulo: string; valor: string; detalhe?: string; alerta?: boolean }) {
  return (
    <div className="rounded-xl bg-dark-900/60 border border-dark-700 px-3 py-2.5 min-w-0">
      <p className="text-[11px] text-dark-400 truncate">{rotulo}</p>
      <p className={`text-lg font-bold leading-tight truncate ${alerta ? 'text-red-400' : 'text-dark-50'}`}>{valor}</p>
      {detalhe && <p className="text-[11px] text-dark-500 truncate">{detalhe}</p>}
    </div>
  )
}

export function EtiquetasCliente({ clienteId }: { clienteId: number }) {
  const { data } = trpc.clientes.resumoVisual.useQuery({ id: clienteId })
  if (!data) return null
  return (
    <>
      {data.etiquetas.map((e) => (
        <span
          key={e.texto}
          className="text-[11px] font-semibold rounded-full px-2.5 py-0.5"
          style={{ color: e.cor, background: `${e.cor}1f`, boxShadow: `inset 0 0 0 1px ${e.cor}55` }}
        >
          {e.texto}
        </span>
      ))}
    </>
  )
}

export default function ResumoCliente({ clienteId }: { clienteId: number }) {
  const { data } = trpc.clientes.resumoVisual.useQuery({ id: clienteId })
  if (!data) return <Esqueleto className="h-40 rounded-2xl" />
  const ano = new Date().getFullYear()
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-4 bg-dark-800 border border-dark-600 rounded-2xl p-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Numero rotulo={`Comprou em ${ano}`} valor={formatarMoeda(data.totalAno, { casas: 0 })} detalhe={`${data.comprasAno} compra(s)`} />
        <Numero rotulo="Ticket médio" valor={formatarMoeda(data.ticketMedio, { casas: 0 })} />
        <Numero
          rotulo="Última compra"
          valor={data.diasSemComprar === null ? 'Nunca' : data.diasSemComprar === 0 ? 'Hoje' : `há ${data.diasSemComprar} dias`}
          detalhe={dataBr(data.ultimaCompra)}
          alerta={(data.diasSemComprar ?? 0) > 90}
        />
        <Numero
          rotulo="Último contato"
          valor={data.diasSemContato === null ? 'Nunca' : data.diasSemContato === 0 ? 'Hoje' : `há ${data.diasSemContato} dias`}
          detalhe={`na carteira desde ${dataBr(data.naCarteiraDesde)}`}
          alerta={(data.diasSemContato ?? 99) > 30}
        />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-dark-300 mb-1">Compras nos últimos 12 meses</p>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={data.meses} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="rotulo" tick={{ fill: '#6580a0', fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.05)' }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="bg-dark-800 border border-dark-600 rounded-lg px-2.5 py-1.5 text-xs shadow-lg">
                    <p className="text-dark-300">{String(payload[0].payload.rotulo)}</p>
                    <p className="text-dark-50 font-semibold">{formatarMoeda(Number(payload[0].value))}</p>
                  </div>
                ) : null
              }
            />
            <Bar dataKey="valor" fill="#3987e5" radius={[4, 4, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
