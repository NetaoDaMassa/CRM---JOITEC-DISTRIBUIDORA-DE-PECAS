import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { usePersistedState } from '../lib/usePersistedState'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import ContatoButtons from '../components/ui/ContatoButtons'
import { paraCsv, baixarCsv } from '../lib/csv'

const REGIAO_LABELS: Record<string, string> = {
  norte: 'Norte',
  nordeste: 'Nordeste',
  centro_oeste: 'Centro-Oeste',
  sudeste: 'Sudeste',
  sul: 'Sul',
}

// Consumidor Final / Revenda — só Odin Compressores usa, mesmo padrão de
// Revenda Responsável (ver ClienteNovo.tsx). Pedido do João, 2026-10-13.
const CLASSIFICACAO_LABEL: Record<string, string> = { revenda: 'Revenda', consumidor_final: 'Consumidor Final' }
const CLASSIFICACAO_COR: Record<string, string> = {
  revenda: 'text-purple-300 bg-purple-900/20 border-purple-700/40',
  consumidor_final: 'text-cyan-300 bg-cyan-900/20 border-cyan-700/40',
}

export default function Clientes() {
  const { user, empresaAtivaId } = useAuth()
  const [q, setQ] = usePersistedState('clientes:q', '')
  const [pagina, setPagina] = useState(1)
  const [vendedorId, setVendedorId] = usePersistedState('clientes:vendedorId', '')
  const [classificacaoComercial, setClassificacaoComercial] = usePersistedState<'' | 'revenda' | 'consumidor_final'>('clientes:classificacao', '')
  const [exportando, setExportando] = useState(false)

  const { data: empresas } = trpc.empresas.list.useQuery()
  const ehOdinCompressores = empresas?.find((e) => e.id === empresaAtivaId)?.slug === 'odin-compressores'

  const { data: vendors } = trpc.users.vendors.useQuery(undefined, { enabled: user?.role === 'admin' })
  const { data, isLoading } = trpc.clientes.list.useQuery({
    q: q || undefined,
    pagina,
    vendedorId: vendedorId ? Number(vendedorId) : undefined,
    classificacaoComercial: classificacaoComercial || undefined,
  })
  const utils = trpc.useUtils()

  const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'

  async function exportarCsv() {
    setExportando(true)
    try {
      const linhas = await utils.clientes.exportar.fetch({
        q: q || undefined,
        vendedorId: vendedorId ? Number(vendedorId) : undefined,
        classificacaoComercial: classificacaoComercial || undefined,
      })
      if (!linhas.length) return toast.error('Nenhum cliente pra exportar com esse filtro.')
      baixarCsv(
        'clientes.csv',
        paraCsv(
          [
            { chave: 'codigo', rotulo: 'Código' },
            { chave: 'razaoSocial', rotulo: 'Razão Social' },
            { chave: 'cnpj', rotulo: 'CNPJ' },
            { chave: 'cpf', rotulo: 'CPF' },
            { chave: 'cidade', rotulo: 'Cidade' },
            { chave: 'estado', rotulo: 'UF' },
            { chave: 'regiao', rotulo: 'Região' },
            { chave: 'telefoneWhatsapp', rotulo: 'Telefone' },
            { chave: 'email', rotulo: 'E-mail' },
            { chave: 'nomeContato', rotulo: 'Contato' },
            { chave: 'vendedor', rotulo: 'Vendedor' },
            ...(ehOdinCompressores ? [{ chave: 'classificacaoComercial' as const, rotulo: 'Classificação' }] : []),
          ],
          linhas
        )
      )
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-xl text-dark-50">Clientes</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" loading={exportando} onClick={exportarCsv}>
            Exportar planilha
          </Button>
          <Link to={`${basePath}/clientes/novo`}>
            <Button size="sm">
              <Plus size={16} />
              Novo cliente
            </Button>
          </Link>
        </div>
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
        {ehOdinCompressores && (
          <Select
            value={classificacaoComercial}
            onChange={(e) => {
              setClassificacaoComercial(e.target.value as '' | 'revenda' | 'consumidor_final')
              setPagina(1)
            }}
            placeholder="Todas as classificações"
            options={[
              { value: 'revenda', label: 'Revenda' },
              { value: 'consumidor_final', label: 'Consumidor Final' },
            ]}
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
              <p className="font-medium text-dark-100 flex items-center gap-2">
                {c.razaoSocial}
                {c.classificacaoComercial && (
                  <Badge className={`text-[10px] ${CLASSIFICACAO_COR[c.classificacaoComercial]}`}>{CLASSIFICACAO_LABEL[c.classificacaoComercial]}</Badge>
                )}
              </p>
              <p className="text-dark-400 text-xs">
                {c.cnpj ?? `Cód. ${c.codigo} (sem CNPJ)`} · {c.regiao ? REGIAO_LABELS[c.regiao] : 'sem região'}
                {c.cidade ? ` · ${c.cidade}/${c.estado}` : ''}
                {user?.role === 'admin' && ` · ${c.vendedorAtual?.name ?? 'sem vendedor'}`}
              </p>
            </div>
            <ContatoButtons telefone={c.telefoneWhatsapp} telefonesExtras={c.telefonesExtras} email={c.email} emailsExtras={c.emailsExtras} clienteId={c.id} />
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
