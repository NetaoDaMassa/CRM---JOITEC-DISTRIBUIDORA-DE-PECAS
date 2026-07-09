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

export default function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const seenIds = useRef<Set<number> | null>(null)

  const { data: items } = trpc.notifications.list.useQuery(undefined, { refetchInterval: 30000 })
  const unreadCount = items?.filter((n) => !n.read).length ?? 0

  useEffect(() => {
    if (!items) return
    const unreadIds = new Set(items.filter((n) => !n.read).map((n) => n.id))
    if (seenIds.current !== null) {
      const hasNew = [...unreadIds].some((id) => !seenIds.current!.has(id))
      if (hasNew) playBeep()
    }
    seenIds.current = unreadIds
  }, [items])

  const markReadMut = trpc.notifications.markRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  })
  const markAllReadMut = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  })

  function handleNotificationClick(n: { id: number; read: boolean; leadId: number | null }) {
    if (!n.read) markReadMut.mutate({ id: n.id })
    setOpen(false)
    if (n.leadId) {
      const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'
      navigate(`${basePath}/leads/${n.leadId}`)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg text-dark-300 hover:text-dark-100 hover:bg-dark-800 transition-colors"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl shadow-black/50 z-50 max-h-96 flex flex-col">
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
                <p className="text-dark-500 text-sm text-center py-6">Nenhuma notificação</p>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`w-full text-left px-4 py-3 border-b border-dark-700/50 hover:bg-dark-700/50 transition-colors ${
                      !n.read ? 'bg-gold-600/5' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-gold-500 mt-1.5 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-dark-100 font-medium">{n.title}</p>
                        <p className="text-xs text-dark-400 mt-0.5">{n.message}</p>
                        <p className="text-xs text-dark-500 mt-1">{timeAgo(n.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
