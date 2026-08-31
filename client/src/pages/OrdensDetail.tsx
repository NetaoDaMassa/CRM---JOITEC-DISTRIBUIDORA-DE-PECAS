import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, ArrowRight, Ban, Pause, Play, X, Building2, Phone, Mail, MapPin, User } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import { Badge } from '../components/ui/Badge'
import { getStageSequence, STAGE_LABELS, STAGE_COLORS, ORDER_TYPE_LABELS, type Stage, type OrderType } from '../lib/ordensShared'

function formatarDataHora(dt: string | null | undefined): string {
  if (!dt) return '—'
  const [data, hora] = dt.split(' ')
  const [ano, mes, dia] = data.split('-')
  return hora ? `${dia}/${mes}/${ano} ${hora.slice(0, 5)}` : `${dia}/${mes}/${ano}`
}

type TabKey =
  | 'geral'
  | 'financeiro'
  | 'pedido'
  | 'frete'
  | 'preparacao'
  | 'faturamento'
  | 'conferencia'
  | 'coleta'
  | 'rastreio'
  | 'qualidade'
  | 'pos_venda'
  | 'anexos'
  | 'historico'

const TAB_LABELS: Record<TabKey, string> = {
  geral: 'Visão Geral',
  financeiro: 'Liberação Financeira',
  pedido: 'Pedido',
  frete: 'Frete',
  preparacao: 'Preparação',
  faturamento: 'Faturamento',
  conferencia: 'Conferência',
  coleta: 'Coleta',
  rastreio: 'Rastreio',
  qualidade: 'Qualidade',
  pos_venda: 'Pós-Venda',
  anexos: 'Anexos',
  historico: 'Histórico',
}

function tabsParaTipo(orderType: OrderType): TabKey[] {
  const base: TabKey[] = ['geral']
  if (orderType === 'maquina') base.push('financeiro')
  base.push('pedido', 'frete', 'preparacao')
  if (orderType === 'maquina') base.push('conferencia')
  base.push('faturamento', 'coleta', 'rastreio', 'qualidade', 'pos_venda', 'anexos', 'historico')
  return base
}

