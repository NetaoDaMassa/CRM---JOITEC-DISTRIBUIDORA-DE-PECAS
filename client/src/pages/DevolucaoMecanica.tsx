import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import { Textarea } from '../components/ui/Input'

const STATUS_LABEL: Record<string, string> = {
  enviado: 'Enviado',
  retornado: 'Retornado',
  testado: 'Testado',
  arrumado: 'Arrumado',
  descarte: 'Descarte',
  recebido: 'Recebido',
  manutencao: 'Manutenção',
}

const COLUNAS = ['enviado', 'retornado', 'testado', 'arrumado', 'descarte', 'manutencao', 'recebido']

function formatarData(v: string | null): string {
  if (!v) return '—'
  return new Date(v.replace(' ', 'T')).toLocaleString('pt-BR')
}

function AtualizarStatusModal({ item, onClose }: { item: any; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [status, setStatus] = useState(item.status)
  const [observacao, setObservacao] = useState('')
  const [descricaoManutencao, setDescricaoManutencao] = useState('')
  const [condicaoRetorno, setCondicaoRetorno] = useState('')
  const [motivoDescarte, setMotivoDescarte] = useState('')

  const mut = trpc.devolucoes.atualizarStatusMecanica.useMutation({
    onSuccess() {
      toast.success('Item atualizado')
      utils.devolucoes.listarMecanica.invalidate()
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function salvar() {
    if (status === 'descarte' && !motivoDescarte.trim()) return toast.error('Informe o motivo do descarte')
    mut.mutate({
      id: item.id,
      status,
      observacao: observacao || undefined,
      descricaoManutencao: descricaoManutencao || undefined,
      condicaoRetorno: (condicaoRetorno || undefined) as any,
      motivoDescarte: motivoDescarte || undefined,
    })
  }

  return (
    <Modal open onClose={onClose} title={`${item.chamado?.protocolo ?? ''} — ${item.descricaoItem}`} size="md">
      <div className="space-y-4">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={COLUNAS.map((c) => ({ value: c, label: STATUS_LABEL[c] }))} />
        {status === 'testado' && (
          <Select
            label="Condição do retorno"
            value={condicaoRetorno}
            onChange={(e) => setCondicaoRetorno(e.target.value)}
            placeholder="Selecione..."
            options={[
              { value: 'novo', label: 'Novo' },
              { value: 'usado', label: 'Usado' },
            ]}
          />
        )}
        {status === 'manutencao' && (
          <Textarea label="Descrição da manutenção" rows={3} value={descricaoManutencao} onChange={(e) => setDescricaoManutencao(e.target.value)} />
        )}
        {status === 'descarte' && (
          <Textarea label="Motivo do descarte" rows={2} value={motivoDescarte} onChange={(e) => setMotivoDescarte(e.target.value)} required />
        )}
        <Textarea label="Observação (opcional)" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        <div className="text-xs text-dark-500 space-y-0.5">
          <p>Enviado: {formatarData(item.enviadoEm)}</p>
          <p>Retornado: {formatarData(item.retornadoEm)}</p>
          <p>Testado: {formatarData(item.testadoEm)}</p>
          <p>Resolvido: {formatarData(item.resolvidoEm)}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={mut.isPending} onClick={salvar}>
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Sub-kanban da Mecânica — itens enviados de um chamado de Devolução pra
// teste/conserto/descarte, independente do Kanban principal.
export default function DevolucaoMecanica() {
  const { data: itens, isLoading } = trpc.devolucoes.listarMecanica.useQuery()
  const [itemAberto, setItemAberto] = useState<any>(null)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-heading text-2xl text-gold-400 font-bold">Mecânica</h1>
        <p className="text-dark-400 text-sm">Itens enviados pra teste/conserto/descarte.</p>
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}

      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${COLUNAS.length}, minmax(200px, 1fr))` }}>
        {COLUNAS.map((status) => {
          const cards = (itens ?? []).filter((i) => i.status === status)
          return (
            <div key={status} className="bg-dark-900/40 border border-dark-700 rounded-2xl p-3 min-h-[200px]">
              <p className="text-xs font-bold text-dark-300 uppercase tracking-wide mb-3">
                {STATUS_LABEL[status]} <span className="text-dark-500 font-normal">({cards.length})</span>
              </p>
              <div className="space-y-2">
                {cards.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => setItemAberto(i)}
                    className="w-full text-left bg-dark-800 border border-dark-600 hover:border-gold-600/50 rounded-xl p-3 transition-colors"
                  >
                    <p className="text-sm font-medium text-dark-100 truncate">{i.descricaoItem}</p>
                    <p className="text-xs text-dark-400">{(i as any).chamado?.protocolo}</p>
                    <p className="text-[10px] text-dark-500 mt-1">{(i as any).chamado?.clienteNome}</p>
                    {(i as any).empresa?.nome && <p className="text-[10px] text-gold-500/70 mt-0.5">{(i as any).empresa.nome}</p>}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {itemAberto && <AtualizarStatusModal item={itemAberto} onClose={() => setItemAberto(null)} />}
    </div>
  )
}
