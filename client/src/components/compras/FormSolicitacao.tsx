import { useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Trash2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { Input, Textarea } from '../ui/Input'
import Select from '../ui/Select'
import Button from '../ui/Button'
import { parseValorBr, formatarValorInput } from '../../lib/valorBr'
import { TIPO_INFO } from '../../lib/comprasShared'
import { corTexto } from '../../lib/corTexto'

type Item = { descricao: string; quantidade: string; unidade: string; codigo: string; observacao: string }

export type DadosIniciais = {
  id: number
  empresaId: number
  tipo: 'revenda' | 'uso_consumo'
  categoriaId: number | null
  titulo: string
  justificativa: string | null
  prioridade: 'baixa' | 'normal' | 'urgente'
  dataNecessidade: string | null
  setor: string | null
  valorEstimado: number | null
  itens: { descricao: string; quantidade: number; unidade: string; codigo: string | null; observacao: string | null }[]
}

const itemVazio = (): Item => ({ descricao: '', quantidade: '1', unidade: 'un', codigo: '', observacao: '' })
const UNIDADES = ['un', 'cx', 'pct', 'kg', 'g', 'l', 'ml', 'm', 'm²', 'm³', 'rolo', 'par', 'jogo', 'kit', 'barra', 'peça', 'serviço']

// Formulário de solicitação de compra — usado pra abrir (Solicitar compra)
// e pra editar (detalhe da compra, enquanto ninguém começou a cotar).
export default function FormSolicitacao({ inicial, onPronto, onCancelar }: { inicial?: DadosIniciais; onPronto: (id: number) => void; onCancelar?: () => void }) {
  const { empresaAtivaId, user } = useAuth()
  const utils = trpc.useUtils()
  const { data: aux } = trpc.comprasProcesso.auxiliares.useQuery()

  const [empresaId, setEmpresaId] = useState<number | ''>(inicial?.empresaId ?? empresaAtivaId ?? user?.empresaId ?? '')
  const [tipo, setTipo] = useState<'revenda' | 'uso_consumo'>(inicial?.tipo ?? 'uso_consumo')
  const [categoriaId, setCategoriaId] = useState<number | ''>(inicial?.categoriaId ?? '')
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '')
  const [justificativa, setJustificativa] = useState(inicial?.justificativa ?? '')
  const [prioridade, setPrioridade] = useState<'baixa' | 'normal' | 'urgente'>(inicial?.prioridade ?? 'normal')
  const [dataNecessidade, setDataNecessidade] = useState(inicial?.dataNecessidade ?? '')
  const [setor, setSetor] = useState(inicial?.setor ?? '')
  const [valorEstimado, setValorEstimado] = useState(formatarValorInput(inicial?.valorEstimado))
  const [itens, setItens] = useState<Item[]>(
    inicial?.itens.length
      ? inicial.itens.map((i) => ({ descricao: i.descricao, quantidade: String(i.quantidade).replace('.', ','), unidade: i.unidade, codigo: i.codigo ?? '', observacao: i.observacao ?? '' }))
      : [itemVazio()]
  )

  const categorias = (aux?.categorias ?? []).filter((c) => (c.ativo || c.id === inicial?.categoriaId) && (c.tipo === 'ambos' || c.tipo === tipo))

  const aoSalvar = (id: number) => {
    utils.comprasProcesso.invalidate()
    onPronto(id)
  }
  const criarMut = trpc.comprasProcesso.solicitar.useMutation({
    onSuccess: (r) => {
      toast.success(`Solicitação #${r.id} enviada pro Compras`)
      aoSalvar(r.id)
    },
    onError: (e) => toast.error(e.message),
  })
  const editarMut = trpc.comprasProcesso.editar.useMutation({
    onSuccess: () => {
      toast.success('Solicitação atualizada')
      aoSalvar(inicial!.id)
    },
    onError: (e) => toast.error(e.message),
  })

  function mudarItem(i: number, campo: keyof Item, valor: string) {
    setItens((atual) => atual.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)))
  }

  function enviar() {
    if (!empresaId) return toast.error('Escolha a empresa')
    if (titulo.trim().length < 3) return toast.error('Dê um título curto pra compra')
    const itensValidos = itens.filter((i) => i.descricao.trim())
    if (!itensValidos.length) return toast.error('Coloque pelo menos um item')
    const convertidos = itensValidos.map((i) => ({
      descricao: i.descricao.trim(),
      quantidade: parseValorBr(i.quantidade || '1'),
      unidade: i.unidade || 'un',
      codigo: i.codigo || null,
      observacao: i.observacao || null,
    }))
    if (convertidos.some((i) => !(i.quantidade > 0))) return toast.error('Confira as quantidades')
    const dados = {
      empresaId: Number(empresaId),
      tipo,
      categoriaId: categoriaId === '' ? null : Number(categoriaId),
      titulo,
      justificativa: justificativa || null,
      prioridade,
      dataNecessidade: dataNecessidade || null,
      setor: setor || null,
      valorEstimado: valorEstimado.trim() ? parseValorBr(valorEstimado) : null,
      itens: convertidos,
    }
    if (inicial) editarMut.mutate({ id: inicial.id, ...dados })
    else criarMut.mutate(dados)
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-dark-200 font-medium mb-1.5">É compra pra quê?</p>
        <div className="grid grid-cols-2 gap-2">
          {(['uso_consumo', 'revenda'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTipo(t)
                setCategoriaId('')
              }}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${tipo === t ? 'border-transparent' : 'border-dark-600 hover:border-dark-500'}`}
              style={tipo === t ? { background: `${TIPO_INFO[t].cor}22`, boxShadow: `inset 0 0 0 1.5px ${TIPO_INFO[t].cor}` } : undefined}
            >
              <span className="block text-sm font-semibold" style={{ color: corTexto(tipo === t ? TIPO_INFO[t].cor : undefined) }}>
                {TIPO_INFO[t].label}
              </span>
              <span className="block text-xs text-dark-400">{t === 'revenda' ? 'Mercadoria que vai ser vendida' : 'Usado aqui dentro (escritório, limpeza, manutenção...)'}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="O que precisa comprar (título)" placeholder="ex: Papel A4 pro escritório" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        <Select
          label="Empresa"
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value ? Number(e.target.value) : '')}
          options={(aux?.empresas ?? []).map((e) => ({ value: e.id, label: e.nome }))}
          placeholder="Escolha..."
        />
        <Select
          label="Categoria"
          value={categoriaId}
          onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : '')}
          options={categorias.map((c) => ({ value: c.id, label: c.nome }))}
          placeholder="Escolha..."
        />
        <Input label="Setor / quem vai usar" placeholder="ex: Expedição, Loja, Financeiro" value={setor} onChange={(e) => setSetor(e.target.value)} />
        <Input label="Precisa até quando?" type="date" value={dataNecessidade} onChange={(e) => setDataNecessidade(e.target.value)} />
        <div className="flex flex-col gap-1">
          <span className="text-sm text-dark-200 font-medium">Prioridade</span>
          <div className="flex gap-1.5">
            {(['baixa', 'normal', 'urgente'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPrioridade(p)}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm capitalize ${
                  prioridade === p ? (p === 'urgente' ? 'border-red-500 bg-red-500/15 text-red-300' : 'border-gold-600 bg-gold-600/15 text-gold-300') : 'border-dark-600 text-dark-400'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <p className="text-sm text-dark-200 font-medium mb-1.5">Itens</p>
        <div className="space-y-2">
          {itens.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start rounded-xl border border-dark-700 bg-dark-900/40 p-2">
              <div className="col-span-12 sm:col-span-5">
                <Input placeholder="Descrição do item" value={it.descricao} onChange={(e) => mudarItem(i, 'descricao', e.target.value)} />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <Input placeholder="Qtd" inputMode="decimal" value={it.quantidade} onChange={(e) => mudarItem(i, 'quantidade', e.target.value)} />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <Select value={it.unidade} onChange={(e) => mudarItem(i, 'unidade', e.target.value)} options={UNIDADES.map((u) => ({ value: u, label: u }))} />
              </div>
              <div className="col-span-3 sm:col-span-2">
                <Input placeholder="Código (opc.)" value={it.codigo} onChange={(e) => mudarItem(i, 'codigo', e.target.value)} />
              </div>
              <button
                type="button"
                title="Tirar item"
                onClick={() => setItens((a) => (a.length > 1 ? a.filter((_, idx) => idx !== i) : [itemVazio()]))}
                className="col-span-1 h-9 flex items-center justify-center rounded-lg text-dark-400 hover:text-red-400 hover:bg-dark-700"
              >
                <Trash2 size={15} />
              </button>
              <div className="col-span-12">
                <Input placeholder="Observação do item (marca, modelo, link, cor...)" value={it.observacao} onChange={(e) => mudarItem(i, 'observacao', e.target.value)} />
              </div>
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setItens((a) => [...a, itemVazio()])}>
          <Plus size={15} /> Adicionar item
        </Button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <Textarea label="Por que precisa? (justificativa)" rows={2} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
        </div>
        <Input label="Valor estimado (opcional)" placeholder="R$" inputMode="decimal" value={valorEstimado} onChange={(e) => setValorEstimado(e.target.value)} />
      </div>

      <div className="flex justify-end gap-2">
        {onCancelar && (
          <Button variant="secondary" onClick={onCancelar}>
            Cancelar
          </Button>
        )}
        <Button onClick={enviar} loading={criarMut.isPending || editarMut.isPending}>
          {inicial ? 'Salvar alterações' : 'Enviar solicitação'}
        </Button>
      </div>
    </div>
  )
}
