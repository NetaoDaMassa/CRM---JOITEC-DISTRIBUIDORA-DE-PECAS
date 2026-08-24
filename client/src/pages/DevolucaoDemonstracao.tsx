import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import { Input, Textarea } from '../components/ui/Input'

const STATUS_LABEL: Record<string, string> = {
  ativa: 'Ativa',
  retornada: 'Retornada',
  convertida_venda: 'Convertida em venda',
  devolucao_aberta: 'Devolução aberta',
}
const COLUNAS = ['ativa', 'retornada', 'convertida_venda', 'devolucao_aberta']

function formatarData(v: string | null): string {
  if (!v) return '—'
  return new Date(`${v}T00:00:00`).toLocaleDateString('pt-BR')
}

function NovaDemonstracaoModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils()
  const [clienteNome, setClienteNome] = useState('')
  const [clienteCnpj, setClienteCnpj] = useState('')
  const [clienteLocalizacao, setClienteLocalizacao] = useState('')
  const [retornoPrevistoEm, setRetornoPrevistoEm] = useState('')
  const [observacao, setObservacao] = useState('')
  const [itens, setItens] = useState([{ descricaoProduto: '', numeroSerie: '', quantidade: 1 }])

  const criarMut = trpc.devolucoes.criarDemonstracao.useMutation({
    onSuccess() {
      toast.success('Demonstração registrada')
      utils.devolucoes.listarDemonstracoes.invalidate()
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function atualizarItem(i: number, campo: string, valor: string | number) {
    setItens((prev) => prev.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)))
  }

  function enviar() {
    if (!clienteNome.trim()) return toast.error('Informe o cliente')
    const itensValidos = itens.filter((i) => i.descricaoProduto.trim())
    if (!itensValidos.length) return toast.error('Adicione pelo menos um produto')
    criarMut.mutate({
      clienteNome,
      clienteCnpj: clienteCnpj || undefined,
      clienteLocalizacao: clienteLocalizacao || undefined,
      retornoPrevistoEm: retornoPrevistoEm || undefined,
      observacao: observacao || undefined,
      itens: itensValidos,
    })
  }

  return (
    <Modal open onClose={onClose} title="Nova demonstração" size="lg">
      <div className="space-y-4">
        <Input label="Cliente" value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} required />
        <div className="grid grid-cols-2 gap-4">
          <Input label="CNPJ (se tiver)" value={clienteCnpj} onChange={(e) => setClienteCnpj(e.target.value)} />
          <Input label="Localização" value={clienteLocalizacao} onChange={(e) => setClienteLocalizacao(e.target.value)} />
        </div>
        <Input label="Retorno previsto" type="date" value={retornoPrevistoEm} onChange={(e) => setRetornoPrevistoEm(e.target.value)} />

        <div>
          <p className="text-sm text-dark-200 font-medium mb-2">Produtos</p>
          <div className="space-y-2">
            {itens.map((item, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px_70px] gap-2">
                <Input placeholder="Produto" value={item.descricaoProduto} onChange={(e) => atualizarItem(i, 'descricaoProduto', e.target.value)} />
                <Input placeholder="Nº série" value={item.numeroSerie} onChange={(e) => atualizarItem(i, 'numeroSerie', e.target.value)} />
                <Input
                  type="number"
                  min={1}
                  value={item.quantidade}
                  onChange={(e) => atualizarItem(i, 'quantidade', Number(e.target.value))}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="text-xs text-gold-400 underline mt-2"
            onClick={() => setItens((prev) => [...prev, { descricaoProduto: '', numeroSerie: '', quantidade: 1 }])}
          >
            + Adicionar produto
          </button>
        </div>

        <Textarea label="Observação" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={criarMut.isPending} onClick={enviar}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function DemonstracaoCard({ demo }: { demo: any }) {
  const utils = trpc.useUtils()
  const [renovando, setRenovando] = useState(false)
  const [novaData, setNovaData] = useState('')

  const statusMut = trpc.devolucoes.atualizarStatusDemonstracao.useMutation({
    onSuccess() {
      toast.success('Status atualizado')
      utils.devolucoes.listarDemonstracoes.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const renovarMut = trpc.devolucoes.renovarDemonstracao.useMutation({
    onSuccess() {
      toast.success('Demonstração renovada')
      utils.devolucoes.listarDemonstracoes.invalidate()
      setRenovando(false)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-xl p-3 space-y-2">
      <p className="text-sm font-medium text-dark-100">{demo.clienteNome}</p>
      <p className="text-xs text-dark-400">{(demo as any).vendedor?.name}</p>
      {(demo as any).empresa?.nome && <p className="text-[10px] text-gold-500/70">{(demo as any).empresa.nome}</p>}
      <div className="text-[11px] text-dark-500 space-y-0.5">
        {(demo as any).itens?.map((it: any) => (
          <p key={it.id}>
            {it.descricaoProduto} {it.numeroSerie ? `(${it.numeroSerie})` : ''} × {it.quantidade}
          </p>
        ))}
      </div>
      <p className="text-[11px] text-dark-500">Retorno previsto: {formatarData(demo.retornoPrevistoEm)}</p>
      {demo.contagemRenovacao > 0 && <p className="text-[11px] text-amber-400">Renovada {demo.contagemRenovacao}x</p>}

      <div className="flex flex-wrap gap-1 pt-1">
        {COLUNAS.filter((c) => c !== demo.status).map((c) => (
          <button
            key={c}
            onClick={() => statusMut.mutate({ id: demo.id, status: c as any })}
            className="text-[10px] px-2 py-1 rounded-full border border-dark-600 text-dark-300 hover:bg-dark-700"
          >
            → {STATUS_LABEL[c]}
          </button>
        ))}
      </div>

      {demo.status === 'ativa' &&
        (renovando ? (
          <div className="flex gap-1 pt-1">
            <input
              type="date"
              value={novaData}
              onChange={(e) => setNovaData(e.target.value)}
              className="bg-dark-900 border border-dark-600 rounded-lg text-xs text-dark-100 px-2 py-1 flex-1"
            />
            <Button size="sm" loading={renovarMut.isPending} onClick={() => novaData && renovarMut.mutate({ id: demo.id, novoRetornoPrevistoEm: novaData })}>
              OK
            </Button>
          </div>
        ) : (
          <button className="text-[11px] text-gold-400 underline" onClick={() => setRenovando(true)}>
            Renovar prazo
          </button>
        ))}
    </div>
  )
}

// Sub-kanban de Demonstração — empréstimo de produto pro cliente testar.
export default function DevolucaoDemonstracao() {
  const { data: demonstracoes, isLoading } = trpc.devolucoes.listarDemonstracoes.useQuery()
  const [modalNovo, setModalNovo] = useState(false)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Demonstração</h1>
          <p className="text-dark-400 text-sm">Produtos emprestados pro cliente testar.</p>
        </div>
        <Button onClick={() => setModalNovo(true)}>+ Nova demonstração</Button>
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {COLUNAS.map((status) => {
          const cards = (demonstracoes ?? []).filter((d) => d.status === status)
          return (
            <div key={status} className="bg-dark-900/40 border border-dark-700 rounded-2xl p-3 min-h-[200px]">
              <p className="text-xs font-bold text-dark-300 uppercase tracking-wide mb-3">
                {STATUS_LABEL[status]} <span className="text-dark-500 font-normal">({cards.length})</span>
              </p>
              <div className="space-y-2">
                {cards.map((d) => (
                  <DemonstracaoCard key={d.id} demo={d} />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {modalNovo && <NovaDemonstracaoModal onClose={() => setModalNovo(false)} />}
    </div>
  )
}
