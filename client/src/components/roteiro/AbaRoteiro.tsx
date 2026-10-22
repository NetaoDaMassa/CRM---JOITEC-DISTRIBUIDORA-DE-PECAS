// Roteiro do dia — tela do vendedor externo (Odin Compressores). Pedido do
// João, 2026-10-22: monta na véspera saindo de casa, gestor aprova e, com a
// trava ligada, visita só é registrada por aqui ("Cheguei" numa parada).
// O gestor usa o mesmo componente (vendedorId) pra ver/editar/aprovar.
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Home, MapPin, MapPinOff, Plus, Search, Send, Save, Route, ArrowUp, ArrowDown, Trash2, Navigation, LogIn, CheckCircle2, SkipForward,
  LoaderCircle, Lock, AlertTriangle, Clock, Building2, Sparkles, CircleHelp, ThumbsUp, Undo2,
} from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import Select from '../ui/Select'
import { Input } from '../ui/Input'
import { Badge } from '../ui/Badge'
import MapaRoteiro, { type ParadaMapa } from './MapaRoteiro'
import {
  OBJETIVOS_ROTEIRO, MOTIVOS_PULO, RESULTADOS_VISITA, STATUS_ROTEIRO, FONTE_LOCALIZACAO,
  dataBr, diaSemana, horaBrDeUtc, linksGoogleMaps, linkWaze, linkGoogleUmLugar, obterGps,
} from './util'

type Tipo = 'cliente' | 'prospeccao'
type ParadaLocal = {
  chave: string
  id?: number
  tipo: Tipo
  nome: string
  endereco: string | null
  cidade: string | null
  lat: number | null
  lng: number | null
  localizacaoFonte: 'gps_visita' | 'endereco' | 'cidade' | 'manual' | null
  objetivo: string
  motivoSugestao: string | null
  clienteId: number | null
  quantidadePrevista: number | null
  temVisita?: boolean
}

let seq = 0
const novaChave = () => `n${Date.now()}_${seq++}`

function hojeBr(): string {
  return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10)
}

export default function AbaRoteiro({ vendedorId, nomeVendedor, onVoltar, dataInicial }: { vendedorId?: number; nomeVendedor?: string; onVoltar?: () => void; dataInicial?: string }) {
  const [data, setData] = useState<string>(() => dataInicial ?? hojeBr())
  const [gestorEditando, setGestorEditando] = useState(false)
  const [dataInicialAjustada, setDataInicialAjustada] = useState(false)
  const { data: info, isLoading } = trpc.roteiros.obter.useQuery({ data, vendedorId })

  // Abre no dia certo: depois do meio-dia (ou se hoje não tem roteiro pra
  // fazer), a tarefa é montar o do próximo dia útil.
  useEffect(() => {
    if (!info || dataInicialAjustada || vendedorId) return
    setDataInicialAjustada(true)
    const horaBr = new Date(Date.now() - 3 * 3600000).getUTCHours()
    if (!info.roteiro && (horaBr >= 12 || info.hoje !== data)) setData(info.proximoDiaUtil)
  }, [info, dataInicialAjustada, vendedorId, data])

  if (isLoading || !info) return <p className="text-dark-400 text-sm">Carregando roteiro...</p>

  const r = info.roteiro
  const status = r?.status ?? 'rascunho'
  const passado = data < info.hoje
  const emExecucao = status === 'aprovado'
  const podeEditar = info.ehGestor || (!passado && !emExecucao)

  return (
    <div className="space-y-4">
      {onVoltar && (
        <button onClick={onVoltar} className="text-xs text-dark-400 hover:text-gold-400 claro:text-gold-700">← Voltar para a equipe</button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {nomeVendedor && <span className="font-heading text-lg text-dark-50 mr-2">{nomeVendedor}</span>}
        <EscolhaDia data={data} setData={setData} hoje={info.hoje} proximo={info.proximoDiaUtil} />
        <Badge className={STATUS_ROTEIRO[status].cor}>{r ? STATUS_ROTEIRO[status].label : 'Sem roteiro'}</Badge>
        {r?.status === 'aprovado' && r.aprovacaoAutomatica && <span className="text-[11px] text-dark-500">(aprovado automaticamente)</span>}
      </div>

      <AvisoTrava info={info} data={data} />
      <Casa vendedorId={vendedorId} casa={info.casa} />

      {r?.status === 'devolvido' && r.comentarioGestor && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 claro:text-red-700">
          <b>O gestor devolveu o roteiro:</b> {r.comentarioGestor}
          <div className="text-xs text-red-300/80 claro:text-red-700 mt-1">Ajuste e envie de novo.</div>
        </div>
      )}
      {info.ehGestor && r?.status === 'enviado' && <DecisaoGestor roteiroId={r.id} />}

      {info.ehGestor && emExecucao && (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setGestorEditando((x) => !x)}>{gestorEditando ? 'Voltar ao acompanhamento' : 'Editar roteiro aprovado'}</Button>
        </div>
      )}
      {emExecucao && (!info.ehGestor || !gestorEditando) ? (
        <Execucao info={info} data={data} somenteLeitura={info.ehGestor} />
      ) : podeEditar ? (
        <Editor info={info} data={data} vendedorId={vendedorId} />
      ) : (
        <Execucao info={info} data={data} somenteLeitura />
      )}
    </div>
  )
}

