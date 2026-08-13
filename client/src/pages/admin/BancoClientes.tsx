import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { paraCsv, baixarCsv } from '../../lib/csv'

// Clientes que entraram na importação em massa sem vendedor (planilha trazia
// "Banco de Clientes X" / "-Nenhum vendedor-") — aqui o admin distribui um a
// um pra carteira de alguém, reaproveitando a mesma mutation de transferência
// individual usada em /admin/carteira.
export default function BancoClientes() {
  const [q, setQ] = useState('')
  const [origemBanco, setOrigemBanco] = useState('')
  const [estado, setEstado] = useState('')
  const [pagina, setPagina] = useState(1)
  const [exportando, setExportando] = useState(false)
  const [vendedorPorLinha, setVendedorPorLinha] = useState<Record<number, string>>({})
  const utils = trpc.useUtils()

  const { data: vendors } = trpc.users.vendors.useQuery()
  const { data: resumo } = trpc.clientes.bancoResumo.useQuery()
  const { data: estados } = trpc.clientes.bancoEstados.useQuery()
  const { data, isLoading } = trpc.clientes.banco.useQuery({
    q: q || undefined,
    origemBanco: origemBanco || undefined,
    estado: estado || undefined,
    pagina,
  })

  async function exportarCsv() {
    setExportando(true)
    try {
      const linhas = await utils.clientes.bancoExportar.fetch({
        q: q || undefined,
        origemBanco: origemBanco || undefined,
        estado: estado || undefined,
      })
      if (!linhas.length) return toast.error('Nenhum cliente pra exportar com esse filtro.')
      baixarCsv(
        'banco-de-clientes.csv',
        paraCsv(
          [
            { chave: 'codigo', rotulo: 'Código' },
            { chave: 'razaoSocial', rotulo: 'Razão Social' },
            { chave: 'cnpj', rotulo: 'CNPJ' },
            { chave: 'cidade', rotulo: 'Cidade' },
            { chave: 'estado', rotulo: 'UF' },
            { chave: 'telefoneWhatsapp', rotulo: 'Telefone' },
            { chave: 'email', rotulo: 'E-mail' },
            { chave: 'nomeContato', rotulo: 'Contato' },
            { chave: 'origemBanco', rotulo: 'Origem' },
          ],
          linhas
        )
      )
    } finally {
      setExportando(false)
    }
  }

  const transferirMut = trpc.carteira.transferirIndividual.useMutation({
    onSuccess() {
      toast.success('Cliente atribuído com sucesso')
      utils.clientes.banco.invalidate()
      utils.clientes.bancoResumo.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const vendorOptions = (vendors ?? []).map((v) => ({ value: v.id, label: v.name }))
  const totalBanco = (resumo ?? []).reduce((soma, r) => soma + r.quantidade, 0)

  function atribuir(clienteId: number) {
    const vendedorId = vendedorPorLinha[clienteId]
    if (!vendedorId) return toast.error('Selecione o vendedor de destino.')
    transferirMut.mutate({ clienteId, vendedorId: Number(vendedorId) })
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl text-dark-50">Banco de Clientes</h1>
          <p className="text-sm text-dark-400">
            Todo cliente ativo sem vendedor atribuído ({totalBanco} no total) — escolha um vendedor e atribua pra carteira.
          </p>
        </div>
        <Button variant="secondary" size="sm" loading={exportando} onClick={exportarCsv} className="shrink-0">
          Exportar planilha
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setOrigemBanco('')
            setPagina(1)
          }}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            !origemBanco ? 'border-gold-400 bg-gold-900/20 text-gold-300' : 'border-dark-600 text-dark-300 hover:bg-dark-800'
          }`}
        >
          Todos ({totalBanco})
        </button>
        {(resumo ?? []).map((r) => (
          <button
            key={r.origemBanco}
            onClick={() => {
              setOrigemBanco(r.origemBanco ?? '')
              setPagina(1)
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              origemBanco === r.origemBanco ? 'border-gold-400 bg-gold-900/20 text-gold-300' : 'border-dark-600 text-dark-300 hover:bg-dark-800'
            }`}
          >
            {r.origemBanco} ({r.quantidade})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Buscar por razão social, código ou cidade"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPagina(1)
          }}
          className="max-w-md"
        />
        <div className="w-40">
          <Select
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value)
              setPagina(1)
            }}
            placeholder="Todos os estados"
            options={(estados ?? []).map((uf) => ({ value: uf, label: uf }))}
          />
        </div>
      </div>

      <p className="text-sm text-dark-400">{data?.total ?? 0} cliente(s) encontrado(s)</p>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <div className="p-4 text-sm text-dark-500">Carregando...</div>}
        {!isLoading && data?.items.length === 0 && <div className="p-4 text-sm text-dark-500">Nenhum cliente encontrado.</div>}
        {data?.items.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-dark-100 truncate">{c.razaoSocial}</p>
              <p className="text-dark-400 text-xs">
                Cód. {c.codigo}
                {c.cidade ? ` · ${c.cidade}/${c.estado}` : ''} · {c.origemBanco ?? 'Sem origem definida'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Select
                value={vendedorPorLinha[c.id] ?? ''}
                onChange={(e) => setVendedorPorLinha((prev) => ({ ...prev, [c.id]: e.target.value }))}
                placeholder="Vendedor..."
                options={vendorOptions}
              />
              <Button size="sm" loading={transferirMut.isPending} onClick={() => atribuir(c.id)}>
                Atribuir
              </Button>
            </div>
          </div>
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
