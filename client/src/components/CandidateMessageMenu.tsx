import { useRef, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { renderTemplate } from '../lib/messageTemplates'

interface CandidateMessageMenuProps {
  candidateName: string
  jobTitle: string
  phone: string
}

export default function CandidateMessageMenu({ candidateName, jobTitle, phone }: CandidateMessageMenuProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const { data: templates } = trpc.mensagensRh.list.useQuery(undefined, { enabled: !!position })

  const waNumber = `55${phone.replace(/\D/g, '')}`

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (position) {
      setPosition(null)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setPosition({ top: rect.bottom + 6, left: rect.left })
  }

  return (
    <>
      <button ref={buttonRef} onClick={toggle} className="inline-flex items-center gap-1 text-xs text-green-400 hover:underline">
        <MessageCircle size={11} />
        {phone}
      </button>

      {position && (
        <>
          {/* position: fixed escapa do overflow-hidden da tabela — position: absolute ficava
              cortado pelo container arredondado da lista de candidatos */}
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation()
              setPosition(null)
            }}
          />
          <div
            style={{ top: position.top, left: position.left }}
            className="fixed w-80 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl shadow-black/50 z-50 max-h-96 overflow-y-auto"
          >
            <div className="px-4 py-3 border-b border-dark-600 text-sm font-medium text-dark-100 flex items-center justify-between gap-2">
              Escolha uma mensagem
              <a
                href={`https://wa.me/${waNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation()
                  setPosition(null)
                }}
                className="text-xs font-normal text-dark-400 hover:text-dark-200 hover:underline shrink-0"
              >
                Sem mensagem
              </a>
            </div>
            {!templates || templates.length === 0 ? (
              <p className="text-dark-500 text-sm text-center py-6 px-4">
                Nenhuma mensagem cadastrada. Configure em Mensagens (RH).
              </p>
            ) : (
              templates.map((t) => {
                const wppText = renderTemplate(t.whatsappText, { nome: candidateName, vaga: jobTitle })
                return (
                  <a
                    key={t.id}
                    href={`https://wa.me/${waNumber}?text=${encodeURIComponent(wppText)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPosition(null)
                    }}
                    className="block px-4 py-3 border-b border-dark-700/50 last:border-b-0 hover:bg-dark-700/50 transition-colors"
                  >
                    <p className="text-sm text-dark-100 font-medium mb-1">{t.label}</p>
                    <p className="text-xs text-dark-400 line-clamp-2">{wppText}</p>
                  </a>
                )
              })
            )}
          </div>
        </>
      )}
    </>
  )
}
