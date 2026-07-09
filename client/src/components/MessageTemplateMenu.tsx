import { useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { whatsappUrl } from '../lib/utils'
import { renderTemplate } from '../lib/messageTemplates'

interface MessageTemplateMenuProps {
  leadName: string
  ddd: number
  phone: string
  email?: string | null
}

export default function MessageTemplateMenu({ leadName, ddd, phone, email }: MessageTemplateMenuProps) {
  const [open, setOpen] = useState(false)
  const { data: templates } = trpc.messageTemplates.list.useQuery(undefined, { enabled: open })

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        title="Mensagem automática"
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 h-7 bg-gold-600/20 hover:bg-gold-600/40 text-gold-400 hover:text-gold-300 border border-gold-600/30 hover:border-gold-500/60 transition-all text-xs font-medium"
      >
        <MessageSquareText size={13} />
        Mensagem
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false) }} />
          <div className="absolute left-0 mt-2 w-80 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl shadow-black/50 z-50 max-h-96 overflow-y-auto">
            <div className="px-4 py-3 border-b border-dark-600 text-sm font-medium text-dark-100">
              Escolha uma mensagem
            </div>
            {!templates || templates.length === 0 ? (
              <p className="text-dark-500 text-sm text-center py-6 px-4">
                Nenhuma mensagem cadastrada. Configure em Mensagens (menu do admin).
              </p>
            ) : (
              templates.map((t: any) => {
                const wppText = renderTemplate(t.whatsappText, { nome: leadName })
                const subject = renderTemplate(t.emailSubject, { nome: leadName })
                const body = renderTemplate(t.emailBody, { nome: leadName })
                return (
                  <div key={t.id} className="px-4 py-3 border-b border-dark-700/50 last:border-b-0">
                    <p className="text-sm text-dark-100 font-medium mb-1">{t.label}</p>
                    <p className="text-xs text-dark-400 line-clamp-2 mb-2">{wppText}</p>
                    <div className="flex gap-2">
                      <a
                        href={whatsappUrl(ddd, phone, wppText)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => { e.stopPropagation(); setOpen(false) }}
                        className="flex-1 text-center text-xs font-medium px-2 py-1.5 rounded-lg bg-green-600/20 hover:bg-green-600/40 text-green-400 hover:text-green-300 border border-green-600/30 transition-all"
                      >
                        WhatsApp
                      </a>
                      {email && (
                        <a
                          href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
                          onClick={(e) => { e.stopPropagation(); setOpen(false) }}
                          className="flex-1 text-center text-xs font-medium px-2 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 hover:text-blue-300 border border-blue-600/30 transition-all"
                        >
                          Email
                        </a>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
