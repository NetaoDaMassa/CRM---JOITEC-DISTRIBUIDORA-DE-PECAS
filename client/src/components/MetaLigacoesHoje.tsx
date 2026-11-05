import { Link } from 'react-router-dom'
import { PhoneCall } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'

// Contador do topo: ligações efetivas de hoje × meta diária (PABX). Só
// aparece pra quem tem ramal numa empresa com meta (Odin Tubos: 30/dia).
// Soma lead, carteira, prospecção e número fora do CRM — router/pabx.ts.
export default function MetaLigacoesHoje() {
  const { user } = useAuth()
  const { data } = trpc.pabx.minhaMetaHoje.useQuery(undefined, { refetchInterval: 60_000, staleTime: 30_000 })
  if (!data) return null
  const bateu = data.efetivas >= data.meta
  const pct = Math.min(100, Math.round((data.efetivas / data.meta) * 100))
  const cor = bateu ? 'text-green-300 border-green-500/40 bg-green-500/10' : pct >= 60 ? 'text-amber-300 border-amber-500/40 bg-amber-500/10' : 'text-dark-200 border-dark-600 bg-dark-800'
  const conteudo = (
    <>
      <PhoneCall size={14} />
      <span className="font-mono">
        {data.efetivas}/{data.meta}
      </span>
      <span className="hidden sm:inline font-normal">ligações hoje</span>
    </>
  )
  const classe = `flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold ${cor}`
  const dica = 'Ligações efetivas hoje (lead, carteira, prospecção e fora do CRM, sem colegas) × meta do dia'
  // Vendedor não abre /admin/ligacoes (AdminGuard) — pra ele é só o contador.
  if (user?.role !== 'admin')
    return (
      <span title={dica} className={classe}>
        {conteudo}
      </span>
    )
  return (
    <Link
      to="/admin/ligacoes"
      title={dica}
      className={classe}
    >
      {conteudo}
    </Link>
  )
}
