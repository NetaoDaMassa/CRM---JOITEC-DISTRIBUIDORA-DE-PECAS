// Serviços — Compretec Loja Física (João, 2026-11-27). Substitui a planilha
// "Controle de serviços": cliente da carteira, lead do marketing ou prospect
// vira um serviço (manutenção, rede de ar, instalação ou tudo junto), com as
// mesmas situações e cores da planilha. Regras (servidor, lib/servicos.ts):
//   - montando orçamento → resposta em no máximo 1 dia útil;
//   - aguardando cliente → data do próximo contato obrigatória;
//   - não aprovou → motivo obrigatório;
//   - finalizado → vira venda no card do cliente na carteira (Fechado).
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  AlarmClock,
  CalendarClock,
  Download,
  HardHat,
  LayoutGrid,
  MapPin,
  MessageCircle,
  Navigation,
  Plus,
  Search,
  Table2,
  Trash2,
} from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import { Input, Textarea } from '../components/ui/Input'
import Select from '../components/ui/Select'
import { AvatarIniciais } from '../components/ui/Visual'

type Status = 'montando_orcamento' | 'aguardando_cliente' | 'em_andamento' | 'finalizado' | 'nao_aprovou'

// Mesmas cores da planilha.
export const STATUS: { value: Status; label: string; cor: string }[] = [
  { value: 'montando_orcamento', label: 'Montando orçamento', cor: '#e040b8' },
  { value: 'aguardando_cliente', label: 'Aguardando cliente', cor: '#2f6fed' },
  { value: 'em_andamento', label: 'Em andamento', cor: '#f0712c' },
  { value: 'finalizado', label: 'Finalizado', cor: '#4cc94c' },
  { value: 'nao_aprovou', label: 'Não aprovou', cor: '#e5393a' },
]
const STATUS_MAP = Object.fromEntries(STATUS.map((s) => [s.value, s])) as Record<Status, (typeof STATUS)[number]>

const MOTIVOS = [
  { value: 'preco', label: 'Preço' },
  { value: 'fechou_outro', label: 'Fechou com outro' },
  { value: 'desistiu', label: 'Desistiu / não vai fazer' },
  { value: 'sem_retorno', label: 'Sem retorno do cliente' },
  { value: 'adiou', label: 'Adiou (fica pra depois)' },
  { value: 'outro', label: 'Outro' },
]
const MOTIVO_LABEL: Record<string, string> = Object.fromEntries(MOTIVOS.map((m) => [m.value, m.label]))

const FORMAS_PAGAMENTO = ['Dinheiro', 'Pix', 'Cartão Crédito', 'Cartão Débito', 'Boleto', 'Outro'].map((v) => ({ value: v, label: v }))

const ORIGEM: Record<string, { label: string; cls: string }> = {
  carteira: { label: 'Carteira', cls: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40' },
  marketing: { label: 'Marketing', cls: 'bg-fuchsia-900/30 text-fuchsia-300 border-fuchsia-700/40' },
  prospeccao: { label: 'Prospecção', cls: 'bg-sky-900/30 text-sky-300 border-sky-700/40' },
  avulso: { label: 'Sem cadastro', cls: 'bg-dark-700 text-dark-300 border-dark-600' },
}

const TIPOS = [
  { key: 'manutencao', label: 'Manutenção', emoji: '🔧' },
  { key: 'redeAr', label: 'Rede de ar', emoji: '🌬️' },
  { key: 'instalacao', label: 'Instalação', emoji: '🏗️' },
] as const

const hojeBr = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
const somarDias = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
const dataBr = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '')
const dataHoraBr = (d: string | null | undefined) => (d ? `${dataBr(d.slice(0, 10))} ${d.slice(11, 16)}` : '')
const brl = (v: number | null | undefined) => (v || v === 0 ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—')
const numOuNull = (s: string) => {
  const t = s.replace(/\./g, '').replace(',', '.').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}
const paraCampo = (v: number | null | undefined) => (v || v === 0 ? String(v).replace('.', ',') : '')
const linkWhats = (tel: string | null | undefined, texto = '') => {
  const d = (tel ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  return `https://wa.me/${d.startsWith('55') ? d : `55${d}`}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`
}

function PillStatus({ status, pequeno }: { status: Status; pequeno?: boolean }) {
  const s = STATUS_MAP[status]
  return (
    <span className={`inline-flex items-center rounded-full font-semibold text-white whitespace-nowrap ${pequeno ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'}`} style={{ background: s.cor }}>
      {s.label}
    </span>
  )
}

function ChipsTipos({ tipos }: { tipos: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {tipos.map((t) => {
        const tp = TIPOS.find((x) => x.label === t)
        return (
          <span key={t} className="text-[10px] font-medium rounded-md px-1.5 py-0.5 bg-dark-700 text-dark-200 border border-dark-600">
            {tp?.emoji} {t}
          </span>
        )
      })}
    </div>
  )
}

type Saida = inferRouterOutputs<AppRouter>
type Item = Saida['servicos']['listar']['itens'][number]
function useListar(mes: string, vendedorId?: number) {
  return trpc.servicos.listar.useQuery({ mes, vendedorId })
}

function AlertaItem({ i }: { i: Item }) {
  if (i.orcamentoAtrasado)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-1.5 py-0.5 bg-red-900/30 text-red-300 border border-red-700/40">
        <AlarmClock size={11} /> Orçamento atrasado · era até {i.prazoOrcamentoBr?.slice(8, 10)}/{i.prazoOrcamentoBr?.slice(5, 7)} {i.prazoOrcamentoBr?.slice(11)}
      </span>
    )
  if (i.status === 'montando_orcamento' && i.prazoOrcamentoBr)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] rounded-md px-1.5 py-0.5 bg-fuchsia-900/20 text-fuchsia-300 border border-fuchsia-700/30">
        <AlarmClock size={11} /> Responder até {i.prazoOrcamentoBr.slice(8, 10)}/{i.prazoOrcamentoBr.slice(5, 7)} {i.prazoOrcamentoBr.slice(11)}
      </span>
    )
  if (i.status === 'aguardando_cliente' && i.proximoContato)
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-md px-1.5 py-0.5 border ${
          i.contatoVencido ? 'bg-red-900/30 text-red-300 border-red-700/40' : i.contatoHoje ? 'bg-gold-900/30 text-gold-300 border-gold-600/40' : 'bg-blue-900/20 text-blue-300 border-blue-700/40'
        }`}
      >
        <CalendarClock size={11} /> {i.contatoVencido ? `Contato atrasado · era ${dataBr(i.proximoContato)}` : i.contatoHoje ? 'Falar com o cliente hoje' : `Contato em ${dataBr(i.proximoContato)}`}
      </span>
    )
  if (i.status === 'em_andamento' && i.dataExecucao)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] rounded-md px-1.5 py-0.5 bg-orange-900/20 text-orange-300 border border-orange-700/30">
        <CalendarClock size={11} /> Serviço em {dataBr(i.dataExecucao)}
      </span>
    )
  if (i.status === 'nao_aprovou' && i.motivoNaoAprovouCategoria)
    return <span className="text-[11px] text-red-300/80">Motivo: {MOTIVO_LABEL[i.motivoNaoAprovouCategoria] ?? i.motivoNaoAprovouCategoria}</span>
  return null
}

function CardServico({ i, onAbrir, gestor }: { i: Item; onAbrir: () => void; gestor: boolean }) {
  return (
    <button
      draggable={i.status !== 'finalizado'}
      onDragStart={(e) => e.dataTransfer.setData('text/servico', String(i.id))}
      onClick={onAbrir}
      className={`w-full text-left rounded-xl bg-dark-800 border p-3 hover:border-dark-500 transition-colors space-y-1.5 ${i.orcamentoAtrasado || i.contatoVencido ? 'border-red-700/60' : 'border-dark-700'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-dark-100 leading-tight">{i.clienteNome}</p>
        {i.valorTotal > 0 && <span className="text-xs font-semibold text-emerald-300 whitespace-nowrap">{brl(i.valorTotal)}</span>}
      </div>
      <ChipsTipos tipos={i.tipos} />
      {i.compressor && <p className="text-xs text-dark-300">Compressor: {i.compressor}</p>}
      <AlertaItem i={i} />
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className={`text-[10px] rounded-md px-1.5 py-0.5 border ${ORIGEM[i.origem]?.cls}`}>{ORIGEM[i.origem]?.label}</span>
        {gestor && i.vendedorNome && (
          <span className="flex items-center gap-1 text-[11px] text-dark-400">
            <AvatarIniciais nome={i.vendedorNome} tamanho={18} /> {i.vendedorNome}
          </span>
        )}
      </div>
    </button>
  )
}

