import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { MessageCircleMore, Plus, X, Camera, Search, ArrowLeft } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { useChat } from '../contexts/ChatContext'
import { timeAgo } from '../lib/utils'
import { Badge } from './ui/Badge'
import ChatJanela from './chat/ChatJanela'
import PessoaPicker from './chat/PessoaPicker'
import Avatar from './chat/Avatar'

const TIPO_ORIGEM_LABEL: Record<string, string> = {
  lead: '🎯 Lead',
  cliente: '🏢 Cliente',
  pedido: '📦 Pedido',
  visita: '🚗 Visita',
  consulta_credito: '💳 Consulta de crédito',
  direta: '',
}

async function uploadMinhaFoto(file: File): Promise<string> {
  const token = localStorage.getItem('odin_token')
  const form = new FormData()
  form.append('file', file)
  const resp = await fetch('/upload/foto-vendedor', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.error ?? 'Falha ao enviar a foto')
  return data.path
}

function MinhaFoto() {
  const { user } = useAuth()
  const utils = trpc.useUtils()
  const [enviando, setEnviando] = useState(false)
  const atualizarMut = trpc.users.atualizarMinhaFoto.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate()
      toast.success('Foto atualizada')
    },
    onError: (e) => toast.error(e.message),
  })

  async function onSelecionar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setEnviando(true)
    try {
      const path = await uploadMinhaFoto(file)
      atualizarMut.mutate({ fotoUrl: path })
    } catch (err: any) {
      toast.error(err.message ?? 'Erro no upload')
    } finally {
      setEnviando(false)
    }
  }

  if (!user) return null
  return (
    <label className="relative shrink-0 cursor-pointer group" title="Trocar sua foto">
      <Avatar nome={user.name} fotoUrl={user.fotoUrl} size="sm" />
      <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/50 flex items-center justify-center transition-colors">
        <Camera size={11} className="text-white opacity-0 group-hover:opacity-100" />
      </div>
      <input type="file" accept="image/*" className="hidden" onChange={onSelecionar} disabled={enviando} />
    </label>
  )
}