function EscolhaDia({ data, setData, hoje, proximo }: { data: string; setData: (d: string) => void; hoje: string; proximo: string }) {
  const chip = (d: string, rotulo: string) => (
    <button
      onClick={() => setData(d)}
      className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${data === d ? 'border-gold-500 bg-gold-500/10 text-gold-300 claro:text-gold-700 font-medium' : 'border-dark-600 text-dark-300 hover:border-dark-400'}`}
    >
      {rotulo} <span className="text-dark-500">{dataBr(d).slice(0, 5)}</span>
    </button>
  )
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {chip(hoje, 'Hoje')}
      {chip(proximo, proximo === hoje ? 'Próximo' : `${diaSemana(proximo).split('-')[0].replace(/^./, (c) => c.toUpperCase())}`)}
      <input type="date" value={data} onChange={(e) => e.target.value && setData(e.target.value)} className="rounded-lg border border-dark-600 bg-transparent px-2 py-1 text-xs text-dark-200" />
    </div>
  )
}

type Saidas = inferRouterOutputs<AppRouter>['roteiros']
type Info = Saidas['obter']

function AvisoTrava({ info, data }: { info: Info; data: string }) {
  const r = info.roteiro
  if (!info.travaAtiva) {
    return (
      <div className="rounded-xl border border-dark-600 bg-dark-800/60 px-4 py-2.5 text-xs text-dark-400 flex items-center gap-2">
        <CircleHelp size={14} className="shrink-0" />
        Trava ainda desligada pelo gestor: por enquanto as visitas também podem ser registradas pelo jeito antigo.
      </div>
    )
  }
  if (data === info.hoje && r?.status !== 'aprovado') {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 claro:text-red-700 flex items-start gap-2">
        <Lock size={16} className="shrink-0 mt-0.5" />
        <div>
          <b>Sem roteiro aprovado para hoje.</b> Enquanto o roteiro não for aprovado, não dá para registrar visitas.
          {r?.status === 'enviado' ? ' Ele já foi enviado: aguarde o gestor.' : ' Monte e envie o roteiro abaixo.'}
        </div>
      </div>
    )
  }
  if (info.prazoEnvio && r?.status !== 'aprovado' && r?.status !== 'enviado') {
    const prazoBr = new Date(info.prazoEnvio.replace(' ', 'T') + 'Z')
    const atrasado = Date.now() > prazoBr.getTime()
    return (
      <div className={`rounded-xl border px-4 py-2.5 text-sm flex items-center gap-2 ${atrasado ? 'border-red-500/40 bg-red-500/10 text-red-200 claro:text-red-700' : 'border-amber-500/40 bg-amber-500/10 text-amber-200 claro:text-amber-700'}`}>
        <Clock size={15} className="shrink-0" />
        {atrasado ? 'Prazo de envio passou' : 'Envie até'} {prazoBr.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
        {atrasado && ' — envie assim mesmo, o gestor foi avisado.'}
      </div>
    )
  }
  return null
}

function Casa({ vendedorId, casa }: { vendedorId?: number; casa: Info['casa'] }) {
  const utils = trpc.useUtils()
  const [editando, setEditando] = useState(false)
  const [endereco, setEndereco] = useState('')
  const [gps, setGps] = useState(false)
  const salvar = trpc.roteiros.salvarCasa.useMutation({
    onSuccess: () => { toast.success('Ponto de partida salvo'); setEditando(false); utils.roteiros.obter.invalidate() },
    onError: (e) => toast.error(e.message),
  })
  async function usarGps() {
    setGps(true)
    const p = await obterGps()
    setGps(false)
    if (!p) return toast.error('Não consegui pegar sua localização. Ative o GPS ou digite o endereço.')
    salvar.mutate({ vendedorId, lat: p.lat, lng: p.lng, endereco: endereco || undefined })
  }
  if (casa.ponto && !editando) {
    return (
      <div className="flex items-center gap-2 text-xs text-dark-400">
        <Home size={14} className="text-dark-300" /> Saída e volta: <span className="text-dark-200">{casa.endereco}</span>
        <button onClick={() => { setEndereco(casa.endereco ?? ''); setEditando(true) }} className="underline decoration-dotted hover:text-gold-400 claro:text-gold-700">alterar</button>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-gold-500/40 bg-gold-500/10 p-4 space-y-3">
      <div className="text-sm text-dark-100 font-medium flex items-center gap-2"><Home size={16} /> Ponto de partida (sua casa)</div>
      <p className="text-xs text-dark-400">O roteiro sai daqui e volta para cá. Só você e o gestor veem esse endereço.</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1"><Input placeholder="Rua, número, bairro, cidade" value={endereco} onChange={(e) => setEndereco(e.target.value)} /></div>
        <Button size="sm" loading={salvar.isPending && !gps} disabled={!endereco.trim()} onClick={() => salvar.mutate({ vendedorId, endereco })}>Salvar endereço</Button>
        {!vendedorId && (
          <Button size="sm" variant="secondary" loading={gps} onClick={usarGps}><MapPin size={13} className="mr-1" /> Estou em casa agora</Button>
        )}
        {editando && <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>Cancelar</Button>}
      </div>
    </div>
  )
}

function DecisaoGestor({ roteiroId }: { roteiroId: number }) {
  const utils = trpc.useUtils()
  const [devolvendo, setDevolvendo] = useState(false)
  const [comentario, setComentario] = useState('')
  const inv = () => { utils.roteiros.obter.invalidate(); utils.roteiros.painelEquipe.invalidate() }
  const aprovar = trpc.roteiros.aprovar.useMutation({ onSuccess: () => { toast.success('Roteiro aprovado'); inv() }, onError: (e) => toast.error(e.message) })
  const devolver = trpc.roteiros.devolver.useMutation({ onSuccess: () => { toast.success('Roteiro devolvido'); setDevolvendo(false); inv() }, onError: (e) => toast.error(e.message) })
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex flex-wrap items-center gap-2">
      <span className="text-sm text-amber-200 claro:text-amber-700 flex-1 min-w-[200px]">Este roteiro está esperando sua aprovação.</span>
      <Button size="sm" loading={aprovar.isPending} onClick={() => aprovar.mutate({ roteiroId })}><ThumbsUp size={13} className="mr-1" /> Aprovar</Button>
      <Button size="sm" variant="secondary" onClick={() => setDevolvendo(true)}><Undo2 size={13} className="mr-1" /> Devolver com comentário</Button>
      <Modal open={devolvendo} onClose={() => setDevolvendo(false)} title="Devolver roteiro" size="sm">
        <div className="p-5 space-y-3">
          <Input label="O que o vendedor precisa ajustar?" value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Ex.: inclua o cliente X, que está com proposta parada" />
          <Button className="w-full" loading={devolver.isPending} disabled={comentario.trim().length < 3} onClick={() => devolver.mutate({ roteiroId, comentario })}>Devolver</Button>
        </div>
      </Modal>
    </div>
  )
}

// ── Montar o roteiro ──────────────────────────────────────────────────────
function Editor({ info, data, vendedorId }: { info: Info; data: string; vendedorId?: number }) {
  const utils = trpc.useUtils()
  const r = info.roteiro
  const [horaSaida, setHoraSaida] = useState(r?.horaSaida ?? '08:00')
  const [paradas, setParadas] = useState<ParadaLocal[]>([])
  const [sujo, setSujo] = useState(false)
  const [estimativa, setEstimativa] = useState<{ chegadas: (string | null)[]; kmTotal: number; horaVolta: string | null } | null>(null)
  const [modal, setModal] = useState<null | 'novo' | 'prospeccao'>(null)
  const carregadoDe = useRef<string>('')

  // Carrega do servidor quando muda o dia/roteiro (sem atropelar edição).
  useEffect(() => {
    const chave = `${data}|${r?.id ?? 'novo'}|${r?.status ?? ''}`
    if (carregadoDe.current === chave) return
    carregadoDe.current = chave
    setHoraSaida(r?.horaSaida ?? '08:00')
    setParadas(
      (r?.paradas ?? []).filter((p) => !p.extra).map((p) => ({
        chave: `id${p.id}`, id: p.id, tipo: p.tipo, nome: p.nome, endereco: p.endereco, cidade: p.cidade, lat: p.lat, lng: p.lng,
        localizacaoFonte: p.localizacaoFonte, objetivo: p.objetivo, motivoSugestao: p.motivoSugestao, clienteId: p.clienteId,
        quantidadePrevista: p.quantidadePrevista, temVisita: p.visitas.length > 0,
      })),
    )
    setSujo(false)
  }, [data, r])

  const calcular = trpc.roteiros.calcular.useMutation()
  const assinatura = paradas.map((p) => `${p.chave}:${p.lat}:${p.lng}:${p.tipo}:${p.quantidadePrevista}`).join('|') + horaSaida + (info.casa.ponto ? '1' : '0')
  useEffect(() => {
    if (!paradas.length) return setEstimativa(null)
    const t = setTimeout(() => {
      calcular.mutate(
        { vendedorId, horaSaida, otimizar: false, paradas: paradas.map((p) => ({ chave: p.chave, lat: p.lat, lng: p.lng, tipo: p.tipo, quantidadePrevista: p.quantidadePrevista })) },
        { onSuccess: (e) => setEstimativa(e) },
      )
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura])

  function mudar(lista: ParadaLocal[]) { setParadas(lista); setSujo(true) }
  function organizar() {
    calcular.mutate(
      { vendedorId, horaSaida, otimizar: true, paradas: paradas.map((p) => ({ chave: p.chave, lat: p.lat, lng: p.lng, tipo: p.tipo, quantidadePrevista: p.quantidadePrevista })) },
      {
        onSuccess: (e) => {
          const porChave = new Map(paradas.map((p) => [p.chave, p]))
          mudar(e.ordem.map((c) => porChave.get(c)!).filter(Boolean))
          setEstimativa(e)
          toast.success(`Caminho organizado: ~${e.kmTotal.toLocaleString('pt-BR')} km`)
        },
        onError: (er) => toast.error(er.message),
      },
    )
  }

  const localizar = trpc.roteiros.localizar.useMutation()
  async function adicionar(p: Omit<ParadaLocal, 'chave'>) {
    const nome = p.nome.trim().toLowerCase()
    if (p.tipo === 'cliente' && paradas.some((x) => x.tipo === 'cliente' && x.nome.trim().toLowerCase() === nome)) return toast('Essa empresa já está no roteiro', { icon: 'ℹ️' })
    const chave = novaChave()
    const nova: ParadaLocal = { ...p, chave }
    mudar([...paradas, nova])
    if (nova.lat == null) {
      const loc = await localizar.mutateAsync({ nome: p.tipo === 'cliente' ? p.nome : undefined, endereco: p.endereco, cidade: p.cidade }).catch(() => null)
      setParadas((lista) => lista.map((x) => (x.chave === chave ? { ...x, lat: loc?.lat ?? null, lng: loc?.lng ?? null, localizacaoFonte: loc?.fonte ?? null } : x)))
      if (!loc) toast('Não achei esse endereço no mapa. A parada fica no roteiro, mas fora do cálculo do caminho.', { icon: '⚠️', duration: 6000 })
    }
  }
  async function tentarLocalizar(p: ParadaLocal) {
    const loc = await localizar.mutateAsync({ nome: p.tipo === 'cliente' ? p.nome : undefined, endereco: p.endereco, cidade: p.cidade }).catch(() => null)
    if (!loc) return toast.error('Ainda não achei no mapa. Corrija o endereço (rua, número, cidade).')
    mudar(paradas.map((x) => (x.chave === p.chave ? { ...x, lat: loc.lat, lng: loc.lng, localizacaoFonte: loc.fonte } : x)))
  }

  const salvar = trpc.roteiros.salvar.useMutation()
  const enviar = trpc.roteiros.enviar.useMutation()
  async function gravar(eEnviar: boolean) {
    try {
      await salvar.mutateAsync({
        data, vendedorId, horaSaida,
        paradas: paradas.map((p) => ({ id: p.id, tipo: p.tipo, nome: p.nome, endereco: p.endereco, cidade: p.cidade, lat: p.lat, lng: p.lng, localizacaoFonte: p.localizacaoFonte, objetivo: p.objetivo, motivoSugestao: p.motivoSugestao, clienteId: p.clienteId, quantidadePrevista: p.quantidadePrevista })),
      })
      if (eEnviar) await enviar.mutateAsync({ data, vendedorId })
      toast.success(eEnviar ? 'Roteiro enviado para aprovação' : 'Roteiro salvo')
      setSujo(false)
      carregadoDe.current = ''
      utils.roteiros.obter.invalidate()
      utils.roteiros.painelEquipe.invalidate()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const faltaObjetivo = paradas.some((p) => !p.objetivo.trim())
  const semLocal = paradas.filter((p) => p.lat == null).length
  const pontosMapa: ParadaMapa[] = paradas.flatMap((p, i) => (p.lat != null && p.lng != null ? [{ lat: p.lat, lng: p.lng, numero: i + 1, nome: p.nome }] : []))
  const chavesNoRoteiro = new Set(paradas.map((p) => p.nome.trim().toLowerCase()))

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4 min-w-0">
        <MapaRoteiro casa={info.casa.ponto} paradas={pontosMapa} />

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dark-600 bg-dark-800 px-4 py-3 text-sm">
          <label className="flex items-center gap-2 text-dark-300 text-xs">
            Saída de casa
            <input type="time" value={horaSaida} onChange={(e) => { setHoraSaida(e.target.value); setSujo(true) }} className="rounded-md border border-dark-600 bg-transparent px-2 py-1 text-dark-100" />
          </label>
          <span className="text-dark-400 text-xs"><b className="text-dark-100 text-base">{paradas.length}</b> paradas</span>
          <span className="text-dark-400 text-xs"><b className="text-dark-100 text-base">~{(estimativa?.kmTotal ?? 0).toLocaleString('pt-BR')}</b> km</span>
          {estimativa?.horaVolta && <span className="text-dark-400 text-xs">volta ~<b className="text-dark-100">{estimativa.horaVolta}</b></span>}
          <Button size="sm" variant="secondary" className="ml-auto" disabled={paradas.length < 2} loading={calcular.isPending} onClick={organizar}>
            <Route size={13} className="mr-1" /> Organizar melhor caminho
          </Button>
        </div>
        <p className="text-[11px] text-dark-500 -mt-2">Km e horários são estimativas (distância em linha reta + 30%, 35 km/h, 40 min por visita).</p>

        <div className="space-y-2">
          {paradas.map((p, i) => (
            <LinhaParada
              key={p.chave}
              p={p}
              numero={i + 1}
              hora={estimativa?.chegadas[i] ?? null}
              primeiro={i === 0}
              ultimo={i === paradas.length - 1}
              onMudar={(campos) => mudar(paradas.map((x) => (x.chave === p.chave ? { ...x, ...campos } : x)))}
              onMover={(d) => {
                const l = [...paradas]
                const [it] = l.splice(i, 1)
                l.splice(i + d, 0, it)
                mudar(l)
              }}
              onRemover={() => mudar(paradas.filter((x) => x.chave !== p.chave))}
              onLocalizar={() => tentarLocalizar(p)}
            />
          ))}
          {!paradas.length && (
            <div className="rounded-xl border border-dashed border-dark-600 p-6 text-center text-sm text-dark-400">
              Roteiro vazio. Use as <b>sugestões</b> ao lado, busque uma empresa ou adicione um lugar novo.
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => setModal('novo')}><Plus size={13} className="mr-1" /> Empresa / lugar novo</Button>
            <Button size="sm" variant="secondary" onClick={() => setModal('prospeccao')}><Building2 size={13} className="mr-1" /> Área de prospecção</Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-dark-700 pt-4">
          {faltaObjetivo && <span className="text-xs text-red-300 claro:text-red-700 flex items-center gap-1"><AlertTriangle size={13} /> Toda parada precisa de objetivo</span>}
          {!faltaObjetivo && semLocal > 0 && <span className="text-xs text-amber-300 claro:text-amber-700 flex items-center gap-1"><MapPinOff size={13} /> {semLocal} parada(s) sem local no mapa</span>}
          {!info.casa.ponto && <span className="text-xs text-red-300 claro:text-red-700">Cadastre o ponto de partida (casa) acima</span>}
          <div className="ml-auto flex gap-2">
            {!(info.ehGestor && r) && <Button size="sm" variant="secondary" disabled={!sujo} loading={salvar.isPending && !enviar.isPending} onClick={() => gravar(false)}><Save size={13} className="mr-1" /> Salvar rascunho</Button>}
            {(!info.ehGestor || !r) && (
              <Button size="sm" disabled={!paradas.length || faltaObjetivo || !info.casa.ponto} loading={enviar.isPending} onClick={() => gravar(true)}>
                <Send size={13} className="mr-1" /> {r?.status === 'enviado' && !sujo ? 'Reenviar' : 'Enviar para aprovação'}
              </Button>
            )}
            {info.ehGestor && r && (
              <Button size="sm" disabled={!sujo} loading={salvar.isPending} onClick={() => gravar(false)}><Save size={13} className="mr-1" /> Salvar alterações{r.status === 'aprovado' ? ' (continua aprovado)' : ''}</Button>
            )}
          </div>
        </div>
        {info.config.minParadas > 0 && <p className="text-[11px] text-dark-500">Mínimo exigido pelo gestor: {info.config.minParadas} paradas.</p>}
      </div>

      <div className="space-y-4">
        <Busca onAdicionar={(l) => adicionar({ tipo: 'cliente', nome: l.nome, endereco: l.endereco, cidade: l.cidade, lat: l.lat, lng: l.lng, localizacaoFonte: l.lat != null ? 'gps_visita' : null, objetivo: '', motivoSugestao: null, clienteId: l.clienteId, quantidadePrevista: null })} />
        <Sugestoes data={data} vendedorId={vendedorId} jaNoRoteiro={chavesNoRoteiro} onAdicionar={(s) => adicionar({ tipo: 'cliente', nome: s.nome, endereco: s.endereco, cidade: s.cidade, lat: s.lat ?? null, lng: s.lng ?? null, localizacaoFonte: s.lat != null ? 'gps_visita' : null, objetivo: s.objetivo, motivoSugestao: s.motivo, clienteId: s.clienteId, quantidadePrevista: null })} />
      </div>

      <ModalNovoLugar
        aberto={modal}
        onFechar={() => setModal(null)}
        onSalvar={(p) => { adicionar(p); setModal(null) }}
      />
    </div>
  )
}

function LinhaParada({ p, numero, hora, primeiro, ultimo, onMudar, onMover, onRemover, onLocalizar }: {
  p: ParadaLocal; numero: number; hora: string | null; primeiro: boolean; ultimo: boolean
  onMudar: (c: Partial<ParadaLocal>) => void; onMover: (d: -1 | 1) => void; onRemover: () => void; onLocalizar: () => void
}) {
  const objetivoLivre = p.objetivo && !OBJETIVOS_ROTEIRO.includes(p.objetivo)
  return (
    <div className={`rounded-xl border bg-dark-800 p-3 ${!p.objetivo.trim() ? 'border-red-500/40' : 'border-dark-600'}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white ${p.tipo === 'prospeccao' ? 'bg-sky-600' : 'bg-gold-600'}`}>{numero}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-dark-100 text-sm truncate">{p.nome}</span>
            {p.tipo === 'prospeccao' && <Badge className="text-sky-300 claro:text-sky-700 bg-sky-500/10 border-sky-500/40">Área de prospecção · {p.quantidadePrevista ?? 4} empresas</Badge>}
            {hora && <span className="text-[11px] text-dark-400 flex items-center gap-1"><Clock size={11} /> ~{hora}</span>}
          </div>
          {(p.endereco || p.cidade) && <div className="text-xs text-dark-500 truncate">{[p.endereco, p.cidade].filter(Boolean).join(' · ')}</div>}
          {p.motivoSugestao && <div className="text-[11px] text-gold-400 claro:text-gold-700/90 mt-0.5">{p.motivoSugestao}</div>}
          <div className="mt-1 text-[11px]">
            {p.lat != null ? (
              <span className={p.localizacaoFonte === 'cidade' ? 'text-amber-400 claro:text-amber-700' : 'text-dark-500'}>{FONTE_LOCALIZACAO[p.localizacaoFonte ?? 'endereco']}</span>
            ) : (
              <span className="text-amber-400 claro:text-amber-700">Sem local no mapa · <button onClick={onLocalizar} className="underline decoration-dotted">tentar de novo</button></span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 items-center">
            <select
              value={objetivoLivre ? '__outro' : p.objetivo}
              onChange={(e) => onMudar({ objetivo: e.target.value === '__outro' ? ' ' : e.target.value })}
              className="rounded-lg border border-dark-600 bg-dark-900 px-2 py-1.5 text-xs text-dark-100"
            >
              <option value="">Objetivo da visita (obrigatório)...</option>
              {OBJETIVOS_ROTEIRO.map((o) => <option key={o} value={o}>{o}</option>)}
              <option value="__outro">Outro (escrever)</option>
            </select>
            {objetivoLivre && <input autoFocus value={p.objetivo.trimStart()} onChange={(e) => onMudar({ objetivo: e.target.value || ' ' })} placeholder="Escreva o objetivo" className="flex-1 min-w-[160px] rounded-lg border border-dark-600 bg-dark-900 px-2 py-1.5 text-xs text-dark-100" />}
            {p.tipo === 'prospeccao' && (
              <label className="text-xs text-dark-400 flex items-center gap-1">
                Empresas previstas
                <input type="number" min={1} max={50} value={p.quantidadePrevista ?? 4} onChange={(e) => onMudar({ quantidadePrevista: Math.max(1, Number(e.target.value) || 1) })} className="w-14 rounded-md border border-dark-600 bg-dark-900 px-1.5 py-1 text-dark-100" />
              </label>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-0.5 shrink-0">
          <button disabled={primeiro} onClick={() => onMover(-1)} className="p-1 rounded text-dark-400 hover:text-gold-400 claro:text-gold-700 disabled:opacity-30" title="Subir"><ArrowUp size={14} /></button>
          <button disabled={ultimo} onClick={() => onMover(1)} className="p-1 rounded text-dark-400 hover:text-gold-400 claro:text-gold-700 disabled:opacity-30" title="Descer"><ArrowDown size={14} /></button>
          {!p.temVisita && <button onClick={onRemover} className="p-1 rounded text-dark-400 hover:text-red-400 claro:text-red-700" title="Tirar do roteiro"><Trash2 size={14} /></button>}
        </div>
      </div>
    </div>
  )
}

function Busca({ onAdicionar }: { onAdicionar: (l: { nome: string; endereco: string | null; cidade: string | null; lat: number | null; lng: number | null; clienteId: number | null }) => void }) {
  const [q, setQ] = useState('')
  const [termo, setTermo] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTermo(q.trim()), 350)
    return () => clearTimeout(t)
  }, [q])
  const { data, isFetching } = trpc.roteiros.buscarLugares.useQuery({ q: termo }, { enabled: termo.length >= 2 })
  return (
    <div className="rounded-xl border border-dark-600 bg-dark-800 p-3">
      <Input icon={<Search size={14} />} placeholder="Buscar empresa (carteira ou já visitada)" value={q} onChange={(e) => setQ(e.target.value)} />
      {termo.length >= 2 && (
        <div className="mt-2 max-h-64 overflow-y-auto space-y-1">
          {isFetching && <p className="text-xs text-dark-500 px-1">Buscando...</p>}
          {(data ?? []).map((l, i) => (
            <button key={i} onClick={() => { onAdicionar(l); setQ('') }} className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-dark-700 flex items-start gap-2">
              <Plus size={13} className="mt-0.5 text-gold-400 claro:text-gold-700 shrink-0" />
              <span className="min-w-0">
                <span className="block text-xs text-dark-100 truncate">{l.nome}</span>
                <span className="block text-[11px] text-dark-500 truncate">{l.origem}{l.endereco ? ` · ${l.endereco}` : ''}{l.lat != null ? ' · 📍' : ''}</span>
              </span>
            </button>
          ))}
          {!isFetching && data && !data.length && <p className="text-xs text-dark-500 px-1">Nada encontrado. Use "Empresa / lugar novo".</p>}
        </div>
      )}
    </div>
  )
}

function Sugestoes({ data, vendedorId, jaNoRoteiro, onAdicionar }: { data: string; vendedorId?: number; jaNoRoteiro: Set<string>; onAdicionar: (s: Saidas['sugestoes'][number]) => void }) {
  const { data: sugs, isLoading } = trpc.roteiros.sugestoes.useQuery({ data, vendedorId })
  const lista = (sugs ?? []).filter((s) => !jaNoRoteiro.has(s.nome.trim().toLowerCase()))
  return (
    <div className="rounded-xl border border-dark-600 bg-dark-800 p-3">
      <div className="text-xs font-medium text-dark-200 flex items-center gap-1.5 mb-2"><Sparkles size={13} className="text-gold-400 claro:text-gold-700" /> Sugestões para {dataBr(data).slice(0, 5)}</div>
      {isLoading && <p className="text-xs text-dark-500">Carregando...</p>}
      <div className="space-y-1 max-h-[420px] overflow-y-auto">
        {lista.map((s) => (
          <button key={s.chave} onClick={() => onAdicionar(s)} className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-dark-700 flex items-start gap-2">
            <Plus size={13} className="mt-0.5 text-gold-400 claro:text-gold-700 shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs text-dark-100 truncate">{s.nome}</span>
              <span className="block text-[11px] text-dark-400">{s.motivo}{s.lat != null ? ' · 📍' : ''}</span>
            </span>
          </button>
        ))}
        {!isLoading && !lista.length && <p className="text-xs text-dark-500">Nenhuma sugestão para esse dia (retornos, propostas paradas, compromissos e clientes que pararam de comprar aparecem aqui).</p>}
      </div>
    </div>
  )
}

function ModalNovoLugar({ aberto, onFechar, onSalvar }: { aberto: null | 'novo' | 'prospeccao'; onFechar: () => void; onSalvar: (p: Omit<ParadaLocal, 'chave'>) => void }) {
  const [f, setF] = useState({ nome: '', endereco: '', cidade: '', objetivo: '', quantidade: 4 })
  useEffect(() => { if (aberto) setF({ nome: '', endereco: '', cidade: '', objetivo: aberto === 'prospeccao' ? 'Prospecção de clientes' : '', quantidade: 4 }) }, [aberto])
  const prosp = aberto === 'prospeccao'
  const ok = f.nome.trim() && (prosp ? f.cidade.trim() : f.endereco.trim() || f.cidade.trim()) && f.objetivo.trim()
  return (
    <Modal open={!!aberto} onClose={onFechar} title={prosp ? 'Área de prospecção' : 'Empresa / lugar novo'} size="md">
      <div className="p-5 space-y-3">
        {prosp && <p className="text-xs text-dark-400">Use para bater de porta em porta numa região. Cada empresa que você visitar lá vira uma visita desta parada.</p>}
        <Input label={prosp ? 'Bairro / distrito industrial' : 'Nome da empresa'} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder={prosp ? 'Ex.: Distrito Industrial Norte' : ''} />
        {!prosp && <Input label="Endereço (rua, número, bairro)" value={f.endereco} onChange={(e) => setF({ ...f, endereco: e.target.value })} />}
        <Input label="Cidade" value={f.cidade} onChange={(e) => setF({ ...f, cidade: e.target.value })} placeholder="Ex.: Joinville - SC" />
        <Select label="Objetivo" value={f.objetivo} onChange={(e) => setF({ ...f, objetivo: e.target.value })} placeholder="Selecione..." options={OBJETIVOS_ROTEIRO.map((o) => ({ value: o, label: o }))} />
        {prosp && <Input label="Quantas empresas pretende visitar lá?" type="number" min={1} max={50} value={String(f.quantidade)} onChange={(e) => setF({ ...f, quantidade: Math.max(1, Number(e.target.value) || 1) })} />}
        <Button
          className="w-full"
          disabled={!ok}
          onClick={() =>
            onSalvar({
              tipo: prosp ? 'prospeccao' : 'cliente',
              nome: f.nome.trim(),
              endereco: prosp ? f.nome.trim() : f.endereco.trim() || null,
              cidade: f.cidade.trim() || null,
              lat: null, lng: null, localizacaoFonte: null,
              objetivo: f.objetivo,
              motivoSugestao: null,
              clienteId: null,
              quantidadePrevista: prosp ? f.quantidade : null,
            })
          }
        >
          Adicionar ao roteiro
        </Button>
      </div>
    </Modal>
  )
}

// ── No dia: seguir o roteiro aprovado ────────────────────────────────────
function Execucao({ info, data, somenteLeitura }: { info: Info; data: string; somenteLeitura?: boolean }) {
  const utils = trpc.useUtils()
  const r = info.roteiro
  const ehHoje = data === info.hoje
  const ativo = !somenteLeitura && ehHoje && r?.status === 'aprovado' && !info.ehGestor
  const [eu, setEu] = useState<{ lat: number; lng: number } | null>(null)
  const [chegando, setChegando] = useState<number | null>(null)
  const [prospModal, setProspModal] = useState<number | null>(null)
  const [finalizando, setFinalizando] = useState<{ visitaId: number; nome: string } | null>(null)
  const [pulando, setPulando] = useState<number | null>(null)
  const [extra, setExtra] = useState(false)
  const inv = () => { utils.roteiros.obter.invalidate(); utils.visitas.listar.invalidate(); utils.visitas.resumo.invalidate() }

  const chegar = trpc.roteiros.chegar.useMutation()
  async function registrarChegada(paradaId: number, extras?: { nomeEmpresa?: string; pessoaContato?: string; telefoneContato?: string }) {
    setChegando(paradaId)
    const gps = await obterGps()
    if (gps) setEu(gps)
    try {
      const res = await chegar.mutateAsync({ paradaId, ...(gps ?? {}), ...extras })
      if (!gps) toast('Chegada registrada, mas sem GPS (sinal fraco).', { icon: '⚠️' })
      else if (res.distanciaM != null && res.distanciaM > 300) toast(`Chegada registrada. Atenção: você está a ${(res.distanciaM / 1000).toFixed(1)} km do ponto da parada.`, { icon: '📍', duration: 6000 })
      else toast.success('Chegada registrada')
      setProspModal(null)
      inv()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setChegando(null)
    }
  }

  if (!r) return <p className="text-sm text-dark-500">Nenhum roteiro para {dataBr(data)}.</p>
  const paradas = r.paradas
  const pontos: ParadaMapa[] = paradas.flatMap((p, i) =>
    p.lat != null && p.lng != null ? [{ lat: p.lat, lng: p.lng, numero: i + 1, nome: p.nome, status: p.extra && p.extraStatus !== 'aprovada' ? 'extra' : p.status }] : [],
  )
  const pendentesComPonto = paradas.filter((p) => p.status === 'pendente' && p.lat != null && p.lng != null && (!p.extra || p.extraStatus === 'aprovada')) as ({ lat: number; lng: number })[]
  const links = linksGoogleMaps(eu ?? info.casa.ponto, pendentesComPonto)
  const feitas = paradas.filter((p) => p.status === 'visitada').length
  const emAndamento = paradas.flatMap((p) => p.visitas.filter((v) => v.checkinEm && !v.checkoutEm).map((v) => ({ v, p })))[0]

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3 min-w-0">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dark-600 bg-dark-800 px-4 py-3 text-sm">
          <span className="text-dark-300 text-xs"><b className="text-dark-50 text-lg">{feitas}</b> de {paradas.filter((p) => !p.extra || p.extraStatus === 'aprovada').length} paradas feitas</span>
          <span className="text-dark-400 text-xs">~{(r.kmPrevisto ?? info.estimativa.kmTotal).toLocaleString('pt-BR')} km previstos · saída {r.horaSaida}</span>
          {ativo && links.length > 0 && (
            <div className="ml-auto flex flex-wrap gap-2">
              {links.map((l, i) => (
                <a key={i} href={l} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-gold-600 hover:bg-gold-500 px-3 py-1.5 text-xs font-medium text-white">
                  <Navigation size={13} /> {links.length > 1 ? `Rota no Google Maps (parte ${i + 1})` : 'Abrir rota no Google Maps'}
                </a>
              ))}
            </div>
          )}
        </div>

        {emAndamento && ativo && (
          <div className="rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3 flex flex-wrap items-center gap-2 text-sm text-green-200 claro:text-green-700">
            Você está em <b>{emAndamento.v.nomeEmpresa ?? emAndamento.p.nome}</b> desde {horaBrDeUtc(emAndamento.v.checkinEm)}.
            <Button size="sm" className="ml-auto" onClick={() => setFinalizando({ visitaId: emAndamento.v.id, nome: emAndamento.v.nomeEmpresa ?? emAndamento.p.nome })}><CheckCircle2 size={13} className="mr-1" /> Finalizar visita</Button>
          </div>
        )}

        {paradas.map((p, i) => {
          const liberada = !p.extra || p.extraStatus === 'aprovada'
          const andamento = p.visitas.find((v) => v.checkinEm && !v.checkoutEm)
          return (
            <div key={p.id} className={`rounded-xl border p-3 ${p.status === 'visitada' ? 'border-green-500/40 bg-green-500/10' : p.status === 'pulada' ? 'border-dark-700 bg-dark-900/40 opacity-70' : 'border-dark-600 bg-dark-800'}`}>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white ${p.status === 'visitada' ? 'bg-green-600' : p.status === 'pulada' ? 'bg-dark-500' : p.extra ? 'bg-violet-600' : p.tipo === 'prospeccao' ? 'bg-sky-600' : 'bg-gold-600'}`}>
                  {p.status === 'visitada' ? '✓' : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-dark-100 text-sm">{p.nome}</span>
                    {p.tipo === 'prospeccao' && <Badge className="text-sky-300 claro:text-sky-700 bg-sky-500/10 border-sky-500/40">Prospecção · {p.visitas.length}/{p.quantidadePrevista ?? '?'} empresas</Badge>}
                    {p.extra && <Badge className={p.extraStatus === 'aprovada' ? 'text-violet-300 claro:text-violet-700 bg-violet-500/10 border-violet-500/40' : 'text-amber-300 claro:text-amber-700 bg-amber-500/10 border-amber-500/40'}>{p.extraStatus === 'aprovada' ? 'Extra liberada' : 'Extra: aguardando gestor'}</Badge>}
                    {p.horaPrevista && p.status === 'pendente' && <span className="text-[11px] text-dark-400">~{p.horaPrevista}</span>}
                  </div>
                  <div className="text-xs text-dark-400 mt-0.5"><b className="text-dark-300">Objetivo:</b> {p.objetivo}</div>
                  {p.endereco && p.tipo === 'cliente' && <div className="text-xs text-dark-500 truncate">{p.endereco}{p.cidade ? ` · ${p.cidade}` : ''}</div>}
                  {p.extra && p.extraJustificativa && <div className="text-[11px] text-dark-500">Motivo da extra: {p.extraJustificativa}</div>}
                  {p.status === 'pulada' && <div className="text-xs text-dark-400 mt-0.5">Pulada: {p.motivoPulo}</div>}
                  {p.visitas.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {p.visitas.map((v) => (
                        <li key={v.id} className="text-[11px] text-dark-400 flex flex-wrap gap-x-2">
                          {p.tipo === 'prospeccao' && <span className="text-dark-200">{v.nomeEmpresa}</span>}
                          <span>{horaBrDeUtc(v.checkinEm)}{v.checkoutEm ? `–${horaBrDeUtc(v.checkoutEm)}` : ' (em andamento)'}</span>
                          {v.resultado && <span className="text-dark-300">{RESULTADOS_VISITA.find((x) => x.value === v.resultado)?.label}</span>}
                          {v.latCheckin == null && <span className="text-amber-400 claro:text-amber-700">sem GPS</span>}
                          {(v.distanciaParadaM ?? 0) > 300 && <span className="text-amber-400 claro:text-amber-700">a {((v.distanciaParadaM ?? 0) / 1000).toFixed(1)} km do ponto</span>}
                          {ativo && !v.checkoutEm && <button onClick={() => setFinalizando({ visitaId: v.id, nome: v.nomeEmpresa ?? p.nome })} className="text-green-400 claro:text-green-700 underline">finalizar</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {ativo && liberada && p.status !== 'pulada' && !andamento && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {p.tipo === 'cliente' && p.status === 'pendente' && (
                        <Button size="sm" loading={chegando === p.id} disabled={!!emAndamento} onClick={() => registrarChegada(p.id)}><LogIn size={13} className="mr-1" /> Cheguei</Button>
                      )}
                      {p.tipo === 'prospeccao' && (
                        <Button size="sm" disabled={!!emAndamento} onClick={() => setProspModal(p.id)}><LogIn size={13} className="mr-1" /> Cheguei numa empresa</Button>
                      )}
                      {p.lat != null && p.lng != null && p.status === 'pendente' && (
                        <>
                          <a href={linkGoogleUmLugar({ lat: p.lat, lng: p.lng })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-dark-600 px-2.5 py-1.5 text-xs text-dark-300 hover:text-gold-400 claro:text-gold-700"><Navigation size={12} /> Maps</a>
                          <a href={linkWaze({ lat: p.lat, lng: p.lng })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-dark-600 px-2.5 py-1.5 text-xs text-dark-300 hover:text-gold-400 claro:text-gold-700"><Navigation size={12} /> Waze</a>
                        </>
                      )}
                      {p.status === 'pendente' && p.visitas.length === 0 && (
                        <button onClick={() => setPulando(p.id)} className="inline-flex items-center gap-1 rounded-lg border border-dark-600 px-2.5 py-1.5 text-xs text-dark-400 hover:text-red-300 claro:text-red-700"><SkipForward size={12} /> Pular</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {ativo && (
          <Button size="sm" variant="secondary" onClick={() => setExtra(true)}><Plus size={13} className="mr-1" /> Pedir visita extra (fora do roteiro)</Button>
        )}
        {r.paradasRecusadas.length > 0 && <p className="text-[11px] text-dark-500">Extras recusadas pelo gestor: {r.paradasRecusadas.map((p) => p.nome).join(', ')}</p>}
      </div>

      <div className="space-y-3 order-first lg:order-none">
        <MapaRoteiro casa={info.casa.ponto} paradas={pontos} eu={eu} altura={360} />
        <p className="text-[11px] text-dark-500">🟡 a fazer · 🟢 feita · ⚪ pulada · 🟣 extra aguardando</p>
      </div>

      <ModalProspeccao aberto={prospModal != null} carregando={chegando != null} onFechar={() => setProspModal(null)} onConfirmar={(d) => prospModal != null && registrarChegada(prospModal, d)} />
      <ModalFinalizar alvo={finalizando} onFechar={() => setFinalizando(null)} onFeito={() => { setFinalizando(null); inv() }} />
      <ModalPular paradaId={pulando} onFechar={() => setPulando(null)} onFeito={() => { setPulando(null); inv() }} />
      <ModalExtra aberto={extra} data={data} onFechar={() => setExtra(false)} onFeito={() => { setExtra(false); inv() }} />
    </div>
  )
}

function ModalProspeccao({ aberto, carregando, onFechar, onConfirmar }: { aberto: boolean; carregando: boolean; onFechar: () => void; onConfirmar: (d: { nomeEmpresa: string; pessoaContato?: string; telefoneContato?: string }) => void }) {
  const [f, setF] = useState({ nomeEmpresa: '', pessoaContato: '', telefoneContato: '' })
  useEffect(() => { if (aberto) setF({ nomeEmpresa: '', pessoaContato: '', telefoneContato: '' }) }, [aberto])
  return (
    <Modal open={aberto} onClose={onFechar} title="Cheguei numa empresa" size="sm">
      <div className="p-5 space-y-3">
        <Input label="Nome da empresa" value={f.nomeEmpresa} onChange={(e) => setF({ ...f, nomeEmpresa: e.target.value })} />
        <Input label="Pessoa de contato (opcional)" value={f.pessoaContato} onChange={(e) => setF({ ...f, pessoaContato: e.target.value })} />
        <Input label="Telefone (opcional)" value={f.telefoneContato} onChange={(e) => setF({ ...f, telefoneContato: e.target.value })} />
        <Button className="w-full" loading={carregando} disabled={!f.nomeEmpresa.trim()} onClick={() => onConfirmar(f)}>Registrar chegada</Button>
      </div>
    </Modal>
  )
}

function ModalFinalizar({ alvo, onFechar, onFeito }: { alvo: { visitaId: number; nome: string } | null; onFechar: () => void; onFeito: () => void }) {
  const vazio = { resultado: '', pessoaContato: '', telefoneContato: '', proximoPasso: '', dataRetorno: '', observacoes: '', propostaItens: '', propostaPagamento: '', propostaComissao: '', propostaRevenda: '' }
  const [f, setF] = useState(vazio)
  useEffect(() => { if (alvo) setF(vazio) }, [alvo]) // eslint-disable-line react-hooks/exhaustive-deps
  const finalizar = trpc.roteiros.finalizar.useMutation({
    onSuccess: (r) => { toast.success(r.propostaId ? `Visita finalizada — Proposta #${r.propostaId} criada!` : 'Visita finalizada'); onFeito() },
    onError: (e) => toast.error(e.message),
  })
  const ok = f.resultado && (f.resultado !== 'follow_up' || f.dataRetorno)
  return (
    <Modal open={!!alvo} onClose={onFechar} title={`Finalizar visita — ${alvo?.nome ?? ''}`} size="md">
      <div className="p-5 space-y-3 max-h-[75vh] overflow-y-auto">
        <div>
          <div className="text-xs text-dark-300 mb-1.5">Como foi a visita? (obrigatório)</div>
          <div className="grid grid-cols-2 gap-2">
            {RESULTADOS_VISITA.map((r) => (
              <button key={r.value} onClick={() => setF({ ...f, resultado: r.value })} className={`rounded-lg border px-3 py-2 text-xs ${f.resultado === r.value ? 'border-gold-500 bg-gold-500/10 text-gold-200 claro:text-gold-700' : 'border-dark-600 text-dark-300'}`}>{r.label}</button>
            ))}
          </div>
        </div>
        {f.resultado === 'gerar_proposta' && (
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-green-500/40 bg-green-500/10">
            <Input label="Produtos/Serviços" value={f.propostaItens} onChange={(e) => setF({ ...f, propostaItens: e.target.value })} className="col-span-2" />
            <Input label="Forma de pagamento" value={f.propostaPagamento} onChange={(e) => setF({ ...f, propostaPagamento: e.target.value })} />
            <Input label="Comissão" value={f.propostaComissao} onChange={(e) => setF({ ...f, propostaComissao: e.target.value })} />
            <Input label="Revenda" value={f.propostaRevenda} onChange={(e) => setF({ ...f, propostaRevenda: e.target.value })} className="col-span-2" />
          </div>
        )}
        {f.resultado === 'follow_up' && <Input label="Data de retorno" type="date" value={f.dataRetorno} onChange={(e) => setF({ ...f, dataRetorno: e.target.value })} />}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Pessoa de contato" value={f.pessoaContato} onChange={(e) => setF({ ...f, pessoaContato: e.target.value })} />
          <Input label="Telefone" value={f.telefoneContato} onChange={(e) => setF({ ...f, telefoneContato: e.target.value })} />
        </div>
        <Input label="Próximo passo" value={f.proximoPasso} onChange={(e) => setF({ ...f, proximoPasso: e.target.value })} />
        <Input label="Observações" value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
        <Button
          className="w-full"
          disabled={!ok}
          loading={finalizar.isPending}
          onClick={() => alvo && finalizar.mutate({ visitaId: alvo.visitaId, ...f, resultado: f.resultado as (typeof RESULTADOS_VISITA)[number]['value'] })}
        >
          Finalizar (check-out)
        </Button>
      </div>
    </Modal>
  )
}

function ModalPular({ paradaId, onFechar, onFeito }: { paradaId: number | null; onFechar: () => void; onFeito: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [outro, setOutro] = useState('')
  useEffect(() => { setMotivo(''); setOutro('') }, [paradaId])
  const pular = trpc.roteiros.pularParada.useMutation({ onSuccess: () => { toast.success('Parada marcada como pulada'); onFeito() }, onError: (e) => toast.error(e.message) })
  const final = motivo === 'Outro' ? outro.trim() : motivo
  return (
    <Modal open={paradaId != null} onClose={onFechar} title="Pular parada" size="sm">
      <div className="p-5 space-y-3">
        <Select label="Por que não vai visitar?" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Selecione..." options={MOTIVOS_PULO.map((m) => ({ value: m, label: m }))} />
        {motivo === 'Outro' && <Input label="Explique" value={outro} onChange={(e) => setOutro(e.target.value)} />}
        <p className="text-[11px] text-dark-500">O gestor vê as paradas puladas e o motivo.</p>
        <Button className="w-full" variant="danger" disabled={final.length < 3} loading={pular.isPending} onClick={() => paradaId != null && pular.mutate({ paradaId, motivo: final })}>Pular parada</Button>
      </div>
    </Modal>
  )
}

function ModalExtra({ aberto, data, onFechar, onFeito }: { aberto: boolean; data: string; onFechar: () => void; onFeito: () => void }) {
  const [f, setF] = useState({ nome: '', endereco: '', cidade: '', objetivo: '', justificativa: '' })
  useEffect(() => { if (aberto) setF({ nome: '', endereco: '', cidade: '', objetivo: '', justificativa: '' }) }, [aberto])
  const localizar = trpc.roteiros.localizar.useMutation()
  const pedir = trpc.roteiros.pedirExtra.useMutation({ onSuccess: () => { toast.success('Pedido enviado ao gestor'); onFeito() }, onError: (e) => toast.error(e.message) })
  const [enviando, setEnviando] = useState(false)
  async function enviar() {
    setEnviando(true)
    const loc = await localizar.mutateAsync({ nome: f.nome, endereco: f.endereco, cidade: f.cidade }).catch(() => null)
    setEnviando(false)
    pedir.mutate({ data, justificativa: f.justificativa, parada: { tipo: 'cliente', nome: f.nome, endereco: f.endereco || null, cidade: f.cidade || null, lat: loc?.lat ?? null, lng: loc?.lng ?? null, localizacaoFonte: loc?.fonte ?? null, objetivo: f.objetivo } })
  }
  return (
    <Modal open={aberto} onClose={onFechar} title="Pedir visita extra" size="md">
      <div className="p-5 space-y-3">
        <p className="text-xs text-dark-400">A visita só pode ser registrada depois que o gestor liberar. Ele recebe o pedido na hora.</p>
        <Input label="Empresa" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Endereço" value={f.endereco} onChange={(e) => setF({ ...f, endereco: e.target.value })} />
          <Input label="Cidade" value={f.cidade} onChange={(e) => setF({ ...f, cidade: e.target.value })} />
        </div>
        <Select label="Objetivo" value={f.objetivo} onChange={(e) => setF({ ...f, objetivo: e.target.value })} placeholder="Selecione..." options={OBJETIVOS_ROTEIRO.map((o) => ({ value: o, label: o }))} />
        <Input label="Por que essa visita fora do roteiro?" value={f.justificativa} onChange={(e) => setF({ ...f, justificativa: e.target.value })} placeholder="Ex.: cliente ligou pedindo visita urgente" />
        <Button className="w-full" disabled={!f.nome.trim() || !f.objetivo || f.justificativa.trim().length < 5} loading={enviando || pedir.isPending} onClick={enviar}>
          {enviando ? <LoaderCircle size={13} className="animate-spin" /> : 'Enviar pedido'}
        </Button>
      </div>
    </Modal>
  )
}