export default function Servicos() {
  const { user } = useAuth()
  const gestor = !!user && (user.role !== 'vendor' || user.superAdmin)
  const [params, setParams] = useSearchParams()
  const [mes, setMes] = useState(hojeBr().slice(0, 7))
  const [vendedorId, setVendedorId] = useState<number | undefined>()
  const [visao, setVisao] = useState<'quadro' | 'planilha'>('quadro')
  const [busca, setBusca] = useState('')
  const [novoAberto, setNovoAberto] = useState(false)
  const [abertoId, setAbertoId] = useState<number | null>(null)
  const [mudar, setMudar] = useState<{ id: number; status: Status } | null>(null)
  const { data, isLoading } = useListar(mes, vendedorId)
  const { data: vendedores } = trpc.servicos.vendedores.useQuery(undefined, { enabled: gestor })

  // Vindo do card do Kanban / lead / prospecção: abre o "Novo serviço" já com o cliente.
  const preCliente = params.get('cliente') ? Number(params.get('cliente')) : undefined
  const preLead = params.get('lead') ? Number(params.get('lead')) : undefined
  const preAbrir = params.get('abrir') ? Number(params.get('abrir')) : undefined
  useEffect(() => {
    if (preCliente || preLead) setNovoAberto(true)
    if (preAbrir) setAbertoId(preAbrir)
  }, [preCliente, preLead, preAbrir])
  const limparParams = () => {
    if (params.toString()) setParams({}, { replace: true })
  }

  const itens = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const l = data?.itens ?? []
    return t ? l.filter((i) => [i.clienteNome, i.compressor, i.descricao, i.vendedorNome].some((x) => (x ?? '').toLowerCase().includes(t))) : l
  }, [data, busca])

  const r = data?.resumo
  const mesAtual = mes === hojeBr().slice(0, 7)

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-dark-50 flex items-center gap-2">
            <HardHat className="text-gold-400" size={22} /> Serviços
          </h1>
          <p className="text-sm text-dark-400">Manutenção, rede de ar e instalação: do orçamento até virar venda na carteira.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-dark-400">
            Mês
            <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="block mt-1 bg-dark-800 border border-dark-600 rounded-lg px-2 py-1.5 text-sm text-dark-100" />
          </label>
          {gestor && (
            <label className="text-xs text-dark-400">
              Vendedor
              <select
                value={vendedorId ?? ''}
                onChange={(e) => setVendedorId(e.target.value ? Number(e.target.value) : undefined)}
                className="block mt-1 bg-dark-800 border border-dark-600 rounded-lg px-2 py-1.5 text-sm text-dark-100"
              >
                <option value="">Todos</option>
                {vendedores?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente, compressor…"
              className="bg-dark-800 border border-dark-600 rounded-lg pl-8 pr-2 py-1.5 text-sm text-dark-100 w-52"
            />
          </div>
          <div className="flex rounded-lg border border-dark-600 overflow-hidden">
            <button onClick={() => setVisao('quadro')} className={`px-2.5 py-1.5 text-sm flex items-center gap-1 ${visao === 'quadro' ? 'bg-dark-600 text-dark-50' : 'text-dark-400'}`}>
              <LayoutGrid size={14} /> Quadro
            </button>
            <button onClick={() => setVisao('planilha')} className={`px-2.5 py-1.5 text-sm flex items-center gap-1 ${visao === 'planilha' ? 'bg-dark-600 text-dark-50' : 'text-dark-400'}`}>
              <Table2 size={14} /> Planilha
            </button>
          </div>
          <Button onClick={() => setNovoAberto(true)}>
            <Plus size={16} className="inline -mt-0.5 mr-1" /> Novo serviço
          </Button>
        </div>
      </div>

      {r && (r.orcamentosAtrasados > 0 || r.contatosVencidos > 0 || r.contatosHoje > 0) && (
        <div className="flex flex-wrap gap-2">
          {r.orcamentosAtrasados > 0 && (
            <span className="rounded-xl bg-red-900/30 border border-red-700/50 text-red-200 text-sm px-3 py-2 flex items-center gap-2">
              <AlarmClock size={16} /> {r.orcamentosAtrasados} orçamento{r.orcamentosAtrasados > 1 ? 's' : ''} passou de 1 dia sem resposta ao cliente
            </span>
          )}
          {r.contatosVencidos > 0 && (
            <span className="rounded-xl bg-red-900/20 border border-red-700/40 text-red-200 text-sm px-3 py-2 flex items-center gap-2">
              <CalendarClock size={16} /> {r.contatosVencidos} cliente{r.contatosVencidos > 1 ? 's' : ''} com contato atrasado
            </span>
          )}
          {r.contatosHoje > 0 && (
            <span className="rounded-xl bg-gold-900/20 border border-gold-600/40 text-gold-200 text-sm px-3 py-2 flex items-center gap-2">
              <CalendarClock size={16} /> {r.contatosHoje} para falar hoje
            </span>
          )}
        </div>
      )}

      {r && <Resumo r={r} mesAtual={mesAtual} gestor={gestor} />}

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando…</p>
      ) : visao === 'quadro' ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {STATUS.map((st) => {
            const col = itens.filter((i) => i.status === st.value)
            const total = col.reduce((a, i) => a + i.valorTotal, 0)
            return (
              <div
                key={st.value}
                className="shrink-0 w-72"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = Number(e.dataTransfer.getData('text/servico'))
                  const it = itens.find((i) => i.id === id)
                  if (it && it.status !== st.value) setMudar({ id, status: st.value })
                }}
              >
                <div className="flex items-center gap-2 mb-3 rounded-xl bg-dark-800/70 border border-dark-700 px-3 py-2 border-t-[3px]" style={{ borderTopColor: st.cor }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: st.cor }} />
                  <span className="text-sm font-semibold text-dark-100">{st.label}</span>
                  <span className="text-[11px] font-semibold text-dark-300 bg-dark-700 rounded-full px-2 py-0.5">{col.length}</span>
                  {total > 0 && <span className="ml-auto text-[11px] text-dark-400">{brl(total)}</span>}
                </div>
                <div className="space-y-2 min-h-[120px]">
                  {col.map((i) => (
                    <CardServico key={i.id} i={i} gestor={gestor} onAbrir={() => setAbertoId(i.id)} />
                  ))}
                  {!col.length && <p className="text-xs text-dark-500 text-center py-6 border border-dashed border-dark-700 rounded-xl">Nada aqui</p>}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Planilha itens={itens} mes={mes} onAbrir={setAbertoId} />
      )}

      {novoAberto && (
        <NovoServico
          gestor={gestor}
          preCliente={preCliente}
          preLead={preLead}
          onClose={() => {
            setNovoAberto(false)
            limparParams()
          }}
          onCriado={(id) => {
            setNovoAberto(false)
            limparParams()
            setAbertoId(id)
          }}
        />
      )}
      {abertoId && (
        <DetalheServico
          id={abertoId}
          gestor={gestor}
          onClose={() => {
            setAbertoId(null)
            limparParams()
          }}
          onMudar={(status) => setMudar({ id: abertoId, status })}
        />
      )}
      {mudar && <MudarStatus id={mudar.id} status={mudar.status} onClose={() => setMudar(null)} />}
    </div>
  )
}

