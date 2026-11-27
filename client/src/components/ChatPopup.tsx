import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { MessageCircleMore, Plus, X, Camera, ArrowLeft, Users } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { useChat } from '../contexts/ChatContext'
import ChatJanela from './chat/ChatJanela'
import PessoaPicker from './chat/PessoaPicker'
import NovoGrupoView from './chat/NovoGrupoView'
import Avatar from './chat/Avatar'
import ListaConversas, { EtiquetasAssunto, tituloPrincipal } from './chat/ListaConversas'

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
  const [novoGrupoAberto, setNovoGrupoAberto] = useState(false)
  const [menuNovaAberto, setMenuNovaAberto] = useState(false)
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
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-dark-50 truncate">{tituloPrincipal(conversaAtual)}</p>
                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                      <EtiquetasAssunto c={conversaAtual} />
                      {conversaAtual.assunto?.responsavel && <span className="text-[10px] text-dark-400">👤 {conversaAtual.assunto.responsavel}</span>}
                    </div>
                  </div>
                  <button onClick={() => setPopupAberto(false)} className="text-dark-400 hover:text-dark-100 shrink-0">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <ChatJanela conversaId={conversaAtual.id} onExcluida={() => setSelecionada(null)} />
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
                    <div className="relative">
                      <button onClick={() => setMenuNovaAberto((v) => !v)} className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300">
                        <Plus size={14} /> Nova
                      </button>
                      {menuNovaAberto && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setMenuNovaAberto(false)} />
                          <div className="absolute right-0 mt-2 w-44 bg-dark-700 border border-dark-600 rounded-lg shadow-xl z-40 overflow-hidden">
                            <button
                              onClick={() => {
                                setMenuNovaAberto(false)
                                setNovaConversaAberta(true)
                              }}
                              className="w-full text-left px-3 py-2 text-xs text-dark-100 hover:bg-dark-600 flex items-center gap-2"
                            >
                              <MessageCircleMore size={13} /> Conversa individual
                            </button>
                            <button
                              onClick={() => {
                                setMenuNovaAberto(false)
                                setNovoGrupoAberto(true)
                              }}
                              className="w-full text-left px-3 py-2 text-xs text-dark-100 hover:bg-dark-600 flex items-center gap-2"
                            >
                              <Users size={13} /> Novo grupo
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    <button onClick={() => setPopupAberto(false)} className="text-dark-400 hover:text-dark-100">
                      <X size={16} />
                    </button>
                  </div>
                </div>
                <div className="relative flex-1 min-h-0">
                  <ListaConversas conversas={conversas} isLoading={isLoading} onSelecionar={setSelecionada} />

                  {novaConversaAberta && (
                    <NovaConversaView
                      onClose={() => setNovaConversaAberta(false)}
                      onCriada={(id) => {
                        setSelecionada(id)
                        setNovaConversaAberta(false)
                      }}
                    />
                  )}

                  {novoGrupoAberto && (
                    <NovoGrupoView
                      onClose={() => setNovoGrupoAberto(false)}
                      onCriado={(id) => {
                        setSelecionada(id)
                        setNovoGrupoAberto(false)
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
