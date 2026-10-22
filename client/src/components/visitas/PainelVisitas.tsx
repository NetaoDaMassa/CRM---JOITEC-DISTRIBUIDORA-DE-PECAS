import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { Activity, PieChart as IconePizza } from 'lucide-react'
import { AvatarIniciais } from '../ui/Visual'
import { Pilula } from '../painel/PainelVisual'
import type { Novidade, SecaoLegenda } from '../painel/PainelVisual'

// Painel das Visitas de campo (visual novo, pedido do João 2026-10-22):
// ritmo dos últimos 14 dias, resultados do mês, situação de cada visita
// (em visita agora / concluída / planejada), equipe com barras, novidades
// e legenda.

export const RESULTADO_VISITA: Record<string, { rotulo: string; cor: string }> = {
  '': { rotulo: 'Em andamento', cor: '#eab308' },
  gerar_proposta: { rotulo: 'Gerar Proposta', cor: '#a855f7' },
  follow_up: { rotulo: 'Follow-up', cor: '#3987e5' },
  sem_interesse: { rotulo: 'Sem interesse', cor: '#e5534b' },
  nao_encontrado: { rotulo: 'Não encontrado', cor: '#f97316' },
}

type VisitaBase = {
  dataVisita: string | null
  resultado: string | null
  checkinEm: string | null
  checkoutEm: string | null
  latCheckin?: number | null
  planejada?: boolean | null
}

// dataVisita é hora de parede de Brasília (string), por isso tudo aqui é
// comparação de texto — mesmo cuidado de fuso do resto da tela.
export function hojeBr() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export type Situacao = { rotulo: string; cor: string; pulsar?: boolean }

export function situacaoVisita(v: VisitaBase): Situacao {
  if (v.checkinEm && !v.checkoutEm) return { rotulo: 'Em visita agora', cor: '#22a861', pulsar: true }
  if (v.checkoutEm) return { rotulo: 'Concluída', cor: '#14b8a6' }
  const dia = (v.dataVisita ?? '').slice(0, 10)
  if (dia > hojeBr()) return { rotulo: 'Agendada', cor: '#6366f1' }
  return { rotulo: 'Sem check-in', cor: '#94a3b8' }
}

export function SeloSituacao({ s }: { s: Situacao }) {
  return (
    <Pilula cor={s.cor}>
      <span className="relative flex w-1.5 h-1.5">
        {s.pulsar && <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ background: s.cor }} />}
        <span className="relative inline-flex rounded-full w-1.5 h-1.5" style={{ background: s.cor }} />
      </span>
      {s.rotulo}
    </Pilula>
  )
}

export function numerosDoMes(visitas: VisitaBase[]) {
  const mes = hojeBr().slice(0, 7)
  const doMes = visitas.filter((v) => (v.dataVisita ?? '').slice(0, 7) === mes)
  const comCheckin = doMes.filter((v) => v.checkinEm)
  const comGps = comCheckin.filter((v) => v.latCheckin)
  const propostas = doMes.filter((v) => v.resultado === 'gerar_proposta').length
  const agora = visitas.filter((v) => v.checkinEm && !v.checkoutEm && (v.dataVisita ?? '').slice(0, 10) === hojeBr()).length
  return {
    total: doMes.length,
    propostas,
    taxaProposta: doMes.length ? Math.round((propostas / doMes.length) * 100) : null,
    taxaGps: comCheckin.length ? Math.round((comGps.length / comCheckin.length) * 100) : null,
    agora,
  }
}

