import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Textarea } from '../ui/Input'

const CATEGORIAS: { valor: string; label: string }[] = [
  { valor: 'manual', label: 'Manual' },
  { valor: 'garantia', label: 'Garantia' },
  { valor: 'certificado', label: 'Certificados' },
  { valor: 'teste', label: 'Testes' },
  { valor: 'ficha_tecnica', label: 'Ficha Técnica' },
]

export default function EtapaQualidade({ ordemId, isAdmin, readonly, clienteNome, clienteEmail }: { ordemId: number; isAdmin: boolean; readonly: boolean; clienteNome?: string | null; clienteEmail?: string | null }) {
  const { data, isLoading } = trpc.ordens.pos.obterQualidade.useQuery({ ordemId })
  const { data: anexos } = trpc.ordens.anexos.listar.useQuery({ ordemId, stage: 'qualidade' })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return <EtapaQualidadeForm ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} data={data ?? null} anexos={anexos ?? []} clienteNome={clienteNome} clienteEmail={clienteEmail} />
}

function EtapaQualidadeForm({
  ordemId,
  isAdmin,
  readonly,
  data,
  anexos,
  clienteNome,
  clienteEmail,
}: {
  ordemId: number
  isAdmin: boolean
  readonly: boolean
  data: { observacoes: string | null } | null
  anexos: { id: number; fileCategory: string | null; nomeOriginal: string; nomeArmazenado: string }[]
  clienteNome?: string | null
  clienteEmail?: string | null
}) {
  const utils = trpc.useUtils()
  const [obs, setObs] = useState(data?.observacoes ?? '')
  const [enviandoCategoria, setEnviandoCategoria] = useState<string | null>(null)
  const podeEditar = isAdmin && !readonly

  function invalidar() {
    utils.ordens.pos.obterQualidade.invalidate({ ordemId })
    utils.ordens.anexos.listar.invalidate({ ordemId, stage: 'qualidade' })
  }
  const salvarMut = trpc.ordens.pos.atualizarQualidade.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const registrarMut = trpc.ordens.anexos.registrar.useMutation({ onSuccess: () => invalidar(), onError: (e) => toast.error(e.message) })

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>, categoria: string) {
    const file = e.target.files?.[0]
    if (!file) return
    setEnviandoCategoria(categoria)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('odin_token')
      const resp = await fetch('/upload/ordem-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
      registrarMut.mutate({ ordemId, stage: 'qualidade', fileCategory: categoria, nomeOriginal: json.nome, nomeArmazenado: json.path.replace('/uploads/', ''), tipoArquivo: json.tipo, tamanhoBytes: json.tamanho })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setEnviandoCategoria(null)
      e.target.value = ''
    }
  }

  function baixarTodos() {
    anexos.forEach((a, i) => setTimeout(() => window.open(`/uploads/${a.nomeArmazenado}`, '_blank'), i * 400))
  }
  function enviarEmail() {
    if (!clienteEmail) { toast.error('Cliente sem e-mail cadastrado'); return }
    const corpo = `Olá${clienteNome ? ` ${clienteNome}` : ''}, seguem os documentos de qualidade do pedido #${ordemId} em anexo.`
    window.open(`mailto:${clienteEmail}?subject=${encodeURIComponent(`Documentos de Qualidade - Pedido #${ordemId}`)}&body=${encodeURIComponent(corpo)}`)
  }

  return (
    <div className="space-y-5">
      {clienteNome && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-dark-700 bg-dark-900/40 text-sm">
          <span className="text-dark-200">{clienteNome}</span>
          <div className="flex gap-3">
            {anexos.length > 0 && <button onClick={baixarTodos} className="text-xs text-dark-400 hover:text-gold-400">Baixar Todos</button>}
            <button onClick={enviarEmail} className="text-xs text-dark-400 hover:text-blue-400">Enviar E-mail</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CATEGORIAS.map((cat) => {
          const arquivos = anexos.filter((a) => a.fileCategory === cat.valor)
          return (
            <div key={cat.valor} className="p-2.5 rounded-lg border border-dark-600 bg-dark-800 text-sm">
              <p className="text-dark-300 mb-1">{cat.label}</p>
              {arquivos.map((a) => <a key={a.id} href={`/uploads/${a.nomeArmazenado}`} target="_blank" rel="noreferrer" className="block text-xs text-blue-400 hover:underline">{a.nomeOriginal}</a>)}
              {podeEditar && (
                <label className="mt-1 inline-block text-xs text-gold-400 hover:text-gold-300 cursor-pointer">
                  {enviandoCategoria === cat.valor ? 'Enviando...' : 'Anexar arquivo'}
                  <input type="file" className="hidden" onChange={(e) => handleUpload(e, cat.valor)} disabled={enviandoCategoria === cat.valor} />
                </label>
              )}
            </div>
          )
        })}
      </div>

      <Textarea label="Observações" defaultValue={obs} onChange={(e) => setObs(e.target.value)} disabled={!podeEditar} />
      {podeEditar && <Button size="sm" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, observacoes: obs })}>Salvar</Button>}
    </div>
  )
}
