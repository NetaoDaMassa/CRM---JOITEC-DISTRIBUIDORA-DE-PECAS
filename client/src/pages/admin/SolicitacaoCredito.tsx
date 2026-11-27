import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ShieldCheck, Paperclip, X, Search } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { usePersistedState } from '../../lib/usePersistedState'
import { formatarMoeda as formatarMoedaBr } from '../../lib/moeda'
import { parseValorBr } from '../../lib/valorBr'
import { formatDateTime } from '../../lib/utils'
import { Input, Textarea } from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { HistoricoClienteView } from '../../components/HistoricoCliente'
import ConversarSobreIssoButton from '../../components/chat/ConversarSobreIssoButton'
import { CartaoTotal, TabelaRelatorio, type Coluna, moeda, pct, numCsv, tempoUtil, mesBr, limitesDoMes, dataBr } from './creditoRelatorioUi'

function formatarMoeda(v: number | null | undefined): string {
  return v == null ? '—' : formatarMoedaBr(v)
}

const STATUS_LABEL: Record<string, string> = { pendente: 'Pendente', liberado: 'Liberado', negado: 'Negado' }
const STATUS_COR: Record<string, string> = {
  pendente: 'text-amber-400 bg-amber-900/20 border-amber-700/40',
  liberado: 'text-green-400 bg-green-900/20 border-green-700/40',
  negado: 'text-red-400 bg-red-900/20 border-red-700/40',
}
const TIPO_LABEL: Record<string, string> = { consulta: 'Consulta', limite: 'Limite de crédito' }
export const QUEM_LIBERA = ['Jessica (financeiro)', 'Rubia (financeiro)', 'Guilherme (diretor)'] as const
const diasDesde = (d: string) => Math.max(0, Math.round((Date.now() - new Date(`${d}T12:00:00`).getTime()) / 86_400_000))

const TIPO_CONSULTA_LABEL: Record<string, string> = { geral: 'Consulta geral', limpo: 'Só verificar se está limpo' }

type Anexo = { urlArquivo: string; nomeArquivo: string; tipoArquivo?: string }

