import { useState } from 'react'
import { Search } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { timeAgo } from '../../lib/utils'
import Avatar from './Avatar'
import { SeloSemResposta } from './SemResposta'

// Lista de conversas (tela cheia e popup) — João, 2026-11-27: "pro vendedor e
// pros outros gerentes é difícil entender do que de fato estão falando ou de
// qual cliente". Antes: "Katiely Chafron dos Santos — Con..." cortado. Agora o
// CLIENTE vem em destaque, com código do SAP e nº do pedido em etiquetas, e
// quem é o responsável embaixo. Mais filtros por tipo.

type Conversa = inferRouterOutputs<AppRouter>['chat']['conversas']['listar'][number]

export const TIPO_ORIGEM_LABEL: Record<string, string> = {
  lead: '🎯 Lead',
  cliente: '🏢 Cliente',
  pedido: '📦 Pedido',
  visita: '🚗 Visita',
  consulta_credito: '💳 Crédito',
  expedicao: '🚚 Expedição',
  direta: '',
  grupo: '👥 Grupo',
}

const FILTROS = [
  { id: 'todas', label: 'Todas' },
  { id: 'nao_lidas', label: 'Não lidas' },
  { id: 'responder', label: '⏳ Falta responder' },
  { id: 'consulta_credito', label: '💳 Crédito' },
  { id: 'expedicao', label: '🚚 Expedição' },
  { id: 'clientes', label: '🏢 Clientes/Leads' },
  { id: 'pessoas', label: '👤 Pessoas/Grupos' },
] as const
type FiltroId = (typeof FILTROS)[number]['id']

function passaFiltro(c: Conversa, f: FiltroId): boolean {
  switch (f) {
    case 'todas':
      return true
    case 'nao_lidas':
      return c.naoLidas > 0
    case 'responder':
      return c.faltaResponder
    case 'consulta_credito':
      return c.tipoOrigem === 'consulta_credito'
    case 'expedicao':
      return c.tipoOrigem === 'expedicao' || c.tipoOrigem === 'pedido'
    case 'clientes':
      return c.tipoOrigem === 'cliente' || c.tipoOrigem === 'lead' || c.tipoOrigem === 'visita'
    case 'pessoas':
      return c.tipoOrigem === 'direta' || c.tipoOrigem === 'grupo'
  }
}

function previaUltima(c: Conversa): string {
  const u = c.ultimaMensagem
  if (!u) return 'Sem mensagens ainda'
  if (u.tipo === 'texto') return u.texto ?? ''
  if (u.tipo === 'imagem') return `📷 Foto${u.texto ? ` · ${u.texto}` : ''}`
  if (u.tipo === 'audio') return '🎤 Áudio'
  if (u.tipo === 'video') return '🎥 Vídeo'
  return `📎 Arquivo${u.texto ? ` · ${u.texto}` : ''}`
}

// Título principal da conversa: o cliente quando tem; senão o título antigo.
export function tituloPrincipal(c: Pick<Conversa, 'titulo' | 'tipoOrigem' | 'assunto'>): string {
  if (c.tipoOrigem === 'direta' || c.tipoOrigem === 'grupo') return c.titulo
  return c.assunto?.clienteNome || c.titulo
}

export function EtiquetasAssunto({ c, grande }: { c: { tipoOrigem: string; assunto: Conversa['assunto'] }; grande?: boolean }) {
  const tam = grande ? 'text-[11px] px-2 py-0.5' : 'text-[10px] px-1.5 py-px'
  const a = c.assunto
  return (
    <>
      {TIPO_ORIGEM_LABEL[c.tipoOrigem] && <span className={`${tam} rounded bg-dark-700 border border-dark-600 text-dark-200 whitespace-nowrap`}>{TIPO_ORIGEM_LABEL[c.tipoOrigem]}</span>}
      {a?.clienteCodigo && <span className={`${tam} rounded bg-sky-900/40 border border-sky-700/50 text-sky-200 font-mono whitespace-nowrap`}>Cód. {a.clienteCodigo}</span>}
      {a?.pedidoSap && <span className={`${tam} rounded bg-emerald-900/40 border border-emerald-700/50 text-emerald-200 font-mono whitespace-nowrap`}>Pedido {a.pedidoSap}</span>}
    </>
  )
}