function NovaConversaView({ onClose, onCriada }: { onClose: () => void; onCriada: (conversaId: number) => void }) {
  const abrirMut = trpc.chat.conversas.abrirDireta.useMutation({
    onSuccess: (data) => onCriada(data.id),
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="absolute inset-0 z-10 bg-dark-800 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-dark-700 shrink-0">
        <p className="text-sm font-semibold text-dark-100">Nova conversa</p>
        <button onClick={onClose} className="text-dark-400 hover:text-dark-100">
          <X size={16} />
        </button>
      </div>
      <div className="relative flex-1 min-h-0">
        <PessoaPicker onEscolher={(userId) => !abrirMut.isPending && abrirMut.mutate({ outroUserId: userId })} />
        {abrirMut.isPending && (
          <div className="absolute inset-0 bg-dark-800/70 flex items-center justify-center text-sm text-dark-300">Abrindo conversa...</div>
        )}
      </div>
    </div>
  )
}

// Popup flutuante do Chat Grupo Odin — pedido do João, 2026-10-03: nada de
// página própria no menu lateral, o chat abre na hora de qualquer tela
// através do botão ao lado do sininho de notificações (ver Layout.tsx).
export default function ChatPopup() {
  const { temAcesso, naoLidasTotal, popupAberto, setPopupAberto, conversaParaAbrir, limparConversaParaAbrir } = useChat()
  const [selecionada, setSelecionada] = useState<number | null>(null)
  const [novaConversaAberta, setNovaConversaAberta] = useState(false)
  const [buscaConversa, setBuscaConversa] = useState('')
  const { data: conversas, isLoading } = trpc.chat.conversas.listar.useQuery(undefined, { enabled: popupAberto && temAcesso })

  // Veio de um aviso de mensagem nova (ChatContext.abrirConversaNoPopup) —
  // já abre direto naquela conversa.
  useEffect(() => {
    if (popupAberto && conversaParaAbrir !== null) {
      setSelecionada(conversaParaAbrir)
      limparConversaParaAbrir()
    }
  }, [popupAberto, conversaParaAbrir, limparConversaParaAbrir])

  const conversaAtual = conversas?.find((c) => c.id === selecionada)

  if (!temAcesso) return null

  const termoBusca = buscaConversa.trim().toLowerCase()
  const conversasFiltradas = !termoBusca
    ? conversas
    : conversas?.filter(
        (c) =>
          c.titulo.toLowerCase().includes(termoBusca) ||
          c.outrosParticipantes.some((p) => p.name.toLowerCase().includes(termoBusca))
      )

  return (
    <div className="relative">
      <button
        onClick={() => setPopupAberto(!popupAberto)}
        className="relative p-2 rounded-full bg-[#25D366] hover:bg-[#20bd5a] text-white transition-colors shadow-sm"
        title="Chat Grupo Odin"
      >
        <MessageCircleMore size={18} />
        {naoLidasTotal > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {naoLidasTotal > 9 ? '9+' : naoLidasTotal}
          </span>
        )}
      </button>

      {popupAberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPopupAberto(false)} />
          <div className="fixed md:absolute top-14 md:top-auto bottom-0 md:bottom-auto right-0 md:mt-2 w-full md:w-[380px] h-[calc(100vh-3.5rem)] md:h-[32rem] md:max-h-[80vh] bg-dark-800 border border-dark-600 md:rounded-xl shadow-2xl shadow-black/50 z-50 flex flex-col overflow-hidden">
            {conversaAtual ? (
              <>
                <div className="flex items-center gap-2 p-3 border-b border-dark-700 shrink-0">
                  <button onClick={() => setSelecionada(null)} className="text-dark-400 hover:text-dark-100 shrink-0">
                    <ArrowLeft size={16} />
                  </button>
                  <p className="text-sm font-semibold text-dark-100 truncate flex-1">{conversaAtual.titulo}</p>
                  {TIPO_ORIGEM_LABEL[conversaAtual.tipoOrigem] && (
                    <Badge className="bg-dark-700 border-dark-600 text-dark-300 shrink-0">{TIPO_ORIGEM_LABEL[conversaAtual.tipoOrigem]}</Badge>
                  )}
                  <button onClick={() => setPopupAberto(false)} className="text-dark-400 hover:text-dark-100 shrink-0">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <ChatJanela conversaId={conversaAtual.id} />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 p-3 border-b border-dark-700 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <MessageCircleMore size={16} className="text-gold-400 shrink-0" />
                    <p className="text-sm font-semibold text-dark-100 truncate">Chat Grupo Odin</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <MinhaFoto />
                    <button onClick={() => setNovaConversaAberta(true)} className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300">
                      <Plus size={14} /> Nova
                    </button>
                    <button onClick={() => setPopupAberto(false)} className="text-dark-400 hover:text-dark-100">
                      <X size={16} />
                    </button>
                  </div>
                </div>
                <div className="p-2 border-b border-dark-700 shrink-0">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
                    <input
                      value={buscaConversa}
                      onChange={(e) => setBuscaConversa(e.target.value)}
                      placeholder="Buscar conversa..."
                      className="w-full bg-dark-900 border border-dark-600 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-dark-100 placeholder-dark-500 focus:outline-none focus:border-gold-600"
                    />
                  </div>
                </div>
                <div className="relative flex-1 min-h-0">
                  <div className="h-full overflow-y-auto divide-y divide-dark-700">
                    {isLoading && <p className="p-3 text-sm text-dark-500">Carregando...</p>}
                    {!isLoading && !conversas?.length && <p className="p-3 text-sm text-dark-500">Nenhuma conversa ainda.</p>}
                    {!isLoading && !!conversas?.length && !conversasFiltradas?.length && (
                      <p className="p-3 text-sm text-dark-500">Nenhuma conversa encontrada.</p>
                    )}
                    {conversasFiltradas?.map((c) => {
                      const outro = c.outrosParticipantes[0]
                      return (
                        <button
                          key={c.id}
                          onClick={() => setSelecionada(c.id)}
                          className="w-full text-left p-3 flex items-start gap-2.5 hover:bg-dark-700/40 transition-colors"
                        >
                          <Avatar
                            nome={outro?.name ?? c.titulo}
                            fotoUrl={outro?.fotoUrl}
                            online={c.tipoOrigem === 'direta' ? outro?.chatOnline : undefined}
                            size="sm"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm text-dark-100 font-medium truncate">{c.titulo}</p>
                              {c.naoLidas > 0 && (
                                <Badge className="bg-gold-600/20 border-gold-600/40 text-gold-300 shrink-0">{c.naoLidas}</Badge>
                              )}
                            </div>
                            <p className="text-xs text-dark-500 truncate">
                              {TIPO_ORIGEM_LABEL[c.tipoOrigem]} {c.ultimaMensagem?.texto ?? (c.ultimaMensagem ? 'Anexo' : 'Sem mensagens ainda')}
                            </p>
                            {c.ultimaMensagemEm && <p className="text-[10px] text-dark-600 mt-0.5">{timeAgo(c.ultimaMensagemEm)}</p>}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {novaConversaAberta && (
                    <NovaConversaView
                      onClose={() => setNovaConversaAberta(false)}
                      onCriada={(id) => {
                        setSelecionada(id)
                        setNovaConversaAberta(false)
                      }}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
