import { useState } from 'react'
import { Timer } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { formatDateTime } from '../../lib/utils'
import { CartaoTotal, TabelaRelatorio, pct, numCsv, tempoUtil, mesBr } from './creditoRelatorioUi'

// Tempo de resposta do crédito (João, 2026-11-27): quanto o financeiro leva
// pra dar a 1ª resposta de cada consulta/limite, contra o prazo de 1 hora
// (horário de trabalho). Só João e Jessica (chave credito_tempo_resposta) —
// nem a Rubia nem vendas veem.
const hojeBr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const PERIODOS = [
  { id: 'mes', rotulo: 'Este mês' },
  { id: '30', rotulo: 'Últimos 30 dias' },
  { id: '90', rotulo: 'Últimos 90 dias' },
  { id: 'tudo', rotulo: 'Desde o início' },
] as const
function intervalo(p: (typeof PERIODOS)[number]['id']) {
  const ate = hojeBr()
  if (p === 'mes') return { dataDe: `${ate.slice(0, 7)}-01`, dataAte: ate }
  if (p === 'tudo') return { dataDe: '2026-01-01', dataAte: ate }
  const d = new Date(`${ate}T12:00:00`)
  d.setDate(d.getDate() - Number(p))
  return { dataDe: d.toISOString().slice(0, 10), dataAte: ate }
}
const TIPO: Record<string, string> = { consulta: 'Consulta', limite: 'Limite' }

function Selo({ ok, esperando }: { ok: boolean; esperando: boolean }) {
  if (esperando)
    return <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 border ${ok ? 'bg-amber-500/10 text-amber-300 border-amber-500/40' : 'bg-red-500/15 text-red-300 border-red-500/50'}`}>{ok ? 'esperando' : 'esperando — atrasado'}</span>
  return <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 border ${ok ? 'bg-green-500/10 text-green-300 border-green-500/40' : 'bg-red-500/10 text-red-300 border-red-500/40'}`}>{ok ? 'no prazo' : 'fora do prazo'}</span>
}