export default function OrdensDetail() {
  const { id } = useParams()
  const ordemId = Number(id)
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [tab, setTab] = useState<TabKey>('geral')
  const [modalPausar, setModalPausar] = useState(false)
  const [motivoPausa, setMotivoPausa] = useState('')
  const [modalCancelar, setModalCancelar] = useState(false)
  const [motivoCancelamento, setMotivoCancelamento] = useState('')

  const utils = trpc.useUtils()
  const { data: ordem, isLoading } = trpc.ordens.core.obterPorId.useQuery({ id: ordemId })

  function invalidarTudo() {
    utils.ordens.core.obterPorId.invalidate({ id: ordemId })
    utils.ordens.core.historico.invalidate({ id: ordemId })
    utils.ordens.core.listarKanban.invalidate()
  }

  const avancarMut = trpc.ordens.core.avancar.useMutation({
    onSuccess: () => { toast.success('Etapa avançada'); invalidarTudo() },
    onError: (e) => toast.error(e.message),
  })
  const cancelarMut = trpc.ordens.core.cancelar.useMutation({
    onSuccess: () => { toast.success('Pedido cancelado'); setModalCancelar(false); setMotivoCancelamento(''); invalidarTudo() },
    onError: (e) => toast.error(e.message),
  })
  const pausarMut = trpc.ordens.core.pausar.useMutation({
    onSuccess: () => { toast.success('Pedido pausado'); setModalPausar(false); setMotivoPausa(''); invalidarTudo() },
    onError: (e) => toast.error(e.message),
  })
  const retomarMut = trpc.ordens.core.retomar.useMutation({
    onSuccess: () => { toast.success('Pedido retomado'); invalidarTudo() },
    onError: (e) => toast.error(e.message),
  })
  const moverMut = trpc.ordens.core.mover.useMutation({
    onSuccess: () => { toast.success('Etapa alterada'); invalidarTudo() },
    onError: (e) => toast.error(e.message),
  })

  if (isLoading) return <div className="p-6 text-dark-400 text-sm">Carregando...</div>
  if (!ordem) return <div className="p-6 text-dark-400 text-sm">Pedido não encontrado</div>

  const orderType = ordem.orderType as OrderType
  const sequencia = getStageSequence(orderType)
  const idxAtual = sequencia.indexOf(ordem.stage as Stage)
  const proximaEtapa = idxAtual >= 0 && idxAtual < sequencia.length - 1 ? sequencia[idxAtual + 1] : null
  const tabs = tabsParaTipo(orderType)

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-4 md:p-8 bg-dark-950/80 backdrop-blur-sm">
      <div className="w-full max-w-4xl bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl shadow-black/50 my-4">
        <div className="flex items-start justify-between gap-3 px-6 pt-5">
          <div>
            <h1 className="font-heading text-xl text-dark-50 font-bold">
              Pedido #{ordem.id} <span className="text-dark-500 text-base font-normal">— {ordem.cliente?.razaoSocial ?? ORDER_TYPE_LABELS[orderType]}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-dark-400">
              {ordem.vendedor && <span>Vendedor: <span className="text-dark-200">{ordem.vendedor.name}</span></span>}
              <span>Criado: <span className="text-dark-200">{formatarDataHora(ordem.createdAt)}</span></span>
              <span>Nesta etapa desde: <span className="text-dark-200">{formatarDataHora(ordem.updatedAt)}</span></span>
              {ordem.cliente?.codigo && <span>Código: <span className="text-dark-200">{ordem.cliente.codigo}</span></span>}
              {ordem.cliente?.cnpj && <span>CNPJ: <span className="text-dark-200">{ordem.cliente.cnpj}</span></span>}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge className={STAGE_COLORS[ordem.stage as Stage] ?? 'text-gold-400 bg-gold-900/20 border-gold-700/40'}>{STAGE_LABELS[ordem.stage as Stage] ?? ordem.stage}</Badge>
              <Badge className="text-dark-300 bg-dark-700 border-dark-600">{ORDER_TYPE_LABELS[orderType]}</Badge>
              {ordem.status !== 'ativo' && <Badge className="text-red-400 bg-red-900/20 border-red-700/40">{ordem.status}</Badge>}
              {ordem.pausadoEm && <Badge className="text-yellow-400 bg-yellow-900/20 border-yellow-700/40">Pausado: {ordem.pausadoMotivo}</Badge>}
            </div>
          </div>
          <button onClick={() => navigate(-1)} className="text-dark-400 hover:text-dark-100 transition-colors p-1.5 rounded-lg hover:bg-dark-700 shrink-0">
            <X size={18} />
          </button>
        </div>

        {isAdmin && ordem.status === 'ativo' && (
          <div className="flex items-center gap-2 flex-wrap px-6 mt-4">
            {proximaEtapa && (
              <Button size="sm" loading={avancarMut.isPending} onClick={() => avancarMut.mutate({ id: ordemId })}>
                <ArrowRight size={14} className="mr-1" /> Avançar pra "{STAGE_LABELS[proximaEtapa]}"
              </Button>
            )}
            <Select
              className="w-auto"
              value=""
              onChange={(e) => e.target.value && moverMut.mutate({ id: ordemId, novaEtapa: e.target.value })}
              placeholder="Mover pra etapa..."
              options={sequencia.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
            />
            {ordem.pausadoEm ? (
              <Button size="sm" variant="secondary" onClick={() => retomarMut.mutate({ id: ordemId })}>
                <Play size={14} className="mr-1" /> Retomar
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setModalPausar(true)}>
                <Pause size={14} className="mr-1" /> Pausar
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={() => setModalCancelar(true)}>
              <Ban size={14} className="mr-1" /> Cancelar
            </Button>
          </div>
        )}

        {ordem.cliente && (
          <div className="mx-6 mt-4 bg-dark-900/60 border border-dark-700 rounded-xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-dark-500 mb-3">Dados do Cliente</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
              <div className="flex items-start gap-2 sm:col-span-2">
                <Building2 size={14} className="text-dark-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-dark-500 text-[11px]">Empresa</p>
                  <p className="text-dark-100 font-medium">{ordem.cliente.razaoSocial}</p>
                </div>
              </div>
              {ordem.cliente.cnpj && (
                <div className="flex items-start gap-2">
                  <span className="w-[14px] shrink-0" />
                  <div>
                    <p className="text-dark-500 text-[11px]">CNPJ</p>
                    <p className="text-dark-200">{ordem.cliente.cnpj}</p>
                  </div>
                </div>
              )}
              {ordem.cliente.nomeContato && (
                <div className="flex items-start gap-2">
                  <User size={14} className="text-dark-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-dark-500 text-[11px]">Contato</p>
                    <p className="text-dark-200">{ordem.cliente.nomeContato}</p>
                  </div>
                </div>
              )}
              {ordem.cliente.telefoneWhatsapp && (
                <div className="flex items-start gap-2">
                  <Phone size={14} className="text-dark-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-dark-500 text-[11px]">Telefone</p>
                    <p className="text-dark-200">{ordem.cliente.telefoneWhatsapp}</p>
                  </div>
                </div>
              )}
              {ordem.cliente.email && (
                <div className="flex items-start gap-2">
                  <Mail size={14} className="text-dark-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-dark-500 text-[11px]">E-mail</p>
                    <p className="text-dark-200">{ordem.cliente.email}</p>
                  </div>
                </div>
              )}
              {(ordem.cliente.endereco || ordem.cliente.cidade) && (
                <div className="flex items-start gap-2 sm:col-span-2">
                  <MapPin size={14} className="text-dark-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-dark-500 text-[11px]">Endereço do cliente</p>
                    <p className="text-dark-200">
                      {[ordem.cliente.endereco, ordem.cliente.cidade, ordem.cliente.estado].filter(Boolean).join(' — ')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-1 border-b border-dark-700 mt-4 mx-6 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${tab === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="p-6">
        {tab === 'geral' && <AbaGeral ordemId={ordemId} />}
        {tab === 'financeiro' && <AbaFinanceiro ordemId={ordemId} isAdmin={isAdmin} />}
        {tab === 'pedido' && <AbaPedido ordemId={ordemId} isAdmin={isAdmin} />}
        {tab === 'frete' && <AbaFrete ordemId={ordemId} isAdmin={isAdmin} />}
        {tab === 'preparacao' && <AbaPreparacao ordemId={ordemId} isAdmin={isAdmin} />}
        {tab === 'faturamento' && <AbaFaturamento ordemId={ordemId} isAdmin={isAdmin} />}
        {tab === 'conferencia' && <AbaConferencia ordemId={ordemId} isAdmin={isAdmin} />}
        {tab === 'coleta' && <AbaColeta ordemId={ordemId} isAdmin={isAdmin} />}
        {tab === 'rastreio' && <AbaRastreio ordemId={ordemId} isAdmin={isAdmin} />}
        {tab === 'qualidade' && <AbaQualidade ordemId={ordemId} isAdmin={isAdmin} />}
        {tab === 'pos_venda' && <AbaPosVenda ordemId={ordemId} />}
        {tab === 'anexos' && <AbaAnexos ordemId={ordemId} stageAtual={ordem.stage} isAdmin={isAdmin} />}
        {tab === 'historico' && <AbaHistorico ordemId={ordemId} />}
        </div>
      </div>

      <Modal open={modalPausar} onClose={() => setModalPausar(false)} title="Pausar pedido" size="sm">
        <div className="p-5 space-y-4">
          <Input label="Motivo da pausa" value={motivoPausa} onChange={(e) => setMotivoPausa(e.target.value)} />
          <Button className="w-full" variant="secondary" disabled={!motivoPausa} loading={pausarMut.isPending} onClick={() => pausarMut.mutate({ id: ordemId, motivo: motivoPausa })}>
            Confirmar pausa
          </Button>
        </div>
      </Modal>

      <Modal open={modalCancelar} onClose={() => setModalCancelar(false)} title="Cancelar pedido" size="sm">
        <div className="p-5 space-y-4">
          <Input label="Motivo do cancelamento" value={motivoCancelamento} onChange={(e) => setMotivoCancelamento(e.target.value)} />
          <Button className="w-full" variant="danger" disabled={!motivoCancelamento} loading={cancelarMut.isPending} onClick={() => cancelarMut.mutate({ id: ordemId, motivo: motivoCancelamento })}>
            Confirmar cancelamento
          </Button>
        </div>
      </Modal>
    </div>
  )
}

// ── Abas ─────────────────────────────────────────────────────────────────

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-dark-500 mb-1">{label}</div>
      {children}
    </div>
  )
}

function AbaGeral({ ordemId }: { ordemId: number }) {
  const { data: ordem } = trpc.ordens.core.obterPorId.useQuery({ id: ordemId })
  const utils = trpc.useUtils()
  const [cep, setCep] = useState('')
  const [logradouro, setLogradouro] = useState('')
  const [cidade, setCidade] = useState('')
  const [estado, setEstado] = useState('')

  const salvarMut = trpc.ordens.core.atualizarEndereco.useMutation({
    onSuccess: () => { toast.success('Endereço salvo'); utils.ordens.core.obterPorId.invalidate({ id: ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  if (!ordem) return null
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Campo label="Criado em"><span className="text-dark-200">{ordem.createdAt}</span></Campo>
        <Campo label="Atualizado em"><span className="text-dark-200">{ordem.updatedAt}</span></Campo>
      </div>
      <h3 className="text-sm font-semibold text-dark-200 mt-4">Endereço de entrega</h3>
      <div className="grid grid-cols-2 gap-3">
        <Input label="CEP" defaultValue={ordem.enderecoEntregaCep ?? ''} onChange={(e) => setCep(e.target.value)} />
        <Input label="Cidade" defaultValue={ordem.enderecoEntregaCidade ?? ''} onChange={(e) => setCidade(e.target.value)} />
        <Input label="Logradouro" defaultValue={ordem.enderecoEntregaLogradouro ?? ''} onChange={(e) => setLogradouro(e.target.value)} className="col-span-2" />
        <Input label="Estado (UF)" defaultValue={ordem.enderecoEntregaEstado ?? ''} onChange={(e) => setEstado(e.target.value)} maxLength={2} />
      </div>
      <Button size="sm" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ id: ordemId, cep, logradouro, cidade, estado })}>Salvar endereço</Button>
    </div>
  )
}

// Cada Aba*Form abaixo só monta depois que a query já resolveu (guard no
// componente wrapper) — assim o useState que pré-preenche o campo a partir
// do `data` captura o valor certo logo no primeiro render. Sem esse split,
// o useState roda ANTES da query voltar (data ainda undefined) e o campo
// fica travado vazio pra sempre, mesmo depois do servidor mandar o valor
// real — foi um bug de verdade, pego testando a conversão Proposta→Pedido.
function AbaFinanceiro({ ordemId, isAdmin }: { ordemId: number; isAdmin: boolean }) {
  const { data, isLoading } = trpc.ordens.financeiro.obterLiberacao.useQuery({ ordemId })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return <AbaFinanceiroForm ordemId={ordemId} isAdmin={isAdmin} data={data ?? null} />
}

function AbaFinanceiroForm({ ordemId, isAdmin, data }: { ordemId: number; isAdmin: boolean; data: { aprovado: boolean; formaPagamento: string | null; condicaoPagamento: string | null; dataPagamentoPrevista: string | null; observacoes: string | null; obsTravadaEm?: string | null } | null }) {
  const utils = trpc.useUtils()
  const [forma, setForma] = useState(data?.formaPagamento ?? '')
  const [condicao, setCondicao] = useState(data?.condicaoPagamento ?? '')
  const [dataPrevista, setDataPrevista] = useState(data?.dataPagamentoPrevista ?? '')
  const [obs, setObs] = useState(data?.observacoes ?? '')
  const travada = !!data?.obsTravadaEm

  function invalidar() {
    utils.ordens.financeiro.obterLiberacao.invalidate({ ordemId })
    utils.ordens.core.obterPorId.invalidate({ id: ordemId })
  }
  const salvarMut = trpc.ordens.financeiro.atualizarLiberacao.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const aprovarMut = trpc.ordens.financeiro.aprovarLiberacao.useMutation({ onSuccess: () => { toast.success('Aprovado'); invalidar() }, onError: (e) => toast.error(e.message) })

  return (
    <div className="space-y-4">
      {data?.aprovado && <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Aprovado</Badge>}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Forma de pagamento" defaultValue={forma} onChange={(e) => setForma(e.target.value)} disabled={!isAdmin} />
        <Input label="Condição de pagamento" defaultValue={condicao} onChange={(e) => setCondicao(e.target.value)} disabled={!isAdmin} />
        <Input label="Data prevista" defaultValue={dataPrevista} onChange={(e) => setDataPrevista(e.target.value)} disabled={!isAdmin} />
      </div>
      <div>
        <Input label={`Observações${travada ? ` 🔒 travada em ${formatarDataHora(data?.obsTravadaEm)}` : ''}`} value={obs} onChange={(e) => setObs(e.target.value)} disabled={!isAdmin || travada} />
        {isAdmin && (
          travada ? (
            <button onClick={() => salvarMut.mutate({ ordemId, travar: false })} className="mt-1.5 text-xs font-semibold text-gold-400 hover:text-gold-300">Editar observação</button>
          ) : (
            <Button size="sm" variant="secondary" className="mt-1.5" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, observacoes: obs, travar: true })}>Salvar observação</Button>
          )
        )}
      </div>
      {isAdmin && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, formaPagamento: forma, condicaoPagamento: condicao, dataPagamentoPrevista: dataPrevista })}>
            Salvar dados
          </Button>
          {!data?.aprovado && (
            <Button size="sm" loading={aprovarMut.isPending} onClick={() => aprovarMut.mutate({ ordemId })}>Aprovar liberação financeira</Button>
          )}
        </div>
      )}
    </div>
  )
}

