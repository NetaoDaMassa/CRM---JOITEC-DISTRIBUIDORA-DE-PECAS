import { Link } from 'react-router-dom'
import { trpc } from '../../lib/trpc'
import { corUrgencia, sugestaoProximoPasso, tentativasNaEtapaAtual } from '../../components/FunilBoard'
import ContatoButtons from '../../components/ui/ContatoButtons'

const ETAPA_LABEL: Record<string, string> = {
  novo: 'Novo',
  abordagem: 'Abordagem',
  negociacao: 'Negociação',
  sem_contato: 'Sem contato',
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  return partes.length > 1 ? (partes[0][0] + partes[1][0]).toUpperCase() : nome.slice(0, 2).toUpperCase()
}

export default function FilaHoje() {
  const { data, isLoading } = trpc.funil.filaHoje.useQuery()
  const criticos = data?.cards.filter((c) => c.diasSemContato !== null && c.diasSemContato >= 7).length ?? 0
  const nuncaContatados = data?.cards.filter((c) => c.diasSemContato === null).length ?? 0

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="font-heading text-2xl text-gold-400 font-bold">Fila de Hoje</h1>
        <p className="text-dark-400 text-sm">
          Clientes em aberto que precisam de ação, do mais urgente pro menos urgente — não precisa caçar no Kanban.
        </p>
      </div>

      {(criticos > 0 || nuncaContatados > 0) && (
        <div className="flex flex-wrap gap-3">
          {nuncaContatados > 0 && (
            <div className="text-sm bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl px-4 py-2 font-medium">
              {nuncaContatados} cliente{nuncaContatados > 1 ? 's' : ''} ainda sem nenhum contato
            </div>
          )}
          {criticos > 0 && (
            <div className="text-sm bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-xl px-4 py-2 font-medium">
              {criticos} cliente{criticos > 1 ? 's' : ''} há 7+ dias sem contato
            </div>
          )}
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-dark-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && !data?.cards.length && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-8 text-center text-dark-400 text-sm">
          Fila vazia — nenhum cliente em aberto precisando de ação agora. 🎉
        </div>
      )}

      <div className="space-y-2">
        {data?.cards.map((card) => (
          <div key={card.funilMensalId} className="bg-dark-800 border border-dark-600 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-dark-700 text-dark-300 text-xs font-bold flex items-center justify-center shrink-0">
                  {iniciais(card.razaoSocial)}
                </div>
                <div className="min-w-0">
                  <Link to={`/vendedor/clientes/${card.clienteId}`} className="text-sm font-medium text-dark-100 hover:text-gold-400 truncate block">
                    {card.razaoSocial}
                  </Link>
                  <div className="flex items-center gap-2 mt-0.5 text-xs">
                    <span className="text-dark-500 bg-dark-700/60 px-2 py-0.5 rounded-full">{ETAPA_LABEL[card.etapa] ?? card.etapa}</span>
                    <span className={corUrgencia(card.diasSemContato)}>
                      {card.diasSemContato === null ? 'Nunca contatado' : `${card.diasSemContato} dia(s) sem contato`}
                    </span>
                    <span className="text-dark-500">{tentativasNaEtapaAtual(card)} tentativa(s) nesta etapa</span>
                  </div>
                </div>
              </div>
              <ContatoButtons telefone={card.telefoneWhatsapp} email={card.email} clienteId={card.clienteId} size="sm" />
            </div>
            {sugestaoProximoPasso(card) && (
              <p className="text-xs text-gold-300 bg-gold-900/10 border border-gold-700/30 rounded-lg px-2 py-1 mt-3 inline-block">
                {sugestaoProximoPasso(card)}
              </p>
            )}
          </div>
        ))}
      </div>

      {data && data.total > data.cards.length && (
        <p className="text-xs text-dark-500">
          Mostrando os {data.cards.length} mais urgentes de {data.total} clientes em aberto.{' '}
          <Link to="/vendedor/kanban" className="text-gold-400 underline">
            Ver todos no Kanban →
          </Link>
        </p>
      )}
    </div>
  )
}
