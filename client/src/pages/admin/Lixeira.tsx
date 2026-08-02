import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'

export default function AdminLixeira() {
  const utils = trpc.useUtils()
  const { data: clientes, isLoading } = trpc.clientes.lixeira.useQuery()

  const restoreMut = trpc.clientes.restore.useMutation({
    onSuccess() {
      toast.success('Cliente restaurado')
      utils.clientes.lixeira.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Lixeira</h1>
        <p className="text-dark-400 text-sm">Clientes excluídos. Nenhum histórico (contatos, pedidos) é apagado.</p>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <div className="p-4 text-sm text-dark-500">Carregando...</div>}
        {!isLoading && clientes?.length === 0 && <div className="p-4 text-sm text-dark-500">A lixeira está vazia.</div>}
        {clientes?.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-4 py-3 text-sm gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {c.comprovanteExclusaoPath && (
                <a href={c.comprovanteExclusaoPath} target="_blank" rel="noreferrer" title="Ver comprovante da exclusão">
                  <img
                    src={c.comprovanteExclusaoPath}
                    alt="Comprovante da exclusão"
                    className="w-12 h-12 rounded-lg object-cover border border-dark-600 shrink-0"
                  />
                </a>
              )}
              <div className="min-w-0">
                <p className="font-medium text-dark-100">{c.razaoSocial}</p>
                <p className="text-dark-400 text-xs">{c.cnpj}</p>
                {c.motivoExclusao && <p className="text-dark-400 text-xs mt-1 truncate">Motivo: {c.motivoExclusao}</p>}
              </div>
            </div>
            <button
              onClick={() => restoreMut.mutate({ id: c.id })}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 shrink-0"
            >
              Restaurar
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