async function fazerUpload(file: File): Promise<Anexo> {
  const formData = new FormData()
  formData.append('file', file)
  const token = localStorage.getItem('odin_token')
  const resp = await fetch('/upload/solicitacao-credito-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
  const json = await resp.json()
  if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
  return { urlArquivo: json.path, nomeArquivo: json.nome, tipoArquivo: json.tipo }
}

// Detalhe de uma solicitação — mostra o pedido do vendedor + o histórico
// COMPLETO do cliente (reaproveita HistoricoCliente, mesmo componente da
// Ficha do Cliente) pra quem vai decidir não precisar abrir outra tela.
// Se ainda pendente, mostra o formulário de resposta; já decidido, mostra
// só o que foi registrado. Pedido do João, 2026-10-01.
function DetalheSolicitacaoModal({ id, onClose }: { id: number; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.solicitacaoCredito.detalhe.useQuery({ id })
  const { data: historico, isLoading: carregandoHistorico } = trpc.solicitacaoCredito.historicoCliente.useQuery(
    { clienteId: data?.clienteId ?? 0 },
    { enabled: !!data?.clienteId }
  )

  const [decisao, setDecisao] = useState<'liberado' | 'negado'>('liberado')
  const [valorLiberado, setValorLiberado] = useState('')
  const [quemLiberou, setQuemLiberou] = useState('')
  const [motivoResposta, setMotivoResposta] = useState('')
  const [serasaObservacao, setSerasaObservacao] = useState('')
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [enviandoArquivo, setEnviandoArquivo] = useState(false)
  const [serasaLimpo, setSerasaLimpo] = useState<boolean | null>(null)
  const [serasaConsultaEm, setSerasaConsultaEm] = useState('')
  // Depois de já ter uma resposta, o formulário de nova análise fica
  // escondido atrás desse botão — não precisa aparecer aberto pra quem só
  // quer ver a decisão já tomada. Pedido do João, 2026-10-14.
  const [novaAnaliseAberta, setNovaAnaliseAberta] = useState(false)

  const responderMut = trpc.solicitacaoCredito.responder.useMutation({
    onSuccess() {
      toast.success('Resposta registrada')
      utils.solicitacaoCredito.listar.invalidate()
      utils.solicitacaoCredito.detalhe.invalidate({ id })
      // Toda resposta também vira uma linha em Liberação de Crédito (ver
      // solicitacaoCredito.ts, responder) — invalida pra quem tiver aquela
      // tela aberta numa aba já ver sem precisar recarregar.
      utils.liberacaoCredito.listar.invalidate()
      utils.liberacaoCredito.relatorio.invalidate()
      setNovaAnaliseAberta(false)
      setQuemLiberou('')
      setMotivoResposta('')
      setSerasaObservacao('')
      setValorLiberado('')
      setAnexos([])
    },
    onError: (e) => toast.error(e.message),
  })

  async function onSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setEnviandoArquivo(true)
    try {
      const anexo = await fazerUpload(file)
      setAnexos((prev) => [...prev, anexo])
    } catch (err: any) {
      toast.error(err.message ?? 'Erro no upload')
    } finally {
      setEnviandoArquivo(false)
    }
  }

  const ehLimpo = data?.tipo === 'consulta' && data?.tipoConsulta === 'limpo'

  function responder() {
    if (serasaLimpo == null) return toast.error('Primeiro: o cliente está limpo no Serasa?')
    if (!serasaConsultaEm) return toast.error('Informe a data da consulta do Serasa')
    if (!anexos.length && !data?.respostas.length) toast('Dica: anexe o print da consulta do Serasa', { icon: '📎' })
    if (!quemLiberou.trim()) return toast.error('Informe quem decidiu')
    if (!motivoResposta.trim()) return toast.error('Informe o motivo')
    const valorNumero = decisao === 'liberado' && !ehLimpo ? parseValorBr(valorLiberado) : undefined
    if (decisao === 'liberado' && !ehLimpo && !valorNumero) return toast.error('Informe o valor liberado')
    responderMut.mutate({
      id,
      decisao,
      valorLiberado: valorNumero,
      quemLiberou: quemLiberou.trim(),
      motivoResposta: motivoResposta.trim(),
      serasaObservacao: serasaObservacao.trim() || undefined,
      serasaLimpo,
      serasaConsultaEm,
      anexos: anexos.length ? anexos : undefined,
    })
  }

  return (
    <Modal open onClose={onClose} title="Solicitação de crédito" size="xl">
      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}
      {data && (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-dark-100 font-medium">
                {data.clienteNome}
                {data.semCadastro && (
                  <span className="ml-2 text-[11px] font-semibold rounded bg-sky-900/40 text-sky-200 border border-sky-700/50 px-1.5 py-0.5" title="Odin Compressores: o vendedor mandou só o CNPJ, a empresa não está cadastrada no CRM.">Sem cadastro — só CNPJ</span>
                )}
                {data.cotacaoId && (
                  <span className="ml-2 text-[11px] font-semibold rounded bg-amber-900/40 text-amber-200 border border-amber-700/50 px-1.5 py-0.5">Pedido da cotação nº {data.cotacaoId}</span>
                )}
              </p>
              <p className="text-xs text-dark-500">
                {data.tipo === 'consulta' && data.tipoConsulta ? TIPO_CONSULTA_LABEL[data.tipoConsulta] : TIPO_LABEL[data.tipo]} · Cód.{' '}
                {data.clienteCodigo} · {data.empresaNome} · pedido de {data.vendedorNome} · {formatDateTime(data.createdAt)}
              </p>
              {data.clienteDocumento && <p className="text-sm text-dark-200 font-mono mt-0.5">CNPJ/CPF {data.clienteDocumento}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ConversarSobreIssoButton tipoOrigem="consulta_credito" idOrigem={data.id} titulo={`Consulta de crédito — ${data.clienteNome}`} />
              <SeloTempo t={data.tempo} />
              <Badge className={STATUS_COR[data.status]}>{STATUS_LABEL[data.status]}</Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-dark-900/60 border border-dark-700 rounded-xl p-4 text-sm">
            {/* Valor liberado em destaque; "limite desejado" saiu do pedido (João, 2026-11-25). */}
            {data.valorSolicitado != null && data.tipo !== 'limite' && (
              <div>
                <p className="text-xs text-dark-500 uppercase tracking-wide">Valor do pedido (cotação)</p>
                <p className="text-dark-100">{formatarMoeda(data.valorSolicitado)}</p>
              </div>
            )}
            {data.status === 'liberado' && data.valorLiberado != null && (
              <div>
                <p className="text-xs text-dark-500 uppercase tracking-wide">Limite liberado</p>
                <p className="text-lg font-bold text-green-400">{formatarMoeda(data.valorLiberado)}</p>
              </div>
            )}
            {data.valorPedido != null && (
              <div>
                <p className="text-xs text-dark-500 uppercase tracking-wide">Valor do pedido de venda</p>
                <p className="text-dark-100">{formatarMoeda(data.valorPedido)}</p>
              </div>
            )}
            {data.serasaConsultaEm && (
              <div className="md:col-span-2">
                <p className="text-xs text-dark-500 uppercase tracking-wide">Serasa</p>
                <p className={data.serasaLimpo ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                  {data.serasaLimpo ? 'LIMPO' : 'NÃO está limpo'} · consulta de {data.serasaConsultaEm.split('-').reverse().join('/')} (há {diasDesde(data.serasaConsultaEm)} dias)
                </p>
              </div>
            )}
            {data.informacoesFiscais && (
              <div className="md:col-span-2">
                <p className="text-xs text-dark-500 uppercase tracking-wide">Informações fiscais</p>
                <p className="text-dark-200">{data.informacoesFiscais}</p>
              </div>
            )}
            {data.observacoes && (
              <div className="md:col-span-2">
                <p className="text-xs text-dark-500 uppercase tracking-wide">Observações do vendedor</p>
                <p className="text-dark-200">{data.observacoes}</p>
              </div>
            )}
            {!!data.anexos.filter((a) => a.origem === 'vendedor').length && (
              <div className="md:col-span-2 flex flex-wrap gap-2">
                {data.anexos
                  .filter((a) => a.origem === 'vendedor')
                  .map((a) => (
                    <a key={a.id} href={a.urlArquivo} target="_blank" rel="noreferrer" className="text-xs text-gold-400 hover:underline flex items-center gap-1">
                      <Paperclip size={10} /> {a.nomeArquivo}
                    </a>
                  ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-semibold text-dark-200 mb-2">Histórico completo do cliente</p>
            <HistoricoClienteView data={historico} isLoading={carregandoHistorico} />
          </div>

          {!!data.respostas.length && (
            <div className="space-y-3 border-t border-dark-700 pt-4">
              <p className="text-sm font-semibold text-dark-200">
                {data.respostas.length > 1 ? 'Histórico de análises' : 'Resposta registrada'}
              </p>
              {data.respostas.map((r, i) => {
                const ehLiberado = r.status === 'liberado'
                return (
                  <div key={r.id} className="space-y-1 text-sm bg-dark-900/40 border border-dark-700 rounded-lg p-3">
                    {data.respostas.length > 1 && (
                      <p className="text-xs text-dark-500 uppercase tracking-wide font-semibold">{i + 1}ª análise</p>
                    )}
                    {ehLiberado &&
                      (ehLimpo ? (
                        <p className="text-green-400 font-medium">Cliente está limpo</p>
                      ) : (
                        <div>
                          <p className="text-green-400 font-medium">Liberado — {formatarMoeda(r.valorLiberado)}</p>
                          <p className="text-[11px] text-dark-500">Valor de limite de crédito do cliente</p>
                        </div>
                      ))}
                    {!ehLiberado && <p className="text-red-400 font-medium">{ehLimpo ? 'Cliente não está limpo' : 'Negado'}</p>}
                    {r.quemLiberou && <p className="text-dark-300 text-xs">Decidido por: {r.quemLiberou}</p>}
                    {r.motivoResposta && <p className="text-dark-200">{r.motivoResposta}</p>}
                    {r.serasaObservacao && (
                      <p className="text-dark-300 text-xs">
                        <span className="text-dark-500">Serasa:</span> {r.serasaObservacao}
                      </p>
                    )}
                    {r.decididoEm && <p className="text-xs text-dark-500">{formatDateTime(r.decididoEm)}</p>}
                  </div>
                )
              })}
              {!!data.anexos.filter((a) => a.origem === 'financeiro').length && (
                <div className="flex flex-wrap gap-2">
                  {data.anexos
                    .filter((a) => a.origem === 'financeiro')
                    .map((a) => (
                      <a key={a.id} href={a.urlArquivo} target="_blank" rel="noreferrer" className="text-xs text-gold-400 hover:underline flex items-center gap-1">
                        <Paperclip size={10} /> {a.nomeArquivo}
                      </a>
                    ))}
                </div>
              )}
              {!novaAnaliseAberta && (
                <button
                  type="button"
                  className="text-xs text-gold-400 underline"
                  onClick={() => {
                    setDecisao(data.status === 'negado' ? 'liberado' : 'negado')
                    setNovaAnaliseAberta(true)
                  }}
                >
                  + Fazer nova análise (réplica)
                </button>
              )}
            </div>
          )}

          {(data.status === 'pendente' || novaAnaliseAberta) && (
            <div className="space-y-3 border-t border-dark-700 pt-4">
              <p className="text-sm font-semibold text-dark-200">{data.respostas.length ? 'Nova análise' : 'Responder'}</p>
              <div className="rounded-xl border border-dark-600 bg-dark-900/50 p-3 space-y-2">
                <p className="text-sm text-dark-100 font-medium">1º — O cliente está limpo no Serasa? *</p>
                <div className="flex gap-2">
                  <Button variant={serasaLimpo === true ? 'primary' : 'secondary'} size="sm" onClick={() => setSerasaLimpo(true)}>
                    Está limpo
                  </Button>
                  <Button variant={serasaLimpo === false ? 'danger' : 'secondary'} size="sm" onClick={() => setSerasaLimpo(false)}>
                    Não está limpo
                  </Button>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-48">
                    <Input label="Data da consulta do Serasa *" type="date" value={serasaConsultaEm} onChange={(e) => setSerasaConsultaEm(e.target.value)} />
                  </div>
                  {serasaConsultaEm && <p className="text-xs text-dark-300 pb-2">feita há {diasDesde(serasaConsultaEm)} dias</p>}
                </div>
                <p className="text-[11px] text-dark-500">Anexe o print da consulta lá embaixo (onde aparece a data em que foi feita).</p>
              </div>
              <p className="text-sm text-dark-100 font-medium">2º — Limite</p>
              <div className="flex gap-2">
                <Button variant={decisao === 'liberado' ? 'primary' : 'secondary'} size="sm" onClick={() => setDecisao('liberado')}>
                  {ehLimpo ? 'Está limpo' : 'Liberar'}
                </Button>
                <Button variant={decisao === 'negado' ? 'primary' : 'secondary'} size="sm" onClick={() => setDecisao('negado')}>
                  {ehLimpo ? 'Não está limpo' : 'Negar'}
                </Button>
              </div>

              {decisao === 'liberado' && !ehLimpo && (
                <Input label="Valor liberado — limite de crédito do cliente *" value={valorLiberado} onChange={(e) => setValorLiberado(e.target.value)} placeholder="R$ 0,00" />
              )}
              <div>
                <label className="text-sm text-dark-200 font-medium mb-1 block">Quem decidiu *</label>
                <select value={quemLiberou} onChange={(e) => setQuemLiberou(e.target.value)} className="w-full bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-3 py-2">
                  <option value="">Escolha…</option>
                  {QUEM_LIBERA.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <Textarea
                label="Motivo *"
                rows={3}
                placeholder="Por que foi liberado/negado..."
                value={motivoResposta}
                onChange={(e) => setMotivoResposta(e.target.value)}
              />
              <Textarea
                label="Serasa (opcional)"
                rows={2}
                placeholder="O que a consulta do Serasa mostrou..."
                value={serasaObservacao}
                onChange={(e) => setSerasaObservacao(e.target.value)}
              />

              <div className="space-y-2">
                <p className="text-sm text-dark-200 font-medium">Anexos (print do Serasa, comprovante...)</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {anexos.map((a, i) => (
                    <span key={i} className="flex items-center gap-1 text-xs bg-dark-700 border border-dark-600 rounded-full px-2 py-1 text-dark-200">
                      <Paperclip size={11} /> {a.nomeArquivo}
                      <button type="button" onClick={() => setAnexos((prev) => prev.filter((_, idx) => idx !== i))} className="text-dark-500 hover:text-red-400">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  <label className="text-xs text-gold-400 hover:underline cursor-pointer">
                    {enviandoArquivo ? 'Enviando...' : '+ anexar arquivo'}
                    <input type="file" className="hidden" onChange={onSelecionarArquivo} disabled={enviandoArquivo} />
                  </label>
                </div>
              </div>

              <div className="flex gap-2">
                {novaAnaliseAberta && (
                  <Button variant="secondary" onClick={() => setNovaAnaliseAberta(false)}>
                    Cancelar
                  </Button>
                )}
                <Button className="flex-1" loading={responderMut.isPending} onClick={responder}>
                  {data.respostas.length ? 'Registrar nova análise' : 'Registrar resposta'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

type Filtros = {
  tipo: 'consulta' | 'limite' | ''
  status: 'pendente' | 'liberado' | 'negado' | ''
  dataDe: string
  dataAte: string
  vendedorId: string
  empresaId: string
  quemLiberou: string
  serasaLimpo: 'sim' | 'nao' | ''
  busca: string
}
const FILTROS_VAZIOS: Filtros = { tipo: '', status: 'pendente', dataDe: '', dataAte: '', vendedorId: '', empresaId: '', quemLiberou: '', serasaLimpo: '', busca: '' }

function paraInput(f: Filtros, comStatus: boolean) {
  return {
    tipo: f.tipo || undefined,
    status: comStatus ? f.status || undefined : undefined,
    dataDe: f.dataDe || undefined,
    dataAte: f.dataAte || undefined,
    vendedorId: f.vendedorId ? Number(f.vendedorId) : undefined,
    empresaId: f.empresaId ? Number(f.empresaId) : undefined,
    quemLiberou: f.quemLiberou || undefined,
    serasaLimpo: f.serasaLimpo || undefined,
    q: f.busca || undefined,
  }
}

function BarraFiltros({ f, set, mostrarStatus }: { f: Filtros; set: (p: Partial<Filtros>) => void; mostrarStatus: boolean }) {
  const { data: vendedores } = trpc.solicitacaoCredito.vendedoresOpcoes.useQuery()
  const { data: empresas } = trpc.solicitacaoCredito.empresasOpcoes.useQuery()
  const { data: decisores } = trpc.solicitacaoCredito.quemDecidiuOpcoes.useQuery()
  const algumFiltro = (Object.keys(FILTROS_VAZIOS) as (keyof Filtros)[]).some((k) => k !== 'status' && f[k] !== FILTROS_VAZIOS[k])
  return (
    <div className="flex flex-wrap items-end gap-3 bg-dark-800 border border-dark-600 rounded-2xl p-4">
      <div className="w-56">
        <Input icon={<Search size={14} />} label="Buscar cliente" placeholder="Razão social ou código..." value={f.busca} onChange={(e) => set({ busca: e.target.value })} />
      </div>
      <Input label="De" type="date" value={f.dataDe} onChange={(e) => set({ dataDe: e.target.value })} />
      <Input label="Até" type="date" value={f.dataAte} onChange={(e) => set({ dataAte: e.target.value })} />
      <div className="w-48">
        <Select label="Vendedor" value={f.vendedorId} onChange={(e) => set({ vendedorId: e.target.value })} placeholder="Todos" options={(vendedores ?? []).map((v) => ({ value: v.id, label: v.name }))} />
      </div>
      {(empresas?.length ?? 0) > 1 && (
        <div className="w-48">
          <Select label="Empresa" value={f.empresaId} onChange={(e) => set({ empresaId: e.target.value })} placeholder="Todas" options={(empresas ?? []).map((e) => ({ value: e.id, label: e.nome }))} />
        </div>
      )}
      <div className="w-44">
        <Select
          label="Tipo"
          value={f.tipo}
          onChange={(e) => set({ tipo: e.target.value as Filtros['tipo'] })}
          options={[
            { value: '', label: 'Consulta e limite' },
            { value: 'consulta', label: 'Só consultas' },
            { value: 'limite', label: 'Só pedidos de limite' },
          ]}
        />
      </div>
      {mostrarStatus && (
        <div className="w-44">
          <Select
            label="Resultado"
            value={f.status}
            onChange={(e) => set({ status: e.target.value as Filtros['status'] })}
            options={[
              { value: 'pendente', label: 'Pendentes' },
              { value: 'liberado', label: 'Liberados' },
              { value: 'negado', label: 'Negados' },
              { value: '', label: 'Todas' },
            ]}
          />
        </div>
      )}
      <div className="w-48">
        <Select label="Quem decidiu" value={f.quemLiberou} onChange={(e) => set({ quemLiberou: e.target.value })} placeholder="Todos" options={(decisores ?? []).map((n) => ({ value: n, label: n }))} />
      </div>
      <div className="w-40">
        <Select
          label="Serasa"
          value={f.serasaLimpo}
          onChange={(e) => set({ serasaLimpo: e.target.value as Filtros['serasaLimpo'] })}
          options={[
            { value: '', label: 'Todos' },
            { value: 'sim', label: 'Limpo' },
            { value: 'nao', label: 'Não está limpo' },
          ]}
        />
      </div>
      {algumFiltro && (
        <button type="button" className="text-xs text-dark-400 hover:text-dark-100 underline pb-2.5" onClick={() => set({ ...FILTROS_VAZIOS, status: f.status })}>
          Limpar filtros
        </button>
      )}
    </div>
  )
}

// Tempo até a 1ª resposta (só João/Jessica recebem `tempo`; prazo 1 hora útil).
function SeloTempo({ t }: { t: { minutos: number; esperando: boolean; noPrazo: boolean } | null }) {
  if (!t) return null
  const cor = t.noPrazo ? (t.esperando ? 'bg-amber-500/10 text-amber-300 border-amber-500/40' : 'bg-green-500/10 text-green-300 border-green-500/40') : 'bg-red-500/10 text-red-300 border-red-500/40'
  return (
    <span className={`text-[11px] font-semibold rounded border px-1.5 py-0.5 whitespace-nowrap ${cor}`} title="Tempo até a 1ª resposta, em horário de trabalho. Prazo: 1 hora.">
      ⏱ {t.esperando ? `esperando há ${tempoUtil(t.minutos)}` : `respondeu em ${tempoUtil(t.minutos)}`}
    </span>
  )
}

function ListaPedidos({ f, onAbrir }: { f: Filtros; onAbrir: (id: number) => void }) {
  const { data: linhas, isLoading } = trpc.solicitacaoCredito.listar.useQuery(paraInput(f, true))
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
      {isLoading && <p className="p-4 text-dark-400 text-sm">Carregando...</p>}
      {!isLoading && !linhas?.length && <p className="p-4 text-dark-400 text-sm">Nenhuma solicitação encontrada.</p>}
      {!!linhas?.length && <p className="px-4 py-2 text-xs text-dark-500">{linhas.length} solicitação(ões){linhas.length === 500 ? ' — mostrando as 500 mais recentes' : ''}</p>}
      {linhas?.map((l) => (
        <button key={l.id} onClick={() => onAbrir(l.id)} className="w-full text-left p-4 flex items-center justify-between gap-3 hover:bg-dark-700/40 transition-colors">
          <div>
            <p className="text-sm text-dark-100 font-medium">
              <span className={`mr-2 text-[11px] font-semibold rounded border px-1.5 py-0.5 ${l.tipo === 'limite' ? 'bg-violet-900/40 text-violet-200 border-violet-700/50' : 'bg-sky-900/40 text-sky-200 border-sky-700/50'}`}>
                {l.tipo === 'limite' ? 'LIMITE' : 'CONSULTA'}
              </span>
              {l.clienteNome}
              {l.cotacaoId && (
                <span className="ml-2 text-[11px] font-semibold rounded bg-amber-900/40 text-amber-200 border border-amber-700/50 px-1.5 py-0.5" title="Venda a prazo da Cotação do CRM — cliente sem limite no SAP. Liberado com valor ≥ pedido libera só este pedido.">
                  Pedido da cotação nº {l.cotacaoId}
                </span>
              )}
            </p>
            <p className="text-xs text-dark-500">
              {l.tipo === 'consulta' && l.tipoConsulta ? TIPO_CONSULTA_LABEL[l.tipoConsulta] : TIPO_LABEL[l.tipo]} · Cód. {l.clienteCodigo} ·{' '}
              {l.empresaNome} · pedido de {l.vendedorNome} · {formatDateTime(l.createdAt)}
                            {l.cotacaoId && l.valorSolicitado != null && <> · pedido {formatarMoeda(l.valorSolicitado)}</>}
              {l.status === 'liberado' && l.valorLiberado != null && <> · <span className="font-semibold text-green-400">liberado {formatarMoeda(l.valorLiberado)}</span></>}
              {l.quemLiberou && <> · decidido por {l.quemLiberou}</>}
              {l.serasaLimpo != null && <> · Serasa {l.serasaLimpo ? 'limpo' : 'não limpo'}</>}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge className={STATUS_COR[l.status]}>{STATUS_LABEL[l.status]}</Badge>
            <SeloTempo t={l.tempo} />
          </div>
        </button>
      ))}
    </div>
  )
}

// Relatórios (João, 2026-11-16): cartões de total em cima e tabelas por
// vendedor, por quem decidiu, por mês, por empresa e clientes com mais
// pedidos. Mesmos filtros da lista (menos "Resultado" — o relatório já
// separa liberados/negados/pendentes). Clicar numa linha abre a lista já
// filtrada.
function Relatorios({ f, irParaLista }: { f: Filtros; irParaLista: (p: Partial<Filtros>) => void }) {
  const { data, isLoading } = trpc.solicitacaoCredito.relatorio.useQuery(paraInput(f, false))
  if (isLoading || !data) return <p className="text-sm text-dark-400">Carregando...</p>
  const t = data.totais
  type Linha = (typeof data.porVendedor)[number]
  const colsResultado = <T extends Omit<Linha, 'vendedorId' | 'vendedorNome'>>(): Coluna<T>[] => [
    { titulo: 'Pedidos', valor: (l) => <span className="font-semibold text-dark-100">{l.pedidos}</span>, csv: (l) => l.pedidos, alinhar: 'direita' },
    { titulo: 'Consultas', valor: (l) => l.consultas, csv: (l) => l.consultas, alinhar: 'direita' },
    { titulo: 'Limites', valor: (l) => l.limites, csv: (l) => l.limites, alinhar: 'direita' },
    { titulo: 'Liberados', valor: (l) => <span className="text-green-400">{l.liberados}</span>, csv: (l) => l.liberados, alinhar: 'direita' },
    { titulo: 'Negados', valor: (l) => <span className="text-red-400">{l.negados}</span>, csv: (l) => l.negados, alinhar: 'direita' },
    { titulo: 'Pendentes', valor: (l) => <span className="text-amber-400">{l.pendentes}</span>, csv: (l) => l.pendentes, alinhar: 'direita' },
    { titulo: '% liberado', valor: (l) => pct(l.pctLiberado), csv: (l) => numCsv(l.pctLiberado), alinhar: 'direita' },
    { titulo: 'Valor pedido', valor: (l) => moeda(l.valorSolicitado), csv: (l) => numCsv(l.valorSolicitado), alinhar: 'direita' },
    { titulo: 'Valor liberado', valor: (l) => moeda(l.valorLiberado), csv: (l) => numCsv(l.valorLiberado), alinhar: 'direita' },
  ]
  const dica = 'clique numa linha para ver os pedidos'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CartaoTotal titulo="Pedidos no período" valor={t.pedidos} detalhe={`${t.consultas} consulta(s) · ${t.limites} limite(s)`} />
        <CartaoTotal titulo="Liberados" valor={t.liberados} cor="text-green-400" detalhe={`${pct(t.pctLiberado)} dos respondidos`} />
        <CartaoTotal titulo="Negados" valor={t.negados} cor="text-red-400" detalhe={`${t.pendentes} ainda pendente(s)`} />
        {data.verTempo && <CartaoTotal titulo="Tempo médio de resposta" valor={tempoUtil(t.tempoMedioMinutos)} detalhe="em horário de trabalho, até a 1ª resposta" />}
        <CartaoTotal titulo="Valor pedido" valor={moeda(t.valorSolicitado)} detalhe="soma do valor solicitado/limite desejado" />
        <CartaoTotal titulo="Valor liberado" valor={moeda(t.valorLiberado)} cor="text-green-400" detalhe="soma dos liberados" />
        <CartaoTotal titulo="Serasa limpo" valor={t.serasaLimpos} detalhe="entre os já consultados" />
        <CartaoTotal titulo="Serasa não limpo" valor={t.serasaNaoLimpos} cor="text-red-400" detalhe="entre os já consultados" />
      </div>

      <TabelaRelatorio
        titulo="Por vendedor"
        subtitulo="quem mais pede e quanto foi liberado"
        dicaClique={dica}
        arquivo="credito-por-vendedor"
        linhas={data.porVendedor}
        chave={(l) => l.vendedorId}
        onClicar={(l) => irParaLista({ vendedorId: String(l.vendedorId) })}
        colunas={[{ titulo: 'Vendedor', valor: (l) => <span className="text-dark-100">{l.vendedorNome}</span>, csv: (l) => l.vendedorNome }, ...colsResultado<Linha>()]}
      />

      <TabelaRelatorio
        titulo="Por quem decidiu"
        subtitulo="conta cada resposta dada (inclusive novas análises)"
        dicaClique={dica}
        arquivo="credito-por-quem-decidiu"
        linhas={data.porDecisor}
        chave={(l) => l.quemLiberou}
        onClicar={(l) => irParaLista({ quemLiberou: l.quemLiberou })}
        colunas={[
          { titulo: 'Quem decidiu', valor: (l) => <span className="text-dark-100">{l.quemLiberou}</span>, csv: (l) => l.quemLiberou },
          { titulo: 'Respondeu', valor: (l) => <span className="font-semibold text-dark-100">{l.respostas}</span>, csv: (l) => l.respostas, alinhar: 'direita' },
          { titulo: 'Liberou', valor: (l) => <span className="text-green-400">{l.liberou}</span>, csv: (l) => l.liberou, alinhar: 'direita' },
          { titulo: 'Negou', valor: (l) => <span className="text-red-400">{l.negou}</span>, csv: (l) => l.negou, alinhar: 'direita' },
          { titulo: '% liberado', valor: (l) => pct(l.pctLiberado), csv: (l) => numCsv(l.pctLiberado), alinhar: 'direita' },
          ...(data.verTempo
            ? [{ titulo: 'Tempo médio de resposta', valor: (l: (typeof data.porDecisor)[number]) => tempoUtil(l.tempoMedioMinutos), csv: (l: (typeof data.porDecisor)[number]) => tempoUtil(l.tempoMedioMinutos), alinhar: 'direita' as const }]
            : []),
        ]}
      />

      <TabelaRelatorio
        titulo="Por mês"
        dicaClique={dica}
        arquivo="credito-por-mes"
        linhas={data.porMes}
        chave={(l) => l.mes}
        onClicar={(l) => {
          const { de, ate } = limitesDoMes(l.mes)
          irParaLista({ dataDe: de, dataAte: ate })
        }}
        colunas={[{ titulo: 'Mês', valor: (l) => <span className="text-dark-100">{mesBr(l.mes)}</span>, csv: (l) => mesBr(l.mes) }, ...colsResultado<(typeof data.porMes)[number]>()]}
      />

      {data.porEmpresa.length > 1 && (
        <TabelaRelatorio
          titulo="Por empresa"
          dicaClique={dica}
          arquivo="credito-por-empresa"
          linhas={data.porEmpresa}
          chave={(l) => l.empresaId}
          onClicar={(l) => irParaLista({ empresaId: String(l.empresaId) })}
          colunas={[{ titulo: 'Empresa', valor: (l) => <span className="text-dark-100">{l.empresaNome}</span>, csv: (l) => l.empresaNome }, ...colsResultado<(typeof data.porEmpresa)[number]>()]}
        />
      )}

      <TabelaRelatorio
        titulo="Clientes com mais pedidos"
        subtitulo="os 50 primeiros"
        dicaClique={dica}
        arquivo="credito-clientes-mais-pedidos"
        linhas={data.porCliente}
        chave={(l) => l.clienteId ?? `avulso-${l.clienteNome}`}
        onClicar={(l) => irParaLista({ busca: l.clienteCodigo })}
        colunas={[
          {
            titulo: 'Cliente',
            valor: (l) => (
              <span className="text-dark-100">
                {l.clienteNome} <span className="text-dark-500 text-xs">Cód. {l.clienteCodigo} · {l.empresaNome}</span>
              </span>
            ),
            csv: (l) => l.clienteNome,
          },
          { titulo: 'Código', valor: (l) => l.clienteCodigo, csv: (l) => l.clienteCodigo },
          ...colsResultado<(typeof data.porCliente)[number]>(),
          { titulo: 'Último pedido', valor: (l) => dataBr(l.ultimoPedido), csv: (l) => dataBr(l.ultimoPedido), alinhar: 'direita' },
        ]}
      />
    </div>
  )
}

function haDias(n: number) {
  return n <= 0 ? 'hoje' : n === 1 ? 'ontem' : `há ${n} dias`
}

// Aba "Pesquisar cliente" (financeiro, 2026-11-24): digita o código, CNPJ
// ou nome e já vê se o cliente foi consultado e quando — juntando o mesmo
// CNPJ de todas as empresas.
function PesquisarCliente({ onAbrir }: { onAbrir: (id: number) => void }) {
  const [texto, setTexto] = usePersistedState('solicitacaoCredito:pesquisa', '')
  const [q, setQ] = useState(texto)
  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 350)
    return () => clearTimeout(t)
  }, [texto])
  const { data, isFetching } = trpc.solicitacaoCredito.pesquisarCliente.useQuery({ q }, { enabled: q.length >= 2 })

  return (
    <div className="space-y-3">
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <Input
          icon={<Search size={14} />}
          label="Código, CNPJ/CPF ou nome do cliente"
          placeholder="Ex: C001234 ou 12.345.678/0001-90"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoFocus
        />
        <p className="text-xs text-dark-500 mt-2">Mostra a última consulta do Serasa e todos os pedidos desse cliente, em todas as empresas (mesmo CNPJ), e a data de consulta gravada no cadastro do SAP.</p>
      </div>

      {q.length >= 2 && isFetching && !data && <p className="text-sm text-dark-400">Procurando...</p>}
      {q.length >= 2 && data && !data.grupos.length && <p className="text-sm text-dark-400">Nenhum cliente encontrado com "{q}".</p>}
      {data?.muitos && <p className="text-xs text-amber-400">Muitos resultados — digite mais do nome ou o código/CNPJ completo.</p>}

      {data?.grupos.map((g) => {
        const u = g.ultimaConsulta
        const dias = u?.serasaConsultaEm ? diasDesde(u.serasaConsultaEm.slice(0, 10)) : null
        return (
          <div key={g.chave} className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-dark-700 space-y-2">
              <div>
                <p className="text-base font-medium text-dark-50">{g.nome}</p>
                <p className="text-xs text-dark-400">
                  {g.documento ? <>CNPJ/CPF {g.documento} · </> : null}
                  {g.cadastros.map((c) => `${c.codigo} (${c.empresaNome})`).join(' · ')}
                </p>
              </div>
              {u ? (
                <div
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    u.serasaLimpo ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-300'
                  }`}
                >
                  <span className="font-semibold">
                    Última consulta Serasa: {dataBr(u.serasaConsultaEm!)} ({haDias(dias!)})
                  </span>{' '}
                  · {u.serasaLimpo ? 'Limpo' : 'Não está limpo'} · {STATUS_LABEL[u.status]}
                  {u.status === 'liberado' && u.valorLiberado != null && <> {formatarMoeda(u.valorLiberado)}</>}
                  {u.quemLiberou && <> · por {u.quemLiberou}</>} · {u.empresaNome}
                </div>
              ) : (
                <div className="rounded-xl border px-3 py-2 text-sm bg-dark-700/50 border-dark-600 text-dark-300">
                  {g.pedidos.length ? 'Tem pedido, mas ainda sem consulta do Serasa respondida.' : 'Nunca foi consultado por aqui.'}
                </div>
              )}
              {g.sap && (!u?.serasaConsultaEm || g.sap.data > u.serasaConsultaEm.slice(0, 10)) && (
                <div className="rounded-xl border px-3 py-2 text-sm bg-sky-500/10 border-sky-500/30 text-sky-200">
                  <span className="font-semibold">
                    No cadastro do SAP: última consulta Serasa {dataBr(g.sap.data)} ({haDias(diasDesde(g.sap.data))})
                  </span>{' '}
                  · {g.sap.cardCode}
                  {g.soNoSap && <> · sem cadastro no CRM</>}
                </div>
              )}
            </div>
            {g.pedidos.length > 0 && (
              <div className="divide-y divide-dark-700">
                {g.pedidos.map((p) => (
                  <button key={p.id} onClick={() => onAbrir(p.id)} className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-dark-700/40 transition-colors">
                    <p className="text-xs text-dark-400">
                      <span className="text-dark-200">{formatDateTime(p.createdAt)}</span> · {p.tipo === 'consulta' && p.tipoConsulta ? TIPO_CONSULTA_LABEL[p.tipoConsulta] : TIPO_LABEL[p.tipo]} · Cód.{' '}
                      {p.clienteCodigo} · {p.empresaNome} · pedido de {p.vendedorNome}
                      {p.status === 'liberado' && p.valorLiberado != null && <> · <span className="font-semibold text-green-400">liberado {formatarMoeda(p.valorLiberado)}</span></>}
                      {p.serasaConsultaEm && <> · Serasa {dataBr(p.serasaConsultaEm)} {p.serasaLimpo ? 'limpo' : 'não limpo'}</>}
                    </p>
                    <Badge className={STATUS_COR[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Consultas e pedidos de limite numa fila só (João, 2026-11-16: "tudo o
// que a gente responde fica junto"). Registros de liberação ficou só com o
// controle manual de quem libera fora do esquema. Aba Relatórios com os
// mesmos filtros.
export default function SolicitacaoCredito() {
  const [aba, setAba] = usePersistedState<'pedidos' | 'pesquisar' | 'relatorios'>('solicitacaoCredito:aba', 'pedidos')
  const [filtros, setFiltros] = usePersistedState<Filtros>('solicitacaoCredito:filtros', FILTROS_VAZIOS)
  const f = { ...FILTROS_VAZIOS, ...filtros }
  const set = (p: Partial<Filtros>) => setFiltros({ ...f, ...p })
  const [abertoId, setAbertoId] = useState<number | null>(null)

  return (
    <div className="p-6 max-w-6xl space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={20} className="text-gold-400" />
        <div>
          <h1 className="font-heading text-xl text-dark-50">Consulta/Solicitação de Crédito</h1>
          <p className="text-sm text-dark-400">Consultas e pedidos de limite feitos pelos vendedores, tudo junto para o financeiro responder.</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-dark-700">
        {(['pedidos', 'pesquisar', 'relatorios'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAba(t)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${aba === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
          >
            {t === 'pedidos' ? 'Pedidos' : t === 'pesquisar' ? 'Pesquisar cliente' : 'Relatórios'}
          </button>
        ))}
      </div>

      {aba !== 'pesquisar' && <BarraFiltros f={f} set={set} mostrarStatus={aba === 'pedidos'} />}

      {aba === 'pedidos' && <ListaPedidos f={f} onAbrir={setAbertoId} />}
      {aba === 'pesquisar' && <PesquisarCliente onAbrir={setAbertoId} />}
      {aba === 'relatorios' && (
        <Relatorios
          f={f}
          irParaLista={(p) => {
            setFiltros({ ...f, status: '', ...p })
            setAba('pedidos')
          }}
        />
      )}

      {abertoId !== null && <DetalheSolicitacaoModal id={abertoId} onClose={() => setAbertoId(null)} />}
    </div>
  )
}
