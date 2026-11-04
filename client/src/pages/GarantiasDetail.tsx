import { useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowRight, Ban, X, ChevronDown, ChevronRight, Pencil, Check } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { Input, Textarea } from '../components/ui/Input'
import Select from '../components/ui/Select'
import { Badge } from '../components/ui/Badge'
import { formatDateTime } from '../lib/utils'
import {
  getStageSequence,
  STAGE_LABELS,
  STAGE_COLORS,
  TIPO_ATENDIMENTO_VALUES,
  TIPO_ATENDIMENTO_LABELS,
  DESTINACAO_LABELS,
  type Stage,
  type TipoAtendimento,
} from '../lib/garantiasShared'

type TabKey = 'etapa' | 'oficina' | 'anexos' | 'historico'

export default function GarantiasDetail({ garantiaId, onClose }: { garantiaId: number; onClose: () => void }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  // 'garantias_oficina' é um poder À PARTE de 'garantias_odin' (que só
  // controla ver a tela) — pensado pra alguém da Manutenção que é
  // VENDEDOR (não admin) poder preencher só a aba Oficina. Sem isso aqui,
  // essa pessoa via a aba mas tudo ficava travado (igual quem não tem a
  // permissão nenhuma) — achado do João, 2026-10-05.
  const { data: minhasFeatures } = trpc.permissoes.minhasPermissoes.useQuery(undefined, {
    enabled: !!user && !user.superAdmin,
  })
  const podeEditarOficina = isAdmin || !!user?.superAdmin || !!minhasFeatures?.includes('garantias_oficina')
  const [tab, setTab] = useState<TabKey>('etapa')
  const [modalCancelar, setModalCancelar] = useState(false)
  const [motivoCancelamento, setMotivoCancelamento] = useState('')

  const utils = trpc.useUtils()
  const { data: garantia, isLoading } = trpc.garantias.core.obterPorId.useQuery({ id: garantiaId })

  function invalidarTudo() {
    utils.garantias.core.obterPorId.invalidate({ id: garantiaId })
    utils.garantias.core.historico.invalidate({ id: garantiaId })
    utils.garantias.core.listarKanban.invalidate()
  }

  const avancarMut = trpc.garantias.core.avancar.useMutation({
    onSuccess: () => { toast.success('Etapa avançada'); invalidarTudo() },
    onError: (e) => toast.error(e.message),
  })
  const moverMut = trpc.garantias.core.mover.useMutation({
    onSuccess: () => { toast.success('Etapa alterada'); invalidarTudo() },
    onError: (e) => toast.error(e.message),
  })
  const cancelarMut = trpc.garantias.core.cancelar.useMutation({
    onSuccess: () => { toast.success('Processo cancelado'); setModalCancelar(false); setMotivoCancelamento(''); invalidarTudo() },
    onError: (e) => toast.error(e.message),
  })

  if (isLoading) return <div className="p-6 text-dark-400 text-sm">Carregando...</div>
  if (!garantia) return <div className="p-6 text-dark-400 text-sm">Processo não encontrado</div>

  const sequencia = getStageSequence(garantia.comRetorno)
  const stageAtual = garantia.stage as Stage
  const idxAtual = sequencia.indexOf(stageAtual)
  const proximaEtapa = idxAtual >= 0 && idxAtual < sequencia.length - 1 ? sequencia[idxAtual + 1] : null

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-4 md:p-8 bg-dark-950/80 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl shadow-black/50 my-4">
        <div className="flex items-start justify-between gap-3 px-6 pt-5">
          <div>
            <h1 className="font-heading text-xl text-dark-50 font-bold">
              Garantia #{garantia.id} <span className="text-dark-500 text-base font-normal">— {garantia.cliente?.razaoSocial}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-dark-400">
              <span>Criado: <span className="text-dark-200">{formatDateTime(garantia.createdAt)}</span></span>
              <span>Nesta etapa desde: <span className="text-dark-200">{formatDateTime(garantia.updatedAt)}</span></span>
              {garantia.pedido && <span>Pedido vinculado: <span className="text-dark-200">#{garantia.pedido.id}</span></span>}
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge className={STAGE_COLORS[stageAtual] ?? 'text-gold-400 bg-gold-900/20 border-gold-700/40'}>{STAGE_LABELS[stageAtual] ?? garantia.stage}</Badge>
              {garantia.tipoAtendimento && (
                <Badge className="text-dark-300 bg-dark-700 border-dark-600">{TIPO_ATENDIMENTO_LABELS[garantia.tipoAtendimento as TipoAtendimento]}</Badge>
              )}
              {garantia.comRetorno !== null && (
                <Badge className="text-dark-300 bg-dark-700 border-dark-600">{garantia.comRetorno ? 'Com retorno' : 'Sem retorno'}</Badge>
              )}
              {garantia.status !== 'ativo' && <Badge className="text-red-400 bg-red-900/20 border-red-700/40">{garantia.status}</Badge>}
            </div>
          </div>
          <button onClick={onClose} className="text-dark-400 hover:text-dark-100 transition-colors p-1.5 rounded-lg hover:bg-dark-700 shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Sair de 'aprovacao_diretor' só pelas ações dedicadas (dentro de
            EtapaAprovacaoDiretor) — Avançar/Mover genéricos ficam
            escondidos nessa etapa pra não deixar tipoAtendimento/comRetorno
            sem definir. Sair de 'analise' é seguro pelo Avançar genérico
            (só vai pra Aprovação do Diretor Técnico, sem depender de nada
            disso). Pedido do João, 2026-10-06. */}
        {isAdmin && garantia.status === 'ativo' && stageAtual !== 'aprovacao_diretor' && (
          <div className="flex items-center gap-2 flex-wrap px-6 mt-4">
            {proximaEtapa && (
              <Button size="sm" loading={avancarMut.isPending} onClick={() => avancarMut.mutate({ id: garantiaId })}>
                <ArrowRight size={14} className="mr-1" /> Avançar pra "{STAGE_LABELS[proximaEtapa]}"
              </Button>
            )}
            <Select
              className="w-auto"
              value=""
              onChange={(e) => e.target.value && moverMut.mutate({ id: garantiaId, novaEtapa: e.target.value })}
              placeholder="Mover pra etapa..."
              options={sequencia.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
            />
            <Button size="sm" variant="danger" onClick={() => setModalCancelar(true)}>
              <Ban size={14} className="mr-1" /> Cancelar
            </Button>
          </div>
        )}
        {isAdmin && garantia.status === 'ativo' && stageAtual === 'aprovacao_diretor' && (
          <div className="flex items-center gap-2 flex-wrap px-6 mt-4">
            <Button size="sm" variant="danger" onClick={() => setModalCancelar(true)}>
              <Ban size={14} className="mr-1" /> Cancelar
            </Button>
          </div>
        )}

        <div className="flex gap-1 border-b border-dark-700 mt-4 mx-6 overflow-x-auto">
          {(['etapa', 'oficina', 'anexos', 'historico'] as TabKey[])
            .filter((t) => t !== 'oficina' || garantia.comRetorno)
            .map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${tab === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
              >
                {t === 'etapa' ? 'Dados da Etapa' : t === 'oficina' ? 'Oficina' : t === 'anexos' ? 'Anexos' : 'Histórico'}
              </button>
            ))}
        </div>

        <div className="p-6">
          {tab === 'etapa' &&
            (garantia.status === 'cancelado' ? (
              <p className="text-sm text-dark-400 text-center py-6">❌ Processo cancelado. Motivo: {garantia.cancelMotivo}</p>
            ) : stageAtual === 'analise' ? (
              <EtapaAnalise garantiaId={garantiaId} garantia={garantia} readonly={!isAdmin} />
            ) : stageAtual === 'aprovacao_diretor' ? (
              <EtapaAprovacaoDiretor garantiaId={garantiaId} garantia={garantia} readonly={!isAdmin} />
            ) : (
              <EtapaCampos garantiaId={garantiaId} stage={stageAtual} garantia={garantia} readonly={!isAdmin} />
            ))}
          {tab === 'oficina' && <EtapaOficina garantiaId={garantiaId} readonly={!podeEditarOficina} />}
          {tab === 'anexos' && <AnexosTab garantiaId={garantiaId} stageAtual={garantia.stage} />}
          {tab === 'historico' && <HistoricoTab garantiaId={garantiaId} garantia={garantia} isAdmin={isAdmin} />}
        </div>
      </div>

      <Modal open={modalCancelar} onClose={() => setModalCancelar(false)} title="Cancelar processo" size="sm">
        <div className="p-5 space-y-4">
          <Input label="Motivo do cancelamento" value={motivoCancelamento} onChange={(e) => setMotivoCancelamento(e.target.value)} />
          <Button className="w-full" variant="danger" disabled={!motivoCancelamento} loading={cancelarMut.isPending} onClick={() => cancelarMut.mutate({ id: garantiaId, motivo: motivoCancelamento })}>
            Confirmar cancelamento
          </Button>
        </div>
      </Modal>
    </div>
  )
}