type Resumo = Saida['servicos']['listar']['resumo']
function Resumo({ r, mesAtual, gestor }: { r: Resumo; mesAtual: boolean; gestor: boolean }) {
  const [aberto, setAberto] = useState(false)
  const Card = ({ titulo, valor, sub, cor }: { titulo: string; valor: string; sub?: string; cor: string }) => (
    <div className="rounded-xl bg-dark-800 border border-dark-700 px-3 py-2.5 border-l-[3px]" style={{ borderLeftColor: cor }}>
      <p className="text-[11px] uppercase tracking-wide text-dark-400">{titulo}</p>
      <p className="text-lg font-bold text-dark-50">{valor}</p>
      {sub && <p className="text-[11px] text-dark-400">{sub}</p>}
    </div>
  )
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card titulo="Finalizados no mês" valor={String(r.finalizados)} sub={`${brl(r.valorFinalizado)} · mão de obra ${brl(r.valorMaoObra)}`} cor="#4cc94c" />
        <Card titulo={mesAtual ? 'Em aberto agora' : 'Em aberto'} valor={String(r.emAberto)} sub={`${brl(r.valorEmAberto)} aguardando/andando`} cor="#f0712c" />
        <Card titulo="Não aprovou" valor={String(r.naoAprovou)} sub={brl(r.valorPerdido)} cor="#e5393a" />
        <Card titulo="Aprovação" valor={r.taxaAprovacao === null ? '—' : `${r.taxaAprovacao}%`} sub="finalizados ÷ (finalizados + não aprovou)" cor="#2f6fed" />
        <Card
          titulo="Orçamento em 1 dia"
          valor={r.orcamentosRespondidos ? `${Math.round((r.orcamentosNoPrazo / r.orcamentosRespondidos) * 100)}%` : '—'}
          sub={`${r.orcamentosNoPrazo} de ${r.orcamentosRespondidos} respondidos no prazo`}
          cor="#e040b8"
        />
      </div>
      <button onClick={() => setAberto((a) => !a)} className="text-xs text-gold-400 hover:underline">
        {aberto ? 'Esconder detalhes do mês' : 'Ver por tipo, por vendedor e motivos de não aprovação'}
      </button>
      {aberto && (
        <div className="grid md:grid-cols-3 gap-2">
          <div className="rounded-xl bg-dark-800 border border-dark-700 p-3">
            <p className="text-xs font-semibold text-dark-200 mb-2">Por tipo de serviço</p>
            <table className="w-full text-xs">
              <thead className="text-dark-400">
                <tr>
                  <th className="text-left font-normal">Tipo</th>
                  <th className="text-right font-normal">Abertos</th>
                  <th className="text-right font-normal">Finalizados</th>
                  <th className="text-right font-normal">Valor</th>
                </tr>
              </thead>
              <tbody className="text-dark-200">
                {r.porTipo.map((p) => (
                  <tr key={p.tipo}>
                    <td className="py-0.5">{p.tipo}</td>
                    <td className="text-right">{p.abertos}</td>
                    <td className="text-right">{p.finalizados}</td>
                    <td className="text-right">{brl(p.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-dark-500 mt-1">Serviço com mais de um tipo conta em cada um.</p>
          </div>
          {gestor && (
            <div className="rounded-xl bg-dark-800 border border-dark-700 p-3">
              <p className="text-xs font-semibold text-dark-200 mb-2">Por vendedor</p>
              <table className="w-full text-xs">
                <thead className="text-dark-400">
                  <tr>
                    <th className="text-left font-normal">Vendedor</th>
                    <th className="text-right font-normal">Abertos</th>
                    <th className="text-right font-normal">Final.</th>
                    <th className="text-right font-normal">Não apr.</th>
                    <th className="text-right font-normal">Valor</th>
                  </tr>
                </thead>
                <tbody className="text-dark-200">
                  {r.porVendedor.map((v) => (
                    <tr key={v.nome}>
                      <td className="py-0.5">{v.nome}</td>
                      <td className="text-right">{v.abertos}</td>
                      <td className="text-right">{v.finalizados}</td>
                      <td className="text-right">{v.naoAprovou}</td>
                      <td className="text-right">{brl(v.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="rounded-xl bg-dark-800 border border-dark-700 p-3">
            <p className="text-xs font-semibold text-dark-200 mb-2">Por que não aprovaram</p>
            {r.motivosNaoAprovou.length ? (
              r.motivosNaoAprovou.map((m) => (
                <div key={m.motivo} className="flex justify-between text-xs text-dark-200 py-0.5">
                  <span>{MOTIVO_LABEL[m.motivo] ?? m.motivo}</span>
                  <span className="font-semibold">{m.qtd}</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-dark-500">Nenhum serviço recusado no mês.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Planilha({ itens, mes, onAbrir }: { itens: Item[]; mes: string; onAbrir: (id: number) => void }) {
  const [aba, setAba] = useState<'todos' | 'Manutenção' | 'Rede de ar' | 'Instalação'>('todos')
  const doMes = itens.filter((i) => i.createdAt && new Date(new Date(i.createdAt.replace(' ', 'T') + 'Z').getTime() - 3 * 3_600_000).toISOString().slice(0, 7) === mes)
  const outros = itens.filter((i) => !doMes.includes(i))
  const filtrar = (l: Item[]) => (aba === 'todos' ? l : l.filter((i) => i.tipos.includes(aba)))
  const linhas = [...filtrar(doMes), ...filtrar(outros)]

  const exportar = () => {
    const cab = ['Aberto em', 'Cliente', 'Origem', 'Serviço', 'Compressor', 'Vendedor', 'Mão de obra', 'Material', 'Total', 'Situação', 'Motivo / observação']
    const linhasCsv = linhas.map((i) => [
      dataBr(i.createdAt),
      i.clienteNome,
      ORIGEM[i.origem]?.label ?? i.origem,
      i.tipos.join(' + '),
      i.compressor ?? '',
      i.vendedorNome ?? '',
      paraCampo(i.valorMaoObra),
      paraCampo(i.valorMaterial),
      paraCampo(i.valorTotal),
      STATUS_MAP[i.status as Status].label,
      i.status === 'nao_aprovou' ? `${MOTIVO_LABEL[i.motivoNaoAprovouCategoria ?? ''] ?? ''} - ${i.motivoNaoAprovou ?? ''}` : '',
    ])
    const csv = '﻿' + [cab, ...linhasCsv].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `servicos-${mes}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {(['todos', 'Manutenção', 'Rede de ar', 'Instalação'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAba(t)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${aba === t ? 'bg-gold-600 text-dark-950 border-gold-500 font-semibold' : 'border-dark-600 text-dark-300'}`}
          >
            {t === 'todos' ? 'Todos' : t}
          </button>
        ))}
        <button onClick={exportar} className="ml-auto text-sm text-dark-300 hover:text-dark-100 flex items-center gap-1">
          <Download size={14} /> Baixar planilha (Excel)
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-dark-700">
        <table className="w-full text-sm">
          <thead className="bg-dark-800 text-dark-400 text-xs">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Cliente</th>
              <th className="text-left px-3 py-2 font-medium">Serviço</th>
              <th className="text-left px-3 py-2 font-medium">Compressor</th>
              <th className="text-left px-3 py-2 font-medium">Vendedor</th>
              <th className="text-right px-3 py-2 font-medium">Mão de obra</th>
              <th className="text-right px-3 py-2 font-medium">Material</th>
              <th className="text-left px-3 py-2 font-medium">Situação</th>
              <th className="text-left px-3 py-2 font-medium">Aberto em</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((i, idx) => (
              <tr key={i.id} onClick={() => onAbrir(i.id)} className={`cursor-pointer hover:bg-dark-800/70 border-t border-dark-800 ${idx === filtrar(doMes).length && idx > 0 ? 'border-t-2 border-t-dark-600' : ''}`}>
                <td className="px-3 py-2 text-dark-100">{i.clienteNome}</td>
                <td className="px-3 py-2 text-dark-300 text-xs">{i.tipos.join(' + ')}</td>
                <td className="px-3 py-2 text-dark-300">{i.compressor ?? ''}</td>
                <td className="px-3 py-2 text-dark-300">{i.vendedorNome ?? ''}</td>
                <td className="px-3 py-2 text-right text-dark-200">{i.valorMaoObra ? brl(i.valorMaoObra) : '-'}</td>
                <td className="px-3 py-2 text-right text-dark-200">{i.valorMaterial ? brl(i.valorMaterial) : '-'}</td>
                <td className="px-3 py-2">
                  <PillStatus status={i.status as Status} pequeno />
                </td>
                <td className="px-3 py-2 text-dark-400 text-xs">{dataBr(i.createdAt)}</td>
              </tr>
            ))}
            {!linhas.length && (
              <tr>
                <td colSpan={8} className="text-center text-dark-500 py-8">
                  Nenhum serviço.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {outros.length > 0 && <p className="text-[11px] text-dark-500">Embaixo da linha: serviços abertos em outros meses que ainda estão andando ou fecharam neste mês.</p>}
    </div>
  )
}

type Origem = { chave: string; origem: 'carteira' | 'marketing' | 'prospeccao'; clienteId: number | null; leadId: number | null; nome: string; telefone: string | null; cidade: string | null; vendedorNome: string | null; servicoAberto: boolean }

function CamposServico({
  f,
  set,
}: {
  f: { manutencao: boolean; redeAr: boolean; instalacao: boolean; compressor: string; descricao: string; endereco: string; maoObra: string; material: string; dataExecucao: string }
  set: (p: Partial<typeof f>) => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-dark-200 mb-1.5">O que vai ser feito? (pode marcar mais de um)</p>
        <div className="grid grid-cols-3 gap-2">
          {TIPOS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => set({ [t.key]: !f[t.key] } as Partial<typeof f>)}
              className={`rounded-xl border px-2 py-3 text-sm font-medium transition-colors ${f[t.key] ? 'bg-gold-600/20 border-gold-500 text-gold-200' : 'border-dark-600 text-dark-300 hover:border-dark-500'}`}
            >
              <span className="text-lg block">{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input label="Compressor (modelo / tamanho)" placeholder="Ex.: CSL 20BR, 10 pés, Storm 300" value={f.compressor} onChange={(e) => set({ compressor: e.target.value })} />
        <Input label="Data prevista do serviço" type="date" value={f.dataExecucao} onChange={(e) => set({ dataExecucao: e.target.value })} />
      </div>
      {(f.redeAr || f.instalacao) && <Input label="Endereço da obra / visita" placeholder="Rua, número, bairro, cidade" value={f.endereco} onChange={(e) => set({ endereco: e.target.value })} />}
      <Textarea label="O que o cliente precisa" rows={2} placeholder="Ex.: troca de válvula e revisão; rede de 40 m no galpão…" value={f.descricao} onChange={(e) => set({ descricao: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <Input label="Mão de obra (R$)" inputMode="decimal" placeholder="0,00" value={f.maoObra} onChange={(e) => set({ maoObra: e.target.value })} />
        <Input label="Material / peças (R$)" inputMode="decimal" placeholder="0,00" value={f.material} onChange={(e) => set({ material: e.target.value })} />
      </div>
      <p className="text-[11px] text-dark-500">Pode deixar o valor em branco e preencher quando o orçamento ficar pronto.</p>
    </div>
  )
}

const camposVazios = { manutencao: false, redeAr: false, instalacao: false, compressor: '', descricao: '', endereco: '', maoObra: '', material: '', dataExecucao: '' }

function NovoServico({ gestor, preCliente, preLead, onClose, onCriado }: { gestor: boolean; preCliente?: number; preLead?: number; onClose: () => void; onCriado: (id: number) => void }) {
  const [texto, setTexto] = useState('')
  const [escolhido, setEscolhido] = useState<Origem | null>(null)
  const [avulso, setAvulso] = useState<{ nome: string; telefone: string } | null>(null)
  const [f, setF] = useState(camposVazios)
  const [vendedorId, setVendedorId] = useState<number | undefined>()
  const { data: resultados, isFetching } = trpc.servicos.buscarOrigem.useQuery({ texto }, { enabled: texto.trim().length >= 2 && !escolhido })
  const { data: pre } = trpc.servicos.origemPorId.useQuery({ clienteId: preCliente, leadId: preLead }, { enabled: !!(preCliente || preLead) })
  const { data: vendedores } = trpc.servicos.vendedores.useQuery(undefined, { enabled: gestor })
  useEffect(() => {
    if (pre && !escolhido) setEscolhido(pre as Origem)
  }, [pre, escolhido])
  const utils = trpc.useUtils()
  const criar = trpc.servicos.criar.useMutation({
    onSuccess: (r) => {
      toast.success('Serviço aberto — prazo de 1 dia útil para responder o orçamento')
      utils.servicos.listar.invalidate()
      onCriado(r.id)
    },
    onError: (e) => toast.error(e.message),
  })
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))

  const salvar = () => {
    if (!escolhido && !avulso) return toast.error('Escolha o cliente')
    if (!f.manutencao && !f.redeAr && !f.instalacao) return toast.error('Marque o que vai ser feito')
    criar.mutate({
      origem: escolhido ? escolhido.origem : 'avulso',
      clienteId: escolhido?.clienteId ?? null,
      leadId: escolhido?.leadId ?? null,
      clienteNome: avulso?.nome ?? undefined,
      telefone: avulso?.telefone || undefined,
      manutencao: f.manutencao,
      redeAr: f.redeAr,
      instalacao: f.instalacao,
      compressor: f.compressor || null,
      descricao: f.descricao || null,
      endereco: f.endereco || null,
      valorMaoObra: numOuNull(f.maoObra),
      valorMaterial: numOuNull(f.material),
      dataExecucao: f.dataExecucao || null,
      vendedorId,
    })
  }

  return (
    <Modal open onClose={onClose} title="Novo serviço" size="lg">
      <div className="space-y-4">
        {!escolhido && !avulso ? (
          <div className="space-y-2">
            <Input label="Cliente" autoFocus placeholder="Nome, telefone, CNPJ/CPF ou código…" value={texto} onChange={(e) => setTexto(e.target.value)} icon={<Search size={14} />} />
            <p className="text-[11px] text-dark-500">Procura na sua carteira, na prospecção e nos leads do marketing.</p>
            {isFetching && <p className="text-xs text-dark-400">Procurando…</p>}
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {resultados?.map((o) => (
                <button key={o.chave} onClick={() => setEscolhido(o as Origem)} className="w-full text-left rounded-lg border border-dark-700 hover:border-dark-500 px-3 py-2 flex items-center gap-2">
                  <span className={`text-[10px] rounded-md px-1.5 py-0.5 border shrink-0 ${ORIGEM[o.origem].cls}`}>{ORIGEM[o.origem].label}</span>
                  <span className="text-sm text-dark-100 flex-1 truncate">{o.nome}</span>
                  {o.cidade && <span className="text-[11px] text-dark-500">{o.cidade}</span>}
                  {gestor && o.vendedorNome && <span className="text-[11px] text-dark-400">{o.vendedorNome}</span>}
                  {o.servicoAberto && <span className="text-[10px] text-orange-300">já tem serviço aberto</span>}
                </button>
              ))}
              {texto.trim().length >= 2 && !isFetching && resultados && !resultados.length && <p className="text-xs text-dark-500">Ninguém encontrado.</p>}
            </div>
            <button onClick={() => setAvulso({ nome: texto, telefone: '' })} className="text-xs text-gold-400 hover:underline">
              Cliente ainda sem cadastro? Abrir assim mesmo (cadastra quando finalizar)
            </button>
          </div>
        ) : (
          <div className="rounded-xl bg-dark-900/60 border border-dark-700 px-3 py-2 flex items-center gap-2">
            {escolhido ? (
              <>
                <span className={`text-[10px] rounded-md px-1.5 py-0.5 border ${ORIGEM[escolhido.origem].cls}`}>{ORIGEM[escolhido.origem].label}</span>
                <span className="text-sm font-semibold text-dark-100 flex-1">{escolhido.nome}</span>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 flex-1">
                <Input label="Nome do cliente" value={avulso!.nome} onChange={(e) => setAvulso({ ...avulso!, nome: e.target.value })} />
                <Input label="WhatsApp" value={avulso!.telefone} onChange={(e) => setAvulso({ ...avulso!, telefone: e.target.value })} />
              </div>
            )}
            <button
              onClick={() => {
                setEscolhido(null)
                setAvulso(null)
              }}
              className="text-xs text-dark-400 hover:text-dark-200"
            >
              trocar
            </button>
          </div>
        )}
        {escolhido?.servicoAberto && <p className="text-xs text-orange-300">Esse cliente já tem um serviço em aberto — confira antes de abrir outro.</p>}

        {(escolhido || avulso) && (
          <>
            <CamposServico f={f} set={set} />
            {gestor && (
              <Select
                label="Vendedor responsável"
                value={vendedorId ?? ''}
                onChange={(e) => setVendedorId(e.target.value ? Number(e.target.value) : undefined)}
                options={[{ value: '', label: 'O vendedor do cliente' }, ...(vendedores ?? []).map((v) => ({ value: v.id, label: v.nome }))]}
              />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancelar
              </Button>
              <Button onClick={salvar} loading={criar.isPending}>
                Abrir serviço
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function pegarGps(): Promise<{ lat: number; lng: number; precisao: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    )
  })
}

function DetalheServico({ id, gestor, onClose, onMudar }: { id: number; gestor: boolean; onClose: () => void; onMudar: (s: Status) => void }) {
  const { data: s } = trpc.servicos.obter.useQuery({ id })
  const { data: vendedores } = trpc.servicos.vendedores.useQuery(undefined, { enabled: gestor })
  const utils = trpc.useUtils()
  const recarregar = () => {
    utils.servicos.obter.invalidate({ id })
    utils.servicos.listar.invalidate()
  }
  const [editando, setEditando] = useState(false)
  const [f, setF] = useState(camposVazios)
  const [vendedorId, setVendedorId] = useState<number | undefined>()
  const [contato, setContato] = useState('')
  const [proximo, setProximo] = useState('')
  const [nota, setNota] = useState('')
  const [checkinObjetivo, setCheckinObjetivo] = useState<'levantamento' | 'execucao' | 'retorno'>('levantamento')
  const [obsCheckout, setObsCheckout] = useState('')
  const [gpsCarregando, setGpsCarregando] = useState(false)

  useEffect(() => {
    if (!s) return
    setF({
      manutencao: s.manutencao,
      redeAr: s.redeAr,
      instalacao: s.instalacao,
      compressor: s.compressor ?? '',
      descricao: s.descricao ?? '',
      endereco: s.endereco ?? '',
      maoObra: paraCampo(s.valorMaoObra),
      material: paraCampo(s.valorMaterial),
      dataExecucao: s.dataExecucao ?? '',
    })
    setVendedorId(s.vendedorId ?? undefined)
    setProximo(s.status === 'aguardando_cliente' ? somarDias(hojeBr(), 2) : '')
  }, [s])

  const atualizar = trpc.servicos.atualizar.useMutation({
    onSuccess: () => {
      toast.success('Salvo')
      setEditando(false)
      recarregar()
    },
    onError: (e) => toast.error(e.message),
  })
  const registrarContato = trpc.servicos.registrarContato.useMutation({
    onSuccess: () => {
      toast.success('Contato registrado')
      setContato('')
      recarregar()
    },
    onError: (e) => toast.error(e.message),
  })
  const salvarNota = trpc.servicos.nota.useMutation({
    onSuccess: () => {
      setNota('')
      recarregar()
    },
    onError: (e) => toast.error(e.message),
  })
  const checkin = trpc.servicos.checkin.useMutation({
    onSuccess: () => {
      toast.success('Check-in feito')
      recarregar()
    },
    onError: (e) => toast.error(e.message),
  })
  const checkout = trpc.servicos.checkout.useMutation({
    onSuccess: () => {
      toast.success('Check-out feito')
      setObsCheckout('')
      recarregar()
    },
    onError: (e) => toast.error(e.message),
  })
  const excluir = trpc.servicos.excluir.useMutation({
    onSuccess: () => {
      toast.success('Serviço excluído')
      utils.servicos.listar.invalidate()
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  if (!s) return null
  const visitaAberta = s.visitas.find((v) => !v.checkoutEm)
  const travado = s.status === 'finalizado'
  const whats = linkWhats(s.telefone, `Olá! Aqui é da Compretec, sobre o ${s.tipos.join(' + ').toLowerCase()}${s.compressor ? ` do compressor ${s.compressor}` : ''}.`)

  const fazerCheckin = async () => {
    setGpsCarregando(true)
    const gps = await pegarGps()
    setGpsCarregando(false)
    if (!gps) toast('Sem GPS — check-in registrado sem localização', { icon: '📍' })
    checkin.mutate({ id, objetivo: checkinObjetivo, lat: gps?.lat ?? null, lng: gps?.lng ?? null, precisao: gps?.precisao ?? null })
  }
  const fazerCheckout = async () => {
    setGpsCarregando(true)
    const gps = await pegarGps()
    setGpsCarregando(false)
    checkout.mutate({ visitaId: visitaAberta!.id, observacoes: obsCheckout || undefined, lat: gps?.lat ?? null, lng: gps?.lng ?? null })
  }

  return (
    <Modal open onClose={onClose} title={`Serviço #${s.id} — ${s.clienteNome}`} size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <PillStatus status={s.status as Status} />
          <span className={`text-[11px] rounded-md px-1.5 py-0.5 border ${ORIGEM[s.origem]?.cls}`}>{ORIGEM[s.origem]?.label}</span>
          <ChipsTipos tipos={s.tipos} />
          {s.vendedorNome && (
            <span className="flex items-center gap-1 text-xs text-dark-300">
              <AvatarIniciais nome={s.vendedorNome} tamanho={20} /> {s.vendedorNome}
            </span>
          )}
          {whats && (
            <a href={whats} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1.5 bg-emerald-700/30 text-emerald-200 border border-emerald-600/40 hover:bg-emerald-700/50">
              <MessageCircle size={14} /> WhatsApp
            </a>
          )}
        </div>
        <AlertaItem i={s as unknown as Item} />

        {!travado && (
          <div>
            <p className="text-xs text-dark-400 mb-1.5">Mudar situação</p>
            <div className="flex flex-wrap gap-1.5">
              {STATUS.filter((st) => st.value !== s.status || st.value === 'aguardando_cliente').map((st) => (
                <button
                  key={st.value}
                  onClick={() => onMudar(st.value)}
                  className="text-xs font-semibold rounded-full px-3 py-1.5 text-white hover:brightness-110"
                  style={{ background: st.cor, opacity: st.value === s.status ? 0.6 : 1 }}
                >
                  {st.value === s.status ? 'Remarcar contato' : st.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {travado && s.vendaId && (
          <p className="text-sm rounded-xl bg-emerald-900/20 border border-emerald-700/40 text-emerald-200 px-3 py-2">
            ✅ Finalizado em {dataHoraBr(s.finalizadoEm)} — virou venda de {brl(s.valorTotal)} no card do cliente, em <b>Fechado</b>. O pós-venda segue pelo Kanban.
          </p>
        )}
        {s.status === 'nao_aprovou' && (
          <p className="text-sm rounded-xl bg-red-900/20 border border-red-700/40 text-red-200 px-3 py-2">
            Não aprovou — <b>{MOTIVO_LABEL[s.motivoNaoAprovouCategoria ?? ''] ?? s.motivoNaoAprovouCategoria}</b>: {s.motivoNaoAprovou}
          </p>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="rounded-xl border border-dark-700 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-dark-100">Dados do serviço</p>
                {!travado && !editando && (
                  <button onClick={() => setEditando(true)} className="text-xs text-gold-400 hover:underline">
                    Editar
                  </button>
                )}
              </div>
              {editando ? (
                <>
                  <CamposServico f={f} set={(p) => setF((x) => ({ ...x, ...p }))} />
                  {gestor && (
                    <Select
                      label="Vendedor responsável"
                      value={vendedorId ?? ''}
                      onChange={(e) => setVendedorId(e.target.value ? Number(e.target.value) : undefined)}
                      options={(vendedores ?? []).map((v) => ({ value: v.id, label: v.nome }))}
                    />
                  )}
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditando(false)}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      loading={atualizar.isPending}
                      onClick={() =>
                        atualizar.mutate({
                          id,
                          vendedorId,
                          manutencao: f.manutencao,
                          redeAr: f.redeAr,
                          instalacao: f.instalacao,
                          compressor: f.compressor || null,
                          descricao: f.descricao || null,
                          endereco: f.endereco || null,
                          telefone: s.telefone,
                          valorMaoObra: numOuNull(f.maoObra),
                          valorMaterial: numOuNull(f.material),
                          dataExecucao: f.dataExecucao || null,
                        })
                      }
                    >
                      Salvar
                    </Button>
                  </div>
                </>
              ) : (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-dark-400">Compressor</dt>
                  <dd className="text-dark-100">{s.compressor || '—'}</dd>
                  <dt className="text-dark-400">Mão de obra</dt>
                  <dd className="text-dark-100">{brl(s.valorMaoObra)}</dd>
                  <dt className="text-dark-400">Material</dt>
                  <dd className="text-dark-100">{brl(s.valorMaterial)}</dd>
                  <dt className="text-dark-400">Total</dt>
                  <dd className="text-dark-50 font-semibold">{brl(s.valorTotal)}</dd>
                  <dt className="text-dark-400">Data do serviço</dt>
                  <dd className="text-dark-100">{dataBr(s.dataExecucao) || '—'}</dd>
                  <dt className="text-dark-400">Aberto em</dt>
                  <dd className="text-dark-100">{dataHoraBr(s.createdAt) && dataBr(s.createdAt)}</dd>
                  {s.endereco && (
                    <>
                      <dt className="text-dark-400">Endereço</dt>
                      <dd className="text-dark-100">{s.endereco}</dd>
                    </>
                  )}
                  {s.descricao && (
                    <>
                      <dt className="text-dark-400 col-span-2">O que o cliente precisa</dt>
                      <dd className="text-dark-100 col-span-2 whitespace-pre-wrap">{s.descricao}</dd>
                    </>
                  )}
                  <dt className="text-dark-400">Cadastro</dt>
                  <dd className="text-dark-100">{s.cliente ? `${s.cliente.razaoSocial}${s.cliente.emProspeccao ? ' (prospecção)' : ''}` : s.lead ? `Lead: ${s.lead.name}` : 'Sem cadastro ainda'}</dd>
                </dl>
              )}
            </div>

            {!travado && s.status !== 'nao_aprovou' && (
              <div className="rounded-xl border border-dark-700 p-3 space-y-2">
                <p className="text-sm font-semibold text-dark-100">Registrar contato com o cliente</p>
                <Textarea rows={2} placeholder="O que foi conversado…" value={contato} onChange={(e) => setContato(e.target.value)} />
                {s.status === 'aguardando_cliente' && <Input label="Próximo contato (obrigatório)" type="date" min={hojeBr()} value={proximo} onChange={(e) => setProximo(e.target.value)} />}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    loading={registrarContato.isPending}
                    onClick={() => registrarContato.mutate({ id, texto: contato, proximoContato: s.status === 'aguardando_cliente' ? proximo || undefined : undefined })}
                    disabled={contato.trim().length < 3}
                  >
                    Registrar
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-dark-700 p-3 space-y-2">
              <p className="text-sm font-semibold text-dark-100 flex items-center gap-1.5">
                <MapPin size={15} /> Visitas no cliente
              </p>
              <p className="text-[11px] text-dark-500">Para rede de ar e instalação: faça o check-in quando chegar e o check-out quando sair — fica registrado com o GPS.</p>
              {visitaAberta ? (
                <div className="rounded-lg bg-orange-900/20 border border-orange-700/40 p-2 space-y-2">
                  <p className="text-xs text-orange-200">Em visita desde {visitaAberta.checkinBr?.slice(11)} ({visitaAberta.objetivo === 'levantamento' ? 'levantamento / orçamento' : visitaAberta.objetivo === 'execucao' ? 'execução' : 'retorno'})</p>
                  <Textarea rows={2} placeholder="O que foi feito / medido na visita" value={obsCheckout} onChange={(e) => setObsCheckout(e.target.value)} />
                  <Button size="sm" onClick={fazerCheckout} loading={checkout.isPending || gpsCarregando}>
                    <Navigation size={13} className="inline -mt-0.5 mr-1" /> Fazer check-out
                  </Button>
                </div>
              ) : (
                !travado && (
                  <div className="flex gap-2 items-end">
                    <Select
                      label="Objetivo"
                      value={checkinObjetivo}
                      onChange={(e) => setCheckinObjetivo(e.target.value as typeof checkinObjetivo)}
                      options={[
                        { value: 'levantamento', label: 'Levantamento / orçamento' },
                        { value: 'execucao', label: 'Execução do serviço' },
                        { value: 'retorno', label: 'Retorno' },
                      ]}
                    />
                    <Button size="sm" onClick={fazerCheckin} loading={checkin.isPending || gpsCarregando}>
                      <Navigation size={13} className="inline -mt-0.5 mr-1" /> Check-in
                    </Button>
                  </div>
                )
              )}
              {s.visitas.map((v) => (
                <div key={v.id} className="text-xs text-dark-300 border-t border-dark-800 pt-1.5">
                  <span className="text-dark-100">{v.checkinBr?.slice(8, 10)}/{v.checkinBr?.slice(5, 7)} {v.checkinBr?.slice(11)}</span>
                  {v.checkoutBr && <> → {v.checkoutBr.slice(11)}</>} · {v.objetivo === 'levantamento' ? 'Levantamento' : v.objetivo === 'execucao' ? 'Execução' : 'Retorno'} · {v.vendedorNome}
                  {v.latCheckin != null ? (
                    <a className="ml-1 text-gold-400 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${v.latCheckin},${v.lngCheckin}`}>
                      ver no mapa{v.precisaoCheckinM ? ` (±${v.precisaoCheckinM} m)` : ''}
                    </a>
                  ) : (
                    <span className="ml-1 text-dark-500">sem GPS</span>
                  )}
                  {v.observacoes && <p className="text-dark-400">{v.observacoes}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-dark-700 p-3 space-y-2">
              <p className="text-sm font-semibold text-dark-100">Histórico</p>
              <div className="flex gap-2">
                <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Escrever uma observação…" className="flex-1 bg-dark-900 border border-dark-600 rounded-lg px-2 py-1.5 text-sm text-dark-100" />
                <Button size="sm" variant="secondary" disabled={nota.trim().length < 2} loading={salvarNota.isPending} onClick={() => salvarNota.mutate({ id, texto: nota })}>
                  Anotar
                </Button>
              </div>
              <ol className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {s.eventos.map((e) => (
                  <li key={e.id} className="text-xs border-l-2 pl-2" style={{ borderColor: e.statusPara ? STATUS_MAP[e.statusPara as Status]?.cor ?? '#555' : '#555' }}>
                    <p className="text-dark-400">
                      {e.quandoBr?.slice(8, 10)}/{e.quandoBr?.slice(5, 7)} {e.quandoBr?.slice(11)} · {e.userNome ?? 'CRM'}
                    </p>
                    {e.tipo === 'status' && e.statusPara && (
                      <p className="text-dark-200">
                        {e.statusDe ? `${STATUS_MAP[e.statusDe as Status]?.label} → ` : ''}
                        <b>{STATUS_MAP[e.statusPara as Status]?.label}</b>
                      </p>
                    )}
                    {e.texto && <p className="text-dark-100 whitespace-pre-wrap">{e.tipo === 'contato' ? '📞 ' : e.tipo === 'visita' ? '📍 ' : e.tipo === 'edicao' ? '✏️ ' : e.tipo === 'nota' ? '📝 ' : ''}{e.texto}</p>}
                  </li>
                ))}
              </ol>
            </div>
            {(gestor || s.status === 'montando_orcamento') && !travado && (
              <button
                onClick={() => {
                  if (window.confirm('Excluir este serviço? (Se o cliente só não quis, use "Não aprovou" com o motivo)')) excluir.mutate({ id })
                }}
                className="text-xs text-red-400 hover:underline flex items-center gap-1"
              >
                <Trash2 size={12} /> Excluir serviço
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function MudarStatus({ id, status, onClose }: { id: number; status: Status; onClose: () => void }) {
  const { data: s } = trpc.servicos.obter.useQuery({ id })
  const utils = trpc.useUtils()
  const [obs, setObs] = useState('')
  const [proximo, setProximo] = useState(somarDias(hojeBr(), 2))
  const [dataExec, setDataExec] = useState('')
  const [motivoCat, setMotivoCat] = useState('')
  const [motivo, setMotivo] = useState('')
  const [forma, setForma] = useState('')
  const [pedido, setPedido] = useState('')
  const [maoObra, setMaoObra] = useState('')
  const [material, setMaterial] = useState('')
  const [modoCliente, setModoCliente] = useState<'existente' | 'novo'>('novo')
  const [buscaCliente, setBuscaCliente] = useState('')
  const [clienteExistente, setClienteExistente] = useState<{ id: number; nome: string } | null>(null)
  const [novo, setNovo] = useState({ razaoSocial: '', doc: '', cidade: '' })
  useEffect(() => {
    if (!s) return
    setMaoObra(paraCampo(s.valorMaoObra))
    setMaterial(paraCampo(s.valorMaterial))
    setDataExec(s.dataExecucao ?? '')
    setNovo((n) => ({ ...n, razaoSocial: n.razaoSocial || s.clienteNome, cidade: n.cidade || s.lead?.city || '' }))
  }, [s])
  const { data: clientesBusca } = trpc.servicos.buscarOrigem.useQuery({ texto: buscaCliente }, { enabled: status === 'finalizado' && modoCliente === 'existente' && buscaCliente.trim().length >= 2 })
  const mudar = trpc.servicos.mudarStatus.useMutation({
    onSuccess: (r) => {
      toast.success(status === 'finalizado' && r.vendaId ? 'Finalizado! Virou venda no card do cliente, em Fechado.' : `Agora: ${STATUS_MAP[status].label}`)
      utils.servicos.obter.invalidate({ id })
      utils.servicos.listar.invalidate()
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })
  if (!s) return null
  const semCadastro = !s.clienteId
  const total = (numOuNull(maoObra) ?? 0) + (numOuNull(material) ?? 0)

  const confirmar = () => {
    const base = { id, status, observacao: obs || undefined }
    if (status === 'aguardando_cliente') return mudar.mutate({ ...base, proximoContato: proximo })
    if (status === 'em_andamento') return mudar.mutate({ ...base, dataExecucao: dataExec || undefined })
    if (status === 'nao_aprovou') return mudar.mutate({ ...base, motivoCategoria: (motivoCat || undefined) as never, motivo })
    if (status === 'finalizado') {
      const doc = novo.doc.replace(/\D/g, '')
      return mudar.mutate({
        ...base,
        condicaoPagamento: forma || undefined,
        numeroPedido: pedido || undefined,
        valorMaoObra: numOuNull(maoObra),
        valorMaterial: numOuNull(material),
        clienteExistenteId: semCadastro && modoCliente === 'existente' ? clienteExistente?.id : undefined,
        novoCliente:
          semCadastro && modoCliente === 'novo'
            ? { razaoSocial: novo.razaoSocial, cpf: doc.length === 11 ? doc : undefined, cnpj: doc.length === 14 ? doc : undefined, cidade: novo.cidade || undefined }
            : undefined,
      })
    }
    return mudar.mutate(base)
  }

  return (
    <Modal open onClose={onClose} title={`${s.status === status ? 'Remarcar contato' : STATUS_MAP[status].label} — ${s.clienteNome}`} size="md">
      <div className="space-y-3">
        <div className="h-1.5 rounded-full" style={{ background: STATUS_MAP[status].cor }} />
        {status === 'montando_orcamento' && <p className="text-sm text-dark-300">O prazo de <b>1 dia útil</b> para dar a resposta ao cliente começa a contar agora e entra na agenda.</p>}
        {status === 'aguardando_cliente' && (
          <>
            <p className="text-sm text-dark-300">Quando falar com o cliente de novo? Vira uma ligação na sua agenda.</p>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 7, 15].map((d) => (
                <button key={d} onClick={() => setProximo(somarDias(hojeBr(), d))} className={`text-xs rounded-lg border px-2 py-1 ${proximo === somarDias(hojeBr(), d) ? 'border-blue-500 text-blue-200 bg-blue-900/30' : 'border-dark-600 text-dark-300'}`}>
                  {d === 1 ? 'amanhã' : `${d} dias`}
                </button>
              ))}
            </div>
            <Input label="Próximo contato" type="date" min={hojeBr()} value={proximo} onChange={(e) => setProximo(e.target.value)} />
          </>
        )}
        {status === 'em_andamento' && <Input label="Data do serviço (se já marcou)" type="date" value={dataExec} onChange={(e) => setDataExec(e.target.value)} />}
        {status === 'nao_aprovou' && (
          <>
            <Select label="Motivo (obrigatório)" value={motivoCat} onChange={(e) => setMotivoCat(e.target.value)} placeholder="Escolha…" options={MOTIVOS} />
            <Textarea label="O que o cliente disse (obrigatório)" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: achou caro, vai fazer com o técnico dele" />
          </>
        )}
        {status === 'finalizado' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Input label="Mão de obra (R$)" inputMode="decimal" value={maoObra} onChange={(e) => setMaoObra(e.target.value)} />
              <Input label="Material / peças (R$)" inputMode="decimal" value={material} onChange={(e) => setMaterial(e.target.value)} />
              <Select label="Forma de pagamento" value={forma} onChange={(e) => setForma(e.target.value)} placeholder="Escolha…" options={FORMAS_PAGAMENTO} />
              <Input label="Nº do pedido / OS" value={pedido} onChange={(e) => setPedido(e.target.value)} />
            </div>
            {semCadastro && (
              <div className="rounded-xl border border-gold-600/40 bg-gold-900/10 p-3 space-y-2">
                <p className="text-sm text-gold-200">O serviço sai com nota: o cliente precisa de cadastro para ir à carteira.</p>
                <div className="flex gap-3 text-sm">
                  <label className="flex items-center gap-1 text-dark-200">
                    <input type="radio" checked={modoCliente === 'novo'} onChange={() => setModoCliente('novo')} /> Cadastrar agora
                  </label>
                  <label className="flex items-center gap-1 text-dark-200">
                    <input type="radio" checked={modoCliente === 'existente'} onChange={() => setModoCliente('existente')} /> Já tem cadastro
                  </label>
                </div>
                {modoCliente === 'novo' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <Input label="Nome / razão social" value={novo.razaoSocial} onChange={(e) => setNovo({ ...novo, razaoSocial: e.target.value })} />
                    </div>
                    <Input label="CPF ou CNPJ" value={novo.doc} onChange={(e) => setNovo({ ...novo, doc: e.target.value })} />
                    <Input label="Cidade" value={novo.cidade} onChange={(e) => setNovo({ ...novo, cidade: e.target.value })} />
                  </div>
                ) : clienteExistente ? (
                  <p className="text-sm text-dark-100">
                    {clienteExistente.nome}{' '}
                    <button className="text-xs text-dark-400 hover:underline" onClick={() => setClienteExistente(null)}>
                      trocar
                    </button>
                  </p>
                ) : (
                  <>
                    <Input placeholder="Buscar cliente…" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} />
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {clientesBusca
                        ?.filter((c) => c.clienteId)
                        .map((c) => (
                          <button key={c.chave} onClick={() => setClienteExistente({ id: c.clienteId!, nome: c.nome })} className="w-full text-left text-sm rounded-lg border border-dark-700 hover:border-dark-500 px-2 py-1 text-dark-100">
                            {c.nome} <span className="text-[10px] text-dark-500">{ORIGEM[c.origem].label}</span>
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <p className="text-sm rounded-xl bg-emerald-900/20 border border-emerald-700/40 text-emerald-200 px-3 py-2">
              Vai virar uma venda de <b>{brl(total)}</b> no card do cliente na carteira, em <b>Fechado</b> — e o pós-venda segue de lá.
            </p>
          </>
        )}
        <Textarea label="Observação (opcional)" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirmar} loading={mudar.isPending}>
            Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
