import { useState } from 'react'
import { Plus, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import BoletoModal from '../../components/BoletoModal'
import PedidoAlteracaoModal from '../../components/PedidoAlteracaoModal'
import { paraCsv, baixarCsv } from '../../lib/csv'

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(d: string): string {
  const [ano, mes, dia] = d.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

const STATUS_LABEL: Record<string, string> = { em_aberto: 'Em aberto', renegociado: 'Renegociado', pago: 'Pago' }
const STATUS_COR: Record<string, string> = {
  em_aberto: 'text-dark-400 bg-dark-700/40 border-dark-600',
  renegociado: 'text-orange-400 bg-orange-900/20 border-orange-700/40',
  pago: 'text-green-400 bg-green-900/20 border-green-700/40',
}

const ABAS = [
  { id: 'boletos', label: 'Boletos' },
  { id: 'pedidos', label: 'Pedidos de alteração' },
] as const
type Aba = (typeof ABAS)[number]['id']

const STATUS_PEDIDO = [
  { value: 'lancado', label: 'Lançado', cor: 'text-dark-400 bg-dark-700/40 border-dark-600' },
  { value: 'em_execucao', label: 'Em execução', cor: 'text-orange-400 bg-orange-900/20 border-orange-700/40' },
  { value: 'concluido', label: 'Concluído', cor: 'text-green-400 bg-green-900/20 border-green-700/40' },
]

function SeletorAba({ aba, onChange }: { aba: Aba; onChange: (a: Aba) => void }) {
  return (
    <div className="inline-flex bg-dark-800 border border-dark-600 rounded-xl p-1 gap-1">
      {ABAS.map((a) => (
        <button
          key={a.id}
          onClick={() => onChange(a.id)}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            aba === a.id ? 'bg-gold-600 text-dark-950' : 'text-dark-300 hover:text-dark-100'
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

// Fila de pedidos de alteração de vencimento/valor — o cliente pede, fica
// registrado aqui até o Financeiro executar de fato no boleto (aba
// "Boletos" ao lado). Simples log com check de progresso, sem precisar
// linkar num boleto específico.
function AbaPedidosAlteracao() {
  const { data } = trpc.boletos.pedidosListar.useQuery()
  const [modalAberto, setModalAberto] = useState(false)
  const utils = trpc.useUtils()

  const statusMut = trpc.boletos.pedidosAtualizarStatus.useMutation({
    onSuccess: () => utils.boletos.pedidosListar.invalidate(),
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.boletos.pedidosExcluir.useMutation({
    onSuccess: () => utils.boletos.pedidosListar.invalidate(),
    onError: (e) => toast.error(e.message),
  })

  function exportarCsv() {
    if (!data) return
    baixarCsv(
      'pedidos_alteracao_boleto.csv',
      paraCsv(
        [
          { chave: 'data', rotulo: 'Data' },
          { chave: 'cliente', rotulo: 'Cliente' },
          { chave: 'pedido', rotulo: 'O que foi pedido' },
          { chave: 'status', rotulo: 'Status' },
        ],
        data.map((p) => ({
          data: formatarData(p.createdAt),
          cliente: p.cliente.razaoSocial,
          pedido: p.descricao,
          status: STATUS_PEDIDO.find((s) => s.value === p.status)?.label ?? p.status,
        }))
      )
    )
  }

  if (!data) return <p className="text-dark-500">Carregando...</p>

  return (
    <div>
      <div className="flex justify-end gap-2 mb-4">
        <Button variant="secondary" onClick={exportarCsv}>
          <Download size={16} /> Exportar CSV
        </Button>
        <Button onClick={() => setModalAberto(true)}>
          <Plus size={16} /> Novo pedido
        </Button>
      </div>
      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700 text-left text-xs text-dark-500 uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">O que foi pedido</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="border-b border-dark-700 last:border-0 hover:bg-dark-700/40">
                  <td className="px-4 py-3 text-dark-400 font-mono whitespace-nowrap">{formatarData(p.createdAt)}</td>
                  <td className="px-4 py-3 text-dark-100 font-medium">{p.cliente.razaoSocial}</td>
                  <td className="px-4 py-3 text-dark-300">{p.descricao}</td>
                  <td className="px-4 py-3">
                    <select
                      value={p.status}
                      onChange={(e) => statusMut.mutate({ id: p.id, status: e.target.value as any })}
                      className={`text-xs font-semibold rounded-full px-2.5 py-1 border cursor-pointer focus:outline-none ${
                        STATUS_PEDIDO.find((s) => s.value === p.status)?.cor
                      }`}
                    >
                      {STATUS_PEDIDO.map((s) => (
                        <option key={s.value} value={s.value} className="bg-dark-800 text-dark-100">
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => excluirMut.mutate({ id: p.id })} className="text-dark-600 hover:text-red-400 text-xs">
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-dark-500">
                    Nenhum pedido registrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <PedidoAlteracaoModal open={modalAberto} onClose={() => setModalAberto(false)} />
    </div>
  )
}

// Planilha de Boletos (Financeiro) — pedido do João: alteração de valor,
// renegociação e histórico de cada boleto. Mesma tela pra criar, editar e
// ver histórico (BoletoModal cuida dos dois modos).
function AbaBoletos() {
  const { data } = trpc.boletos.listar.useQuery()
  const [modalAberto, setModalAberto] = useState(false)
  const [boletoSelecionado, setBoletoSelecionado] = useState<number | null>(null)

  function abrirNovo() {
    setBoletoSelecionado(null)
    setModalAberto(true)
  }
  function abrirBoleto(id: number) {
    setBoletoSelecionado(id)
    setModalAberto(true)
  }

  function exportarCsv() {
    if (!data) return
    const linhas = data.map((b) => ({
      cliente: b.cliente.razaoSocial,
      numeroBoleto: b.numeroBoleto ?? '',
      valorOriginal: b.valorOriginal,
      valorAtual: b.valorAtual,
      vencimento: formatarData(b.vencimento),
      status: b.vencido ? 'Vencido' : STATUS_LABEL[b.status],
    }))
    baixarCsv(
      'boletos.csv',
      paraCsv(
        [
          { chave: 'cliente', rotulo: 'Cliente' },
          { chave: 'numeroBoleto', rotulo: 'Nº Boleto' },
          { chave: 'valorOriginal', rotulo: 'Valor original' },
          { chave: 'valorAtual', rotulo: 'Valor atual' },
          { chave: 'vencimento', rotulo: 'Vencimento' },
          { chave: 'status', rotulo: 'Status' },
        ],
        linhas
      )
    )
  }

  if (!data) return <p className="text-dark-500">Carregando...</p>

  const emAberto = data.filter((b) => b.status !== 'pago')
  const renegociados = data.filter((b) => b.status === 'renegociado')
  const vencidos = data.filter((b) => b.vencido)
  const totalEmAberto = emAberto.reduce((s, b) => s + b.valorAtual, 0)

  return (
    <div>
      <div className="flex justify-end gap-2 mb-6">
        <Button variant="secondary" onClick={exportarCsv}>
          <Download size={16} /> Exportar CSV
        </Button>
        <Button onClick={abrirNovo}>
          <Plus size={16} /> Novo boleto
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-dark-800 border border-dark-600 rounded-xl p-3.5">
          <p className="text-xl font-bold font-mono text-gold-400">{emAberto.length}</p>
          <p className="text-[10px] text-dark-500 uppercase tracking-wide">Em aberto</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-xl p-3.5">
          <p className="text-xl font-bold font-mono text-orange-400">{renegociados.length}</p>
          <p className="text-[10px] text-dark-500 uppercase tracking-wide">Renegociados</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-xl p-3.5">
          <p className="text-xl font-bold font-mono text-red-400">{vencidos.length}</p>
          <p className="text-[10px] text-dark-500 uppercase tracking-wide">Vencidos</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-xl p-3.5">
          <p className="text-xl font-bold font-mono text-dark-100">{formatarMoeda(totalEmAberto)}</p>
          <p className="text-[10px] text-dark-500 uppercase tracking-wide">Total em aberto</p>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700 text-left text-xs text-dark-500 uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Nº Boleto</th>
                <th className="px-4 py-3 font-medium">Valor original</th>
                <th className="px-4 py-3 font-medium">Valor atual</th>
                <th className="px-4 py-3 font-medium">Vencimento</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr
                  key={b.id}
                  onClick={() => abrirBoleto(b.id)}
                  className="border-b border-dark-700 last:border-0 hover:bg-dark-700/40 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-dark-100 font-medium">{b.cliente.razaoSocial}</td>
                  <td className="px-4 py-3 text-dark-400 font-mono">{b.numeroBoleto ?? '—'}</td>
                  <td className="px-4 py-3 text-dark-400 font-mono">{formatarMoeda(b.valorOriginal)}</td>
                  <td className="px-4 py-3 text-dark-100 font-mono font-semibold">{formatarMoeda(b.valorAtual)}</td>
                  <td className="px-4 py-3 text-dark-400 font-mono">{formatarData(b.vencimento)}</td>
                  <td className="px-4 py-3">
                    {b.vencido ? (
                      <Badge className="text-red-400 bg-red-900/20 border-red-700/40">Vencido</Badge>
                    ) : (
                      <Badge className={STATUS_COR[b.status]}>{STATUS_LABEL[b.status]}</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-dark-500">
                    Nenhum boleto cadastrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <BoletoModal open={modalAberto} onClose={() => setModalAberto(false)} boletoId={boletoSelecionado} />
    </div>
  )
}

// Financeiro > Boletos — planilha de boletos (criar/editar/histórico) e a
// fila de pedidos de alteração de vencimento/valor que os clientes pedem
// no dia a dia, cada uma na sua aba.
export default function Boletos() {
  const [aba, setAba] = useState<Aba>('boletos')

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="font-heading text-2xl text-dark-50 font-bold">Boletos</h1>
        <p className="text-sm text-dark-400 mt-0.5">Boletos em aberto, renegociação, histórico e pedidos de alteração.</p>
      </div>

      <div className="mb-5">
        <SeletorAba aba={aba} onChange={setAba} />
      </div>

      {aba === 'boletos' && <AbaBoletos />}
      {aba === 'pedidos' && <AbaPedidosAlteracao />}
    </div>
  )
}
