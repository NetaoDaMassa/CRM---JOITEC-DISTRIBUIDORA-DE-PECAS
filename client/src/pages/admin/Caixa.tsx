import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { paraCsv, baixarCsv } from '../../lib/csv'

const MES_LABEL: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric' }

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function mesAtualString(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
}

function hojeString(): string {
  return new Date().toISOString().slice(0, 10)
}

// Caixa da empresa — o admin lança entrada/saída de dinheiro manualmente,
// com saldo consolidado por mês. Simples de propósito (sem categorias,
// sem conciliação bancária): é só um registro de "entrou X, saiu Y" por
// data, pedido pra Compretec Loja Física acompanhar o caixa físico da
// loja mês a mês.
export default function Caixa() {
  const [mesReferencia, setMesReferencia] = useState(mesAtualString())
  const [tipo, setTipo] = useState<'entrada' | 'saida'>('entrada')
  const [valor, setValor] = useState('')
  const [data, setData] = useState(hojeString())
  const [descricao, setDescricao] = useState('')

  const utils = trpc.useUtils()
  const { data: resumo, isLoading } = trpc.caixa.listar.useQuery({ mesReferencia })
  const { data: resumoMensal } = trpc.caixa.resumoMensal.useQuery()

  function invalidar() {
    utils.caixa.listar.invalidate({ mesReferencia })
    utils.caixa.resumoMensal.invalidate()
  }

  const criarMut = trpc.caixa.criar.useMutation({
    onSuccess() {
      toast.success('Lançamento registrado')
      setValor('')
      setDescricao('')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const removerMut = trpc.caixa.remover.useMutation({
    onSuccess() {
      toast.success('Lançamento removido')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function registrar() {
    const valorNum = Number(valor.replace(',', '.'))
    if (!valorNum || valorNum <= 0) return toast.error('Informe um valor válido')
    if (!data) return toast.error('Informe a data')
    criarMut.mutate({ tipo, valor: valorNum, data, descricao: descricao.trim() || undefined })
  }

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl text-dark-50">Caixa</h1>
          <p className="text-sm text-dark-400">Entradas e saídas de dinheiro, com saldo consolidado por mês.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="month"
            value={mesReferencia}
            onChange={(e) => setMesReferencia(e.target.value)}
            className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!resumo?.registros.length}
            onClick={() =>
              baixarCsv(
                `caixa-${mesReferencia}.csv`,
                paraCsv(
                  [
                    { chave: 'data', rotulo: 'Data' },
                    { chave: 'tipo', rotulo: 'Tipo' },
                    { chave: 'valor', rotulo: 'Valor' },
                    { chave: 'descricao', rotulo: 'Descrição' },
                  ],
                  (resumo?.registros ?? []).map((r) => ({
                    data: new Date(`${r.data}T00:00:00`).toLocaleDateString('pt-BR'),
                    tipo: r.tipo === 'entrada' ? 'Entrada' : 'Saída',
                    valor: r.valor,
                    descricao: r.descricao ?? '',
                  }))
                )
              )
            }
          >
            Exportar CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold">Entradas</p>
          <p className="text-xl font-bold text-green-400 font-mono tabular-nums mt-1">
            {formatarMoeda(resumo?.totalEntradas ?? 0)}
          </p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold">Saídas</p>
          <p className="text-xl font-bold text-red-400 font-mono tabular-nums mt-1">
            {formatarMoeda(resumo?.totalSaidas ?? 0)}
          </p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold">Saldo</p>
          <p className={`text-xl font-bold font-mono tabular-nums mt-1 ${(resumo?.saldo ?? 0) >= 0 ? 'text-dark-50' : 'text-red-400'}`}>
            {formatarMoeda(resumo?.saldo ?? 0)}
          </p>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-semibold text-dark-100">Novo lançamento</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-36">
            <Select
              label="Tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as 'entrada' | 'saida')}
              options={[
                { value: 'entrada', label: 'Entrada' },
                { value: 'saida', label: 'Saída' },
              ]}
            />
          </div>
          <div className="w-36">
            <Input label="Valor (R$)" type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          <div className="w-40">
            <Input label="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[180px]">
            <Input label="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <Button loading={criarMut.isPending} onClick={registrar}>
            Registrar
          </Button>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <p className="p-4 text-dark-400 text-sm">Carregando...</p>}
        {!isLoading && !resumo?.registros.length && <p className="p-4 text-dark-400 text-sm">Nenhum lançamento nesse mês.</p>}
        {resumo?.registros.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex items-center gap-3">
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                  r.tipo === 'entrada' ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/30'
                }`}
              >
                {r.tipo === 'entrada' ? 'Entrada' : 'Saída'}
              </span>
              <div className="min-w-0">
                <p className="text-dark-100">{new Date(`${r.data}T00:00:00`).toLocaleDateString('pt-BR')}</p>
                {r.descricao && <p className="text-dark-500 text-xs truncate">{r.descricao}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <p className={`font-mono tabular-nums font-semibold ${r.tipo === 'entrada' ? 'text-green-400' : 'text-red-400'}`}>
                {r.tipo === 'entrada' ? '+' : '-'} {formatarMoeda(r.valor)}
              </p>
              <button
                onClick={() => removerMut.mutate({ id: r.id })}
                className="text-xs text-dark-500 hover:text-red-400"
                disabled={removerMut.isPending}
              >
                Remover
              </button>
            </div>
          </div>
        ))}
      </div>

      {!!resumoMensal?.length && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-sm font-semibold text-dark-100 mb-3">Últimos 12 meses</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-dark-500 text-xs uppercase tracking-wide">
                  <th className="font-semibold pb-2 pr-4">Mês</th>
                  <th className="font-semibold pb-2 pr-4 text-right">Entradas</th>
                  <th className="font-semibold pb-2 pr-4 text-right">Saídas</th>
                  <th className="font-semibold pb-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {resumoMensal.map((m) => (
                  <tr key={m.mes} className={m.mes === mesReferencia ? 'bg-gold-600/5' : undefined}>
                    <td className="py-2 pr-4 text-dark-100 capitalize">
                      {new Date(`${m.mes}-01T00:00:00`).toLocaleDateString('pt-BR', MES_LABEL)}
                    </td>
                    <td className="py-2 pr-4 text-right text-green-400 font-mono tabular-nums">{formatarMoeda(m.totalEntradas)}</td>
                    <td className="py-2 pr-4 text-right text-red-400 font-mono tabular-nums">{formatarMoeda(m.totalSaidas)}</td>
                    <td className={`py-2 text-right font-mono tabular-nums font-semibold ${m.saldo >= 0 ? 'text-dark-50' : 'text-red-400'}`}>
                      {formatarMoeda(m.saldo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
