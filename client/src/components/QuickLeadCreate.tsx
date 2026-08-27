import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input, Textarea } from './ui/Input'
import { LEAD_SEGMENT_VALUES, LEAD_SEGMENT_LABELS } from '../lib/leadsShared'

// Tira DDD+telefone de qualquer formato colado ("(11) 98888-7777",
// "11988887777", "+55 11 98888-7777", "+5511993321152"...). Retorna null se
// não achar um número BR plausível (8 ou 9 dígitos locais + DDD).
//
// Antes usava um regex guloso (`\d[\d\s().-]{8,}\d`) que, como a classe de
// caracteres incluía `\s`, atravessava quebra de linha — colando um texto
// com 2 números (CNPJ, CEP, um 2º telefone) numa linha diferente, o match
// grudava os dois blocos de dígitos num só e o comprimento final não batia
// com 10/11, fazendo o autopreenchimento falhar silenciosamente. Regex novo
// é no formato explícito de telefone BR (DDI opcional + DDD + 4-5 dígitos +
// 4 dígitos) — o DDI precisa ficar dentro do mesmo grupo opcional que o
// resto (não como checagem separada), senão um número compacto sem
// espaços tipo "+5511993321152" falha: o `(?<!\d)` do início só permite
// começar o match uma vez no texto (logo depois do "+"), então se o DDI
// não for consumido ali mesmo, o resto do dígitos vira uma sequência longa
// demais pra bater com "DDD + 8/9 dígitos" sozinha.
const REGEX_TELEFONE = /(?<!\d)(?:\+?55[ .-]?)?0?\(?([1-9]\d)\)?[ .-]?(\d{4,5})[ .-]?(\d{4})(?!\d)/

function extrairTelefone(texto: string): { ddd: number; phone: string; completo: string } | null {
  const m = texto.match(REGEX_TELEFONE)
  if (!m) return null
  const ddd = Number(m[1])
  const phone = m[2] + m[3]
  if (phone.length !== 8 && phone.length !== 9) return null
  // `phone` guarda só o número local (sem o DDD, que já vai separado no
  // campo `ddd`) — mesma convenção do resto do sistema. `completo` (com
  // DDD) fica só pra reconhecer a linha do telefone no texto colado e não
  // confundi-la com o nome, em extrairNome.
  return { ddd, phone, completo: String(ddd) + phone }
}

// Primeira linha não vazia que não é o próprio telefone/email vira o nome.
function extrairNome(texto: string, telefoneDigitos: string | null): string {
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const linha of linhas) {
    const soDigitos = linha.replace(/\D/g, '')
    if (telefoneDigitos && soDigitos.length > 4 && (telefoneDigitos.includes(soDigitos) || soDigitos.includes(telefoneDigitos))) continue
    if (linha.includes('@')) continue
    return linha.slice(0, 120)
  }
  return ''
}

function extrairEmail(texto: string): string {
  const m = texto.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)
  return m ? m[0] : ''
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

type CampoFormulario = { label: string; valor: string }

// Formulário de anúncio (Meta Lead Ads e afins) manda um texto com
// "Pergunta/Rótulo: valor" linha a linha, ex:
//   Full name: Francisco
//   Phone number: +5511993321152
//   Qual seu Cnpj ?: 08561411864
// A heurística antiga (1ª linha = nome) pegava a saudação do topo do
// formulário como se fosse o nome, e nunca olhava pros rótulos — daí "tudo
// trocado". Aqui separa rótulo/valor de cada linha; a saudação (sem ":")
// simplesmente não vira um campo.
function extrairCamposRotulados(texto: string): CampoFormulario[] {
  const campos: CampoFormulario[] = []
  for (const linhaBruta of texto.split('\n')) {
    const linha = linhaBruta.trim()
    const m = linha.match(/^([^:]{2,60}):\s*(.+)$/)
    if (!m) continue
    const valor = m[2].trim()
    if (!valor) continue
    campos.push({ label: m[1].trim(), valor })
  }
  return campos
}

function achaCampo(campos: CampoFormulario[], ...palavrasChave: string[]): string | null {
  for (const c of campos) {
    const labelNorm = normalizar(c.label)
    if (palavrasChave.some((p) => labelNorm.includes(p))) return c.valor
  }
  return null
}