function AbaPedido({ ordemId, isAdmin }: { ordemId: number; isAdmin: boolean }) {
  const { data, isLoading } = trpc.ordens.financeiro.obterDetalhes.useQuery({ ordemId })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return <AbaPedidoForm ordemId={ordemId} isAdmin={isAdmin} data={data ?? null} />
}

function AbaPedidoForm({ ordemId, isAdmin, data }: { ordemId: number; isAdmin: boolean; data: { numeroPedido: string | null; prioridadeDespacho: string | null; valorPedido: number | null; comissaoRevenda: string | null; observacoes: string | null } | null }) {
  const utils = trpc.useUtils()
  const [numeroPedido, setNumeroPedido] = useState(data?.numeroPedido ?? '')
  const [prioridade, setPrioridade] = useState(data?.prioridadeDespacho ?? 'normal')
  const [valor, setValor] = useState(data?.valorPedido?.toString() ?? '')
  const [comissaoRevenda, setComissaoRevenda] = useState(data?.comissaoRevenda ?? '')
  const [obs, setObs] = useState(data?.observacoes ?? '')

  const salvarMut = trpc.ordens.financeiro.atualizarDetalhes.useMutation({
    onSuccess: () => { toast.success('Salvo'); utils.ordens.financeiro.obterDetalhes.invalidate({ ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Número do pedido" defaultValue={numeroPedido} onChange={(e) => setNumeroPedido(e.target.value)} disabled={!isAdmin} />
        <Select
          label="Prioridade de despacho"
          value={prioridade}
          onChange={(e) => setPrioridade(e.target.value as any)}
          disabled={!isAdmin}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'urgente', label: 'Urgente' },
            { value: 'lead', label: 'Lead' },
            { value: 'direto', label: 'Direto' },
          ]}
        />
        <Input label="Valor do pedido" type="number" defaultValue={valor} onChange={(e) => setValor(e.target.value)} disabled={!isAdmin} />
        <Input label="Comissão de revenda" defaultValue={comissaoRevenda} onChange={(e) => setComissaoRevenda(e.target.value)} disabled={!isAdmin} />
      </div>
      <Input label="Observações" defaultValue={obs} onChange={(e) => setObs(e.target.value)} disabled={!isAdmin} />
      {isAdmin && (
        <Button
          size="sm"
          loading={salvarMut.isPending}
          onClick={() => salvarMut.mutate({ ordemId, numeroPedido, prioridadeDespacho: prioridade as any, valorPedido: valor ? Number(valor) : undefined, comissaoRevenda, observacoes: obs })}
        >
          Salvar
        </Button>
      )}
      <p className="text-xs text-dark-500">Anexe o pedido oficial na aba "Anexos" (etapa "Pedido") — é exigido pra avançar pra Cotação de Frete.</p>
    </div>
  )
}

function AbaFrete({ ordemId, isAdmin }: { ordemId: number; isAdmin: boolean }) {
  const utils = trpc.useUtils()
  const { data: cotacoes } = trpc.ordens.frete.listarCotacoes.useQuery({ ordemId })
  const { data: aprovacao } = trpc.ordens.frete.obterAprovacao.useQuery({ ordemId })
  const { data: finalizado } = trpc.ordens.frete.obterFreteFinalizado.useQuery({ ordemId })

  const [transportadora, setTransportadora] = useState('')
  const [valor, setValor] = useState('')
  const [tipoFrete, setTipoFrete] = useState<'CIF' | 'FOB'>('FOB')

  function invalidar() {
    utils.ordens.frete.listarCotacoes.invalidate({ ordemId })
    utils.ordens.frete.obterAprovacao.invalidate({ ordemId })
    utils.ordens.frete.obterFreteFinalizado.invalidate({ ordemId })
  }
  const criarMut = trpc.ordens.frete.criarCotacao.useMutation({ onSuccess: () => { toast.success('Cotação criada'); invalidar(); setTransportadora(''); setValor('') }, onError: (e) => toast.error(e.message) })
  const aprovarMut = trpc.ordens.frete.aprovarCotacao.useMutation({ onSuccess: () => { toast.success('Cotação aprovada'); invalidar() }, onError: (e) => toast.error(e.message) })
  const semFreteMut = trpc.ordens.frete.definirSemFrete.useMutation({ onSuccess: () => { toast.success('Definido "sem frete"'); invalidar() }, onError: (e) => toast.error(e.message) })
  const retiradaMut = trpc.ordens.frete.definirRetiradaLocal.useMutation({ onSuccess: () => { toast.success('Definida retirada local'); invalidar() }, onError: (e) => toast.error(e.message) })
  const confirmarMut = trpc.ordens.frete.confirmarFreteFinalizado.useMutation({ onSuccess: () => { toast.success('Frete finalizado confirmado'); invalidar() }, onError: (e) => toast.error(e.message) })
  const finalizarCotacaoMut = trpc.ordens.frete.finalizarCotacao.useMutation({ onSuccess: () => { toast.success('Atualizado'); invalidar(); utils.ordens.core.obterPorId.invalidate({ id: ordemId }) }, onError: (e) => toast.error(e.message) })
  const aprovacaoAny = aprovacao as { cotacaoFinalizada?: boolean; cotacaoFinalizadaEm?: string | null } | null | undefined

  return (
    <div className="space-y-5">
      {aprovacaoAny?.cotacaoFinalizada ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-green-700/40 bg-green-900/10 px-3 py-2.5 text-sm">
          <span className="text-green-400 font-medium">✅ Cotação finalizada{aprovacaoAny.cotacaoFinalizadaEm ? ` em ${formatarDataHora(aprovacaoAny.cotacaoFinalizadaEm)}` : ''}</span>
          <button onClick={() => finalizarCotacaoMut.mutate({ ordemId, finalizado: false })} className="text-xs font-semibold text-green-400 underline hover:no-underline">desfazer</button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" loading={finalizarCotacaoMut.isPending} onClick={() => finalizarCotacaoMut.mutate({ ordemId, finalizado: true })}>🏁 Finalizar cotação</Button>
      )}

      <div>
        <h3 className="text-sm font-semibold text-dark-200 mb-2">Cotações</h3>
        <div className="space-y-2">
          {(cotacoes ?? []).map((c) => (
            <div key={c.id} className={`flex items-center justify-between p-2.5 rounded-lg border text-sm ${aprovacao?.cotacaoSelecionadaId === c.id ? 'border-green-600/50 bg-green-900/10' : 'border-dark-600 bg-dark-800'}`}>
              <div>
                <span className="text-dark-100">#{c.numeroSequencial} {c.transportadora}</span>
                <span className="text-dark-500 ml-2">R$ {c.valor} · {c.tipoFrete}</span>
              </div>
              {isAdmin && aprovacao?.cotacaoSelecionadaId !== c.id && (
                <Button size="sm" variant="secondary" onClick={() => aprovarMut.mutate({ ordemId, cotacaoId: c.id })}>Aprovar</Button>
              )}
            </div>
          ))}
          {(!cotacoes || cotacoes.length === 0) && <p className="text-dark-500 text-sm">Nenhuma cotação ainda</p>}
        </div>
        {isAdmin && (
          <div className="flex gap-2 mt-3">
            <Input placeholder="Transportadora" value={transportadora} onChange={(e) => setTransportadora(e.target.value)} />
            <Input placeholder="Valor" type="number" value={valor} onChange={(e) => setValor(e.target.value)} className="w-28" />
            <Select value={tipoFrete} onChange={(e) => setTipoFrete(e.target.value as any)} options={[{ value: 'FOB', label: 'FOB' }, { value: 'CIF', label: 'CIF' }]} className="w-24" />
            <Button size="sm" loading={criarMut.isPending} onClick={() => criarMut.mutate({ ordemId, transportadora, valor: valor ? Number(valor) : undefined, tipoFrete })}>Adicionar</Button>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => retiradaMut.mutate({ ordemId })}>Retirada local</Button>
          <Button size="sm" variant="secondary" onClick={() => semFreteMut.mutate({ ordemId })}>Sem frete</Button>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-dark-200 mb-2">Frete finalizado</h3>
        {finalizado?.confirmado ? (
          <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Confirmado</Badge>
        ) : isAdmin ? (
          <Button size="sm" loading={confirmarMut.isPending} onClick={() => confirmarMut.mutate({ ordemId })}>Confirmar frete finalizado</Button>
        ) : (
          <p className="text-dark-500 text-sm">Ainda não confirmado</p>
        )}
      </div>
    </div>
  )
}

function AbaPreparacao({ ordemId, isAdmin }: { ordemId: number; isAdmin: boolean }) {
  const utils = trpc.useUtils()
  const { data: prep } = trpc.ordens.preparacao.obterPreparacao.useQuery({ ordemId })
  const { data: maquinas } = trpc.ordens.preparacao.listarMaquinas.useQuery({ ordemId })
  const [modelo, setModelo] = useState('')
  const [serie, setSerie] = useState('')
  const [obs, setObs] = useState('')
  const prepAny = prep as { observacoes?: string | null; obsTravadaEm?: string | null; operadorFinalizou?: boolean; operadorFinalizouEm?: string | null } | null | undefined
  const travada = !!prepAny?.obsTravadaEm

  function invalidar() {
    utils.ordens.preparacao.obterPreparacao.invalidate({ ordemId })
    utils.ordens.preparacao.listarMaquinas.invalidate({ ordemId })
    utils.ordens.core.obterPorId.invalidate({ id: ordemId })
  }
  const criarMaquinaMut = trpc.ordens.preparacao.criarMaquina.useMutation({ onSuccess: () => { toast.success('Máquina adicionada'); invalidar(); setModelo(''); setSerie('') }, onError: (e) => toast.error(e.message) })
  const excluirMaquinaMut = trpc.ordens.preparacao.excluirMaquina.useMutation({ onSuccess: () => { toast.success('Removida'); invalidar() }, onError: (e) => toast.error(e.message) })
  const aprovarMut = trpc.ordens.preparacao.aprovarPreparacao.useMutation({ onSuccess: () => { toast.success('Preparação aprovada'); invalidar() }, onError: (e) => toast.error(e.message) })
  const salvarObsMut = trpc.ordens.preparacao.atualizarPreparacao.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const finalizarMut = trpc.ordens.preparacao.finalizarPreparacao.useMutation({ onSuccess: () => { toast.success('Atualizado'); invalidar() }, onError: (e) => toast.error(e.message) })

  return (
    <div className="space-y-5">
      <div>
        <Input
          label={`Observações da preparação${travada ? ` 🔒 travada em ${formatarDataHora(prepAny?.obsTravadaEm)}` : ''}`}
          value={travada ? (prepAny?.observacoes ?? '') : obs}
          defaultValue={travada ? undefined : (prepAny?.observacoes ?? '')}
          onChange={(e) => setObs(e.target.value)}
          disabled={!isAdmin || travada}
        />
        {isAdmin && (
          travada ? (
            <button onClick={() => salvarObsMut.mutate({ ordemId, travar: false })} className="mt-1.5 text-xs font-semibold text-gold-400 hover:text-gold-300">Editar observação</button>
          ) : (
            <Button size="sm" variant="secondary" className="mt-1.5" loading={salvarObsMut.isPending} onClick={() => salvarObsMut.mutate({ ordemId, observacoes: obs || (prepAny?.observacoes ?? ''), travar: true })}>Salvar observação</Button>
          )
        )}
      </div>

      {prepAny?.operadorFinalizou ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-green-700/40 bg-green-900/10 px-3 py-2.5 text-sm">
          <span className="text-green-400 font-medium">✅ Preparação finalizada{prepAny.operadorFinalizouEm ? ` em ${formatarDataHora(prepAny.operadorFinalizouEm)}` : ''}</span>
          <button onClick={() => finalizarMut.mutate({ ordemId, finalizado: false })} className="text-xs font-semibold text-green-400 underline hover:no-underline">desfazer</button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" loading={finalizarMut.isPending} onClick={() => finalizarMut.mutate({ ordemId, finalizado: true })}>🏁 Finalizar preparação</Button>
      )}
      <div>
        <h3 className="text-sm font-semibold text-dark-200 mb-2">Máquinas do pedido</h3>
        <div className="space-y-2">
          {(maquinas ?? []).map((m) => (
            <div key={m.id} className="flex items-center justify-between p-2.5 rounded-lg border border-dark-600 bg-dark-800 text-sm">
              <span className="text-dark-100">{m.modelo} <span className="text-dark-500">{m.numeroSerie ?? 's/ nº série'}</span> <span className="text-dark-600">(id {m.id})</span></span>
              {isAdmin && <button onClick={() => excluirMaquinaMut.mutate({ id: m.id, ordemId })} className="text-red-400 text-xs hover:underline">remover</button>}
            </div>
          ))}
        </div>
        {isAdmin && (
          <div className="flex gap-2 mt-3">
            <Input placeholder="Modelo (ex: OD-100, SEC-50)" value={modelo} onChange={(e) => setModelo(e.target.value)} />
            <Input placeholder="Nº de série" value={serie} onChange={(e) => setSerie(e.target.value)} />
            <Button size="sm" loading={criarMaquinaMut.isPending} onClick={() => criarMaquinaMut.mutate({ ordemId, modelo, numeroSerie: serie || undefined })}>Adicionar</Button>
          </div>
        )}
        <p className="text-xs text-dark-500 mt-2">Fotos exigidas por máquina (prefixo do modelo): OD = placa_vaso_pressao, placa_compressor, vaso_pressao, valvula_seguranca. SEC/SEP = placa. Suba na aba "Anexos" com a categoria "categoria__{'{id da máquina}'}" (ex: placa__{maquinas?.[0]?.id ?? 123}).</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-dark-200 mb-2">Aprovação</h3>
        {prep?.aprovadoGestor ? (
          <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Aprovada</Badge>
        ) : isAdmin ? (
          <Button size="sm" loading={aprovarMut.isPending} onClick={() => aprovarMut.mutate({ ordemId })}>Aprovar preparação</Button>
        ) : (
          <p className="text-dark-500 text-sm">Ainda não aprovada</p>
        )}
      </div>
    </div>
  )
}

