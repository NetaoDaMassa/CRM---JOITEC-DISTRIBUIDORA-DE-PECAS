import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Paperclip, X, Sparkles, ImagePlus, AlertTriangle } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input, Textarea } from './ui/Input'
import { LEAD_SEGMENT_VALUES, LEAD_SEGMENT_LABELS, LEAD_STATUS_LABELS, PAISES_TELEFONE } from '../lib/leadsShared'

// --- "Novo lead por print" (João, 2026-11-16) --------------------------
// Print do WhatsApp → IA lê (leads.lerPrint) → campos abaixo preenchidos pra
// conferir. Os prints são reduzidos aqui no navegador antes de subir (print
// de celular passa fácil de 3 MB; a IA não precisa de mais que ~2000 px).
type PrintColado = { id: string; url: string; base64: string; mediaType: 'image/jpeg'; arquivo: File }

async function prepararPrint(file: File): Promise<PrintColado> {
  const urlOriginal = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Imagem inválida'))
      el.src = urlOriginal
    })
    const LADO_MAX = 2000
    const escala = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * escala)
    canvas.height = Math.round(img.naturalHeight * escala)
    const c2d = canvas.getContext('2d')!
    c2d.fillStyle = '#fff'
    c2d.fillRect(0, 0, canvas.width, canvas.height)
    c2d.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao converter'))), 'image/jpeg', 0.85))
    const base64 = await new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
      r.readAsDataURL(blob)
    })
    const n = Date.now()
    return {
      id: `${n}-${Math.random()}`,
      url: URL.createObjectURL(blob),
      base64,
      mediaType: 'image/jpeg',
      arquivo: new File([blob], `print-whatsapp-${n}.jpg`, { type: 'image/jpeg' }),
    }
  } finally {
    URL.revokeObjectURL(urlOriginal)
  }
}

type IguaisLead = { id: number; name: string; status: string; vendedor: string | null }
type IguaisCliente = { id: number; razaoSocial: string; vendedor: string | null }

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
const REGEX_LINHA_ROTULADA = /^([^:]{2,60}):\s*(.+)$/

function extrairCamposRotulados(texto: string): CampoFormulario[] {
  const campos: CampoFormulario[] = []
  for (const linhaBruta of texto.split('\n')) {
    const linha = linhaBruta.trim()
    const m = linha.match(REGEX_LINHA_ROTULADA)
    if (!m) continue
    const valor = m[2].trim()
    if (!valor) continue
    campos.push({ label: m[1].trim(), valor })
  }
  return campos
}

// Linhas que não bateram no formato "Rótulo: valor" nenhuma (ex: a saudação
// do topo do formulário, ou qualquer texto livre que o vendedor colou junto)
// — achado do João, 2026-09-16: essas linhas simplesmente desapareciam,
// nunca viravam nem campo nem observação. Aqui juntam a "Observações" junto
// com os campos de rótulo desconhecido, pra nenhuma linha colada se perder.
function extrairLinhasSoltas(texto: string): string[] {
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !REGEX_LINHA_ROTULADA.test(l))
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

