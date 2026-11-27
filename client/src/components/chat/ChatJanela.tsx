import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { Paperclip, Send, Mic, Square, Play, Pause, X, UserPlus, ChevronUp, Check, CheckCheck, Building2, Phone, Camera, Trash2, Reply, Copy, Zap, ImagePlus } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { useChat } from '../../contexts/ChatContext'
import { formatDateTime } from '../../lib/utils'
import Avatar from './Avatar'
import PessoaPicker from './PessoaPicker'
import CameraCapture from './CameraCapture'
import ProcessoExpedicaoChat from './ProcessoExpedicaoChat'
import { AvisoSemResposta } from './SemResposta'
import RespostasRapidas from './RespostasRapidas'
import { EtiquetasAssunto } from './ListaConversas'

// wa.me só aceita dígitos — mesmo padrão simples já usado em
// designWhatsapp.ts/creditoWhatsapp.ts.
function waLink(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '')
  return `https://wa.me/${digitos.length <= 11 ? `55${digitos}` : digitos}`
}

type Mensagem = {
  id: number
  conversaId: number
  autorId: number
  autor: { id: number; name: string; fotoUrl?: string | null }
  tipo: 'texto' | 'arquivo' | 'imagem' | 'video' | 'audio'
  texto: string | null
  urlArquivo: string | null
  nomeArquivo: string | null
  tipoArquivoMime: string | null
  duracaoAudioSegundos: number | null
  respondeAId?: number | null
  respondeA?: Citacao | null
  createdAt: string
}

type Citacao = { id: number; autorNome: string; tipo: string; texto: string | null; nomeArquivo: string | null }

function resumoCitacao(c: Pick<Citacao, 'tipo' | 'texto' | 'nomeArquivo'>): string {
  if (c.tipo === 'texto') return c.texto ?? ''
  if (c.tipo === 'imagem') return `📷 Foto${c.texto ? ` · ${c.texto}` : ''}`
  if (c.tipo === 'audio') return '🎤 Áudio'
  if (c.tipo === 'video') return '🎥 Vídeo'
  return `📎 ${c.nomeArquivo ?? 'Arquivo'}${c.texto ? ` · ${c.texto}` : ''}`
}

// Botão Copiar (João, 2026-11-27: "botão de copiar - simples"). Texto vai
// como texto; foto vai como imagem quando o navegador deixa, senão o link.
async function copiarMensagem(m: Mensagem) {
  try {
    if (m.tipo === 'imagem' && m.urlArquivo && 'ClipboardItem' in window) {
      try {
        const blob = await (await fetch(m.urlArquivo)).blob()
        const png = blob.type === 'image/png' ? blob : await paraPng(blob)
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
        toast.success('Foto copiada — é só colar (Ctrl+V)')
        return
      } catch {
        /* cai pro texto/link abaixo */
      }
    }
    const texto = m.tipo === 'texto' ? m.texto ?? '' : m.texto || (m.urlArquivo ? new URL(m.urlArquivo, location.origin).href : '')
    await navigator.clipboard.writeText(texto)
    toast.success('Copiado')
  } catch {
    toast.error('O navegador não deixou copiar')
  }
}

async function paraPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'))
}