export default function CreditoTempoResposta() {
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]['id']>('mes')
  const [tipo, setTipo] = useState<'' | 'consulta' | 'limite'>('')
  const { data, isLoading, error } = trpc.solicitacaoCredito.tempoResposta.useQuery({ ...intervalo(periodo), tipo: tipo || undefined })

  type Grupo = NonNullable<typeof data>['porQuem'][number]
  const colsTempo = <T extends Omit<Grupo, 'quem'>>() => [
    { titulo: 'Respondidas', valor: (l: T) => <span className="font-semibold text-dark-100">{l.respostas}</span>, csv: (l: T) => l.respostas, alinhar: 'direita' as const },
    { titulo: 'Tempo médio', valor: (l: T) => tempoUtil(l.mediaMin), csv: (l: T) => l.mediaMin, alinhar: 'direita' as const },
    { titulo: 'No prazo (1h)', valor: (l: T) => <span className="text-green-400">{l.noPrazo}</span>, csv: (l: T) => l.noPrazo, alinhar: 'direita' as const },
    { titulo: 'Fora do prazo', valor: (l: T) => <span className="text-red-400">{l.foraPrazo}</span>, csv: (l: T) => l.foraPrazo, alinhar: 'direita' as const },
    { titulo: '% no prazo', valor: (l: T) => pct(l.pctNoPrazo), csv: (l: T) => numCsv(l.pctNoPrazo), alinhar: 'direita' as const },
    { titulo: 'Maior demora', valor: (l: T) => tempoUtil(l.maiorMin), csv: (l: T) => l.maiorMin, alinhar: 'direita' as const },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      <div className="flex items-start gap-2">
        <Timer size={20} className="text-gold-400 mt-1" />
        <div>
          <h1 className="font-heading text-xl text-dark-50">Tempo de resposta — crédito</h1>
          <p className="text-sm text-dark-400">
            Quanto o financeiro leva para dar a 1ª resposta em cada consulta e limite. Prazo: <b>1 hora</b>, contando só horário de trabalho (seg a sex, sem almoço e
            feriado). Só você e a Jessica veem esta tela.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {PERIODOS.map((p) => (
          <button key={p.id} onClick={() => setPeriodo(p.id)} className={`text-sm rounded-lg px-3 py-1.5 border ${periodo === p.id ? 'bg-gold-500/15 border-gold-500/50 text-gold-300' : 'border-dark-600 text-dark-300 hover:text-dark-100'}`}>
            {p.rotulo}
          </button>
        ))}
        <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} className="text-sm rounded-lg px-3 py-1.5 bg-dark-800 border border-dark-600 text-dark-200">
          <option value="">Consultas e limites</option>
          <option value="consulta">Só consultas</option>
          <option value="limite">Só limites</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-400">{error.message}</p>}
      {isLoading && <p className="text-sm text-dark-400">Carregando...</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CartaoTotal titulo="Tempo médio de resposta" valor={tempoUtil(data.geral.mediaMin)} cor={data.geral.mediaMin != null && data.geral.mediaMin > data.prazoMin ? 'text-red-400' : 'text-green-400'} detalhe={`${data.geral.respostas} respondida(s) no período`} />
            <CartaoTotal titulo="No prazo de 1 hora" valor={pct(data.geral.pctNoPrazo)} cor="text-green-400" detalhe={`${data.geral.noPrazo} de ${data.geral.respostas}`} />
            <CartaoTotal titulo="Fora do prazo" valor={data.geral.foraPrazo} cor="text-red-400" detalhe={`maior demora: ${tempoUtil(data.geral.maiorMin)}`} />
            <CartaoTotal titulo="Esperando resposta agora" valor={data.geral.esperando} cor={data.geral.esperandoForaPrazo ? 'text-red-400' : 'text-dark-50'} detalhe={`${data.geral.esperandoForaPrazo} já passou de 1 hora`} />
          </div>

          <TabelaRelatorio
            titulo="Por quem respondeu"
            subtitulo="1ª resposta de cada pedido"
            arquivo="credito-tempo-por-quem"
            linhas={data.porQuem}
            chave={(l) => l.quem}
            colunas={[{ titulo: 'Quem respondeu', valor: (l) => <span className="text-dark-100">{l.quem}</span>, csv: (l) => l.quem }, ...colsTempo<Grupo>()]}
          />

          <div className="grid md:grid-cols-2 gap-4">
            <TabelaRelatorio
              titulo="Por tipo"
              arquivo="credito-tempo-por-tipo"
              linhas={data.porTipo}
              chave={(l) => l.tipo}
              colunas={[{ titulo: 'Tipo', valor: (l) => TIPO[l.tipo] ?? l.tipo, csv: (l) => TIPO[l.tipo] ?? l.tipo }, ...colsTempo<(typeof data.porTipo)[number]>().slice(0, 5)]}
            />
            <TabelaRelatorio
              titulo="Por mês"
              arquivo="credito-tempo-por-mes"
              linhas={data.porMes}
              chave={(l) => l.mes}
              colunas={[{ titulo: 'Mês', valor: (l) => mesBr(l.mes), csv: (l) => l.mes }, ...colsTempo<(typeof data.porMes)[number]>().slice(0, 5)]}
            />
          </div>

          <TabelaRelatorio
            titulo="Cada consulta e limite"
            subtitulo="do pedido do vendedor até a 1ª resposta do financeiro"
            arquivo="credito-tempo-cada-pedido"
            linhas={data.itens}
            chave={(l) => l.id}
            colunas={[
              { titulo: 'Pedido em', valor: (l) => formatDateTime(l.createdAt), csv: (l) => l.createdAt },
              { titulo: 'Cliente', valor: (l) => <span className="text-dark-100">{l.clienteNome} <span className="text-dark-500 text-xs">{l.clienteCodigo}</span></span>, csv: (l) => l.clienteNome },
              { titulo: 'Tipo', valor: (l) => TIPO[l.tipo] ?? l.tipo, csv: (l) => TIPO[l.tipo] ?? l.tipo },
              { titulo: 'Vendedor', valor: (l) => `${l.vendedorNome} · ${l.empresaNome}`, csv: (l) => `${l.vendedorNome} (${l.empresaNome})` },
              { titulo: 'Respondido em', valor: (l) => (l.respondidoEm ? formatDateTime(l.respondidoEm) : '—'), csv: (l) => l.respondidoEm ?? '' },
              { titulo: 'Quem', valor: (l) => l.quemRespondeu ?? '—', csv: (l) => l.quemRespondeu ?? '' },
              { titulo: 'Tempo', valor: (l) => <span className={l.noPrazo ? 'text-dark-100' : 'text-red-400 font-semibold'}>{tempoUtil(l.minutos)}</span>, csv: (l) => l.minutos, alinhar: 'direita' },
              { titulo: 'Prazo', valor: (l) => <Selo ok={l.noPrazo} esperando={l.esperando} />, csv: (l) => (l.esperando ? 'esperando' : l.noPrazo ? 'no prazo' : 'fora do prazo') },
            ]}
          />
        </>
      )}
    </div>
  )
}
