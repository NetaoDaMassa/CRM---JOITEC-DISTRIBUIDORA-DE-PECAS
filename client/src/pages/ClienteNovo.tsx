import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'

const REGIOES = [
  { value: 'norte', label: 'Norte' },
  { value: 'nordeste', label: 'Nordeste' },
  { value: 'centro_oeste', label: 'Centro-Oeste' },
  { value: 'sudeste', label: 'Sudeste' },
  { value: 'sul', label: 'Sul' },
]

export default function ClienteNovo() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'
  const utils = trpc.useUtils()

  const [razaoSocial, setRazaoSocial] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [codigo, setCodigo] = useState('')
  const [inscricaoEstadual, setInscricaoEstadual] = useState('')
  const [regiao, setRegiao] = useState('')
  const [estado, setEstado] = useState('')
  const [cidade, setCidade] = useState('')
  const [telefoneWhatsapp, setTelefoneWhatsapp] = useState('')
  const [telefonesExtras, setTelefonesExtras] = useState<{ numero: string; rotulo: string }[]>([])
  const [email, setEmail] = useState('')
  const [vendedorAtualId, setVendedorAtualId] = useState('')

  const { data: vendors } = trpc.users.vendors.useQuery(undefined, { enabled: user?.role === 'admin' })

  const [buscandoCnpj, setBuscandoCnpj] = useState(false)

  async function buscarCnpj() {
    const digitos = cnpj.replace(/\D/g, '')
    if (digitos.length !== 14) return toast.error('Digite os 14 dígitos do CNPJ antes de buscar.')
    setBuscandoCnpj(true)
    try {
      const dados = await utils.clientes.cnpjLookup.fetch({ cnpj: digitos })
      if (!dados) return toast.error('Não foi possível consultar este CNPJ agora. Preencha manualmente.')
      setRazaoSocial(dados.razaoSocial)
      setEstado(dados.estado)
      setCidade(dados.cidade)
      if (dados.regiao) setRegiao(dados.regiao)
      toast.success('Dados preenchidos a partir da Receita Federal.')
    } catch (err: any) {
      toast.error(err.message ?? 'Falha na consulta.')
    } finally {
      setBuscandoCnpj(false)
    }
  }

  const adicionarTelefoneMut = trpc.telefones.adicionar.useMutation()

  const createMut = trpc.clientes.create.useMutation({
    async onSuccess(data) {
      const validos = telefonesExtras.filter((t) => t.numero.trim())
      if (validos.length) {
        await Promise.all(
          validos.map((t) => adicionarTelefoneMut.mutateAsync({ clienteId: data.id, numero: t.numero.trim(), rotulo: t.rotulo.trim() || undefined }))
        )
      }
      toast.success('Cliente cadastrado')
      navigate(`${basePath}/clientes/${data.id}`)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!regiao) return toast.error('Selecione a região.')
    createMut.mutate({
      razaoSocial,
      cnpj,
      codigo: codigo || undefined,
      inscricaoEstadual: inscricaoEstadual || undefined,
      regiao: regiao as any,
      estado: estado || undefined,
      cidade: cidade || undefined,
      telefoneWhatsapp: telefoneWhatsapp || undefined,
      email: email || undefined,
      vendedorAtualId: vendedorAtualId ? Number(vendedorAtualId) : undefined,
    })
  }

  return (
    <div className="p-6 max-w-xl space-y-4">
      <h1 className="font-heading text-xl text-dark-50">Novo cliente</h1>
      <form onSubmit={handleSubmit} className="space-y-4 bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <div className="flex gap-2 items-end">
          <Input label="CNPJ (opcional)" value={cnpj} onChange={(e) => setCnpj(e.target.value)} className="flex-1" />
          <Button type="button" variant="secondary" onClick={buscarCnpj} loading={buscandoCnpj}>
            Buscar CNPJ
          </Button>
        </div>
        <Input label="Razão social" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Código (opcional)" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          <Input label="Inscrição Estadual (opcional)" value={inscricaoEstadual} onChange={(e) => setInscricaoEstadual(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Select label="Região" value={regiao} onChange={(e) => setRegiao(e.target.value)} placeholder="Selecione..." options={REGIOES} />
          <Input label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)} />
          <Input label="Cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="WhatsApp" value={telefoneWhatsapp} onChange={(e) => setTelefoneWhatsapp(e.target.value)} />
          <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-dark-200 font-medium">Outros telefones (opcional)</label>
          {telefonesExtras.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5 items-center">
              <Input
                placeholder="Número"
                value={t.numero}
                onChange={(e) => setTelefonesExtras(telefonesExtras.map((item, idx) => (idx === i ? { ...item, numero: e.target.value } : item)))}
              />
              <Input
                placeholder="Rótulo (opcional)"
                value={t.rotulo}
                onChange={(e) => setTelefonesExtras(telefonesExtras.map((item, idx) => (idx === i ? { ...item, rotulo: e.target.value } : item)))}
              />
              <button
                type="button"
                onClick={() => setTelefonesExtras(telefonesExtras.filter((_, idx) => idx !== i))}
                className="text-red-400 hover:text-red-300 text-xs"
              >
                Remover
              </button>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => setTelefonesExtras([...telefonesExtras, { numero: '', rotulo: '' }])}>
            + Adicionar telefone
          </Button>
        </div>
        {user?.role === 'admin' && (
          <Select
            label="Vendedor responsável (opcional)"
            value={vendedorAtualId}
            onChange={(e) => setVendedorAtualId(e.target.value)}
            placeholder="Sem vendedor"
            options={(vendors ?? []).map((v) => ({ value: v.id, label: v.name }))}
          />
        )}
        <Button type="submit" loading={createMut.isPending} className="w-full">
          Cadastrar
        </Button>
      </form>
    </div>
  )
}
