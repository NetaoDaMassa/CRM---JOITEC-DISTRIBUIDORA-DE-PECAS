import { useState } from 'react'
import { MessageCircleMore, Search, Plus, X } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { timeAgo } from '../lib/utils'
import { Badge } from '../components/ui/Badge'
import ChatJanela from '../components/chat/ChatJanela'

const TIPO_ORIGEM_LABEL: Record<string, string> = {
  lead: '🎯 Lead',
  cliente: '🏢 Cliente',
  pedido: '📦 Pedido',
  visita: '🚗 Visita',
  consulta_credito: '💳 Consulta de crédito',
  direta: '',
}

// Picker de pessoa pra iniciar uma conversa direta — lista TODO MUNDO que
// usa o CRM (grupo inteiro, cross-empresa, pedido do João 2026-10-02), com
// bolinha de online/offline.
function NovaConversaModal({ onClose, onCriada }: { onClose: () => void; onCriada: (conversaId: number) => void }) {
  const [busca, setBusca] = useState('')
  const { data: usuarios } = trpc.chat.usuarios.useQuery()
  const abrirMut = trpc.chat.conversas.abrirDireta.useMutation({ onSuccess: (data) => onCriada(data.id) })

  const filtrados = (usuarios ?? []).filter((u) => u.name.toLowerCase().includes(busca.toLowerCase()))

  return (
    <div className="absolute inset-0 z-20 bg-dark-800 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-dark-700">
        <p className="text-sm font-semibold text-dark-100">Nova conversa</p>
        <button onClick={onClose} className="text-dark-400 hover:text-dark-100">
          <X size={16} />
        </button>
      </div>
      <div className="p-3 border-b border-dark-700">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pessoa..."
            className="w-full bg-dark-900 border border-dark-600 rounded-lg pl-8 pr-3 py-2 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-gold-600"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-dark-700">
        {filtrados.map((u) => (
          <button
            key={u.id}
            onClick={() => abrirMut.mutate({ outroUserId: u.id })}
            className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-dark-700/50 transition-colors"
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${u.chatOnline ? 'bg-green-500' : 'bg-dark-600'}`} />
            <span className="text-sm text-dark-100">{u.name}</span>
          </button>
        ))}
        {!filtrados.length && <p className="p-3 text-sm text-dark-500">Ninguém encontrado.</p>}
      </div>
    </div>
  )
}

export default function Chat() {
  const [selecionada, setSelecionada] = useState<number | null>(null)
  const [novaConversaAberta, setNovaConversaAberta] = useState(false)
  const { data: conversas, isLoading } = trpc.chat.conversas.listar.useQuery()

  const conversaAtual = conversas?.find((c) => c.id === selecionada)

  return (
    <div className="p-6 h-[calc(100vh-2rem)] max-h-[900px]">
      <div className="flex items-center gap-2 mb-4">
        <MessageCircleMore size={20} className="text-gold-400" />
        <div>
          <h1 className="font-heading text-xl text-dark-50">Chat Grupo Odin</h1>
          <p className="text-sm text-dark-400">Converse direto com qualquer colega, ou pelo contexto de um lead/cliente/pedido/visita/crédito.</p>
        </div>
      </div>

      <div className="flex gap-4 h-[calc(100%-4rem)] min-h-0">
        <div className="w-80 shrink-0 bg-dark-800 border border-dark-600 rounded-2xl flex flex-col min-h-0 relative">
          <div className="flex items-center justify-between p-3 border-b border-dark-700 shrink-0">
            <p className="text-sm font-semibold text-dark-200">Conversas</p>
            <button
              onClick={() => setNovaConversaAberta(true)}
              className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300"
            >
              <Plus size={14} /> Nova
            </button>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-dark-700">
            {isLoading && <p className="p-3 text-sm text-dark-500">Carregando...</p>}
            {!isLoading && !conversas?.length && <p className="p-3 text-sm text-dark-500">Nenhuma conversa ainda.</p>}
            {conversas?.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelecionada(c.id)}
                className={`w-full text-left p-3 hover:bg-dark-700/40 transition-colors ${selecionada === c.id ? 'bg-dark-700/60' : ''}`}
              >
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
              </button>
            ))}
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
                <ChatJanela conversaId={conversaAtual.id} />
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
