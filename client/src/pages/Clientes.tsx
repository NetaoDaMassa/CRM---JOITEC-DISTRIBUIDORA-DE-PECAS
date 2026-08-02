import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'
import ContatoButtons from '../components/ui/ContatoButtons'

const REGIAO_LABELS: Record<string, string> = {
  norte: 'Norte',
  nordeste: 'Nordeste',
  centro_oeste: 'Centro-Oeste',
  sudeste: 'Sudeste',
  sul: 'Sul',
}

export default function Clientes() {
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const [pagina, setPagina] = useState(1)
  const [vendedorId, setVendedorId] = useState('')

  const { data: vendors } = trpc.users.vendors.useQuery(undefined, { enabled: user?.role === 'admin' })
  const { data, isLoading } = trpc.clientes.list.useQuery({
    q: q || undefined,
    pagina,
    vendedorId: vendedorId ? Number(vendedorId) : undefined,
  })

  const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl text-dark-50">Clientes</h1>
        <Link to={`${basePath}/clientes/novo`}>
          <Button size="sm">
            <Plus size={16} />
            Novo cliente
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Buscar por razão social, CNPJ, código, telefone, estado ou cidade"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPagina(1)
          }}
          className="min-w-72 flex-1"
        />
        {user?.role === 'admin' && (
          <Select
            value={vendedorId}
            onChange={(e) => {
              setVendedorId(e.target.value)
              setPagina(1)
            }}
            placeholder="Todos os vendedores"
            options={(vendors ?? []).map((v) => ({ value: v.id, label: v.name }))}
          />
        )}
      </div>

      <p className="text-sm text-dark-400">{data?.total ?? 0} cliente(s) encontrado(s)</p>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <div className="p-4 text-sm text-dark-500">Carregando...</div>}
        {!isLoading && data?.items.length === 0 && <div className="p-4 text-sm text-dark-500">Nenhum cliente encontrado.</div>}
        {data?.items.map((c) => (
          <Link key={c.id} to={`${basePath}/clientes/${c.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-dark-700/30 transition-colors">
            <div>
              <p className="font-medium text-dark-100">{c.razaoSocial}</p>
              <p className="text-dark-400 text-xs">
                {c.cnpj ?? `Cód. ${c.codigo} (sem CNPJ)`} · {REGIAO_LABELS[c.regiao]}
                {c.cidade ? ` · ${c.cidade}/${c.estado}` : ''}
                {user?.role === 'admin' && ` · ${c.vendedorAtual?.name ?? 'sem vendedor'}`}
              </p>
            </div>
            <ContatoButtons telefone={c.telefoneWhatsapp} telefonesExtras={c.telefonesExtras} email={c.email} clienteId={c.id} />
          </Link>
        ))}
      </div>

      {data && data.totalPaginas > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button variant="secondary" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </Button>
          <span className="text-dark-400">
            Página {pagina} de {data.totalPaginas}
          </span>
          <Button variant="secondary" size="sm" disabled={pagina >= data.totalPaginas} onClick={() => setPagina((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  )
}
