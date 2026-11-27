import { useState } from 'react'
import toast from 'react-hot-toast'
import { Lock } from 'lucide-react'
import Select from './ui/Select'
import Button from './ui/Button'
import { Input, Textarea } from './ui/Input'
import { trpc } from '../lib/trpc'
import { DICA_CATEGORIA_PERDA, MIN_CARACTERES_MOTIVO, OPCOES_CATEGORIA_PERDA, ROTULO_CATEGORIA_PERDA, erroMotivoPerda, type CategoriaPerda } from '../lib/motivosPerda'

export interface MotivoPerdaValor {
  categoria: string
  observacao: string
  concorrente: string
  item: string
}

export const MOTIVO_PERDA_VAZIO: MotivoPerdaValor = { categoria: '', observacao: '', concorrente: '', item: '' }

export function erroDoMotivo(v: MotivoPerdaValor): string | null {
  return erroMotivoPerda(v.categoria, v.observacao, v.concorrente, v.item)
}

// Campos do motivo de perda (Kanban → Perdido, Cancelar pedido → Perdido e
// reclassificação dos perdidos de novembro). Regra em lib/motivosPerda.ts.
export default function MotivoPerdaCampos({ valor, onChange }: { valor: MotivoPerdaValor; onChange: (patch: Partial<MotivoPerdaValor>) => void }) {
  const cat = valor.categoria as CategoriaPerda | ''
  const itemObrigatorio = cat === 'falta_peca' || cat === 'prazo_entrega'
  const tam = valor.observacao.trim().length
  const erro = cat && tam > 0 ? erroDoMotivo(valor) : null
  const minimo = cat === 'cadastro_errado' ? 15 : MIN_CARACTERES_MOTIVO
  return (
    <div className="space-y-3">
      <div>
        <Select label="Por que perdeu? — obrigatório" value={valor.categoria} onChange={(e) => onChange({ categoria: e.target.value })} placeholder="Selecione..." options={OPCOES_CATEGORIA_PERDA} />
        {cat && <p className="text-[11px] text-dark-400 mt-1">{DICA_CATEGORIA_PERDA[cat]}</p>}
      </div>
      {cat === 'preco_concorrente' && (
        <Input label="Perdeu pra quem? — obrigatório" value={valor.concorrente} onChange={(e) => onChange({ concorrente: e.target.value })} placeholder="Ex: Mercado Livre, Top Fusion, Conectfit, site do fabricante..." />
      )}
      {cat && cat !== 'cadastro_errado' && (
        <Input
          label={itemObrigatorio ? 'Qual peça/item? — obrigatório' : 'Peça/item (se tiver)'}
          value={valor.item}
          onChange={(e) => onChange({ item: e.target.value })}
          placeholder="Ex: filtro coalescente 1&quot;, cabeçote 20 pés W900..."
        />
      )}
      <div>
        <Textarea
          label="Explique o que aconteceu — obrigatório"
          rows={3}
          value={valor.observacao}
          onChange={(e) => onChange({ observacao: e.target.value })}
          placeholder="O que o cliente disse? Com quem fechou? Quantas vezes tentou contato? Qual item faltou? Não vale só 'sem retorno' ou 'não fechou'."
        />
        <div className="flex justify-between gap-2 mt-1 text-[11px]">
          <span className={erro ? 'text-red-400' : 'text-dark-500'}>{erro ?? ' '}</span>
          <span className={tam >= minimo ? 'text-green-400 shrink-0' : 'text-dark-500 shrink-0'}>
            {tam}/{minimo}
          </span>
        </div>
      </div>
    </div>
  )
}

// Perdido com motivo já registrado (João, 2026-11-27): o texto fica travado,
// o vendedor só acrescenta informação — com nome e data, sem apagar o que
// estava. Mostra também o que o setor/gerente comentou.
export function MotivoPerdaTravado({
  funilMensalId,
  categoria,
  observacao,
  item,
  concorrente,
}: {
  funilMensalId: number
  categoria: string | null
  observacao: string | null
  item: string | null
  concorrente: string | null
}) {
  const utils = trpc.useUtils()
  const { data: comentarios } = trpc.motivosPerda.doCard.useQuery({ id: funilMensalId })
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const mut = trpc.motivosPerda.complementar.useMutation({
    onSuccess() {
      setTexto('')
      setAberto(false)
      toast.success('Informação adicionada ao motivo da perda.')
      utils.motivosPerda.doCard.invalidate({ id: funilMensalId })
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <div className="rounded-lg border border-dark-600 bg-dark-900/60 p-3 space-y-2">
      <p className="text-xs text-dark-400 flex items-center gap-1.5">
        <Lock size={12} /> Motivo da perda já registrado — não pode ser alterado, só acrescentado.
      </p>
      <p className="text-sm text-dark-100">
        <b>{categoria ? ROTULO_CATEGORIA_PERDA[categoria] ?? categoria : 'Sem categoria'}</b>
        {concorrente && <span className="text-dark-300"> · Perdeu pra: {concorrente}</span>}
        {item && <span className="text-dark-300"> · Item: {item}</span>}
      </p>
      <p className="text-sm text-dark-200 whitespace-pre-line">{observacao}</p>
      {(comentarios ?? []).map((c) => (
        <p key={c.id} className="text-xs text-dark-300 border-t border-dark-700 pt-1.5">
          <b className="text-dark-100">{c.tipo === 'complemento' ? `➕ ${c.autor} acrescentou` : `💬 ${c.autor}`}</b>{' '}
          <span className="text-dark-500">{new Date(c.createdAt.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>: {c.texto}
        </p>
      ))}
      {aberto ? (
        <div className="space-y-2">
          <Textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="O que mudou ou o que faltou dizer? Ex: cliente ligou de novo e disse que já comprou na concorrência." />
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="secondary" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button size="sm" loading={mut.isPending} disabled={texto.trim().length < 10} onClick={() => mut.mutate({ id: funilMensalId, texto })}>
              Adicionar
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>
          ➕ Adicionar informação
        </Button>
      )}
    </div>
  )
}
