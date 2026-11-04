import { useState } from 'react'
import toast from 'react-hot-toast'
import { Star } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Modal from '../ui/Modal'
import { Input, Textarea } from '../ui/Input'
import Button from '../ui/Button'

export type FornecedorEditavel = {
  id: number
  nome: string
  razaoSocial: string | null
  cnpj: string | null
  contato: string | null
  telefone: string | null
  email: string | null
  cidade: string | null
  uf: string | null
  fornece: string | null
  condicaoPagamento: string | null
  prazoEntregaDias: number | null
  avaliacao: number | null
  observacoes: string | null
  ativo: boolean
}

export default function ModalFornecedor({ fornecedor, onClose, onSalvo }: { fornecedor?: FornecedorEditavel | null; onClose: () => void; onSalvo?: (id: number) => void }) {
  const utils = trpc.useUtils()
  const [f, setF] = useState({
    nome: fornecedor?.nome ?? '',
    razaoSocial: fornecedor?.razaoSocial ?? '',
    cnpj: fornecedor?.cnpj ?? '',
    contato: fornecedor?.contato ?? '',
    telefone: fornecedor?.telefone ?? '',
    email: fornecedor?.email ?? '',
    cidade: fornecedor?.cidade ?? '',
    uf: fornecedor?.uf ?? '',
    fornece: fornecedor?.fornece ?? '',
    condicaoPagamento: fornecedor?.condicaoPagamento ?? '',
    prazoEntregaDias: fornecedor?.prazoEntregaDias != null ? String(fornecedor.prazoEntregaDias) : '',
    avaliacao: fornecedor?.avaliacao ?? 0,
    observacoes: fornecedor?.observacoes ?? '',
    ativo: fornecedor?.ativo ?? true,
  })
  const set = (campo: keyof typeof f) => (e: { target: { value: string } }) => setF((a) => ({ ...a, [campo]: e.target.value }))

  const salvarMut = trpc.comprasProcesso.salvarFornecedor.useMutation({
    onSuccess: (r) => {
      toast.success('Fornecedor salvo')
      utils.comprasProcesso.fornecedores.invalidate()
      utils.comprasProcesso.auxiliares.invalidate()
      onSalvo?.(r.id)
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Modal open onClose={onClose} title={fornecedor ? 'Editar fornecedor' : 'Novo fornecedor'} size="lg">
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="Nome (como vocês chamam)" value={f.nome} onChange={set('nome')} />
          <Input label="CNPJ" value={f.cnpj} onChange={set('cnpj')} />
          <div className="sm:col-span-2">
            <Input label="Razão social" value={f.razaoSocial} onChange={set('razaoSocial')} />
          </div>
          <Input label="Contato (vendedor lá)" value={f.contato} onChange={set('contato')} />
          <Input label="Telefone / WhatsApp" value={f.telefone} onChange={set('telefone')} />
          <Input label="E-mail" type="email" value={f.email} onChange={set('email')} />
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Input label="Cidade" value={f.cidade} onChange={set('cidade')} />
            </div>
            <Input label="UF" maxLength={2} value={f.uf} onChange={set('uf')} />
          </div>
          <div className="sm:col-span-2">
            <Input label="O que fornece" placeholder="ex: tubos PPR, material de limpeza, papelaria" value={f.fornece} onChange={set('fornece')} />
          </div>
          <Input label="Condição de pagamento padrão" placeholder="ex: 28/56 dias, boleto" value={f.condicaoPagamento} onChange={set('condicaoPagamento')} />
          <Input label="Prazo de entrega (dias)" inputMode="numeric" value={f.prazoEntregaDias} onChange={set('prazoEntregaDias')} />
        </div>
        <div>
          <p className="text-sm text-dark-200 font-medium mb-1">Avaliação interna</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setF((a) => ({ ...a, avaliacao: a.avaliacao === n ? 0 : n }))} className="p-0.5">
                <Star size={22} className={n <= f.avaliacao ? 'fill-amber-400 text-amber-400' : 'text-dark-500'} />
              </button>
            ))}
          </div>
        </div>
        <Textarea label="Observações" rows={2} value={f.observacoes} onChange={set('observacoes')} />
        {fornecedor && (
          <label className="flex items-center gap-2 text-sm text-dark-200">
            <input type="checkbox" checked={f.ativo} onChange={(e) => setF((a) => ({ ...a, ativo: e.target.checked }))} />
            Fornecedor ativo (desmarcado some da lista de cotação)
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={salvarMut.isPending}
            onClick={() => {
              if (f.nome.trim().length < 2) return toast.error('Informe o nome do fornecedor')
              const prazo = f.prazoEntregaDias.trim() ? Number(f.prazoEntregaDias.replace(/\D/g, '')) : null
              salvarMut.mutate({
                id: fornecedor?.id,
                ...f,
                prazoEntregaDias: prazo,
                avaliacao: f.avaliacao || null,
              })
            }}
          >
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
