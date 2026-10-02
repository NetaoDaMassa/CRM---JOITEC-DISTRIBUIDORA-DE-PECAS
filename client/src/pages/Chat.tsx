import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { MessageCircleMore, Plus, X, Camera, Search, Users } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { timeAgo } from '../lib/utils'
import { Badge } from '../components/ui/Badge'
import ChatJanela from '../components/chat/ChatJanela'
import PessoaPicker from '../components/chat/PessoaPicker'
import NovoGrupoView from '../components/chat/NovoGrupoView'
import Avatar from '../components/chat/Avatar'

const TIPO_ORIGEM_LABEL: Record<string, string> = {
  lead: '🎯 Lead',
  cliente: '🏢 Cliente',
  pedido: '📦 Pedido',
  visita: '🚗 Visita',
  consulta_credito: '💳 Consulta de crédito',
  direta: '',
  grupo: '👥 Grupo',
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
      <Avatar nome={user.name} fotoUrl={user.fotoUrl} size="md" />
      <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/50 flex items-center justify-center transition-colors">
        <Camera size={14} className="text-white opacity-0 group-hover:opacity-100" />
      </div>
      <input type="file" accept="image/*" className="hidden" onChange={onSelecionar} disabled={enviando} />
    </label>
  )
}

function NovaConversaModal({ onClose, onCriada }: { onClose: () => void; onCriada: (conversaId: number) => void }) {
  const abrirMut = trpc.chat.conversas.abrirDireta.useMutation({
    onSuccess: (data) => onCriada(data.id),
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="absolute inset-0 z-20 bg-dark-800 flex flex-col">
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

// Versão "aba geral" (página cheia) do Chat Grupo Odin — convive com o
// popup do lado do sininho (ChatPopup.tsx), não substitui. Pedido do João,
// 2026-10-02: quer os dois jeitos, o popup rápido e essa tela maior,
// aberta pelo botão flutuante no canto da tela (ver ChatFloatingButton.tsx).
export default function Chat() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [selecionada, setSelecionada] = useState<number | null>(() => {
    const doLink = searchParams.get('conversa')
    return doLink ? Number(doLink) : null
  })
  const [novaConversaAberta, setNovaConversaAberta] = useState(false)
  const [novoGrupoAberto, setNovoGrupoAberto] = useState(false)
  const [menuNovaAberto, setMenuNovaAberto] = useState(false)
  const { data: conversas, isLoading } = trpc.chat.conversas.listar.useQuery()

  useEffect(() => {
    const doLink = searchParams.get('conversa')
    if (doLink) {
      setSelecionada(Number(doLink))
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [buscaConversa, setBuscaConversa] = useState('')
  const conversaAtual = conversas?.find((c) => c.id === selecionada)

  const termoBusca = buscaConversa.trim().toLowerCase()
  const conversasFiltradas = !termoBusca
    ? conversas
    : conversas?.filter(
        (c) =>
          c.titulo.toLowerCase().includes(termoBusca) ||
          c.outrosParticipantes.some((p) => p.name.toLowerCase().includes(termoBusca))
      )

  return (
    <div className="p-6 h-[calc(100vh-2rem)] max-h-[900px]">
      <div className="flex items-center gap-3 mb-4">
        <MessageCircleMore size={20} className="text-gold-400" />
        <div className="flex-1">
          <h1 className="font-heading text-xl text-dark-50">Chat Grupo Odin</h1>
          <p className="text-sm text-dark-400">Converse direto com qualquer colega, ou pelo contexto de um lead/cliente/pedido/visita/crédito.</p>
        </div>
        <MinhaFoto />
      </div>

      <div className="flex gap-4 h-[calc(100%-4rem)] min-h-0">
        <div className="w-80 shrink-0 bg-dark-800 border border-dark-600 rounded-2xl flex flex-col min-h-0 relative">
          <div className="flex items-center justify-between p-3 border-b border-dark-700 shrink-0">
            <p className="text-sm font-semibold text-dark-200">Conversas</p>
            <div className="relative">
              <button
                onClick={() => setMenuNovaAberto((v) => !v)}
                className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300"
              >
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
          <div className="flex-1 overflow-y-auto divide-y divide-dark-700">
            {isLoading && <p className="p-3 text-sm text-dark-500">Carregando...</p>}
            {!isLoading && !conversas?.length && <p className="p-3 text-sm text-dark-500">Nenhuma conversa ainda.</p>}
            {!isLoading && !!conversas?.length && !conversasFiltradas?.length && (
              <p className="p-3 text-sm text-dark-500">Nenhuma conversa encontrada.</p>
            )}
            {conversasFiltradas?.map((c) => {
              const outro = c.tipoOrigem === 'grupo' ? undefined : c.outrosParticipantes[0]
              return (
                <button
                  key={c.id}
                  onClick={() => setSelecionada(c.id)}
                  className={`w-full text-left p-3 flex items-start gap-2.5 hover:bg-dark-700/40 transition-colors ${selecionada === c.id ? 'bg-dark-700/60' : ''}`}
                >
                  <Avatar nome={outro?.name ?? c.titulo} fotoUrl={outro?.fotoUrl} online={c.tipoOrigem === 'direta' ? outro?.chatOnline : undefined} size="sm" />
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
            <NovaConversaModal
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

        <div className="flex-1 bg-dark-800 border border-dark-600 rounded-2xl min-h-0 flex flex-col">
          {conversaAtual ? (
            <>
              <div className="flex items-center gap-2 p-3 border-b border-dark-700 shrink-0">
                <p className="text-sm font-semibold text-dark-100">{conversaAtual.titulo}</p>
                {TIPO_ORIGEM_LABEL[conversaAtual.tipoOrigem] && (
                  <Badge className="bg-dark-700 border-dark-600 text-dark-300">{TIPO_ORIGEM_LABEL[conversaAtual.tipoOrigem]}</Badge>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <ChatJanela conversaId={conversaAtual.id} onExcluida={() => setSelecionada(null)} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-dark-500 text-sm">
              Escolha uma conversa ou comece uma nova.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
