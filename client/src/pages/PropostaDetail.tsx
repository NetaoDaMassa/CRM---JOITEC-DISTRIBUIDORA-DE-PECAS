import { useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowRight, ArrowLeft, XCircle, RefreshCcw, X, Paperclip, Trash2, MessageCircle, Send, AlertCircle } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { Input, Textarea } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { PROPOSTA_STAGE_LABELS, PROPOSTA_STAGE_NEXT, PROPOSTA_STAGE_PREV, type PropostaStage } from '../lib/propostasShared'
import ProductSelector from '../components/ProductSelector'
import { formatDateTime } from '../lib/utils'

export default function PropostaDetail({ propostaId, onClose }: { propostaId: number; onClose: () => void }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [modalPerdaAberto, setModalPerdaAberto] = useState(false)
  const [motivoPerda, setMotivoPerda] = useState('')
  const [modalChamarDepoisAberto, setModalChamarDepoisAberto] = useState(false)
  const [dataRetorno, setDataRetorno] = useState('')
  const [modalConverterAberto, setModalConverterAberto] = useState(false)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [modalExcluirAberto, setModalExcluirAberto] = useState(false)

  const utils = trpc.useUtils()
  const { data: proposta, isLoading } = trpc.propostas.obterPorId.useQuery({ id: propostaId })

  function invalidarTudo() {
    utils.propostas.obterPorId.invalidate({ id: propostaId })
    utils.propostas.listar.invalidate()
  }

  const moverMut = trpc.propostas.moverEtapa.useMutation({ onSuccess: () => { toast.success('Etapa alterada'); invalidarTudo() }, onError: (e) => toast.error(e.message) })
  const atualizarMut = trpc.propostas.atualizar.useMutation()
  const perdaMut = trpc.propostas.marcarPerdida.useMutation({
    onSuccess: () => { toast.success('Marcada como perdida'); setModalPerdaAberto(false); setMotivoPerda(''); invalidarTudo() },
    onError: (e) => toast.error(e.message),
  })
  const converterMut = trpc.propostas.converter.useMutation({
    onSuccess: (r) => { toast.success('Convertida em pedido!'); setModalConverterAberto(false); onClose(); window.location.assign(isAdmin ? `/admin/ordens/${r.ordemId}` : `/vendedor/ordens/${r.ordemId}`) },
    onError: (e) => toast.error(e.message),
  })
  const { data: clientesResultado } = trpc.clientes.list.useQuery({ q: buscaCliente, pagina: 1 }, { enabled: buscaCliente.trim().length >= 2 })
  const excluirMut = trpc.propostas.excluir.useMutation({
    onSuccess: () => { toast.success('Proposta excluída'); onClose(); utils.propostas.listar.invalidate() },
    onError: (e) => toast.error(e.message),
  })

  if (isLoading) return <div className="p-6 text-dark-400 text-sm">Carregando...</div>
  if (!proposta) return <div className="p-6 text-dark-400 text-sm">Proposta não encontrada</div>

  const stage = proposta.stage as PropostaStage
  const proximaEtapa = PROPOSTA_STAGE_NEXT[stage]
  const etapaAnterior = isAdmin ? PROPOSTA_STAGE_PREV[stage] : undefined
  const podeAgir = isAdmin || proposta.vendedorId === user?.id

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-4 md:p-8 bg-dark-950/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl shadow-black/50 my-4">
        <div className="flex items-start justify-between gap-3 px-6 pt-5">
          <div>
            <h1 className="font-heading text-xl text-dark-50 font-bold">{proposta.clienteNome}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-dark-400">
              <span>Proposta #{proposta.id} · <span className="text-dark-200">{proposta.vendedor?.name ?? '—'}</span></span>
              <span>Criada em <span className="text-dark-200">{formatDateTime(proposta.createdAt)}</span></span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge className="text-gold-400 bg-gold-900/20 border-gold-700/40">{PROPOSTA_STAGE_LABELS[stage]}</Badge>
              {proposta.prioridade === 'urgente' && <Badge className="text-red-400 bg-red-900/20 border-red-700/40">🔴 Urgente</Badge>}
            </div>
          </div>
          <button onClick={onClose} className="text-dark-400 hover:text-dark-100 transition-colors p-1.5 rounded-lg hover:bg-dark-700 shrink-0">
            <X size={18} />
          </button>
        </div>

        {podeAgir && stage !== 'convertido' && (
          <div className="flex items-center gap-2 flex-wrap px-6 mt-4">
            {etapaAnterior && (
              <Button size="sm" variant="secondary" loading={moverMut.isPending} onClick={() => moverMut.mutate({ id: propostaId, novaEtapa: etapaAnterior })}>
                <ArrowLeft size={14} className="mr-1" /> Voltar pra "{PROPOSTA_STAGE_LABELS[etapaAnterior]}"
              </Button>
            )}
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
          <div className="px-6 mt-4">
            <Button size="sm" variant="secondary" onClick={() => window.location.assign(isAdmin ? `/admin/ordens/${proposta.convertidoParaOrdemId}` : `/vendedor/ordens/${proposta.convertidoParaOrdemId}`)}>
              Ver Pedido #{proposta.convertidoParaOrdemId}
            </Button>
          </div>
        )}
        {isAdmin && (
          <div className="flex justify-end px-6 mt-2">
            <button onClick={() => setModalExcluirAberto(true)} className="flex items-center gap-1 text-xs text-dark-500 hover:text-red-400 transition-colors">
              <Trash2 size={12} /> Excluir proposta
            </button>
          </div>
        )}

        <div className="p-6">
          <PropostaForm propostaId={propostaId} podeEditar={podeAgir} isAdmin={isAdmin} proposta={proposta} onClose={onClose} atualizarMut={atualizarMut} />
        </div>
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

      <Modal open={modalExcluirAberto} onClose={() => setModalExcluirAberto(false)} title="Excluir proposta" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Excluir a proposta de "{proposta.clienteNome}"? Essa ação não pode ser desfeita — remove arquivos, feedbacks e histórico junto.</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setModalExcluirAberto(false)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={excluirMut.isPending} onClick={() => excluirMut.mutate({ id: propostaId })}>Excluir</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// Formulário único (sem abas) — porte direto do PropostaModal.tsx do
// sistema antigo: tudo numa rolagem só (dados principais, PDF, alterações,
// feedbacks, compartilhar por WhatsApp), não dividido em abas separadas
// como a versão anterior desta tela (achado do João, 2026-09-01 — "tem que
// ser idêntico ao outro sistema").
function PropostaForm({
  propostaId,
  podeEditar,
  isAdmin,
  proposta,
  onClose,
  atualizarMut,
}: {
  propostaId: number
  podeEditar: boolean
  isAdmin: boolean
  proposta: {
    stage: string
    clienteNome: string
    clienteWhatsapp: string | null
    produtosDescricao: string | null
    produtosItens: string | null
    comissao: string | null
    revenda: string | null
    formaPagamento: string | null
    observacoes: string | null
    prioridade: string
    motivoUrgencia: string | null
    vendedor?: { name: string; whatsapp: string | null } | null
  }
  onClose: () => void
  atualizarMut: ReturnType<typeof trpc.propostas.atualizar.useMutation>
}) {
  const utils = trpc.useUtils()
  const [clienteNome, setClienteNome] = useState(proposta.clienteNome)
  const [clienteWhatsapp, setClienteWhatsapp] = useState(proposta.clienteWhatsapp ?? '')
  const [produtosDescricao, setProdutosDescricao] = useState(proposta.produtosDescricao ?? '')
  const [produtosItens, setProdutosItens] = useState(proposta.produtosItens ?? '')
  const [comissao, setComissao] = useState(proposta.comissao ?? '')
  const [revenda, setRevenda] = useState(proposta.revenda ?? '')
  const [formaPagamento, setFormaPagamento] = useState(proposta.formaPagamento ?? '')
  const [observacoes, setObservacoes] = useState(proposta.observacoes ?? '')
  const [prioridade, setPrioridade] = useState(proposta.prioridade ?? 'normal')
  const [motivoUrgencia, setMotivoUrgencia] = useState(proposta.motivoUrgencia ?? '')
  const [enviandoPdf, setEnviandoPdf] = useState(false)
  const [enviandoCad, setEnviandoCad] = useState(false)
  const [novaAlteracao, setNovaAlteracao] = useState('')
  const [novoFeedback, setNovoFeedback] = useState('')

  const { data: revendas } = trpc.revendas.listar.useQuery(undefined, { retry: false })
  const { data: condicoes } = trpc.configuracoesOdin.listarCondicoes.useQuery(undefined, { retry: false })
  const { data: arquivos } = trpc.propostas.listarArquivos.useQuery({ propostaId })
  const { data: alteracoes } = trpc.propostas.listarAlteracoes.useQuery({ propostaId })
  const { data: feedbacks } = trpc.propostas.listarFeedbacks.useQuery({ propostaId })

  const salvarMut = trpc.propostas.atualizar.useMutation({
    onSuccess: () => { toast.success('Salvo'); utils.propostas.obterPorId.invalidate({ id: propostaId }); utils.propostas.listar.invalidate() },
    onError: (e) => toast.error(e.message),
  })
  const registrarArquivoMut = trpc.propostas.registrarArquivo.useMutation({
    onSuccess: () => { utils.propostas.listarArquivos.invalidate({ propostaId }); utils.propostas.listar.invalidate() },
    onError: (e) => toast.error(e.message),
  })
  const excluirArquivoMut = trpc.propostas.excluirArquivo.useMutation({
    onSuccess: () => { toast.success('Removido'); utils.propostas.listarArquivos.invalidate({ propostaId }); utils.propostas.listar.invalidate() },
    onError: (e) => toast.error(e.message),
  })
  const solicitarAlteracaoMut = trpc.propostas.solicitarAlteracao.useMutation({
    onSuccess: () => {
      toast.success('Alteração solicitada — proposta voltou pra "Proposta"')
      setNovaAlteracao('')
      utils.propostas.listarAlteracoes.invalidate({ propostaId })
      utils.propostas.obterPorId.invalidate({ id: propostaId })
      utils.propostas.listar.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const feedbackMut = trpc.propostas.adicionarFeedback.useMutation({
    onSuccess: () => { setNovoFeedback(''); utils.propostas.listarFeedbacks.invalidate({ propostaId }) },
    onError: (e) => toast.error(e.message),
  })

  const produtosTravado = !isAdmin && proposta.stage !== 'proposta'
  const pdfFiles = (arquivos ?? []).filter((a) => a.fileCategory === 'proposta_pdf')
  const cadFiles = (arquivos ?? []).filter((a) => a.fileCategory === 'dados_cadastrais')
  const hasPdf = pdfFiles.length > 0

  async function handleUpload(file: File, categoria: 'proposta_pdf' | 'dados_cadastrais') {
    categoria === 'proposta_pdf' ? setEnviandoPdf(true) : setEnviandoCad(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('odin_token')
      const resp = await fetch('/upload/proposta-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
      await registrarArquivoMut.mutateAsync({ propostaId, fileCategory: categoria, nomeOriginal: json.nome, nomeArmazenado: json.path.replace('/uploads/', ''), tipoArquivo: json.tipo, tamanhoBytes: json.tamanho })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setEnviandoPdf(false)
      setEnviandoCad(false)
    }
  }

  function salvarTudo() {
    salvarMut.mutate({ id: propostaId, clienteNome, clienteWhatsapp, produtosDescricao, produtosItens, comissao, revenda, formaPagamento, observacoes, prioridade: prioridade as 'normal' | 'urgente', motivoUrgencia })
  }

  function compartilharWhatsapp() {
    const linhas = [
      'Olá! Segue o resumo da proposta:',
      '',
      `Cliente: ${clienteNome}`,
      produtosDescricao ? `Produtos/Serviços: ${produtosDescricao}` : null,
      formaPagamento ? `Forma de pagamento: ${formaPagamento}` : null,
      comissao ? `Comissão: ${comissao}` : null,
      revenda ? `Revenda: ${revenda}` : null,
      observacoes ? `\nInformações para cadastro: ${observacoes}` : null,
      pdfFiles[0] ? `\n📄 PDF da proposta:\n${window.location.origin}/uploads/${pdfFiles[0].nomeArmazenado}` : null,
      '',
      proposta.vendedor?.name ? `Vendedor: ${proposta.vendedor.name}` : null,
    ].filter((l) => l !== null)
    window.open(`https://wa.me/?text=${encodeURIComponent(linhas.join('\n'))}`, '_blank')
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4">
        <Input label="Cliente *" value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} disabled={!podeEditar} />

        <div>
          <label className="text-xs text-dark-400 mb-1.5 block">Prioridade</label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!podeEditar}
              onClick={() => { setPrioridade('normal'); setMotivoUrgencia('') }}
              className={`flex-1 rounded-lg border-2 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                prioridade === 'normal' ? 'border-green-500 bg-green-900/20 text-green-400' : 'border-dark-600 text-dark-400 hover:border-dark-500'
              }`}
            >
              ✅ Normal
            </button>
            <button
              type="button"
              disabled={!podeEditar}
              onClick={() => setPrioridade('urgente')}
              className={`flex-1 rounded-lg border-2 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                prioridade === 'urgente' ? 'border-red-500 bg-red-900/20 text-red-400' : 'border-dark-600 text-dark-400 hover:border-dark-500'
              }`}
            >
              🔴 Urgente
            </button>
          </div>
          {prioridade === 'urgente' && (
            <div className="mt-2">
              <Input label="Motivo da urgência" placeholder="Ex: Prazo de entrega do cliente, concorrência..." defaultValue={motivoUrgencia} onChange={(e) => setMotivoUrgencia(e.target.value)} disabled={!podeEditar} />
            </div>
          )}
        </div>

        <div>
          <label className="text-xs text-dark-400 mb-1.5 block">Produtos/Serviços</label>
          <ProductSelector value={produtosDescricao} onChange={setProdutosDescricao} itensJson={produtosItens} onItensChange={setProdutosItens} disabled={!podeEditar || produtosTravado} />
          {produtosTravado && <p className="text-xs text-yellow-500 mt-1">Travado após o envio — peça uma alteração na seção "Alterações" mais abaixo.</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Comissão" defaultValue={comissao} onChange={(e) => setComissao(e.target.value)} disabled={!podeEditar} />
          <div>
            <Input label="Revenda" list="revendas-proposta" defaultValue={revenda} onChange={(e) => setRevenda(e.target.value)} disabled={!podeEditar} />
            <datalist id="revendas-proposta">{(revendas ?? []).map((r) => <option key={r.id} value={r.nome} />)}</datalist>
          </div>
        </div>
        <div>
          <Input label="Forma de pagamento" list="condicoes-proposta" defaultValue={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)} disabled={!podeEditar} placeholder="Ex: 30/60/90 dias" />
          <datalist id="condicoes-proposta">{(condicoes ?? []).map((c) => <option key={c.id} value={c.nome} />)}</datalist>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-dark-400 block">Informações para Cadastro</label>
            {podeEditar && (
              <label className="flex items-center gap-1 text-xs text-dark-400 hover:text-gold-400 cursor-pointer">
                <Paperclip size={12} /> {enviandoCad ? 'Enviando...' : 'Anexar'}
                <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f, 'dados_cadastrais'); e.target.value = '' }} disabled={enviandoCad} />
              </label>
            )}
          </div>
          <Textarea defaultValue={observacoes} onChange={(e) => setObservacoes(e.target.value)} disabled={!podeEditar} className="h-16" />
          {cadFiles.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {cadFiles.map((f) => (
                <div key={f.id} className="flex items-center gap-2 rounded-lg bg-dark-900 px-2.5 py-1.5">
                  <Paperclip size={11} className="text-blue-400 shrink-0" />
                  <a href={`/uploads/${f.nomeArmazenado}`} download={f.nomeOriginal} className="flex-1 text-xs text-blue-400 hover:underline truncate">{f.nomeOriginal}</a>
                  {podeEditar && <button onClick={() => excluirArquivoMut.mutate({ id: f.id, propostaId })} className="text-dark-500 hover:text-red-400 shrink-0"><Trash2 size={11} /></button>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-dark-600 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-dark-400 uppercase tracking-wide">
            PDF da Proposta {proposta.stage === 'proposta' && <span className="text-red-400 ml-1">*obrigatório para avançar</span>}
          </p>
          {podeEditar && (
            <label className="flex items-center gap-1.5 rounded-lg bg-gold-600 hover:bg-gold-500 px-3 py-1.5 text-xs font-semibold text-dark-950 cursor-pointer">
              {enviandoPdf ? 'Enviando...' : 'Anexar PDF'}
              <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f, 'proposta_pdf'); e.target.value = '' }} disabled={enviandoPdf} />
            </label>
          )}
        </div>
        {pdfFiles.length === 0 ? (
          <p className="text-xs text-dark-500 text-center py-2">Nenhum PDF anexado</p>
        ) : (
          <div className="space-y-1">
            {pdfFiles.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-lg bg-dark-900 px-3 py-2">
                <span className="flex-1 min-w-0 text-xs text-blue-400 truncate"><a href={`/uploads/${f.nomeArmazenado}`} download={f.nomeOriginal} className="hover:underline">{f.nomeOriginal}</a></span>
                {podeEditar && <button onClick={() => excluirArquivoMut.mutate({ id: f.id, propostaId })} className="text-dark-500 hover:text-red-400 shrink-0"><Trash2 size={13} /></button>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-amber-700/40 p-4 space-y-3">
        <p className="text-xs font-semibold text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
          <AlertCircle size={13} /> Alterações{(alteracoes?.length ?? 0) > 0 ? ` (${alteracoes!.length})` : ''}
        </p>
        <div className="space-y-2">
          {(alteracoes ?? []).map((a: any, idx: number) => (
            <div key={a.id} className="rounded-lg bg-amber-900/10 border border-amber-800/40 px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="rounded-full bg-amber-800/60 px-2 py-0.5 text-[10px] font-bold text-amber-300">Alteração {idx + 1}</span>
                <span className="text-[10px] text-dark-500">{a.solicitante?.name ?? '—'} · {formatDateTime(a.createdAt)}</span>
              </div>
              <p className="text-sm text-dark-300 whitespace-pre-line">{a.conteudo}</p>
            </div>
          ))}
          {(!alteracoes || alteracoes.length === 0) && <p className="text-xs text-dark-500 text-center py-1">Nenhuma alteração solicitada ainda</p>}
        </div>
        <div className="flex gap-2">
          <Input value={novaAlteracao} onChange={(e) => setNovaAlteracao(e.target.value)} placeholder="O que precisa mudar?" className="flex-1" />
          <Button size="sm" variant="secondary" disabled={!novaAlteracao} loading={solicitarAlteracaoMut.isPending} onClick={() => solicitarAlteracaoMut.mutate({ propostaId, conteudo: novaAlteracao })}>Solicitar</Button>
        </div>
      </div>

      {proposta.stage === 'negociacao' && (
        <div className="rounded-xl border border-orange-700/40 p-4 space-y-3">
          <p className="text-xs font-semibold text-orange-400 uppercase tracking-wide">Acompanhamento da Negociação</p>
          <div className="space-y-2">
            {(feedbacks ?? []).map((f: any, idx: number) => (
              <div key={f.id} className="rounded-lg bg-orange-900/10 border border-orange-800/40 px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="rounded-full bg-orange-800/60 px-2 py-0.5 text-[10px] font-bold text-orange-300">Feedback {idx + 1}</span>
                  <span className="text-[10px] text-dark-500">{f.vendedor?.name ?? '—'} · {formatDateTime(f.createdAt)}</span>
                </div>
                <p className="text-sm text-dark-300 whitespace-pre-line">{f.conteudo}</p>
              </div>
            ))}
            {(!feedbacks || feedbacks.length === 0) && <p className="text-xs text-dark-500 text-center py-1">Nenhum feedback registrado ainda</p>}
          </div>
          <div className="flex gap-2">
            <Textarea value={novoFeedback} onChange={(e) => setNovoFeedback(e.target.value)} placeholder="Registre como está a negociação, objeções do cliente, próximos passos..." className="flex-1 h-16" />
            <Button size="sm" variant="secondary" disabled={!novoFeedback.trim() || feedbackMut.isPending} loading={feedbackMut.isPending} onClick={() => feedbackMut.mutate({ propostaId, conteudo: novoFeedback })}>
              <Send size={14} />
            </Button>
          </div>
        </div>
      )}

      <button onClick={compartilharWhatsapp} className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 hover:bg-green-500 py-3 text-sm font-bold text-white transition-colors">
        <MessageCircle size={16} /> Compartilhar Proposta via WhatsApp
        {proposta.vendedor?.whatsapp && <span className="text-xs font-normal opacity-80">({proposta.vendedor.whatsapp})</span>}
      </button>

      {proposta.stage === 'proposta' && !hasPdf && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-900/10 px-4 py-3 text-xs text-amber-400">
          ⚠️ Anexe o PDF da proposta antes de avançar para Negociação.
        </div>
      )}

      {podeEditar && (
        <div className="flex gap-3 pt-2 border-t border-dark-700">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={salvarMut.isPending} onClick={salvarTudo}>Salvar</Button>
        </div>
      )}
    </div>
  )
}
