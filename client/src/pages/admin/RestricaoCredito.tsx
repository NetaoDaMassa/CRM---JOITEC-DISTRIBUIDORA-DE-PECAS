import { useState } from 'react'
import toast from 'react-hot-toast'
import { Trash2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Textarea } from '../../components/ui/Input'
import { formatDate } from '../../lib/utils'

function formatarMoeda(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function AbaImportar() {
  const utils = trpc.useUtils()
  const [texto, setTexto] = useState('')
  const [resultado, setResultado] = useState<{ total: number; criados: number; atualizados: number; erros: { linha: number; motivo: string }[] } | null>(
    null
  )

  const mut = trpc.restricaoCredito.importarLote.useMutation({
    onSuccess(data) {
      setResultado(data)
      toast.success(`${data.atualizados} cliente(s) processado(s) (${data.criados} novo(s))`)
      utils.restricaoCredito.listar.invalidate()
      setTexto('')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="space-y-4">
      <p className="text-xs text-dark-400">
        Cole um relatório externo — uma linha por cliente, colunas separadas por tab ou vários espaços: CNPJ/CPF, razão
        social, nome jurídico da empresa, quantidade de pendências, valor em aberto. Cliente que já existe (por
        CNPJ/CPF) é atualizado; quem não existe é criado sem vendedor/região.
      </p>
      <Textarea rows={8} placeholder="Cole aqui..." value={texto} onChange={(e) => setTexto(e.target.value)} />
      <Button loading={mut.isPending} disabled={!texto.trim()} onClick={() => mut.mutate({ texto })}>
        Importar
      </Button>

      {resultado && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-2">
          <p className="text-sm text-dark-100">
            {resultado.total} linha(s) · <span className="text-green-400">{resultado.criados} cliente(s) novo(s)</span> ·{' '}
            <span className="text-cyan-400">{resultado.atualizados} processado(s)</span>
            {resultado.erros.length > 0 && <span className="text-red-400"> · {resultado.erros.length} erro(s)</span>}
          </p>
          {resultado.erros.length > 0 && (
            <ul className="text-xs text-dark-400 space-y-0.5 max-h-56 overflow-y-auto">
              {resultado.erros.map((e, i) => (
                <li key={i}>
                  Linha {e.linha}: {e.motivo}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function AbaLista() {
  const utils = trpc.useUtils()
  const { data: linhas, isLoading } = trpc.restricaoCredito.listar.useQuery()

  const removerMut = trpc.restricaoCredito.remover.useMutation({
    onSuccess() {
      toast.success('Restrição removida')
      utils.restricaoCredito.listar.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="space-y-3">
      <p className="text-sm text-dark-400">{linhas?.length ?? 0} cliente(s) com restrição ativa</p>
      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <div className="p-4 text-sm text-dark-500">Carregando...</div>}
        {!isLoading && linhas?.length === 0 && <div className="p-4 text-sm text-dark-500">Nenhuma restrição ativa.</div>}
        {linhas?.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-dark-100 truncate">
                {l.clienteNome} <span className="text-dark-500 font-normal">({l.empresaNome})</span>
              </p>
              <p className="text-xs text-dark-400 mt-0.5">
                Cód. {l.clienteCodigo} · {l.clienteCnpj ?? l.clienteCpf ?? 'sem documento'} · {l.quantidadePendencias ?? 0} pendência(s) ·{' '}
                {formatarMoeda(l.valorPendencia)} · desde {formatDate(l.createdAt)}
              </p>
            </div>
            <button
              onClick={() => confirm('Remover a restrição desse cliente?') && removerMut.mutate({ id: l.id })}
              className="p-1.5 rounded-lg text-dark-400 hover:text-red-400 hover:bg-red-900/20 shrink-0"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RestricaoCredito() {
  const [tab, setTab] = useState<'lista' | 'importar'>('lista')

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Restrição de Crédito</h1>
        <p className="text-sm text-dark-400 mt-1">Clientes com pendência financeira — vale pras empresas do grupo todas juntas.</p>
      </div>

      <div className="flex gap-1 border-b border-dark-700">
        {(['lista', 'importar'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'
            }`}
          >
            {t === 'lista' ? 'Clientes restritos' : 'Importar em lote'}
          </button>
        ))}
      </div>

      {tab === 'lista' ? <AbaLista /> : <AbaImportar />}
    </div>
  )
}
