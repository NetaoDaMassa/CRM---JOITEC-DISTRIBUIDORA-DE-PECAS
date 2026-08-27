import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input } from './ui/Input'

const REGIOES = [
  { value: 'norte', label: 'Norte' },
  { value: 'nordeste', label: 'Nordeste' },
  { value: 'centro_oeste', label: 'Centro-Oeste' },
  { value: 'sudeste', label: 'Sudeste' },
  { value: 'sul', label: 'Sul' },
]

// Lead "Ganho" vira cliente de Carteira — o vendedor completa aqui só o que
// falta pro cadastro de verdade (CNPJ/CPF, região etc.); nome/telefone/
// e-mail/cidade já vêm prontos do lead. Não existe em Odin Compressores
// (ver botão condicional em LeadDetail.tsx).
export default function TransferirParaCarteiraModal({
  open,
  onClose,
  leadId,
  leadNome,
  leadCidade,
}: {
  open: boolean
  onClose: () => void
  leadId: number
  leadNome: string
  leadCidade: string | null
}) {
  const utils = trpc.useUtils()
  const [tipoPessoa, setTipoPessoa] = useState<'juridica' | 'fisica'>('juridica')
  const [razaoSocial, setRazaoSocial] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [cpf, setCpf] = useState('')
  const [inscricaoEstadual, setInscricaoEstadual] = useState('')
  const [regiao, setRegiao] = useState('')
  const [estado, setEstado] = useState('')
  const [cidade, setCidade] = useState('')

  useEffect(() => {
    if (open) {
      setRazaoSocial(leadNome)
      setCidade(leadCidade ?? '')
    }
  }, [open, leadNome, leadCidade])

  const mut = trpc.leads.transferirParaCarteira.useMutation({
    onSuccess() {
      toast.success('Cliente cadastrado e adicionado à Carteira')
      utils.leads.get.invalidate({ id: leadId })
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!regiao) return toast.error('Selecione a região')
    mut.mutate({
      leadId,
      razaoSocial,
      cnpj: tipoPessoa === 'juridica' ? cnpj || undefined : undefined,
      cpf: tipoPessoa === 'fisica' ? cpf || undefined : undefined,
      inscricaoEstadual: inscricaoEstadual || undefined,
      regiao: regiao as any,
      estado: estado || undefined,
      cidade: cidade || undefined,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Transferir pra Carteira">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-dark-500">Complete o cadastro pra esse lead virar cliente de verdade na Carteira.</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTipoPessoa('juridica')}
            className={`flex-1 text-sm rounded-xl px-3 py-2 border ${tipoPessoa === 'juridica' ? 'bg-gold-500/10 border-gold-500 text-gold-300' : 'border-dark-600 text-dark-300'}`}
          >
            Pessoa Jurídica
          </button>
          <button
            type="button"
            onClick={() => setTipoPessoa('fisica')}
            className={`flex-1 text-sm rounded-xl px-3 py-2 border ${tipoPessoa === 'fisica' ? 'bg-gold-500/10 border-gold-500 text-gold-300' : 'border-dark-600 text-dark-300'}`}
          >
            Pessoa Física
          </button>
        </div>
        {tipoPessoa === 'juridica' ? (
          <Input label="CNPJ (opcional)" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
        ) : (
          <Input label="CPF (opcional)" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
        )}
        <Input label="Razão social / Nome" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} required />
        {tipoPessoa === 'juridica' && <Input label="Inscrição Estadual (opcional)" value={inscricaoEstadual} onChange={(e) => setInscricaoEstadual(e.target.value)} />}
        <div className="grid grid-cols-3 gap-3">
          <Select label="Região" value={regiao} onChange={(e) => setRegiao(e.target.value)} placeholder="Selecione..." options={REGIOES} />
          <Input label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)} />
          <Input label="Cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} />
        </div>
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" loading={mut.isPending}>
            Confirmar e adicionar à Carteira
          </Button>
        </div>
      </form>
    </Modal>
  )
}
