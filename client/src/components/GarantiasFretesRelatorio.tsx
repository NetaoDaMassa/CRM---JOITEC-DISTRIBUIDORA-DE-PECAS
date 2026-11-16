import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { trpc } from '../lib/trpc'
import { formatarMoeda } from '../lib/moeda'
import Select from './ui/Select'

// Relatório de fretes de garantia (pedido do João, 2026-11-16): soma o que
// foi lançado na Saída (envio do item novo) e no Retorno do Item Danificado
// — total por mês, envio × retorno, por transportadora e por CIF/FOB.
// Regra de datas no servidor (garantias.core.relatorioFretes).

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function nomeMes(ym: string) {
  const [a, m] = ym.split('-')
  return `${NOMES_MES[Number(m) - 1]}/${a}`
}
function dataBr(d: string) {
  const [a, m, dia] = d.split('-')
  return `${dia}/${m}/${a}`
}

export default function GarantiasFretesRelatorio({ basePath }: { basePath: string }) {
  const navigate = useNavigate()
  const { data: fretes, isLoading } = trpc.garantias.core.relatorioFretes.useQuery()
  const hoje = new Date()
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
  const [mes, setMes] = useState<string>(mesAtual)

  const meses = useMemo(() => {
    const s = new Set<string>([mesAtual])
    for (const f of fretes ?? []) s.add(f.data.slice(0, 7))
    return [...s].sort().reverse()
  }, [fretes, mesAtual])

  const porMes = useMemo(() => {
    const m = new Map<string, { envio: number; retorno: number; qtd: number }>()
    for (const f of fretes ?? []) {
      const k = f.data.slice(0, 7)
      const r = m.get(k) ?? { envio: 0, retorno: 0, qtd: 0 }
      r[f.tipo] += f.valor
      r.qtd++
      m.set(k, r)
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12)
  }, [fretes])

  const doPeriodo = (fretes ?? []).filter((f) => mes === 'todos' || f.data.startsWith(mes))
  const totalEnvio = doPeriodo.filter((f) => f.tipo === 'envio').reduce((s, f) => s + f.valor, 0)
  const totalRetorno = doPeriodo.filter((f) => f.tipo === 'retorno').reduce((s, f) => s + f.valor, 0)

  const porTransportadora = new Map<string, { qtd: number; envio: number; retorno: number }>()
  for (const f of doPeriodo) {
    const k = f.transportadora || '(sem transportadora)'
    const r = porTransportadora.get(k) ?? { qtd: 0, envio: 0, retorno: 0 }
    r.qtd++
    r[f.tipo] += f.valor
    porTransportadora.set(k, r)
  }
  const transportadoras = [...porTransportadora.entries()].sort((a, b) => b[1].envio + b[1].retorno - (a[1].envio + a[1].retorno))

  const porModalidade = (['CIF', 'FOB', null] as const).map((mod) => {
    const lista = doPeriodo.filter((f) => f.modalidade === mod)
    return {
      mod,
      qtd: lista.length,
      envio: lista.filter((f) => f.tipo === 'envio').reduce((s, f) => s + f.valor, 0),
      retorno: lista.filter((f) => f.tipo === 'retorno').reduce((s, f) => s + f.valor, 0),
    }
  })

  if (isLoading) return <p className="text-dark-400 text-sm">Carregando...</p>

  const th = 'text-left text-xs font-semibold text-dark-400 uppercase tracking-wide px-3 py-2'
  const thR = 'text-right text-xs font-semibold text-dark-400 uppercase tracking-wide px-3 py-2'
  const td = 'px-3 py-2 text-dark-200'
  const tdR = 'px-3 py-2 text-dark-200 text-right tabular-nums'

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="w-52">
          <Select
            label="Período"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            options={[...meses.map((m) => ({ value: m, label: nomeMes(m) })), { value: 'todos', label: 'Todos os meses' }]}
          />
        </div>
        <p className="text-xs text-dark-500 pb-2">
          Mês do envio = data da NF de saída · Mês do retorno = data da solicitação de retorno (ou do recebimento). Sem data, conta no mês em que o processo foi aberto.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total gasto com frete', valor: formatarMoeda(totalEnvio + totalRetorno), destaque: true },
          { label: 'Envio (item novo)', valor: formatarMoeda(totalEnvio) },
          { label: 'Retorno (item danificado)', valor: formatarMoeda(totalRetorno) },
          { label: 'Fretes lançados', valor: String(doPeriodo.length) },
        ].map((c) => (
          <div key={c.label} className={`rounded-xl border p-4 ${c.destaque ? 'border-gold-600/50 bg-gold-900/10' : 'border-dark-600 bg-dark-800'}`}>
            <p className="text-xs text-dark-400">{c.label}</p>
            <p className={`text-xl font-bold mt-1 tabular-nums ${c.destaque ? 'text-gold-400' : 'text-dark-50'}`}>{c.valor}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-dark-600 bg-dark-800 overflow-hidden">
          <p className="px-3 pt-3 text-sm font-semibold text-dark-100">Por transportadora</p>
          <table className="w-full text-sm">
            <thead>
              <tr><th className={th}>Transportadora</th><th className={thR}>Qtd</th><th className={thR}>Envio</th><th className={thR}>Retorno</th><th className={thR}>Total</th></tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {transportadoras.map(([nome, r]) => (
                <tr key={nome}>
                  <td className={td}>{nome}</td>
                  <td className={tdR}>{r.qtd}</td>
                  <td className={tdR}>{formatarMoeda(r.envio)}</td>
                  <td className={tdR}>{formatarMoeda(r.retorno)}</td>
                  <td className={`${tdR} font-semibold`}>{formatarMoeda(r.envio + r.retorno)}</td>
                </tr>
              ))}
              {transportadoras.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-dark-500 text-center">Nenhum frete no período</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-dark-600 bg-dark-800 overflow-hidden">
          <p className="px-3 pt-3 text-sm font-semibold text-dark-100">Por modalidade</p>
          <table className="w-full text-sm">
            <thead>
              <tr><th className={th}>Modalidade</th><th className={thR}>Qtd</th><th className={thR}>Envio</th><th className={thR}>Retorno</th><th className={thR}>Total</th></tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {porModalidade.filter((m) => m.mod !== null || m.qtd > 0).map((m) => (
                <tr key={m.mod ?? 'sem'}>
                  <td className={td}>{m.mod === 'CIF' ? 'CIF (Odin paga)' : m.mod === 'FOB' ? 'FOB (Odin não paga)' : 'Sem modalidade'}</td>
                  <td className={tdR}>{m.qtd}</td>
                  <td className={tdR}>{formatarMoeda(m.envio)}</td>
                  <td className={tdR}>{formatarMoeda(m.retorno)}</td>
                  <td className={`${tdR} font-semibold`}>{formatarMoeda(m.envio + m.retorno)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-dark-600 bg-dark-800 overflow-hidden">
        <p className="px-3 pt-3 text-sm font-semibold text-dark-100">Mês a mês (últimos 12 meses com frete)</p>
        <table className="w-full text-sm">
          <thead>
            <tr><th className={th}>Mês</th><th className={thR}>Qtd</th><th className={thR}>Envio</th><th className={thR}>Retorno</th><th className={thR}>Total</th></tr>
          </thead>
          <tbody className="divide-y divide-dark-700">
            {porMes.map(([m, r]) => (
              <tr key={m} onClick={() => setMes(m)} className={`cursor-pointer hover:bg-dark-700/50 ${m === mes ? 'bg-dark-700/40' : ''}`}>
                <td className={td}>{nomeMes(m)}</td>
                <td className={tdR}>{r.qtd}</td>
                <td className={tdR}>{formatarMoeda(r.envio)}</td>
                <td className={tdR}>{formatarMoeda(r.retorno)}</td>
                <td className={`${tdR} font-semibold`}>{formatarMoeda(r.envio + r.retorno)}</td>
              </tr>
            ))}
            {porMes.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-dark-500 text-center">Nenhum frete lançado ainda</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-dark-600 bg-dark-800 overflow-x-auto">
        <p className="px-3 pt-3 text-sm font-semibold text-dark-100">Fretes do período</p>
        <table className="w-full text-sm">
          <thead>
            <tr><th className={th}>Data</th><th className={th}>Garantia</th><th className={th}>Cliente</th><th className={th}>Tipo</th><th className={th}>Transportadora</th><th className={th}>Modalidade</th><th className={thR}>Valor</th></tr>
          </thead>
          <tbody className="divide-y divide-dark-700">
            {doPeriodo.map((f) => (
              <tr key={`${f.garantiaId}-${f.tipo}`} onClick={() => navigate(`${basePath}/${f.garantiaId}`)} className="cursor-pointer hover:bg-dark-700/50">
                <td className={td}>{dataBr(f.data)}{f.dataEstimada && <span className="text-dark-500" title="Sem data lançada — usando a data de abertura do processo"> *</span>}</td>
                <td className={td}>#{f.garantiaId}{f.status === 'cancelado' && <span className="text-red-400 text-xs"> (cancelado)</span>}</td>
                <td className={`${td} max-w-[220px] truncate`}>{f.cliente}</td>
                <td className={td}>{f.tipo === 'envio' ? 'Envio' : 'Retorno'}</td>
                <td className={td}>{f.transportadora ?? '—'}</td>
                <td className={td}>{f.modalidade ?? '—'}</td>
                <td className={tdR}>{f.modalidade === 'FOB' ? <span className="text-dark-500">sem custo</span> : formatarMoeda(f.valor)}</td>
              </tr>
            ))}
            {doPeriodo.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-dark-500 text-center">Nenhum frete no período</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
