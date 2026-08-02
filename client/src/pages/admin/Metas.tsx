import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import Button from '../../components/ui/Button'

function formatarMoeda(v: number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function AdminMetas() {
  const { data, isLoading } = trpc.metas.listaMesCorrente.useQuery()
  const utils = trpc.useUtils()
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [faturamento, setFaturamento] = useState('')
  const [ligacoesDia, setLigacoesDia] = useState('')

  const definirMut = trpc.metas.definir.useMutation({
    onSuccess() {
      toast.success('Meta salva')
      utils.metas.listaMesCorrente.invalidate()
      setEditandoId(null)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function abrirEdicao(vendedorId: number, atual: { metaFaturamento: number | null; metaLigacoesDia: number } | null) {
    setEditandoId(vendedorId)
    setFaturamento(atual?.metaFaturamento?.toString() ?? '')
    setLigacoesDia(atual?.metaLigacoesDia?.toString() ?? '25')
  }

  return (
    <div className="p-6 max-w-2xl space-y-4">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Metas do mês</h1>
        <p className="text-dark-400 text-sm">Meta de faturamento e de ligações/dia por vendedor, mês corrente.</p>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <div className="p-4 text-sm text-dark-500">Carregando...</div>}
        {data?.map((v) => (
          <div key={v.vendedorId} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-dark-100">{v.nome}</p>
                <p className="text-xs text-dark-500">
                  {v.meta ? (
                    <>
                      {formatarMoeda(v.meta.metaFaturamento)} · {v.meta.metaLigacoesDia} ligações/dia
                    </>
                  ) : (
                    'Sem meta definida'
                  )}
                </p>
              </div>
              {editandoId !== v.vendedorId && (
                <button
                  onClick={() => abrirEdicao(v.vendedorId, v.meta)}
                  className="text-xs text-gold-400 hover:text-gold-300"
                >
                  Editar
                </button>
              )}
            </div>

            {editandoId === v.vendedorId && (
              <div className="mt-3 flex items-end gap-2">
                <Input
                  label="Meta faturamento (R$)"
                  type="number"
                  value={faturamento}
                  onChange={(e) => setFaturamento(e.target.value)}
                  className="flex-1"
                />
                <Input
                  label="Ligações/dia"
                  type="number"
                  value={ligacoesDia}
                  onChange={(e) => setLigacoesDia(e.target.value)}
                  className="w-28"
                />
                <Button
                  size="sm"
                  loading={definirMut.isPending}
                  onClick={() =>
                    definirMut.mutate({
                      vendedorId: v.vendedorId,
                      metaFaturamento: faturamento ? Number(faturamento) : undefined,
                      metaLigacoesDia: ligacoesDia ? Number(ligacoesDia) : undefined,
                    })
                  }
                >
                  Salvar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setEditandoId(null)}>
                  Cancelar
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