export function PainelRitmo({ visitas }: { visitas: VisitaBase[] }) {
  const hoje = hojeBr()
  const dias: { dia: string; rotulo: string; qtd: number; fimDeSemana: boolean }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(`${hoje}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - i)
    const dia = d.toISOString().slice(0, 10)
    const sem = d.getUTCDay()
    dias.push({ dia, rotulo: `${dia.slice(8, 10)}/${dia.slice(5, 7)}`, qtd: 0, fimDeSemana: sem === 0 || sem === 6 })
  }
  for (const v of visitas) {
    const linha = dias.find((d) => d.dia === (v.dataVisita ?? '').slice(0, 10))
    if (linha) linha.qtd++
  }
  const mes = hoje.slice(0, 7)
  const doMes = visitas.filter((v) => (v.dataVisita ?? '').slice(0, 7) === mes)
  const fatias = Object.entries(RESULTADO_VISITA)
    .map(([chave, r]) => ({ chave, rotulo: r.rotulo, cor: r.cor, valor: doMes.filter((v) => (v.resultado ?? '') === chave).length }))
    .filter((f) => f.valor > 0)
  const totalMes = doMes.length
  const mediaDia = (dias.filter((d) => !d.fimDeSemana).reduce((s, d) => s + d.qtd, 0) / Math.max(1, dias.filter((d) => !d.fimDeSemana).length)).toFixed(1)

  return (
    <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr] mb-5">
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={16} className="text-gold-400" />
          <h2 className="text-sm font-semibold text-dark-50">Ritmo das visitas</h2>
          <span className="text-xs text-dark-500">últimos 14 dias · média de {mediaDia.replace('.', ',')} por dia útil</span>
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={dias} margin={{ top: 10, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="rotulo" tick={{ fill: '#898781', fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.05)' }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="bg-dark-800 border border-dark-600 rounded-lg px-2.5 py-1.5 text-xs shadow-lg">
                    <p className="text-dark-300">{String(payload[0].payload.rotulo)}</p>
                    <p className="text-dark-50 font-semibold">
                      {Number(payload[0].value)} {Number(payload[0].value) === 1 ? 'visita' : 'visitas'}
                    </p>
                  </div>
                ) : null
              }
            />
            <Bar dataKey="qtd" radius={[4, 4, 0, 0]} maxBarSize={26}>
              {dias.map((d) => (
                <Cell key={d.dia} fill={d.dia === hoje ? '#e8c440' : d.fimDeSemana ? '#334155' : '#3987e5'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <IconePizza size={16} className="text-gold-400" />
          <h2 className="text-sm font-semibold text-dark-50">Resultado das visitas do mês</h2>
        </div>
        {totalMes ? (
          <div className="flex items-center gap-3">
            <div className="relative w-28 h-28 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={fatias} dataKey="valor" nameKey="rotulo" innerRadius={36} outerRadius={52} paddingAngle={2} stroke="none">
                    {fatias.map((f) => (
                      <Cell key={f.chave} fill={f.cor} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-lg font-bold text-dark-50 leading-none">{totalMes}</p>
                <p className="text-[10px] text-dark-400">visitas</p>
              </div>
            </div>
            <ul className="flex-1 space-y-1">
              {fatias.map((f) => (
                <li key={f.chave} className="flex items-center gap-2 text-[12px]">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: f.cor }} />
                  <span className="text-dark-200 flex-1 truncate">{f.rotulo}</span>
                  <span className="text-dark-50 font-semibold tabular-nums">{f.valor}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-dark-500">Nenhuma visita este mês ainda.</p>
        )}
      </div>
    </div>
  )
}

export function EquipeVisitas({ linhas }: { linhas: { vendedorId: number; nome: string; total: number; gerouProposta: number; semResultado: number }[] }) {
  const max = Math.max(...linhas.map((l) => l.total), 0)
  const medalha = ['🥇', '🥈', '🥉']
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {linhas.map((v, i) => {
        const taxa = v.total ? Math.round((v.gerouProposta / v.total) * 100) : 0
        return (
          <div key={v.vendedorId} className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center gap-2.5">
              <AvatarIniciais nome={v.nome} tamanho={34} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-dark-100 truncate">{v.nome}</p>
                <p className="text-[11px] text-dark-500">{v.semResultado} em andamento</p>
              </div>
              <span className="text-lg">{medalha[i] ?? ''}</span>
            </div>
            <div className="flex items-baseline gap-1.5 mt-3">
              <span className="text-2xl font-bold text-dark-50 tabular-nums">{v.total}</span>
              <span className="text-xs text-dark-400">visitas</span>
              <span className="ml-auto text-xs font-semibold" style={{ color: '#a855f7' }}>
                {v.gerouProposta} propostas · {taxa}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-dark-700 mt-2 overflow-hidden flex">
              <div className="h-full" style={{ width: `${max ? (v.gerouProposta / max) * 100 : 0}%`, background: '#a855f7' }} />
              <div className="h-full" style={{ width: `${max ? ((v.total - v.gerouProposta) / max) * 100 : 0}%`, background: '#3987e5' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const NOVIDADES_VISITAS: Novidade[] = [
  { emoji: '🔢', titulo: 'Números do mês', texto: 'Além de hoje, semana e mês: quantas viraram proposta (%), quantos check-ins tiveram GPS e quem está em visita agora.' },
  { emoji: '📈', titulo: 'Ritmo das visitas', texto: 'Gráfico dos últimos 14 dias (hoje em amarelo, fim de semana em cinza) e a média por dia útil.' },
  { emoji: '🍩', titulo: 'Resultado do mês', texto: 'Rosca com quantas visitas foram para proposta, follow-up, sem interesse ou não encontrado.' },
  { emoji: '🟢', titulo: 'Situação da visita', texto: 'Cada visita mostra se está em visita agora (piscando), concluída, agendada ou sem check-in.' },
  { emoji: '🎨', titulo: 'Cor do resultado', texto: 'A faixa do lado do card tem a cor do resultado. Os botões coloridos em cima da lista filtram por resultado.' },
  { emoji: '🕑', titulo: 'Linha do tempo', texto: 'Em Hoje e Semana, as visitas aparecem numa linha do tempo, na ordem do horário.' },
  { emoji: '👥', titulo: 'Equipe', texto: 'A aba Equipe virou cartões com medalha, total de visitas, propostas geradas e a %.' },
]

export const LEGENDA_VISITAS: SecaoLegenda[] = [
  {
    titulo: 'Cor do resultado (faixa do card e filtros)',
    itens: Object.values(RESULTADO_VISITA).map((r) => ({ marca: <Pilula cor={r.cor}>{r.rotulo}</Pilula>, texto: r.rotulo === 'Em andamento' ? 'Ainda sem resultado marcado.' : `Resultado: ${r.rotulo}.` })),
  },
  {
    titulo: 'Situação da visita',
    itens: [
      { marca: <SeloSituacao s={{ rotulo: 'Em visita', cor: '#22a861', pulsar: true }} />, texto: 'Fez check-in e ainda não fez check-out.' },
      { marca: <SeloSituacao s={{ rotulo: 'Concluída', cor: '#14b8a6' }} />, texto: 'Fez check-out.' },
      { marca: <SeloSituacao s={{ rotulo: 'Agendada', cor: '#6366f1' }} />, texto: 'Marcada para um dia que ainda vai chegar.' },
      { marca: <SeloSituacao s={{ rotulo: 'Sem check-in', cor: '#94a3b8' }} />, texto: 'O dia chegou e ninguém fez check-in.' },
      { marca: <Pilula cor="#22a861">📍 GPS</Pilula>, texto: 'Check-in com localização. "Sem GPS" em laranja = check-in sem localização.' },
    ],
  },
  {
    titulo: 'Números do topo',
    texto: 'Viraram proposta = visitas do mês com resultado "Gerar Proposta" ÷ visitas do mês. Com GPS = check-ins do mês que pegaram a localização.',
  },
]
