import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { Input } from '../components/ui/Input'
import Button from '../components/ui/Button'

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

// Empresas sem arte própria ainda (Compretec) caem no fallback de iniciais
// — nunca deixar o card sem identidade visual nenhuma.
const LOGO_POR_SLUG: Record<string, string> = {
  joitec: '/logos/joitec.png',
  'joitec-automacao': '/logos/joitec.png',
  'odin-tubos': '/logos/odin-tubos.png',
  'odin-compressores': '/logos/odin-compressores.png',
}

function iniciais(nome: string): string {
  const partes = nome.replace(/\/.*/, '').trim().split(/\s+/)
  return partes.length > 1 ? (partes[0][0] + partes[1][0]).toUpperCase() : nome.slice(0, 2).toUpperCase()
}

type Card = {
  cardKey: string
  nome: string
  slugLogo: string
  vendasHoje: { quantidade: number; valor: number }
  vendasMes: { quantidade: number; valor: number }
  ticketMedioMes: number
  metaFaturamento: number
  percentualMeta: number
  bateuMeta: boolean
  inadimplencia: { valorTotal: number; quantidadeClientes: number; atualizadoEm: string | null }
}

function InadimplenciaEditor({ card, onClose }: { card: Card; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [valor, setValor] = useState(String(card.inadimplencia.valorTotal || ''))
  const [qtd, setQtd] = useState(String(card.inadimplencia.quantidadeClientes || ''))

  const mut = trpc.financeiro.atualizarInadimplencia.useMutation({
    onSuccess() {
      toast.success('Inadimplência atualizada')
      utils.financeiro.painelResumo.invalidate()
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="flex items-end gap-2 flex-wrap">
      <Input
        label="Valor total em atraso (R$)"
        type="number"
        min="0"
        step="0.01"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="w-40"
      />
      <Input
        label="Clientes em atraso"
        type="number"
        min="0"
        step="1"
        value={qtd}
        onChange={(e) => setQtd(e.target.value)}
        className="w-32"
      />
      <Button
        size="sm"
        loading={mut.isPending}
        onClick={() =>
          mut.mutate({ cardKey: card.cardKey, valorTotal: Number(valor) || 0, quantidadeClientes: Number(qtd) || 0 })
        }
      >
        Salvar
      </Button>
      <Button size="sm" variant="secondary" onClick={onClose}>
        Cancelar
      </Button>
    </div>
  )
}

function EmpresaCard({ card, editavel }: { card: Card; editavel: boolean }) {
  const [editando, setEditando] = useState(false)
  const meta = card.percentualMeta
  const metaCor = card.bateuMeta ? 'text-green-400' : 'text-gold-400'
  const barraCor = card.bateuMeta ? 'bg-green-500' : 'bg-gold-400'
  const logo = LOGO_POR_SLUG[card.slugLogo]

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6 flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-3">
        {logo ? (
          <div className="bg-white rounded-xl px-3 py-2 h-11 flex items-center">
            <img src={logo} alt={card.nome} className="h-full w-auto max-w-[150px] object-contain" />
          </div>
        ) : (
          <div className="w-11 h-11 rounded-xl bg-gold-600/20 border border-gold-600/40 flex items-center justify-center text-gold-400 font-bold text-sm shrink-0">
            {iniciais(card.nome)}
          </div>
        )}
        <span
          className={`text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap ${
            card.bateuMeta ? 'text-green-400 bg-green-900/30' : 'text-gold-400 bg-gold-900/20'
          }`}
        >
          {card.bateuMeta ? '🎯 Meta em dia' : '⏳ Abaixo do ritmo'}
        </span>
      </div>
      <p className="text-sm font-semibold text-dark-100 mb-4">{card.nome}</p>

      <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold">Faturamento do mês</p>
      <p className="text-3xl font-bold text-dark-50 font-mono tabular-nums mt-1">{formatarMoeda(card.vendasMes.valor)}</p>
      <p className="text-xs text-dark-500 mt-1">Ticket médio {formatarMoeda(card.ticketMedioMes)}</p>

      <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-dark-700">
        <div>
          <p className="text-xl font-bold text-dark-100 font-mono tabular-nums">{card.vendasHoje.quantidade}</p>
          <p className="text-[10px] text-dark-500 uppercase tracking-wide">Vendas hoje</p>
        </div>
        <div>
          <p className="text-xl font-bold text-dark-100 font-mono tabular-nums">{card.vendasMes.quantidade}</p>
          <p className="text-[10px] text-dark-500 uppercase tracking-wide">Vendas no mês</p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-dark-700">
        <div className="flex items-baseline justify-between mb-1.5">
          <p className="text-[10px] text-dark-500 uppercase tracking-wide font-semibold">% da meta batida</p>
          <p className={`text-sm font-bold font-mono tabular-nums ${metaCor}`}>{meta}%</p>
        </div>
        <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${barraCor}`} style={{ width: `${Math.min(100, meta)}%` }} />
        </div>
      </div>

      <div className="-mx-6 mt-4 px-6 py-3.5 bg-red-500/10 border-t border-red-500/20 rounded-b-2xl">
        {editando ? (
          <InadimplenciaEditor card={card} onClose={() => setEditando(false)} />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-red-400">Inadimplência</p>
              <p className="text-[10px] text-dark-500 mt-0.5">✏️ registro manual</p>
            </div>
            <div className="text-right flex items-center gap-2">
              <div>
                <p className="text-base font-bold font-mono tabular-nums text-red-400">
                  {formatarMoeda(card.inadimplencia.valorTotal)}
                </p>
                <p className="text-[10px] text-dark-500">{card.inadimplencia.quantidadeClientes} clientes em atraso</p>
              </div>
              {editavel && (
                <button
                  onClick={() => setEditando(true)}
                  className="text-dark-400 hover:text-gold-400 text-xs px-2 py-1 rounded-lg hover:bg-dark-700 transition-colors"
                  title="Editar inadimplência"
                >
                  ✏️
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Painel de TV financeiro, restrito a superAdmin — consolida faturamento,
// vendas, % de meta e inadimplência (registrada manualmente, não tem fonte
// automática ainda) das empresas do grupo (ver CARDS_PAINEL em
// server/src/router/financeiro.ts pra lista + regra de quais empresas
// juntam num card só). Pensado pra ficar numa sala fechada (não no chão de
// vendas, que já esconde faturamento de propósito no /painel-tv normal —
// ver comentário em PainelTV.tsx).
export default function PainelFinanceiro() {
  const [relogio, setRelogio] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setRelogio(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const { data } = trpc.financeiro.painelResumo.useQuery(undefined, {
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  })

  const consolidado = data?.consolidado
  const metaConsolidadaCor = consolidado?.percentualMeta && consolidado.percentualMeta >= 100 ? 'text-green-400' : 'text-gold-400'

  return (
    <div className="min-h-screen bg-dark-950 text-dark-50 p-8">
      <div className="flex items-center justify-between mb-6 pb-5 border-b border-dark-700">
        <div>
          <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold">Grupo Odin · Painel Financeiro</p>
          <h1 className="font-heading text-2xl text-dark-50 font-bold mt-0.5">Visão consolidada das empresas</h1>
        </div>
        <div className="text-right">
          <p className="text-2xl font-mono tabular-nums">{relogio.toLocaleTimeString('pt-BR')}</p>
          <p className="text-sm text-dark-400 capitalize">
            {relogio.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {!data && <p className="text-dark-500">Carregando...</p>}

      {data && consolidado && (
        <>
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6 mb-6 grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-6">
            <div>
              <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold">Faturamento consolidado — mês</p>
              <p className="text-5xl font-bold text-dark-50 font-mono tabular-nums mt-1">{formatarMoeda(consolidado.valorMes)}</p>
              <p className="text-sm text-dark-400 mt-2">
                {consolidado.vendasMesQtd} vendas fechadas no grupo · {consolidado.vendasHojeQtd} hoje
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 items-center">
              <div className="text-center">
                <p className={`text-3xl font-bold font-mono tabular-nums ${metaConsolidadaCor}`}>{consolidado.percentualMeta}%</p>
                <p className="text-[10px] text-dark-500 uppercase tracking-wide font-semibold mt-1">Meta do grupo</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold font-mono tabular-nums text-red-400">{formatarMoeda(consolidado.inadimplenciaTotal)}</p>
                <p className="text-[10px] text-dark-500 uppercase tracking-wide font-semibold mt-1">Inadimplência total</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {data.cards.map((card) => (
              <EmpresaCard key={card.cardKey} card={card} editavel />
            ))}
          </div>
        </>
      )}

      <p className="text-center text-xs text-dark-500 mt-8">Atualiza automaticamente a cada 30s</p>
    </div>
  )
}
