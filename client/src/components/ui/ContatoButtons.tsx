import { Phone } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import EmailButton from './EmailButton'

// Alguns números já foram salvos com "55" na frente (ex: importação antiga) —
// se simplesmente prefixássemos "55" de novo, viraria "5555..." e o link do
// WhatsApp/discador abre um número errado. Detecta esse caso pelo tamanho:
// só um número BR completo com DDI (12-13 dígitos) começando em "55" pode ser
// o DDI duplicado — um DDD 55 (Rio Grande do Sul) sozinho tem 10-11 dígitos e
// não deve ser mexido.
function soDigitos(v: string): string {
  const digitos = v.replace(/\D/g, '')
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
    return digitos.slice(2)
  }
  return digitos
}

export function WhatsappButton({
  telefone,
  clienteId,
  funilMensalId,
  mensagem,
  size = 'sm',
}: {
  telefone: string
  clienteId?: number
  funilMensalId?: number
  mensagem?: string
  size?: 'sm' | 'md'
}) {
  const digitos = soDigitos(telefone)
  const url = `https://wa.me/55${digitos}${mensagem ? `?text=${encodeURIComponent(mensagem)}` : ''}`
  const utils = trpc.useUtils()

  // Abrir o WhatsApp não garante que o contato foi feito — por isso registra
  // como pendente (resultado null) e o vendedor/admin confirma depois, no
  // histórico do card do Kanban, se respondeu ou não. Esse botão aparece em
  // vários lugares (Kanban, ficha do cliente, lista de clientes) que cada um
  // mostra a contagem/histórico de contato à sua própria maneira — invalida
  // tudo que poderia estar exibindo esse número, não só o Kanban.
  const registrarMut = trpc.contatos.registrarWhatsapp.useMutation({
    onSuccess: () => {
      toast.success('WhatsApp registrado — confirme o resultado no card do cliente.')
      utils.clientes.get.invalidate()
      utils.clientes.list.invalidate()
      utils.funil.meuFunil.invalidate()
      utils.funil.funilPorVendedor.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation()
        if (clienteId) registrarMut.mutate({ clienteId, funilMensalId })
      }}
      title={`Abrir WhatsApp — ${telefone}`}
      className={`inline-flex items-center justify-center rounded-lg bg-green-600/20 hover:bg-green-600/40 text-green-400 hover:text-green-300 border border-green-600/30 hover:border-green-500/60 transition-all shrink-0 ${size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'}`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'}>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    </a>
  )
}

export function LigarButton({ telefone, size = 'sm' }: { telefone: string; size?: 'sm' | 'md' }) {
  return (
    <a
      href={`tel:+55${soDigitos(telefone)}`}
      onClick={(e) => e.stopPropagation()}
      title={`Ligar — ${telefone}`}
      className={`inline-flex items-center justify-center rounded-lg bg-gold-600/20 hover:bg-gold-600/40 text-gold-400 hover:text-gold-300 border border-gold-600/30 hover:border-gold-500/60 transition-all shrink-0 ${size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'}`}
    >
      <Phone size={size === 'sm' ? 14 : 16} />
    </a>
  )
}

export default function ContatoButtons({
  telefone,
  telefonesExtras,
  email,
  emailsExtras,
  clienteId,
  funilMensalId,
  size = 'sm',
}: {
  telefone?: string | null
  telefonesExtras?: { id: number; numero: string; rotulo?: string | null }[]
  email?: string | null
  emailsExtras?: { id: number; email: string; rotulo?: string | null }[]
  clienteId?: number
  funilMensalId?: number
  size?: 'sm' | 'md'
}) {
  return (
    <div className="flex items-center gap-1.5">
      {email && <EmailButton email={email} size={size} />}
      {telefone && <LigarButton telefone={telefone} size={size} />}
      {telefone && <WhatsappButton telefone={telefone} clienteId={clienteId} funilMensalId={funilMensalId} size={size} />}
      {telefonesExtras?.map((t) => (
        <div key={t.id} className="flex items-center gap-1.5" title={t.rotulo || undefined}>
          <LigarButton telefone={t.numero} size={size} />
          <WhatsappButton telefone={t.numero} clienteId={clienteId} funilMensalId={funilMensalId} size={size} />
        </div>
      ))}
      {emailsExtras?.map((e) => (
        <EmailButton key={e.id} email={e.email} size={size} />
      ))}
    </div>
  )
}
