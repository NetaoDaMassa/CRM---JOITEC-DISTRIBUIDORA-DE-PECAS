import { Fragment, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { PackageCheck, RefreshCw, Printer, Undo2, Trash2 } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import Select from '../../components/ui/Select'
import ComoUsar from '../../components/ui/ComoUsar'
import { useAuth } from '../../contexts/AuthContext'
import { TAMANHOS_ETIQUETA, htmlEtiquetaItem, htmlEtiquetaVolume, imprimirEtiquetas, lerTamanho, salvarTamanho } from '../../lib/etiquetasTermicas'

// Controle do Estoque / Expedição (pedido do João, 2026-10-29) — fila que
// nasce do picking gerado no SAP; o estoque anota separação → conferência →
// embalagem → coleta nos 3 computadores (substitui as fichas de papel e a
// planilha "Análise de Desempenho Estoque"). Prazo: 48h do picking à coleta.

type Pedido = inferRouterOutputs<AppRouter>['expedicao']['fila'][number]
type Colaborador = inferRouterOutputs<AppRouter>['expedicao']['colaboradores'][number]
type EtapaPessoa = 'separacao' | 'conferencia' | 'embalagem'

const COLUNAS: { etapa: Pedido['etapa']; titulo: string; cor: string }[] = [
  { etapa: 'separacao', titulo: 'Separação', cor: '#f59e0b' },
  { etapa: 'conferencia', titulo: 'Conferência', cor: '#3b82f6' },
  { etapa: 'embalagem', titulo: 'Embalagem', cor: '#8b5cf6' },
  { etapa: 'nf', titulo: 'NF', cor: '#0ea5e9' },
  { etapa: 'coleta', titulo: 'Aguardando coleta', cor: '#14b8a6' },
  { etapa: 'coletado', titulo: 'Coletados hoje', cor: '#22c55e' },
]
const CARGO: Record<EtapaPessoa, Colaborador['cargo']> = { separacao: 'separador', conferencia: 'conferente', embalagem: 'embalador' }
const TIPOS_ERRO = [
  { value: 'faltou', label: 'Faltou item' },
  { value: 'sobrou', label: 'Item a mais' },
  { value: 'trocado', label: 'Item trocado' },
  { value: 'quantidade', label: 'Quantidade errada' },
  { value: 'avaria', label: 'Avaria' },
  { value: 'outro', label: 'Outro' },
] as const
const STATUS_SAP: Record<string, string> = { ps_Released: 'Liberado', ps_Picked: 'Conferido no SAP', ps_Closed: 'Fechado no SAP' }

const num = (n: number) => n.toLocaleString('pt-BR')
// Kit sai por KIT (André, 2026-11-04): mostra a quantidade do pedido em kits;
// o SAP manda o picking em unidade de estoque (5 PC4 → 20).
type QtdItem = { quantidade: number; ehKit: boolean; qtdVenda: number | null; unidadeVenda: string | null; kit: unknown }
const qtdSeparar = (i: QtdItem) => (i.kit && i.qtdVenda != null ? i.qtdVenda : i.quantidade)
const textoQtd = (i: QtdItem) => (i.kit ? `${num(qtdSeparar(i))} kit${qtdSeparar(i) === 1 ? '' : 's'}` : num(i.quantidade))
const unidadesSap = (i: QtdItem) =>
  i.kit && i.qtdVenda != null && Math.abs(i.qtdVenda - i.quantidade) > 0.0001 ? `pedido: ${num(i.qtdVenda)} ${i.unidadeVenda ?? ''} · SAP: ${num(i.quantidade)} un.`.replace('  ', ' ') : null
// Picking refeito no SAP (João, 2026-11-04): o card novo mostra o que mudou
// em relação ao anterior — antes só mudava o número do picking.
type Mudancas = { pickingAnterior: number; novos: number; alterados: number; removidos: { descricao: string; quantidade: number }[] }
function lerMudancas(p: { mudancasSap: string | null }): Mudancas | null {
  try {
    return p.mudancasSap ? (JSON.parse(p.mudancasSap) as Mudancas) : null
  } catch {
    return null
  }
}
function resumoMudancas(m: Mudancas): string {
  const partes = [
    m.novos ? `${m.novos} item${m.novos > 1 ? 's' : ''} novo${m.novos > 1 ? 's' : ''}` : '',
    m.alterados ? `${m.alterados} quantidade${m.alterados > 1 ? 's' : ''} alterada${m.alterados > 1 ? 's' : ''}` : '',
    m.removidos.length ? `${m.removidos.length} item${m.removidos.length > 1 ? 's' : ''} retirado${m.removidos.length > 1 ? 's' : ''}` : '',
  ].filter(Boolean)
  return partes.length ? partes.join(' · ') : 'itens e quantidades iguais'
}
// Quantidade de antes na mesma unidade que a ficha mostra (kit = kits).
const textoAntes = (i: QtdItem & { qtdAnterior: number | null }) =>
  i.qtdAnterior == null ? '' : num(i.kit && i.qtdVenda != null && i.quantidade ? Math.round((i.qtdAnterior * i.qtdVenda) / i.quantidade * 1000) / 1000 : i.qtdAnterior)
function hora(utc: string | null): string {
  if (!utc) return '—'
  return new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function minutosDesde(utc: string | null): number {
  return utc ? Math.max(0, Math.round((Date.now() - Date.parse(`${utc.replace(' ', 'T')}Z`)) / 60_000)) : 0
}
function duracao(min: number): string {
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}
function corPrazo(p: Pedido): string {
  if (p.etapa === 'coletado') return p.noPrazo ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'
  if (p.horasRestantes < 0) return 'bg-red-900/40 text-red-200'
  if (p.horasRestantes < 12) return 'bg-amber-900/30 text-amber-200'
  return 'bg-dark-700 text-dark-200'
}
// "2026-10-30T14:00" (Brasília) → "30/10 14:00".
function agendaBr(v: string | null): string {
  if (!v) return '—'
  return `${v.slice(8, 10)}/${v.slice(5, 7)} ${v.slice(11, 16)}`
}
function coletaAtrasada(p: Pedido): boolean {
  return p.etapa === 'coleta' && !!p.coletaAgendada && Date.parse(`${p.coletaAgendada}:00-03:00`) < Date.now()
}
function textoPrazo(p: Pedido): string {
  if (p.etapa === 'coletado') return p.noPrazo ? 'no prazo' : 'fora do prazo'
  const h = p.horasRestantes
  return h < 0 ? `atrasado ${Math.round(-h)}h` : `faltam ${Math.round(h)}h`
}

// Quem está fazendo a etapa atual (ou "aguardando").
function quemAgora(p: Pedido): string | null {
  if (p.etapa === 'separacao' && p.separacaoInicio) return `▶ ${p.separador ?? '?'} separando há ${duracao(minutosDesde(p.separacaoInicio))}`
  if (p.etapa === 'conferencia' && p.conferenciaInicio) return `▶ ${p.conferente ?? '?'} conferindo há ${duracao(minutosDesde(p.conferenciaInicio))}`
  if (p.etapa === 'embalagem' && p.embalagemInicio) return `▶ ${p.embalador ?? '?'} embalando há ${duracao(minutosDesde(p.embalagemInicio))}`
  return null
}

export default function Expedicao() {
  const { data: fila, isLoading } = trpc.expedicao.fila.useQuery(undefined, { refetchInterval: 30_000 })
  const { data: colaboradores = [] } = trpc.expedicao.colaboradores.useQuery()
  const utils = trpc.useUtils()
  const [abertoId, setAbertoId] = useState<number | null>(null)
  const [verDescartados, setVerDescartados] = useState(false)
  const [verKits, setVerKits] = useState(false)
  const [busca, setBusca] = useState('')
  // Seleção de vários pedidos (admin) pra finalizar/mover/cancelar de uma vez.
  const { data: podeDescartar } = trpc.expedicao.podeDescartar.useQuery()
  const [selecionando, setSelecionando] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const alternar = (id: number) =>
    setSelecionados((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const sincronizar = trpc.expedicao.sincronizarAgora.useMutation({
    onSuccess(r) {
      toast.success(r.novas ? `${r.novas} picking(s) novo(s) do SAP` : 'Fila em dia com o SAP')
      utils.expedicao.fila.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return fila ?? []
    return (fila ?? []).filter((p) => `${p.pedidosSap} ${p.clienteNome} ${p.nfNumero ?? ''} ${p.pickListSap}`.toLowerCase().includes(t))
  }, [fila, busca])
  const colunas = COLUNAS
  const aberto = fila?.find((p) => p.id === abertoId) ?? null
  const listaAtrasados = (fila ?? []).filter((p) => p.etapa !== 'coletado' && p.horasRestantes < 0).sort((a, b) => a.horasRestantes - b.horasRestantes)
  const atrasados = listaAtrasados.length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center">
            <PackageCheck size={20} className="text-teal-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Expedição</h1>
            <p className="text-sm text-dark-400">
              Pedidos que o SAP mandou separar · prazo de 48h até a coleta
              {atrasados > 0 && <span className="text-red-300 font-medium"> · {atrasados} atrasado(s)</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Buscar" placeholder="pedido, cliente, NF" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {podeDescartar && (
            <Button variant={selecionando ? 'primary' : 'ghost'} onClick={() => (setSelecionando((v) => !v), setSelecionados(new Set()))}>
              {selecionando ? 'Sair da seleção' : '☑ Selecionar vários'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setVerKits(true)}>
            🧩 Kits
          </Button>
          <Button variant="ghost" onClick={() => setVerDescartados(true)}>
            Descartados / cancelados
          </Button>
          <Button variant="secondary" onClick={() => sincronizar.mutate()} loading={sincronizar.isPending}>
            <RefreshCw size={14} className="mr-1 inline" /> Buscar no SAP
          </Button>
        </div>
      </div>

      <ComoUsar
        chave="expedicao"
        titulo="Como funciona"
        passos={[
          'O pedido entra sozinho aqui quando o picking é gerado no SAP.',
          'Abra o pedido, escolha seu nome e toque em "Iniciar". Ao acabar, toque em "Terminar": o horário é anotado sozinho.',
          'Na conferência (e na embalagem), anote cada erro achado: item e tipo. O erro conta para quem fez a etapa anterior.',
          'Na embalagem, informe volumes, cabeçotes e paletes. A NF aparece sozinha quando sai no SAP.',
          'Com a NF emitida, agende a coleta (transportadora, dia e hora). Sem NF não dá para agendar.',
          'Quando a transportadora levar, toque em "Coletado". O prazo de 48h conta do picking até aqui.',
        ]}
      />

      {selecionando && (
        <AcoesEmLote
          ids={[...selecionados]}
          todosDaTela={filtrados.filter((p) => p.etapa !== 'coletado').map((p) => p.id)}
          onSelecionar={(ids) => setSelecionados(new Set(ids))}
          onFeito={() => (setSelecionados(new Set()), utils.expedicao.fila.invalidate(), utils.expedicao.descartados.invalidate())}
        />
      )}

      {listaAtrasados.length > 0 && (
        <div className="rounded-2xl border border-red-700/50 bg-red-900/15 p-4 space-y-2">
          <p className="text-sm font-semibold text-red-200">⚠️ {listaAtrasados.length} pedido(s) passaram das 48h sem coleta</p>
          <div className="flex flex-wrap gap-2">
            {listaAtrasados.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setAbertoId(p.id)}
                className="text-left text-xs rounded-lg border border-red-700/50 bg-dark-900/60 px-3 py-1.5 hover:border-red-500"
              >
                <b className="text-dark-100">Pedido {p.pedidosSap}</b> <span className="text-dark-300">{(p.clienteNome ?? '').slice(0, 28)}</span>
                <span className="block text-red-300">
                  atrasado {Math.round(-p.horasRestantes)}h · {COLUNAS.find((c) => c.etapa === (p.etapa === 'agendamento' ? 'nf' : p.etapa))?.titulo}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="h-64 rounded-2xl bg-dark-800 animate-pulse" />
      ) : (
        <div className={"grid gap-3 grid-cols-1 md:grid-cols-3 2xl:grid-cols-6"}>
          {colunas.map((col) => {
            // Card antigo em 'agendamento' aparece junto na coluna NF.
            const doCol = filtrados.filter((p) => (p.etapa === 'agendamento' ? 'nf' : p.etapa) === col.etapa)
            return (
              <div key={col.etapa} className="bg-dark-900/40 border border-dark-700 rounded-2xl p-3 min-w-0">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.cor }} />
                  <h2 className="text-sm font-semibold text-dark-100">{col.titulo}</h2>
                  <span className="ml-auto text-xs text-dark-400">{doCol.length}</span>
                </div>
                <div className="space-y-2">
                  {doCol.length === 0 && <p className="text-xs text-dark-500 px-1">Nada aqui.</p>}
                  {doCol.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => (selecionando && p.etapa !== 'coletado' ? alternar(p.id) : setAbertoId(p.id))}
                      className={`w-full text-left bg-dark-800 border border-l-4 rounded-xl p-3 hover:border-gold-600/50 transition-colors ${
                        selecionados.has(p.id) ? 'border-gold-500 ring-1 ring-gold-500/60' : 'border-dark-600'
                      } ${p.pausadoEm ? 'opacity-70' : ''}`}
                      style={{ borderLeftColor: col.cor }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-dark-100">
                          {selecionando && p.etapa !== 'coletado' && <input type="checkbox" readOnly checked={selecionados.has(p.id)} className="mr-1.5 align-middle" />}
                          Pedido {p.pedidosSap}
                        </p>
                        <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${corPrazo(p)}`}>{textoPrazo(p)}</span>
                      </div>
                      <p className="text-xs text-dark-300 leading-tight mt-0.5 line-clamp-2">{p.clienteNome}</p>
                      <p className="text-[11px] text-dark-500 mt-1">
                        {p.itens} itens · {num(p.pecas)} peças · picking {p.pickListSap}
                      </p>
                      {p.alteradoSapEm && (
                        <p className="text-[11px] font-semibold text-orange-200 bg-orange-900/30 border border-orange-700/50 rounded px-1.5 py-0.5 mt-1">
                          ⚠ Alterado no SAP — admin precisa descartar
                        </p>
                      )}
                      {p.pausadoEm && (
                        <p className="text-[11px] font-semibold text-dark-200 bg-dark-700 border border-dark-500 rounded px-1.5 py-0.5 mt-1">⏸ Pausado — {p.pausaMotivo}</p>
                      )}
                      {lerMudancas(p) ? (
                        <p className="text-[11px] font-semibold text-sky-100 bg-sky-900/40 border border-sky-600/60 rounded px-1.5 py-0.5 mt-1">
                          ✎ PEDIDO ALTERADO — picking {lerMudancas(p)!.pickingAnterior} → {p.pickListSap}
                          <span className="block font-normal text-sky-200/90">{resumoMudancas(lerMudancas(p)!)}</span>
                        </p>
                      ) : (
                        p.substituiId && <p className="text-[10px] text-dark-400 mt-1">↻ recriado (substitui um card descartado)</p>
                      )}
                      {p.observacaoSap && <p className="text-[11px] text-amber-300/90 mt-1 line-clamp-1">🚚 {p.observacaoSap}</p>}
                      {quemAgora(p) && <p className="text-[11px] text-cyan-300 mt-1">{quemAgora(p)}</p>}
                      {(p.separacaoFim || p.conferenciaFim || p.embalagemFim) && (
                        <p className="text-[11px] text-dark-300 mt-1 leading-snug">
                          {p.separacaoFim && <>Separou: <b className="text-dark-100">{p.separador}</b></>}
                          {p.conferenciaFim && <> · Conferiu: <b className="text-dark-100">{p.conferente}</b></>}
                          {p.embalagemFim && <> · Embalou: <b className="text-dark-100">{p.embalador}</b></>}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {p.nfNumero ? (
                          <span className="text-[10px] font-semibold rounded bg-green-900/30 text-green-300 px-1.5 py-0.5">NF {p.nfNumero}</span>
                        ) : (
                          (p.etapa === 'nf' || p.etapa === 'embalagem') && (
                            <span className="text-[10px] font-semibold rounded bg-amber-900/30 text-amber-300 px-1.5 py-0.5">aguardando NF</span>
                          )
                        )}
                        {(p.etapa === 'nf' || p.etapa === 'agendamento') && p.nfNumero && (
                          <span className="text-[11px] font-bold rounded bg-green-900/50 text-green-200 border border-green-600/60 px-1.5 py-0.5">✅ LIBERADO PRÓXIMA ETAPA</span>
                        )}
                        {(p.etapa === 'coleta' || p.etapa === 'coletado') && p.coletaAgendada && (
                          <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${coletaAtrasada(p) ? 'bg-red-900/40 text-red-200' : 'bg-dark-700 text-dark-200'}`}>
                            🚚 {agendaBr(p.coletaAgendada)}{p.transportadora ? ` · ${p.transportadora}` : ''}
                          </span>
                        )}
                        {['separacao', 'conferencia', 'embalagem'].includes(p.etapa) && (p.volumesSap != null || p.transportadoraSap) && (
                          <span className="text-[10px] rounded bg-blue-900/30 text-blue-200 px-1.5 py-0.5" title="Lançado no pedido do SAP">
                            📦 SAP: {[p.volumesSap != null ? `${p.volumesSap} vol.` : null, p.transportadoraSap].filter(Boolean).join(' · ')}
                          </span>
                        )}
                        {p.erros > 0 && <span className="text-[10px] font-semibold rounded bg-red-900/30 text-red-300 px-1.5 py-0.5">{p.erros} erro(s)</span>}
                        {p.volumes != null && p.etapa !== 'embalagem' && (
                          <span className="text-[10px] rounded bg-dark-700 text-dark-300 px-1.5 py-0.5">{p.volumes} vol.</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {aberto && <PedidoModal pedido={aberto} colaboradores={colaboradores} onClose={() => setAbertoId(null)} />}
      {verDescartados && <DescartadosModal onClose={() => setVerDescartados(false)} />}
      {verKits && <KitsModal podeAlterar={!!podeDescartar} onClose={() => setVerKits(false)} />}
    </div>
  )
}

function PedidoModal({ pedido: p, colaboradores, onClose }: { pedido: Pedido; colaboradores: Colaborador[]; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data } = trpc.expedicao.detalhe.useQuery({ id: p.id })
  const recarregar = () => {
    utils.expedicao.fila.invalidate()
    utils.expedicao.detalhe.invalidate({ id: p.id })
  }
  const opts = { onSuccess: recarregar, onError: (e: { message: string }) => toast.error(e.message) }
  const iniciar = trpc.expedicao.iniciar.useMutation(opts)
  const terminar = trpc.expedicao.terminar.useMutation(opts)
  const voltar = trpc.expedicao.voltar.useMutation(opts)
  const coletar = trpc.expedicao.coletar.useMutation(opts)
  const agendar = trpc.expedicao.agendar.useMutation({ ...opts, onSuccess: () => (toast.success('Coleta agendada'), recarregar()) })
  const registrarErro = trpc.expedicao.registrarErro.useMutation(opts)
  const removerErro = trpc.expedicao.removerErro.useMutation(opts)
  const { data: podeDescartar } = trpc.expedicao.podeDescartar.useQuery()
  const [descartando, setDescartando] = useState(false)
  const mudancas = lerMudancas(p)
  const [motivo, setMotivo] = useState(p.alteracaoSap ? 'Pedido alterado no SAP — picking refeito' : '')
  const descartar = trpc.expedicao.descartar.useMutation({
    onSuccess(r) {
      toast.success(r.recriado ? 'Pedido descartado — o card novo já está na fila' : 'Pedido descartado')
      utils.expedicao.fila.invalidate()
      utils.expedicao.descartados.invalidate()
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  const [pessoa, setPessoa] = useState('')
  // Volumes e transportadora já vêm do pedido do SAP; o embalador confere e ajusta.
  const [volumes, setVolumes] = useState(p.volumes != null ? String(p.volumes) : p.volumesSap != null ? String(p.volumesSap) : '')
  const [cabecotes, setCabecotes] = useState('')
  const [paletes, setPaletes] = useState('')
  const [transportadora, setTransportadora] = useState(p.transportadora ?? p.transportadoraSap ?? '')
  const [coletaAgendada, setColetaAgendada] = useState(p.coletaAgendada ?? '')
  const [erroItem, setErroItem] = useState('')
  const [erroTipo, setErroTipo] = useState<(typeof TIPOS_ERRO)[number]['value']>('faltou')
  const [erroQtd, setErroQtd] = useState('')
  const [erroObs, setErroObs] = useState('')

  const etapaPessoa = (['separacao', 'conferencia', 'embalagem'] as const).find((e) => e === p.etapa) ?? null
  const iniciada = etapaPessoa ? !!p[`${etapaPessoa}Inicio`] : false
  // Um pedido por vez por pessoa: quem está com outro pedido aberto não aparece pra escolher.
  const doCargo = etapaPessoa ? colaboradores.filter((c) => c.ativo && (c.cargo === CARGO[etapaPessoa] || c.cargo === 'geral')) : []
  const daEtapa = doCargo.filter((c) => !c.ocupadoCom)
  const ocupados = doCargo.filter((c) => c.ocupadoCom)
  const conferindo = p.etapa === 'conferencia' && iniciada
  const itensConferidos = data?.itens.filter((i) => i.conferidoEm).length ?? 0
  // Erro achado no agendamento/coleta conta como "expedição" (vai pro embalador).
  const etapaErro = p.etapa === 'conferencia' || p.etapa === 'embalagem' ? p.etapa : p.etapa === 'nf' || p.etapa === 'agendamento' || p.etapa === 'coleta' ? 'expedicao' : null
  const { empresaAtivaId } = useAuth()
  const { data: empresas } = trpc.empresas.list.useQuery()
  const remetente = empresas?.find((e) => e.id === empresaAtivaId)?.nome ?? ''
  const [transpEmbalagem, setTranspEmbalagem] = useState(p.transportadora ?? p.transportadoraSap ?? '')
  const [etiquetasItens, setEtiquetasItens] = useState(false)
  const imprimirVolumes = (qtd: number, transportadora: string | null) => {
    if (!qtd) return toast.error('Informe quantos volumes')
    const t = lerTamanho('volume')
    const html = Array.from({ length: qtd }, (_, i) =>
      htmlEtiquetaVolume(
        { numero: i + 1, total: qtd, cliente: p.clienteNome ?? '', endereco: p.enderecoEntrega, transportadora, nf: p.nfNumero, pedido: p.pedidosSap, remetente },
        t
      )
    )
    if (!imprimirEtiquetas(html, t, `Volumes — pedido ${p.pedidosSap}`)) toast.error('O navegador bloqueou a janela de impressão')
  }
  const nomeDe = (id: number | null) => colaboradores.find((c) => c.id === id)?.nome ?? '—'

  const passos: { nome: string; feito: boolean; texto: string }[] = [
    { nome: 'Picking (SAP)', feito: true, texto: `${hora(p.inicioPrazo)} · ${p.pickingGeradoPor ?? ''}` },
    { nome: 'Separação', feito: !!p.separacaoFim, texto: p.separacaoInicio ? `${p.separador ?? '—'} · ${hora(p.separacaoInicio)} → ${hora(p.separacaoFim)}` : 'aguardando' },
    { nome: 'Conferência', feito: !!p.conferenciaFim, texto: p.conferenciaInicio ? `${p.conferente ?? '—'} · ${hora(p.conferenciaInicio)} → ${hora(p.conferenciaFim)}` : 'aguardando' },
    { nome: 'Embalagem', feito: !!p.embalagemFim, texto: p.embalagemInicio ? `${p.embalador ?? '—'} · ${hora(p.embalagemInicio)} → ${hora(p.embalagemFim)}` : 'aguardando' },
    { nome: 'NF (SAP)', feito: !!p.nfNumero, texto: p.nfNumero ? `NF ${p.nfNumero} · ${hora(p.nfEmissao)}` : 'aguardando' },
    { nome: 'Agendamento', feito: !!p.agendadoEm, texto: p.agendadoEm ? `${agendaBr(p.coletaAgendada)} · ${p.transportadora ?? ''}` : p.nfNumero ? 'pronto p/ agendar' : 'depois da NF' },
    { nome: 'Coleta', feito: !!p.coletadoEm, texto: p.coletadoEm ? `${hora(p.coletadoEm)} · ${p.noPrazo ? 'no prazo' : 'fora do prazo'}` : `prazo ${hora(p.prazoLimite.replace('T', ' ').slice(0, 19))}` },
  ]

  return (
    <Modal open onClose={onClose} title={`Pedido ${p.pedidosSap} — ${p.clienteNome ?? ''}`} size="xl">
      <div className="space-y-5">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-dark-300">
          <span>Picking <b className="text-dark-100">{p.pickListSap}</b> ({STATUS_SAP[p.statusPickingSap ?? ''] ?? p.statusPickingSap})</span>
          {p.cotacaoSap && <span>Cotação <b className="text-dark-100">{p.cotacaoSap}</b></span>}
          <span>Vendedor <b className="text-dark-100">{p.vendedorSap ?? '—'}</b></span>
          <span>{p.itens} itens · {num(p.pecas)} peças</span>
          <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${corPrazo(p)}`}>{textoPrazo(p)}</span>
        </div>
        {p.alteradoSapEm && (
          <div className="text-sm text-orange-100 bg-orange-900/25 border border-orange-700/50 rounded-lg px-3 py-2 space-y-1">
            <p className="font-semibold">⚠ {p.alteracaoSap}</p>
            <p className="text-xs text-orange-200/90">
              {podeDescartar ? 'Descarte este pedido: ele vai para "Descartados" e o card novo é criado com o picking atual do SAP.' : 'Chame um administrador para descartar este pedido e recriar com o picking atual.'}
            </p>
          </div>
        )}
        {mudancas && (
          <div className="text-sm text-sky-100 bg-sky-900/25 border border-sky-600/50 rounded-lg px-3 py-2 space-y-1">
            <p className="font-semibold">
              ✎ Pedido alterado — refeito no SAP (picking {mudancas.pickingAnterior} → {p.pickListSap}): {resumoMudancas(mudancas)}
            </p>
            <p className="text-xs text-sky-200/90">Os itens novos e as quantidades que mudaram estão marcados na lista abaixo e na ficha impressa.</p>
            {mudancas.removidos.length > 0 && (
              <p className="text-xs text-red-200">
                Retirado{mudancas.removidos.length > 1 ? 's' : ''} do pedido (não separar / devolver se já separou):{' '}
                {mudancas.removidos.map((r) => `${r.descricao} (${num(r.quantidade)})`).join('; ')}
              </p>
            )}
          </div>
        )}
        {p.observacaoSap && <p className="text-sm font-medium text-amber-200 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">🚚 {p.observacaoSap}</p>}
        {p.pausadoEm && (
          <p className="text-sm font-semibold text-dark-100 bg-dark-700 border border-dark-500 rounded-lg px-3 py-2">
            ⏸ Pausado desde {hora(p.pausadoEm)} — {p.pausaMotivo}. Ninguém consegue iniciar etapa até retomar.
          </p>
        )}
        {p.observacao && <p className="text-xs text-dark-300 bg-dark-900/40 border border-dark-700 rounded-lg px-3 py-2">📝 {p.observacao}</p>}

        <ol className="grid grid-cols-2 md:grid-cols-7 gap-2">
          {passos.map((s) => (
            <li key={s.nome} className={`rounded-lg border px-2.5 py-2 ${s.feito ? 'border-green-700/50 bg-green-900/15' : 'border-dark-600 bg-dark-900/40'}`}>
              <p className={`text-xs font-semibold ${s.feito ? 'text-green-300' : 'text-dark-300'}`}>{s.feito ? '✓ ' : ''}{s.nome}</p>
              <p className="text-[11px] text-dark-400 leading-tight mt-0.5">{s.texto}</p>
            </li>
          ))}
        </ol>

        {/* Ação da etapa atual */}
        {etapaPessoa && (
          <div className="rounded-xl border border-dark-600 bg-dark-900/50 p-4 space-y-3">
            {!iniciada ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px]">
                  <Select
                    label={`Quem vai fazer a ${etapaPessoa === 'separacao' ? 'separação' : etapaPessoa === 'conferencia' ? 'conferência' : 'embalagem'}?`}
                    value={pessoa}
                    onChange={(e) => setPessoa(e.target.value)}
                    placeholder="Escolha seu nome"
                    options={daEtapa.map((c) => ({ value: c.id, label: c.nome }))}
                  />
                </div>
                <Button
                  size="lg"
                  disabled={!pessoa || !!p.pausadoEm}
                  loading={iniciar.isPending}
                  onClick={() => iniciar.mutate({ id: p.id, etapa: etapaPessoa, colaboradorId: Number(pessoa) })}
                >
                  ▶ Iniciar
                </Button>
                {doCargo.length === 0 && <p className="text-xs text-amber-300">Ninguém cadastrado com esse cargo — cadastre em Equipe do estoque.</p>}
                {ocupados.length > 0 && (
                  <p className="text-xs text-dark-400 w-full">
                    Ocupados (terminam o pedido atual antes de pegar outro): {ocupados.map((c) => `${c.nome} — pedido ${c.ocupadoCom!.pedido}`).join(' · ')}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <p className="text-sm text-cyan-300 w-full">{quemAgora(p)}</p>
                {conferindo && data && <ConferenciaItens pedidoId={p.id} pedidoSap={p.pedidosSap} itens={data.itens} conferidos={itensConferidos} />}
                {etapaPessoa === 'embalagem' && (
                  <>
                    <FreteSap p={p} volumesDigitados={volumes} />
                    <div className="w-24"><Input label="Volumes" type="number" min={0} value={volumes} onChange={(e) => setVolumes(e.target.value)} /></div>
                    <div className="w-24"><Input label="Cabeçotes" type="number" min={0} value={cabecotes} onChange={(e) => setCabecotes(e.target.value)} /></div>
                    <div className="w-24"><Input label="Paletes" type="number" min={0} value={paletes} onChange={(e) => setPaletes(e.target.value)} /></div>
                    <div className="min-w-[180px] flex-1"><Input label="Transportadora" value={transpEmbalagem} onChange={(e) => setTranspEmbalagem(e.target.value)} /></div>
                    <Button variant="secondary" disabled={!Number(volumes)} onClick={() => imprimirVolumes(Number(volumes), transpEmbalagem || null)}>
                      🏷️ Etiquetas de volume ({Number(volumes) || 0})
                    </Button>
                  </>
                )}
                <Button
                  size="lg"
                  loading={terminar.isPending}
                  disabled={conferindo && itensConferidos < (data?.itens.length ?? 0)}
                  onClick={() =>
                    terminar.mutate({
                      id: p.id,
                      etapa: etapaPessoa,
                      ...(etapaPessoa === 'embalagem'
                        ? { volumes: Number(volumes) || 0, cabecotes: Number(cabecotes) || 0, paletes: Number(paletes) || 0, transportadora: transpEmbalagem }
                        : {}),
                    })
                  }
                >
                  ■ Terminar
                </Button>
              </div>
            )}
          </div>
        )}

        {(p.etapa === 'agendamento' || p.etapa === 'coleta' || (p.etapa === 'nf' && p.nfNumero)) && (
          <div className="rounded-xl border border-dark-600 bg-dark-900/50 p-4 space-y-3">
            {!p.nfNumero ? (
              <p className="text-sm text-amber-300">⏳ Aguardando a NF sair no SAP. A coleta só pode ser agendada depois da NF — ela aparece aqui sozinha.</p>
            ) : (
              <>
                {p.etapa !== 'coleta' && <p className="text-base font-bold text-green-300">✅ NF emitida — LIBERADO PRÓXIMA ETAPA (agende a coleta)</p>}
                <p className="text-xs text-dark-400">
                  NF <b className="text-green-300">{p.nfNumero}</b> emitida em {hora(p.nfEmissao)}
                  {p.etapa === 'coleta' && <> · coleta agendada para <b className="text-dark-100">{agendaBr(p.coletaAgendada)}</b></>}
                </p>
                <div className="grid sm:grid-cols-3 gap-2 items-end">
                  <Input label="Transportadora" value={transportadora} onChange={(e) => setTransportadora(e.target.value)} />
                  <Input label="Dia e hora da coleta" type="datetime-local" value={coletaAgendada} onChange={(e) => setColetaAgendada(e.target.value)} />
                  <Button
                    variant={p.etapa === 'coleta' ? 'secondary' : 'primary'}
                    disabled={!transportadora.trim() || !coletaAgendada}
                    loading={agendar.isPending}
                    onClick={() => agendar.mutate({ id: p.id, transportadora, coletaAgendada })}
                  >
                    {p.etapa === 'coleta' ? 'Reagendar' : '📅 Agendar coleta'}
                  </Button>
                </div>
              </>
            )}
            {p.etapa === 'coleta' && (
              <Button size="lg" loading={coletar.isPending} onClick={() => coletar.mutate({ id: p.id })}>
                🚚 Coletado agora
              </Button>
            )}
          </div>
        )}

        {p.etapa === 'nf' && !p.nfNumero && (
          <div className="rounded-xl border border-sky-700/40 bg-sky-900/10 p-4 space-y-1">
            <p className="text-sm text-sky-200">⏳ Embalado — aguardando a NF sair no SAP.</p>
            <p className="text-xs text-dark-400">Quando o faturamento emitir a nota, ela aparece aqui sozinha e o pedido passa para o Agendamento.</p>
          </div>
        )}
        {p.volumes != null && ['nf', 'agendamento', 'coleta', 'coletado'].includes(p.etapa) && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => imprimirVolumes(p.volumes ?? 0, p.transportadora)}>
              🏷️ Imprimir etiquetas de volume ({p.volumes})
            </Button>
            {!p.nfNumero && <span className="text-xs text-dark-400">sem NF ainda — a etiqueta sai com o campo NF em branco</span>}
          </div>
        )}

        {/* Erros */}
        {(etapaErro || (data?.erros.length ?? 0) > 0) && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-dark-100">Erros encontrados</h3>
            {data?.erros.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-sm bg-red-900/15 border border-red-800/40 rounded-lg px-3 py-1.5">
                <span className="text-red-300 font-medium">{TIPOS_ERRO.find((t) => t.value === e.tipo)?.label}</span>
                <span className="text-dark-200 truncate">{e.itemCodigo ? `${e.itemCodigo} · ` : ''}{e.descricao ?? ''}{e.quantidade ? ` · ${e.quantidade} un` : ''}</span>
                {e.observacao && <span className="text-dark-400 truncate">— {e.observacao}</span>}
                <span className="ml-auto text-[11px] text-dark-400 whitespace-nowrap">conta p/ {nomeDe(e.responsavelId)}</span>
                <button type="button" title="Apagar" className="text-dark-500 hover:text-red-300" onClick={() => removerErro.mutate({ erroId: e.id })}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {etapaErro && (
              <div className="grid sm:grid-cols-[2fr_1fr_80px_1.2fr_auto] gap-2 items-end">
                <Select
                  label="Item"
                  value={erroItem}
                  onChange={(e) => setErroItem(e.target.value)}
                  placeholder="(pedido todo)"
                  options={(data?.itens ?? []).map((i) => ({ value: String(i.id), label: `${i.itemCodigo ?? ''} · ${i.descricao}`.slice(0, 70) }))}
                />
                <Select label="Tipo" value={erroTipo} onChange={(e) => setErroTipo(e.target.value as typeof erroTipo)} options={TIPOS_ERRO.map((t) => ({ value: t.value, label: t.label }))} />
                <Input label="Qtd" type="number" value={erroQtd} onChange={(e) => setErroQtd(e.target.value)} />
                <Input label="Observação" value={erroObs} onChange={(e) => setErroObs(e.target.value)} />
                <Button
                  variant="danger"
                  loading={registrarErro.isPending}
                  onClick={() => {
                    const item = data?.itens.find((i) => String(i.id) === erroItem)
                    registrarErro.mutate(
                      { id: p.id, etapa: etapaErro, tipo: erroTipo, itemCodigo: item?.itemCodigo ?? undefined, descricao: item?.descricao, quantidade: erroQtd ? Number(erroQtd) : undefined, observacao: erroObs },
                      { onSuccess: () => (setErroItem(''), setErroQtd(''), setErroObs('')) }
                    )
                  }}
                >
                  + Anotar erro
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Itens */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-dark-100">Itens</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEtiquetasItens(true)} disabled={!data}>
                🏷️ Etiquetas dos itens
              </Button>
              <Button size="sm" variant="secondary" onClick={() => data && imprimirFolha(p, data.itens)} disabled={!data}>
                <Printer size={14} className="mr-1 inline" /> Imprimir folha de separação
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-dark-400 text-left">
                  <th className="py-1.5 pr-3 font-medium">Localização</th>
                  <th className="py-1.5 pr-3 font-medium">Código</th>
                  <th className="py-1.5 pr-3 font-medium">Produto</th>
                  <th className="py-1.5 pr-3 font-medium">Depósito</th>
                  <th className="py-1.5 font-medium text-right">Qtd</th>
                </tr>
              </thead>
              <tbody>
                {data?.itens.map((i) => (
                  <Fragment key={i.id}>
                    <tr className="border-t border-dark-700/70">
                      <td className="py-1.5 pr-3 font-mono text-xs text-dark-400">{i.kit?.modo === 'peca' ? '↓ peças' : i.localizacao ?? '—'}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs text-dark-300">{i.itemCodigo}</td>
                      <td className="py-1.5 pr-3 text-dark-200">
                        {i.kit && (
                          <span className="mr-1.5 rounded bg-violet-900/50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
                            KIT · {i.kit.modo === 'peca' ? 'montar com as peças' : 'por kit'}
                          </span>
                        )}
                        {i.mudancaSap === 'novo' && <span className="mr-1.5 rounded bg-sky-700 px-1.5 py-0.5 text-[10px] font-bold text-white">NOVO</span>}
                        {i.mudancaSap === 'qtd' && <span className="mr-1.5 rounded bg-sky-700 px-1.5 py-0.5 text-[10px] font-bold text-white">QTD ALTERADA</span>}
                        {i.descricao}
                      </td>
                      <td className="py-1.5 pr-3 text-dark-400">{i.deposito}</td>
                      <td className="py-1.5 text-right font-mono whitespace-nowrap">
                        {conferindo && !i.conferidoEm ? <span className="text-dark-500">?</span> : textoQtd(i)}
                        {i.conferidoEm && <span className="ml-1 text-green-400">✓</span>}
                        {i.kit && !conferindo && unidadesSap(i) && <span className="block text-[10px] text-dark-500">{unidadesSap(i)}</span>}
                        {i.mudancaSap === 'qtd' && !conferindo && <span className="block text-[10px] text-sky-300">antes: {textoAntes(i)}</span>}
                      </td>
                    </tr>
                    {i.kit?.modo === 'peca' &&
                      i.kit.pecas.map((c) => (
                        <tr key={`${i.id}-${c.codigo}`} className="text-xs bg-violet-950/20">
                          <td className="py-1 pr-3 pl-3 font-mono text-dark-400">{c.localizacao ?? '—'}</td>
                          <td className="py-1 pr-3 font-mono text-dark-400">{c.codigo}</td>
                          <td className="py-1 pr-3 text-dark-300">↳ {c.descricao}</td>
                          <td className="py-1 pr-3 text-dark-500">{c.deposito}</td>
                          <td className="py-1 text-right font-mono text-dark-300">{num(c.total)}</td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <MaisAcoes pedido={p} colaboradores={colaboradores} podeAdmin={!!podeDescartar} onFeito={recarregar} onFechar={onClose} />

        {podeDescartar && (
          <div className="rounded-xl border border-red-800/40 bg-red-900/10 p-3 space-y-2">
            {!descartando ? (
              <button type="button" className="text-sm text-red-300 hover:text-red-200" onClick={() => setDescartando(true)}>
                🗑️ Descartar este pedido (voltou / picking refeito)
              </button>
            ) : (
              <>
                <Input label="Motivo do descarte" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: cliente pediu mais itens, picking refeito" />
                <div className="flex gap-2">
                  <Button variant="danger" disabled={motivo.trim().length < 3} loading={descartar.isPending} onClick={() => descartar.mutate({ id: p.id, motivo })}>
                    Descartar e recriar
                  </Button>
                  <Button variant="secondary" onClick={() => setDescartando(false)}>
                    Cancelar
                  </Button>
                </div>
                <p className="text-xs text-dark-400">O pedido sai da fila e fica guardado em "Descartados". Se o picking ainda existir no SAP, o card é criado de novo com os itens atuais. O prazo de 48h continua contando do primeiro picking.</p>
              </>
            )}
          </div>
        )}

        {p.etapa !== 'separacao' || p.separacaoInicio ? (
          <div className="flex justify-end">
            <button type="button" className="text-xs text-dark-400 hover:text-dark-200 inline-flex items-center gap-1" onClick={() => voltar.mutate({ id: p.id })}>
              <Undo2 size={12} /> Voltar uma etapa (clicou errado)
            </button>
          </div>
        ) : null}
      </div>
      {etiquetasItens && data && <EtiquetasItensModal pedidoSap={p.pedidosSap} itens={data.itens} onClose={() => setEtiquetasItens(false)} />}
    </Modal>
  )
}

type ItemDetalhe = inferRouterOutputs<AppRouter>['expedicao']['detalhe']['itens'][number]

// Etiquetas dos itens (impressora térmica) — escolhe quais itens e quantas
// etiquetas de cada (padrão: uma por unidade).
function EtiquetasItensModal({ pedidoSap, itens, onClose }: { pedidoSap: string; itens: ItemDetalhe[]; onClose: () => void }) {
  const [qtd, setQtd] = useState<Record<number, string>>(() => Object.fromEntries(itens.map((i) => [i.id, String(i.quantidade)])))
  const [tamanho, setTamanho] = useState(lerTamanho('item').id)
  const total = itens.reduce((s, i) => s + (Number(qtd[i.id]) || 0), 0)
  const todas = (f: (i: ItemDetalhe) => number) => setQtd(Object.fromEntries(itens.map((i) => [i.id, String(f(i))])))
  return (
    <Modal open onClose={onClose} title={`Etiquetas dos itens — pedido ${pedidoSap}`} size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" className="text-xs rounded-lg border border-dark-600 px-2.5 py-1.5 text-dark-200 hover:bg-dark-800" onClick={() => todas((i) => i.quantidade)}>
            Uma por unidade
          </button>
          <button type="button" className="text-xs rounded-lg border border-dark-600 px-2.5 py-1.5 text-dark-200 hover:bg-dark-800" onClick={() => todas(() => 1)}>
            Uma de cada item
          </button>
          <button type="button" className="text-xs rounded-lg border border-dark-600 px-2.5 py-1.5 text-dark-200 hover:bg-dark-800" onClick={() => todas(() => 0)}>
            Zerar
          </button>
          <div className="ml-auto w-44">
            <Select label="Tamanho da etiqueta" value={tamanho} onChange={(e) => (setTamanho(e.target.value as typeof tamanho), salvarTamanho('item', e.target.value))} options={TAMANHOS_ETIQUETA.map((t) => ({ value: t.id, label: t.label }))} />
          </div>
        </div>
        <div className="max-h-[50vh] overflow-y-auto divide-y divide-dark-700 rounded-lg border border-dark-700">
          {itens.map((i) => (
            <div key={i.id} className="flex items-center gap-3 px-3 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-dark-400 font-mono">{i.itemCodigo}</p>
                <p className="text-sm text-dark-100 leading-tight truncate">{i.descricao}</p>
              </div>
              <span className="text-xs text-dark-500 whitespace-nowrap">pedido: {num(i.quantidade)}</span>
              <input
                type="number"
                min={0}
                value={qtd[i.id] ?? '0'}
                onChange={(e) => setQtd({ ...qtd, [i.id]: e.target.value })}
                className="w-20 bg-dark-800 border border-dark-600 rounded px-2 py-1 text-sm text-dark-100 text-right"
                aria-label={`Etiquetas de ${i.descricao}`}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-dark-300">{num(total)} etiqueta(s)</p>
          <Button
            disabled={total === 0 || total > 2000}
            onClick={() => {
              const t = TAMANHOS_ETIQUETA.find((x) => x.id === tamanho) ?? lerTamanho('item')
              const html = itens.flatMap((i) => Array.from({ length: Math.max(0, Number(qtd[i.id]) || 0) }, () => htmlEtiquetaItem({ codigo: i.itemCodigo, descricao: i.descricao, pedido: pedidoSap, localizacao: i.localizacao }, t)))
              if (!imprimirEtiquetas(html, t, `Etiquetas — pedido ${pedidoSap}`)) toast.error('O navegador bloqueou a janela de impressão')
            }}
          >
            🖨 Imprimir
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Pedidos descartados pelo admin (voltaram / picking refeito) — ficam
// guardados aqui, fora da fila, com o motivo.
// Kits do SAP (estruturas): o André/admin escolhe, kit a kit, se a ficha de
// separação mostra o kit (uma linha) ou as peças pra montar na hora.
function KitsModal({ podeAlterar, onClose }: { podeAlterar: boolean; onClose: () => void }) {
  const { data = [], isLoading } = trpc.expedicao.kits.useQuery()
  const utils = trpc.useUtils()
  const [aberto, setAberto] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const definir = trpc.expedicao.definirModoKit.useMutation({
    onSuccess: () => (utils.expedicao.kits.invalidate(), utils.expedicao.detalhe.invalidate()),
    onError: (e) => toast.error(e.message),
  })
  const t = busca.trim().toLowerCase()
  const lista = t ? data.filter((k) => `${k.itemCodigo} ${k.descricao}`.toLowerCase().includes(t)) : data
  return (
    <Modal open onClose={onClose} title={`Kits do SAP (${data.length})`} size="lg">
      <div className="space-y-3">
        <p className="text-xs text-dark-400">
          <b className="text-dark-200">Por kit</b>: a ficha mostra uma linha só, com a quantidade de kits. <b className="text-dark-200">Por peça</b>: a ficha lista as peças do kit
          (já multiplicadas pela quantidade de kits, com o endereço de cada uma) para montar na hora. A conferência conta sempre os kits montados. As peças vêm da estrutura do
          kit no SAP.
          {!podeAlterar && ' Só o responsável do estoque pode mudar.'}
        </p>
        {data.length > 8 && <Input placeholder="Buscar kit por código ou nome" value={busca} onChange={(e) => setBusca(e.target.value)} />}
        {isLoading ? (
          <p className="text-sm text-dark-400">Carregando…</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-dark-400">Os kits aparecem aqui depois da próxima leitura do SAP (alguns minutos).</p>
        ) : (
          <div className="space-y-1.5">
            {lista.map((k) => (
              <div key={k.itemCodigo} className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setAberto(aberto === k.itemCodigo ? null : k.itemCodigo)}>
                    <span className="block text-[11px] font-mono text-dark-400">
                      {k.itemCodigo} · {k.componentes.length} peça(s) {aberto === k.itemCodigo ? '▲' : '▼'}
                    </span>
                    <span className="block text-sm text-dark-100 leading-tight">{k.descricao}</span>
                  </button>
                  <div className="flex rounded-lg border border-dark-600 overflow-hidden text-xs">
                    {(['kit', 'peca'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={!podeAlterar || definir.isPending}
                        onClick={() => k.modo !== m && definir.mutate({ itemCodigo: k.itemCodigo, modo: m })}
                        className={`px-2.5 py-1 ${k.modo === m ? 'bg-violet-600 text-white' : 'bg-dark-800 text-dark-300 hover:text-dark-100'} disabled:cursor-not-allowed`}
                      >
                        {m === 'kit' ? 'Por kit' : 'Por peça'}
                      </button>
                    ))}
                  </div>
                </div>
                {aberto === k.itemCodigo && (
                  <ul className="mt-2 space-y-0.5 border-t border-dark-700 pt-2 text-xs">
                    {k.componentes.map((c) => (
                      <li key={c.codigo} className="flex gap-2 text-dark-300">
                        <span className="w-14 text-right font-mono text-dark-100">{num(c.quantidade / k.quantidadeBase)}×</span>
                        <span className="font-mono text-dark-500">{c.codigo}</span>
                        <span className="min-w-0 flex-1">{c.descricao}</span>
                        <span className="text-dark-500">{c.deposito}</span>
                      </li>
                    ))}
                    <li className="pt-1 text-[10px] text-dark-500">Quantidade de cada peça para 1 kit.</li>
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function DescartadosModal({ onClose }: { onClose: () => void }) {
  const { data = [] } = trpc.expedicao.descartados.useQuery()
  const { data: podeDescartar } = trpc.expedicao.podeDescartar.useQuery()
  const utils = trpc.useUtils()
  const reabrir = trpc.expedicao.reabrir.useMutation({
    onSuccess: () => (toast.success('Pedido reaberto — voltou para a fila'), utils.expedicao.fila.invalidate(), utils.expedicao.descartados.invalidate()),
    onError: (e) => toast.error(e.message),
  })
  return (
    <Modal open onClose={onClose} title={`Pedidos descartados e cancelados (${data.length})`} size="lg">
      {data.length === 0 ? (
        <p className="text-sm text-dark-400">Nenhum pedido descartado ou cancelado.</p>
      ) : (
        <div className="space-y-2">
          {data.map((d) => (
            <div key={d.id} className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-dark-100">
                  <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 mr-1.5 ${d.etapa === 'cancelado' ? 'bg-red-900/40 text-red-200' : 'bg-orange-900/40 text-orange-200'}`}>
                    {d.etapa === 'cancelado' ? 'CANCELADO' : 'DESCARTADO'}
                  </span>
                  <b>Pedido {d.pedidosSap}</b> · picking {d.pickListSap} · {d.clienteNome}
                </p>
                <p className="text-xs text-dark-400">
                  {hora(d.descartadoEm)} · {d.por ?? 'SAP (automático)'}
                </p>
              </div>
              <p className="text-sm text-red-300">Motivo: {d.motivoDescarte}</p>
              {d.alteracaoSap && <p className="text-xs text-orange-200/80">{d.alteracaoSap}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-dark-500">
                  Já tinha: {[d.separacaoFim && 'separação', d.conferenciaFim && 'conferência', d.embalagemFim && 'embalagem'].filter(Boolean).join(', ') || 'nada feito'}
                </p>
                {d.etapa === 'cancelado' && podeDescartar && (
                  <Button size="sm" variant="secondary" loading={reabrir.isPending} onClick={() => reabrir.mutate({ id: d.id })}>
                    ↺ Reabrir
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// Conferência às cegas (pedido do João, 2026-10-29): o conferente escolhe
// qualquer item que falta (na ordem que quiser), vê o produto mas não a
// quantidade do pedido, digita o que contou e o item só fica conferido
// quando bate. Não bateu = recontar; se é erro da separação, anota no
// "Erros encontrados" e corrige.
function ConferenciaItens({ pedidoId, pedidoSap, itens, conferidos }: { pedidoId: number; pedidoSap: string; itens: ItemDetalhe[]; conferidos: number }) {
  const [qtdEtiquetas, setQtdEtiquetas] = useState('1')
  const utils = trpc.useUtils()
  const faltam = itens.filter((i) => !i.conferidoEm)
  const [escolhidoId, setEscolhidoId] = useState<number | null>(null)
  const escolhido = faltam.find((i) => i.id === escolhidoId) ?? null
  const [qtd, setQtd] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const conferir = trpc.expedicao.conferirItem.useMutation({
    onSuccess(r) {
      if (r.confere) {
        setAviso(null)
        setQtd('')
        setEscolhidoId(null)
        toast.success('Item conferido')
      } else {
        setAviso('✗ Não confere com o pedido. Conte de novo. Se faltou, sobrou ou veio trocado, anote o erro abaixo e corrija antes de conferir.')
      }
      utils.expedicao.detalhe.invalidate({ id: pedidoId })
    },
    onError: (e) => toast.error(e.message),
  })
  const t = busca.trim().toLowerCase()
  const lista = t ? faltam.filter((i) => `${i.itemCodigo ?? ''} ${i.descricao}`.toLowerCase().includes(t)) : faltam
  return (
    <div className="w-full rounded-lg border border-blue-700/40 bg-blue-900/10 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-blue-200">Conferência item por item</p>
        <p className="text-xs text-dark-300">
          {conferidos} de {itens.length} conferidos
        </p>
      </div>
      <div className="h-1.5 rounded bg-dark-700 overflow-hidden">
        <div className="h-full bg-green-500" style={{ width: `${itens.length ? (conferidos / itens.length) * 100 : 0}%` }} />
      </div>
      {faltam.length === 0 ? (
        <p className="text-sm text-green-300">✓ Todos os itens conferidos — pode terminar a conferência.</p>
      ) : escolhido ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (qtd !== '') conferir.mutate({ id: pedidoId, itemId: escolhido.id, quantidade: Number(qtd) })
          }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-dark-400">{escolhido.localizacao ?? escolhido.deposito} · {escolhido.itemCodigo}</p>
            <p className="text-base font-semibold text-dark-50 leading-tight">{escolhido.descricao}</p>
            {escolhido.kit && <p className="text-[11px] text-violet-300">KIT — conte os kits montados (não as peças)</p>}
            {escolhido.tentativasConferencia > 0 && <p className="text-[11px] text-amber-300">{escolhido.tentativasConferencia} contagem(ns) que não bateram</p>}
            <div className="flex items-center gap-1.5 mt-1">
              <input
                type="number"
                min={1}
                value={qtdEtiquetas}
                onChange={(e) => setQtdEtiquetas(e.target.value)}
                className="w-16 bg-dark-800 border border-dark-600 rounded px-2 py-0.5 text-xs text-dark-100"
                aria-label="Quantidade de etiquetas"
              />
              <button
                type="button"
                className="text-xs text-blue-300 hover:text-blue-200"
                onClick={() => {
                  const t = lerTamanho('item')
                  const n = Math.max(1, Math.min(500, Number(qtdEtiquetas) || 1))
                  const html = Array.from({ length: n }, () => htmlEtiquetaItem({ codigo: escolhido.itemCodigo, descricao: escolhido.descricao, pedido: pedidoSap, localizacao: escolhido.localizacao }, t))
                  if (!imprimirEtiquetas(html, t, `Etiqueta ${escolhido.itemCodigo ?? ''}`)) toast.error('O navegador bloqueou a janela de impressão')
                }}
              >
                🏷️ imprimir etiqueta(s) deste item
              </button>
            </div>
          </div>
          <div className="w-32">
            <Input label={escolhido.kit ? 'Kits contados' : 'Quantidade contada'} type="number" min={0} step="any" autoFocus value={qtd} onChange={(e) => (setQtd(e.target.value), setAviso(null))} />
          </div>
          <Button type="submit" size="lg" disabled={qtd === ''} loading={conferir.isPending}>
            Conferir
          </Button>
          <Button type="button" variant="ghost" onClick={() => (setEscolhidoId(null), setQtd(''), setAviso(null))}>
            Trocar item
          </Button>
        </form>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-dark-300">Toque no item que você pegou para conferir ({faltam.length} faltando):</p>
          {faltam.length > 6 && <Input placeholder="Buscar por código ou nome" value={busca} onChange={(e) => setBusca(e.target.value)} />}
          <div className="grid sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
            {lista.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => (setEscolhidoId(i.id), setQtd(''), setAviso(null))}
                className="text-left rounded-lg border border-dark-600 bg-dark-800 px-2.5 py-1.5 hover:border-blue-500"
              >
                <span className="block text-[11px] text-dark-400 font-mono">{i.itemCodigo}{i.localizacao ? ` · ${i.localizacao}` : ''}</span>
                <span className="block text-sm text-dark-100 leading-tight">{i.descricao}</span>
                {i.tentativasConferencia > 0 && <span className="block text-[10px] text-amber-300">{i.tentativasConferencia} contagem(ns) erradas</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {aviso && <p className="text-sm text-red-300">{aviso}</p>}
    </div>
  )
}

// Folha de separação impressa (A4) — mesma informação da ficha de papel,
// com os itens já em ordem de localização.
function imprimirFolha(p: Pedido, itens: ItemDetalhe[]) {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const total = itens.reduce((s, i) => s + qtdSeparar(i), 0)
  const linha = (loc: string | null, dep: string | null, cod: string | null, desc: string, qtd: string, cls = '') =>
    `<tr class="${cls}"><td class="c"><span class="box"></span></td><td><b class="loc">${esc(loc ?? '—')}</b><div class="dep">${esc(dep)}</div></td><td class="mono">${esc(cod)}</td><td>${desc}</td><td class="r q">${qtd}</td><td class="c"><span class="escr"></span></td></tr>`
  const mud = lerMudancas(p)
  const marca = (i: ItemDetalhe) =>
    i.mudancaSap === 'novo' ? '<span class="alt">NOVO</span> ' : i.mudancaSap === 'qtd' ? `<span class="alt">QTD ALTERADA · antes ${esc(textoAntes(i))}</span> ` : ''
  const linhas = itens
    .map((i) => {
      if (!i.kit) return linha(i.localizacao, i.deposito, i.itemCodigo, marca(i) + esc(i.descricao), num(i.quantidade), i.mudancaSap ? 'mud' : '')
      const sap = unidadesSap(i)
      if (i.kit.modo === 'kit')
        return linha(i.localizacao, i.deposito, i.itemCodigo, `${marca(i)}<span class="kit">KIT</span> ${esc(i.descricao)}${sap ? `<div class="dep">${esc(sap)}</div>` : ''}`, esc(textoQtd(i)))
      // Por peça: o kit vira título e as peças (já multiplicadas) logo abaixo.
      const cab = `<tr class="kitcab"><td class="c"><span class="box"></span></td><td colspan="3">${marca(i)}<span class="kit">MONTAR KIT</span> <span class="mono">${esc(i.itemCodigo)}</span> ${esc(i.descricao)}${sap ? ` <span class="dep">(${esc(sap)})</span>` : ''}</td><td class="r q">${esc(textoQtd(i))}</td><td></td></tr>`
      return cab + i.kit.pecas.map((c) => linha(c.localizacao, c.deposito, c.codigo, `↳ ${esc(c.descricao)}`, num(c.total), 'peca')).join('')
    })
    .join('')
  const w = window.open('', '_blank')
  if (!w) return toast.error('O navegador bloqueou a janela de impressão')
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Separação — pedido ${esc(p.pedidosSap)}</title>
<style>body{font-family:Arial,sans-serif;color:#111;margin:24px}h1{margin:0;font-size:20px}.sub{color:#555;font-size:12px}
.topo{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px}.n{font-size:24px;font-weight:700;text-align:right}
.info{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px 16px;margin:12px 0;font-size:13px}.info b{display:block;font-size:10px;color:#555;text-transform:uppercase}
.obs{background:#fef3c7;border:1px solid #f59e0b;padding:6px 10px;font-weight:700;margin-bottom:10px;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:12.5px}th{font-size:10px;text-transform:uppercase;color:#555;text-align:left;border-bottom:1.5px solid #111;padding:5px}
td{border-bottom:1px solid #ccc;padding:7px 5px}.c{text-align:center}.r{text-align:right}.q{font-size:15px;font-weight:700}.mono{font-family:monospace}
.loc{font-family:monospace;font-size:14px}.dep{font-size:10px;color:#666}.box{display:inline-block;width:16px;height:16px;border:1.5px solid #111}.escr{display:inline-block;width:50px;border-bottom:1px solid #111;height:16px}
.kit{display:inline-block;background:#111;color:#fff;font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;vertical-align:middle}.kitcab td{background:#f3f0ff;border-bottom:1px solid #999}.peca td{padding-left:14px}
.alt{display:inline-block;background:#0369a1;color:#fff;font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;vertical-align:middle}.mud td{background:#e0f2fe}
.altbox{border:2px solid #0369a1;background:#e0f2fe;padding:6px 10px;margin-bottom:10px;font-size:13px}.altbox b{font-size:14px}
.rod{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px;font-size:10px;text-transform:uppercase;color:#555}.rod span{display:block;border-bottom:1px solid #111;height:24px}
@page{size:A4;margin:12mm}</style></head><body>
<div class="topo"><div><h1>Folha de Separação</h1><div class="sub">Gerada pelo CRM com dados do SAP</div></div><div><div class="sub">Picking</div><div class="n">${esc(p.pickListSap)}</div></div></div>
<div class="info"><div><b>Pedido</b>${esc(p.pedidosSap)}</div><div><b>Data do picking</b>${esc(p.dataPicking.split('-').reverse().join('/'))}</div><div><b>Vendedor</b>${esc(p.vendedorSap)}</div>
<div style="grid-column:1/-1"><b>Cliente</b>${esc(p.clienteCodigo)} ${esc(p.clienteNome)}</div><div><b>Itens / quantidade</b>${itens.length} / ${num(total)}</div><div><b>Separador</b>________________</div><div><b>Início / fim</b>____:____ / ____:____</div></div>
${mud ? `<div class="altbox"><b>✎ PEDIDO ALTERADO</b> — refeito no SAP: substitui o picking ${esc(mud.pickingAnterior)}. ${esc(resumoMudancas(mud))}.${mud.removidos.length ? `<br><b>Retirado${mud.removidos.length > 1 ? 's' : ''}:</b> ${mud.removidos.map((r) => `${esc(r.descricao)} (${num(r.quantidade)})`).join('; ')}` : ''}</div>` : ''}
${p.observacaoSap ? `<div class="obs">🚚 ${esc(p.observacaoSap)}</div>` : ''}
<table><thead><tr><th>✓</th><th>Localização</th><th>Código</th><th>Produto</th><th class="r">Separar</th><th>Separado</th></tr></thead><tbody>${linhas}</tbody></table>
<div class="rod"><div>Volumes<span></span></div><div>Peso (kg)<span></span></div><div>Conferido por<span></span></div><div>Erros<span></span></div></div>
<script>window.onload=()=>window.print()</script></body></html>`)
  w.document.close()
}

const ETAPAS_MOVER = [
  { value: 'separacao', label: 'Separação' },
  { value: 'conferencia', label: 'Conferência' },
  { value: 'embalagem', label: 'Embalagem' },
  { value: 'nf', label: 'NF' },
  { value: 'coleta', label: 'Aguardando coleta (precisa de NF)' },
] as const
type EtapaMover = (typeof ETAPAS_MOVER)[number]['value']

// Pausar/retomar, editar e (admin) finalizar, mover e cancelar — pedido do
// João na subida (2026-11-02): resolver de uma vez pedido que já foi feito,
// e ter os botões de cancelar, voltar, pausar e editar.
function MaisAcoes({
  pedido: p,
  colaboradores,
  podeAdmin,
  onFeito,
  onFechar,
}: {
  pedido: Pedido
  colaboradores: Colaborador[]
  podeAdmin: boolean
  onFeito: () => void
  onFechar: () => void
}) {
  const utils = trpc.useUtils()
  const erro = (e: { message: string }) => toast.error(e.message)
  const pausar = trpc.expedicao.pausar.useMutation({ onSuccess: () => (toast.success('Pedido pausado'), onFeito(), setAberto(null)), onError: erro })
  const retomar = trpc.expedicao.retomar.useMutation({ onSuccess: () => (toast.success('Pedido retomado'), onFeito()), onError: erro })
  const editar = trpc.expedicao.editar.useMutation({ onSuccess: () => (toast.success('Alterações salvas'), onFeito(), setAberto(null)), onError: erro })
  const sair = () => (utils.expedicao.fila.invalidate(), utils.expedicao.descartados.invalidate(), onFechar())
  const finalizar = trpc.expedicao.finalizar.useMutation({ onSuccess: () => (toast.success('Pedido finalizado'), sair()), onError: erro })
  const mover = trpc.expedicao.moverPara.useMutation({ onSuccess: (r) => (r.movidos ? toast.success('Pedido movido') : toast.error('Nada mudou (sem NF não vai para a coleta)'), onFeito()), onError: erro })
  const cancelar = trpc.expedicao.cancelar.useMutation({ onSuccess: () => (toast.success('Pedido cancelado'), sair()), onError: erro })

  const [aberto, setAberto] = useState<null | 'pausar' | 'editar' | 'finalizar' | 'cancelar'>(null)
  const [motivo, setMotivo] = useState('')
  const [etapaDestino, setEtapaDestino] = useState<EtapaMover | ''>('')
  const [ed, setEd] = useState({
    volumes: p.volumes == null ? '' : String(p.volumes),
    cabecotes: p.cabecotes == null ? '' : String(p.cabecotes),
    paletes: p.paletes == null ? '' : String(p.paletes),
    transportadora: p.transportadora ?? '',
    observacao: p.observacao ?? '',
    separacao: p.separacaoColaboradorId ? String(p.separacaoColaboradorId) : '',
    conferencia: p.conferenciaColaboradorId ? String(p.conferenciaColaboradorId) : '',
    embalagem: p.embalagemColaboradorId ? String(p.embalagemColaboradorId) : '',
  })
  if (['coletado', 'cancelado', 'descartado'].includes(p.etapa)) return null
  const nOuNull = (v: string) => (v === '' ? null : Number(v))
  const opcoesPessoa = [{ value: '', label: '—' }, ...colaboradores.filter((c) => c.ativo).map((c) => ({ value: String(c.id), label: c.nome }))]

  return (
    <div className="rounded-xl border border-dark-600 bg-dark-900/40 p-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        {p.pausadoEm ? (
          <Button size="sm" variant="secondary" loading={retomar.isPending} onClick={() => retomar.mutate({ id: p.id })}>
            ▶ Retomar
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => (setAberto(aberto === 'pausar' ? null : 'pausar'), setMotivo(''))}>
            ⏸ Pausar
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setAberto(aberto === 'editar' ? null : 'editar')}>
          ✏️ Editar
        </Button>
        {podeAdmin && (
          <>
            <Button size="sm" variant="secondary" onClick={() => (setAberto(aberto === 'finalizar' ? null : 'finalizar'), setMotivo(''))}>
              ✔ Finalizar (já expedido)
            </Button>
            <div className="flex items-center gap-1">
              <Select
                value={etapaDestino}
                onChange={(e) => setEtapaDestino(e.target.value as EtapaMover)}
                placeholder="⇢ Mover para…"
                options={ETAPAS_MOVER.filter((e) => e.value !== p.etapa).map((e) => ({ value: e.value, label: e.label }))}
              />
              <Button size="sm" variant="secondary" disabled={!etapaDestino} loading={mover.isPending} onClick={() => etapaDestino && mover.mutate({ ids: [p.id], etapa: etapaDestino })}>
                Mover
              </Button>
            </div>
            <Button size="sm" variant="danger" onClick={() => (setAberto(aberto === 'cancelar' ? null : 'cancelar'), setMotivo(''))}>
              ✖ Cancelar pedido
            </Button>
          </>
        )}
      </div>

      {(aberto === 'pausar' || aberto === 'finalizar' || aberto === 'cancelar') && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[240px]">
            <Input
              label={aberto === 'pausar' ? 'Motivo da pausa' : aberto === 'cancelar' ? 'Motivo do cancelamento' : 'Observação (opcional)'}
              placeholder={aberto === 'pausar' ? 'ex.: aguardando cliente / falta material' : aberto === 'cancelar' ? 'ex.: cliente desistiu' : 'ex.: já tinha saído antes da fila'}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          {aberto === 'pausar' && (
            <Button disabled={motivo.trim().length < 3} loading={pausar.isPending} onClick={() => pausar.mutate({ id: p.id, motivo })}>
              Pausar
            </Button>
          )}
          {aberto === 'finalizar' && (
            <Button loading={finalizar.isPending} onClick={() => finalizar.mutate({ ids: [p.id], motivo: motivo || undefined })}>
              Confirmar: finalizar
            </Button>
          )}
          {aberto === 'cancelar' && (
            <Button variant="danger" disabled={motivo.trim().length < 3} loading={cancelar.isPending} onClick={() => cancelar.mutate({ ids: [p.id], motivo })}>
              Confirmar cancelamento
            </Button>
          )}
          <p className="text-xs text-dark-400 w-full">
            {aberto === 'pausar' && 'Ninguém inicia etapa enquanto estiver pausado. O prazo de 48h continua contando.'}
            {aberto === 'finalizar' && 'Fecha o pedido como coletado sem passar pelas etapas. Fica fora do desempenho e do % no prazo.'}
            {aberto === 'cancelar' && 'Sai da fila sem ser recriado. Fica em "Descartados / cancelados", de onde dá para reabrir.'}
          </p>
        </div>
      )}

      {aberto === 'editar' && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <Input label="Volumes" type="number" min={0} value={ed.volumes} onChange={(e) => setEd({ ...ed, volumes: e.target.value })} />
            <Input label="Cabeçotes" type="number" min={0} value={ed.cabecotes} onChange={(e) => setEd({ ...ed, cabecotes: e.target.value })} />
            <Input label="Paletes" type="number" min={0} value={ed.paletes} onChange={(e) => setEd({ ...ed, paletes: e.target.value })} />
            <div className="col-span-3">
              <Input label="Transportadora" value={ed.transportadora} onChange={(e) => setEd({ ...ed, transportadora: e.target.value })} />
            </div>
          </div>
          <Input label="Observação interna" value={ed.observacao} onChange={(e) => setEd({ ...ed, observacao: e.target.value })} />
          {podeAdmin && (
            <div className="grid sm:grid-cols-3 gap-2">
              <Select label="Separou" value={ed.separacao} onChange={(e) => setEd({ ...ed, separacao: e.target.value })} options={opcoesPessoa} />
              <Select label="Conferiu" value={ed.conferencia} onChange={(e) => setEd({ ...ed, conferencia: e.target.value })} options={opcoesPessoa} />
              <Select label="Embalou" value={ed.embalagem} onChange={(e) => setEd({ ...ed, embalagem: e.target.value })} options={opcoesPessoa} />
            </div>
          )}
          <Button
            loading={editar.isPending}
            onClick={() =>
              editar.mutate({
                id: p.id,
                volumes: nOuNull(ed.volumes),
                cabecotes: nOuNull(ed.cabecotes),
                paletes: nOuNull(ed.paletes),
                transportadora: ed.transportadora,
                observacao: ed.observacao,
                ...(podeAdmin
                  ? { separacaoColaboradorId: nOuNull(ed.separacao), conferenciaColaboradorId: nOuNull(ed.conferencia), embalagemColaboradorId: nOuNull(ed.embalagem) }
                  : {}),
              })
            }
          >
            Salvar alterações
          </Button>
        </div>
      )}
    </div>
  )
}

// Barra da seleção em lote (admin): finalizar os que já saíram, mover de
// etapa ou cancelar vários pedidos de uma vez.
function AcoesEmLote({ ids, todosDaTela, onSelecionar, onFeito }: { ids: number[]; todosDaTela: number[]; onSelecionar: (ids: number[]) => void; onFeito: () => void }) {
  const erro = (e: { message: string }) => toast.error(e.message)
  const finalizar = trpc.expedicao.finalizar.useMutation({ onSuccess: (r) => (toast.success(`${r.finalizados} pedido(s) finalizado(s)`), onFeito()), onError: erro })
  const mover = trpc.expedicao.moverPara.useMutation({ onSuccess: (r) => (toast.success(`${r.movidos} pedido(s) movido(s)`), onFeito()), onError: erro })
  const cancelar = trpc.expedicao.cancelar.useMutation({ onSuccess: (r) => (toast.success(`${r.cancelados} pedido(s) cancelado(s)`), onFeito()), onError: erro })
  const [etapa, setEtapa] = useState<EtapaMover | ''>('')
  const [motivo, setMotivo] = useState('')
  const [confirmar, setConfirmar] = useState<null | 'finalizar' | 'cancelar'>(null)
  const n = ids.length
  return (
    <div className="sticky top-2 z-10 rounded-2xl border border-gold-600/50 bg-dark-800/95 backdrop-blur p-3 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <p className="text-sm text-dark-100 font-semibold mr-2">{n} selecionado(s)</p>
        <Button size="sm" variant="ghost" onClick={() => onSelecionar(todosDaTela)}>
          Selecionar todos da tela ({todosDaTela.length})
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onSelecionar([])} disabled={!n}>
          Limpar
        </Button>
        <span className="flex-1" />
        <Button size="sm" disabled={!n} onClick={() => (setConfirmar('finalizar'), setMotivo(''))}>
          ✔ Finalizar (já expedidos)
        </Button>
        <Select value={etapa} onChange={(e) => setEtapa(e.target.value as EtapaMover)} placeholder="⇢ Mover para…" options={ETAPAS_MOVER.map((e) => ({ value: e.value, label: e.label }))} />
        <Button size="sm" variant="secondary" disabled={!n || !etapa} loading={mover.isPending} onClick={() => etapa && mover.mutate({ ids, etapa })}>
          Mover
        </Button>
        <Button size="sm" variant="danger" disabled={!n} onClick={() => (setConfirmar('cancelar'), setMotivo(''))}>
          ✖ Cancelar
        </Button>
      </div>
      {confirmar && (
        <div className="flex flex-wrap items-end gap-2 border-t border-dark-700 pt-2">
          <div className="flex-1 min-w-[240px]">
            <Input
              label={confirmar === 'cancelar' ? `Motivo do cancelamento (${n} pedidos)` : `Observação — finalizar ${n} pedido(s) (opcional)`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          {confirmar === 'finalizar' ? (
            <Button loading={finalizar.isPending} onClick={() => finalizar.mutate({ ids, motivo: motivo || undefined }, { onSuccess: () => setConfirmar(null) })}>
              Confirmar: finalizar {n}
            </Button>
          ) : (
            <Button variant="danger" disabled={motivo.trim().length < 3} loading={cancelar.isPending} onClick={() => cancelar.mutate({ ids, motivo }, { onSuccess: () => setConfirmar(null) })}>
              Confirmar: cancelar {n}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setConfirmar(null)}>
            Voltar
          </Button>
        </div>
      )}
    </div>
  )
}

// O que foi lançado no pedido do SAP (aba Imposto → Transporte): volumes,
// espécie e transportadora. Mostra na embalagem e avisa se o embalador
// digitar uma quantidade diferente.
function FreteSap({ p, volumesDigitados }: { p: { volumesSap: number | null; especieSap: string | null; transportadoraSap: string | null }; volumesDigitados: string }) {
  const temAlgo = p.volumesSap != null || !!p.transportadoraSap
  const diferente = p.volumesSap != null && volumesDigitados !== '' && Number(volumesDigitados) !== p.volumesSap
  return (
    <div className="w-full rounded-lg border border-blue-700/50 bg-blue-950/30 px-3 py-2 text-sm">
      {temAlgo ? (
        <>
          <span className="text-blue-300 font-semibold">📦 No pedido do SAP: </span>
          <span className="text-dark-100">
            {p.volumesSap != null ? <b>{p.volumesSap} volume(s)</b> : 'volumes não informados'}
            {p.especieSap ? ` (${p.especieSap.toLowerCase()})` : ''}
            {' · '}
            {p.transportadoraSap ? <>transportadora <b>{p.transportadoraSap}</b></> : 'sem transportadora'}
          </span>
          {diferente && <p className="text-amber-300 text-xs mt-1">⚠️ Você digitou {volumesDigitados} volume(s), diferente do SAP ({p.volumesSap}). Confira antes de terminar.</p>}
        </>
      ) : (
        <span className="text-dark-400">O pedido no SAP não tem volumes nem transportadora lançados — preencha abaixo.</span>
      )}
    </div>
  )
}
