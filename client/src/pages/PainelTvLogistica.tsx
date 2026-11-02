import { useEffect, useRef, useState } from 'react'
import { trpc } from '../lib/trpc'
import { TelaColetas, TelaEmpresasExpedicao, TelaEquipeEstoque } from '../components/PainelExpedicaoTelas'

// Painel de TV "Controle Logístico" (pedido do João, 2026-10-29) — pro
// Financeiro, TV de 75". Quantidade e pedidos/clientes em cada etapa da
// Expedição (Joitec, Odin Tubos e Odin Automação juntas). Mesmo palco fixo de
// 1920×1080 escalado pra caber na tela do Painel Financeiro; sem rolagem,
// atualiza sozinho a cada 30 s.

const COLUNAS = [
  { id: 'separacao', titulo: 'Separação', cor: '#f59e0b' },
  { id: 'conferencia', titulo: 'Conferência', cor: '#3b82f6' },
  { id: 'embalagem', titulo: 'Embalagem', cor: '#8b5cf6' },
  { id: 'nf', titulo: 'NF', cor: '#0ea5e9' },
  { id: 'coleta', titulo: 'Aguardando coleta', cor: '#14b8a6' },
  { id: 'coletado', titulo: 'Coletados hoje', cor: '#22c55e' },
] as const
const LINHAS_POR_COLUNA = 6
// Telas que o painel gira (pedido do João, 2026-11-02: "criar mais telas").
const TELAS = [
  { id: 'quadro', titulo: 'Quadro', sub: 'Prazo de 48h do picking até a coleta' },
  { id: 'empresas', titulo: 'Por empresa', sub: 'Etapas, notas aguardando o Financeiro, atrasados e coletados hoje' },
  { id: 'equipe', titulo: 'Equipe hoje', sub: 'Etapas terminadas hoje por pessoa e quem está trabalhando agora' },
  { id: 'coletas', titulo: 'Coletas', sub: 'Coletas de hoje por transportadora e os últimos 7 dias' },
] as const
const SEGUNDOS_POR_TELA = 20