type GarantiaData = {
  versao: number
  descricaoDefeito: string | null
  reclamacaoCliente: string | null
  diagnostico: string | null
  diretorDecisao: string | null
  diretorObservacoes: string | null
  modeloMaquina: string | null
  numeroSerie: string | null
  tecnicoNome: string | null
  tecnicoWhatsapp: string | null
  destinoEnvio: string | null
  nfDevolucaoNumero: string | null
  nfDevolucaoData: string | null
  preparacaoNovoItemEm: string | null
  preparacaoObservacao: string | null
  nfSaidaNumero: string | null
  nfSaidaData: string | null
  envioTransportadora: string | null
  envioCodigoRastreio: string | null
  rastreioObservacao: string | null
  retornoSolicitadoEm: string | null
  retornoObservacao: string | null
  recebidoOdinEm: string | null
}

// Etapa de triagem — ANTES de tudo. Reclamação/Produto/Diagnóstico pra
// decidir o que fazer; a única saída daqui é mandar pra "Aprovação do
// Diretor Técnico" (avançar genérico — não depende de tipo de atendimento
// nenhum, isso só é decidido mais adiante). Se o Diretor pedir nova
// abordagem, o processo volta pra cá com a observação dele visível.
// Pedido do João, 2026-10-06.
function EtapaAnalise({ garantiaId, garantia, readonly }: { garantiaId: number; garantia: GarantiaData; readonly: boolean }) {
  const utils = trpc.useUtils()
  const [reclamacao, setReclamacao] = useState(garantia.reclamacaoCliente ?? '')
  const [produto, setProduto] = useState(garantia.modeloMaquina ?? '')
  const [diagnostico, setDiagnostico] = useState(garantia.diagnostico ?? '')

  function invalidar() {
    utils.garantias.core.obterPorId.invalidate({ id: garantiaId })
    utils.garantias.core.historico.invalidate({ id: garantiaId })
    utils.garantias.core.listarKanban.invalidate()
  }

  const salvarMut = trpc.garantias.core.atualizarCampos.useMutation({
    onSuccess: () => { toast.success('Salvo'); invalidar() },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-5">
      {garantia.diretorDecisao === 'nova_abordagem' && garantia.diretorObservacoes && (
        <div className="bg-fuchsia-900/20 border border-fuchsia-700/40 rounded-xl p-3 text-sm">
          <p className="text-xs font-semibold text-fuchsia-400 uppercase tracking-wide mb-1">Diretor Técnico sugeriu nova abordagem</p>
          <p className="text-dark-200">{garantia.diretorObservacoes}</p>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs font-semibold text-dark-400 uppercase tracking-wide">Análise da reclamação</p>
        <Textarea label="Reclamação do cliente" value={reclamacao} onChange={(e) => setReclamacao(e.target.value)} disabled={readonly} />
        <Input label="Produto" value={produto} onChange={(e) => setProduto(e.target.value)} disabled={readonly} />
        <Textarea label="Diagnóstico" value={diagnostico} onChange={(e) => setDiagnostico(e.target.value)} disabled={readonly} />
        {!readonly && (
          <Button
            size="sm"
            variant="secondary"
            loading={salvarMut.isPending}
            onClick={() => salvarMut.mutate({ id: garantiaId, reclamacaoCliente: reclamacao, modeloMaquina: produto, diagnostico })}
          >
            Salvar análise
          </Button>
        )}
      </div>
    </div>
  )
}

// Diretor Técnico avalia o diagnóstico feito na Análise: aprova (libera as
// 2 saídas de verdade — abrir processo de garantia ou finalizar sem
// garantia) ou sugere nova abordagem (volta pra Análise com a observação
// dele). Pedido do João, 2026-10-06.
function EtapaAprovacaoDiretor({ garantiaId, garantia, readonly }: { garantiaId: number; garantia: GarantiaData; readonly: boolean }) {
  const utils = trpc.useUtils()
  const [modoAprovar, setModoAprovar] = useState(false)
  const [modoNovaAbordagem, setModoNovaAbordagem] = useState(false)
  const [observacoesAprovar, setObservacoesAprovar] = useState('')
  const [observacoesNovaAbordagem, setObservacoesNovaAbordagem] = useState('')
  const [modoAbrir, setModoAbrir] = useState(false)
  const [modoResolver, setModoResolver] = useState(false)
  const [tipoAtendimento, setTipoAtendimento] = useState<TipoAtendimento>('maquina_completa')
  const [comRetornoNovo, setComRetornoNovo] = useState(true)
  const [tecnicoNome, setTecnicoNome] = useState('')
  const [tecnicoWhatsapp, setTecnicoWhatsapp] = useState('')
  const [solucao, setSolucao] = useState('')
  const ehTecnico = tipoAtendimento === 'peca_tecnico'
  const aprovado = garantia.diretorDecisao === 'aprovado'

  function invalidar() {
    utils.garantias.core.obterPorId.invalidate({ id: garantiaId })
    utils.garantias.core.historico.invalidate({ id: garantiaId })
    utils.garantias.core.listarKanban.invalidate()
  }

  const aprovarAnaliseMut = trpc.garantias.core.aprovarAnaliseTecnica.useMutation({
    onSuccess: () => { toast.success('Análise Técnica aprovada'); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const sugerirMut = trpc.garantias.core.sugerirNovaAbordagem.useMutation({
    onSuccess: () => { toast.success('Enviado de volta pra Análise'); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const abrirMut = trpc.garantias.core.abrirProcesso.useMutation({
    onSuccess: () => { toast.success('Processo de garantia aberto'); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const resolverMut = trpc.garantias.core.resolverSemGarantia.useMutation({
    onSuccess: () => { toast.success('Reclamação finalizada sem necessidade de garantia'); invalidar() },
    onError: (e) => toast.error(e.message),
  })

  function confirmarAbertura() {
    if (ehTecnico && !tecnicoNome.trim()) return toast.error('Informe o nome do técnico autorizado')
    abrirMut.mutate({
      id: garantiaId,
      versao: garantia.versao,
      tipoAtendimento,
      comRetorno: ehTecnico ? comRetornoNovo : undefined,
      tecnicoNome: ehTecnico ? tecnicoNome : undefined,
      tecnicoWhatsapp: ehTecnico ? tecnicoWhatsapp : undefined,
    })
  }

  function confirmarResolucao() {
    if (!solucao.trim()) return toast.error('Descreva a solução/tratativa')
    resolverMut.mutate({ id: garantiaId, versao: garantia.versao, solucaoSemGarantia: solucao })
  }

  return (
    <div className="space-y-5">
      <div className="bg-dark-900/60 border border-dark-700 rounded-xl p-3 text-sm space-y-2">
        <p className="text-xs font-semibold text-dark-400 uppercase tracking-wide">Análise Técnica realizada</p>
        {garantia.reclamacaoCliente && (
          <p><span className="text-dark-500">Reclamação do cliente:</span> <span className="text-dark-200">{garantia.reclamacaoCliente}</span></p>
        )}
        {garantia.modeloMaquina && <p><span className="text-dark-500">Produto:</span> <span className="text-dark-200">{garantia.modeloMaquina}</span></p>}
        {garantia.diagnostico && <p><span className="text-dark-500">Diagnóstico:</span> <span className="text-dark-200">{garantia.diagnostico}</span></p>}
      </div>

      {!aprovado ? (
        <>
          {!readonly && !modoAprovar && !modoNovaAbordagem && (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" onClick={() => setModoAprovar(true)}>Aprovar Análise Técnica</Button>
              <Button size="sm" variant="secondary" onClick={() => setModoNovaAbordagem(true)}>Sugerir nova abordagem</Button>
            </div>
          )}

          {modoAprovar && (
            <div className="space-y-3 pt-4 border-t border-dark-700">
              <p className="text-sm font-semibold text-dark-200">Aprovar Análise Técnica</p>
              <Textarea label="Observações (opcional)" value={observacoesAprovar} onChange={(e) => setObservacoesAprovar(e.target.value)} />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  loading={aprovarAnaliseMut.isPending}
                  onClick={() => aprovarAnaliseMut.mutate({ id: garantiaId, versao: garantia.versao, observacoes: observacoesAprovar || undefined })}
                >
                  Confirmar aprovação
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setModoAprovar(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          {modoNovaAbordagem && (
            <div className="space-y-3 pt-4 border-t border-dark-700">
              <p className="text-sm font-semibold text-dark-200">Sugerir nova abordagem</p>
              <Textarea label="Observações *" placeholder="Nova orientação/análise/tratativa a ser realizada..." value={observacoesNovaAbordagem} onChange={(e) => setObservacoesNovaAbordagem(e.target.value)} />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  loading={sugerirMut.isPending}
                  onClick={() => {
                    if (!observacoesNovaAbordagem.trim()) return toast.error('Descreva a nova abordagem')
                    sugerirMut.mutate({ id: garantiaId, versao: garantia.versao, observacoes: observacoesNovaAbordagem })
                  }}
                >
                  Confirmar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setModoNovaAbordagem(false)}>Cancelar</Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="bg-green-900/20 border border-green-700/40 rounded-xl p-3 text-sm">
            <p className="text-green-400 font-medium">✅ Análise Técnica aprovada pelo Diretor Técnico</p>
            {garantia.diretorObservacoes && <p className="text-dark-200 mt-1">{garantia.diretorObservacoes}</p>}
          </div>

          {!readonly && !modoAbrir && !modoResolver && (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" onClick={() => setModoAbrir(true)}>Abrir processo de garantia</Button>
              <Button size="sm" variant="secondary" onClick={() => setModoResolver(true)}>
                Finalizar sem necessidade de garantia
              </Button>
            </div>
          )}

          {modoAbrir && (
            <div className="space-y-3 pt-4 border-t border-dark-700">
              <p className="text-sm font-semibold text-dark-200">Abrir processo de garantia</p>
              <Select
                label="Tipo de atendimento"
                value={tipoAtendimento}
                onChange={(e) => setTipoAtendimento(e.target.value as TipoAtendimento)}
                options={TIPO_ATENDIMENTO_VALUES.map((v) => ({ value: v, label: TIPO_ATENDIMENTO_LABELS[v] }))}
              />
              {ehTecnico && (
                <>
                  <label className="flex items-center gap-2 text-sm text-dark-200">
                    <input type="checkbox" checked={comRetornoNovo} onChange={(e) => setComRetornoNovo(e.target.checked)} /> Tem retorno do item danificado à Odin
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Nome do técnico autorizado" value={tecnicoNome} onChange={(e) => setTecnicoNome(e.target.value)} />
                    <Input label="WhatsApp do técnico" value={tecnicoWhatsapp} onChange={(e) => setTecnicoWhatsapp(e.target.value)} />
                  </div>
                </>
              )}
              <div className="flex gap-2">
                <Button size="sm" loading={abrirMut.isPending} onClick={confirmarAbertura}>Confirmar abertura</Button>
                <Button size="sm" variant="secondary" onClick={() => setModoAbrir(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          {modoResolver && (
            <div className="space-y-3 pt-4 border-t border-dark-700">
              <p className="text-sm font-semibold text-dark-200">Finalizar sem necessidade de garantia</p>
              <Textarea label="Solução/Tratativa realizada *" value={solucao} onChange={(e) => setSolucao(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" loading={resolverMut.isPending} onClick={confirmarResolucao}>Confirmar finalização</Button>
                <Button size="sm" variant="secondary" onClick={() => setModoResolver(false)}>Cancelar</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Form genérico por etapa — a maioria das etapas de Garantias tem só 1-3
// campos, então uma mutation só (atualizarCampos) cobre todas, em vez de um
// componente dedicado por etapa (diferente do módulo de Ordens, que tem
// etapas bem mais pesadas).
function EtapaCampos({ garantiaId, stage, garantia, readonly }: { garantiaId: number; stage: Stage; garantia: GarantiaData; readonly: boolean }) {
  const utils = trpc.useUtils()
  const [campos, setCampos] = useState<Record<string, string>>({})
  const salvarMut = trpc.garantias.core.atualizarCampos.useMutation({
    onSuccess: () => { toast.success('Salvo'); utils.garantias.core.obterPorId.invalidate({ id: garantiaId }); utils.garantias.core.listarKanban.invalidate() },
    onError: (e) => toast.error(e.message),
  })

  function val(campo: keyof GarantiaData): string {
    if (campo in campos) return campos[campo]
    return (garantia[campo] as string | null) ?? ''
  }
  function set(campo: string, valor: string) {
    setCampos((prev) => ({ ...prev, [campo]: valor }))
  }
  function salvar(camposParaSalvar: string[]) {
    const corpo: any = { id: garantiaId }
    for (const c of camposParaSalvar) corpo[c] = val(c as keyof GarantiaData)
    salvarMut.mutate(corpo)
  }

  if (stage === 'aberto') {
    return (
      <div className="space-y-4">
        <Textarea label="Observações" value={val('descricaoDefeito')} onChange={(e) => set('descricaoDefeito', e.target.value)} disabled={readonly} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Modelo da máquina" value={val('modeloMaquina')} onChange={(e) => set('modeloMaquina', e.target.value)} disabled={readonly} />
          <Input label="Nº de série" value={val('numeroSerie')} onChange={(e) => set('numeroSerie', e.target.value)} disabled={readonly} />
        </div>
        {garantia.destinoEnvio === 'tecnico' && (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Nome do técnico autorizado" value={val('tecnicoNome')} onChange={(e) => set('tecnicoNome', e.target.value)} disabled={readonly} />
            <Input label="WhatsApp do técnico" value={val('tecnicoWhatsapp')} onChange={(e) => set('tecnicoWhatsapp', e.target.value)} disabled={readonly} />
          </div>
        )}
        {!readonly && (
          <Button size="sm" loading={salvarMut.isPending} onClick={() => salvar(['descricaoDefeito', 'modeloMaquina', 'numeroSerie', 'tecnicoNome', 'tecnicoWhatsapp'])}>
            Salvar
          </Button>
        )}
      </div>
    )
  }

  if (stage === 'nf_devolucao') {
    return (
      <CamposComSalvar readonly={readonly} salvando={salvarMut.isPending} onSalvar={() => salvar(['nfDevolucaoNumero', 'nfDevolucaoData'])}>
        <Input label="Número da NF de devolução" value={val('nfDevolucaoNumero')} onChange={(e) => set('nfDevolucaoNumero', e.target.value)} disabled={readonly} />
        <Input label="Data" type="date" value={val('nfDevolucaoData')} onChange={(e) => set('nfDevolucaoData', e.target.value)} disabled={readonly} />
      </CamposComSalvar>
    )
  }

  if (stage === 'preparacao_novo_item') {
    return (
      <CamposComSalvar readonly={readonly} salvando={salvarMut.isPending} onSalvar={() => salvar(['preparacaoNovoItemEm', 'preparacaoObservacao'])}>
        <Input label="Data da preparação" type="date" value={val('preparacaoNovoItemEm')} onChange={(e) => set('preparacaoNovoItemEm', e.target.value)} disabled={readonly} />
        <Textarea label="Observação" value={val('preparacaoObservacao')} onChange={(e) => set('preparacaoObservacao', e.target.value)} disabled={readonly} />
      </CamposComSalvar>
    )
  }

  if (stage === 'saida') {
    return (
      <CamposComSalvar
        readonly={readonly}
        salvando={salvarMut.isPending}
        onSalvar={() => salvar(['nfSaidaNumero', 'nfSaidaData', 'envioTransportadora', 'envioCodigoRastreio', 'rastreioObservacao'])}
      >
        <div>
          <p className="text-xs font-semibold text-dark-400 uppercase tracking-wide mb-2">NF de saída</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Número da NF" value={val('nfSaidaNumero')} onChange={(e) => set('nfSaidaNumero', e.target.value)} disabled={readonly} />
            <Input label="Data" type="date" value={val('nfSaidaData')} onChange={(e) => set('nfSaidaData', e.target.value)} disabled={readonly} />
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-dark-400 uppercase tracking-wide mb-2">Envio e rastreamento</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Transportadora" value={val('envioTransportadora')} onChange={(e) => set('envioTransportadora', e.target.value)} disabled={readonly} />
            <Input label="Código de rastreio" value={val('envioCodigoRastreio')} onChange={(e) => set('envioCodigoRastreio', e.target.value)} disabled={readonly} />
          </div>
          <Textarea
            label="Observação do rastreio"
            value={val('rastreioObservacao')}
            onChange={(e) => set('rastreioObservacao', e.target.value)}
            disabled={readonly}
          />
        </div>
      </CamposComSalvar>
    )
  }

  if (stage === 'retorno_item_danificado') {
    return (
      <CamposComSalvar readonly={readonly} salvando={salvarMut.isPending} onSalvar={() => salvar(['retornoSolicitadoEm', 'retornoObservacao'])}>
        <Input label="Data da solicitação de retorno" type="date" value={val('retornoSolicitadoEm')} onChange={(e) => set('retornoSolicitadoEm', e.target.value)} disabled={readonly} />
        <Textarea label="Observação" value={val('retornoObservacao')} onChange={(e) => set('retornoObservacao', e.target.value)} disabled={readonly} />
      </CamposComSalvar>
    )
  }

  if (stage === 'recebido_odin') {
    return (
      <CamposComSalvar readonly={readonly} salvando={salvarMut.isPending} onSalvar={() => salvar(['recebidoOdinEm'])}>
        <Input label="Data de recebimento na Odin" type="date" value={val('recebidoOdinEm')} onChange={(e) => set('recebidoOdinEm', e.target.value)} disabled={readonly} />
      </CamposComSalvar>
    )
  }

  if (stage === 'oficina') {
    return <p className="text-sm text-dark-400 text-center py-6">🔧 Item em avaliação na oficina — veja a aba "Oficina".</p>
  }

  return <p className="text-sm text-dark-400 text-center py-6">✅ Processo encerrado.</p>
}

function CamposComSalvar({ children, readonly, salvando, onSalvar }: { children: React.ReactNode; readonly: boolean; salvando: boolean; onSalvar: () => void }) {
  return (
    <div className="space-y-4">
      {children}
      {!readonly && (
        <Button size="sm" loading={salvando} onClick={onSalvar}>
          Salvar
        </Button>
      )}
    </div>
  )
}

function EtapaOficina({ garantiaId, readonly }: { garantiaId: number; readonly: boolean }) {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.garantias.oficina.obter.useQuery({ garantiaId })
  const [campos, setCampos] = useState<Record<string, string>>({})

  const salvarMut = trpc.garantias.oficina.atualizar.useMutation({
    onSuccess: () => { toast.success('Salvo'); utils.garantias.oficina.obter.invalidate({ garantiaId }) },
    onError: (e) => toast.error(e.message),
  })
  const aprovarMut = trpc.garantias.oficina.aprovar.useMutation({
    onSuccess: () => { toast.success('Destinação aprovada'); utils.garantias.oficina.obter.invalidate({ garantiaId }) },
    onError: (e) => toast.error(e.message),
  })

  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  if (!data) return <p className="text-dark-500 text-sm">Processo ainda não chegou na etapa de oficina.</p>
  const d = data

  function val(campo: string, fallback: string | null): string {
    if (campo in campos) return campos[campo]
    return fallback ?? ''
  }
  function set(campo: string, valor: string) {
    setCampos((prev) => ({ ...prev, [campo]: valor }))
  }
  function salvar() {
    salvarMut.mutate({
      garantiaId,
      entradaEm: val('entradaEm', d.entradaEm),
      modelo: val('modelo', d.modelo),
      numeroSerie: val('numeroSerie', d.numeroSerie),
      nomeCliente: val('nomeCliente', d.nomeCliente),
      avaliacaoTecnica: val('avaliacaoTecnica', d.avaliacaoTecnica),
      destinacao: (val('destinacao', d.destinacao) || undefined) as any,
      pecasUsadas: val('pecasUsadas', d.pecasUsadas),
      entregaEstoqueEm: val('entregaEstoqueEm', d.entregaEstoqueEm),
      entreguePor: val('entreguePor', d.entreguePor),
      recebidoPor: val('recebidoPor', d.recebidoPor),
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-dark-400 uppercase tracking-wide mb-2">Entrada na oficina</p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Data de entrada" type="date" value={val('entradaEm', data.entradaEm)} onChange={(e) => set('entradaEm', e.target.value)} disabled={readonly} />
          <Input label="Cliente" value={val('nomeCliente', data.nomeCliente)} onChange={(e) => set('nomeCliente', e.target.value)} disabled={readonly} />
          <Input label="Modelo" value={val('modelo', data.modelo)} onChange={(e) => set('modelo', e.target.value)} disabled={readonly} />
          <Input label="Nº de série" value={val('numeroSerie', data.numeroSerie)} onChange={(e) => set('numeroSerie', e.target.value)} disabled={readonly} />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-dark-400 uppercase tracking-wide mb-2">Avaliação técnica</p>
        <Textarea label="O que foi feito / peças usadas" value={val('avaliacaoTecnica', data.avaliacaoTecnica)} onChange={(e) => set('avaliacaoTecnica', e.target.value)} disabled={readonly} />
        <div className="mt-3">
          <Select
            label="Destinação"
            value={val('destinacao', data.destinacao)}
            onChange={(e) => set('destinacao', e.target.value)}
            disabled={readonly}
            placeholder="Escolha..."
            options={Object.entries(DESTINACAO_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!readonly && (
          <Button size="sm" loading={salvarMut.isPending} onClick={salvar}>
            Salvar
          </Button>
        )}
        {!readonly && !data.aprovadoEm && (
          <Button size="sm" variant="secondary" loading={aprovarMut.isPending} onClick={() => aprovarMut.mutate({ garantiaId })}>
            Aprovar destinação
          </Button>
        )}
        {data.aprovadoEm && <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Aprovado em {formatDateTime(data.aprovadoEm)}</Badge>}
      </div>

      <div>
        <p className="text-xs font-semibold text-dark-400 uppercase tracking-wide mb-2">Entrega ao estoque / destinação final</p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Data da entrega" type="date" value={val('entregaEstoqueEm', data.entregaEstoqueEm)} onChange={(e) => set('entregaEstoqueEm', e.target.value)} disabled={readonly} />
          <Input label="Entregue por" value={val('entreguePor', data.entreguePor)} onChange={(e) => set('entreguePor', e.target.value)} disabled={readonly} />
          <Input label="Recebido por" value={val('recebidoPor', data.recebidoPor)} onChange={(e) => set('recebidoPor', e.target.value)} disabled={readonly} />
        </div>
      </div>
    </div>
  )
}

function AnexosTab({ garantiaId, stageAtual }: { garantiaId: number; stageAtual: string }) {
  const utils = trpc.useUtils()
  const { data: anexos } = trpc.garantias.anexos.listar.useQuery({ garantiaId })
  const [enviando, setEnviando] = useState(false)

  const registrarMut = trpc.garantias.anexos.registrar.useMutation({
    onSuccess: () => { toast.success('Anexo salvo'); utils.garantias.anexos.listar.invalidate({ garantiaId }) },
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.garantias.anexos.excluir.useMutation({
    onSuccess: () => { toast.success('Anexo removido'); utils.garantias.anexos.listar.invalidate({ garantiaId }) },
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
      const resp = await fetch('/upload/garantia-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
      registrarMut.mutate({
        garantiaId,
        stage: stageAtual,
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
      <label className="px-4 py-2 text-sm rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 cursor-pointer inline-block">
        {enviando ? 'Enviando...' : 'Anexar documento/foto'}
        <input type="file" className="hidden" onChange={handleUpload} disabled={enviando} />
      </label>
      <div className="space-y-2">
        {(anexos ?? []).map((a) => (
          <div key={a.id} className="flex items-center justify-between p-2.5 rounded-lg border border-dark-600 bg-dark-800 text-sm">
            <a href={`/uploads/${a.nomeArmazenado}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate">
              {a.nomeOriginal} <span className="text-dark-500">({STAGE_LABELS[a.stage as Stage] ?? a.stage})</span>
            </a>
            <button onClick={() => excluirMut.mutate({ id: a.id, garantiaId })} className="text-red-400 text-xs hover:underline shrink-0 ml-2">excluir</button>
          </div>
        ))}
        {(!anexos || anexos.length === 0) && <p className="text-dark-500 text-sm">Nenhum anexo ainda</p>}
      </div>
    </div>
  )
}

// Histórico por etapa, igual ao dos Pedidos (HistoricoAccordion): cada
// etapa abre com os dados dela (só leitura) + os eventos; o gestor clica
// "Editar" pra corrigir os dados da etapa e no lápis pra corrigir o texto
// de um evento (pedido do João, 2026-11-04). A Aprovação do Diretor fica
// sempre só leitura aqui — os botões dela abrem/encerram o processo.
function HistoricoTab({ garantiaId, garantia, isAdmin }: { garantiaId: number; garantia: GarantiaData & { comRetorno: boolean | null }; isAdmin: boolean }) {
  const { data } = trpc.garantias.core.historico.useQuery({ id: garantiaId })
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [editandoEtapa, setEditandoEtapa] = useState<string | null>(null)
  const sequencia = getStageSequence(garantia.comRetorno)
  const grupos = new Map<string, NonNullable<typeof data>>()
  for (const h of data ?? []) {
    const k = h.stage ?? 'sem_etapa'
    grupos.set(k, [...(grupos.get(k) ?? []), h])
  }
  const etapas: string[] = [...sequencia, ...[...grupos.keys()].filter((k) => !(sequencia as readonly string[]).includes(k))]

  function toggle(k: string) {
    setAbertos((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  function dadosEtapa(stage: string, readonly: boolean) {
    if (stage === 'analise') return <EtapaAnalise garantiaId={garantiaId} garantia={garantia} readonly={readonly} />
    if (stage === 'aprovacao_diretor') return <EtapaAprovacaoDiretor garantiaId={garantiaId} garantia={garantia} readonly />
    if ((sequencia as readonly string[]).includes(stage)) return <EtapaCampos garantiaId={garantiaId} stage={stage as Stage} garantia={garantia} readonly={readonly} />
    return null
  }

  return (
    <div className="space-y-2">
      {etapas.map((stage) => {
        const eventos = grupos.get(stage) ?? []
        const aberto = abertos.has(stage)
        const editando = editandoEtapa === stage
        const podeEditarDados = isAdmin && stage !== 'aprovacao_diretor' && (sequencia as readonly string[]).includes(stage)
        return (
          <div key={stage} className="rounded-lg border border-dark-700 overflow-hidden">
            <button onClick={() => toggle(stage)} className="w-full flex items-center justify-between px-3 py-2.5 bg-dark-800/60 hover:bg-dark-800 text-left">
              <span className="flex items-center gap-2 text-sm text-dark-200">
                {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {STAGE_LABELS[stage as Stage] ?? (stage === 'sem_etapa' ? 'Outros' : stage)}
              </span>
              <span className="text-xs text-dark-500">{eventos.length} evento{eventos.length === 1 ? '' : 's'}</span>
            </button>
            {aberto && (
              <div className="p-3 space-y-3 border-t border-dark-700">
                {podeEditarDados && (
                  <button onClick={() => setEditandoEtapa(editando ? null : stage)} className="text-xs font-semibold text-gold-400 hover:text-gold-300">
                    {editando ? 'Concluir edição' : 'Editar'}
                  </button>
                )}
                {dadosEtapa(stage, !editando)}
                <div className="space-y-1.5 pt-2 border-t border-dark-700">
                  {eventos.map((h) => (
                    <HistoricoLinhaGarantia key={h.id} garantiaId={garantiaId} historicoId={h.id} description={h.description} userName={h.user?.name} createdAt={h.createdAt} isAdmin={isAdmin} />
                  ))}
                  {eventos.length === 0 && <p className="text-dark-500 text-xs">Sem eventos registrados nesta etapa</p>}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function HistoricoLinhaGarantia({ garantiaId, historicoId, description, userName, createdAt, isAdmin }: { garantiaId: number; historicoId: number; description: string; userName?: string; createdAt: string; isAdmin: boolean }) {
  const utils = trpc.useUtils()
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(description)
  const salvarMut = trpc.garantias.core.editarNotaHistorico.useMutation({
    onSuccess: () => { toast.success('Atualizado'); setEditando(false); utils.garantias.core.historico.invalidate({ id: garantiaId }) },
    onError: (e) => toast.error(e.message),
  })

  if (editando) {
    return (
      <div className="flex items-center gap-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} className="flex-1 bg-dark-900 border border-dark-600 rounded px-2 py-1 text-xs text-dark-100" />
        <button onClick={() => salvarMut.mutate({ garantiaId, historicoId, description: texto })} disabled={salvarMut.isPending} className="text-green-400 hover:text-green-300"><Check size={14} /></button>
        <button onClick={() => { setEditando(false); setTexto(description) }} className="text-dark-400 hover:text-dark-200"><X size={14} /></button>
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <div>
        <div className="text-dark-200">{description}</div>
        <div className="text-dark-500 text-xs mt-0.5">{userName ?? 'Sistema'} · {formatDateTime(createdAt)}</div>
      </div>
      {isAdmin && <button onClick={() => setEditando(true)} className="text-dark-500 hover:text-gold-400 shrink-0" title="Corrigir o texto"><Pencil size={12} /></button>}
    </div>
  )
}
