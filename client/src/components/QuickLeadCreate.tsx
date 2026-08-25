import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input, Textarea } from './ui/Input'
import { LEAD_SEGMENT_VALUES, LEAD_SEGMENT_LABELS } from '../lib/leadsShared'

// Tira DDD+telefone de qualquer formato colado ("(11) 98888-7777",
// "11988887777", "+55 11 98888-7777"...). Retorna null se não achar um
// número BR plausível (10 ou 11 dígitos depois do DDI/zero).
function extrairTelefone(texto: string): { ddd: number; phone: string; completo: string } | null {
  const digitosMatch = texto.match(/\d[\d\s().-]{8,}\d/)
  if (!digitosMatch) return null
  let digitos = digitosMatch[0].replace(/\D/g, '')
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) digitos = digitos.slice(2)
  if ((digitos.length === 11 || digitos.length === 12) && digitos.startsWith('0')) digitos = digitos.slice(1)
  if (digitos.length !== 10 && digitos.length !== 11) return null
  const ddd = Number(digitos.slice(0, 2))
  // `phone` guarda só o número local (sem o DDD, que já vai separado no
  // campo `ddd`) — mesma convenção do resto do sistema. Deixar o DDD junto
  // aqui duplicava ele na tela do lead e quebrava o link do WhatsApp.
  // `completo` (com DDD) fica só pra reconhecer a linha do telefone no texto
  // colado e não confundi-la com o nome, em extrairNome.
  return { ddd, phone: digitos.slice(2), completo: digitos }
}

// Primeira linha não vazia que não é o próprio telefone/email vira o nome.
function extrairNome(texto: string, telefoneDigitos: string | null): string {
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const linha of linhas) {
    const soDigitos = linha.replace(/\D/g, '')
    if (telefoneDigitos && soDigitos.length > 4 && telefoneDigitos.includes(soDigitos)) continue
    if (linha.includes('@')) continue
    return linha.slice(0, 120)
  }
  return ''
}

function extrairEmail(texto: string): string {
  const m = texto.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)
  return m ? m[0] : ''
}

export default function QuickLeadCreate({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: number) => void }) {
  const { user } = useAuth()
  const utils = trpc.useUtils()
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: user?.role === 'admin' })

  const [colado, setColado] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [ddd, setDdd] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [city, setCity] = useState('')
  const [segment, setSegment] = useState('')
  const [observations, setObservations] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [autoAssign, setAutoAssign] = useState(true)

  function reset() {
    setColado('')
    setName('')
    setPhone('')
    setDdd('')
    setEmail('')
    setCompany('')
    setCity('')
    setSegment('')
    setObservations('')
    setVendorId('')
    setAutoAssign(true)
  }

  function aplicarColado(texto: string) {
    setColado(texto)
    const tel = extrairTelefone(texto)
    if (tel) {
      setDdd(String(tel.ddd))
      setPhone(tel.phone)
    }
    const nome = extrairNome(texto, tel?.completo ?? null)
    if (nome) setName(nome)
    const mail = extrairEmail(texto)
    if (mail) setEmail(mail)
  }

  const mut = trpc.leads.create.useMutation({
    onSuccess(data) {
      toast.success('Lead criado')
      utils.leads.list.invalidate()
      utils.leads.stats.invalidate()
      reset()
      onClose()
      onCreated?.(data.id)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return toast.error('Nome é obrigatório')
    if (!phone.trim() || !ddd) return toast.error('Telefone com DDD é obrigatório')
    mut.mutate({
      name,
      phone,
      ddd: Number(ddd),
      email: email || undefined,
      company: company || undefined,
      city: city || undefined,
      segment: (segment || undefined) as any,
      observations: observations || undefined,
      vendorId: user?.role === 'admin' && vendorId ? Number(vendorId) : undefined,
      autoAssign: user?.role === 'admin' ? (!vendorId ? autoAssign : false) : true,
    })
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Criar lead"
      size="md"
    >
      <form onSubmit={submit} className="space-y-4">
        <Textarea
          label="Cole aqui o contato (opcional)"
          placeholder="Cole um texto com nome/telefone/email — o formulário abaixo tenta preencher sozinho"
          value={colado}
          onChange={(e) => aplicarColado(e.target.value)}
          rows={3}
        />
        <Input label="Nome *" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-[100px_1fr] gap-2">
          <Input label="DDD *" value={ddd} onChange={(e) => setDdd(e.target.value.replace(/\D/g, ''))} maxLength={2} />
          <Input label="Telefone *" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} />
        </div>
        <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Empresa do lead" value={company} onChange={(e) => setCompany(e.target.value)} />
          <Input label="Cidade" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <Select
          label="Segmento"
          value={segment}
          onChange={(e) => setSegment(e.target.value)}
          placeholder="Selecione..."
          options={LEAD_SEGMENT_VALUES.map((s) => ({ value: s, label: LEAD_SEGMENT_LABELS[s] }))}
        />
        <Textarea label="Observações" value={observations} onChange={(e) => setObservations(e.target.value)} rows={2} />

        {user?.role === 'admin' && (
          <div>
            <Select
              label="Atribuir a"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              placeholder={autoAssign ? 'Rodízio automático por região' : 'Sem vendedor'}
              options={(vendedores ?? []).map((v) => ({ value: v.id, label: v.name }))}
            />
            {!vendorId && (
              <label className="flex items-center gap-2 text-xs text-dark-400 mt-2">
                <input type="checkbox" checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} />
                Atribuir automaticamente por rodízio (região do DDD)
              </label>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" loading={mut.isPending}>
            Criar lead
          </Button>
        </div>
      </form>
    </Modal>
  )
}
