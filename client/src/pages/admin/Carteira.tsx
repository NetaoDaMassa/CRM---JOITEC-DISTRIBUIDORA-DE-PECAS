import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

const REGIOES = [
  { value: 'norte', label: 'Norte' },
  { value: 'nordeste', label: 'Nordeste' },
  { value: 'centro_oeste', label: 'Centro-Oeste' },
  { value: 'sudeste', label: 'Sudeste' },
  { value: 'sul', label: 'Sul' },
]

export default function AdminCarteira() {
  const { data: vendors } = trpc.users.vendors.useQuery()
  const utils = trpc.useUtils()

  const [regiao, setRegiao] = useState('')
  const [vendedorRegiao, setVendedorRegiao] = useState('')
  const [deVendedor, setDeVendedor] = useState('')
  const [paraVendedor, setParaVendedor] = useState('')

  const [buscaCliente, setBuscaCliente] = useState('')
  const [clienteSelecionado, setClienteSelecionado] = useState<{ id: number; razaoSocial: string; vendedorAtual: { name: string } | null } | null>(null)
  const [vendedorDestino, setVendedorDestino] = useState('')

  const { data: buscaResultado } = trpc.clientes.list.useQuery(
    { q: buscaCliente, pagina: 1 },
    { enabled: buscaCliente.trim().length >= 2 }
  )

  const atribuirMut = trpc.carteira.atribuirPorRegiao.useMutation({
    onSuccess(data) {
      toast.success(`${data.quantidade} cliente(s) atribuído(s)`)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const redistribuirMut = trpc.carteira.redistribuirCompleta.useMutation({
    onSuccess(data) {
      toast.success(`${data.quantidade} cliente(s) redistribuído(s)`)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const transferirIndividualMut = trpc.carteira.transferirIndividual.useMutation({
    onSuccess() {
      toast.success('Cliente transferido com sucesso')
      utils.clientes.list.invalidate()
      setClienteSelecionado(null)
      setBuscaCliente('')
      setVendedorDestino('')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const moverParaBancoMut = trpc.carteira.moverParaBanco.useMutation({
    onSuccess() {
      toast.success('Cliente movido para o Banco de Clientes')
      utils.clientes.list.invalidate()
      utils.clientes.bancoResumo.invalidate()
      setClienteSelecionado(null)
      setBuscaCliente('')
      setVendedorDestino('')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const vendorOptions = (vendors ?? []).map((v) => ({ value: v.id, label: v.name }))

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Atribuição de carteira</h1>
      </div>

      <div className="space-y-3 bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-dark-100">Transferir um cliente específico</h2>
        {!clienteSelecionado ? (
          <>
            <Input
              placeholder="Buscar por razão social, CNPJ ou código..."
              value={buscaCliente}
              onChange={(e) => setBuscaCliente(e.target.value)}
            />
            {buscaCliente.trim().length >= 2 && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-dark-600 divide-y divide-dark-700">
                {buscaResultado?.items.length === 0 && (
                  <p className="px-3 py-2 text-sm text-dark-500">Nenhum cliente encontrado.</p>
                )}
                {buscaResultado?.items.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setClienteSelecionado(c)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-700/50 transition-colors"
                  >
                    <p className="text-dark-100">{c.razaoSocial}</p>
                    <p className="text-xs text-dark-500">{c.codigo} · vendedor atual: {c.vendedorAtual?.name ?? 'sem vendedor'}</p>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-dark-600 px-3 py-2">
              <div>
                <p className="text-sm text-dark-100">{clienteSelecionado.razaoSocial}</p>
                <p className="text-xs text-dark-500">Vendedor atual: {clienteSelecionado.vendedorAtual?.name ?? 'sem vendedor'}</p>
              </div>
              <button
                onClick={() => setClienteSelecionado(null)}
                className="text-xs text-dark-400 hover:text-dark-100"
              >
                Trocar
              </button>
            </div>
            <Select
              label="Novo vendedor"
              value={vendedorDestino}
              onChange={(e) => setVendedorDestino(e.target.value)}
              placeholder="Selecione..."
              options={vendorOptions}
            />
            <div className="flex gap-2">
              <Button
                loading={transferirIndividualMut.isPending}
                onClick={() => {
                  if (!vendedorDestino) return toast.error('Selecione o vendedor de destino.')
                  transferirIndividualMut.mutate({ clienteId: clienteSelecionado.id, vendedorId: Number(vendedorDestino) })
                }}
              >
                Transferir
              </Button>
              <Button
                type="button"
                variant="secondary"
                loading={moverParaBancoMut.isPending}
                onClick={() => moverParaBancoMut.mutate({ clienteId: clienteSelecionado.id, rotulo: clienteSelecionado.vendedorAtual?.name })}
              >
                Mover pro Banco de Clientes
              </Button>
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!regiao || !vendedorRegiao) return toast.error('Selecione a região e o vendedor.')
          atribuirMut.mutate({ regiao: regiao as any, vendedorId: Number(vendedorRegiao) })
        }}
        className="space-y-3 bg-dark-800 border border-dark-600 rounded-2xl p-5"
      >
        <h2 className="text-sm font-semibold text-dark-100">Atribuir clientes sem dono por região</h2>
        <Select label="Região" value={regiao} onChange={(e) => setRegiao(e.target.value)} placeholder="Selecione..." options={REGIOES} />
        <Select label="Vendedor" value={vendedorRegiao} onChange={(e) => setVendedorRegiao(e.target.value)} placeholder="Selecione..." options={vendorOptions} />
        <Button type="submit" loading={atribuirMut.isPending}>
          Atribuir
        </Button>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!deVendedor || !paraVendedor) return toast.error('Selecione origem e destino.')
          if (deVendedor === paraVendedor) return toast.error('Origem e destino não podem ser o mesmo vendedor.')
          redistribuirMut.mutate({ deVendedorId: Number(deVendedor), paraVendedorId: Number(paraVendedor) })
        }}
        className="space-y-3 bg-dark-800 border border-dark-600 rounded-2xl p-5"
      >
        <h2 className="text-sm font-semibold text-dark-100">Redistribuir carteira completa</h2>
        <Select label="De" value={deVendedor} onChange={(e) => setDeVendedor(e.target.value)} placeholder="Selecione..." options={vendorOptions} />
        <Select label="Para" value={paraVendedor} onChange={(e) => setParaVendedor(e.target.value)} placeholder="Selecione..." options={vendorOptions} />
        <Button type="submit" loading={redistribuirMut.isPending}>
          Redistribuir
        </Button>
      </form>
    </div>
  )
}
