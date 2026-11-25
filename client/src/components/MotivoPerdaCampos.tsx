import Select from './ui/Select'
import { Input, Textarea } from './ui/Input'
import { DICA_CATEGORIA_PERDA, MIN_CARACTERES_MOTIVO, OPCOES_CATEGORIA_PERDA, erroMotivoPerda, type CategoriaPerda } from '../lib/motivosPerda'

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
