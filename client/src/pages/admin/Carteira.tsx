import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

interface ImportRowError {
  linha: number
  motivo: string
}

interface ImportFileResult {
  arquivo: string
  sucesso: number
  atualizados: number
  erros: ImportRowError[]
  avisos: ImportRowError[]
}

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
  const [destinoRedistribuicao, setDestinoRedistribuicao] = useState<'vendedor' | 'banco'>('vendedor')
  const [rotuloBanco, setRotuloBanco] = useState('')

  const [arquivosImportar, setArquivosImportar] = useState<FileList | null>(null)
  const [importando, setImportando] = useState(false)
  const [resultadosImportar, setResultadosImportar] = useState<ImportFileResult[] | null>(null)

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

  const redistribuirParaBancoMut = trpc.carteira.redistribuirParaBanco.useMutation({
    onSuccess(data) {
      toast.success(`${data.quantidade} cliente(s) movido(s) para o Banco de Clientes`)
      utils.clientes.list.invalidate()
      utils.clientes.bancoResumo.invalidate()
      setRotuloBanco('')
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

  // Importação de planilha — vivia numa tela separada ("Importar", menu
  // próprio); virou uma seção aqui dentro de Carteira porque é exatamente
  // isso que ela faz (jogar clientes pro Banco ou pra um vendedor), pedido
  // do João 2026-09-24. Fora do tRPC de propósito (upload de arquivo).
  async function handleImportar() {
    if (!arquivosImportar || arquivosImportar.length === 0) return toast.error('Selecione ao menos um arquivo.')

    setImportando(true)
    setResultadosImportar(null)
    try {
      const token = localStorage.getItem('odin_token')
      const empresaAtivaId = localStorage.getItem('empresa_ativa_id')
      const form = new FormData()
      for (const file of Array.from(arquivosImportar)) form.append('files', file)

      const res = await fetch('/upload/clientes-csv', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          // Sem isso, importar com outra empresa selecionada (superAdmin
          // trocando de empresa no seletor) ia sempre cair na empresa "de
          // casa" do login, sem avisar nada.
          ...(empresaAtivaId ? { 'x-empresa-id': empresaAtivaId } : {}),
        },
        body: form,
      })
      const data = await res.json()
      if (!res.ok) return toast.error(data.error ?? 'Falha na importação.')

      setResultadosImportar(data.resultados)
      const totalSucesso = data.resultados.reduce((acc: number, r: ImportFileResult) => acc + r.sucesso, 0)
      const totalAtualizados = data.resultados.reduce((acc: number, r: ImportFileResult) => acc + r.atualizados, 0)
      toast.success(`${totalSucesso} cliente(s) novo(s), ${totalAtualizados} reatribuído(s).`)
      utils.clientes.list.invalidate()
      utils.clientes.bancoResumo.invalidate()
    } catch {
      toast.error('Falha ao enviar os arquivos.')
    } finally {
      setImportando(false)
    }
  }

  const vendorOptions = (vendors ?? []).map((v) => ({ value: v.id, label: v.name }))

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Carteira</h1>
      </div>

      <div className="space-y-3 bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-dark-100">Importar planilha de clientes</h2>
        <p className="text-xs text-dark-400">
          Envie um ou mais arquivos Excel/CSV. Cada linha precisa ter "Código" (identificador único), "Nome do
          Cliente" e "Estado". O CNPJ é opcional. Se a coluna "Vendedor" tiver um nome que bate com um vendedor
          cadastrado, o cliente já é atribuído a ele — se o código já existir no sistema, o cliente existente é
          reatribuído pra esse vendedor em vez de duplicar. Sem vendedor (ou sem bater o nome), o cliente vai pro
          Banco de Clientes.
        </p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          onChange={(e) => setArquivosImportar(e.target.files)}
          className="text-sm text-dark-300"
        />
        <Button onClick={handleImportar} loading={importando}>
          Importar
        </Button>

        {resultadosImportar && (
          <div className="space-y-2 pt-2">
            {resultadosImportar.map((r) => (
              <div key={r.arquivo} className="bg-dark-900/50 border border-dark-700 rounded-xl p-3">
                <p className="text-sm font-medium text-dark-100">
                  {r.arquivo} — <span className="text-green-400">{r.sucesso} novo(s)</span>
                  {r.atualizados > 0 && <span className="text-cyan-400"> · {r.atualizados} reatribuído(s)</span>}
                  {r.avisos.length > 0 && <span className="text-amber-400"> · {r.avisos.length} aviso(s)</span>}
                  {r.erros.length > 0 && <span className="text-red-400"> · {r.erros.length} erro(s)</span>}
                </p>
                {r.avisos.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-amber-400">
                    {r.avisos.map((a, i) => (
                      <li key={i}>
                        Linha {a.linha}: {a.motivo}
                      </li>
                    ))}
                  </ul>
                )}
                {r.erros.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-dark-400">
                    {r.erros.map((e, i) => (
                      <li key={i}>
                        Linha {e.linha}: {e.motivo}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
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
          if (!deVendedor) return toast.error('Selecione o vendedor de origem.')
          if (destinoRedistribuicao === 'vendedor') {
            if (!paraVendedor) return toast.error('Selecione o vendedor de destino.')
            if (deVendedor === paraVendedor) return toast.error('Origem e destino não podem ser o mesmo vendedor.')
            redistribuirMut.mutate({ deVendedorId: Number(deVendedor), paraVendedorId: Number(paraVendedor) })
          } else {
            redistribuirParaBancoMut.mutate({ deVendedorId: Number(deVendedor), rotulo: rotuloBanco.trim() || undefined })
          }
        }}
        className="space-y-3 bg-dark-800 border border-dark-600 rounded-2xl p-5"
      >
        <h2 className="text-sm font-semibold text-dark-100">Redistribuir carteira completa</h2>
        <Select label="De" value={deVendedor} onChange={(e) => setDeVendedor(e.target.value)} placeholder="Selecione..." options={vendorOptions} />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDestinoRedistribuicao('vendedor')}
            className={`flex-1 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
              destinoRedistribuicao === 'vendedor'
                ? 'border-gold-400 bg-gold-900/20 text-gold-300'
                : 'border-dark-600 text-dark-300 hover:bg-dark-700'
            }`}
          >
            Para outro vendedor
          </button>
          <button
            type="button"
            onClick={() => setDestinoRedistribuicao('banco')}
            className={`flex-1 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
              destinoRedistribuicao === 'banco'
                ? 'border-gold-400 bg-gold-900/20 text-gold-300'
                : 'border-dark-600 text-dark-300 hover:bg-dark-700'
            }`}
          >
            Para o Banco de Clientes
          </button>
        </div>

        {destinoRedistribuicao === 'vendedor' ? (
          <Select label="Para" value={paraVendedor} onChange={(e) => setParaVendedor(e.target.value)} placeholder="Selecione..." options={vendorOptions} />
        ) : (
          <Input
            label="Nome do banco (opcional)"
            placeholder={vendorOptions.find((v) => v.value === Number(deVendedor))?.label ?? 'Deixe em branco pra usar o nome do vendedor'}
            value={rotuloBanco}
            onChange={(e) => setRotuloBanco(e.target.value)}
          />
        )}

        <Button type="submit" loading={redistribuirMut.isPending || redistribuirParaBancoMut.isPending}>
          {destinoRedistribuicao === 'vendedor' ? 'Redistribuir' : 'Mover para o Banco'}
        </Button>
      </form>
    </div>
  )
}
