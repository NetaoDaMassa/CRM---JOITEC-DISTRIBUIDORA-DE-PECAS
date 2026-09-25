import { useState } from 'react'
import toast from 'react-hot-toast'
import { Fuel, Plus, Trash2, Pencil } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { hojeBrString } from '../../lib/utils'
import { parseValorBr } from '../../lib/valorBr'

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Novo colaborador (motorista) — nome + empresa, sem login próprio no CRM
// (quem lança é sempre alguém do Financeiro/Compras). Pedido do João,
// 2026-09-15: "o que não tiver cadastro pode cadastrar na sua empresa
// respectiva".
function ModalNovoColaborador({ open, onClose, onCriado }: { open: boolean; onClose: () => void; onCriado: (id: number) => void }) {
  const [nome, setNome] = useState('')
  const [empresaId, setEmpresaId] = useState('')
  const { data: empresas } = trpc.empresas.list.useQuery(undefined, { enabled: open })

  const criarMut = trpc.requisicaoPosto.colaboradorCriar.useMutation({
    onSuccess(criado) {
      toast.success('Colaborador cadastrado')
      onCriado(criado.id)
      setNome('')
      setEmpresaId('')
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Modal open={open} onClose={onClose} title="Novo colaborador" size="sm">
      <div className="space-y-3">
        <Input label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Jaciel" />
        <Select
          label="Empresa"
          placeholder="Selecione a empresa"
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          options={(empresas ?? []).map((e) => ({ value: e.id, label: e.nome }))}
        />
        <Button
          className="w-full"
          loading={criarMut.isPending}
          disabled={!nome.trim() || !empresaId}
          onClick={() => criarMut.mutate({ nome: nome.trim(), empresaId: Number(empresaId) })}
        >
          Cadastrar
        </Button>
      </div>
    </Modal>
  )
}

function ModalNovaPlaca({ open, onClose, onCriado }: { open: boolean; onClose: () => void; onCriado: (id: number) => void }) {
  const [placa, setPlaca] = useState('')

  const criarMut = trpc.requisicaoPosto.veiculoCriar.useMutation({
    onSuccess(criado) {
      toast.success('Placa cadastrada')
      onCriado(criado.id)
      setPlaca('')
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Modal open={open} onClose={onClose} title="Nova placa" size="sm">
      <div className="space-y-3">
        <Input label="Placa" value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="Ex: RLK 3D96" />
        <Button className="w-full" loading={criarMut.isPending} disabled={!placa.trim()} onClick={() => criarMut.mutate({ placa: placa.trim() })}>
          Cadastrar
        </Button>
      </div>
    </Modal>
  )
}

// Formulário de lançamento — Financeiro/Compras escolhe o colaborador (já
// mostra a empresa dele) e o carro num menu, digita o valor e marca se o
// canhoto já foi entregue. Reseta pra um novo lançamento depois de salvar
// (fica pronto pro próximo, que costuma vir em sequência na planilha real).
function FormularioNovaRequisicao() {
  const utils = trpc.useUtils()
  const [data, setData] = useState(hojeBrString())
  const [colaboradorId, setColaboradorId] = useState('')
  const [veiculoId, setVeiculoId] = useState('')
  const [valor, setValor] = useState('')
  const [canhotoEntregue, setCanhotoEntregue] = useState(false)
  const [modalColaborador, setModalColaborador] = useState(false)
  const [modalPlaca, setModalPlaca] = useState(false)

  const { data: colaboradores } = trpc.requisicaoPosto.colaboradoresListar.useQuery()
  const { data: veiculos } = trpc.requisicaoPosto.veiculosListar.useQuery()

  function invalidar() {
    utils.requisicaoPosto.listar.invalidate()
    utils.requisicaoPosto.relatorioMensal.invalidate()
  }

  const criarMut = trpc.requisicaoPosto.criar.useMutation({
    onSuccess() {
      toast.success('Requisição lançada')
      setColaboradorId('')
      setVeiculoId('')
      setValor('')
      setCanhotoEntregue(false)
      invalidar()
    },
    onError: (e) => toast.error(e.message),
  })

  function lancar() {
    const valorNumero = parseValorBr(valor)
    if (!colaboradorId || !veiculoId || !valorNumero) {
      toast.error('Preencha colaborador, carro e valor')
      return
    }
    criarMut.mutate({ colaboradorId: Number(colaboradorId), veiculoId: Number(veiculoId), data, valor: valorNumero, canhotoEntregue })
  }

  return (
    <>
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-medium text-dark-100">Lançar requisição</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <Input label="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <div className="flex items-end gap-1">
            <div className="flex-1">
              <Select
                label="Colaborador"
                placeholder="Selecione"
                value={colaboradorId}
                onChange={(e) => setColaboradorId(e.target.value)}
                options={(colaboradores ?? []).map((c) => ({ value: c.id, label: `${c.nome} (${c.empresaNome})` }))}
              />
            </div>
            <button type="button" onClick={() => setModalColaborador(true)} className="text-dark-500 hover:text-gold-400 pb-2" title="Novo colaborador">
              <Plus size={16} />
            </button>
          </div>
          <div className="flex items-end gap-1">
            <div className="flex-1">
              <Select
                label="Carro"
                placeholder="Selecione"
                value={veiculoId}
                onChange={(e) => setVeiculoId(e.target.value)}
                options={(veiculos ?? []).map((v) => ({ value: v.id, label: v.placa }))}
              />
            </div>
            <button type="button" onClick={() => setModalPlaca(true)} className="text-dark-500 hover:text-gold-400 pb-2" title="Nova placa">
              <Plus size={16} />
            </button>
          </div>
          <Input label="Valor" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$ 0,00" />
          <label className="flex items-center gap-2 text-sm text-dark-300 pb-2">
            <input type="checkbox" checked={canhotoEntregue} onChange={(e) => setCanhotoEntregue(e.target.checked)} className="accent-gold-600" />
            Canhoto já entregue
          </label>
        </div>
        <Button loading={criarMut.isPending} onClick={lancar}>
          Lançar
        </Button>
      </div>

      <ModalNovoColaborador open={modalColaborador} onClose={() => setModalColaborador(false)} onCriado={(id) => setColaboradorId(String(id))} />
      <ModalNovaPlaca open={modalPlaca} onClose={() => setModalPlaca(false)} onCriado={(id) => setVeiculoId(String(id))} />
    </>
  )
}

type Requisicao = {
  id: number
  data: string
  valor: number
  canhotoEntregue: boolean
  colaboradorId: number
  colaboradorNome: string
  empresaNome: string
  veiculoId: number
  placa: string
  criadoPorNome: string | null
}

// Edição de um lançamento já feito (data/colaborador/carro/valor) — pedido
// do João, 2026-09-25: corrigir valor digitado errado sem apagar e
// relançar. Canhoto continua editável direto na lista (não entra aqui).
function LinhaRequisicao({ r }: { r: Requisicao }) {
  const utils = trpc.useUtils()
  const [editando, setEditando] = useState(false)
  const [data, setData] = useState(r.data)
  const [colaboradorId, setColaboradorId] = useState(String(r.colaboradorId))
  const [veiculoId, setVeiculoId] = useState(String(r.veiculoId))
  const [valor, setValor] = useState(String(r.valor))

  const { data: colaboradores } = trpc.requisicaoPosto.colaboradoresListar.useQuery(undefined, { enabled: editando })
  const { data: veiculos } = trpc.requisicaoPosto.veiculosListar.useQuery(undefined, { enabled: editando })

  function invalidar() {
    utils.requisicaoPosto.listar.invalidate()
    utils.requisicaoPosto.relatorioMensal.invalidate()
  }

  const canhotoMut = trpc.requisicaoPosto.atualizarCanhoto.useMutation({ onSuccess: invalidar, onError: (e) => toast.error(e.message) })
  const excluirMut = trpc.requisicaoPosto.excluir.useMutation({ onSuccess: invalidar, onError: (e) => toast.error(e.message) })
  const editarMut = trpc.requisicaoPosto.editar.useMutation({
    onSuccess() {
      toast.success('Lançamento atualizado')
      setEditando(false)
      invalidar()
    },
    onError: (e) => toast.error(e.message),
  })

  if (editando) {
    return (
      <tr className="border-t border-dark-700 bg-dark-750">
        <td className="px-3 py-2">
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-36" />
        </td>
        <td className="px-3 py-2" colSpan={2}>
          <Select
            value={colaboradorId}
            onChange={(e) => setColaboradorId(e.target.value)}
            options={(colaboradores ?? []).map((c) => ({ value: c.id, label: `${c.nome} (${c.empresaNome})` }))}
          />
        </td>
        <td className="px-3 py-2">
          <Select value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)} options={(veiculos ?? []).map((v) => ({ value: v.id, label: v.placa }))} />
        </td>
        <td className="px-3 py-2">
          <Input value={valor} onChange={(e) => setValor(e.target.value)} className="w-24" />
        </td>
        <td className="px-3 py-2 text-xs text-dark-500">canhoto: {r.canhotoEntregue ? 'entregue' : 'não entregue'}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <Button
            size="sm"
            loading={editarMut.isPending}
            onClick={() =>
              editarMut.mutate({ id: r.id, data, colaboradorId: Number(colaboradorId), veiculoId: Number(veiculoId), valor: parseValorBr(valor) })
            }
          >
            Salvar
          </Button>
          <button type="button" onClick={() => setEditando(false)} className="text-xs text-dark-500 hover:text-dark-200 ml-2">
            cancelar
          </button>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-t border-dark-700">
      <td className="px-3 py-2 text-dark-300 whitespace-nowrap">{new Date(r.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
      <td className="px-3 py-2 text-dark-100">{r.colaboradorNome}</td>
      <td className="px-3 py-2">
        <Badge className="bg-dark-700 border-dark-600 text-dark-300">{r.empresaNome}</Badge>
      </td>
      <td className="px-3 py-2 text-dark-300">{r.placa}</td>
      <td className="px-3 py-2 text-dark-100 font-medium whitespace-nowrap">{formatarMoeda(r.valor)}</td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => canhotoMut.mutate({ id: r.id, canhotoEntregue: !r.canhotoEntregue })}
          className={`text-xs px-2 py-1 rounded-full border ${
            r.canhotoEntregue ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'
          }`}
        >
          {r.canhotoEntregue ? 'entregue' : 'não entregue'}
        </button>
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button type="button" onClick={() => setEditando(true)} className="text-dark-500 hover:text-gold-400 mr-2" title="Editar">
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm('Excluir essa requisição? Não dá pra desfazer.')) excluirMut.mutate({ id: r.id })
          }}
          className="text-dark-500 hover:text-red-400"
          title="Excluir"
        >
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  )
}

function RelatorioMensal({ mesReferencia }: { mesReferencia: string }) {
  const { data: relatorio } = trpc.requisicaoPosto.relatorioMensal.useQuery({ mesReferencia })
  if (!relatorio) return null

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-medium text-dark-100">Fechamento do mês</p>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-dark-400">
            Total: <span className="text-dark-100 font-semibold">{formatarMoeda(relatorio.totalGeral)}</span> ({relatorio.quantidadeGeral} lançamentos)
          </span>
          {relatorio.canhotosPendentes > 0 && (
            <Badge className="bg-red-500/15 text-red-400 border-red-500/30">{relatorio.canhotosPendentes} canhoto(s) pendente(s)</Badge>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-dark-500 mb-1">Por empresa</p>
          <div className="space-y-1">
            {relatorio.porEmpresa.map((e) => (
              <div key={e.empresaId} className="flex items-center justify-between text-sm">
                <span className="text-dark-300">{e.empresaNome}</span>
                <span className="text-dark-100">{formatarMoeda(e.total)}</span>
              </div>
            ))}
            {!relatorio.porEmpresa.length && <p className="text-xs text-dark-500">Nenhum lançamento nesse mês.</p>}
          </div>
        </div>
        <div>
          <p className="text-xs text-dark-500 mb-1">Por colaborador</p>
          <div className="space-y-1">
            {relatorio.porColaborador.map((c) => (
              <div key={c.colaboradorId} className="flex items-center justify-between text-sm">
                <span className="text-dark-300">
                  {c.colaboradorNome} <span className="text-dark-500 text-xs">({c.empresaNome})</span>
                </span>
                <span className="text-dark-100">{formatarMoeda(c.total)}</span>
              </div>
            ))}
            {!relatorio.porColaborador.length && <p className="text-xs text-dark-500">Nenhum lançamento nesse mês.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RequisicaoPosto() {
  const [mesReferencia, setMesReferencia] = useState(hojeBrString().slice(0, 7))
  const { data: requisicoes, isLoading } = trpc.requisicaoPosto.listar.useQuery({ mesReferencia })

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <div className="flex items-center gap-2">
        <Fuel size={20} className="text-gold-400" />
        <div>
          <h1 className="font-heading text-xl text-dark-50">Requisição Posto</h1>
          <p className="text-sm text-dark-400">Controle de abastecimento de todas as empresas do grupo, num lugar só.</p>
        </div>
      </div>

      <FormularioNovaRequisicao />

      <RelatorioMensal mesReferencia={mesReferencia} />

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        <div className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-medium text-dark-100">Lançamentos</p>
          <Input type="month" value={mesReferencia} onChange={(e) => setMesReferencia(e.target.value)} className="w-40" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-dark-500 border-t border-dark-700">
                <th className="px-3 py-2 font-normal">Data</th>
                <th className="px-3 py-2 font-normal">Nome</th>
                <th className="px-3 py-2 font-normal">Empresa</th>
                <th className="px-3 py-2 font-normal">Carro</th>
                <th className="px-3 py-2 font-normal">Valor</th>
                <th className="px-3 py-2 font-normal">Canhoto</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td className="px-3 py-4 text-dark-400" colSpan={7}>
                    Carregando...
                  </td>
                </tr>
              )}
              {!isLoading && !requisicoes?.length && (
                <tr>
                  <td className="px-3 py-4 text-dark-400" colSpan={7}>
                    Nenhuma requisição nesse mês.
                  </td>
                </tr>
              )}
              {requisicoes?.map((r) => (
                <LinhaRequisicao key={r.id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
