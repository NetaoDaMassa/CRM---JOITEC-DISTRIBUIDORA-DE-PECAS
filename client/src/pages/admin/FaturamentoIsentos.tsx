import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { formatDateTime } from '../../lib/utils'
import { formatarMoeda } from '../../lib/moeda'

// Faturista (Dani, financeiro 2026-11-13): a parte da expedição só com os
// pedidos de clientes ISENTOS, com "Aguardando pagamento" e "Pago".

export default function FaturamentoIsentos() {
  const [aba, setAba] = useState<'aguardando' | 'pago'>('aguardando')
  const [busca, setBusca] = useState('')
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.faturamentoIsentos.listar.useQuery({ aba })
  const marcar = trpc.faturamentoIsentos.marcar.useMutation({
    onSuccess: (_r, v) => {
      toast.success(v.status === 'pago' ? 'Marcado como pago' : 'Voltou para aguardando pagamento')
      utils.faturamentoIsentos.listar.invalidate()
      utils.expedicao.fila.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const q = busca.trim().toLowerCase()
  const lista = (data?.lista ?? []).filter((p) => !q || [p.clienteNome, p.clienteCodigo, p.pedidosSap, p.nfNumero, p.vendedor, p.empresaNome].some((x) => (x ?? '').toLowerCase().includes(q)))

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Faturamento — clientes isentos</h1>
        <p className="text-sm text-dark-400 mt-1">
          Pedidos da expedição (Joitec, Odin Tubos e Odin Automação) de clientes <b>isentos</b>. Marque quando o cliente pagar. O selo aparece também no card da Expedição.
        </p>
      </div>
      <div className="flex gap-1 border-b border-dark-700">
        {(['aguardando', 'pago'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAba(t)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${aba === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
          >
            {t === 'aguardando' ? 'Aguardando pagamento' : 'Pago'}
            {data?.total && <span className="ml-1 text-[11px] text-dark-500">({data.total[t]})</span>}
          </button>
        ))}
      </div>
      <Input placeholder="Buscar cliente, pedido, NF, vendedor…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      {isLoading && <p className="text-sm text-dark-400">Carregando…</p>}
      {!isLoading && lista.length === 0 && <p className="text-sm text-dark-400">Nenhum pedido aqui.</p>}
      <div className="space-y-2">
        {lista.map((p) => (
          <div key={p.id} className={`rounded-xl border bg-dark-800 p-3 ${p.pagamentoStatus === 'pago' ? 'border-green-800/50' : 'border-amber-700/50'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-dark-100">
                  Pedido {p.pedidosSap} · {p.clienteNome}
                  <span className="ml-2 inline-block text-[10px] font-bold rounded bg-violet-900/40 text-violet-200 border border-violet-600/60 px-1.5 py-0.5 align-middle">CLIENTE ISENTO</span>
                </p>
                <p className="text-xs text-dark-400">
                  {p.empresaNome} · {p.vendedor ? `👤 ${p.vendedor} · ` : ''}picking em {p.dataPicking.split('-').reverse().join('/')}
                </p>
                <p className="text-xs text-dark-300">
                  {p.valor != null && <b className="text-dark-100">{formatarMoeda(p.valor)}</b>}
                  {p.condicao && ` · ${p.condicao}`} · Expedição: {p.etapaLabel}
                  {p.nfNumero && ` · NF ${p.nfNumero}`}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {p.pagamentoStatus === 'aguardando' ? (
                  <>
                    <span className="text-[11px] font-bold rounded-lg px-2 py-1 border text-amber-200 bg-amber-900/30 border-amber-600/60">💰 AGUARDANDO PAGAMENTO</span>
                    <Button size="sm" onClick={() => marcar.mutate({ id: p.id, status: 'pago' })} disabled={marcar.isPending}>
                      ✓ Pago
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-[11px] font-bold rounded-lg px-2 py-1 border text-green-300 bg-green-900/20 border-green-700/40">✓ PAGO</span>
                    <span className="text-[11px] text-dark-500">
                      {p.pagamentoAlteradoEm ? formatDateTime(p.pagamentoAlteradoEm) : ''} {p.pagamentoAlteradoPor ? `· ${p.pagamentoAlteradoPor}` : ''}
                    </span>
                    <button className="text-[11px] text-dark-500 hover:text-dark-200" onClick={() => marcar.mutate({ id: p.id, status: 'aguardando' })}>
                      voltar para aguardando
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
