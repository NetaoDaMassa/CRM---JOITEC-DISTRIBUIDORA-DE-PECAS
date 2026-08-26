import { useState } from 'react'
import { Plus, Download } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import BoletoModal from '../../components/BoletoModal'
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

// Planilha de Boletos (Financeiro) — pedido do João: alteração de valor,
// renegociação e histórico de cada boleto. Mesma tela pra criar, editar e
// ver histórico (BoletoModal cuida dos dois modos).
export default function Boletos() {
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

  if (!data) return <div className="p-6 text-dark-500">Carregando...</div>

  const emAberto = data.filter((b) => b.status !== 'pago')
  const renegociados = data.filter((b) => b.status === 'renegociado')
  const vencidos = data.filter((b) => b.vencido)
  const totalEmAberto = emAberto.reduce((s, b) => s + b.valorAtual, 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl text-dark-50 font-bold">Boletos</h1>
          <p className="text-sm text-dark-400 mt-0.5">Boletos em aberto, renegociação e histórico de alterações.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportarCsv}>
            <Download size={16} /> Exportar CSV
          </Button>
          <Button onClick={abrirNovo}>
            <Plus size={16} /> Novo boleto
          </Button>
        </div>
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
