// Atalho para a tela de Serviços (Compretec Loja Física) a partir do card do
// Kanban, do lead e da prospecção: "conversou e viu que vai ter serviço" →
// abre o Novo serviço já com o cliente. Se já tem serviço aberto, mostra a
// situação e abre ele.
import { Link } from 'react-router-dom'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'

const COR: Record<string, string> = {
  montando_orcamento: '#e040b8',
  aguardando_cliente: '#2f6fed',
  em_andamento: '#f0712c',
}
const LABEL: Record<string, string> = {
  montando_orcamento: 'montando orçamento',
  aguardando_cliente: 'aguardando cliente',
  em_andamento: 'em andamento',
}

export default function BotaoServico({ clienteId, leadId }: { clienteId?: number | null; leadId?: number | null }) {
  const { user } = useAuth()
  const { data: disp } = trpc.servicos.disponivel.useQuery(undefined, { staleTime: 5 * 60_000 })
  const { data: lista } = trpc.servicos.doCliente.useQuery({ clienteId: clienteId ?? undefined, leadId: leadId ?? undefined }, { enabled: !!disp?.mostrar && !!(clienteId || leadId) })
  if (!disp?.mostrar || !(clienteId || leadId)) return null
  const base = user?.role === 'vendor' ? '/vendedor/servicos' : '/admin/servicos'
  const aberto = lista?.find((s) => COR[s.status])
  if (aberto)
    return (
      <Link
        to={`${base}?abrir=${aberto.id}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1.5 text-white hover:brightness-110"
        style={{ background: COR[aberto.status] }}
        title={aberto.tipos.join(' + ')}
      >
        🛠 Serviço {LABEL[aberto.status]}
      </Link>
    )
  return (
    <Link
      to={`${base}?${leadId ? `lead=${leadId}` : `cliente=${clienteId}`}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-xs font-medium rounded-lg px-2.5 py-1.5 border border-gold-600/50 text-gold-300 hover:bg-gold-900/20"
      title="Vai fazer manutenção, rede de ar ou instalação? Abre o serviço já com este cliente."
    >
      🛠 Abrir serviço
    </Link>
  )
}
