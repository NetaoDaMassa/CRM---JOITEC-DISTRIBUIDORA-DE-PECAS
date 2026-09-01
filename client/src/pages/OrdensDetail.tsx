import { useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowRight, Ban, Pause, Play, X, Building2, Phone, Mail, MapPin, User } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import { Badge } from '../components/ui/Badge'
import { getStageSequence, STAGE_LABELS, STAGE_COLORS, ORDER_TYPE_LABELS, formatarDataHora, type Stage, type OrderType } from '../lib/ordensShared'
import { renderEtapa } from '../components/ordens/renderEtapa'
import EtapaGeral from '../components/ordens/EtapaGeral'
import EtapaAnexos from '../components/ordens/EtapaAnexos'
import EtapaEmail from '../components/ordens/EtapaEmail'
import HistoricoAccordion from '../components/ordens/HistoricoAccordion'

type TabKey = 'etapa' | 'geral' | 'historico' | 'anexos' | 'email'

const TAB_LABELS: Record<TabKey, string> = {
  etapa: 'Dados da Etapa',
  geral: 'Visão Geral',
  historico: 'Histórico',
  anexos: 'Anexos',
  email: 'E-mail',
}

export default function OrdensDetail({ ordemId, onClose }: { ordemId: number; onClose: () => void }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [tab, setTab] = useState<TabKey>('etapa')
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
  const stageAtual = ordem.stage as Stage
  const idxAtual = sequencia.indexOf(stageAtual)
  const proximaEtapa = idxAtual >= 0 && idxAtual < sequencia.length - 1 ? sequencia[idxAtual + 1] : null

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
              <Badge className={STAGE_COLORS[stageAtual] ?? 'text-gold-400 bg-gold-900/20 border-gold-700/40'}>{STAGE_LABELS[stageAtual] ?? ordem.stage}</Badge>
              <Badge className="text-dark-300 bg-dark-700 border-dark-600">{ORDER_TYPE_LABELS[orderType]}</Badge>
              {ordem.status !== 'ativo' && <Badge className="text-red-400 bg-red-900/20 border-red-700/40">{ordem.status}</Badge>}
              {ordem.pausadoEm && <Badge className="text-yellow-400 bg-yellow-900/20 border-yellow-700/40">Pausado: {ordem.pausadoMotivo}</Badge>}
            </div>
          </div>
          <button onClick={onClose} className="text-dark-400 hover:text-dark-100 transition-colors p-1.5 rounded-lg hover:bg-dark-700 shrink-0">
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
          {(Object.keys(TAB_LABELS) as TabKey[]).map((t) => (
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
          {tab === 'etapa' && (
            ordem.status === 'cancelado' ? (
              <p className="text-sm text-dark-400 text-center py-6">❌ Pedido cancelado. Motivo: {ordem.cancelMotivo}</p>
            ) : (
              renderEtapa(stageAtual, ordem, isAdmin, false)
            )
          )}
          {tab === 'geral' && <EtapaGeral ordemId={ordemId} />}
          {tab === 'historico' && <HistoricoAccordion ordemId={ordemId} isAdmin={isAdmin} ordem={ordem} />}
          {tab === 'anexos' && <EtapaAnexos ordemId={ordemId} stageAtual={ordem.stage} isAdmin={isAdmin} />}
          {tab === 'email' && <EtapaEmail ordemId={ordemId} stage={stageAtual} clienteEmail={ordem.cliente?.email} />}
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
