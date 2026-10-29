// Formulário da pesquisa de satisfação do Pós-venda (Odin Compressores) —
// o mesmo usado pelo cliente na página pública (/pesquisa/:token, tema
// claro) e pela equipe quando lança a resposta que veio por telefone (tema
// escuro, dentro do pedido). Perguntas do modelo enviado pelo João em
// 2026-10-29.
import { useState } from 'react'
import { Star } from 'lucide-react'

export type RespostaPesquisa = {
  notaOdin: number
  notaTransportadora: number
  notaTecnico?: number
  atendeu: 'sim' | 'parcial' | 'nao'
  comentario?: string
  querContato: boolean
}

export const PERGUNTAS_NOTA = [
  { campo: 'notaOdin', texto: 'Como você avalia a Odin como fornecedora?' },
  { campo: 'notaTransportadora', texto: 'Como você avalia a transportadora e a entrega?' },
  { campo: 'notaTecnico', texto: 'Como você avalia o assistente técnico que realizou a partida?' },
] as const

export const ATENDEU_LABEL: Record<'sim' | 'parcial' | 'nao', string> = {
  sim: 'Sim, totalmente',
  parcial: 'Parcialmente',
  nao: 'Não, preciso de suporte',
}

type CampoNota = (typeof PERGUNTAS_NOTA)[number]['campo']

// semTecnico: pesquisa de pedido de peça (não tem técnico de partida).
export default function FormPesquisa({ claro, semTecnico, enviando, rotuloBotao, onEnviar }: { claro?: boolean; semTecnico?: boolean; enviando?: boolean; rotuloBotao: string; onEnviar: (r: RespostaPesquisa) => void }) {
  const perguntas = semTecnico ? PERGUNTAS_NOTA.filter((p) => p.campo !== 'notaTecnico') : PERGUNTAS_NOTA
  const [notas, setNotas] = useState<Partial<Record<CampoNota, number>>>({})
  const [atendeu, setAtendeu] = useState<RespostaPesquisa['atendeu'] | null>(null)
  const [comentario, setComentario] = useState('')
  const [querContato, setQuerContato] = useState(false)
  const [tentou, setTentou] = useState(false)

  const c = claro
    ? {
        titulo: 'text-slate-900',
        texto: 'text-slate-600',
        caixa: 'border-slate-200 bg-white hover:border-slate-400',
        caixaSel: 'border-amber-500 bg-amber-50 text-amber-700',
        estrela: 'text-slate-400',
        input: 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400',
        botao: 'bg-slate-900 text-white hover:bg-slate-800',
        erro: 'text-red-600',
      }
    : {
        titulo: 'text-dark-100',
        texto: 'text-dark-400',
        caixa: 'border-dark-600 bg-dark-900/40 hover:border-dark-400',
        caixaSel: 'border-gold-500 bg-gold-900/20 text-gold-300',
        estrela: 'text-dark-500',
        input: 'border-dark-600 bg-dark-900 text-dark-100 placeholder:text-dark-500',
        botao: 'bg-gold-600 text-dark-950 hover:bg-gold-500',
        erro: 'text-red-400',
      }

  const completo = perguntas.every((p) => notas[p.campo]) && !!atendeu

  function enviar() {
    setTentou(true)
    if (!completo) return
    onEnviar({ notaOdin: notas.notaOdin!, notaTransportadora: notas.notaTransportadora!, notaTecnico: semTecnico ? undefined : notas.notaTecnico!, atendeu: atendeu!, comentario: comentario.trim() || undefined, querContato })
  }

  return (
    <div className="space-y-6">
      {perguntas.map((p, i) => (
        <div key={p.campo}>
          <p className={`font-semibold mb-2 ${c.titulo}`}>
            {i + 1}. {p.texto}
          </p>
          <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
            {[1, 2, 3, 4, 5].map((n) => {
              const sel = (notas[p.campo] ?? 0) >= n
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNotas((v) => ({ ...v, [p.campo]: n }))}
                  className={`flex flex-col items-center gap-1 rounded-xl border py-2.5 transition-colors ${notas[p.campo] === n ? c.caixaSel : c.caixa}`}
                  aria-label={`Nota ${n}`}
                >
                  <Star size={20} className={sel ? 'fill-amber-400 text-amber-400' : c.estrela} />
                  <span className={`text-sm ${c.titulo}`}>{n}</span>
                </button>
              )
            })}
          </div>
          <div className={`flex justify-between text-xs mt-1 ${c.texto}`}>
            <span>Muito insatisfeito</span>
            <span>Muito satisfeito</span>
          </div>
          {tentou && !notas[p.campo] && <p className={`text-xs mt-1 ${c.erro}`}>Escolha uma nota</p>}
        </div>
      ))}

      <div>
        <p className={`font-semibold mb-2 ${c.titulo}`}>{perguntas.length + 1}. {semTecnico ? 'As peças e o atendimento' : 'O equipamento e o atendimento'} atenderam à sua necessidade?</p>
        <div className="space-y-2">
          {(Object.keys(ATENDEU_LABEL) as RespostaPesquisa['atendeu'][]).map((v) => (
            <label key={v} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 cursor-pointer ${atendeu === v ? c.caixaSel : c.caixa}`}>
              <input type="radio" name="atendeu" checked={atendeu === v} onChange={() => setAtendeu(v)} className="accent-amber-500" />
              <span className={c.titulo}>{ATENDEU_LABEL[v]}</span>
            </label>
          ))}
        </div>
        {tentou && !atendeu && <p className={`text-xs mt-1 ${c.erro}`}>Escolha uma opção</p>}
      </div>

      <div>
        <p className={`font-semibold mb-2 ${c.titulo}`}>{perguntas.length + 2}. Gostaria de deixar algum comentário ou sugestão?</p>
        <textarea
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Conte-nos como foi sua experiência (opcional)"
          className={`w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 ${c.input}`}
        />
      </div>

      <label className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 cursor-pointer ${querContato ? c.caixaSel : c.caixa}`}>
        <input type="checkbox" checked={querContato} onChange={(e) => setQuerContato(e.target.checked)} className="accent-amber-500" />
        <span className={c.titulo}>Gostaria que a equipe da Odin entrasse em contato comigo.</span>
      </label>

      <button type="button" disabled={enviando} onClick={enviar} className={`w-full rounded-xl py-3 font-semibold transition-colors disabled:opacity-60 ${c.botao}`}>
        {enviando ? 'Enviando...' : rotuloBotao}
      </button>
    </div>
  )
}

// Estrelinhas só pra exibir uma nota já dada (painel do pedido, relatório).
export function Estrelas({ nota, tamanho = 14 }: { nota: number | null; tamanho?: number }) {
  if (nota == null) return <span className="text-dark-500">—</span>
  return (
    <span className="inline-flex items-center gap-0.5" title={`${nota} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={tamanho} className={n <= nota ? 'fill-amber-400 text-amber-400' : 'text-dark-600'} />
      ))}
    </span>
  )
}
