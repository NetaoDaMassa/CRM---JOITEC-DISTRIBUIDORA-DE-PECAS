import { Link } from 'react-router-dom'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import ContatoButtons from '../components/ui/ContatoButtons'

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  return partes.length > 1 ? (partes[0][0] + partes[1][0]).toUpperCase() : nome.slice(0, 2).toUpperCase()
}

export default function FilaPosVenda() {
  const { user, empresaAtivaId } = useAuth()
  const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'
  const utils = trpc.useUtils()
  const { data: empresas } = trpc.empresas.list.useQuery()
  const empresaAtiva = empresas?.find((e) => e.id === empresaAtivaId)
  const ehOdinCompressores = empresaAtiva?.slug === 'odin-compressores'

  const { data, isLoading } = trpc.maquinas.filaPosVenda.useQuery(undefined, { enabled: ehOdinCompressores })
  const marcarTrocaMut = trpc.maquinas.marcarTrocaItem.useMutation({
    onSuccess: () => utils.maquinas.filaPosVenda.invalidate(),
  })

  if (empresaAtiva && !ehOdinCompressores) {
    return (
      <div className="p-6">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-8 text-center text-dark-400 text-sm max-w-md">
          A Fila de Pós-venda é específica da Odin Compressores (acompanhamento de troca de filtro por horas de uso).
        </div>
      </div>
    )
  }

  const vencidos = data?.filter((i) => i.vencido).length ?? 0
  const proximos15dias = data?.filter((i) => !i.vencido && (i.diasRestantes ?? Infinity) <= 15).length ?? 0

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="font-heading text-2xl text-gold-400 font-bold">Fila de Pós-venda</h1>
        <p className="text-dark-400 text-sm">
          Máquinas já vendidas, do mais urgente pro menos urgente pra oferecer a próxima peça de manutenção antes que o cliente precise.
        </p>
      </div>

      {(vencidos > 0 || proximos15dias > 0) && (
        <div className="flex flex-wrap gap-3">
          {vencidos > 0 && (
            <div className="text-sm bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl px-4 py-2 font-medium">
              {vencidos} máquina{vencidos > 1 ? 's' : ''} com troca já vencida
            </div>
          )}
          {proximos15dias > 0 && (
            <div className="text-sm bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-xl px-4 py-2 font-medium">
              {proximos15dias} vencendo nos próximos 15 dias
            </div>
          )}
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-dark-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && !data?.length && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-8 text-center text-dark-400 text-sm">
          Nenhuma máquina cadastrada ainda — cadastre pela ficha do cliente ("🔧 Máquinas vendidas").
        </div>
      )}

      <div className="space-y-2">
        {data?.map((item) => (
          <div key={item.maquinaId} className="bg-dark-800 border border-dark-600 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-dark-700 text-dark-300 text-xs font-bold flex items-center justify-center shrink-0">
                  {iniciais(item.razaoSocial)}
                </div>
                <div className="min-w-0">
                  <Link to={`${basePath}/clientes/${item.clienteId}`} className="text-sm font-medium text-dark-100 hover:text-gold-400 truncate block">
                    {item.razaoSocial}
                  </Link>
                  <div className="flex items-center gap-2 mt-0.5 text-xs flex-wrap">
                    <span className="text-dark-500 bg-dark-700/60 px-2 py-0.5 rounded-full">
                      {item.modelo} {item.quantidade > 1 ? `× ${item.quantidade}` : ''}
                    </span>
                    <span className={item.vencido ? 'text-red-400' : (item.diasRestantes ?? 999) <= 15 ? 'text-amber-400' : 'text-dark-400'}>
                      {item.itemMaisUrgente}:{' '}
                      {item.diasRestantes === null
                        ? 'sem estimativa'
                        : item.vencido
                          ? `venceu há ${Math.abs(item.diasRestantes)}d`
                          : `em ${item.diasRestantes}d`}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ContatoButtons telefone={item.telefoneWhatsapp} email={null} clienteId={item.clienteId} size="sm" />
                <button
                  onClick={() => marcarTrocaMut.mutate({ maquinaId: item.maquinaId, itemId: item.itemId })}
                  disabled={marcarTrocaMut.isPending}
                  className="text-xs text-dark-400 hover:text-gold-400 underline whitespace-nowrap"
                >
                  Marcar troca feita
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