function usePalco() {
  const ref = useRef<HTMLDivElement>(null)
  const [palco, setPalco] = useState({ escala: 0.5, largura: 1920, altura: 1080 })
  useEffect(() => {
    const medir = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const escala = Math.min(r.width / 1920, r.height / 1080) || 0.5
      setPalco({ escala, largura: Math.round(r.width / escala) || 1920, altura: Math.round(r.height / escala) || 1080 })
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [])
  return { ref, ...palco }
}

function tempoDesde(utc: string | null, agora: number): string {
  if (!utc) return ''
  const min = Math.max(0, Math.round((agora - Date.parse(`${utc.replace(' ', 'T')}Z`)) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h${String(min % 60).padStart(2, '0')}` : `${Math.floor(h / 24)}d ${h % 24}h`
}

function horaBr(utc: string | null): string {
  if (!utc) return ''
  return new Date(`${utc.replace(' ', 'T')}Z`).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function PainelTvLogistica() {
  const { ref, escala, largura, altura } = usePalco()
  const { data } = trpc.expedicao.painelTv.useQuery(undefined, { refetchInterval: 30_000 })
  const { data: resumo } = trpc.expedicao.painelResumo.useQuery(undefined, { refetchInterval: 30_000 })
  const [tela, setTela] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTela((t) => (t + 1) % TELAS.length), SEGUNDOS_POR_TELA * 1000)
    return () => clearInterval(id)
  }, [tela])
  const atual = TELAS[tela]
  const [agora, setAgora] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  const relogio = new Date(agora)

  const linhas = data?.linhas ?? []
  const atrasados = linhas.filter((l) => l.atrasado).length
  const coletados = linhas.filter((l) => l.coluna === 'coletado')
  const noPrazo = coletados.filter((l) => l.noPrazo).length

  return (
    <div ref={ref} className="fixed inset-0 bg-dark-950 text-dark-50 overflow-hidden">
      <style>{`@keyframes painelRolar{from{transform:translateY(0)}to{transform:translateY(-50%)}}.painel-rolar{animation:painelRolar linear infinite}`}</style>
      <div className="absolute left-1/2 top-1/2 origin-center" style={{ width: largura, height: altura, transform: `translate(-50%, -50%) scale(${escala})` }}>
        <div className="absolute inset-0 px-12 pt-9 pb-10 grid grid-rows-[auto_minmax(0,1fr)] gap-[22px]">
          <div className="flex items-center gap-8">
            <div>
              <p className="text-[20px] text-dark-400 uppercase tracking-[0.06em] font-semibold">Grupo Odin · Joitec · Odin Tubos · Odin Automação</p>
              <h1 className="font-heading text-[50px] font-bold text-dark-50 leading-tight">
                Controle Logístico{atual.id !== 'quadro' && <span className="text-dark-400"> · {atual.titulo}</span>}
              </h1>
              <p className="text-[21px] text-dark-400">{atual.sub}</p>
            </div>
            <div className="ml-auto flex items-center gap-5">
              <div className={`rounded-2xl px-6 py-3 text-center ${atrasados ? 'bg-red-900/40 border-2 border-red-500/70' : 'bg-dark-800 border-2 border-dark-700'}`}>
                <p className={`text-[56px] font-bold leading-none tabular-nums ${atrasados ? 'text-red-300' : 'text-dark-300'}`}>{atrasados}</p>
                <p className={`text-[18px] uppercase tracking-wide mt-1 ${atrasados ? 'text-red-200' : 'text-dark-400'}`}>atrasados (48h)</p>
              </div>
              <div className="rounded-2xl px-6 py-3 text-center bg-dark-800 border-2 border-dark-700">
                <p className="text-[56px] font-bold leading-none tabular-nums text-green-300">{coletados.length ? `${Math.round((noPrazo / coletados.length) * 100)}%` : '—'}</p>
                <p className="text-[18px] uppercase tracking-wide mt-1 text-dark-400">no prazo hoje</p>
              </div>
              <div className="text-right pl-4">
                <p className="text-[56px] font-semibold tabular-nums leading-none">{relogio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                <p className="text-[20px] text-dark-400 first-letter:uppercase mt-1">{relogio.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
              </div>
            </div>
          </div>

          {atual.id !== 'quadro' ? (
            !resumo ? (
              <p className="text-[26px] text-dark-500">Carregando...</p>
            ) : atual.id === 'empresas' ? (
              <TelaEmpresasExpedicao data={resumo} />
            ) : atual.id === 'equipe' ? (
              <TelaEquipeEstoque data={resumo} />
            ) : (
              <TelaColetas data={resumo} />
            )
          ) : !data ? (
            <p className="text-[26px] text-dark-500">Carregando...</p>
          ) : (
            <div className="grid grid-cols-6 gap-[18px] min-h-0">
              {COLUNAS.map((c) => {
                const doCol = linhas.filter((l) => l.coluna === c.id)
                const atrasCol = doCol.filter((l) => l.atrasado).length
                // Atrasados primeiro, depois o que está há mais tempo na etapa.
                const ordenados = [...doCol].sort((a, b) => Number(b.atrasado) - Number(a.atrasado))
                // Coube na coluna: lista parada. Passou disso: a lista roda
                // sozinha pra baixo, em loop (pedido do João, 2026-10-29).
                const rolando = ordenados.length > LINHAS_POR_COLUNA
                const cartao = (l: (typeof ordenados)[number], k: string) => (
                  <div
                    key={k}
                    className={`rounded-xl px-3 py-2 ${l.atrasado ? 'bg-red-900/45 border-2 border-red-500/60' : l.liberado ? 'bg-green-900/40 border-2 border-green-500/60' : 'bg-dark-800'}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[25px] font-bold tabular-nums">{l.pedido}</p>
                      <p className="text-[16px] text-dark-400 uppercase">{l.empresa}</p>
                    </div>
                    <p className="text-[19px] text-dark-200 leading-tight truncate">{l.cliente}</p>
                    {l.liberado && c.id === 'nf' ? (
                      <p className="text-[18px] leading-tight font-bold text-green-200">
                        ✅ NF {l.nf}
                        <br />
                        LIBERADO PRÓXIMA ETAPA
                      </p>
                    ) : (
                    <p className={`text-[17px] leading-tight truncate ${l.atrasado ? 'text-red-200' : 'text-dark-400'}`}>
                      {c.id === 'coletado'
                        ? `coletado ${horaBr(l.desde)} · ${l.noPrazo ? 'no prazo' : 'fora do prazo'}`
                        : c.id === 'nf'
                          ? l.liberado
                            ? `✅ NF ${l.nf} · LIBERADO PRÓXIMA ETAPA`
                            : `aguardando NF · ${tempoDesde(l.desde, agora)}`
                          : c.id === 'coleta'
                            ? `coleta ${l.coletaAgendada ? `${l.coletaAgendada.slice(8, 10)}/${l.coletaAgendada.slice(5, 7)} ${l.coletaAgendada.slice(11, 16)}` : ''}`
                          : l.trabalhando
                            ? `${l.trabalhando} · ${tempoDesde(l.desde, agora)}`
                            : `aguardando · ${tempoDesde(l.desde, agora)}`}
                    </p>
                    )}
                  </div>
                )
                return (
                  <div key={c.id} className="rounded-3xl bg-dark-900 border-2 border-dark-700 overflow-hidden flex flex-col min-h-0">
                    <div className="h-[10px]" style={{ background: c.cor }} />
                    <div className="px-5 pt-4 pb-3 border-b-2 border-dark-800">
                      <p className="text-[22px] font-bold uppercase whitespace-nowrap" style={{ color: c.cor }}>
                        {c.titulo}
                      </p>
                      <div className="flex items-end gap-3">
                        <p className="text-[110px] font-bold leading-[0.95] tabular-nums">{doCol.length}</p>
                        {atrasCol > 0 && <p className="text-[24px] font-semibold text-red-300 pb-3">{atrasCol} atrasado(s)</p>}
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 px-3 py-3 overflow-hidden">
                      {rolando ? (
                        // Lista duplicada subindo -50% = volta pro começo sem pulo.
                        <div className="painel-rolar" style={{ animationDuration: `${ordenados.length * 3.5}s` }}>
                          <div className="space-y-2 pb-2">{ordenados.map((l) => cartao(l, `a${l.id}`))}</div>
                          <div className="space-y-2 pb-2">{ordenados.map((l) => cartao(l, `b${l.id}`))}</div>
                        </div>
                      ) : (
                        <div className="space-y-2">{ordenados.map((l) => cartao(l, `a${l.id}`))}</div>
                      )}
                      {doCol.length === 0 && <p className="text-[20px] text-dark-600 text-center pt-6">—</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-3">
          {TELAS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTela(i)}
              className={`px-4 py-1 rounded-full text-[16px] transition-colors ${i === tela ? 'bg-teal-400 text-dark-950 font-semibold' : 'bg-dark-800 text-dark-400'}`}
            >
              {t.titulo}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
