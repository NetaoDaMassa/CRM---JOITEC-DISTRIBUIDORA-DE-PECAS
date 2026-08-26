import { useState } from 'react'
import { ShieldCheck, Search, ChevronDown, ChevronUp, History, Package } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'
import { STAGE_LABELS, type Stage } from '../lib/ordensShared'

const STATUS_LABEL: Record<string, string> = { ativo: 'Ativo', concluido: 'Concluído', cancelado: 'Cancelado' }
const STATUS_COLOR: Record<string, string> = { ativo: 'text-amber-400', concluido: 'text-green-400', cancelado: 'text-red-400' }

export default function ControleQualidade() {
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [busca, setBusca] = useState('')
  const [expandido, setExpandido] = useState<number | null>(null)

  const { data: linhas, isLoading, refetch } = trpc.qualidade.resumo.useQuery({ dataDe: dataDe || undefined, dataAte: dataAte || undefined })

  const filtradas = (linhas ?? []).filter((l) => {
    if (!busca.trim()) return true
    const q = busca.toLowerCase()
    return l.clienteNome.toLowerCase().includes(q) || String(l.ordemId).includes(q)
  })
  const totalArquivos = (linhas ?? []).reduce((acc, l) => acc + l.arquivos.length, 0)

  return (
    <div className="p-6">
      <h1 className="font-heading text-2xl text-dark-50 font-bold mb-4 flex items-center gap-2">
        <ShieldCheck size={22} /> Controle de Qualidade
      </h1>

      <div className="bg-dark-800 border border-dark-600 rounded-xl p-4 mb-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Input label="De" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
          <Input label="Até" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
          <div className="col-span-2 flex items-end">
            <Button className="w-full" onClick={() => refetch()}><Search size={14} className="mr-1" /> Buscar</Button>
          </div>
        </div>
        <Input label="Buscar por cliente ou nº do pedido" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="ex: Indústria XYZ ou #123" />
      </div>

      {linhas && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-dark-800 border border-dark-600 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gold-600/20 flex items-center justify-center"><Package size={18} className="text-gold-400" /></div>
            <div><div className="text-xl font-bold text-dark-50">{linhas.length}</div><div className="text-xs text-dark-500">Pedidos</div></div>
          </div>
          <div className="bg-dark-800 border border-dark-600 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center"><ShieldCheck size={18} className="text-blue-400" /></div>
            <div><div className="text-xl font-bold text-dark-50">{totalArquivos}</div><div className="text-xs text-dark-500">Anexos/fotos no total</div></div>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <div className="space-y-2">
          {filtradas.map((l) => {
            const aberto = expandido === l.ordemId
            return (
              <div key={l.ordemId} className="bg-dark-800 border border-dark-600 rounded-xl overflow-hidden">
                <button onClick={() => setExpandido(aberto ? null : l.ordemId)} className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-dark-700/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-gold-500">#{l.ordemId}</span>
                      <p className="font-semibold text-dark-100 truncate">{l.clienteNome}</p>
                      <span className={`text-xs font-medium ${STATUS_COLOR[l.status] ?? ''}`}>{STATUS_LABEL[l.status] ?? l.status}</span>
                    </div>
                    <p className="text-xs text-dark-500 mt-0.5">
                      Vendedor: {l.vendedorNome} · Etapa: {STAGE_LABELS[l.stage as Stage] ?? l.stage} · {l.arquivos.length} anexo(s) · {l.historico.length} evento(s)
                    </p>
                  </div>
                  {aberto ? <ChevronUp size={18} className="text-dark-500 shrink-0" /> : <ChevronDown size={18} className="text-dark-500 shrink-0" />}
                </button>

                {aberto && (
                  <div className="border-t border-dark-700 p-4 space-y-4">
                    {l.observacoesQualidade && (
                      <div className="rounded-lg bg-dark-900 px-4 py-3 text-sm text-dark-300"><span className="font-medium">Obs. de qualidade: </span>{l.observacoesQualidade}</div>
                    )}

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-dark-500 mb-2">Fotos e Anexos</p>
                      {l.arquivos.length === 0 ? (
                        <p className="text-xs text-dark-600 text-center py-2">Nenhum anexo neste pedido</p>
                      ) : (
                        <div className="space-y-1.5">
                          {l.arquivos.map((a) => (
                            <a key={a.id} href={`/uploads/${a.nomeArmazenado}`} target="_blank" rel="noreferrer" className="block text-xs text-blue-400 hover:underline">
                              {a.nomeOriginal} <span className="text-dark-500">({a.stage}{a.fileCategory ? ` · ${a.fileCategory}` : ''})</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-dark-500 mb-2 flex items-center gap-1.5"><History size={12} /> Histórico Completo</p>
                      {l.historico.length === 0 ? (
                        <p className="text-xs text-dark-600 text-center py-2">Sem histórico</p>
                      ) : (
                        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                          {l.historico.map((h) => (
                            <div key={h.id} className="flex gap-2.5 text-sm">
                              <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gold-500 shrink-0" />
                              <div>
                                <span className="font-medium text-dark-300">{h.user?.name ?? 'Sistema'}</span>
                                <span className="text-dark-500"> — {h.description || h.action}</span>
                                <p className="text-xs text-dark-600">{h.createdAt}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {filtradas.length === 0 && <p className="text-dark-500 text-sm text-center py-16">Nenhum pedido encontrado</p>}
        </div>
      )}
    </div>
  )
}
