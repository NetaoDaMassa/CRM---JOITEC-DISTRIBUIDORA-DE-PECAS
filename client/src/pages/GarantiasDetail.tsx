import { useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowRight, Ban, X } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { Input, Textarea } from '../components/ui/Input'
import Select from '../components/ui/Select'
import { Badge } from '../components/ui/Badge'
import { formatDateTime } from '../lib/utils'
import { getStageSequence, STAGE_LABELS, STAGE_COLORS, TIPO_ATENDIMENTO_LABELS, DESTINACAO_LABELS, type Stage, type TipoAtendimento } from '../lib/garantiasShared'

type TabKey = 'etapa' | 'oficina' | 'anexos' | 'historico'

export default function GarantiasDetail({ garantiaId, onClose }: { garantiaId: number; onClose: () => void }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
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
              <Badge className="text-dark-300 bg-dark-700 border-dark-600">{TIPO_ATENDIMENTO_LABELS[garantia.tipoAtendimento as TipoAtendimento]}</Badge>
              <Badge className="text-dark-300 bg-dark-700 border-dark-600">{garantia.comRetorno ? 'Com retorno' : 'Sem retorno'}</Badge>
              {garantia.status !== 'ativo' && <Badge className="text-red-400 bg-red-900/20 border-red-700/40">{garantia.status}</Badge>}
            </div>
          </div>
          <button onClick={onClose} className="text-dark-400 hover:text-dark-100 transition-colors p-1.5 rounded-lg hover:bg-dark-700 shrink-0">
            <X size={18} />
          </button>
        </div>

        {isAdmin && garantia.status === 'ativo' && (
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
            ) : (
              <EtapaCampos garantiaId={garantiaId} stage={stageAtual} garantia={garantia} readonly={!isAdmin} />
            ))}
          {tab === 'oficina' && <EtapaOficina garantiaId={garantiaId} readonly={!isAdmin} />}
          {tab === 'anexos' && <AnexosTab garantiaId={garantiaId} stageAtual={garantia.stage} />}
          {tab === 'historico' && <HistoricoTab garantiaId={garantiaId} />}
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
  descricaoDefeito: string
  modeloMaquina: string | null
  numeroSerie: string | null
  tecnicoNome: string | null
  tecnicoWhatsapp: string | null
  destinoEnvio: string
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
        <Textarea label="Descrição do defeito" value={val('descricaoDefeito')} onChange={(e) => set('descricaoDefeito', e.target.value)} disabled={readonly} />
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

  if (stage === 'nf_saida') {
    return (
      <CamposComSalvar readonly={readonly} salvando={salvarMut.isPending} onSalvar={() => salvar(['nfSaidaNumero', 'nfSaidaData'])}>
        <Input label="Número da NF de saída" value={val('nfSaidaNumero')} onChange={(e) => set('nfSaidaNumero', e.target.value)} disabled={readonly} />
        <Input label="Data" type="date" value={val('nfSaidaData')} onChange={(e) => set('nfSaidaData', e.target.value)} disabled={readonly} />
      </CamposComSalvar>
    )
  }

  if (stage === 'envio') {
    return (
      <CamposComSalvar readonly={readonly} salvando={salvarMut.isPending} onSalvar={() => salvar(['envioTransportadora', 'envioCodigoRastreio'])}>
        <Input label="Transportadora" value={val('envioTransportadora')} onChange={(e) => set('envioTransportadora', e.target.value)} disabled={readonly} />
        <Input label="Código de rastreio" value={val('envioCodigoRastreio')} onChange={(e) => set('envioCodigoRastreio', e.target.value)} disabled={readonly} />
      </CamposComSalvar>
    )
  }

  if (stage === 'rastreamento') {
    return (
      <CamposComSalvar readonly={readonly} salvando={salvarMut.isPending} onSalvar={() => salvar(['rastreioObservacao'])}>
        <Textarea label="Observação do rastreio" value={val('rastreioObservacao')} onChange={(e) => set('rastreioObservacao', e.target.value)} disabled={readonly} />
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

function HistoricoTab({ garantiaId }: { garantiaId: number }) {
  const { data } = trpc.garantias.core.historico.useQuery({ id: garantiaId })
  return (
    <div className="space-y-2">
      {(data ?? []).map((h) => (
        <div key={h.id} className="p-2.5 rounded-lg border border-dark-700 bg-dark-900/40 text-sm">
          <p className="text-dark-200">{h.description}</p>
          <p className="text-xs text-dark-500 mt-0.5">
            {h.user?.name ?? 'Sistema'} · {formatDateTime(h.createdAt)}
          </p>
        </div>
      ))}
      {(!data || data.length === 0) && <p className="text-dark-500 text-sm">Nenhum evento registrado ainda</p>}
    </div>
  )
}