const LABELS_NOME = ['full name', 'nome completo', 'nome']
const LABELS_TELEFONE = ['phone', 'telefone', 'whatsapp', 'celular']
const LABELS_EMAIL = ['email', 'e-mail']
const LABELS_CIDADE = ['city', 'cidade']
const LABELS_CNPJ = ['cnpj']
const LABELS_CONHECIDOS = [...LABELS_NOME, ...LABELS_TELEFONE, ...LABELS_EMAIL, ...LABELS_CIDADE, ...LABELS_CNPJ]

// A pergunta de segmento varia de campanha pra campanha (ex: "Você trabalha
// com compressor de ar?"), então não dá pra reconhecer pelo rótulo — em vez
// disso, olha se a RESPOSTA bate com um dos segmentos já cadastrados.
function segmentoPorResposta(resposta: string): string | null {
  const r = normalizar(resposta)
  if (r.includes('assistente')) return 'assistente_tecnico'
  if (r.includes('instalador')) return 'instalador'
  if (r.includes('revend') || r.includes('lojist')) return 'revendedor_lojista'
  return null
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
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)
  const ultimoCnpjConsultadoRef = useRef<string | null>(null)

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
    ultimoCnpjConsultadoRef.current = null
  }

  async function aplicarColado(texto: string) {
    setColado(texto)

    const campos = extrairCamposRotulados(texto)
    const nomeRotulado = achaCampo(campos, ...LABELS_NOME)
    const telefoneRotulado = achaCampo(campos, ...LABELS_TELEFONE)

    // Só entra no modo "formulário com rótulo" quando reconhece nome ou
    // telefone rotulados — senão cai pro modo genérico (cartão de contato
    // colado solto), que já lida bem com texto sem essa estrutura.
    if (nomeRotulado || telefoneRotulado) {
      if (nomeRotulado) setName(nomeRotulado)
      if (telefoneRotulado) {
        const tel = extrairTelefone(telefoneRotulado)
        if (tel) {
          setDdd(String(tel.ddd))
          setPhone(tel.phone)
        }
      }
      const emailRotulado = achaCampo(campos, ...LABELS_EMAIL)
      if (emailRotulado) setEmail(emailRotulado)
      const cidadeRotulada = achaCampo(campos, ...LABELS_CIDADE)
      if (cidadeRotulada) setCity(cidadeRotulada)

      // Perguntas sem rótulo reconhecido (ex: "Você trabalha com compressor
      // de ar?") viram observação, e se a resposta bater com um segmento
      // conhecido, preenche o segmento sozinho.
      const extras = campos.filter((c) => !LABELS_CONHECIDOS.some((l) => normalizar(c.label).includes(l)))
      if (extras.length) {
        setObservations(extras.map((c) => `${c.label}: ${c.valor}`).join('\n'))
        for (const c of extras) {
          const seg = segmentoPorResposta(c.valor)
          if (seg) {
            setSegment(seg)
            break
          }
        }
      }

      // Não existe campo de CNPJ no cadastro de lead — o "Empresa do lead"
      // é o lugar mais próximo, então preenche com o CNPJ bruto primeiro
      // (nunca perde o dado) e, se for um CNPJ válido de verdade (14
      // dígitos), troca pela razão social consultada na Receita.
      const cnpjRotulado = achaCampo(campos, ...LABELS_CNPJ)
      if (cnpjRotulado) {
        setCompany(cnpjRotulado)
        const cnpjDigitos = cnpjRotulado.replace(/\D/g, '')
        if (cnpjDigitos.length === 14 && cnpjDigitos !== ultimoCnpjConsultadoRef.current) {
          ultimoCnpjConsultadoRef.current = cnpjDigitos
          setBuscandoCnpj(true)
          try {
            const dados = await utils.clientes.cnpjLookup.fetch({ cnpj: cnpjDigitos })
            if (dados) {
              setCompany(dados.razaoSocial)
              if (!cidadeRotulada && dados.cidade) setCity(dados.cidade)
            }
          } catch {
            // Consulta fora do ar ou CNPJ não encontrado não deve travar o
            // resto do preenchimento — fica o valor bruto já preenchido.
          } finally {
            setBuscandoCnpj(false)
          }
        }
      }
      return
    }

    // Texto solto (cartão de contato copiado, sem rótulos) — heurística
    // antiga: 1ª linha vira nome, 1º telefone/e-mail reconhecido no texto.
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
          <div>
            <Input label="Empresa do lead" value={company} onChange={(e) => setCompany(e.target.value)} />
            {buscandoCnpj && <p className="text-xs text-dark-500 mt-1">Consultando CNPJ na Receita...</p>}
          </div>
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
