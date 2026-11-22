// Gera um link de aprovação (abre sem login): quem recebe aprova ou pede
// ajuste peça por peça, pelo celular. Ideia tirada do mLabs Workflow/Planable.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../../lib/trpc'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { cls, diaLabel } from './comum'
import type { Peca } from './PecaModal'

export default function LinkAprovacao({ open, onClose, pecas, preSelecionadas, tituloPadrao, nomeMarca }: {
  open: boolean; onClose: () => void; pecas: Peca[]; preSelecionadas?: string[]; tituloPadrao: string; nomeMarca: (empresaId: number) => string
}) {
  const [sel, setSel] = useState<string[]>([])
  const [titulo, setTitulo] = useState(tituloPadrao)
  const [url, setUrl] = useState('')
  const criar = trpc.marketingFluxo.criarLinkAprovacao.useMutation({
    onSuccess: (r) => setUrl(`${window.location.origin}${r.caminho}`),
    onError: (e) => toast.error(e.message),
  })
  useEffect(() => {
    if (!open) return
    setUrl('')
    setTitulo(tituloPadrao)
    setSel(preSelecionadas ?? pecas.filter((p) => ['Roteiro', 'Aprovação'].includes(p.status)).map((p) => p.id))
  }, [open])

  const copiar = async () => {
    try { await navigator.clipboard.writeText(url); toast.success('Link copiado') } catch { toast.error('Não consegui copiar — selecione o link e copie') }
  }
  const zap = `https://wa.me/?text=${encodeURIComponent(`${titulo}\nAprove ou peça ajuste por aqui: ${url}`)}`

  return (
    <Modal open={open} onClose={onClose} title="Link de aprovação" size="lg">
      {url ? (
        <div className="space-y-3">
          <p className="text-sm text-dark-300">Mande este link para quem aprova. Abre sem senha, vale por 30 dias. Cada aprovação ou pedido de ajuste volta para a peça e muda a etapa sozinho.</p>
          <input readOnly className={cls.input + ' font-mono text-xs'} value={url} onFocus={(e) => e.target.select()} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={copiar}>Copiar link</Button>
            <a href={zap} target="_blank" rel="noreferrer"><Button variant="secondary">Mandar no WhatsApp</Button></a>
            <a href={url} target="_blank" rel="noreferrer"><Button variant="ghost">Abrir para conferir</Button></a>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block space-y-1"><span className={cls.rotulo}>Título do link</span><input className={cls.input} value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
          <div className="flex items-center justify-between text-xs text-dark-400">
            <span>{sel.length} de {pecas.length} peças</span>
            <span className="flex gap-3"><button className="hover:text-dark-100" onClick={() => setSel(pecas.map((p) => p.id))}>marcar todas</button><button className="hover:text-dark-100" onClick={() => setSel([])}>limpar</button></span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto space-y-1 pr-1">
            {pecas.length === 0 && <p className="text-sm text-dark-400">Nenhuma peça neste filtro.</p>}
            {pecas.map((p) => (
              <label key={p.id} className="flex items-start gap-2 text-sm bg-dark-900/50 rounded-lg px-3 py-2 cursor-pointer">
                <input type="checkbox" className="mt-1" checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />
                <span className="flex-1"><span className="text-dark-100 font-semibold">{p.titulo || 'Sem título'}</span><br /><span className="text-xs text-dark-400">{nomeMarca(p.empresaId)} · {p.tipo} · {diaLabel(p.data)} · {p.status}</span></span>
              </label>
            ))}
          </div>
          <Button onClick={() => criar.mutate({ pecaIds: sel, titulo: titulo.trim() || tituloPadrao })} loading={criar.isPending} disabled={!sel.length}>Gerar link</Button>
        </div>
      )}
    </Modal>
  )
}
