import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, ArrowRight, XCircle, RefreshCcw } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import { Badge } from '../components/ui/Badge'
import { PROPOSTA_STAGE_LABELS, PROPOSTA_STAGE_NEXT, type PropostaStage } from '../lib/propostasShared'

type TabKey = 'geral' | 'arquivos' | 'feedbacks' | 'alteracoes' | 'historico'
const TAB_LABELS: Record<TabKey, string> = { geral: 'Visão Geral', arquivos: 'Arquivos', feedbacks: 'Feedbacks', alteracoes: 'Alterações', historico: 'Histórico' }

export default function PropostaDetail() {
  const { id } = useParams()
  const propostaId = Number(id)
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [tab, setTab] = useState<TabKey>('geral')
  const [modalPerdaAberto, setModalPerdaAberto] = useState(false)
  const [motivoPerda, setMotivoPerda] = useState('')
  const [modalChamarDepoisAberto, setModalChamarDepoisAberto] = useState(false)
  const [dataRetorno, setDataRetorno] = useState('')
  const [modalConverterAberto, setModalConverterAberto] = useState(false)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [clienteId, setClienteId] = useState('')

  const utils = trpc.useUtils()
  const { data: proposta, isLoading } = trpc.propostas.obterPorId.useQuery({ id: propostaId })

  function invalidarTudo() {
    utils.propostas.obterPorId.invalidate({ id: propostaId })
    utils.propostas.listar.invalidate()
    utils.propostas.historico.invalidate({ id: propostaId })
  }

  const moverMut = trpc.propostas.moverEtapa.useMutation({ onSuccess: () => { toast.success('Etapa alterada'); invalidarTudo() }, onError: (e) => toast.error(e.message) })
  const atualizarMut = trpc.propostas.atualizar.useMutation()
  const perdaMut = trpc.propostas.marcarPerdida.useMutation({
    onSuccess: () => { toast.success('Marcada como perdida'); setModalPerdaAberto(false); setMotivoPerda(''); invalidarTudo() },
    onError: (e) => toast.error(e.message),
  })
  const converterMut = trpc.propostas.converter.useMutation({
    onSuccess: (r) => { toast.success('Convertida em pedido!'); setModalConverterAberto(false); navigate(isAdmin ? `/admin/ordens/${r.ordemId}` : `/vendedor/ordens/${r.ordemId}`) },
    onError: (e) => toast.error(e.message),
  })
  const { data: clientesResultado } = trpc.clientes.list.useQuery({ q: buscaCliente, pagina: 1 }, { enabled: buscaCliente.trim().length >= 2 })

  if (isLoading) return <div className="p-6 text-dark-400 text-sm">Carregando...</div>
  if (!proposta) return <div className="p-6 text-dark-400 text-sm">Proposta não encontrada</div>

  const stage = proposta.stage as PropostaStage
  const proximaEtapa = PROPOSTA_STAGE_NEXT[stage]
  const podeAgir = isAdmin || proposta.vendedorId === user?.id

  return (
    <div className="p-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-dark-400 hover:text-dark-200 text-sm mb-4">
        <ArrowLeft size={14} /> Voltar
      </button>

      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="font-heading text-2xl text-dark-50 font-bold">
            Proposta #{proposta.id} <span className="text-dark-500 text-base font-normal">— {proposta.clienteNome}</span>
          </h1>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge className="text-gold-400 bg-gold-900/20 border-gold-700/40">{PROPOSTA_STAGE_LABELS[stage]}</Badge>
            {proposta.prioridade === 'urgente' && <Badge className="text-yellow-400 bg-yellow-900/20 border-yellow-700/40">Urgente</Badge>}
            {proposta.vendedor && <span className="text-dark-500 text-sm">{proposta.vendedor.name}</span>}
          </div>
        </div>

        {podeAgir && stage !== 'convertido' && (
          <div className="flex items-center gap-2 flex-wrap">
            {proximaEtapa && (
              <Button size="sm" loading={moverMut.isPending} onClick={() => moverMut.mutate({ id: propostaId, novaEtapa: proximaEtapa })}>
                <ArrowRight size={14} className="mr-1" /> Avançar pra "{PROPOSTA_STAGE_LABELS[proximaEtapa]}"
              </Button>
            )}
            {stage !== 'perdido' && (
              <Button size="sm" variant="danger" onClick={() => setModalPerdaAberto(true)}>
                <XCircle size={14} className="mr-1" /> Marcar como perdida
              </Button>
            )}
            {stage !== 'chamar_depois' && (
              <Button size="sm" variant="secondary" onClick={() => setModalChamarDepoisAberto(true)}>
                <RefreshCcw size={14} className="mr-1" /> Chamar depois
              </Button>
            )}
            {isAdmin && stage === 'fechado' && (
              <Button size="sm" onClick={() => setModalConverterAberto(true)}>
                Converter em Pedido
              </Button>
            )}
          </div>
        )}
        {stage === 'convertido' && proposta.convertidoParaOrdemId && (
          <Button size="sm" variant="secondary" onClick={() => navigate(isAdmin ? `/admin/ordens/${proposta.convertidoParaOrdemId}` : `/vendedor/ordens/${proposta.convertidoParaOrdemId}`)}>
            Ver Pedido #{proposta.convertidoParaOrdemId}
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b border-dark-700 mb-5 overflow-x-auto">
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

      <div className="max-w-2xl">
        {tab === 'geral' && <AbaGeral propostaId={propostaId} podeEditar={podeAgir} isAdmin={isAdmin} />}
        {tab === 'arquivos' && <AbaArquivos propostaId={propostaId} podeEditar={podeAgir} />}
        {tab === 'feedbacks' && <AbaFeedbacks propostaId={propostaId} />}
        {tab === 'alteracoes' && <AbaAlteracoes propostaId={propostaId} />}
        {tab === 'historico' && <AbaHistorico propostaId={propostaId} />}
      </div>

      <Modal open={modalPerdaAberto} onClose={() => setModalPerdaAberto(false)} title="Marcar como perdida" size="sm">
        <div className="p-5 space-y-4">
          <Input label="Motivo" value={motivoPerda} onChange={(e) => setMotivoPerda(e.target.value)} />
          <Button className="w-full" variant="danger" disabled={!motivoPerda} loading={perdaMut.isPending} onClick={() => perdaMut.mutate({ id: propostaId, motivo: motivoPerda })}>
            Confirmar
          </Button>
        </div>
      </Modal>

      <Modal open={modalChamarDepoisAberto} onClose={() => setModalChamarDepoisAberto(false)} title="Chamar depois" size="sm">
        <div className="p-5 space-y-4">
          <Input label="Data de retorno" type="date" value={dataRetorno} onChange={(e) => setDataRetorno(e.target.value)} />
          <Button
            className="w-full"
            disabled={!dataRetorno}
            loading={atualizarMut.isPending || moverMut.isPending}
            onClick={async () => {
              try {
                await atualizarMut.mutateAsync({ id: propostaId, dataRetorno })
                await moverMut.mutateAsync({ id: propostaId, novaEtapa: 'chamar_depois' })
                setModalChamarDepoisAberto(false)
              } catch (e: any) {
                toast.error(e.message)
              }
            }}
          >
            Confirmar
          </Button>
        </div>
      </Modal>

      <Modal open={modalConverterAberto} onClose={() => setModalConverterAberto(false)} title="Converter em Pedido" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-400">Selecione o cliente cadastrado que corresponde a "{proposta.clienteNome}" pra criar o Pedido.</p>
          <Input label="Buscar cliente" value={buscaCliente} onChange={(e) => { setBuscaCliente(e.target.value); setClienteId('') }} placeholder="Nome ou código..." />
          {clientesResultado && clientesResultado.items.length > 0 && !clienteId && (
            <div className="max-h-40 overflow-y-auto border border-dark-600 rounded-lg bg-dark-800">
              {clientesResultado.items.map((c) => (
                <button key={c.id} className="w-full text-left px-3 py-2 text-sm text-dark-200 hover:bg-dark-700" onClick={() => { setClienteId(String(c.id)); setBuscaCliente(c.razaoSocial) }}>
                  {c.razaoSocial}
                </button>
              ))}
            </div>
          )}
          <Button className="w-full" disabled={!clienteId || converterMut.isPending} loading={converterMut.isPending} onClick={() => converterMut.mutate({ propostaId, clienteId: Number(clienteId) })}>
            Converter
          </Button>
        </div>
      </Modal>
    </div>
  )
}

// AbaGeralForm só monta depois que a proposta já carregou (guard abaixo) —
// senão o useState que pré-preenche cada campo roda antes da query voltar
// e trava vazio pra sempre, mesmo o servidor já tendo o valor certo (bug
// real, achado testando a conversão Proposta→Pedido — mesma correção
// aplicada nas abas equivalentes de OrdensDetail.tsx).
function AbaGeral({ propostaId, podeEditar, isAdmin }: { propostaId: number; podeEditar: boolean; isAdmin: boolean }) {
  const { data: proposta, isLoading } = trpc.propostas.obterPorId.useQuery({ id: propostaId })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  if (!proposta) return null
  return <AbaGeralForm propostaId={propostaId} podeEditar={podeEditar} isAdmin={isAdmin} proposta={proposta} />
}

function AbaGeralForm({
  propostaId,
  podeEditar,
  isAdmin,
  proposta,
}: {
  propostaId: number
  podeEditar: boolean
  isAdmin: boolean
  proposta: {
    stage: string
    clienteWhatsapp: string | null
    produtosDescricao: string | null
    comissao: string | null
    revenda: string | null
    formaPagamento: string | null
    observacoes: string | null
  }
}) {
  const utils = trpc.useUtils()
  const [clienteWhatsapp, setClienteWhatsapp] = useState(proposta?.clienteWhatsapp ?? '')
  const [produtosDescricao, setProdutosDescricao] = useState(proposta?.produtosDescricao ?? '')
  const [comissao, setComissao] = useState(proposta?.comissao ?? '')
  const [revenda, setRevenda] = useState(proposta?.revenda ?? '')
  const [formaPagamento, setFormaPagamento] = useState(proposta?.formaPagamento ?? '')
  const [observacoes, setObservacoes] = useState(proposta?.observacoes ?? '')

  const salvarMut = trpc.propostas.atualizar.useMutation({
    onSuccess: () => { toast.success('Salvo'); utils.propostas.obterPorId.invalidate({ id: propostaId }) },
    onError: (e) => toast.error(e.message),
  })

  // Campo trava pro vendedor fora da etapa "proposta" — mesma regra do backend.
  const produtosTravado = !isAdmin && proposta.stage !== 'proposta'

  return (
    <div className="space-y-4">
      <Input label="WhatsApp do cliente" defaultValue={clienteWhatsapp} onChange={(e) => setClienteWhatsapp(e.target.value)} disabled={!podeEditar} />
      <div>
        <Input label="Produtos/Serviços" defaultValue={produtosDescricao} onChange={(e) => setProdutosDescricao(e.target.value)} disabled={!podeEditar || produtosTravado} />
        {produtosTravado && <p className="text-xs text-yellow-500 mt-1">Travado após o envio — use a aba "Alterações" pra pedir mudança.</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Comissão" defaultValue={comissao} onChange={(e) => setComissao(e.target.value)} disabled={!podeEditar} />
        <Input label="Revenda" defaultValue={revenda} onChange={(e) => setRevenda(e.target.value)} disabled={!podeEditar} />
        <Input label="Forma de pagamento" defaultValue={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)} disabled={!podeEditar} />
      </div>
      <Input label="Observações" defaultValue={observacoes} onChange={(e) => setObservacoes(e.target.value)} disabled={!podeEditar} />
      {podeEditar && (
        <Button
          size="sm"
          loading={salvarMut.isPending}
          onClick={() => salvarMut.mutate({ id: propostaId, clienteWhatsapp, produtosDescricao, comissao, revenda, formaPagamento, observacoes })}
        >
          Salvar
        </Button>
      )}
    </div>
  )
}

function AbaArquivos({ propostaId, podeEditar }: { propostaId: number; podeEditar: boolean }) {
  const utils = trpc.useUtils()
  const { data: arquivos } = trpc.propostas.listarArquivos.useQuery({ propostaId })
  const [categoria, setCategoria] = useState('proposta_pdf')
  const [enviando, setEnviando] = useState(false)

  const registrarMut = trpc.propostas.registrarArquivo.useMutation({
    onSuccess: () => { toast.success('Anexo salvo'); utils.propostas.listarArquivos.invalidate({ propostaId }); utils.propostas.listar.invalidate() },
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.propostas.excluirArquivo.useMutation({
    onSuccess: () => { toast.success('Removido'); utils.propostas.listarArquivos.invalidate({ propostaId }); utils.propostas.listar.invalidate() },
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
      const resp = await fetch('/upload/proposta-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
      registrarMut.mutate({ propostaId, fileCategory: categoria || undefined, nomeOriginal: json.nome, nomeArmazenado: json.path.replace('/uploads/', ''), tipoArquivo: json.tipo, tamanhoBytes: json.tamanho })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setEnviando(false)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-4">
      {podeEditar && (
        <div className="flex gap-2 items-end">
          <Select label="Categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} options={[{ value: 'proposta_pdf', label: 'PDF da proposta' }, { value: 'dados_cadastrais', label: 'Dados cadastrais' }]} className="w-56" />
          <label className="px-4 py-2 text-sm rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 cursor-pointer">
            {enviando ? 'Enviando...' : 'Escolher arquivo'}
            <input type="file" className="hidden" onChange={handleUpload} disabled={enviando} />
          </label>
        </div>
      )}
      <div className="space-y-2">
        {(arquivos ?? []).map((a) => (
          <div key={a.id} className="flex items-center justify-between p-2.5 rounded-lg border border-dark-600 bg-dark-800 text-sm">
            <a href={`/uploads/${a.nomeArmazenado}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate">
              {a.nomeOriginal} {a.fileCategory && <span className="text-dark-500">({a.fileCategory})</span>}
            </a>
            {podeEditar && <button onClick={() => excluirMut.mutate({ id: a.id, propostaId })} className="text-red-400 text-xs hover:underline shrink-0 ml-2">excluir</button>}
          </div>
        ))}
        {(!arquivos || arquivos.length === 0) && <p className="text-dark-500 text-sm">Nenhum anexo ainda</p>}
      </div>
    </div>
  )
}

function AbaFeedbacks({ propostaId }: { propostaId: number }) {
  const utils = trpc.useUtils()
  const { data: feedbacks } = trpc.propostas.listarFeedbacks.useQuery({ propostaId })
  const [conteudo, setConteudo] = useState('')

  const enviarMut = trpc.propostas.adicionarFeedback.useMutation({
    onSuccess: () => { setConteudo(''); utils.propostas.listarFeedbacks.invalidate({ propostaId }) },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input value={conteudo} onChange={(e) => setConteudo(e.target.value)} placeholder="Escrever um feedback..." className="flex-1" />
        <Button size="sm" disabled={!conteudo} loading={enviarMut.isPending} onClick={() => enviarMut.mutate({ propostaId, conteudo })}>Enviar</Button>
      </div>
      <div className="space-y-2">
        {(feedbacks ?? []).map((f: any) => (
          <div key={f.id} className="p-2.5 rounded-lg border border-dark-700 bg-dark-800/50 text-sm">
            <div className="text-dark-200">{f.conteudo}</div>
            <div className="text-dark-500 text-xs mt-0.5">{f.vendedor?.name ?? '—'} · {f.createdAt}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AbaAlteracoes({ propostaId }: { propostaId: number }) {
  const utils = trpc.useUtils()
  const { data: alteracoes } = trpc.propostas.listarAlteracoes.useQuery({ propostaId })
  const [conteudo, setConteudo] = useState('')

  const enviarMut = trpc.propostas.solicitarAlteracao.useMutation({
    onSuccess: () => {
      toast.success('Alteração solicitada — proposta voltou pra "Proposta"')
      setConteudo('')
      utils.propostas.listarAlteracoes.invalidate({ propostaId })
      utils.propostas.obterPorId.invalidate({ id: propostaId })
      utils.propostas.listar.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input value={conteudo} onChange={(e) => setConteudo(e.target.value)} placeholder="O que precisa mudar?" className="flex-1" />
        <Button size="sm" disabled={!conteudo} loading={enviarMut.isPending} onClick={() => enviarMut.mutate({ propostaId, conteudo })}>Solicitar</Button>
      </div>
      <div className="space-y-2">
        {(alteracoes ?? []).map((a: any) => (
          <div key={a.id} className="p-2.5 rounded-lg border border-dark-700 bg-dark-800/50 text-sm">
            <div className="text-dark-200">{a.conteudo}</div>
            <div className="text-dark-500 text-xs mt-0.5">{a.solicitante?.name ?? '—'} · {a.createdAt}</div>
          </div>
        ))}
        {(!alteracoes || alteracoes.length === 0) && <p className="text-dark-500 text-sm">Nenhuma alteração solicitada ainda</p>}
      </div>
    </div>
  )
}

function AbaHistorico({ propostaId }: { propostaId: number }) {
  const { data } = trpc.propostas.historico.useQuery({ id: propostaId })
  return (
    <div className="space-y-2">
      {(data ?? []).map((h: any) => (
        <div key={h.id} className="p-2.5 rounded-lg border border-dark-700 bg-dark-800/50 text-sm">
          <div className="text-dark-200">
            {h.etapaAnterior ? `${PROPOSTA_STAGE_LABELS[h.etapaAnterior as PropostaStage] ?? h.etapaAnterior} → ` : ''}
            {PROPOSTA_STAGE_LABELS[h.etapaNova as PropostaStage] ?? h.etapaNova}
            {h.nota && <span className="text-dark-400"> — {h.nota}</span>}
          </div>
          <div className="text-dark-500 text-xs mt-0.5">{h.user?.name ?? 'sistema'} · {h.createdAt}</div>
        </div>
      ))}
      {(!data || data.length === 0) && <p className="text-dark-500 text-sm">Sem histórico ainda</p>}
    </div>
  )
}
