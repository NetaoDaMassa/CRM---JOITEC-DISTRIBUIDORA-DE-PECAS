import { useState } from 'react'
import toast from 'react-hot-toast'
import { CreditCard, Paperclip, Trash2, Pencil, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { hojeBrString } from '../../lib/utils'
import { parseValorBr } from '../../lib/valorBr'

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const CATEGORIA_LABEL: Record<string, string> = {
  combustivel: 'Combustível',
  alimentacao: 'Alimentação',
  hospedagem: 'Hospedagem',
  pedagio: 'Pedágio',
  manutencao: 'Manutenção',
  outro: 'Outro',
}

type Anexo = { urlArquivo: string; nomeArquivo: string; tipoArquivo?: string }

async function fazerUpload(file: File): Promise<Anexo> {
  const formData = new FormData()
  formData.append('file', file)
  const token = localStorage.getItem('odin_token')
  const resp = await fetch('/upload/cartao-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
  const json = await resp.json()
  if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
  return { urlArquivo: json.path, nomeArquivo: json.nome, tipoArquivo: json.tipo }
}

// Formulário de lançamento — data/valor/categoria/descrição + pelo menos 1
// anexo (nota fiscal ou cupom fiscal) obrigatório. Pedido do João,
// 2026-09-15: "eles têm que colocar tudo que gastou, quando gastou, e a
// nota fiscal e cupom fiscal".
function FormularioNovoGasto() {
  const utils = trpc.useUtils()
  const [data, setData] = useState(hojeBrString())
  const [valor, setValor] = useState('')
  const [categoria, setCategoria] = useState('')
  const [descricao, setDescricao] = useState('')
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [enviandoArquivo, setEnviandoArquivo] = useState(false)

  const criarMut = trpc.cartao.criar.useMutation({
    onSuccess() {
      toast.success('Gasto lançado')
      setData(hojeBrString())
      setValor('')
      setCategoria('')
      setDescricao('')
      setAnexos([])
      utils.cartao.meusGastos.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  async function onSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setEnviandoArquivo(true)
    try {
      const anexo = await fazerUpload(file)
      setAnexos((prev) => [...prev, anexo])
    } catch (err: any) {
      toast.error(err.message ?? 'Erro no upload')
    } finally {
      setEnviandoArquivo(false)
    }
  }

  function lancar() {
    const valorNumero = parseValorBr(valor)
    if (!valorNumero) {
      toast.error('Preencha o valor')
      return
    }
    if (!anexos.length) {
      toast.error('Anexe a nota fiscal ou o cupom fiscal')
      return
    }
    criarMut.mutate({ data, valor: valorNumero, categoria: (categoria || undefined) as any, descricao: descricao || undefined, anexos })
  }

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-medium text-dark-100">Novo gasto</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Input label="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <Input label="Valor" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$ 0,00" />
        <Select
          label="Categoria (opcional)"
          placeholder="Selecione"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          options={Object.entries(CATEGORIA_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <Input label="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: almoço com cliente" />
      </div>

      <div className="space-y-2">
        <p className="text-sm text-dark-200 font-medium">Nota fiscal / cupom fiscal</p>
        <div className="flex items-center gap-2 flex-wrap">
          {anexos.map((a, i) => (
            <span key={i} className="flex items-center gap-1 text-xs bg-dark-700 border border-dark-600 rounded-full px-2 py-1 text-dark-200">
              <Paperclip size={11} /> {a.nomeArquivo}
              <button type="button" onClick={() => setAnexos((prev) => prev.filter((_, idx) => idx !== i))} className="text-dark-500 hover:text-red-400">
                <X size={11} />
              </button>
            </span>
          ))}
          <label className="text-xs text-gold-400 hover:underline cursor-pointer">
            {enviandoArquivo ? 'Enviando...' : '+ anexar foto/PDF'}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onSelecionarArquivo} disabled={enviandoArquivo} />
          </label>
        </div>
      </div>

      <Button loading={criarMut.isPending} onClick={lancar}>
        Lançar gasto
      </Button>
    </div>
  )
}

type Gasto = {
  id: number
  data: string
  valor: number
  categoria: string | null
  descricao: string | null
  anexos: { id: number; urlArquivo: string; nomeArquivo: string }[]
}

function LinhaGasto({ g }: { g: Gasto }) {
  const utils = trpc.useUtils()
  const [editando, setEditando] = useState(false)
  const [data, setData] = useState(g.data)
  const [valor, setValor] = useState(String(g.valor))
  const [categoria, setCategoria] = useState(g.categoria ?? '')
  const [descricao, setDescricao] = useState(g.descricao ?? '')

  function invalidar() {
    utils.cartao.meusGastos.invalidate()
  }

  const editarMut = trpc.cartao.editar.useMutation({
    onSuccess() {
      toast.success('Gasto atualizado')
      setEditando(false)
      invalidar()
    },
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.cartao.excluir.useMutation({ onSuccess: invalidar, onError: (e) => toast.error(e.message) })

  if (editando) {
    return (
      <div className="p-3 space-y-2 bg-dark-750">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$ 0,00" />
          <Select
            placeholder="Categoria"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            options={Object.entries(CATEGORIA_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição" />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            loading={editarMut.isPending}
            onClick={() =>
              editarMut.mutate({ id: g.id, data, valor: parseValorBr(valor), categoria: (categoria || undefined) as any, descricao: descricao || undefined })
            }
          >
            Salvar
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditando(false)}>
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p className="text-sm text-dark-100">
          {new Date(g.data + 'T00:00:00').toLocaleDateString('pt-BR')} — <span className="font-medium">{formatarMoeda(g.valor)}</span>
          {g.categoria && <span className="text-xs text-dark-400 ml-2">{CATEGORIA_LABEL[g.categoria]}</span>}
        </p>
        {g.descricao && <p className="text-xs text-dark-400">{g.descricao}</p>}
        <div className="flex gap-2 mt-1">
          {g.anexos.map((a) => (
            <a key={a.id} href={a.urlArquivo} target="_blank" rel="noreferrer" className="text-xs text-gold-400 hover:underline flex items-center gap-1">
              <Paperclip size={10} /> {a.nomeArquivo}
            </a>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setEditando(true)} className="text-dark-500 hover:text-gold-400" title="Editar">
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm('Excluir esse gasto?')) excluirMut.mutate({ id: g.id })
          }}
          className="text-dark-500 hover:text-red-400"
          title="Excluir"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

export default function CartaoCredito() {
  const { data: gastos, isLoading } = trpc.cartao.meusGastos.useQuery()

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <CreditCard size={20} className="text-gold-400" />
        <div>
          <h1 className="font-heading text-xl text-dark-50">Cartão de Crédito</h1>
          <p className="text-sm text-dark-400">Lance seus gastos com o cartão corporativo, sempre com a nota fiscal ou o cupom fiscal anexado.</p>
        </div>
      </div>

      <FormularioNovoGasto />

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <p className="p-4 text-dark-400 text-sm">Carregando...</p>}
        {!isLoading && !gastos?.length && <p className="p-4 text-dark-400 text-sm">Nenhum gasto lançado ainda.</p>}
        {gastos?.map((g) => (
          <LinhaGasto key={g.id} g={g} />
        ))}
      </div>
    </div>
  )
}