function AbaFaturamento({ ordemId, isAdmin }: { ordemId: number; isAdmin: boolean }) {
  const { data, isLoading } = trpc.ordens.faturamento.obter.useQuery({ ordemId })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return <AbaFaturamentoForm ordemId={ordemId} isAdmin={isAdmin} data={data ?? null} />
}

function AbaFaturamentoForm({ ordemId, isAdmin, data }: { ordemId: number; isAdmin: boolean; data: { pagamentoConfirmado: boolean; numeroNotaFiscal: string | null; dataPagamento: string | null } | null }) {
  const utils = trpc.useUtils()
  const [nf, setNf] = useState(data?.numeroNotaFiscal ?? '')
  const [dataPag, setDataPag] = useState(data?.dataPagamento ?? '')

  function invalidar() { utils.ordens.faturamento.obter.invalidate({ ordemId }) }
  const salvarMut = trpc.ordens.faturamento.atualizar.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const confirmarMut = trpc.ordens.faturamento.confirmar.useMutation({ onSuccess: () => { toast.success('Pagamento confirmado'); invalidar() }, onError: (e) => toast.error(e.message) })

  return (
    <div className="space-y-4">
      {data?.pagamentoConfirmado && <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Pagamento confirmado</Badge>}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Número da nota fiscal" defaultValue={nf} onChange={(e) => setNf(e.target.value)} disabled={!isAdmin} />
        <Input label="Data do pagamento" defaultValue={dataPag} onChange={(e) => setDataPag(e.target.value)} disabled={!isAdmin} />
      </div>
      {isAdmin && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, numeroNotaFiscal: nf, dataPagamento: dataPag })}>Salvar</Button>
          {!data?.pagamentoConfirmado && <Button size="sm" loading={confirmarMut.isPending} onClick={() => confirmarMut.mutate({ ordemId })}>Confirmar pagamento</Button>}
        </div>
      )}
    </div>
  )
}

