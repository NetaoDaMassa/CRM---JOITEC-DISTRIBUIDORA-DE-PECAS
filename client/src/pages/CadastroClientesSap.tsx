import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { UserRoundPlus, Search, ArrowLeft, Send, Save, Trash2, AlertTriangle, CheckCircle2, Clock, Undo2 } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { Input, Textarea } from '../components/ui/Input'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'

// Cadastro de cliente no CRM → SAP → aprovação do financeiro (João,
// 2026-11-11, "praticamente igual o Inserir Lead do Portal One"). O vendedor
// preenche, Envia (o CRM cria o cliente inativo no SAP) e a Izabelly aprova.

export type Endereco = { cep: string; tipoLogradouro: string; rua: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string }
export type Dados = {
  pessoa: 'juridica' | 'fisica'
  nome: string
  fantasia: string
  cnpj: string
  cpf: string
  ie: string
  ieIsento: boolean
  suframa: string
  regiaoSuframa: string
  grupoTributario: string
  indicadorIE: string
  indicadorConsumidor: string
  grupoCliente: number
  ultimaConsultaSerasa: string
  ddd: string
  telefone: string
  dddCelular: string
  celular: string
  email: string
  site: string
  indicador: string
  observacoes: string
  contatoNome: string
  contatoTelefone: string
  contatoEmail: string
  cobranca: Endereco
  entregaIgual: boolean
  entrega: Endereco
  prazoCodigo: number
  listaPreco: number
}