export default function ListaConversas({
  conversas,
  isLoading,
  selecionada,
  onSelecionar,
}: {
  conversas: Conversa[] | undefined
  isLoading: boolean
  selecionada?: number | null
  onSelecionar: (id: number) => void
}) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<FiltroId>('todas')

  const termo = busca.trim().toLowerCase()
  const termoDig = termo.replace(/\D/g, '')
  const filtradas = (conversas ?? []).filter((c) => {
    if (!passaFiltro(c, filtro)) return false
    if (!termo) return true
    const a = c.assunto
    return (
      c.titulo.toLowerCase().includes(termo) ||
      c.outrosParticipantes.some((p) => p.name.toLowerCase().includes(termo)) ||
      !!a?.clienteNome?.toLowerCase().includes(termo) ||
      !!a?.clienteCodigo?.toLowerCase().includes(termo) ||
      (termoDig.length >= 3 && !!a?.pedidoSap?.replace(/\D/g, '').includes(termoDig))
    )
  })
  const contagem = (f: FiltroId) => (conversas ?? []).filter((c) => passaFiltro(c, f) && (f === 'todas' || c.naoLidas > 0 || f === 'responder')).length

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="p-2 border-b border-dark-700 shrink-0 space-y-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente, código, pedido ou pessoa..."
            className="w-full bg-dark-900 border border-dark-600 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-dark-100 placeholder-dark-500 focus:outline-none focus:border-gold-600"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
          {FILTROS.map((f) => {
            const n = f.id === 'nao_lidas' || f.id === 'responder' ? contagem(f.id) : 0
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltro(f.id)}
                className={`shrink-0 text-[11px] rounded-full px-2.5 py-1 border transition-colors whitespace-nowrap ${
                  filtro === f.id ? 'bg-gold-600 border-gold-600 text-dark-950 font-semibold' : 'bg-dark-900 border-dark-600 text-dark-300 hover:text-dark-100'
                }`}
              >
                {f.label}
                {n > 0 && <span className="ml-1 font-bold">{n}</span>}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-dark-700 min-h-0">
        {isLoading && <p className="p-3 text-sm text-dark-500">Carregando...</p>}
        {!isLoading && !conversas?.length && <p className="p-3 text-sm text-dark-500">Nenhuma conversa ainda.</p>}
        {!isLoading && !!conversas?.length && !filtradas.length && <p className="p-3 text-sm text-dark-500">Nenhuma conversa encontrada.</p>}
        {filtradas.map((c) => {
          const pessoal = c.tipoOrigem === 'direta' || c.tipoOrigem === 'grupo'
          const outro = c.tipoOrigem === 'grupo' ? undefined : c.outrosParticipantes[0]
          // Quem está na conversa além de mim (responsável do registro primeiro).
          const pessoas = pessoal ? null : [c.assunto?.responsavel, ...c.outrosParticipantes.map((p) => p.name.split(' ')[0])].filter((x, i, arr) => x && arr.indexOf(x) === i)
          return (
            <button
              key={c.id}
              onClick={() => onSelecionar(c.id)}
              className={`w-full text-left p-3 flex items-start gap-2.5 hover:bg-dark-700/40 transition-colors ${selecionada === c.id ? 'bg-dark-700/60' : ''}`}
            >
              <Avatar nome={outro?.name ?? c.titulo} fotoUrl={outro?.fotoUrl} online={c.tipoOrigem === 'direta' ? outro?.chatOnline : undefined} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-sm text-dark-50 leading-snug line-clamp-2 ${c.naoLidas > 0 ? 'font-bold' : 'font-semibold'}`}>{tituloPrincipal(c)}</p>
                  <div className="flex flex-col items-end shrink-0 gap-0.5">
                    {c.ultimaMensagemEm && <span className={`text-[10px] ${c.naoLidas > 0 ? 'text-gold-400' : 'text-dark-500'}`}>{timeAgo(c.ultimaMensagemEm)}</span>}
                    {c.naoLidas > 0 && <span className="bg-gold-500 text-dark-950 text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">{c.naoLidas}</span>}
                  </div>
                </div>
                {!pessoal && (
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    <EtiquetasAssunto c={c} />
                  </div>
                )}
                {pessoas && pessoas.length > 0 && <p className="text-[11px] text-dark-400 mt-0.5 truncate">👤 {pessoas.join(', ')}</p>}
                <p className={`text-xs truncate mt-0.5 ${c.naoLidas > 0 ? 'text-dark-200' : 'text-dark-500'}`}>{previaUltima(c)}</p>
                <SeloSemResposta c={c} />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
