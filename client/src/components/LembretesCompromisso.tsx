import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'

const TIPO_LABEL: Record<string, string> = { ligacao: 'Ligação', visita: 'Visita', reuniao: 'Reunião', outro: 'Compromisso' }

// Componente invisível, montado uma vez no Layout — fica de olho nos
// compromissos que estão perto de vencer e dispara uma notificação real do
// navegador (funciona mesmo com a aba em segundo plano, diferente do sino
// que só é visto se o usuário abrir o dropdown). Não existe processo de
// servidor rodando 24h só pra isso, então o aviso só dispara enquanto o
// vendedor estiver com o navegador aberto — por isso o polling é frequente
// (a cada 30s) e olha uma janela de 5 minutos à frente.
export default function LembretesCompromisso() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const utils = trpc.useUtils()

  const { data: pendentes } = trpc.compromissos.pendentesNotificacao.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 30000,
  })

  const marcarMut = trpc.compromissos.marcarNotificado.useMutation({
    onSuccess: () => utils.compromissos.pendentesNotificacao.invalidate(),
  })

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  useEffect(() => {
    if (!pendentes?.length) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return

    for (const c of pendentes) {
      const titulo = `${TIPO_LABEL[c.tipo] ?? 'Compromisso'}: ${c.titulo}`
      const corpo = c.cliente ? `Cliente: ${c.cliente.razaoSocial}` : c.descricao ?? ''
      const notif = new Notification(titulo, { body: corpo, tag: `compromisso-${c.id}` })
      notif.onclick = () => {
        window.focus()
        const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'
        navigate(`${basePath}/calendario`)
        notif.close()
      }
      marcarMut.mutate({ id: c.id })
    }
  }, [pendentes])

  return null
}
