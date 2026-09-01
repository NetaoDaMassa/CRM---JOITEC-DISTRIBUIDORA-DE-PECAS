import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { History, Trash2 } from 'lucide-react'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { Input, Textarea } from './ui/Input'
import ClientePicker from './ClientePicker'
import { formatDateTime } from '../lib/utils'

const TIPO_LABEL: Record<string, string> = { criacao: 'Boleto criado', valor: 'Valor alterado', vencimento: 'Vencimento alterado', status: 'Status alterado' }

// Cria um boleto novo (boletoId null) ou abre o detalhe/histórico de um já
// existente — mesmo modal pros dois casos, igual DemandaModal.
export default function BoletoModal({ open, onClose, boletoId }: { open: boolean; onClose: () => void; boletoId: number | null }) {
  const utils = trpc.useUtils()

  const [cliente, setCliente] = useState<{ id: number; razaoSocial: string } | null>(null)
  const [numeroBoleto, setNumeroBoleto] = useState('')
  const [valorOriginal, setValorOriginal] = useState('')
  const [vencimento, setVencimento] = useState('')
  const [observacoes, setObservacoes] = useState('')

  const [novoValor, setNovoValor] = useState('')
  const [novoVencimento, setNovoVencimento] = useState('')

  const { data: boleto } = trpc.boletos.listar.useQuery(undefined, { enabled: !!boletoId && open })
  const boletoAtual = boleto?.find((b) => b.id === boletoId)
  const { data: historico } = trpc.boletos.historico.useQuery({ boletoId: boletoId! }, { enabled: !!boletoId && open })

  useEffect(() => {
    if (!open) {
      setCliente(null)
      setNumeroBoleto('')
      setValorOriginal('')
      setVencimento('')
      setObservacoes('')
      setNovoValor('')
      setNovoVencimento('')
    }
  }, [open])

  function invalidar() {
    utils.boletos.listar.invalidate()
    if (boletoId) utils.boletos.historico.invalidate({ boletoId })
  }

  const criarMut = trpc.boletos.criar.useMutation({
    onSuccess() {
      toast.success('Boleto criado')
      invalidar()
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })
  const alterarValorMut = trpc.boletos.alterarValor.useMutation({
    onSuccess() {
      toast.success('Valor atualizado')
      setNovoValor('')
      invalidar()
    },
    onError: (e) => toast.error(e.message),
  })
  const alterarVencimentoMut = trpc.boletos.alterarVencimento.useMutation({
    onSuccess() {
      toast.success('Vencimento atualizado')
      setNovoVencimento('')
      invalidar()
    },
    onError: (e) => toast.error(e.message),
  })
  const marcarPagoMut = trpc.boletos.marcarPago.useMutation({
    onSuccess() {
      toast.success('Marcado como pago')
      invalidar()
    },
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.boletos.excluir.useMutation({
    onSuccess() {
      toast.success('Boleto excluído')
      invalidar()
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  function handleCriar() {
    if (!cliente) return toast.error('Escolha o cliente')
    const valor = Number(valorOriginal.replace(',', '.'))
    if (!valor || valor <= 0) return toast.error('Informe um valor válido')
    if (!vencimento) return toast.error('Informe o vencimento')
    criarMut.mutate({ clienteId: cliente.id, numeroBoleto: numeroBoleto || undefined, valorOriginal: valor, vencimento, observacoes: observacoes || undefined })
  }

  if (!boletoId) {
    return (
      <Modal open={open} onClose={onClose} title="Novo boleto">
        <div className="space-y-4">
          <ClientePicker label="Cliente" clienteId={cliente?.id ?? null} clienteNome={cliente?.razaoSocial ?? null} onSelect={setCliente} />
          <Input label="Número do boleto" value={numeroBoleto} onChange={(e) => setNumeroBoleto(e.target.value)} placeholder="Opcional" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Valor" value={valorOriginal} onChange={(e) => setValorOriginal(e.target.value)} placeholder="0,00" inputMode="decimal" />
            <Input label="Vencimento" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
          </div>
          <Textarea label="Observações" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} placeholder="Opcional" />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={handleCriar} loading={criarMut.isPending}>
              Criar boleto
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title={boletoAtual ? boletoAtual.cliente.razaoSocial : 'Boleto'} size="lg">
      {boletoAtual && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-dark-500 uppercase tracking-wide">Valor original</p>
              <p className="text-dark-200 font-mono">{boletoAtual.valorOriginal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
            </div>
            <div>
              <p className="text-xs text-dark-500 uppercase tracking-wide">Valor atual</p>
              <p className="text-dark-100 font-mono font-semibold">{boletoAtual.valorAtual.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
            </div>
          </div>

          {boletoAtual.status !== 'pago' && (
            <div className="grid grid-cols-2 gap-3 border-t border-dark-700 pt-4">
              <div className="flex gap-2 items-end">
                <Input label="Alterar valor pra" value={novoValor} onChange={(e) => setNovoValor(e.target.value)} placeholder="0,00" inputMode="decimal" />
                <Button
                  size="sm"
                  loading={alterarValorMut.isPending}
                  onClick={() => {
                    const v = Number(novoValor.replace(',', '.'))
                    if (!v || v <= 0) return toast.error('Valor inválido')
                    alterarValorMut.mutate({ id: boletoId, novoValor: v })
                  }}
                >
                  Salvar
                </Button>
              </div>
              <div className="flex gap-2 items-end">
                <Input label="Alterar vencimento" type="date" value={novoVencimento} onChange={(e) => setNovoVencimento(e.target.value)} />
                <Button
                  size="sm"
                  loading={alterarVencimentoMut.isPending}
                  onClick={() => {
                    if (!novoVencimento) return toast.error('Escolha uma data')
                    alterarVencimentoMut.mutate({ id: boletoId, novoVencimento })
                  }}
                >
                  Salvar
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-dark-700 pt-4">
            {boletoAtual.status !== 'pago' ? (
              <Button variant="secondary" size="sm" onClick={() => marcarPagoMut.mutate({ id: boletoId })} loading={marcarPagoMut.isPending}>
                Marcar como pago
              </Button>
            ) : (
              <span className="text-sm text-green-400 font-medium">✓ Pago</span>
            )}
            <Button variant="danger" size="sm" onClick={() => excluirMut.mutate({ id: boletoId })} loading={excluirMut.isPending}>
              <Trash2 size={14} /> Excluir
            </Button>
          </div>

          <div className="border-t border-dark-700 pt-4">
            <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold mb-2 flex items-center gap-1.5">
              <History size={13} /> Histórico
            </p>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {historico?.map((h) => (
                <div key={h.id} className="text-sm bg-dark-800 border border-dark-600 rounded-lg px-3 py-2">
                  <p className="text-dark-200">
                    {TIPO_LABEL[h.tipo] ?? h.tipo}
                    {h.valorAnterior && h.valorNovo && (
                      <span className="text-dark-400">
                        {' '}
                        — de <span className="text-dark-300">{h.valorAnterior}</span> pra <span className="text-dark-100">{h.valorNovo}</span>
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-dark-500 mt-1">
                    {h.alteradoPor.name} · {formatDateTime(h.createdAt)}
                  </p>
                </div>
              ))}
              {historico?.length === 0 && <p className="text-xs text-dark-500">Nenhuma alteração ainda.</p>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
