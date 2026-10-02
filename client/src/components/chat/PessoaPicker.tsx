import { useState } from 'react'
import { Search } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Avatar from './Avatar'

// Lista de TODO MUNDO que usa o CRM (grupo inteiro, cross-empresa) com
// busca por nome e bolinha de online — reaproveitado tanto pra "Nova
// conversa" quanto pra "Com quem você quer falar sobre isso" (ver
// ConversarSobreIssoButton). Agrupado por empresa (Joitec, Compretec...),
// online primeiro dentro de cada grupo — pedido do João, 2026-10-02.
export default function PessoaPicker({ onEscolher, excluirIds }: { onEscolher: (userId: number) => void; excluirIds?: number[] }) {
  const [busca, setBusca] = useState('')
  const { data: usuarios } = trpc.chat.usuarios.useQuery()

  const filtrados = (usuarios ?? [])
    .filter((u) => !excluirIds?.includes(u.id))
    .filter((u) => u.name.toLowerCase().includes(busca.toLowerCase()))

  const grupos = new Map<string, typeof filtrados>()
  for (const u of filtrados) {
    const lista = grupos.get(u.empresaNome) ?? []
    lista.push(u)
    grupos.set(u.empresaNome, lista)
  }
  for (const lista of grupos.values()) {
    lista.sort((a, b) => Number(b.chatOnline) - Number(a.chatOnline) || a.name.localeCompare(b.name, 'pt-BR'))
  }
  const empresasOrdenadas = [...grupos.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'))

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-dark-700 shrink-0">
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
      <div className="flex-1 overflow-y-auto min-h-0">
        {empresasOrdenadas.map((empresaNome) => (
          <div key={empresaNome}>
            <p className="sticky top-0 bg-dark-800 px-3 py-1.5 text-[11px] font-semibold text-dark-500 uppercase tracking-wide border-b border-dark-700">
              {empresaNome}
            </p>
            <div className="divide-y divide-dark-700">
              {grupos.get(empresaNome)!.map((u) => (
                <button
                  key={u.id}
                  onClick={() => onEscolher(u.id)}
                  className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-dark-700/50 transition-colors"
                >
                  <Avatar nome={u.name} fotoUrl={u.fotoUrl} online={u.chatOnline} size="sm" />
                  <span className="text-sm text-dark-100">{u.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {!filtrados.length && <p className="p-3 text-sm text-dark-500">Ninguém encontrado.</p>}
      </div>
    </div>
  )
}
