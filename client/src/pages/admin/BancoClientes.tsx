import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { paraCsv, baixarCsv } from '../../lib/csv'

// Cada banco (grupo `origemBanco`) só aparece pro vendedor se tiver sido
// liberado explicitamente aqui pelo admin — pedido do João, 2026-09-02. Sem
// liberação nenhuma, o banco fica invisível pra todo vendedor (mesmo os que
// já existiam antes dessa tela). Admin sempre vê tudo, sem restrição.
function GerenciarLiberacoes({ onClose, vendorOptions }: { onClose: () => void; vendorOptions: { value: number; label: string }[] }) {
  const utils = trpc.useUtils()
  const { data: bancos, isLoading } = trpc.clientes.bancoLiberacoesListar.useQuery()
  const [bancoAberto, setBancoAberto] = useState<string | null>(null)
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())

  const salvarMut = trpc.clientes.bancoDefinirLiberacao.useMutation({
    onSuccess() {
      toast.success('Acesso atualizado')
      utils.clientes.bancoLiberacoesListar.invalidate()
      utils.clientes.bancoResumo.invalidate()
      setBancoAberto(null)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function abrir(origemBanco: string, vendedorIds: number[]) {
    setBancoAberto(origemBanco)
    setSelecionados(new Set(vendedorIds))
  }

  function alternar(id: number) {
    setSelecionados((prev) => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  return (
    <Modal open onClose={onClose} title="Gerenciar acesso aos bancos" size="lg">
      <div className="space-y-4">
        <p className="text-xs text-dark-400">
          Um banco só aparece pro vendedor se você liberar aqui — sem liberação, fica invisível pra todo mundo.
        </p>
        {isLoading && <p className="text-sm text-dark-500">Carregando...</p>}
        <div className="divide-y divide-dark-700 border border-dark-700 rounded-xl">
          {bancos?.map((b) => (
            <div key={b.origemBanco} className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-dark-100 font-medium">{b.origemBanco}</p>
                  <p className="text-xs text-dark-500">
                    {b.quantidade} cliente(s) ·{' '}
                    {b.vendedorIds.length ? `liberado pra ${b.vendedorIds.length} vendedor(es)` : 'ninguém tem acesso ainda'}
                  </p>
                </div>
                {bancoAberto !== b.origemBanco && (
                  <Button size="sm" variant="secondary" onClick={() => abrir(b.origemBanco, b.vendedorIds)}>
                    Editar acesso
                  </Button>
                )}
              </div>

              {bancoAberto === b.origemBanco && (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto">
                    {vendorOptions.map((v) => (
                      <label key={v.value} className="flex items-center gap-1.5 text-sm text-dark-200">
                        <input type="checkbox" checked={selecionados.has(v.value)} onChange={() => alternar(v.value)} />
                        {v.label}
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setBancoAberto(null)}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      loading={salvarMut.isPending}
                      onClick={() => salvarMut.mutate({ origemBanco: b.origemBanco, vendedorIds: [...selecionados] })}
                    >
                      Salvar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// Clientes que entraram na importação em massa sem vendedor (planilha trazia
// "Banco de Clientes X" / "-Nenhum vendedor-") — aqui o admin distribui um a
// um pra carteira de alguém, reaproveitando a mesma mutation de transferência
// individual usada em /admin/carteira.
export default function BancoClientes() {
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const [origemBanco, setOrigemBanco] = useState('')
  const [estado, setEstado] = useState('')
  const [pagina, setPagina] = useState(1)
  const [exportando, setExportando] = useState(false)
  const [vendedorPorLinha, setVendedorPorLinha] = useState<Record<number, string>>({})
  const [gerenciando, setGerenciando] = useState(false)
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

  // Vendedor não escolhe destino (só pra admin) — sempre atribui pra própria
  // carteira, o backend nem aceita outro id.
  const autoAtribuirMut = trpc.clientes.bancoAutoAtribuir.useMutation({
    onSuccess() {
      toast.success('Cliente adicionado à sua carteira')
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
            Todo cliente ativo sem vendedor atribuído ({totalBanco} no total) —{' '}
            {user?.role === 'vendor' ? 'pegue um cliente pra sua carteira.' : 'escolha um vendedor e atribua pra carteira.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {user?.role === 'admin' && (
            <Button variant="secondary" size="sm" onClick={() => setGerenciando(true)}>
              Gerenciar acesso
            </Button>
          )}
          <Button variant="secondary" size="sm" loading={exportando} onClick={exportarCsv}>
            Exportar planilha
          </Button>
        </div>
      </div>

      {gerenciando && <GerenciarLiberacoes onClose={() => setGerenciando(false)} vendorOptions={vendorOptions} />}

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
              {user?.role === 'vendor' ? (
                <Button size="sm" loading={autoAtribuirMut.isPending} onClick={() => autoAtribuirMut.mutate({ clienteId: c.id })}>
                  Pegar cliente
                </Button>
              ) : (
                <>
                  <Select
                    value={vendedorPorLinha[c.id] ?? ''}
                    onChange={(e) => setVendedorPorLinha((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    placeholder="Vendedor..."
                    options={vendorOptions}
                  />
                  <Button size="sm" loading={transferirMut.isPending} onClick={() => atribuir(c.id)}>
                    Atribuir
                  </Button>
                </>
              )}
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
