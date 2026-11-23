// Botão de IA com os 2 jeitos que o João pediu (2026-11-20):
//  1) "Claude faz" — chama a chave da Anthropic do CRM.
//  2) "Copiar pedido" — copia o texto, a pessoa cola no Claude (claude.ai),
//     copia a resposta e cola aqui. Mesmo texto, mesma leitura nos dois.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { Sparkles, Copy, ClipboardPaste, ExternalLink } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

export type TipoIa = 'revisao' | 'criar' | 'reescrever' | 'instagram' | 'mes' | 'directs' | 'ideias' | 'persona' | 'legenda' | 'adaptar'
export type ParamsIa = { pecaIds?: string[]; pecaId?: string; empresaId?: number; mes?: string; ideiaId?: number }

export function useIa() {
  const disp = trpc.marketingModulo.iaDisponivel.useQuery(undefined, { staleTime: 60_000 })
  const executar = trpc.marketingModulo.iaExecutar.useMutation()
  const pedido = trpc.marketingModulo.iaPedido.useMutation()
  const aplicar = trpc.marketingModulo.iaAplicar.useMutation()
  return { temChave: !!disp.data?.temChave, executar, pedido, aplicar }
}

export default function IaAcao({
  tipo, params, rotulo, onResultado, pequeno, desabilitado,
}: {
  tipo: TipoIa
  params: ParamsIa
  rotulo: string
  onResultado: (r: any) => void
  pequeno?: boolean
  desabilitado?: boolean
}) {
  const { temChave, executar, pedido, aplicar } = useIa()
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [resposta, setResposta] = useState('')
  const rodando = executar.isPending

  const viaApi = () => executar.mutate({ tipo, params }, {
    onSuccess: (r) => { onResultado(r); toast.success('Pronto!') },
    onError: (e) => toast.error(e.message, { duration: 8000 }),
  })
  const abrirManual = () => {
    setResposta('')
    setTexto('')
    setAberto(true)
    pedido.mutate({ tipo, params }, { onSuccess: (r) => setTexto(r.prompt), onError: (e) => { toast.error(e.message); setAberto(false) } })
  }
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); toast.success('Pedido copiado. Cole no Claude.') } catch { toast.error('Não consegui copiar — selecione o texto e use Ctrl+C.') }
  }
  const aplicarResposta = () => aplicar.mutate({ tipo, params, resposta }, {
    onSuccess: (r) => { onResultado(r); setAberto(false); toast.success('Resposta aplicada!') },
    onError: (e) => toast.error(e.message, { duration: 8000 }),
  })

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {temChave && (
        <Button size={pequeno ? 'sm' : 'md'} onClick={viaApi} loading={rodando} disabled={desabilitado || rodando}>
          <Sparkles className="w-4 h-4 mr-1 inline" />{rodando ? 'Claude trabalhando…' : rotulo}
        </Button>
      )}
      <Button size={pequeno ? 'sm' : 'md'} variant={temChave ? 'secondary' : 'primary'} onClick={abrirManual} disabled={desabilitado}>
        <Copy className="w-4 h-4 mr-1 inline" />{temChave ? 'Copiar pedido' : `${rotulo} (copiar pedido)`}
      </Button>
      <Modal open={aberto} onClose={() => setAberto(false)} title={`${rotulo} — pelo Claude`} size="xl">
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-semibold text-dark-100">1. Copie o pedido e cole numa conversa nova do Claude</span>
              <span className="flex gap-2">
                <Button size="sm" onClick={copiar} disabled={!texto}><Copy className="w-4 h-4 mr-1 inline" />Copiar</Button>
                <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-gold-400 hover:underline px-2">Abrir o Claude <ExternalLink className="w-3.5 h-3.5" /></a>
              </span>
            </div>
            <textarea readOnly value={pedido.isPending ? 'Montando o pedido…' : texto} className="w-full h-40 bg-dark-900 border border-dark-600 rounded-lg p-3 text-xs font-mono text-dark-300" />
          </div>
          <div>
            <span className="text-sm font-semibold text-dark-100">2. Copie a resposta inteira do Claude e cole aqui</span>
            <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} placeholder="Cole aqui a resposta do Claude…" className="mt-1 w-full h-48 bg-dark-900 border border-dark-600 rounded-lg p-3 text-sm text-dark-100 focus:outline-none focus:border-gold-500" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button onClick={aplicarResposta} loading={aplicar.isPending} disabled={!resposta.trim()}><ClipboardPaste className="w-4 h-4 mr-1 inline" />Aplicar resposta</Button>
          </div>
        </div>
      </Modal>
    </span>
  )
}
