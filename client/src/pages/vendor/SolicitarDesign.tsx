import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { Input, Textarea } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'

const TIPO_OPTIONS = [
  { value: 'comunicado', label: 'Comunicado' },
  { value: 'oferta', label: 'Oferta' },
  { value: 'banner', label: 'Banner' },
]

const TIPO_LABELS: Record<string, string> = {
  comunicado: 'Comunicado',
  oferta: 'Oferta',
  banner: 'Banner',
}

const STATUS_BADGE: Record<string, string> = {
  pendente: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  aprovado: 'bg-green-500/15 text-green-400 border-green-500/30',
  recusado: 'bg-red-500/15 text-red-400 border-red-500/30',
}

const STATUS_LABEL: Record<string, string> = {
  pendente: '⏳ Aguardando aprovação',
  aprovado: '✅ Aprovado — liberado pra marketing',
  recusado: '❌ Recusado',
}

const CAMPOS_INICIAIS = {
  tipo: 'comunicado',
  descricao: '',
  preco: '',
  produto: '',
  quantidade: '',
  dataLimiteEntrega: '',
  dataLimiteValidade: '',
  observacoes: '',
}

// Pedido do vendedor pra marketing criar uma arte (comunicado, oferta ou
// banner) — precisa passar pela aprovação do admin antes de ir pra
// marketing (mesmo fluxo de transferência/descarte de carteira).
export default function SolicitarDesign() {
  const utils = trpc.useUtils()
  const { data: pedidos, isLoading } = trpc.design.minhas.useQuery()
  const [campos, setCampos] = useState(CAMPOS_INICIAIS)

  const solicitarMut = trpc.design.solicitar.useMutation({
    onSuccess() {
      toast.success('Pedido de arte enviado pro admin aprovar')
      setCampos(CAMPOS_INICIAIS)
      utils.design.minhas.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function set<K extends keyof typeof CAMPOS_INICIAIS>(campo: K, valor: string) {
    setCampos((prev) => ({ ...prev, [campo]: valor }))
  }

  function enviar() {
    if (!campos.descricao.trim()) return toast.error('Descreva o que a arte precisa transmitir')
    solicitarMut.mutate({
      tipo: campos.tipo as 'comunicado' | 'oferta' | 'banner',
      descricao: campos.descricao,
      preco: campos.preco || undefined,
      produto: campos.produto || undefined,
      quantidade: campos.quantidade || undefined,
      dataLimiteEntrega: campos.dataLimiteEntrega || undefined,
      dataLimiteValidade: campos.dataLimiteValidade || undefined,
      observacoes: campos.observacoes || undefined,
    })
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="font-heading text-2xl text-gold-400 font-bold">Solicitar Arte</h1>
        <p className="text-dark-400 text-sm">
          Peça uma arte pra equipe de marketing (comunicado, oferta ou banner). O pedido precisa ser aprovado pelo
          admin antes de seguir pra marketing.
        </p>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
        <Select
          label="Tipo de arte"
          value={campos.tipo}
          onChange={(e) => set('tipo', e.target.value)}
          options={TIPO_OPTIONS}
        />

        <Textarea
          label="O que a arte precisa transmitir/passar"
          value={campos.descricao}
          onChange={(e) => set('descricao', e.target.value)}
          rows={4}
          placeholder="Ex: comunicado avisando que o showroom vai fechar mais cedo na sexta..."
          required
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Preço (se tiver)"
            value={campos.preco}
            onChange={(e) => set('preco', e.target.value)}
            placeholder="Ex: R$ 199,90"
          />
          <Input
            label="Produto (se tiver)"
            value={campos.produto}
            onChange={(e) => set('produto', e.target.value)}
            placeholder="Ex: Compressor 10 pés"
          />
        </div>

        <Input
          label="Quantidade de produto/página (se tiver)"
          value={campos.quantidade}
          onChange={(e) => set('quantidade', e.target.value)}
          placeholder="Ex: 5 unidades"
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Data limite de entrega"
            type="date"
            value={campos.dataLimiteEntrega}
            onChange={(e) => set('dataLimiteEntrega', e.target.value)}
          />
          <Input
            label="Data limite de validade da oferta/comunicado"
            type="date"
            value={campos.dataLimiteValidade}
            onChange={(e) => set('dataLimiteValidade', e.target.value)}
          />
        </div>

        <Textarea
          label="Observações (preferência de cor, título...)"
          value={campos.observacoes}
          onChange={(e) => set('observacoes', e.target.value)}
          rows={2}
        />

        <Button loading={solicitarMut.isPending} onClick={enviar}>
          Enviar pedido
        </Button>
      </div>

      <div>
        <h2 className="font-heading text-sm text-dark-300 font-semibold mb-2">Meus pedidos</h2>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
          {isLoading && <p className="p-4 text-dark-400 text-sm">Carregando...</p>}
          {!isLoading && !pedidos?.length && (
            <p className="p-4 text-dark-400 text-sm">Nenhum pedido de arte ainda.</p>
          )}
          {pedidos?.map((p) => (
            <div key={p.id} className="p-4 space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-dark-100">
                  {TIPO_LABELS[p.tipo]}{' '}
                  <span className="text-xs font-normal text-dark-500">
                    {new Date(p.createdAt.replace(' ', 'T')).toLocaleDateString('pt-BR')}
                  </span>
                </p>
                <Badge className={STATUS_BADGE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
              </div>
              <p className="text-sm text-dark-300">{p.descricao}</p>
              {p.respostaObservacao && (
                <p className="text-xs text-dark-400 italic">Observação do admin: {p.respostaObservacao}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
