import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Paperclip, Send, Mic, Square, Play, Pause, X, UserPlus, ChevronUp } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { useChat } from '../../contexts/ChatContext'
import { formatDateTime } from '../../lib/utils'
import Avatar from './Avatar'
import PessoaPicker from './PessoaPicker'

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
  createdAt: string
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

function BolhaMensagem({ m, minha }: { m: Mensagem; minha: boolean }) {
  return (
    <div className={`flex items-end gap-2 ${minha ? 'justify-end' : 'justify-start'}`}>
      {!minha && <Avatar nome={m.autor.name} fotoUrl={m.autor.fotoUrl} size="xs" />}
      <div className={`max-w-[75%] ${minha ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
        {!minha && <span className="text-[10px] text-dark-500 px-1">{m.autor.name}</span>}
        <div className={`rounded-2xl px-3 py-2 text-sm ${minha ? 'bg-gold-600 text-dark-950' : 'bg-dark-700 text-dark-100'}`}>
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
        </div>
        <span className="text-[10px] text-dark-600 px-1">{formatDateTime(m.createdAt)}</span>
      </div>
    </div>
  )
}

// Thread de mensagens de UMA conversa — usado tanto dentro do modal do
// botão "Conversar sobre isso" quanto embutido na tela cheia de Chat. Entra
// na sala `conversa:<id>` do socket enquanto estiver montado, pra receber
// mensagem nova em tempo real sem precisar ficar recarregando. Pedido do
// João, 2026-10-02 (projeto Chat Grupo Odin).
export default function ChatJanela({ conversaId }: { conversaId: number }) {
  const { user } = useAuth()
  const { socket } = useChat()
  const utils = trpc.useUtils()
  const { data: primeiraPagina } = trpc.chat.mensagens.listar.useQuery({ conversaId })
  const { data: participantes } = trpc.chat.conversas.participantes.useQuery({ conversaId })
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [temMais, setTemMais] = useState(false)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [adicionarAberto, setAdicionarAberto] = useState(false)
  const [texto, setTexto] = useState('')
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
    socket.on('chat:novaMensagem', onNovaMensagem)
    return () => {
      socket.emit('chat:sairConversa', conversaId)
      socket.off('chat:novaMensagem', onNovaMensagem)
    }
  }, [socket, conversaId])

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

  function enviarTexto() {
    const valor = texto.trim()
    if (!valor) return
    setTexto('')
    enviarMut.mutate({ conversaId, tipo: 'texto', texto: valor })
  }

  async function onSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setEnviandoArquivo(true)
    try {
      const up = await fazerUpload(file, file.name)
      const tipo = up.tipoArquivoMime.startsWith('image/') ? 'imagem' : up.tipoArquivoMime.startsWith('video/') ? 'video' : 'arquivo'
      enviarMut.mutate({ conversaId, tipo, urlArquivo: up.urlArquivo, nomeArquivo: up.nomeArquivo, tipoArquivoMime: up.tipoArquivoMime })
    } catch (err: any) {
      toast.error(err.message ?? 'Erro no upload')
    } finally {
      setEnviandoArquivo(false)
    }
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

  return (
    <div className="flex flex-col h-full min-h-0 relative">
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
          <button type="button" onClick={() => setAdicionarAberto(true)} className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300 shrink-0">
            <UserPlus size={13} /> Adicionar
          </button>
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
          <BolhaMensagem key={m.id} m={m} minha={m.autorId === user?.id} />
        ))}
        <div ref={fimRef} />
      </div>

      <div className="border-t border-dark-700 p-2 flex items-center gap-2 shrink-0">
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
            <label className="text-dark-400 hover:text-gold-400 cursor-pointer shrink-0">
              <Paperclip size={18} />
              <input type="file" className="hidden" onChange={onSelecionarArquivo} disabled={enviandoArquivo} />
            </label>
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  enviarTexto()
                }
              }}
              placeholder="Digite uma mensagem..."
              className="flex-1 bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-gold-600"
            />
            {texto.trim() ? (
              <button type="button" onClick={enviarTexto} className="text-gold-400 hover:text-gold-300 shrink-0">
                <Send size={18} />
              </button>
            ) : (
              <button type="button" onClick={iniciarGravacao} disabled={enviandoArquivo} className="text-dark-400 hover:text-gold-400 shrink-0">
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
    </div>
  )
}
