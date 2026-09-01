import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { Input } from '../ui/Input'

export default function EtapaAnexos({ ordemId, stageAtual, isAdmin }: { ordemId: number; stageAtual: string; isAdmin: boolean }) {
  const utils = trpc.useUtils()
  const { data: anexos } = trpc.ordens.anexos.listar.useQuery({ ordemId })
  const [stage, setStage] = useState(stageAtual)
  const [categoria, setCategoria] = useState('')
  const [enviando, setEnviando] = useState(false)

  const registrarMut = trpc.ordens.anexos.registrar.useMutation({
    onSuccess: () => { toast.success('Anexo salvo'); utils.ordens.anexos.listar.invalidate({ ordemId }) },
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.ordens.anexos.excluir.useMutation({
    onSuccess: () => { toast.success('Anexo removido'); utils.ordens.anexos.listar.invalidate({ ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setEnviando(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('odin_token')
      const resp = await fetch('/upload/ordem-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
      registrarMut.mutate({
        ordemId,
        stage,
        fileCategory: categoria || undefined,
        nomeOriginal: json.nome,
        nomeArmazenado: json.path.replace('/uploads/', ''),
        tipoArquivo: json.tipo,
        tamanhoBytes: json.tamanho,
      })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setEnviando(false)
      e.target.value = ''
    }
  }

  // Agrupado por etapa (mesma ordem cronológica de criação da galeria do
  // odincrm original) — mais fácil de achar um anexo velho num pedido longo.
  const grupos = new Map<string, typeof anexos>()
  for (const a of anexos ?? []) {
    const lista = grupos.get(a.stage) ?? []
    lista.push(a)
    grupos.set(a.stage, lista as any)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-end">
        <Input label="Etapa" value={stage} onChange={(e) => setStage(e.target.value)} className="w-40" />
        <Input label="Categoria (opcional)" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="ex: nf, placa__123" />
        <label className="px-4 py-2 text-sm rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 cursor-pointer">
          {enviando ? 'Enviando...' : 'Escolher arquivo'}
          <input type="file" className="hidden" onChange={handleUpload} disabled={enviando} />
        </label>
      </div>

      <div className="space-y-4">
        {[...grupos.entries()].map(([grupoStage, lista]) => (
          <div key={grupoStage}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-dark-500 mb-1.5">{grupoStage}</p>
            <div className="space-y-2">
              {(lista ?? []).map((a) => (
                <div key={a.id} className="flex items-center justify-between p-2.5 rounded-lg border border-dark-600 bg-dark-800 text-sm">
                  <a href={`/uploads/${a.nomeArmazenado}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate">
                    {a.nomeOriginal} {a.fileCategory && <span className="text-dark-500">({a.fileCategory})</span>}
                  </a>
                  {isAdmin && <button onClick={() => excluirMut.mutate({ id: a.id, ordemId })} className="text-red-400 text-xs hover:underline shrink-0 ml-2">excluir</button>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {(!anexos || anexos.length === 0) && <p className="text-dark-500 text-sm">Nenhum anexo ainda</p>}
      </div>
    </div>
  )
}