function AbaConferencia({ ordemId, isAdmin }: { ordemId: number; isAdmin: boolean }) {
  const utils = trpc.useUtils()
  const { data: conf } = trpc.ordens.conferencia.obter.useQuery({ ordemId })
  const { data: itens } = trpc.ordens.conferencia.listarItens.useQuery({ ordemId })

  function invalidar() {
    utils.ordens.conferencia.obter.invalidate({ ordemId })
    utils.ordens.conferencia.listarItens.invalidate({ ordemId })
  }
  const atualizarMut = trpc.ordens.conferencia.atualizar.useMutation({ onSuccess: () => invalidar(), onError: (e) => toast.error(e.message) })
  const salvarObsMut = trpc.ordens.conferencia.atualizar.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const itemMut = trpc.ordens.conferencia.atualizarItem.useMutation({ onSuccess: () => invalidar(), onError: (e) => toast.error(e.message) })
  const confirmarMut = trpc.ordens.conferencia.confirmar.useMutation({ onSuccess: () => { toast.success('Conferência confirmada'); invalidar() }, onError: (e) => toast.error(e.message) })

  const confAny = conf as { embalagemPor?: string | null; observacoes?: string | null; observacoesGerais?: string | null; obsTravadaEm?: string | null } | null | undefined
  const notasTravadas = !!confAny?.obsTravadaEm
  const [obsGerais, setObsGerais] = useState('')
  const [obsEmbal, setObsEmbal] = useState('')
  const EMBALADORES = ['RAFAEL', 'MARCUS', 'EDUARDO']

  return (
    <div className="space-y-5">
      <label className="flex items-center gap-2 text-sm text-dark-200">
        <input type="checkbox" checked={!!conf?.embalagemOk} disabled={!isAdmin} onChange={(e) => atualizarMut.mutate({ ordemId, embalagemOk: e.target.checked })} />
        Embalagem OK
      </label>

      <div>
        <label className="text-xs text-dark-400 mb-1 block">Quem embalou</label>
        <Select
          value={confAny?.embalagemPor ?? ''}
          disabled={!isAdmin || !!conf?.embalagemOk}
          onChange={(e) => atualizarMut.mutate({ ordemId, embalagemPor: e.target.value })}
          options={EMBALADORES.map((n) => ({ value: n, label: n }))}
          placeholder="Selecione..."
        />
      </div>

      <div className="space-y-2 rounded-lg border border-dark-600 p-3">
        <Input
          label={`Observações da conferência${notasTravadas ? ' 🔒' : ''}`}
          defaultValue={confAny?.observacoesGerais ?? ''}
          onChange={(e) => setObsGerais(e.target.value)}
          disabled={!isAdmin || notasTravadas}
        />
        <Input
          label="Instrução de embalagem"
          defaultValue={confAny?.observacoes ?? ''}
          onChange={(e) => setObsEmbal(e.target.value)}
          disabled={!isAdmin || notasTravadas}
        />
        {isAdmin && (
          notasTravadas ? (
            <button onClick={() => salvarObsMut.mutate({ ordemId, travar: false })} className="text-xs font-semibold text-gold-400 hover:text-gold-300">Editar observações</button>
          ) : (
            <Button size="sm" variant="secondary" loading={salvarObsMut.isPending} onClick={() => salvarObsMut.mutate({ ordemId, observacoesGerais: obsGerais || (confAny?.observacoesGerais ?? ''), observacoes: obsEmbal || (confAny?.observacoes ?? ''), travar: true })}>Salvar observações da conferência</Button>
          )
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-dark-200 mb-2">Checklist por máquina</h3>
        <div className="space-y-2">
          {(itens ?? []).map((item) => (
            <div key={item.id} className="p-2.5 rounded-lg border border-dark-600 bg-dark-800 text-sm space-y-1.5">
              <div className="text-dark-100">{item.maquina?.modelo} <span className="text-dark-500">(id {item.maquinaId})</span></div>
              <label className="flex items-center gap-2 text-xs text-dark-300">
                <input type="checkbox" checked={item.inspecaoVisualAvaria === true} onChange={() => itemMut.mutate({ ordemId, maquinaId: item.maquinaId, inspecaoVisualAvaria: true })} /> Avaria encontrada
              </label>
              <label className="flex items-center gap-2 text-xs text-dark-300">
                <input type="checkbox" checked={item.inspecaoVisualAvaria === false} onChange={() => itemMut.mutate({ ordemId, maquinaId: item.maquinaId, inspecaoVisualAvaria: false })} /> Sem avaria
              </label>
              {item.inspecaoVisualAvaria && <p className="text-xs text-yellow-500">Anexe a foto da avaria em "Anexos" com categoria avaria__{item.maquinaId}</p>}
            </div>
          ))}
          {(!itens || itens.length === 0) && <p className="text-dark-500 text-sm">Vincule máquinas na aba Preparação primeiro</p>}
        </div>
      </div>

      {conf?.confirmado ? (
        <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Confirmada</Badge>
      ) : isAdmin ? (
        <Button size="sm" loading={confirmarMut.isPending} onClick={() => confirmarMut.mutate({ ordemId })}>Confirmar conferência</Button>
      ) : null}
    </div>
  )
}

function AbaColeta({ ordemId, isAdmin }: { ordemId: number; isAdmin: boolean }) {
  const { data, isLoading } = trpc.ordens.pos.obterColeta.useQuery({ ordemId })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return <AbaColetaForm ordemId={ordemId} isAdmin={isAdmin} data={data ?? null} />
}

function AbaColetaForm({ ordemId, isAdmin, data }: { ordemId: number; isAdmin: boolean; data: { confirmado: boolean; dataColeta: string | null; transportadora: string | null } | null }) {
  const utils = trpc.useUtils()
  const [dataColeta, setDataColeta] = useState(data?.dataColeta ?? '')
  const [transportadora, setTransportadora] = useState(data?.transportadora ?? '')

  function invalidar() { utils.ordens.pos.obterColeta.invalidate({ ordemId }) }
  const salvarMut = trpc.ordens.pos.atualizarColeta.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const confirmarMut = trpc.ordens.pos.confirmarColeta.useMutation({ onSuccess: () => { toast.success('Coleta confirmada'); invalidar() }, onError: (e) => toast.error(e.message) })

  return (
    <div className="space-y-4">
      {data?.confirmado && <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Confirmada</Badge>}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Data da coleta" defaultValue={dataColeta} onChange={(e) => setDataColeta(e.target.value)} />
        <Input label="Transportadora" defaultValue={transportadora} onChange={(e) => setTransportadora(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, dataColeta, transportadora })}>Salvar</Button>
        {isAdmin && !data?.confirmado && <Button size="sm" loading={confirmarMut.isPending} onClick={() => confirmarMut.mutate({ ordemId })}>Confirmar coleta</Button>}
      </div>
    </div>
  )
}

function AbaRastreio({ ordemId, isAdmin }: { ordemId: number; isAdmin: boolean }) {
  const { data, isLoading } = trpc.ordens.pos.obterRastreio.useQuery({ ordemId })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return <AbaRastreioForm ordemId={ordemId} isAdmin={isAdmin} data={data ?? null} />
}

function AbaRastreioForm({ ordemId, isAdmin, data }: { ordemId: number; isAdmin: boolean; data: { codigoRastreio: string | null; linkRastreio: string | null; transportadora: string | null } | null }) {
  const utils = trpc.useUtils()
  const [codigo, setCodigo] = useState(data?.codigoRastreio ?? '')
  const [link, setLink] = useState(data?.linkRastreio ?? '')
  const [transportadora, setTransportadora] = useState(data?.transportadora ?? '')

  const salvarMut = trpc.ordens.pos.atualizarRastreio.useMutation({
    onSuccess: () => { toast.success('Salvo'); utils.ordens.pos.obterRastreio.invalidate({ ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Transportadora" defaultValue={transportadora} onChange={(e) => setTransportadora(e.target.value)} disabled={!isAdmin} />
        <Input label="Código de rastreio" defaultValue={codigo} onChange={(e) => setCodigo(e.target.value)} disabled={!isAdmin} />
        <Input label="Link de rastreio" defaultValue={link} onChange={(e) => setLink(e.target.value)} disabled={!isAdmin} className="col-span-2" />
      </div>
      {isAdmin && (
        <Button size="sm" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, codigoRastreio: codigo, linkRastreio: link, transportadora })}>Salvar</Button>
      )}
    </div>
  )
}

function AbaQualidade({ ordemId, isAdmin }: { ordemId: number; isAdmin: boolean }) {
  const { data, isLoading } = trpc.ordens.pos.obterQualidade.useQuery({ ordemId })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return <AbaQualidadeForm ordemId={ordemId} isAdmin={isAdmin} data={data ?? null} />
}

function AbaQualidadeForm({ ordemId, isAdmin, data }: { ordemId: number; isAdmin: boolean; data: { observacoes: string | null } | null }) {
  const utils = trpc.useUtils()
  const [obs, setObs] = useState(data?.observacoes ?? '')

  const salvarMut = trpc.ordens.pos.atualizarQualidade.useMutation({
    onSuccess: () => { toast.success('Salvo'); utils.ordens.pos.obterQualidade.invalidate({ ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <Input label="Observações" defaultValue={obs} onChange={(e) => setObs(e.target.value)} disabled={!isAdmin} />
      {isAdmin && <Button size="sm" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, observacoes: obs })}>Salvar</Button>}
    </div>
  )
}

function AbaPosVenda({ ordemId }: { ordemId: number }) {
  const { data, isLoading } = trpc.ordens.pos.obterPosVenda.useQuery({ ordemId })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return <AbaPosVendaForm ordemId={ordemId} data={data ?? null} />
}

function AbaPosVendaForm({ ordemId, data }: { ordemId: number; data: { feedbackCliente: string | null } | null }) {
  const utils = trpc.useUtils()
  const [feedback, setFeedback] = useState(data?.feedbackCliente ?? '')

  const salvarMut = trpc.ordens.pos.atualizarPosVenda.useMutation({
    onSuccess: () => { toast.success('Salvo'); utils.ordens.pos.obterPosVenda.invalidate({ ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <Input label="Feedback do cliente" defaultValue={feedback} onChange={(e) => setFeedback(e.target.value)} />
      <Button size="sm" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, feedbackCliente: feedback })}>Salvar</Button>
    </div>
  )
}

function AbaAnexos({ ordemId, stageAtual, isAdmin }: { ordemId: number; stageAtual: string; isAdmin: boolean }) {
  const utils = trpc.useUtils()
  const { data: anexos } = trpc.ordens.anexos.listar.useQuery({ ordemId })
  const [stage, setStage] = useState(stageAtual)
  const [categoria, setCategoria] = useState('')
  const [enviando, setEnviando] = useState(false)

  const registrarMut = trpc.ordens.anexos.registrar.useMutation({
    onSuccess: () => { toast.success('Anexo salvo'); utils.ordens.anexos.listar.invalidate({ ordemId }) },
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.ordens.anexos.excluir.useMutation({
    onSuccess: () => { toast.success('Anexo removido'); utils.ordens.anexos.listar.invalidate({ ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setEnviando(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('odin_token')
      const resp = await fetch('/upload/ordem-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
      registrarMut.mutate({
        ordemId,
        stage,
        fileCategory: categoria || undefined,
        nomeOriginal: json.nome,
        nomeArmazenado: json.path.replace('/uploads/', ''),
        tipoArquivo: json.tipo,
        tamanhoBytes: json.tamanho,
      })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setEnviando(false)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-end">
        <Input label="Etapa" value={stage} onChange={(e) => setStage(e.target.value)} className="w-40" />
        <Input label="Categoria (opcional)" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="ex: nf, placa__123" />
        <label className="px-4 py-2 text-sm rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 cursor-pointer">
          {enviando ? 'Enviando...' : 'Escolher arquivo'}
          <input type="file" className="hidden" onChange={handleUpload} disabled={enviando} />
        </label>
      </div>

      <div className="space-y-2">
        {(anexos ?? []).map((a) => (
          <div key={a.id} className="flex items-center justify-between p-2.5 rounded-lg border border-dark-600 bg-dark-800 text-sm">
            <a href={`/uploads/${a.nomeArmazenado}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate">
              {a.nomeOriginal} <span className="text-dark-500">({a.stage}{a.fileCategory ? ` · ${a.fileCategory}` : ''})</span>
            </a>
            {isAdmin && <button onClick={() => excluirMut.mutate({ id: a.id, ordemId })} className="text-red-400 text-xs hover:underline shrink-0 ml-2">excluir</button>}
          </div>
        ))}
        {(!anexos || anexos.length === 0) && <p className="text-dark-500 text-sm">Nenhum anexo ainda</p>}
      </div>
    </div>
  )
}

function AbaHistorico({ ordemId }: { ordemId: number }) {
  const { data } = trpc.ordens.core.historico.useQuery({ id: ordemId })
  return (
    <div className="space-y-2">
      {(data ?? []).map((h) => (
        <div key={h.id} className="p-2.5 rounded-lg border border-dark-700 bg-dark-800/50 text-sm">
          <div className="text-dark-200">{h.description}</div>
          <div className="text-dark-500 text-xs mt-0.5">{h.user?.name ?? 'sistema'} · {h.createdAt}</div>
        </div>
      ))}
      {(!data || data.length === 0) && <p className="text-dark-500 text-sm">Sem histórico ainda</p>}
    </div>
  )
}
