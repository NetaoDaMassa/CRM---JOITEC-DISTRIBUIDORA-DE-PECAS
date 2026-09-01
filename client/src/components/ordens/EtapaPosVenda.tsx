import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import type { OrderType } from '../../lib/ordensShared'

const NPS_COR = (n: number) => (n >= 9 ? 'border-green-500 bg-green-900/20 text-green-400' : n >= 7 ? 'border-yellow-500 bg-yellow-900/20 text-yellow-400' : 'border-red-500 bg-red-900/20 text-red-400')

export default function EtapaPosVenda({ ordemId, isAdmin, readonly, orderType, clienteNome, clienteWhatsapp }: { ordemId: number; isAdmin: boolean; readonly: boolean; orderType: OrderType; clienteNome?: string | null; clienteWhatsapp?: string | null }) {
  const { data, isLoading } = trpc.ordens.pos.obterPosVenda.useQuery({ ordemId })
  const { data: revendas } = trpc.revendas.listar.useQuery(undefined, { retry: false })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return <EtapaPosVendaForm ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} orderType={orderType} data={data ?? null} revendas={revendas ?? []} clienteNome={clienteNome} clienteWhatsapp={clienteWhatsapp} />
}

function EtapaPosVendaForm({
  ordemId,
  readonly,
  orderType,
  data,
  revendas,
  clienteNome,
  clienteWhatsapp,
}: {
  ordemId: number
  isAdmin: boolean
  readonly: boolean
  orderType: OrderType
  data: {
    feedbackCliente: string | null
    npsScore: number | null
    dataLembrete: string | null
    notaLembrete: string | null
    vendaPeca: boolean | null
    primeiraPreventiva: string | null
    nomeRevenda: string | null
    dataRecebimentoMercadoria: string | null
  } | null
  revendas: { id: number; nome: string; telefoneContato: string | null }[]
  clienteNome?: string | null
  clienteWhatsapp?: string | null
}) {
  const utils = trpc.useUtils()
  const [feedback, setFeedback] = useState(data?.feedbackCliente ?? '')
  const [nps, setNps] = useState(data?.npsScore ?? null)
  const [vendaPeca, setVendaPeca] = useState(!!data?.vendaPeca)
  const [primeiraPreventiva, setPrimeiraPreventiva] = useState(data?.primeiraPreventiva ?? '')
  const [nomeRevenda, setNomeRevenda] = useState(data?.nomeRevenda ?? '')
  const [dataRecebimento, setDataRecebimento] = useState(data?.dataRecebimentoMercadoria ?? '')
  const [dataLembrete, setDataLembrete] = useState(data?.dataLembrete ?? '')
  const [notaLembrete, setNotaLembrete] = useState(data?.notaLembrete ?? '')
  const podeEditar = !readonly
  const isPeca = orderType === 'peca'

  const salvarMut = trpc.ordens.pos.atualizarPosVenda.useMutation({
    onSuccess: () => { toast.success('Salvo'); utils.ordens.pos.obterPosVenda.invalidate({ ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  const revendaSelecionada = revendas.find((r) => r.nome === nomeRevenda)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-3 rounded-lg border border-dark-700 bg-dark-900/40">
          <p className="text-[11px] text-dark-500 uppercase tracking-wide mb-1">Cliente</p>
          <p className="text-sm text-dark-200">{clienteNome ?? '—'}</p>
          {clienteWhatsapp && (
            <a href={`https://wa.me/${clienteWhatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="text-xs text-green-400 hover:underline">WhatsApp</a>
          )}
        </div>
        <div className="p-3 rounded-lg border border-dark-700 bg-dark-900/40">
          <p className="text-[11px] text-dark-500 uppercase tracking-wide mb-1">Revenda</p>
          <Input list="lista-revendas-posvenda" value={nomeRevenda} onChange={(e) => setNomeRevenda(e.target.value)} disabled={!podeEditar} placeholder="Nome da revenda" />
          <datalist id="lista-revendas-posvenda">{revendas.map((r) => <option key={r.id} value={r.nome} />)}</datalist>
          {revendaSelecionada?.telefoneContato && (
            <a href={`https://wa.me/${revendaSelecionada.telefoneContato.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="text-xs text-green-400 hover:underline mt-1 inline-block">WhatsApp</a>
          )}
        </div>
      </div>

      {isPeca && (
        <Input label="Data de recebimento da mercadoria" type="date" defaultValue={dataRecebimento} onChange={(e) => setDataRecebimento(e.target.value)} disabled={!podeEditar} />
      )}

      <label className="flex items-center gap-2 text-sm text-dark-200">
        <input type="checkbox" checked={vendaPeca} disabled={!podeEditar} onChange={(e) => setVendaPeca(e.target.checked)} /> Venda de Peça
      </label>

      <Input label="Data da primeira preventiva" type="date" defaultValue={primeiraPreventiva} onChange={(e) => setPrimeiraPreventiva(e.target.value)} disabled={!podeEditar} />

      <div>
        <label className="text-xs text-dark-400 mb-2 block">Nota NPS</label>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              disabled={!podeEditar}
              onClick={() => setNps(n)}
              className={`w-8 h-8 rounded-lg border-2 text-xs font-semibold transition-colors disabled:opacity-60 ${nps === n ? NPS_COR(n) : 'border-dark-600 text-dark-400 hover:border-dark-500'}`}
            >
              {n}
            </button>
          ))}
        </div>
        {nps != null && <p className="text-xs text-dark-500 mt-1">{nps >= 9 ? 'Promotor' : nps >= 7 ? 'Neutro' : 'Detrator'}</p>}
      </div>

      <Textarea label="Feedback do cliente" defaultValue={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={!podeEditar} />

      <div className="p-3 rounded-lg border border-dark-700 space-y-2">
        <p className="text-xs font-semibold text-dark-400">Lembrete no Calendário</p>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Data" type="date" defaultValue={dataLembrete} onChange={(e) => setDataLembrete(e.target.value)} disabled={!podeEditar} />
          <Input label="Nota" defaultValue={notaLembrete} onChange={(e) => setNotaLembrete(e.target.value)} disabled={!podeEditar} />
        </div>
      </div>

      {podeEditar && (
        <Button
          size="sm"
          loading={salvarMut.isPending}
          onClick={() =>
            salvarMut.mutate({
              ordemId,
              feedbackCliente: feedback,
              npsScore: nps ?? undefined,
              vendaPeca,
              primeiraPreventiva,
              nomeRevenda,
              dataRecebimentoMercadoria: dataRecebimento,
              dataLembrete,
              notaLembrete,
            })
          }
        >
          Salvar Pós Venda
        </Button>
      )}
    </div>
  )
}
