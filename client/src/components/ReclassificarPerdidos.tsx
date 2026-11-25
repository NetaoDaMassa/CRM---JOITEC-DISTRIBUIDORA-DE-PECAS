import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle } from 'lucide-react'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import MotivoPerdaCampos, { erroDoMotivo, type MotivoPerdaValor } from './MotivoPerdaCampos'
import { ROTULO_CATEGORIA_PERDA } from '../lib/motivosPerda'

// Perdidos de novembro/2026 que voltaram pro vendedor (João, 2026-11-25):
// escolher a categoria nova e escrever o motivo detalhado. Abre sozinho ao
// entrar no Kanban enquanto tiver pendente; a faixa fica até terminar.
export default function ReclassificarPerdidos() {
  const utils = trpc.useUtils()
  const { data: pendentes } = trpc.motivosPerda.pendentesReclassificar.useQuery(undefined, { staleTime: 60_000 })
  const [aberto, setAberto] = useState(false)
  const [jaAbriuSozinho, setJaAbriuSozinho] = useState(false)
  const [valor, setValor] = useState<MotivoPerdaValor | null>(null)
  const atual = pendentes?.[0]

  useEffect(() => {
    if (!jaAbriuSozinho && pendentes && pendentes.length > 0) {
      setAberto(true)
      setJaAbriuSozinho(true)
    }
  }, [pendentes, jaAbriuSozinho])

  // Começa cada card com o texto que o vendedor já tinha escrito.
  useEffect(() => {
    if (atual) setValor({ categoria: '', observacao: atual.textoAntigo ?? '', concorrente: '', item: atual.item ?? '' })
  }, [atual?.id])

  const mut = trpc.motivosPerda.reclassificar.useMutation({
    onSuccess() {
      toast.success('Motivo salvo')
      utils.motivosPerda.pendentesReclassificar.invalidate()
      utils.funil.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  if (!pendentes || pendentes.length === 0) return null

  function salvar() {
    if (!atual || !valor) return
    const erro = erroDoMotivo(valor)
    if (erro) return toast.error(erro)
    mut.mutate({ id: atual.id, categoria: valor.categoria as any, observacao: valor.observacao, concorrente: valor.concorrente || undefined, item: valor.item || undefined })
  }

  return (
    <>
      <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-red-300">
          <AlertTriangle size={18} className="shrink-0" />
          <span>
            Você tem <b>{pendentes.length}</b> {pendentes.length === 1 ? 'perdido que precisa' : 'perdidos que precisam'} do motivo detalhado (categorias novas).
          </span>
        </div>
        <Button size="sm" variant="danger" onClick={() => setAberto(true)}>
          Completar agora
        </Button>
      </div>

      <Modal open={aberto} onClose={() => setAberto(false)} title={`Motivo de perda — faltam ${pendentes.length}`} size="md">
        {atual && valor && (
          <div className="space-y-4">
            <div className="rounded-lg bg-dark-800 border border-dark-600 p-3 text-sm">
              <p className="text-dark-50 font-medium">{atual.razaoSocial}</p>
              <p className="text-dark-400 text-xs mt-0.5">Marcado como perdido em {new Date(atual.data.replace(' ', 'T')).toLocaleDateString('pt-BR')}</p>
              <p className="text-dark-300 text-xs mt-2">
                Antes: <b>{atual.categoriaAntiga ? ROTULO_CATEGORIA_PERDA[atual.categoriaAntiga] ?? atual.categoriaAntiga : '—'}</b> — “{atual.textoAntigo || 'sem texto'}”
              </p>
            </div>
            <p className="text-xs text-dark-400">
              As categorias mudaram pra mostrar o motivo real (preço, falta de peça, crédito, cliente sumiu…). Escolha a certa e complete o texto se estiver curto — o gestor de cada setor vai ler.
            </p>
            <MotivoPerdaCampos valor={valor} onChange={(p) => setValor((v) => (v ? { ...v, ...p } : v))} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAberto(false)}>
                Depois
              </Button>
              <Button loading={mut.isPending} onClick={salvar}>
                Salvar{pendentes.length > 1 ? ' e próximo' : ''}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
