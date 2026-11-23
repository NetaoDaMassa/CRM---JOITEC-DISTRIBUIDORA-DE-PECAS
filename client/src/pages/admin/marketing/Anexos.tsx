// Anexos da peça / do pedido (João, 2026-11-23): sem anexo não conclui.
// O arquivo também vai para uma pasta em Arquivos/Mídia.
import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Paperclip, Trash2 } from 'lucide-react'
import Button from '../../../components/ui/Button'
import { type Anexo, cls, dataHora, subirArquivo, tamanhoArq } from './comum'

export function PreviaAnexo({ a, grande }: { a: Anexo; grande?: boolean }) {
  const h = grande ? 'max-h-[60vh]' : 'max-h-40'
  if (a.tipo.startsWith('video/')) return <video src={a.path} controls preload="metadata" className={`w-full ${h} rounded-lg bg-black`} />
  if (a.tipo.startsWith('image/')) return <a href={a.path} target="_blank" rel="noopener noreferrer"><img src={a.path} alt={a.nome} className={`w-full ${h} object-contain rounded-lg bg-dark-900`} /></a>
  return null
}

export default function Anexos({ anexos, enviar, remover, aviso, previa = true }: {
  anexos: Anexo[]
  enviar: (arq: { path: string; nome: string; tipo: string; tamanho: number }) => Promise<unknown>
  remover: (arquivoId: number) => void
  aviso?: string
  previa?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [subindo, setSubindo] = useState<string | null>(null)
  const escolher = async (files: FileList | null) => {
    if (!files?.length) return
    for (const f of Array.from(files)) {
      setSubindo(f.name)
      try {
        await enviar(await subirArquivo(f))
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`)
      }
    }
    setSubindo(null)
    if (input.current) input.current.value = ''
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cls.rotulo}>Anexos (vídeo, arte, post pronto)</span>
        <Button size="sm" variant="secondary" onClick={() => input.current?.click()} loading={!!subindo}>
          <Paperclip className="w-4 h-4 mr-1 inline" />{subindo ? `Enviando ${subindo.slice(0, 24)}…` : 'Anexar arquivo'}
        </Button>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => escolher(e.target.files)} />
      </div>
      {!anexos.length && aviso && <p className="text-xs text-orange-300">{aviso}</p>}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
        {anexos.map((a) => (
          <div key={a.arquivoId} className="bg-dark-900/60 border border-dark-700 rounded-lg p-2 space-y-1.5">
            {previa && <PreviaAnexo a={a} />}
            <div className="flex items-start gap-2">
              <a href={a.path} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-sm text-gold-400 hover:underline truncate" title={a.nome}>{a.nome}</a>
              <button className="text-dark-500 hover:text-red-400" title="Tirar o anexo (o arquivo continua em Arquivos/Mídia)" onClick={() => remover(a.arquivoId)}><Trash2 className="w-4 h-4" /></button>
            </div>
            <div className="text-[11px] text-dark-500">{tamanhoArq(a.tamanho)} · {a.por} · {dataHora(a.em)}</div>
          </div>
        ))}
      </div>
      {anexos.length > 0 && <p className="text-[11px] text-dark-500">Também ficam em Arquivos/Mídia → Marketing.</p>}
    </div>
  )
}
