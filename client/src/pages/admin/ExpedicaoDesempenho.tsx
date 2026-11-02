import { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'

// Desempenho do estoque (pedido do João, 2026-10-29) — substitui o "Painel
// Diário" e o "Painel Mensal" da planilha "Análise de Desempenho Estoque":
// mesma conta (pedidos, peças, erros, volumes, cabeçotes, paletes; erros ÷
// pedidos ≤ limite = elegível à bonificação), só que sai sozinha das
// anotações da tela Expedição.

function hojeBr(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
}
const CARGO: Record<string, string> = { separador: 'Separador', conferente: 'Conferente', embalador: 'Embalador', expedicao: 'Expedição', geral: 'Faz tudo' }
const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const num = (n: number) => n.toLocaleString('pt-BR')

export default function ExpedicaoDesempenho() {
  const hoje = hojeBr()
  const [de, setDe] = useState(`${hoje.slice(0, 8)}01`)
  const [ate, setAte] = useState(hoje)
  const { data, isLoading } = trpc.expedicao.desempenho.useQuery({ de, ate })
  const atalho = (d: string, a: string) => (setDe(d), setAte(a))
  const mesPassado = (() => {
    const d = new Date(`${hoje.slice(0, 8)}01T12:00:00Z`)
    d.setUTCDate(0)
    const fim = d.toISOString().slice(0, 10)
    return { de: `${fim.slice(0, 8)}01`, ate: fim }
  })()

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center">
            <BarChart3 size={20} className="text-teal-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Desempenho do estoque</h1>
            <p className="text-sm text-dark-400">Produção, erros e bonificação de cada pessoa, calculados sozinhos</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {[
            { l: 'Hoje', d: hoje, a: hoje },
            { l: 'Este mês', d: `${hoje.slice(0, 8)}01`, a: hoje },
            { l: 'Mês passado', d: mesPassado.de, a: mesPassado.ate },
          ].map((x) => (
            <button
              key={x.l}
              type="button"
              onClick={() => atalho(x.d, x.a)}
              className={`text-sm rounded-lg px-3 py-2 border ${de === x.d && ate === x.a ? 'border-gold-600 text-gold-300' : 'border-dark-600 text-dark-300 hover:bg-dark-800'}`}
            >
              {x.l}
            </button>
          ))}
          <Input label="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          <Input label="Até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi titulo="Pedidos coletados" valor={num(data.coletados)} />
          <Kpi titulo="No prazo (48h)" valor={data.coletados ? pct(data.noPrazo / data.coletados) : '—'} sub={`${data.noPrazo} de ${data.coletados}`} />
          <Kpi titulo="Tempo médio picking → coleta" valor={data.horasMediasAteColeta != null ? `${data.horasMediasAteColeta.toLocaleString('pt-BR')}h` : '—'} />
          <Kpi titulo="Erros anotados" valor={num(data.erros)} />
        </div>
      )}

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 overflow-x-auto">
        {isLoading || !data ? (
          <div className="h-40 animate-pulse" />
        ) : data.linhas.length === 0 ? (
          <p className="text-sm text-dark-400">Ninguém cadastrado na equipe ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-dark-400 text-left">
                <th className="py-2 pr-3 font-medium">Bonificação</th>
                <th className="py-2 pr-3 font-medium">Colaborador</th>
                <th className="py-2 pr-3 font-medium">Cargo</th>
                <th className="py-2 pr-3 font-medium text-right">Pedidos</th>
                <th className="py-2 pr-3 font-medium text-right">Peças</th>
                <th className="py-2 pr-3 font-medium text-right">Erros</th>
                <th className="py-2 pr-3 font-medium text-right">Taxa de erro</th>
                <th className="py-2 pr-3 font-medium text-right">Limite</th>
                <th className="py-2 pr-3 font-medium text-right">Volumes</th>
                <th className="py-2 pr-3 font-medium text-right">Cabeçotes</th>
                <th className="py-2 pr-3 font-medium text-right">Paletes</th>
                <th className="py-2 font-medium text-right">Tempo médio</th>
              </tr>
            </thead>
            <tbody>
              {data.linhas.map((l) => (
                <tr key={l.id} className="border-t border-dark-700/70">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {l.status === 'elegivel' && <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-green-900/30 text-green-300">Elegível</span>}
                    {l.status === 'nao_elegivel' && <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-red-900/30 text-red-300">Não elegível</span>}
                    {l.status === 'sem_producao' && <span className="text-xs text-dark-500">Sem produção</span>}
                  </td>
                  <td className="py-2 pr-3 text-dark-100 font-medium">{l.nome}</td>
                  <td className="py-2 pr-3 text-dark-300">{CARGO[l.cargo]}</td>
                  <td className="py-2 pr-3 text-right font-mono">{num(l.pedidos)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{num(l.pecas)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{num(l.erros)}</td>
                  <td className={`py-2 pr-3 text-right font-mono ${l.pedidos && l.taxaErro > l.limiteErro ? 'text-red-300' : ''}`}>{l.pedidos ? pct(l.taxaErro) : '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono text-dark-400">{pct(l.limiteErro)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{l.cargo === 'embalador' || l.cargo === 'geral' ? num(l.volumes) : '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono">{l.cargo === 'embalador' || l.cargo === 'geral' ? num(l.cabecotes) : '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono">{l.cargo === 'embalador' || l.cargo === 'geral' ? num(l.paletes) : '—'}</td>
                  <td className="py-2 text-right font-mono text-dark-300">{l.minutosPorPedido != null ? `${l.minutosPorPedido} min` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-dark-500 mt-3">
          Erro achado na conferência conta para o separador; na embalagem, para o conferente; na expedição, para o embalador. Elegível = erros ÷ pedidos até o limite da pessoa.
        </p>
      </div>
    </div>
  )
}

function Kpi({ titulo, valor, sub }: { titulo: string; valor: string; sub?: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
      <p className="text-xs text-dark-400">{titulo}</p>
      <p className="text-2xl font-bold font-mono text-dark-50 mt-1">{valor}</p>
      {sub && <p className="text-xs text-dark-500">{sub}</p>}
    </div>
  )
}
