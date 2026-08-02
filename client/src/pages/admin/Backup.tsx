import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { formatDateTime } from '../../lib/utils'

function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function AdminBackup() {
  const utils = trpc.useUtils()
  const { data: backups, isLoading } = trpc.backup.listar.useQuery()

  const rodarMut = trpc.backup.rodarAgora.useMutation({
    onSuccess() {
      toast.success('Backup criado com sucesso')
      utils.backup.listar.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl text-dark-50">Backup</h1>
          <p className="text-dark-400 text-sm">Cópia diária automática do banco de dados e dos arquivos enviados (PDFs de pedido).</p>
        </div>
        <Button onClick={() => rodarMut.mutate()} loading={rodarMut.isPending}>
          Rodar backup agora
        </Button>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <div className="p-4 text-sm text-dark-500">Carregando...</div>}
        {!isLoading && backups?.length === 0 && <div className="p-4 text-sm text-dark-500">Nenhum backup criado ainda.</div>}
        {backups?.map((b) => (
          <div key={b.arquivo} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <p className="font-medium text-dark-100 font-mono">{b.arquivo}</p>
              <p className="text-dark-400 text-xs">{formatDateTime(b.criadoEm)}</p>
            </div>
            <span className="text-dark-400 font-mono text-xs">{formatarTamanho(b.tamanhoBytes)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