export default function QuickLeadCreate({
  open,
  onClose,
  onCreated,
  modoPrint = false,
  basePath,
}: {
  open: boolean
  onClose: () => void
  onCreated?: (id: number) => void
  modoPrint?: boolean
  basePath?: string
}) {
  const { user, empresaAtivaId } = useAuth()
  const utils = trpc.useUtils()
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: user?.role === 'admin' })
  const { data: empresas } = trpc.empresas.list.useQuery(undefined, { enabled: user?.role === 'admin' })
  const empresaSlug = empresas?.find((e) => e.id === empresaAtivaId)?.slug

  const [colado, setColado] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [ddd, setDdd] = useState('')
  // País do telefone (João, 2026-11-25 — leads do Paraguai na Odin
  // Compressores): fora do Brasil não tem DDD, vai o número inteiro com o
  // código do país. 'outro' = digita o código na mão.
  const [pais, setPais] = useState('55')
  const [codigoOutro, setCodigoOutro] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [city, setCity] = useState('')
  const [segment, setSegment] = useState('')
  const [observations, setObservations] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const { data: campanhas } = trpc.leadCampaigns.listarAtivas.useQuery()
  const [autoAssign, setAutoAssign] = useState(true)
  // Fila "Novo (Consumidor Final)" — só Joitec, pedido do João, 2026-09-21:
  // lead cai sem vendedor, visível pra região inteira, quem pegar primeiro
  // fica com ele (sem rodízio). Ver leads.assumirConsumidorFinal.
  const [paraFilaConsumidorFinal, setParaFilaConsumidorFinal] = useState(false)
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)
  const ultimoCnpjConsultadoRef = useRef<string | null>(null)
  const [arquivos, setArquivos] = useState<File[]>([])
  const [enviandoAnexos, setEnviandoAnexos] = useState(false)
  const [prints, setPrints] = useState<PrintColado[]>([])
  const [arrastando, setArrastando] = useState(false)
  const [usouIA, setUsouIA] = useState(false)
  const [conversa, setConversa] = useState('')
  const [avisoTelefone, setAvisoTelefone] = useState<string | null>(null)
  const [iguais, setIguais] = useState<{ leads: IguaisLead[]; clientes: IguaisCliente[] } | null>(null)
  const inputPrintRef = useRef<HTMLInputElement>(null)

  function reset() {
    setColado('')
    setName('')
    setPhone('')
    setDdd('')
    setPais('55')
    setCodigoOutro('')
    setEmail('')
    setCompany('')
    setCity('')
    setSegment('')
    setObservations('')
    setVendorId('')
    setAutoAssign(true)
    setParaFilaConsumidorFinal(false)
    setCampaignId('')
    ultimoCnpjConsultadoRef.current = null
    setArquivos([])
    prints.forEach((p) => URL.revokeObjectURL(p.url))
    setPrints([])
    setUsouIA(false)
    setConversa('')
    setAvisoTelefone(null)
    setIguais(null)
  }

  async function adicionarPrints(files: File[]) {
    const imagens = files.filter((f) => f.type.startsWith('image/'))
    if (!imagens.length) return
    const espaco = 6 - prints.length
    if (espaco <= 0) return toast.error('No máximo 6 prints por lead')
    if (imagens.length > espaco) toast.error(`Só cabem mais ${espaco} print(s) — o resto ficou de fora`)
    try {
      const prontos = await Promise.all(imagens.slice(0, espaco).map(prepararPrint))
      setPrints((prev) => [...prev, ...prontos])
    } catch {
      toast.error('Não consegui abrir essa imagem')
    }
  }

  // Ctrl+V em qualquer lugar da janela: se tiver imagem na área de
  // transferência vira print; texto continua indo pro campo normalmente.
  function aoColar(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    adicionarPrints(files)
  }

  const lerPrintMut = trpc.leads.lerPrint.useMutation({
    async onSuccess(r) {
      setUsouIA(true)
      // Só sobrescreve o que a IA achou — campo que ela não achou fica como
      // a pessoa deixou (pode já ter digitado algo).
      if (r.nome) setName(r.nome)
      if (r.ddd && r.phone) {
        setPais('55')
        setDdd(String(r.ddd))
        setPhone(r.phone)
      }
      if (r.email) setEmail(r.email)
      if (r.empresa) setCompany(r.empresa)
      if (r.cidade) setCity(r.cidade)
      if (r.segmento) setSegment(r.segmento)
      if (r.campaignId) setCampaignId(String(r.campaignId))
      const obs = [r.produtoInteresse ? `Interesse: ${r.produtoInteresse}` : null, r.resumo].filter(Boolean).join('\n')
      if (obs) setObservations(obs)
      setConversa(r.conversa ?? '')
      setIguais(r.leadsIguais.length || r.clientesIguais.length ? { leads: r.leadsIguais, clientes: r.clientesIguais } : null)
      setAvisoTelefone(
        r.phone
          ? null
          : r.telefoneLido
            ? `A IA leu "${r.telefoneLido}", mas não parece um telefone com DDD — confira e digite.`
            : 'Telefone não apareceu no print (contato salvo no celular mostra só o nome). Digite o número ou mande um print dos dados do contato.'
      )

      // CNPJ achado na conversa → razão social/cidade pela Receita, igual
      // ao fluxo do formulário colado.
      if (r.cnpj && r.cnpj.length === 14 && r.cnpj !== ultimoCnpjConsultadoRef.current) {
        ultimoCnpjConsultadoRef.current = r.cnpj
        if (!r.empresa) setCompany(r.cnpj)
        setBuscandoCnpj(true)
        try {
          const dados = await utils.clientes.cnpjLookup.fetch({ cnpj: r.cnpj })
          if (dados) {
            setCompany(dados.razaoSocial)
            if (!r.cidade && dados.cidade) setCity(dados.cidade)
          }
        } catch {
          // Receita fora do ar não trava — fica o que a IA leu.
        } finally {
          setBuscandoCnpj(false)
        }
      }
      toast.success('Pronto! Confira os dados antes de criar o lead')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function lerComIA() {
    if (!prints.length && !colado.trim()) return toast.error('Cole um print (Ctrl+V), arraste a imagem ou cole o texto da conversa')
    lerPrintMut.mutate({
      imagens: prints.map((p) => ({ mediaType: p.mediaType, base64: p.base64 })),
      texto: colado.trim() || undefined,
    })
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
          setPais('55')
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
      // conhecido, preenche o segmento sozinho. Linhas sem rótulo nenhum
      // (texto livre colado junto) entram também, pra nada desaparecer.
      const extras = campos.filter((c) => !LABELS_CONHECIDOS.some((l) => normalizar(c.label).includes(l)))
      const linhasSoltas = extrairLinhasSoltas(texto)
      if (extras.length || linhasSoltas.length) {
        const textoObservacoes = [...extras.map((c) => `${c.label}: ${c.valor}`), ...linhasSoltas].join('\n')
        setObservations(textoObservacoes)
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
      setPais('55')
      setDdd(String(tel.ddd))
      setPhone(tel.phone)
    }
    const nome = extrairNome(texto, tel?.completo ?? null)
    if (nome) setName(nome)
    const mail = extrairEmail(texto)
    if (mail) setEmail(mail)

    // Qualquer linha que não virou nome/telefone/e-mail (ex: "precisa de
    // peça pro compressor X", contexto que o vendedor colou junto) ia pro
    // limbo antes — achado do João, 2026-09-16. Agora cai em Observações,
    // igual já acontecia no modo "formulário com rótulo".
    const restante = texto
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l !== nome)
      .filter((l) => {
        const soDigitos = l.replace(/\D/g, '')
        if (tel && soDigitos.length > 4 && (tel.completo.includes(soDigitos) || soDigitos.includes(tel.completo))) return false
        if (mail && l.includes(mail)) return false
        return true
      })
    if (restante.length) setObservations(restante.join('\n'))
  }

  const addAttachmentMut = trpc.leads.addAttachment.useMutation({
    onError(err) {
      toast.error(`Anexo não enviado: ${err.message}`)
    },
  })

  // Lead precisa existir antes de anexar (mesmo endpoint de upload que
  // LeadDetail.tsx já usa pra anexo em lead existente) — por isso o envio
  // só acontece aqui, depois que `leads.create` devolve o id.
  async function enviarAnexos(leadId: number) {
    setEnviandoAnexos(true)
    const token = localStorage.getItem('odin_token')
    try {
      // Os prints da conversa entram como anexo do lead também (prova do
      // que o cliente pediu, e dá pra conferir depois).
      for (const file of [...prints.map((p) => p.arquivo), ...arquivos]) {
        try {
          const form = new FormData()
          form.append('file', file)
          const res = await fetch('/upload/lead-attachment', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
          if (!res.ok) {
            toast.error(`Falha ao enviar ${file.name}`)
            continue
          }
          const data = await res.json()
          await addAttachmentMut.mutateAsync({ leadId, filename: data.path, originalName: data.originalName, mimeType: data.mimeType, size: data.size })
        } catch {
          toast.error(`Falha ao enviar ${file.name}`)
        }
      }
    } finally {
      setEnviandoAnexos(false)
    }
  }

  const addNoteMut = trpc.leads.addNote.useMutation()

  const mut = trpc.leads.create.useMutation({
    async onSuccess(data) {
      toast.success('Lead criado')
      utils.leads.list.invalidate()
      utils.leads.stats.invalidate()
      if (conversa.trim()) {
        try {
          await addNoteMut.mutateAsync({ leadId: data.id, type: 'nota', content: `Conversa do WhatsApp (lida do print):\n\n${conversa.trim()}` })
        } catch {
          toast.error('Lead criado, mas a conversa não foi salva no histórico')
        }
      }
      if (arquivos.length || prints.length) await enviarAnexos(data.id)
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
    const codigoPais = pais === 'outro' ? codigoOutro.replace(/\D/g, '') : pais
    const estrangeiro = codigoPais !== '55'
    if (estrangeiro && !codigoPais) return toast.error('Informe o código do país')
    if (!phone.trim() || (!estrangeiro && !ddd)) return toast.error(estrangeiro ? 'Telefone é obrigatório' : 'Telefone com DDD é obrigatório')
    mut.mutate({
      name,
      phone: estrangeiro ? `+${codigoPais}${phone.replace(/\D/g, '')}` : phone,
      ddd: estrangeiro ? undefined : Number(ddd),
      email: email || undefined,
      company: company || undefined,
      city: city || undefined,
      segment: (segment || undefined) as any,
      observations: observations || undefined,
      source: usouIA || prints.length ? 'whatsapp_print' : undefined,
      vendorId: user?.role === 'admin' && !paraFilaConsumidorFinal && vendorId ? Number(vendorId) : undefined,
      autoAssign: user?.role === 'admin' ? (!paraFilaConsumidorFinal && !vendorId ? autoAssign : false) : true,
      campaignId: campaignId ? Number(campaignId) : undefined,
      status: paraFilaConsumidorFinal ? 'novo_consumidor_final' : undefined,
    })
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title={modoPrint ? 'Novo lead por print do WhatsApp' : 'Criar lead'}
      size="md"
    >
      <form onSubmit={submit} onPaste={aoColar} className="space-y-4">
        <div
          className={`rounded-xl border-2 border-dashed p-3 transition-colors ${arrastando ? 'border-gold-400 bg-gold-500/10' : modoPrint ? 'border-gold-500/60 bg-gold-500/5' : 'border-dark-600 bg-dark-800/60'}`}
          onDragOver={(e) => {
            e.preventDefault()
            setArrastando(true)
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault()
            setArrastando(false)
            adicionarPrints(Array.from(e.dataTransfer.files ?? []))
          }}
        >
          <div className="flex items-start gap-2">
            <Sparkles size={16} className="text-gold-400 mt-0.5 shrink-0" />
            <div className="text-xs text-dark-300">
              <p className="font-medium text-dark-100 text-sm">Lead por print do WhatsApp</p>
              <p className="mt-0.5">
                Aperte <b>Ctrl+V</b> pra colar o print, arraste a imagem aqui ou{' '}
                <button type="button" className="text-gold-400 underline" onClick={() => inputPrintRef.current?.click()}>
                  escolha o arquivo
                </button>
                . Pode mandar vários prints da mesma conversa. Também dá pra colar o texto da conversa no campo abaixo.
              </p>
            </div>
            <input
              ref={inputPrintRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) adicionarPrints(Array.from(e.target.files))
                e.target.value = ''
              }}
            />
          </div>

          {!!prints.length && (
            <div className="flex flex-wrap gap-2 mt-3">
              {prints.map((p) => (
                <div key={p.id} className="relative">
                  <a href={p.url} target="_blank" rel="noreferrer">
                    <img src={p.url} alt="print" className="h-20 w-auto rounded-lg border border-dark-600 object-cover" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(p.url)
                      setPrints((prev) => prev.filter((x) => x.id !== p.id))
                    }}
                    className="absolute -top-1.5 -right-1.5 bg-dark-900 border border-dark-600 rounded-full p-0.5 text-dark-300 hover:text-red-400"
                    title="Tirar este print"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {prints.length < 6 && (
                <button
                  type="button"
                  onClick={() => inputPrintRef.current?.click()}
                  className="h-20 w-14 rounded-lg border border-dashed border-dark-500 text-dark-400 hover:text-dark-200 flex items-center justify-center"
                  title="Adicionar outro print"
                >
                  <ImagePlus size={18} />
                </button>
              )}
            </div>
          )}

          <Button
            type="button"
            className="w-full mt-3"
            onClick={lerComIA}
            loading={lerPrintMut.isPending}
            disabled={!prints.length && !colado.trim()}
          >
            <Sparkles size={15} />
            {lerPrintMut.isPending ? 'Lendo a conversa...' : 'Ler com IA e preencher'}
          </Button>
        </div>

        {avisoTelefone && (
          <div className="flex gap-2 text-xs rounded-lg px-3 py-2 bg-amber-500/10 border border-amber-500/40 text-amber-200">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{avisoTelefone}</span>
          </div>
        )}

        {iguais && (
          <div className="text-xs rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/40 text-red-200 space-y-1">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle size={14} /> Esse telefone já existe no CRM — confira antes de criar outro:
            </p>
            {iguais.leads.map((l) => (
              <p key={`l${l.id}`}>
                • Lead{' '}
                {basePath ? (
                  <Link to={`${basePath}/${l.id}`} target="_blank" className="underline">
                    #{l.id} {l.name}
                  </Link>
                ) : (
                  <b>
                    #{l.id} {l.name}
                  </b>
                )}{' '}
                — {LEAD_STATUS_LABELS[l.status as keyof typeof LEAD_STATUS_LABELS] ?? l.status}
                {l.vendedor ? ` · ${l.vendedor}` : ' · sem vendedor'}
              </p>
            ))}
            {iguais.clientes.map((c) => (
              <p key={`c${c.id}`}>
                • Cliente da carteira <b>{c.razaoSocial}</b>
                {c.vendedor ? ` · ${c.vendedor}` : ''}
              </p>
            ))}
          </div>
        )}

        <Textarea
          label="Cole aqui o contato ou o texto da conversa (opcional)"
          placeholder="Cole um texto com nome/telefone/email — o formulário abaixo tenta preencher sozinho. Pra conversa do WhatsApp, cole e clique em Ler com IA."
          value={colado}
          onChange={(e) => aplicarColado(e.target.value)}
          rows={3}
        />
        <Input label="Nome *" value={name} onChange={(e) => setName(e.target.value)} />
        <div className={`grid gap-2 ${pais === '55' ? 'grid-cols-[130px_100px_1fr]' : pais === 'outro' ? 'grid-cols-[130px_90px_1fr]' : 'grid-cols-[130px_1fr]'}`}>
          <Select
            label="País"
            value={pais}
            onChange={(e) => setPais(e.target.value)}
            options={[...PAISES_TELEFONE.map((p) => ({ value: p.codigo, label: `${p.nome} +${p.codigo}` })), { value: 'outro', label: 'Outro país' }]}
          />
          {pais === '55' && <Input label="DDD *" value={ddd} onChange={(e) => setDdd(e.target.value.replace(/\D/g, ''))} maxLength={2} />}
          {pais === 'outro' && <Input label="Código *" value={codigoOutro} onChange={(e) => setCodigoOutro(e.target.value.replace(/\D/g, ''))} maxLength={4} placeholder="ex: 56" />}
          <Input
            label={pais === '55' ? 'Telefone *' : 'Telefone (sem o código do país) *'}
            value={phone}
            placeholder={pais === '595' ? 'ex: 981 898124' : undefined}
            onChange={(e) => {
              const v = e.target.value
              // Colou o número internacional inteiro ("+595 981 898124"):
              // escolhe o país sozinho e deixa só o resto no campo.
              const t = v.trim()
              if (t.startsWith('+') && !t.startsWith('+55')) {
                const d = t.replace(/\D/g, '')
                const p = PAISES_TELEFONE.find((x) => x.codigo !== '55' && d.startsWith(x.codigo))
                if (p) {
                  setPais(p.codigo)
                  setPhone(d.slice(p.codigo.length))
                  return
                }
              }
              setPhone(v.replace(/\D/g, ''))
            }}
          />
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
        {!!conversa && (
          <Textarea
            label="Conversa (vai pro histórico do lead)"
            value={conversa}
            onChange={(e) => setConversa(e.target.value)}
            rows={4}
          />
        )}
        {!!campanhas?.length && (
          <Select
            label="Campanha (opcional)"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            placeholder="Nenhuma"
            options={campanhas.map((c) => ({ value: c.id, label: c.name }))}
          />
        )}

        <div>
          <label className="text-sm text-dark-200 font-medium block mb-1">Anexos (opcional)</label>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 cursor-pointer">
            <Paperclip size={13} /> Escolher arquivo(s)
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) setArquivos((prev) => [...prev, ...Array.from(e.target.files!)])
                e.target.value = ''
              }}
            />
          </label>
          {!!arquivos.length && (
            <div className="space-y-1 mt-2">
              {arquivos.map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center justify-between text-xs bg-dark-800 border border-dark-600 rounded-lg px-2.5 py-1.5">
                  <span className="text-dark-300 truncate">{f.name}</span>
                  <button type="button" onClick={() => setArquivos((prev) => prev.filter((_, j) => j !== i))} className="text-dark-500 hover:text-red-400 shrink-0 ml-2">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {user?.role === 'admin' && empresaSlug === 'joitec' && (
          <label className="flex items-center gap-2 text-xs text-dark-300 bg-dark-800 border border-dark-600 rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={paraFilaConsumidorFinal}
              onChange={(e) => setParaFilaConsumidorFinal(e.target.checked)}
            />
            Colocar na fila "Novo (Consumidor Final)" — sem vendedor, quem pegar da região fica com o lead
          </label>
        )}

        {user?.role === 'admin' && !paraFilaConsumidorFinal && (
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
          <Button type="submit" className="flex-1" loading={mut.isPending || enviandoAnexos}>
            Criar lead
          </Button>
        </div>
      </form>
    </Modal>
  )
}
