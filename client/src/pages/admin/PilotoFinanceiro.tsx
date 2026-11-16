import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

// Piloto do financeiro (João, 2026-11-16): quem está aqui já usa as regras
// novas do financeiro nas telas de todo mundo. O resto continua como antes.
const O_QUE_MUDA = [
  'Trava do PIX: venda à vista / entrada + boleto pede comprovante, e a expedição só libera depois que o financeiro confere (vale para as vendas dos vendedores do piloto).',
  'Trava dos isentos: pedido de cliente isento só agenda/fecha coleta depois do "Pago" em Faturamento isentos (pedidos dos vendedores do piloto).',
  'Pedir link de pagamento: aparece no menu só para quem está no piloto.',
]

export default function PilotoFinanceiro() {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.pilotoFinanceiro.obter.useQuery()
  const [todos, setTodos] = useState(false)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [busca, setBusca] = useState('')
  useEffect(() => {
    if (!data) return
    setTodos(data.todos)
    setSel(new Set(data.usuarios))
  }, [data])
  const salvar = trpc.pilotoFinanceiro.salvar.useMutation({
    onSuccess: () => (toast.success('Piloto salvo'), utils.pilotoFinanceiro.invalidate()),
    onError: (e) => toast.error(e.message),
  })
  const pessoas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const l = (data?.pessoas ?? []).filter((p) => !q || `${p.name} ${p.username} ${p.empresaNome ?? ''}`.toLowerCase().includes(q))
    return [...l].sort((a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)))
  }, [data, busca, sel])
  const alternar = (id: number) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Piloto do financeiro</h1>
        <p className="text-sm text-dark-400 mt-1">Só as pessoas marcadas aqui usam as regras novas. Para os outros, tudo continua como antes. As telas novas do financeiro continuam liberadas pessoa a pessoa em Funções e permissões.</p>
      </div>
      <ul className="list-disc pl-5 text-sm text-dark-300 space-y-1">
        {O_QUE_MUDA.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>

      <label className="flex items-center gap-2 rounded-xl border border-dark-600 bg-dark-800 p-3 text-sm text-dark-100 cursor-pointer">
        <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} className="h-4 w-4 accent-gold-500" />
        <span>
          <b>Liberar para todo mundo</b> (fim do piloto)
        </span>
      </label>

      {!todos && (
        <div className="rounded-xl border border-dark-600 bg-dark-800 p-3 space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="w-64">
              <Input label="Buscar pessoa" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, usuário ou empresa" />
            </div>
            <p className="text-sm text-gold-300">{sel.size} no piloto</p>
          </div>
          {isLoading && <p className="text-sm text-dark-400">Carregando…</p>}
          <div className="max-h-[55vh] overflow-y-auto divide-y divide-dark-700">
            {pessoas.map((p) => (
              <label key={p.id} className="flex items-center gap-3 py-2 px-1 cursor-pointer hover:bg-dark-700/30">
                <input type="checkbox" checked={sel.has(p.id)} onChange={() => alternar(p.id)} className="h-4 w-4 accent-gold-500" />
                <span className="flex-1 text-sm text-dark-100">
                  {p.name} <span className="text-dark-500">· {p.username}</span>
                </span>
                <span className="text-xs text-dark-400">
                  {p.role === 'vendor' ? 'Vendedor' : p.role === 'admin' ? 'Admin' : p.role} · {p.empresaNome ?? '—'}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <Button onClick={() => salvar.mutate({ todos, usuarios: [...sel] })} loading={salvar.isPending}>
        Salvar
      </Button>
    </div>
  )
}