const ENDERECO_VAZIO: Endereco = { cep: '', tipoLogradouro: 'Rua', rua: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' }
const VAZIO: Dados = {
  pessoa: 'juridica',
  nome: '',
  fantasia: '',
  cnpj: '',
  cpf: '',
  ie: '',
  ieIsento: false,
  suframa: '',
  regiaoSuframa: '0',
  grupoTributario: '',
  indicadorIE: '',
  indicadorConsumidor: '',
  grupoCliente: 100,
  ultimaConsultaSerasa: '',
  ddd: '',
  telefone: '',
  dddCelular: '',
  celular: '',
  email: '',
  site: '',
  indicador: '',
  observacoes: '',
  contatoNome: '',
  contatoTelefone: '',
  contatoEmail: '',
  cobranca: ENDERECO_VAZIO,
  entregaIgual: true,
  entrega: ENDERECO_VAZIO,
  prazoCodigo: -1,
  listaPreco: 1,
}

const so = (s: string) => (s ?? '').replace(/\D/g, '')
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')

// Mesma conta do servidor (lib/sapCadastroCliente.ts → faltando).
function faltando(d: Dados): string[] {
  const f: string[] = []
  if (d.nome.trim().length < 3) f.push('Nome / razão social')
  if (d.pessoa === 'juridica') {
    if (so(d.cnpj).length !== 14) f.push('CNPJ')
    if (!d.ieIsento && !d.ie.trim()) f.push('Inscrição estadual (ou Isento)')
  } else if (so(d.cpf).length !== 11) f.push('CPF')
  if (!d.grupoTributario) f.push('Grupo tributário')
  if (!d.indicadorIE) f.push('Indicador da IE')
  if (!d.indicadorConsumidor) f.push('Indicador de op. consumidor')
  if (!so(d.telefone) && !so(d.celular)) f.push('Telefone ou celular')
  if (!/^\S+@\S+\.\S+$/.test(d.email.trim())) f.push('E-mail')
  const end = (e: Endereco, n: string) => {
    if (so(e.cep).length !== 8) f.push(`CEP (${n})`)
    if (!e.rua.trim()) f.push(`Rua (${n})`)
    if (!e.numero.trim()) f.push(`Número (${n})`)
    if (!e.bairro.trim()) f.push(`Bairro (${n})`)
    if (!e.cidade.trim()) f.push(`Cidade (${n})`)
    if (!UFS.includes(e.uf.trim().toUpperCase())) f.push(`UF (${n})`)
  }
  end(d.cobranca, 'cobrança')
  if (!d.entregaIgual) end(d.entrega, 'entrega')
  return f
}

// Grupo tributário → indicadores (o que a Izabelly corrigia na mão no SAP).
export function indicadoresDoGrupo(grupo: string, ieIsento: boolean): { indicadorIE: string; indicadorConsumidor: string } | null {
  if (['1', '2', '3', '4'].includes(grupo)) return { indicadorIE: ieIsento ? '2' : '1', indicadorConsumidor: '0' }
  if (['5', '6', '7', '8'].includes(grupo)) return { indicadorIE: '9', indicadorConsumidor: '1' }
  return null
}

export const STATUS: Record<string, { l: string; cls: string }> = {
  rascunho: { l: 'Rascunho', cls: 'bg-dark-700 text-dark-300' },
  aguardando: { l: 'Esperando o financeiro', cls: 'bg-amber-900/30 text-amber-300' },
  devolvido: { l: 'Devolvido p/ corrigir', cls: 'bg-red-900/30 text-red-300' },
  aprovado: { l: 'Aprovado', cls: 'bg-green-900/30 text-green-300' },
}

export const dataHora = (s: string | null) =>
  s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export default function CadastroClientesSap() {
  const [params, setParams] = useSearchParams()
  const [aberto, setAberto] = useState<number | 'novo' | null>(null)
  const clienteParam = Number(params.get('cliente')) || null
  useEffect(() => {
    if (clienteParam) setAberto('novo')
  }, [clienteParam])
  const fechar = () => {
    setAberto(null)
    if (clienteParam) setParams({})
  }
  if (aberto != null) return <Editor id={aberto === 'novo' ? null : aberto} clienteId={aberto === 'novo' ? clienteParam : null} onFechar={fechar} onCriado={(id) => setAberto(id)} />
  return <Lista onAbrir={setAberto} />
}

function Lista({ onAbrir }: { onAbrir: (id: number | 'novo') => void }) {
  const { data, isLoading } = trpc.cadastrosClientes.meus.useQuery()
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <UserRoundPlus size={20} className="text-emerald-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Cadastro de clientes (SAP)</h1>
            <p className="text-sm text-dark-400">Cadastre aqui → vai pro SAP → o financeiro confere e aprova → liberado pra vender</p>
          </div>
        </div>
        <Button onClick={() => onAbrir('novo')}>
          <UserRoundPlus size={16} /> Novo cadastro
        </Button>
      </div>
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 overflow-x-auto">
        {isLoading ? (
          <div className="h-32 animate-pulse" />
        ) : !data?.length ? (
          <p className="text-sm text-dark-400">Nenhum cadastro ainda. Clique em "Novo cadastro".</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-xs text-dark-400 text-left">
                <th className="py-2 pr-3 font-medium">Situação</th>
                <th className="py-2 pr-3 font-medium">Cliente</th>
                <th className="py-2 pr-3 font-medium">Código SAP</th>
                <th className="py-2 pr-3 font-medium">Cidade</th>
                <th className="py-2 pr-3 font-medium">Vendedor</th>
                <th className="py-2 font-medium">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-t border-dark-700/70 cursor-pointer hover:bg-dark-700/40 align-top" onClick={() => onAbrir(c.id)}>
                  <td className="py-2 pr-3">
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS[c.status].cls}`}>{STATUS[c.status].l}</span>
                    {c.status === 'devolvido' && c.motivoDevolucao && <p className="text-xs text-red-300 mt-1 max-w-[220px]">{c.motivoDevolucao}</p>}
                    {c.erroSap && c.status !== 'aprovado' && <p className="text-xs text-red-300 mt-1 max-w-[220px] truncate">SAP: {c.erroSap}</p>}
                  </td>
                  <td className="py-2 pr-3 text-dark-100">
                    {c.nome || <span className="text-dark-500">(sem nome)</span>}
                    <span className="block text-xs text-dark-500">{c.documento}</span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-dark-200">{c.cardCode ?? '—'}</td>
                  <td className="py-2 pr-3 text-dark-300">{c.cidade || '—'}</td>
                  <td className="py-2 pr-3 text-dark-300">{c.vendedor}</td>
                  <td className="py-2 text-dark-400 whitespace-nowrap">{dataHora(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const ABAS = [
  { v: 'fiscal', l: 'Informações fiscais' },
  { v: 'geral', l: 'Geral' },
  { v: 'contato', l: 'Contato' },
  { v: 'enderecos', l: 'Endereços' },
  { v: 'pagamento', l: 'Condições de pagamento' },
] as const

function Editor({ id, clienteId, onFechar, onCriado }: { id: number | null; clienteId: number | null; onFechar: () => void; onCriado: (id: number) => void }) {
  const utils = trpc.useUtils()
  const ctx = trpc.cadastrosClientes.contexto.useQuery()
  const existente = trpc.cadastrosClientes.obter.useQuery({ id: id ?? 0 }, { enabled: id != null })
  const doCliente = trpc.cadastrosClientes.doCliente.useQuery({ clienteId: clienteId ?? 0 }, { enabled: id == null && clienteId != null })
  const [d, setD] = useState<Dados>(VAZIO)
  const [carregado, setCarregado] = useState(false)
  const [aba, setAba] = useState<(typeof ABAS)[number]['v']>('fiscal')
  const [enderecoAba, setEnderecoAba] = useState<'cobranca' | 'entrega'>('cobranca')
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'info'; texto: string }[]>([])

  useEffect(() => {
    if (carregado) return
    if (id != null && existente.data) {
      setD({ ...VAZIO, ...(existente.data.dados as Dados) })
      setCarregado(true)
    } else if (id == null && clienteId != null && doCliente.data) {
      if (doCliente.data.cadastroAberto) {
        onCriado(doCliente.data.cadastroAberto)
        return
      }
      const p = doCliente.data.dados as Partial<Dados>
      setD({ ...VAZIO, ...p, cobranca: { ...ENDERECO_VAZIO, ...p.cobranca }, entrega: { ...ENDERECO_VAZIO, ...p.entrega } })
      setCarregado(true)
    } else if (id == null && clienteId == null) setCarregado(true)
  }, [id, clienteId, existente.data, doCliente.data, carregado, onCriado])

  const status = existente.data?.status ?? 'rascunho'
  const travado = status === 'aguardando' || status === 'aprovado'
  const falta = useMemo(() => faltando(d), [d])
  const set = <K extends keyof Dados>(k: K, v: Dados[K]) => setD((x) => ({ ...x, [k]: v }))
  const setEnd = (qual: 'cobranca' | 'entrega', k: keyof Endereco, v: string) => setD((x) => ({ ...x, [qual]: { ...x[qual], [k]: v } }))

  const trocarGrupo = (g: string) =>
    setD((x) => {
      const ind = indicadoresDoGrupo(g, x.ieIsento)
      return { ...x, grupoTributario: g, ...(ind ?? {}), grupoCliente: x.grupoCliente === 100 && ind ? (ind.indicadorConsumidor === '0' ? 117 : 100) : x.grupoCliente }
    })

  const consultar = trpc.cadastrosClientes.consultarDocumento.useMutation({
    onSuccess: (r) => {
      const av: { tipo: 'erro' | 'info'; texto: string }[] = []
      if (r.noSap) av.push({ tipo: 'erro', texto: `Já existe no SAP: ${r.noSap.nome} (${r.noSap.codigo}${r.noSap.tipo === 'lead' ? ', como lead' : ''}${r.noSap.ativo ? '' : ', inativo'}). Não cadastre de novo — peça ao gestor pra trazer em "Clientes do SAP".` })
      if (r.noCrm) av.push({ tipo: r.noCrm.ehSap ? 'erro' : 'info', texto: `Já está no CRM: ${r.noCrm.razaoSocial} (${r.noCrm.codigo})${r.noCrm.vendedor ? ` — carteira de ${r.noCrm.vendedor}` : ''}.${r.noCrm.ehSap ? '' : ' Ao enviar, o código do SAP vai pra esse cadastro.'}` })
      const rec = r.receita
      if (rec) {
        if (rec.situacao && rec.situacao.toUpperCase() !== 'ATIVA') av.push({ tipo: 'erro', texto: `Situação na Receita: ${rec.situacao}` })
        const fone = so(rec.telefone ?? '')
        setD((x) => {
          const grupo = x.grupoTributario || (rec.simples === true ? '2' : rec.simples === false ? '1' : '')
          const ind = grupo && !x.grupoTributario ? indicadoresDoGrupo(grupo, x.ieIsento) : null
          return {
            ...x,
            nome: x.nome || rec.razaoSocial,
            fantasia: x.fantasia || rec.nomeFantasia || '',
            email: x.email || (rec.email ?? '').toLowerCase(),
            ddd: x.ddd || (fone.length >= 10 ? fone.slice(0, 2) : ''),
            telefone: x.telefone || (fone.length >= 10 ? fone.slice(2) : ''),
            grupoTributario: grupo,
            ...(ind ?? {}),
            ...(ind && x.grupoCliente === 100 ? { grupoCliente: 117 } : {}),
            cobranca: {
              ...x.cobranca,
              cep: x.cobranca.cep || rec.cep || '',
              rua: x.cobranca.rua || rec.logradouro || '',
              numero: x.cobranca.numero || rec.numero || '',
              complemento: x.cobranca.complemento || rec.complemento || '',
              bairro: x.cobranca.bairro || rec.bairro || '',
              cidade: x.cobranca.cidade || rec.municipio || '',
              uf: x.cobranca.uf || rec.uf || '',
            },
          }
        })
        av.push({ tipo: 'info', texto: `Dados da Receita preenchidos${rec.simples != null ? ` · ${rec.simples ? 'optante' : 'não optante'} pelo Simples` : ''}. Confira e complete a inscrição estadual.` })
      } else if (d.pessoa === 'juridica') av.push({ tipo: 'info', texto: 'Não consegui ler a Receita agora — preencha na mão.' })
      setAviso(av)
    },
    onError: (e) => toast.error(e.message),
  })

  const salvar = trpc.cadastrosClientes.salvar.useMutation()
  const enviar = trpc.cadastrosClientes.enviar.useMutation()
  const excluir = trpc.cadastrosClientes.excluir.useMutation()

  const gravar = async () => {
    const r = await salvar.mutateAsync({ id: id ?? undefined, clienteId: id == null ? clienteId ?? undefined : undefined, dados: d })
    utils.cadastrosClientes.meus.invalidate()
    return r.id
  }
  const onSalvar = async () => {
    try {
      const novo = await gravar()
      toast.success('Rascunho salvo')
      if (id == null) onCriado(novo)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar')
    }
  }
  const onEnviar = async () => {
    if (falta.length) return toast.error(`Falta: ${falta.slice(0, 4).join(', ')}${falta.length > 4 ? '…' : ''}`)
    try {
      const novo = await gravar()
      const r = await enviar.mutateAsync({ id: novo })
      toast.success(`Enviado! Cliente ${r.cardCode} criado no SAP — esperando o financeiro aprovar.`, { duration: 6000 })
      utils.cadastrosClientes.invalidate()
      if (id == null) onCriado(novo)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao enviar', { duration: 8000 })
      utils.cadastrosClientes.invalidate()
    }
  }
  const onExcluir = async () => {
    if (!id || !confirm('Apagar este rascunho?')) return
    await excluir.mutateAsync({ id })
    utils.cadastrosClientes.meus.invalidate()
    onFechar()
  }

  const op = ctx.data
  const end = enderecoAba === 'cobranca' ? d.cobranca : d.entrega
  const endTravado = travado || (enderecoAba === 'entrega' && d.entregaIgual)

  if (!carregado || !op) return <div className="h-60 animate-pulse bg-dark-800 rounded-2xl" />

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onFechar} className="p-2 rounded-lg hover:bg-dark-800 text-dark-300" aria-label="Voltar">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-dark-100">{id ? d.nome || 'Cadastro' : 'Novo cadastro de cliente'}</h1>
            <p className="text-sm text-dark-400">
              <span className={`text-xs font-semibold rounded-full px-2 py-0.5 mr-2 ${STATUS[status].cls}`}>{STATUS[status].l}</span>
              {existente.data?.cardCode && <span className="font-mono text-dark-200">{existente.data.cardCode}</span>}
              {doCliente.data && <span> · do cliente {doCliente.data.cliente.razaoSocial} ({doCliente.data.cliente.codigo})</span>}
            </p>
          </div>
        </div>
      </div>

      {status === 'devolvido' && existente.data?.motivoDevolucao && (
        <div className="rounded-xl border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-200 flex gap-2">
          <Undo2 size={16} className="shrink-0 mt-0.5" />
          <div>
            <b>O financeiro devolveu:</b> {existente.data.motivoDevolucao}
            <p className="text-xs text-red-300/80 mt-1">Corrija e clique em "Reenviar ao SAP".</p>
          </div>
        </div>
      )}
      {status === 'aguardando' && (
        <div className="rounded-xl border border-amber-800/50 bg-amber-900/20 p-3 text-sm text-amber-200 flex gap-2">
          <Clock size={16} className="shrink-0 mt-0.5" /> Cliente criado no SAP (inativo). Esperando o financeiro conferir e aprovar — você recebe um aviso. Até lá não dá pra enviar cotação/pedido dele ao SAP.
        </div>
      )}
      {status === 'aprovado' && (
        <div className="rounded-xl border border-green-800/50 bg-green-900/20 p-3 text-sm text-green-200 flex gap-2">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> Aprovado — cliente ativo no SAP e na sua carteira. Já pode vender.
        </div>
      )}
      {existente.data?.erroSap && status !== 'aprovado' && (
        <div className="rounded-xl border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-200 flex gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> Último envio: o SAP recusou — {existente.data.erroSap}
        </div>
      )}
      {!op.vendedorTemSap && !travado && (
        <p className="text-xs text-amber-300">Seu usuário ainda não está ligado a um vendedor do SAP — o cadastro vai sem vendedor e o financeiro escolhe no SAP.</p>
      )}

      {/* Cabeçalho */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['juridica', 'fisica'] as const).map((p) => (
            <button
              key={p}
              type="button"
              disabled={travado}
              onClick={() => set('pessoa', p)}
              className={`text-sm rounded-lg px-3 py-1.5 border ${d.pessoa === p ? 'border-gold-600 text-gold-300 bg-gold-900/10' : 'border-dark-600 text-dark-300'}`}
            >
              {p === 'juridica' ? 'Pessoa jurídica (CNPJ)' : 'Pessoa física (CPF)'}
            </button>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              {d.pessoa === 'juridica' ? (
                <Input label="CNPJ *" value={d.cnpj} disabled={travado} onChange={(e) => set('cnpj', e.target.value)} placeholder="00.000.000/0000-00" />
              ) : (
                <Input label="CPF *" value={d.cpf} disabled={travado} onChange={(e) => set('cpf', e.target.value)} placeholder="000.000.000-00" />
              )}
            </div>
            <Button
              variant="outline"
              disabled={travado}
              loading={consultar.isPending}
              onClick={() => consultar.mutate({ pessoa: d.pessoa, documento: d.pessoa === 'juridica' ? d.cnpj : d.cpf })}
            >
              <Search size={15} /> {d.pessoa === 'juridica' ? 'Buscar na Receita' : 'Verificar'}
            </Button>
          </div>
          <Input label="Nome / razão social *" value={d.nome} disabled={travado} onChange={(e) => set('nome', e.target.value)} />
          <Input label="Nome fantasia" value={d.fantasia} disabled={travado} onChange={(e) => set('fantasia', e.target.value)} />
          <Select label="Grupo do cliente" value={d.grupoCliente} disabled={travado} onChange={(e) => set('grupoCliente', Number(e.target.value))} options={op.gruposCliente.map((g) => ({ value: g.v, label: g.l }))} />
          <Input label="Última consulta Serasa" type="date" value={d.ultimaConsultaSerasa} disabled={travado} onChange={(e) => set('ultimaConsultaSerasa', e.target.value)} />
        </div>
        {aviso.map((a, i) => (
          <p key={i} className={`text-sm rounded-lg px-3 py-2 ${a.tipo === 'erro' ? 'bg-red-900/25 text-red-200' : 'bg-dark-900 text-dark-200'}`}>
            {a.texto}
          </p>
        ))}
      </div>

      {/* Abas */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl">
        <div className="flex gap-1 border-b border-dark-700 overflow-x-auto px-2">
          {ABAS.map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setAba(t.v)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${aba === t.v ? 'border-gold-500 text-gold-300' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
            >
              {t.l}
            </button>
          ))}
        </div>
        <div className="p-4">
          {aba === 'fiscal' && (
            <div className="grid md:grid-cols-2 gap-3">
              {d.pessoa === 'juridica' && (
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <Input label="Inscrição estadual *" value={d.ieIsento ? '' : d.ie} disabled={travado || d.ieIsento} onChange={(e) => set('ie', e.target.value)} />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-dark-200 pb-2">
                    <input
                      type="checkbox"
                      className="accent-gold-500"
                      disabled={travado}
                      checked={d.ieIsento}
                      onChange={(e) => {
                        const isento = e.target.checked
                        setD((x) => ({ ...x, ieIsento: isento, ...(indicadoresDoGrupo(x.grupoTributario, isento) ?? {}) }))
                      }}
                    />
                    Isento
                  </label>
                </div>
              )}
              <Select label="Grupo tributário *" value={d.grupoTributario} disabled={travado} placeholder="Escolha…" onChange={(e) => trocarGrupo(e.target.value)} options={op.gruposTributarios.map((g) => ({ value: g.v, label: g.l }))} />
              <Select label="Indicador da IE *" value={d.indicadorIE} disabled={travado} placeholder="Escolha…" onChange={(e) => set('indicadorIE', e.target.value)} options={op.indicadoresIE.map((g) => ({ value: g.v, label: g.l }))} />
              <Select label="Indicador de op. consumidor *" value={d.indicadorConsumidor} disabled={travado} placeholder="Escolha…" onChange={(e) => set('indicadorConsumidor', e.target.value)} options={op.indicadoresConsumidor.map((g) => ({ value: g.v, label: g.l }))} />
              <Input label="SUFRAMA" value={d.suframa} disabled={travado} onChange={(e) => set('suframa', e.target.value)} />
              <Select label="Região SUFRAMA" value={d.regiaoSuframa} disabled={travado} onChange={(e) => set('regiaoSuframa', e.target.value)} options={op.regioesSuframa.map((g) => ({ value: g.v, label: g.l }))} />
              <p className="md:col-span-2 text-xs text-dark-500">
                Ao escolher o grupo tributário, os indicadores são sugeridos (contribuinte → Contribuinte ICMS / Normal; não contribuinte ou pessoa física → Não contribuinte / Consumidor final). Confira.
              </p>
            </div>
          )}
          {aba === 'geral' && (
            <div className="grid md:grid-cols-2 gap-3">
              <div className="flex gap-2">
                <div className="w-20">
                  <Input label="DDD" value={d.ddd} disabled={travado} onChange={(e) => set('ddd', e.target.value)} />
                </div>
                <div className="flex-1">
                  <Input label="Telefone" value={d.telefone} disabled={travado} onChange={(e) => set('telefone', e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <div className="w-20">
                  <Input label="DDD" value={d.dddCelular} disabled={travado} onChange={(e) => set('dddCelular', e.target.value)} />
                </div>
                <div className="flex-1">
                  <Input label="Celular / WhatsApp" value={d.celular} disabled={travado} onChange={(e) => set('celular', e.target.value)} />
                </div>
              </div>
              <Input label="E-mail *" type="email" value={d.email} disabled={travado} onChange={(e) => set('email', e.target.value)} />
              <Input label="Site" value={d.site} disabled={travado} onChange={(e) => set('site', e.target.value)} />
              <Select label="Indicador (como chegou)" value={d.indicador} disabled={travado} onChange={(e) => set('indicador', e.target.value)} options={op.indicadores.map((g) => ({ value: g.v, label: g.l }))} />
              <div className="md:col-span-2">
                <Textarea label="Observações" rows={2} value={d.observacoes} disabled={travado} onChange={(e) => set('observacoes', e.target.value)} />
              </div>
            </div>
          )}
          {aba === 'contato' && (
            <div className="grid md:grid-cols-3 gap-3">
              <Input label="Nome do contato" value={d.contatoNome} disabled={travado} onChange={(e) => set('contatoNome', e.target.value)} placeholder="Ex.: COMPRAS, João" />
              <Input label="Telefone do contato" value={d.contatoTelefone} disabled={travado} onChange={(e) => set('contatoTelefone', e.target.value)} />
              <Input label="E-mail do contato" value={d.contatoEmail} disabled={travado} onChange={(e) => set('contatoEmail', e.target.value)} />
            </div>
          )}
          {aba === 'enderecos' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {(['cobranca', 'entrega'] as const).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setEnderecoAba(q)}
                    className={`text-sm rounded-lg px-3 py-1.5 border ${enderecoAba === q ? 'border-gold-600 text-gold-300 bg-gold-900/10' : 'border-dark-600 text-dark-300'}`}
                  >
                    {q === 'cobranca' ? 'Cobrança' : 'Entrega'}
                  </button>
                ))}
                {enderecoAba === 'entrega' && (
                  <label className="flex items-center gap-2 text-sm text-dark-200 ml-2">
                    <input type="checkbox" className="accent-gold-500" disabled={travado} checked={d.entregaIgual} onChange={(e) => setD((x) => ({ ...x, entregaIgual: e.target.checked, entrega: e.target.checked ? x.entrega : { ...x.cobranca } }))} />
                    Mesmo endereço da cobrança
                  </label>
                )}
              </div>
              {enderecoAba === 'entrega' && d.entregaIgual ? (
                <p className="text-sm text-dark-400">A entrega vai no mesmo endereço da cobrança.</p>
              ) : (
                <div className="grid md:grid-cols-3 gap-3">
                  <Input label="CEP *" value={end.cep} disabled={endTravado} onChange={(e) => setEnd(enderecoAba, 'cep', e.target.value)} />
                  <Input label="Tipo de logradouro" value={end.tipoLogradouro} disabled={endTravado} onChange={(e) => setEnd(enderecoAba, 'tipoLogradouro', e.target.value)} placeholder="Rua, Avenida…" />
                  <Input label="Rua / endereço *" value={end.rua} disabled={endTravado} onChange={(e) => setEnd(enderecoAba, 'rua', e.target.value)} />
                  <Input label="Número * (SN se não tiver)" value={end.numero} disabled={endTravado} onChange={(e) => setEnd(enderecoAba, 'numero', e.target.value)} />
                  <Input label="Complemento" value={end.complemento} disabled={endTravado} onChange={(e) => setEnd(enderecoAba, 'complemento', e.target.value)} />
                  <Input label="Bairro *" value={end.bairro} disabled={endTravado} onChange={(e) => setEnd(enderecoAba, 'bairro', e.target.value)} />
                  <Input label="Cidade *" value={end.cidade} disabled={endTravado} onChange={(e) => setEnd(enderecoAba, 'cidade', e.target.value)} />
                  <Select label="UF *" value={end.uf.toUpperCase()} disabled={endTravado} placeholder="UF" onChange={(e) => setEnd(enderecoAba, 'uf', e.target.value)} options={UFS.map((u) => ({ value: u, label: u }))} />
                </div>
              )}
            </div>
          )}
          {aba === 'pagamento' && (
            <div className="grid md:grid-cols-2 gap-3">
              <Select label="Condição de pagamento *" value={d.prazoCodigo} disabled={travado} onChange={(e) => set('prazoCodigo', Number(e.target.value))} options={op.prazos.map((p) => ({ value: p.v, label: p.l }))} />
              <Select label="Lista de preço *" value={d.listaPreco} disabled={travado} onChange={(e) => set('listaPreco', Number(e.target.value))} options={op.listas.map((p) => ({ value: p.v, label: p.l }))} />
              <div className="md:col-span-2 text-xs text-dark-400">
                Formas de pagamento que vão no cadastro: {op.formas.map((f) => f.nome).join(' · ') || '—'}. Na aprovação o financeiro libera todas. Limite de crédito é o financeiro que define.
              </div>
            </div>
          )}
        </div>
      </div>

      {!travado && falta.length > 0 && (
        <p className="text-xs text-amber-300">
          Falta para enviar: {falta.join(' · ')}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!travado && (
          <>
            <Button onClick={onEnviar} loading={enviar.isPending} disabled={salvar.isPending}>
              <Send size={15} /> {status === 'devolvido' ? 'Reenviar ao SAP' : 'Enviar ao SAP'}
            </Button>
            <Button variant="secondary" onClick={onSalvar} loading={salvar.isPending && !enviar.isPending}>
              <Save size={15} /> Salvar rascunho
            </Button>
          </>
        )}
        {id && status === 'rascunho' && !existente.data?.cardCode && (
          <Button variant="danger" onClick={onExcluir}>
            <Trash2 size={15} /> Apagar
          </Button>
        )}
        <Button variant="ghost" onClick={onFechar}>
          Voltar
        </Button>
      </div>

      {existente.data?.historico?.length ? (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-200 mb-2">Histórico</h2>
          <ul className="space-y-1 text-xs text-dark-300">
            {[...existente.data.historico].reverse().map((h, i) => (
              <li key={i}>
                <span className="text-dark-500">{dataHora(h.em)}</span> · <b className="text-dark-100">{h.por}</b> — {h.acao}
                {h.detalhe ? <span className="text-dark-400"> · {h.detalhe}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