async function fazerUpload(file: File | Blob, nomeArquivo: string): Promise<{ urlArquivo: string; nomeArquivo: string; tipoArquivoMime: string }> {
  const formData = new FormData()
  formData.append('file', file, nomeArquivo)
  const token = localStorage.getItem('odin_token')
  const resp = await fetch('/upload/chat-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
  const json = await resp.json()
  if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
  return { urlArquivo: json.path, nomeArquivo: json.nome, tipoArquivoMime: json.tipo }
}

function formatarDuracao(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = Math.floor(segundos % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function BolhaAudio({ url, duracao }: { url: string; duracao: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [tocando, setTocando] = useState(false)

  return (
    <div className="flex items-center gap-2 bg-dark-900/60 rounded-lg px-2.5 py-1.5 min-w-[160px]">
      <button
        type="button"
        onClick={() => {
          if (!audioRef.current) return
          if (tocando) audioRef.current.pause()
          else audioRef.current.play()
        }}
        className="shrink-0 w-7 h-7 rounded-full bg-gold-600 text-dark-950 flex items-center justify-center"
      >
        {tocando ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
      </button>
      <span className="text-xs text-dark-300">🎤 {duracao != null ? formatarDuracao(duracao) : 'áudio'}</span>
      <audio ref={audioRef} src={url} onPlay={() => setTocando(true)} onPause={() => setTocando(false)} onEnded={() => setTocando(false)} className="hidden" />
    </div>
  )
}

function BolhaMensagem({
  m,
  minha,
  lida,
  destacada,
  onResponder,
  onIrPara,
}: {
  m: Mensagem
  minha: boolean
  lida: boolean
  destacada: boolean
  onResponder: () => void
  onIrPara: (id: number) => void
}) {
  const legenda = m.tipo !== 'texto' && m.tipo !== 'audio' && m.texto
  return (
    <div id={`msg-${m.id}`} className={`group flex items-end gap-2 rounded-lg transition-colors ${minha ? 'justify-end' : 'justify-start'} ${destacada ? 'bg-gold-500/15' : ''}`}>
      {!minha && <Avatar nome={m.autor.name} fotoUrl={m.autor.fotoUrl} size="xs" />}
      {/* Ações (Responder / Copiar) — aparecem ao passar o mouse; no celular ficam sempre visíveis. */}
      {minha && <AcoesMensagem m={m} onResponder={onResponder} />}
      <div className={`max-w-[75%] ${minha ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
        {!minha && <span className="text-[10px] text-dark-500 px-1">{m.autor.name}</span>}
        <div onDoubleClick={onResponder} className={`rounded-2xl px-3 py-2 text-sm ${minha ? 'bg-gold-600 text-dark-950' : 'bg-dark-700 text-dark-100'}`}>
          {m.respondeA && (
            <button
              type="button"
              onClick={() => onIrPara(m.respondeA!.id)}
              className={`block w-full text-left mb-1.5 rounded-lg border-l-4 px-2 py-1 text-xs ${minha ? 'bg-black/10 border-dark-900/60' : 'bg-dark-900/50 border-gold-500'}`}
            >
              <span className={`block font-semibold ${minha ? 'text-dark-900' : 'text-gold-400'}`}>{m.respondeA.autorNome}</span>
              <span className={`block line-clamp-2 ${minha ? 'text-dark-900/80' : 'text-dark-300'}`}>{resumoCitacao(m.respondeA)}</span>
            </button>
          )}
          {m.tipo === 'texto' && <p className="whitespace-pre-wrap break-words">{m.texto}</p>}
          {m.tipo === 'imagem' && m.urlArquivo && (
            <a href={m.urlArquivo} target="_blank" rel="noreferrer">
              <img src={m.urlArquivo} alt={m.nomeArquivo ?? 'imagem'} className="rounded-lg max-h-56 max-w-full" />
            </a>
          )}
          {m.tipo === 'video' && m.urlArquivo && <video src={m.urlArquivo} controls className="rounded-lg max-h-56 max-w-full" />}
          {m.tipo === 'audio' && m.urlArquivo && <BolhaAudio url={m.urlArquivo} duracao={m.duracaoAudioSegundos} />}
          {m.tipo === 'arquivo' && m.urlArquivo && (
            <a href={m.urlArquivo} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 underline">
              <Paperclip size={12} /> {m.nomeArquivo ?? 'arquivo'}
            </a>
          )}
          {legenda && <p className="whitespace-pre-wrap break-words mt-1.5">{m.texto}</p>}
        </div>
        <span className="text-[10px] text-dark-600 px-1 flex items-center gap-1">
          {formatDateTime(m.createdAt)}
          {minha && (lida ? <CheckCheck size={11} className="text-blue-400" /> : <Check size={11} className="text-dark-600" />)}
        </span>
      </div>
      {!minha && <AcoesMensagem m={m} onResponder={onResponder} />}
    </div>
  )
}

function AcoesMensagem({ m, onResponder }: { m: Mensagem; onResponder: () => void }) {
  return (
    <div className="self-center flex flex-col gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
      <button type="button" onClick={onResponder} title="Responder" className="p-1 rounded-full bg-dark-700/80 text-dark-300 hover:text-gold-400">
        <Reply size={13} />
      </button>
      {(m.texto || m.urlArquivo) && m.tipo !== 'audio' && (
        <button type="button" onClick={() => copiarMensagem(m)} title="Copiar" className="p-1 rounded-full bg-dark-700/80 text-dark-300 hover:text-gold-400">
          <Copy size={13} />
        </button>
      )}
    </div>
  )
}

// Thread de mensagens de UMA conversa — usado tanto dentro do modal do
// botão "Conversar sobre isso" quanto embutido na tela cheia de Chat. Entra
// na sala `conversa:<id>` do socket enquanto estiver montado, pra receber
// mensagem nova em tempo real sem precisar ficar recarregando. Pedido do
// João, 2026-10-02 (projeto Chat Grupo Odin).
export default function ChatJanela({ conversaId, onExcluida }: { conversaId: number; onExcluida?: () => void }) {
  const { user } = useAuth()
  const { socket, setConversaAbertaId } = useChat()
  const utils = trpc.useUtils()
  const { data: primeiraPagina } = trpc.chat.mensagens.listar.useQuery({ conversaId })
  const { data: participantes } = trpc.chat.conversas.participantes.useQuery({ conversaId })
  const { data: detalhe } = trpc.chat.conversas.detalhe.useQuery({ conversaId })

  // Avisa o ChatContext que essa conversa está com a tela aberta — ele usa
  // isso pra não mostrar o pop-up de "mensagem nova" de uma conversa que a
  // pessoa já está vendo. Limpa ao fechar/trocar de conversa.
  useEffect(() => {
    setConversaAbertaId(conversaId)
    return () => setConversaAbertaId(null)
  }, [conversaId, setConversaAbertaId])
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [temMais, setTemMais] = useState(false)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [adicionarAberto, setAdicionarAberto] = useState(false)
  const [cameraAberta, setCameraAberta] = useState(false)
  const [texto, setTexto] = useState('')
  const [respondendo, setRespondendo] = useState<Mensagem | null>(null)
  const [destacada, setDestacada] = useState<number | null>(null)
  // Prints/arquivos colados (Ctrl+V), arrastados ou escolhidos — ficam aqui
  // pra conferir antes de mandar; o que estiver digitado vai junto de legenda.
  const [pendentes, setPendentes] = useState<{ file: File; url: string | null }[]>([])
  const [arrastando, setArrastando] = useState(false)
  const [rapidasAberto, setRapidasAberto] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [enviandoArquivo, setEnviandoArquivo] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [segundosGravando, setSegundosGravando] = useState(0)
  const listaRef = useRef<HTMLDivElement>(null)
  const fimRef = useRef<HTMLDivElement>(null)
  const primeiraCargaFeita = useRef(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setRespondendo(null)
    setPendentes([])
  }, [conversaId])

  useEffect(() => {
    if (!primeiraPagina) return
    setMensagens(primeiraPagina.mensagens as Mensagem[])
    setTemMais(primeiraPagina.temMais)
  }, [primeiraPagina])

  const marcarLidaMut = trpc.chat.mensagens.marcarLida.useMutation({
    onSuccess: () => utils.chat.conversas.listar.invalidate(),
  })

  useEffect(() => {
    marcarLidaMut.mutate({ conversaId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaId, mensagens.length])

  useEffect(() => {
    if (!socket) return
    socket.emit('chat:entrarConversa', conversaId)
    function onNovaMensagem(msg: Mensagem) {
      if (msg.conversaId !== conversaId) return
      setMensagens((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
    }
    // Alguém (dos outros participantes) acabou de ler — atualiza o "✓✓
    // Lido" das MINHAS mensagens na hora, sem precisar sair e voltar.
    function onLida(payload: { conversaId: number }) {
      if (payload.conversaId !== conversaId) return
      utils.chat.conversas.participantes.invalidate({ conversaId })
    }
    socket.on('chat:novaMensagem', onNovaMensagem)
    socket.on('chat:lida', onLida)
    return () => {
      socket.emit('chat:sairConversa', conversaId)
      socket.off('chat:novaMensagem', onNovaMensagem)
      socket.off('chat:lida', onLida)
    }
  }, [socket, conversaId, utils])

  // Rola pro fim só na primeira carga e quando uma mensagem nova chega — ao
  // CARREGAR MAIS (histórico antigo, no topo) a posição é restaurada pela
  // função carregarMais() em vez disso, senão a tela "pularia" pro fim de
  // novo toda vez que o usuário tentasse ler o passado.
  useEffect(() => {
    if (!primeiraCargaFeita.current && mensagens.length) {
      primeiraCargaFeita.current = true
      fimRef.current?.scrollIntoView()
      return
    }
    fimRef.current?.scrollIntoView({ behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagens.length])

  async function carregarMais() {
    if (!mensagens.length || carregandoMais) return
    setCarregandoMais(true)
    const container = listaRef.current
    const alturaAntes = container?.scrollHeight ?? 0
    try {
      const pagina = await utils.chat.mensagens.listar.fetch({ conversaId, antesDe: mensagens[0].createdAt })
      setMensagens((prev) => [...(pagina.mensagens as Mensagem[]), ...prev])
      setTemMais(pagina.temMais)
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight - alturaAntes
      })
    } catch (err: any) {
      toast.error(err.message ?? 'Erro ao carregar histórico')
    } finally {
      setCarregandoMais(false)
    }
  }

  const enviarMut = trpc.chat.mensagens.enviar.useMutation({
    onSuccess: (msg) => {
      setMensagens((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg as Mensagem]))
      utils.chat.conversas.listar.invalidate()
      utils.notifications.list.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  const adicionarMut = trpc.chat.conversas.adicionarParticipante.useMutation({
    onSuccess: () => {
      utils.chat.conversas.participantes.invalidate({ conversaId })
      setAdicionarAberto(false)
      toast.success('Pessoa adicionada à conversa')
    },
    onError: (e) => toast.error(e.message),
  })

  const excluirMut = trpc.chat.conversas.excluir.useMutation({
    onSuccess: () => {
      utils.chat.conversas.listar.invalidate()
      toast.success('Grupo excluído')
      onExcluida?.()
    },
    onError: (e) => toast.error(e.message),
  })

  function excluirGrupo() {
    if (!confirm('Excluir esse grupo? Essa ação não pode ser desfeita.')) return
    excluirMut.mutate({ conversaId })
  }

  function enviarTexto() {
    if (pendentes.length) {
      void enviarPendentes()
      return
    }
    const valor = texto.trim()
    if (!valor) return
    setTexto('')
    const respondeAId = respondendo?.id
    setRespondendo(null)
    enviarMut.mutate({ conversaId, tipo: 'texto', texto: valor, respondeAId })
  }

  function adicionarPendentes(files: File[]) {
    if (!files.length) return
    setPendentes((prev) => [...prev, ...files.map((file) => ({ file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null }))].slice(0, 10))
    inputRef.current?.focus()
  }

  function tirarPendente(i: number) {
    setPendentes((prev) => {
      const p = prev[i]
      if (p?.url) URL.revokeObjectURL(p.url)
      return prev.filter((_, j) => j !== i)
    })
  }

  async function enviarPendentes() {
    const lista = pendentes
    const legenda = texto.trim()
    const respondeAId = respondendo?.id
    setEnviandoArquivo(true)
    try {
      for (let i = 0; i < lista.length; i++) {
        const { file } = lista[i]
        const nome = file.name && file.name !== 'image.png' ? file.name : `print_${Date.now()}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`
        const up = await fazerUpload(file, nome)
        const tipo = up.tipoArquivoMime.startsWith('image/') ? 'imagem' : up.tipoArquivoMime.startsWith('video/') ? 'video' : 'arquivo'
        await enviarMut.mutateAsync({
          conversaId,
          tipo,
          urlArquivo: up.urlArquivo,
          nomeArquivo: up.nomeArquivo,
          tipoArquivoMime: up.tipoArquivoMime,
          // legenda e resposta vão na primeira (igual WhatsApp)
          texto: i === 0 && legenda ? legenda : undefined,
          respondeAId: i === 0 ? respondeAId : undefined,
        })
      }
      lista.forEach((p) => p.url && URL.revokeObjectURL(p.url))
      setPendentes([])
      setTexto('')
      setRespondendo(null)
    } catch (err: any) {
      toast.error(err.message ?? 'Erro no upload')
    } finally {
      setEnviandoArquivo(false)
    }
  }

  function onSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    adicionarPendentes(files)
  }

  // Ctrl+V de print (Win+Shift+S / PrintScreen) direto na caixa de texto.
  function onColar(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files ?? [])
    if (!files.length) return
    e.preventDefault()
    adicionarPendentes(files)
  }

  function responder(m: Mensagem) {
    setRespondendo(m)
    inputRef.current?.focus()
  }

  function irPara(id: number) {
    const el = document.getElementById(`msg-${id}`)
    if (!el) {
      toast('Essa mensagem é mais antiga — clique em "Ver mensagens mais antigas" lá em cima.')
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setDestacada(id)
    setTimeout(() => setDestacada((d) => (d === id ? null : d)), 1800)
  }

  async function iniciarGravacao() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setGravando(true)
      setSegundosGravando(0)
      timerRef.current = setInterval(() => setSegundosGravando((s) => s + 1), 1000)
    } catch {
      toast.error('Não consegui acessar o microfone — verifique a permissão do navegador.')
    }
  }

  async function pararGravacao() {
    const recorder = mediaRecorderRef.current
    if (!recorder) return
    const duracao = segundosGravando
    if (timerRef.current) clearInterval(timerRef.current)
    setGravando(false)

    const blob: Blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType }))
      recorder.stop()
      recorder.stream.getTracks().forEach((t) => t.stop())
    })

    if (duracao < 1) return // gravação cancelada/muito curta
    setEnviandoArquivo(true)
    try {
      const ext = recorder.mimeType.includes('webm') ? 'webm' : 'mp4'
      const up = await fazerUpload(blob, `audio.${ext}`)
      enviarMut.mutate({
        conversaId,
        tipo: 'audio',
        urlArquivo: up.urlArquivo,
        nomeArquivo: up.nomeArquivo,
        tipoArquivoMime: up.tipoArquivoMime,
        duracaoAudioSegundos: duracao,
      })
    } catch (err: any) {
      toast.error(err.message ?? 'Erro ao enviar áudio')
    } finally {
      setEnviandoArquivo(false)
    }
  }

  // "Lida" (✓✓) só quando TODO MUNDO que não sou eu já leu depois do
  // momento em que mandei — se alguém nunca abriu a conversa ainda, ou leu
  // antes dessa mensagem existir, continua "✓ Enviado".
  function estaLida(m: Mensagem): boolean {
    const outros = (participantes ?? []).filter((p) => p.id !== user?.id)
    return outros.length > 0 && outros.every((p) => p.ultimaLeituraEm && p.ultimaLeituraEm >= m.createdAt)
  }

  return (
    <div
      className="flex flex-col h-full min-h-0 relative"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setArrastando(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setArrastando(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files?.length) return
        e.preventDefault()
        setArrastando(false)
        adicionarPendentes(Array.from(e.dataTransfer.files))
      }}
    >
      {arrastando && (
        <div className="absolute inset-0 z-30 bg-dark-900/85 border-2 border-dashed border-gold-500 rounded-xl flex flex-col items-center justify-center gap-2 pointer-events-none">
          <ImagePlus size={36} className="text-gold-400" />
          <p className="text-sm text-dark-100 font-semibold">Solte aqui para enviar</p>
        </div>
      )}
      {/* Crédito/expedição/pedido: cliente + código SAP + pedido no topo (o
          'cliente' tem o quadro completo logo abaixo). */}
      {!detalhe?.cliente && detalhe?.assunto && (detalhe.assunto.clienteNome || detalhe.assunto.pedidoSap) && detalhe.tipoOrigem !== 'direta' && detalhe.tipoOrigem !== 'grupo' && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-dark-900/60 border-b border-dark-700 shrink-0 text-xs">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <Building2 size={13} className="text-dark-500 shrink-0" />
            {detalhe.assunto.clienteNome && <span className="text-dark-100 font-medium truncate">{detalhe.assunto.clienteNome}</span>}
            <EtiquetasAssunto c={{ tipoOrigem: '', assunto: detalhe.assunto }} />
          </div>
          {detalhe.assunto.clienteId && (
            <Link
              to={`${user?.role === 'admin' ? '/admin' : '/vendedor'}/clientes/${detalhe.assunto.clienteId}`}
              target="_blank"
              className="text-gold-400 hover:text-gold-300 hover:underline whitespace-nowrap shrink-0"
            >
              Ver ficha
            </Link>
          )}
        </div>
      )}
      {detalhe?.cliente && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-dark-900/60 border-b border-dark-700 shrink-0 text-xs">
          <div className="flex items-center gap-1.5 min-w-0 text-dark-300">
            <Building2 size={13} className="text-dark-500 shrink-0" />
            <span className="text-dark-100 font-medium truncate">{detalhe.cliente.razaoSocial}</span>
            <span className="text-dark-500 shrink-0">· Cód. {detalhe.cliente.codigo}</span>
            {detalhe.cliente.vendedorNome && <span className="text-dark-500 shrink-0">· {detalhe.cliente.vendedorNome}</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {detalhe.cliente.telefoneWhatsapp && (
              <a
                href={waLink(detalhe.cliente.telefoneWhatsapp)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-green-500 hover:text-green-400"
                title={detalhe.cliente.telefoneWhatsapp}
              >
                <Phone size={12} />
              </a>
            )}
            <Link
              to={`${user?.role === 'admin' ? '/admin' : '/vendedor'}/clientes/${detalhe.cliente.id}`}
              target="_blank"
              className="text-gold-400 hover:text-gold-300 hover:underline whitespace-nowrap"
            >
              Ver ficha completa
            </Link>
          </div>
        </div>
      )}

      {detalhe?.tipoOrigem === 'expedicao' && <ProcessoExpedicaoChat conversaId={conversaId} />}

      {!!participantes?.length && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-dark-700 shrink-0">
          <div className="flex items-center -space-x-2">
            {participantes
              .filter((p) => p.id !== user?.id)
              .map((p) => (
                <div key={p.id} title={p.name} className="ring-2 ring-dark-800 rounded-full">
                  <Avatar nome={p.name} fotoUrl={p.fotoUrl} online={p.chatOnline} size="sm" />
                </div>
              ))}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button type="button" onClick={() => setAdicionarAberto(true)} className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300">
              <UserPlus size={13} /> Adicionar
            </button>
            {/* Excluir grupo é poder de admin — "não pode apagar, só admin
                mesmo" (pedido do João, 2026-10-03). Só aparece pra tipo
                'grupo': conversa direta ou vinculada a registro não tem
                como excluir. */}
            {detalhe?.tipoOrigem === 'grupo' && (user?.role === 'admin' || user?.superAdmin) && (
              <button type="button" onClick={excluirGrupo} disabled={excluirMut.isPending} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                <Trash2 size={13} /> Excluir grupo
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={listaRef} className="flex-1 overflow-y-auto min-h-0 space-y-2 p-3">
        {temMais && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={carregarMais}
              disabled={carregandoMais}
              className="flex items-center gap-1 text-xs text-dark-400 hover:text-gold-400 disabled:opacity-50"
            >
              <ChevronUp size={12} /> {carregandoMais ? 'Carregando...' : 'Ver mensagens mais antigas'}
            </button>
          </div>
        )}
        {mensagens.map((m) => (
          <BolhaMensagem
            key={m.id}
            m={m}
            minha={m.autorId === user?.id}
            lida={estaLida(m)}
            destacada={destacada === m.id}
            onResponder={() => responder(m)}
            onIrPara={irPara}
          />
        ))}
        <div ref={fimRef} />
      </div>

      <AvisoSemResposta conversaId={conversaId} enviando={enviarMut.isPending} onCiente={() => enviarMut.mutate({ conversaId, tipo: 'texto', texto: '👍' })} />
      {respondendo && (
        <div className="border-t border-dark-700 px-3 pt-2 shrink-0">
          <div className="flex items-start gap-2 rounded-lg bg-dark-900/70 border-l-4 border-gold-500 px-2.5 py-1.5">
            <Reply size={14} className="text-gold-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 text-xs">
              <p className="font-semibold text-gold-400">Respondendo {respondendo.autorId === user?.id ? 'você' : respondendo.autor.name}</p>
              <p className="text-dark-300 line-clamp-2">{resumoCitacao(respondendo)}</p>
            </div>
            <button type="button" onClick={() => setRespondendo(null)} className="text-dark-500 hover:text-dark-100 shrink-0" title="Cancelar resposta">
              <X size={15} />
            </button>
          </div>
        </div>
      )}
      {pendentes.length > 0 && (
        <div className="border-t border-dark-700 px-3 pt-2 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {pendentes.map((p, i) => (
              <div key={i} className="relative shrink-0">
                {p.url ? (
                  <img src={p.url} alt="" className="h-20 w-20 object-cover rounded-lg border border-dark-600" />
                ) : (
                  <div className="h-20 w-28 rounded-lg border border-dark-600 bg-dark-900 flex flex-col items-center justify-center gap-1 px-1">
                    <Paperclip size={16} className="text-dark-400" />
                    <span className="text-[10px] text-dark-300 truncate w-full text-center">{p.file.name}</span>
                  </div>
                )}
                <button type="button" onClick={() => tirarPendente(i)} className="absolute -top-1.5 -right-1.5 bg-dark-950 border border-dark-600 rounded-full p-0.5 text-dark-300 hover:text-red-400">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-dark-400 pb-1">
            {enviandoArquivo ? 'Enviando...' : `${pendentes.length} ${pendentes.length === 1 ? 'arquivo pronto' : 'arquivos prontos'} — escreva uma legenda (opcional) e aperte Enter ou ➤`}
          </p>
        </div>
      )}
      <div className="border-t border-dark-700 p-2 flex items-end gap-2 shrink-0 relative">
        {rapidasAberto && (
          <RespostasRapidas
            conversaId={conversaId}
            filtro={texto.startsWith('/') ? texto.slice(1) : ''}
            onClose={() => setRapidasAberto(false)}
            onEscolher={(t) => {
              setTexto(t)
              setRapidasAberto(false)
              requestAnimationFrame(() => inputRef.current?.focus())
            }}
          />
        )}
        {gravando ? (
          <div className="flex-1 flex items-center gap-2 bg-dark-900/60 rounded-lg px-3 py-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm text-dark-200 flex-1">Gravando... {formatarDuracao(segundosGravando)}</span>
            <button type="button" onClick={() => { if (timerRef.current) clearInterval(timerRef.current); setGravando(false); mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop()) }} className="text-dark-500 hover:text-red-400">
              <X size={16} />
            </button>
            <button type="button" onClick={pararGravacao} className="text-gold-400 hover:text-gold-300">
              <Square size={16} />
            </button>
          </div>
        ) : (
          <>
            <label className="text-dark-400 hover:text-gold-400 cursor-pointer shrink-0 pb-2" title="Anexar foto/arquivo (ou cole um print com Ctrl+V, ou arraste pra cá)">
              <Paperclip size={18} />
              <input type="file" multiple className="hidden" onChange={onSelecionarArquivo} disabled={enviandoArquivo} />
            </label>
            {/* Câmera de verdade via getUserMedia (CameraCapture.tsx) —
                funciona tanto no celular quanto na webcam do notebook,
                diferente de um input de arquivo com `capture` (que só abre
                câmera em alguns celulares e nunca no notebook). Pedido do
                João, 2026-10-03: "é a câmera do celular ou do notebook?". */}
            <button type="button" onClick={() => setCameraAberta(true)} disabled={enviandoArquivo} className="text-dark-400 hover:text-gold-400 shrink-0 pb-2" title="Tirar foto">
              <Camera size={18} />
            </button>
            <button
              type="button"
              onClick={() => setRapidasAberto((v) => !v)}
              className={`shrink-0 pb-2 ${rapidasAberto ? 'text-gold-400' : 'text-dark-400 hover:text-gold-400'}`}
              title="Respostas prontas e sugestão da IA (ou digite / )"
            >
              <Zap size={18} />
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              value={texto}
              onChange={(e) => {
                const v = e.target.value
                setTexto(v)
                if (v === '/') setRapidasAberto(true)
                else if (rapidasAberto && !v.startsWith('/') && v !== '') setRapidasAberto(false)
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`
              }}
              onPaste={onColar}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (rapidasAberto) setRapidasAberto(false)
                  else if (respondendo) setRespondendo(null)
                }
                if (e.key === 'Enter' && !e.shiftKey && !rapidasAberto) {
                  e.preventDefault()
                  enviarTexto()
                  ;(e.target as HTMLTextAreaElement).style.height = 'auto'
                }
              }}
              placeholder={pendentes.length ? 'Legenda (opcional)...' : 'Digite uma mensagem... (cole print com Ctrl+V)'}
              className="flex-1 resize-none bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-gold-600 max-h-[140px]"
            />
            {texto.trim() || pendentes.length ? (
              <button type="button" onClick={enviarTexto} disabled={enviandoArquivo} className="text-gold-400 hover:text-gold-300 shrink-0 pb-2 disabled:opacity-50">
                <Send size={18} />
              </button>
            ) : (
              <button type="button" onClick={iniciarGravacao} disabled={enviandoArquivo} className="text-dark-400 hover:text-gold-400 shrink-0 pb-2">
                <Mic size={18} />
              </button>
            )}
          </>
        )}
      </div>

      {adicionarAberto && (
        <div className="absolute inset-0 z-10 bg-dark-800 flex flex-col">
          <div className="flex items-center justify-between p-3 border-b border-dark-700 shrink-0">
            <p className="text-sm font-semibold text-dark-100">Adicionar à conversa</p>
            <button onClick={() => setAdicionarAberto(false)} className="text-dark-400 hover:text-dark-100">
              <X size={16} />
            </button>
          </div>
          <PessoaPicker
            excluirIds={participantes?.map((p) => p.id)}
            onEscolher={(userId) => adicionarMut.mutate({ conversaId, userId })}
          />
        </div>
      )}

      {cameraAberta && (
        <CameraCapture
          onClose={() => setCameraAberta(false)}
          onFoto={async (blob) => {
            setCameraAberta(false)
            setEnviandoArquivo(true)
            try {
              const up = await fazerUpload(blob, `foto_${Date.now()}.jpg`)
              enviarMut.mutate({ conversaId, tipo: 'imagem', urlArquivo: up.urlArquivo, nomeArquivo: up.nomeArquivo, tipoArquivoMime: up.tipoArquivoMime, respondeAId: respondendo?.id })
              setRespondendo(null)
            } catch (err: any) {
              toast.error(err.message ?? 'Erro ao enviar foto')
            } finally {
              setEnviandoArquivo(false)
            }
          }}
        />
      )}
    </div>
  )
}
