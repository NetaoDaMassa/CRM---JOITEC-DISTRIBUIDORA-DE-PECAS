import { useState } from 'react'
import { Info } from 'lucide-react'

const ITENS_TIPO = [
  { icone: '📞', texto: 'Ligação' },
  { icone: '🚗', texto: 'Visita' },
  { icone: '🤝', texto: 'Reunião' },
  { icone: '📌', texto: 'Outro' },
]

const ITENS_STATUS = [
  { icone: '🔴', texto: 'Muitos dias sem contato — retomar com urgência' },
  { icone: '⚠️', texto: 'Atenção necessária (telefone errado ou clientes sem contato)' },
  { icone: '⏳', texto: 'Contato registrado aguardando confirmação do resultado' },
]

// Faixa colorida do lado esquerdo do card do Kanban — mesmas faixas de
// corFaixaUrgencia (FunilBoard.tsx). Pedido do João, 2026-10-22.
const ITENS_FAIXA = [
  { cor: '#22a861', texto: 'Verde: contato há menos de 3 dias' },
  { cor: '#e8a33a', texto: 'Amarelo: 3 a 6 dias sem contato' },
  { cor: '#e5534b', texto: 'Vermelho: 7 dias ou mais sem contato — retomar' },
  { cor: '#6580a0', texto: 'Cinza: nunca teve contato registrado' },
]

const ITENS_COMPROMISSO = [
  { cor: 'bg-red-500', texto: 'Compromisso atrasado' },
  { cor: 'bg-gold-500', texto: 'Compromisso hoje' },
  { cor: 'bg-blue-500', texto: 'Compromisso agendado (dias futuros)' },
]

// Botão "ⓘ Legenda" reutilizado no Kanban e na Agenda — explica os
// símbolos/cores que aparecem nos cards e compromissos, pra quem não usa o
// sistema todo dia não precisar perguntar o que cada ícone significa.
export default function LegendaIcones({ faixaCard }: { faixaCard?: boolean } = {}) {
  const [aberto, setAberto] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setAberto((a) => !a)}
        className="flex items-center gap-1.5 text-xs text-dark-400 hover:text-gold-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-dark-800"
      >
        <Info size={14} />
        Legenda
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div className="absolute right-0 mt-1 w-72 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl shadow-black/50 z-50 p-4 space-y-3 text-xs">
            {faixaCard && (
              <div>
                <p className="text-dark-500 font-semibold mb-1.5">Cor da faixa do lado do card</p>
                <div className="space-y-1">
                  {ITENS_FAIXA.map((i) => (
                    <div key={i.texto} className="flex items-center gap-2 text-dark-300">
                      <span className="w-1.5 h-4 rounded-sm shrink-0" style={{ background: i.cor }} />
                      <span>{i.texto}</span>
                    </div>
                  ))}
                </div>
                <p className="text-dark-500 mt-1.5">Conta os dias desde o último contato com o cliente (qualquer tipo).</p>
              </div>
            )}
            <div>
              <p className="text-dark-500 font-semibold mb-1.5">Tipo de contato/compromisso</p>
              <div className="space-y-1">
                {ITENS_TIPO.map((i) => (
                  <div key={i.texto} className="flex items-center gap-2 text-dark-300">
                    <span>{i.icone}</span>
                    <span>{i.texto}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-dark-500 font-semibold mb-1.5">Status do cliente</p>
              <div className="space-y-1">
                {ITENS_STATUS.map((i) => (
                  <div key={i.texto} className="flex items-start gap-2 text-dark-300">
                    <span className="shrink-0">{i.icone}</span>
                    <span>{i.texto}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-dark-500 font-semibold mb-1.5">Cor do próximo compromisso</p>
              <div className="space-y-1">
                {ITENS_COMPROMISSO.map((i) => (
                  <div key={i.texto} className="flex items-center gap-2 text-dark-300">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${i.cor}`} />
                    <span>{i.texto}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
