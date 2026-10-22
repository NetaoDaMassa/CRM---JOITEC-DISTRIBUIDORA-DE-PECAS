import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { timeAgo } from '../lib/utils'

function playBeep() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new AudioContextClass()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.35)
  } catch {
    // Autoplay pode ser bloqueado antes de qualquer interação do usuário; ignora silenciosamente.
  }
}

function rotuloDoTipo(tipo: string, titulo: string): string {
  const t = tipo.toLowerCase()
  if (t.includes('sem_contato') || t.includes('contato')) return 'Clientes sem contato'
  if (t.includes('lead')) return 'Leads'
  if (t.includes('demanda')) return 'Demandas'
  if (t.includes('venda') || t.includes('meta')) return 'Vendas e metas'
  if (t.includes('compromisso') || t.includes('agenda')) return 'Agenda'
  if (t.includes('resumo')) return 'Resumo do dia'
  if (t.includes('design') || t.includes('arte')) return 'Design'
  if (t.includes('credito') || t.includes('boleto')) return 'Financeiro'
  return titulo.length > 28 ? tipo.replace(/_/g, ' ') : titulo
}

function iconeDoTipo(tipo: string, titulo: string): string {
  const t = `${tipo} ${titulo}`.toLowerCase()
  if (t.includes('lead')) return '🧲'
  if (t.includes('demanda')) return '📌'
  if (t.includes('contato')) return '⏰'
  if (t.includes('venda') || t.includes('meta')) return '💰'
  if (t.includes('compromisso') || t.includes('agenda')) return '🗓️'
  if (t.includes('resumo')) return '📋'
  if (t.includes('design') || t.includes('arte')) return '🎨'
  if (t.includes('credito') || t.includes('boleto')) return '💳'
  return '🔔'
}

export default function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const seenIds = useRef<Set<number> | null>(null)

  const { data: items } = trpc.notifications.list.useQuery(undefined, { refetchInterval: 30000 })
  const unreadCount = items?.filter((n) => !n.read).length ?? 0
  const [gruposAbertos, setGruposAbertos] = useState<Set<string>>(new Set())

  // Design novo (teste): avisos do mesmo tipo juntos ("Cliente sem contato
  // · 12"), em vez de uma lista comprida misturada.
  const grupos = (() => {
    const mapa = new Map<string, { tipo: string; rotulo: string; itens: NonNullable<typeof items>; naoLidas: number; maisRecente: string }>()
    for (const n of items ?? []) {
      const rotulo = rotuloDoTipo(n.type, n.title)
      const g = mapa.get(rotulo) ?? { tipo: rotulo, rotulo, itens: [], naoLidas: 0, maisRecente: n.createdAt }
      g.itens.push(n)
      if (!n.read) g.naoLidas++
      if (n.createdAt > g.maisRecente) g.maisRecente = n.createdAt
      mapa.set(rotulo, g)
    }
    return [...mapa.values()].sort((a, b) => b.naoLidas - a.naoLidas || b.maisRecente.localeCompare(a.maisRecente))
  })()

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  useEffect(() => {
    if (!items) return
    const unread = items.filter((n) => !n.read)
    const unreadIds = new Set(unread.map((n) => n.id))
    if (seenIds.current !== null) {
      const newOnes = unread.filter((n) => !seenIds.current!.has(n.id))
      if (newOnes.length > 0) {
        playBeep()
        if ('Notification' in window && Notification.permission === 'granted') {
          for (const n of newOnes) {
            const desktopNotification = new Notification(n.title, {
              body: n.message,
              icon: '/logos/grupo-odin.png',
              tag: `odin-crm-notification-${n.id}`,
            })
            desktopNotification.onclick = () => {
              window.focus()
              const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'
              if (n.clienteId) navigate(`${basePath}/clientes/${n.clienteId}`)
              else if (n.leadId) navigate(`${basePath}/leads/${n.leadId}`)
              desktopNotification.close()
            }
          }
        }
      }
    }
    seenIds.current = unreadIds
  }, [items])

  const markReadMut = trpc.notifications.markRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  })
  const markAllReadMut = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  })

  function handleNotificationClick(n: { id: number; read: boolean; clienteId: number | null; leadId: number | null }) {
    if (!n.read) markReadMut.mutate({ id: n.id })
    setOpen(false)
    const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'
    if (n.clienteId) navigate(`${basePath}/clientes/${n.clienteId}`)
    else if (n.leadId) navigate(`${basePath}/leads/${n.leadId}`)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg text-dark-300 hover:text-dark-100 hover:bg-dark-800 transition-colors"
      >
        <Bell size={18} className={unreadCount > 0 ? 'origin-top animate-[sino_2.4s_ease-in-out_infinite]' : ''} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] bg-dark-800 border border-dark-600 rounded-xl shadow-2xl shadow-black/50 z-50 max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600 shrink-0">
              <span className="text-sm font-medium text-dark-100">Notificações</span>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllReadMut.mutate()}
                  className="text-xs text-gold-400 hover:text-gold-300 transition-colors"
                >
                  Marcar todas como lidas
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1">
              {!items || items.length === 0 ? (
                <p className="text-dark-500 text-sm text-center py-6">Nenhuma notificação 🎉</p>
              ) : (
                grupos.map((g) => {
                  const aberto = gruposAbertos.has(g.tipo)
                  const visiveis = aberto ? g.itens : g.itens.slice(0, 3)
                  return (
                    <div key={g.tipo} className="border-b border-dark-700/60 last:border-0">
                      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                        <span className="text-base leading-none">{iconeDoTipo(g.itens[0].type, g.itens[0].title)}</span>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-dark-400 truncate">{g.rotulo}</span>
                        <span className="ml-auto text-[10px] font-bold rounded-full px-1.5 py-0.5 bg-dark-700 text-dark-300">
                          {g.naoLidas > 0 ? `${g.naoLidas} nova${g.naoLidas > 1 ? 's' : ''}` : g.itens.length}
                        </span>
                      </div>
                      {visiveis.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => handleNotificationClick(n)}
                          className={`w-full text-left px-4 py-2 hover:bg-dark-700/50 transition-colors ${!n.read ? 'bg-gold-600/5' : ''}`}
                        >
                          <div className="flex items-start gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${!n.read ? 'bg-gold-500' : 'bg-transparent'}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-dark-100 font-medium truncate">{n.title}</p>
                              <p className="text-xs text-dark-400 mt-0.5 line-clamp-2">{n.message}</p>
                              <p className="text-[11px] text-dark-500 mt-0.5">{timeAgo(n.createdAt)}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                      {g.itens.length > 3 && (
                        <button
                          type="button"
                          onClick={() =>
                            setGruposAbertos((prev) => {
                              const novo = new Set(prev)
                              if (novo.has(g.tipo)) novo.delete(g.tipo)
                              else novo.add(g.tipo)
                              return novo
                            })
                          }
                          className="w-full text-xs text-gold-400 hover:text-gold-300 px-4 pb-2.5 pt-1 text-left"
                        >
                          {aberto ? 'Mostrar menos' : `Ver mais ${g.itens.length - 3}`}
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
