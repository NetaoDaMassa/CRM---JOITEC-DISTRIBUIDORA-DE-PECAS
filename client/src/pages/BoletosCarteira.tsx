import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileClock } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { formatarMoeda } from '../lib/moeda'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import ContatoButtons from '../components/ui/ContatoButtons'

// Boletos da minha carteira (pedido do João, 2026-10-30) — todas as parcelas
// em aberto no SAP dos clientes do vendedor, pra lembrar o cliente antes de
// vencer e cobrar o que venceu. O admin vê a empresa toda ou um vendedor.
// Vem da mesma foto de contas a receber da ficha (atualizada de hora em hora).

type Filtro = 'vencidos' | 'hoje' | '7dias' | 'avencer' | 'todos'
const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'vencidos', label: 'Vencidos' },
  { id: 'hoje', label: 'Vencem hoje' },
  { id: '7dias', label: 'Próximos 7 dias' },
  { id: 'avencer', label: 'Todos a vencer' },
  { id: 'todos', label: 'Todos' },
]
const TIPO: Record<string, string> = { nota: 'NF', titulo_antigo: 'Título antigo', adiantamento: 'Fatura de adiantamento' }

function dataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function situacao(dias: number): { texto: string; classe: string } {
  if (dias > 0) return { texto: `vencido há ${dias} dia(s)`, classe: dias > 90 ? 'bg-red-900/40 text-red-200' : 'bg-red-900/25 text-red-300' }
  if (dias === 0) return { texto: 'vence hoje', classe: 'bg-amber-900/40 text-amber-200' }
  if (dias >= -7) return { texto: `vence em ${-dias} dia(s)`, classe: 'bg-amber-900/25 text-amber-200' }
  return { texto: `vence em ${-dias} dias`, classe: 'bg-dark-700 text-dark-300' }
}

export default function BoletosCarteira() {
  const { user } = useAuth()
  const admin = user?.role === 'admin'
  const [vendedorId, setVendedorId] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('7dias')
  const [busca, setBusca] = useState('')
  const { data, isLoading } = trpc.sapFinanceiro.boletosCarteira.useQuery({ vendedorId: vendedorId ? Number(vendedorId) : undefined })
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: admin })

  const linhas = data?.linhas ?? []
  const conta = (f: Filtro) =>
    linhas.filter((l) => (f === 'vencidos' ? l.dias > 0 : f === 'hoje' ? l.dias === 0 : f === '7dias' ? l.dias <= 0 && l.dias >= -7 : f === 'avencer' ? l.dias <= 0 : true))
  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return conta(filtro).filter((l) => !t || `${l.cliente} ${l.codigo} ${l.documento}`.toLowerCase().includes(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, filtro, busca])
  // Agrupa por cliente, na ordem do boleto que vence primeiro.
  const grupos = useMemo(() => {
    const m = new Map<number, typeof filtradas>()
    for (const l of filtradas) m.set(l.clienteId, [...(m.get(l.clienteId) ?? []), l])
    return [...m.values()]
  }, [filtradas])
  const total = (ls: typeof linhas) => ls.reduce((s, l) => s + l.valor, 0)
  const base = admin ? '/admin/clientes' : '/vendedor/clientes'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
            <FileClock size={20} className="text-sky-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Boletos da {admin && !vendedorId ? 'carteira' : 'minha carteira'}</h1>
            <p className="text-sm text-dark-400">Boletos em aberto no SAP · lembre o cliente antes de vencer e cobre o que venceu</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {admin && (
            <div className="w-56">
              <Select
                label="Vendedor"
                value={vendedorId}
                onChange={(e) => setVendedorId(e.target.value)}
                options={[{ value: '', label: 'Todos os vendedores' }, ...(vendedores ?? []).map((v) => ({ value: String(v.id), label: v.name }))]}
              />
            </div>
          )}
          <Input label="Buscar" placeholder="cliente, código ou NF" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      {data && !data.ligado ? (
        <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">Esta tela ainda não está ligada para esta empresa.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {FILTROS.map((f) => {
              const ls = conta(f.id)
              const ativo = filtro === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFiltro(f.id)}
                  className={`text-left rounded-2xl border p-3 transition-colors ${ativo ? 'border-gold-600 bg-gold-900/10' : 'border-dark-600 bg-dark-800 hover:border-dark-500'}`}
                >
                  <p className={`text-xs ${f.id === 'vencidos' ? 'text-red-300' : f.id === 'hoje' || f.id === '7dias' ? 'text-amber-300' : 'text-dark-400'}`}>{f.label}</p>
                  <p className="text-lg font-bold font-mono text-dark-50">{formatarMoeda(total(ls), { casas: 0 })}</p>
                  <p className="text-xs text-dark-500">
                    {ls.length} boleto(s) · {new Set(ls.map((l) => l.clienteId)).size} cliente(s)
                  </p>
                </button>
              )
            })}
          </div>

          {isLoading ? (
            <div className="h-40 rounded-2xl bg-dark-800 animate-pulse" />
          ) : grupos.length === 0 ? (
            <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">Nenhum boleto neste filtro. 👍</p>
          ) : (
            <div className="space-y-3">
              {grupos.map((ls) => {
                const c = ls[0]
                return (
                  <div key={c.clienteId} className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <Link to={`${base}/${c.clienteId}`} className="text-sm font-semibold text-dark-100 hover:underline">
                          {c.cliente}
                        </Link>
                        <p className="text-xs text-dark-500">
                          {c.codigo}
                          {admin && c.vendedor ? ` · ${c.vendedor}` : ''} · {ls.length} boleto(s) · {formatarMoeda(total(ls))}
                        </p>
                      </div>
                      <ContatoButtons telefone={c.telefone} clienteId={c.clienteId} />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <tbody>
                          {ls.map((l, i) => {
                            const s = situacao(l.dias)
                            return (
                              <tr key={i} className="border-t border-dark-700/70">
                                <td className="py-1.5 pr-3 whitespace-nowrap">{dataBr(l.vencimento)}</td>
                                <td className="py-1.5 pr-3 whitespace-nowrap">
                                  <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${s.classe}`}>{s.texto}</span>
                                </td>
                                <td className="py-1.5 pr-3 whitespace-nowrap text-dark-300">
                                  {TIPO[l.tipo] ?? l.tipo} <span className="font-mono">{l.documento}</span>
                                  {l.parcela && <span className="text-dark-500"> · parc. {l.parcela}</span>}
                                </td>
                                <td className="py-1.5 text-right font-mono whitespace-nowrap">{formatarMoeda(l.valor)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
