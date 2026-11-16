import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { UserRoundPlus, Search, ArrowLeft, Send, Save, Trash2, AlertTriangle, CheckCircle2, Clock, Undo2, Plus, X, Lock, ExternalLink, MessageSquareText, Copy, BarChart3, Download } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { Input, Textarea } from '../components/ui/Input'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'
import { usePersistedState } from '../lib/usePersistedState'
import { baixarCsv, paraCsv } from '../lib/csv'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'

type RouterOutputs = inferRouterOutputs<AppRouter>

// Cadastro de cliente no CRM → SAP → aprovação do financeiro (João,
// 2026-11-11, "praticamente igual o Inserir Lead do Portal One"). O vendedor
// preenche, Envia (o CRM cria o cliente inativo no SAP) e a Izabelly aprova.

export type Contato = { nome: string; cargo: string; telefone: string; celular: string; email: string }
export const CONTATO_VAZIO: Contato = { nome: '', cargo: '', telefone: '', celular: '', email: '' }
export type Anexo = { nome: string; arquivo: string; tipo: string | null }
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
  contatos: Contato[]
  respComercial: number | null
  usoPrincipal: number
  limiteCredito: number
  segmento: number | null
  territorio: number | null
  formasPagamento: string[] | null
  filiais: number[]
  emailFinanceiro: string
  contatoFinanceiro: string
  dddFinanceiro: string
  telefoneFinanceiro: string
  anexos: Anexo[]
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
  contatos: [],
  respComercial: null,
  usoPrincipal: 10,
  limiteCredito: 0,
  segmento: null,
  territorio: null,
  formasPagamento: null,
  filiais: [],
  emailFinanceiro: '',
  contatoFinanceiro: '',
  dddFinanceiro: '',
  telefoneFinanceiro: '',
  anexos: [],
  cobranca: ENDERECO_VAZIO,
  entregaIgual: true,
  entrega: ENDERECO_VAZIO,
  prazoCodigo: -1,
  listaPreco: 1,
}

const so = (s: string) => (s ?? '').replace(/\D/g, '')
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')

// Mesma conta do servidor (lib/sapCadastroCliente.ts → faltando).
function faltando(d: Dados, regrasNovas = true): string[] {
  const f: string[] = []
  if (d.nome.trim().length < 3) f.push('Nome / razão social')
  if (d.pessoa === 'juridica') {
    if (so(d.cnpj).length !== 14) f.push('CNPJ')
    if (!d.ieIsento && !d.ie.trim()) f.push('Inscrição estadual (ou Isento)')
  } else if (so(d.cpf).length !== 11) f.push('CPF')
  if (!d.grupoTributario) f.push('Grupo tributário')
  if (!d.indicadorIE) f.push('Indicador da IE')
  if (!d.indicadorConsumidor) f.push('Indicador de op. consumidor')
  if (regrasNovas) {
    if (so(d.dddCelular).length !== 2 || so(d.celular).length < 8) f.push('Celular (com DDD)')
  } else if (!so(d.telefone ?? '') && !so(d.celular)) f.push('Telefone ou celular')
  if (!/^\S+@\S+\.\S+$/.test(d.email.trim())) f.push('E-mail')
  if (regrasNovas && !/^\S+@\S+\.\S+$/.test((d.emailFinanceiro ?? '').trim())) f.push('E-mail do financeiro')
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
  if (!d.filiais.length) f.push('Filial (aba Geral)')
  if (d.formasPagamento && !d.formasPagamento.length) f.push('Forma de pagamento (aba Execução do pagamento)')
  return f
}

// Cadastros antigos tinham um contato só (contatoNome/…).
export function contatosDe(d: Pick<Dados, 'contatos' | 'contatoNome' | 'contatoTelefone' | 'contatoEmail'>): Contato[] {
  if (d.contatos?.length) return d.contatos
  return d.contatoNome?.trim() ? [{ ...CONTATO_VAZIO, nome: d.contatoNome, telefone: d.contatoTelefone, email: d.contatoEmail }] : []
}

// Grupo tributário → indicadores (o que a Izabelly corrigia na mão no SAP).
export function indicadoresDoGrupo(grupo: string, ieIsento: boolean): { indicadorIE: string; indicadorConsumidor: string } | null {
  if (['1', '2', '3', '4'].includes(grupo)) return { indicadorIE: ieIsento ? '2' : '1', indicadorConsumidor: '0' }
  if (['5', '6', '7', '8'].includes(grupo)) return { indicadorIE: '9', indicadorConsumidor: '1' }
  return null
}

// Cliente isento (Izabelly, 2026-11-13) — mesma regra do servidor
// (lib/sapCadastroCliente.ts → aplicarRegrasIsento).
const USO_CONSUMO = 21
const GRUPO_CLIENTE_ISENTO = 118
const listaIsentoDe = (listas: { v: number; l: string }[]) => listas.find((x) => /isent/i.test(x.l))?.v ?? null
function comRegrasIsento(d: Dados, listaIsento: number | null): Dados {
  if (d.pessoa !== 'juridica' || !d.ieIsento) return d
  return { ...d, indicadorIE: '9', indicadorConsumidor: '1', usoPrincipal: USO_CONSUMO, grupoCliente: GRUPO_CLIENTE_ISENTO, ...(listaIsento ? { listaPreco: listaIsento } : {}) }
}

// Sites pra pesquisar o cliente (o CNPJ vai copiado pra colar lá).
const SITES = [
  { nome: 'Receita Federal', url: 'https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp', cor: 'bg-[#1351b4]' },
  { nome: 'Sintegra', url: 'http://www.sintegra.gov.br/', cor: 'bg-[#2e7d32]' },
  { nome: 'CCC (IE de todos os estados)', url: 'https://dfe-portal.svrs.rs.gov.br/NFE/CCC', cor: 'bg-[#00695c]' },
  { nome: 'Simples Nacional', url: 'https://consopt.www8.receita.fazenda.gov.br/consultaoptantes', cor: 'bg-[#6a1b9a]' },
]

// Mensagem pro vendedor mandar ao cliente preencher os dados obrigatórios.
function textoParaCliente(d: Dados) {
  return [
    'Olá! Para fazermos o seu cadastro, por favor nos envie:',
    '',
    `• Razão social: ${d.nome || ''}`,
    `• CNPJ/CPF: ${(d.pessoa === 'juridica' ? d.cnpj : d.cpf) || ''}`,
    '• Inscrição estadual (ou se é isento):',
    '• Grupo Tributário:',
    '• Endereço completo com CEP:',
    '• Celular / WhatsApp do Financeiro:',
    '• E-mail:',
    '• E-mail do financeiro (obrigatório — é para onde vão os boletos e notas):',
    '',
    'Obrigado!',
  ].join('\n')
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

// ── Lista + filtros + relatórios (João, 2026-11-16: "deixar prontos
// relatórios, e filtros ali, por vendedor e etc"). Tudo calculado em cima de
// cadastrosClientes.analise (uma linha por cadastro, já respeitando quem vê o
// quê). A data de referência é o 1º envio ao SAP (rascunho: quando começou).
type LinhaAnalise = RouterOutputs['cadastrosClientes']['analise'][number]
type Filtros = { busca: string; vendedor: string; status: string; de: string; ate: string; fiscal: '' | 'isento' | 'contribuinte' }
const FILTROS_VAZIOS: Filtros = { busca: '', vendedor: '', status: '', de: '', ate: '', fiscal: '' }

// "2026-11-13 18:27:17" (UTC) → "2026-11-13" no horário de Brasília.
const diaBr = (s: string | null) => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : '')
const dataRef = (c: LinhaAnalise) => diaBr(c.primeiroEnvioEm ?? c.criadoEm)
const horasEntre = (a: string, b: string) => (new Date(`${b.replace(' ', 'T')}Z`).getTime() - new Date(`${a.replace(' ', 'T')}Z`).getTime()) / 36e5
const tempoTxt = (h: number | null) => (h == null ? '—' : h < 24 ? `${Math.max(0, Math.round(h))} h` : `${(h / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`)
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
const nomeMes = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
const ultimoDiaMes = (m: string) => {
  const [a, mm] = m.split('-').map(Number)
  return `${m}-${String(new Date(a, mm, 0).getDate()).padStart(2, '0')}`
}
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function aplicarFiltros(ls: LinhaAnalise[], f: Filtros) {
  const q = normal(f.busca.trim())
  const qDig = f.busca.replace(/\D/g, '')
  return ls.filter((c) => {
    if (f.vendedor && String(c.vendedorId ?? '') !== f.vendedor) return false
    if (f.status && c.status !== f.status) return false
    if (f.fiscal === 'isento' && !c.ieIsento) return false
    if (f.fiscal === 'contribuinte' && c.ieIsento) return false
    const d = dataRef(c)
    if (f.de && d < f.de) return false
    if (f.ate && d > f.ate) return false
    if (q) {
      const alvo = normal(`${c.nome} ${c.cardCode ?? ''} ${c.cidade} ${c.vendedor}`)
      if (!alvo.includes(q) && !(qDig.length >= 3 && (c.documento ?? '').replace(/\D/g, '').includes(qDig))) return false
    }
    return true
  })
}

function Lista({ onAbrir }: { onAbrir: (id: number | 'novo') => void }) {
  const { data, isLoading } = trpc.cadastrosClientes.analise.useQuery()
  const [aba, setAba] = usePersistedState<'lista' | 'relatorios'>('cadastroSap.aba', 'lista')
  const [f, setF] = usePersistedState<Filtros>('cadastroSap.filtros', FILTROS_VAZIOS)
  const todos = data ?? []
  const filtrados = useMemo(() => aplicarFiltros(todos, f), [todos, f])
  const vendedores = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of todos) if (c.vendedorId != null) m.set(c.vendedorId, c.vendedor)
    return [...m].map(([v, l]) => ({ value: String(v), label: l })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  }, [todos])
  const temFiltro = JSON.stringify(f) !== JSON.stringify(FILTROS_VAZIOS)
  const mudar = (p: Partial<Filtros>) => setF({ ...f, ...p })
  // Clique numa linha de relatório → filtra e mostra a lista.
  const verNaLista = (p: Partial<Filtros>) => {
    setF({ ...f, ...p })
    setAba('lista')
  }
  const exportarLista = () =>
    baixarCsv(
      `cadastros-clientes-${new Date().toISOString().slice(0, 10)}.csv`,
      paraCsv(
        [
          { chave: 'situacao', rotulo: 'Situação' },
          { chave: 'nome', rotulo: 'Cliente' },
          { chave: 'documento', rotulo: 'CNPJ/CPF' },
          { chave: 'fiscal', rotulo: 'Fiscal' },
          { chave: 'cardCode', rotulo: 'Código SAP' },
          { chave: 'cidade', rotulo: 'Cidade' },
          { chave: 'vendedor', rotulo: 'Vendedor' },
          { chave: 'enviado', rotulo: '1º envio' },
          { chave: 'aprovado', rotulo: 'Aprovado em' },
          { chave: 'tempo', rotulo: 'Tempo até aprovar' },
          { chave: 'devolucoes', rotulo: 'Vezes devolvido' },
          { chave: 'motivo', rotulo: 'Último motivo de devolução' },
          { chave: 'vendas', rotulo: 'Vendas depois do cadastro' },
          { chave: 'valor', rotulo: 'Valor vendido depois' },
        ],
        filtrados.map((c) => ({
          situacao: STATUS[c.status]?.l ?? c.status,
          nome: c.nome,
          documento: c.documento,
          fiscal: c.ieIsento ? 'Isento' : 'Contribuinte',
          cardCode: c.cardCode ?? '',
          cidade: c.cidade,
          vendedor: c.vendedor,
          enviado: c.primeiroEnvioEm ? dataHora(c.primeiroEnvioEm) : '',
          aprovado: c.aprovadoEm ? dataHora(c.aprovadoEm) : '',
          tempo: c.aprovadoEm && c.primeiroEnvioEm ? tempoTxt(horasEntre(c.primeiroEnvioEm, c.aprovadoEm)) : '',
          devolucoes: c.devolucoes.length,
          motivo: c.devolucoes.at(-1)?.motivo ?? '',
          vendas: c.vendasDepois,
          valor: c.valorDepois.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        }))
      )
    )

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

      <div className="flex gap-1 border-b border-dark-600 overflow-x-auto">
        {[
          { v: 'lista' as const, l: 'Cadastros', icon: <UserRoundPlus size={15} /> },
          { v: 'relatorios' as const, l: 'Relatórios', icon: <BarChart3 size={15} /> },
        ].map((t) => (
          <button
            key={t.v}
            onClick={() => setAba(t.v)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${aba === t.v ? 'border-gold-500 text-gold-300' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
          >
            {t.icon} {t.l}
          </button>
        ))}
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div className="lg:col-span-2">
            <Input label="Buscar" icon={<Search size={15} />} placeholder="Cliente, CNPJ/CPF, código SAP, cidade…" value={f.busca} onChange={(e) => mudar({ busca: e.target.value })} />
          </div>
          {vendedores.length > 1 && <Select label="Vendedor" placeholder="Todos" value={f.vendedor} onChange={(e) => mudar({ vendedor: e.target.value })} options={vendedores} />}
          <Select label="Situação" placeholder="Todas" value={f.status} onChange={(e) => mudar({ status: e.target.value })} options={Object.entries(STATUS).map(([v, s]) => ({ value: v, label: s.l }))} />
          <Select
            label="Fiscal"
            placeholder="Isentos e contribuintes"
            value={f.fiscal}
            onChange={(e) => mudar({ fiscal: e.target.value as Filtros['fiscal'] })}
            options={[
              { value: 'isento', label: 'Só isentos' },
              { value: 'contribuinte', label: 'Só contribuintes' },
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input label="De" type="date" value={f.de} onChange={(e) => mudar({ de: e.target.value })} />
            <Input label="Até" type="date" value={f.ate} onChange={(e) => mudar({ ate: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-dark-400">
          <span>
            {filtrados.length} de {todos.length} cadastro(s) · período pela data do 1º envio ao SAP
          </span>
          <div className="flex gap-2">
            {temFiltro && (
              <Button size="sm" variant="ghost" onClick={() => setF(FILTROS_VAZIOS)}>
                <X size={14} /> Limpar filtros
              </Button>
            )}
            {aba === 'lista' && (
              <Button size="sm" variant="outline" onClick={exportarLista} disabled={!filtrados.length}>
                <Download size={14} /> Exportar Excel (CSV)
              </Button>
            )}
          </div>
        </div>
      </div>

      {aba === 'relatorios' ? (
        <RelatoriosCadastros linhas={filtrados} verNaLista={verNaLista} />
      ) : (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 overflow-x-auto">
          {isLoading ? (
            <div className="h-32 animate-pulse" />
          ) : !todos.length ? (
            <p className="text-sm text-dark-400">Nenhum cadastro ainda. Clique em "Novo cadastro".</p>
          ) : !filtrados.length ? (
            <p className="text-sm text-dark-400">Nenhum cadastro com esses filtros.</p>
          ) : (
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-xs text-dark-400 text-left">
                  <th className="py-2 pr-3 font-medium">Situação</th>
                  <th className="py-2 pr-3 font-medium">Cliente</th>
                  <th className="py-2 pr-3 font-medium">Código SAP</th>
                  <th className="py-2 pr-3 font-medium">Cidade</th>
                  <th className="py-2 pr-3 font-medium">Vendedor</th>
                  <th className="py-2 pr-3 font-medium">Enviado</th>
                  <th className="py-2 font-medium">Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((c) => (
                  <tr key={c.id} className="border-t border-dark-700/70 cursor-pointer hover:bg-dark-700/40 align-top" onClick={() => onAbrir(c.id)}>
                    <td className="py-2 pr-3">
                      <span className={`text-xs font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS[c.status].cls}`}>{STATUS[c.status].l}</span>
                      {c.status === 'devolvido' && c.motivoDevolucao && <p className="text-xs text-red-300 mt-1 max-w-[220px]">{c.motivoDevolucao}</p>}
                      {c.erroSap && c.status !== 'aprovado' && <p className="text-xs text-red-300 mt-1 max-w-[220px] truncate">SAP: {c.erroSap}</p>}
                    </td>
                    <td className="py-2 pr-3 text-dark-100">
                      {c.nome || <span className="text-dark-500">(sem nome)</span>}
                      <span className="block text-xs text-dark-500">
                        {c.documento}
                        {c.ieIsento && <span className="ml-1.5 rounded bg-sky-900/30 text-sky-300 px-1">isento</span>}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-dark-200">{c.cardCode ?? '—'}</td>
                    <td className="py-2 pr-3 text-dark-300">{c.cidade || '—'}</td>
                    <td className="py-2 pr-3 text-dark-300">{c.vendedor}</td>
                    <td className="py-2 pr-3 text-dark-400 whitespace-nowrap">{c.primeiroEnvioEm ? dataHora(c.primeiroEnvioEm) : '—'}</td>
                    <td className="py-2 text-dark-400 whitespace-nowrap">{dataHora(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// Contagens de um grupo de cadastros (rascunho fica fora: ainda não foi pro SAP).
function contar(ls: LinhaAnalise[]) {
  const env = ls.filter((c) => c.status !== 'rascunho')
  const aprov = env.filter((c) => c.status === 'aprovado')
  const tempos = aprov.filter((c) => c.aprovadoEm && c.primeiroEnvioEm).map((c) => horasEntre(c.primeiroEnvioEm!, c.aprovadoEm!))
  return {
    rascunhos: ls.length - env.length,
    enviados: env.length,
    aprovados: aprov.length,
    aguardando: env.filter((c) => c.status === 'aguardando').length,
    aCorrigir: env.filter((c) => c.status === 'devolvido').length,
    jaDevolvidos: env.filter((c) => c.devolucoes.length > 0).length,
    comVenda: env.filter((c) => c.vendasDepois > 0).length,
    valor: env.reduce((s, c) => s + c.valorDepois, 0),
    tempoMedio: tempos.length ? tempos.reduce((s, t) => s + t, 0) / tempos.length : null,
  }
}
type Contagem = ReturnType<typeof contar>

const COLUNAS_CONTAGEM: { chave: keyof Contagem; rotulo: string }[] = [
  { chave: 'enviados', rotulo: 'Enviados' },
  { chave: 'aprovados', rotulo: 'Aprovados' },
  { chave: 'aguardando', rotulo: 'Esperando' },
  { chave: 'aCorrigir', rotulo: 'A corrigir' },
  { chave: 'jaDevolvidos', rotulo: 'Já devolvidos' },
  { chave: 'comVenda', rotulo: 'Com venda depois' },
  { chave: 'valor', rotulo: 'Vendido depois' },
  { chave: 'tempoMedio', rotulo: 'Tempo médio até aprovar' },
  { chave: 'rascunhos', rotulo: 'Rascunhos' },
]

const csvContagem = (nome: string, rotuloGrupo: string, grupos: { grupo: string; c: Contagem }[]) =>
  baixarCsv(
    `${nome}-${new Date().toISOString().slice(0, 10)}.csv`,
    paraCsv<Record<string, unknown>>(
      [{ chave: 'grupo', rotulo: rotuloGrupo }, ...COLUNAS_CONTAGEM.map((k) => ({ chave: k.chave as string, rotulo: k.rotulo })), { chave: 'pctVenda', rotulo: '% com venda' }],
      grupos.map(({ grupo, c }): Record<string, unknown> => ({
        grupo,
        ...c,
        valor: c.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        tempoMedio: tempoTxt(c.tempoMedio),
        pctVenda: pct(c.comVenda, c.enviados),
      }))
    )
  )

function Bloco({ titulo, sub, onExportar, children }: { titulo: string; sub?: string; onExportar?: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-dark-100">
            <BarChart3 size={16} className="text-gold-400" /> {titulo}
          </p>
          {sub && <p className="text-xs text-dark-400 mt-0.5">{sub}</p>}
        </div>
        {onExportar && (
          <Button size="sm" variant="outline" onClick={onExportar}>
            <Download size={14} /> Excel (CSV)
          </Button>
        )}
      </div>
      {children}
    </div>
  )
}

// Tabela de contagens: uma linha por grupo, clique filtra a lista.
function TabelaContagem({ rotulo, grupos, onClicar }: { rotulo: string; grupos: { grupo: string; c: Contagem; filtro: Partial<Filtros> }[]; onClicar: (f: Partial<Filtros>) => void }) {
  if (!grupos.length) return <p className="text-sm text-dark-400">Nada no período/filtros.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="text-xs text-dark-400 text-left">
            <th className="py-1.5 pr-3 font-medium">{rotulo}</th>
            <th className="py-1.5 pr-3 font-medium text-right">Enviados</th>
            <th className="py-1.5 pr-3 font-medium text-right">Aprovados</th>
            <th className="py-1.5 pr-3 font-medium text-right">Esperando</th>
            <th className="py-1.5 pr-3 font-medium text-right">A corrigir</th>
            <th className="py-1.5 pr-3 font-medium text-right" title="Cadastros que o financeiro devolveu pelo menos 1 vez">
              Já devolvidos
            </th>
            <th className="py-1.5 pr-3 font-medium text-right" title="Cliente comprou depois do 1º envio do cadastro">
              Com venda
            </th>
            <th className="py-1.5 pr-3 font-medium text-right">Vendido</th>
            <th className="py-1.5 pr-3 font-medium text-right" title="Do 1º envio ao SAP até a aprovação (horas corridas)">
              Tempo p/ aprovar
            </th>
            <th className="py-1.5 font-medium text-right">Rascunhos</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map(({ grupo, c, filtro }) => (
            <tr key={grupo} className="border-t border-dark-700/70 cursor-pointer hover:bg-dark-700/40" onClick={() => onClicar(filtro)} title="Ver esses cadastros na lista">
              <td className="py-1.5 pr-3 text-dark-100">{grupo}</td>
              <td className="py-1.5 pr-3 text-right text-dark-100 font-semibold">{c.enviados}</td>
              <td className="py-1.5 pr-3 text-right text-green-300">{c.aprovados}</td>
              <td className="py-1.5 pr-3 text-right text-amber-300">{c.aguardando}</td>
              <td className="py-1.5 pr-3 text-right text-red-300">{c.aCorrigir}</td>
              <td className="py-1.5 pr-3 text-right text-dark-300">
                {c.jaDevolvidos} <span className="text-dark-500">({pct(c.jaDevolvidos, c.enviados)})</span>
              </td>
              <td className="py-1.5 pr-3 text-right text-dark-300">
                {c.comVenda} <span className="text-dark-500">({pct(c.comVenda, c.enviados)})</span>
              </td>
              <td className="py-1.5 pr-3 text-right text-dark-300 whitespace-nowrap">{brl(c.valor)}</td>
              <td className="py-1.5 pr-3 text-right text-dark-300 whitespace-nowrap">{tempoTxt(c.tempoMedio)}</td>
              <td className="py-1.5 text-right text-dark-500">{c.rascunhos}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RelatoriosCadastros({ linhas, verNaLista }: { linhas: LinhaAnalise[]; verNaLista: (f: Partial<Filtros>) => void }) {
  const geral = useMemo(() => contar(linhas), [linhas])
  const porVendedor = useMemo(() => {
    const m = new Map<string, { nome: string; ls: LinhaAnalise[] }>()
    for (const c of linhas) {
      const k = String(c.vendedorId ?? '')
      const g = m.get(k) ?? { nome: c.vendedorId == null ? '(sem vendedor)' : c.vendedor, ls: [] }
      g.ls.push(c)
      m.set(k, g)
    }
    return [...m]
      .map(([k, g]) => ({ grupo: g.nome, c: contar(g.ls), filtro: { vendedor: k } as Partial<Filtros> }))
      .sort((a, b) => b.c.enviados - a.c.enviados || a.grupo.localeCompare(b.grupo, 'pt-BR'))
  }, [linhas])
  const porMes = useMemo(() => {
    const m = new Map<string, LinhaAnalise[]>()
    for (const c of linhas) {
      const k = dataRef(c).slice(0, 7)
      m.set(k, [...(m.get(k) ?? []), c])
    }
    return [...m]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([mes, ls]) => ({ grupo: nomeMes(mes), c: contar(ls), filtro: { de: `${mes}-01`, ate: ultimoDiaMes(mes) } as Partial<Filtros> }))
  }, [linhas])
  const porFiscal = useMemo(
    () =>
      [
        { grupo: 'Contribuinte (com IE)', c: contar(linhas.filter((c) => !c.ieIsento)), filtro: { fiscal: 'contribuinte' } as Partial<Filtros> },
        { grupo: 'Isento (não contribuinte)', c: contar(linhas.filter((c) => c.ieIsento)), filtro: { fiscal: 'isento' } as Partial<Filtros> },
      ].filter((g) => g.c.enviados + g.c.rascunhos > 0),
    [linhas]
  )
  // Motivos de devolução: todas as devoluções do histórico (um cadastro pode
  // ter sido devolvido mais de uma vez). Agrupa textos iguais.
  const devolucoes = useMemo(
    () =>
      linhas
        .flatMap((c) => c.devolucoes.map((d) => ({ ...d, cadastroId: c.id, cliente: c.nome, vendedor: c.vendedor })))
        .sort((a, b) => (b.em ?? '').localeCompare(a.em ?? '')),
    [linhas]
  )
  const motivos = useMemo(() => {
    const m = new Map<string, { motivo: string; n: number }>()
    for (const d of devolucoes) {
      const k = normal(d.motivo.trim()).replace(/[.!\s]+$/g, '')
      const g = m.get(k) ?? { motivo: d.motivo.trim() || '(sem motivo)', n: 0 }
      g.n++
      m.set(k, g)
    }
    return [...m.values()].sort((a, b) => b.n - a.n)
  }, [devolucoes])

  if (!linhas.length) return <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 text-sm text-dark-400">Nenhum cadastro com esses filtros.</div>

  const cards = [
    { l: 'Cadastros enviados', v: String(geral.enviados), f: {} },
    { l: 'Aprovados', v: `${geral.aprovados} (${pct(geral.aprovados, geral.enviados)})`, f: { status: 'aprovado' } },
    { l: 'Esperando o financeiro', v: String(geral.aguardando), f: { status: 'aguardando' } },
    { l: 'Devolvidos p/ corrigir', v: String(geral.aCorrigir), f: { status: 'devolvido' } },
    { l: 'Já compraram depois', v: `${geral.comVenda} (${pct(geral.comVenda, geral.enviados)})`, f: null },
    { l: 'Vendido p/ clientes novos', v: brl(geral.valor), f: null },
    { l: 'Tempo médio até aprovar', v: tempoTxt(geral.tempoMedio), f: null },
    { l: 'Rascunhos (não enviados)', v: String(geral.rascunhos), f: { status: 'rascunho' } },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <button
            key={c.l}
            disabled={!c.f}
            onClick={() => c.f && verNaLista(c.f)}
            className={`text-left rounded-xl bg-dark-800 border border-dark-600 px-3 py-2 ${c.f ? 'hover:border-gold-600/60 cursor-pointer' : 'cursor-default'}`}
          >
            <p className="text-xs text-dark-400">{c.l}</p>
            <p className="text-lg font-bold text-dark-100">{c.v}</p>
          </button>
        ))}
      </div>

      <Bloco titulo="Cadastros por vendedor" sub="Clique numa linha para ver os cadastros dele na lista" onExportar={() => csvContagem('cadastros-por-vendedor', 'Vendedor', porVendedor)}>
        <TabelaContagem rotulo="Vendedor" grupos={porVendedor} onClicar={verNaLista} />
      </Bloco>

      <Bloco titulo="Cadastros por mês" sub="Mês do 1º envio ao SAP · clique para filtrar o mês" onExportar={() => csvContagem('cadastros-por-mes', 'Mês', porMes)}>
        <TabelaContagem rotulo="Mês" grupos={porMes} onClicar={verNaLista} />
      </Bloco>

      <Bloco titulo="Isentos × contribuintes" sub="Isento = marcado 'IE isento' no cadastro" onExportar={() => csvContagem('cadastros-isentos-contribuintes', 'Tipo', porFiscal)}>
        <TabelaContagem rotulo="Tipo" grupos={porFiscal} onClicar={verNaLista} />
      </Bloco>

      <Bloco
        titulo="Motivos de devolução"
        sub={`${devolucoes.length} devolução(ões) do financeiro nos cadastros filtrados`}
        onExportar={
          devolucoes.length
            ? () =>
                baixarCsv(
                  `cadastros-devolucoes-${new Date().toISOString().slice(0, 10)}.csv`,
                  paraCsv(
                    [
                      { chave: 'em', rotulo: 'Data' },
                      { chave: 'cliente', rotulo: 'Cliente' },
                      { chave: 'vendedor', rotulo: 'Vendedor' },
                      { chave: 'por', rotulo: 'Devolvido por' },
                      { chave: 'motivo', rotulo: 'Motivo' },
                    ],
                    devolucoes.map((d) => ({ ...d, em: dataHora(d.em) }))
                  )
                )
            : undefined
        }
      >
        {!devolucoes.length ? (
          <p className="text-sm text-dark-400">Nenhuma devolução nos cadastros filtrados.</p>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-dark-400 mb-1">Motivos que mais se repetem</p>
              <table className="w-full text-sm">
                <tbody>
                  {motivos.slice(0, 15).map((m) => (
                    <tr key={m.motivo} className="border-t border-dark-700/70">
                      <td className="py-1.5 pr-3 text-dark-200">{m.motivo}</td>
                      <td className="py-1.5 text-right text-dark-100 font-semibold">{m.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="text-xs text-dark-400 mb-1">Últimas devoluções</p>
              <table className="w-full text-sm">
                <tbody>
                  {devolucoes.slice(0, 15).map((d, i) => (
                    <tr key={`${d.cadastroId}-${i}`} className="border-t border-dark-700/70 align-top">
                      <td className="py-1.5 pr-3 text-dark-400 whitespace-nowrap">{dataHora(d.em)}</td>
                      <td className="py-1.5 pr-3 text-dark-100">
                        {d.cliente || '(sem nome)'}
                        <span className="block text-xs text-dark-500">{d.vendedor}</span>
                      </td>
                      <td className="py-1.5 text-red-300">{d.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Bloco>
    </div>
  )
}

const ABAS = [
  { v: 'fiscal', l: 'Informações fiscais' },
  { v: 'geral', l: 'Geral' },
  { v: 'contato', l: 'Contato' },
  { v: 'enderecos', l: 'Endereços' },
  { v: 'pagamento', l: 'Condições de pagamento' },
  { v: 'execucao', l: 'Execução do pagamento' },
  { v: 'anexos', l: 'Anexos' },
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
      const x = { ...VAZIO, ...(existente.data.dados as Dados) }
      x.anexos = x.anexos ?? []
      setD({ ...x, contatos: contatosDe(x) })
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

  // Padrões: resp. comercial = o próprio vendedor; filiais = as 3 (João,
  // 2026-11-12 — igual a Izabelly deixava no SAP).
  useEffect(() => {
    if (!carregado || !ctx.data || travado) return
    const op = ctx.data
    setD((x) => ({
      ...x,
      respComercial: x.respComercial ?? op.vendedorSap ?? null,
      filiais: x.filiais.length ? x.filiais : op.filiais.map((f) => f.v),
    }))
  }, [carregado, ctx.data, travado])
  // Piloto do financeiro (2026-11-16): regras novas só pra quem está no piloto.
  const { data: piloto } = trpc.pilotoFinanceiro.eu.useQuery(undefined, { staleTime: 60_000 })
  const falta = useMemo(() => faltando(d, piloto?.noPiloto ?? true), [d, piloto])
  const set = <K extends keyof Dados>(k: K, v: Dados[K]) => setD((x) => ({ ...x, [k]: v }))
  const setEnd = (qual: 'cobranca' | 'entrega', k: keyof Endereco, v: string) => setD((x) => ({ ...x, [qual]: { ...x[qual], [k]: v } }))

  const listaIsento = listaIsentoDe(ctx.data?.listas ?? [])
  const isento = d.pessoa === 'juridica' && d.ieIsento
  const trocarGrupo = (g: string) =>
    setD((x) => {
      const ind = indicadoresDoGrupo(g, x.ieIsento)
      return comRegrasIsento({ ...x, grupoTributario: g, ...(ind ?? {}), grupoCliente: x.grupoCliente === 100 && ind ? (ind.indicadorConsumidor === '0' ? 117 : 100) : x.grupoCliente }, listaIsento)
    })
  // CEP com 8 dígitos → preenche rua/bairro/cidade/UF.
  const trocarCep = async (qual: 'cobranca' | 'entrega', v: string) => {
    setEnd(qual, 'cep', v)
    if (so(v).length !== 8) return
    try {
      const r = await utils.cadastrosClientes.buscarCep.fetch({ cep: so(v) })
      if (!r) return toast.error('CEP não encontrado — preencha o endereço na mão')
      setD((x) => ({ ...x, [qual]: { ...x[qual], rua: r.rua || x[qual].rua, bairro: r.bairro || x[qual].bairro, cidade: r.cidade, uf: r.uf } }))
    } catch {
      /* sem internet: segue na mão */
    }
  }
  const copiar = async (texto: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(ok)
    } catch {
      toast.error('Não consegui copiar')
    }
  }

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
          return comRegrasIsento({
            ...x,
            ...(r.inscricaoEstadual && !x.ie.trim() && !x.ieIsento ? { ie: r.inscricaoEstadual } : {}),
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
          }, listaIsento)
        })
        av.push({ tipo: 'info', texto: `Dados da Receita preenchidos${rec.simples != null ? ` · ${rec.simples ? 'optante' : 'não optante'} pelo Simples` : ''}. ${
            r.inscricaoEstadual
              ? `Inscrição estadual encontrada: ${r.inscricaoEstadual} — confira.`
              : r.inscricoesEstaduais?.length
                ? `Inscrição estadual só aparece baixada/inativa (${r.inscricoesEstaduais.map((i) => `${i.ie}/${i.uf}`).join(', ')}) — confira com o cliente ou marque Isento.`
                : 'Inscrição estadual não encontrada — complete ou marque Isento.'
          }` })
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
    utils.cadastrosClientes.analise.invalidate()
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
    let novo: number | null = null
    try {
      novo = await gravar()
      const r = await enviar.mutateAsync({ id: novo })
      toast.success(`Enviado! Cliente ${r.cardCode} criado no SAP — esperando o financeiro aprovar.`, { duration: 6000 })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao enviar', { duration: 8000 })
    }
    utils.cadastrosClientes.invalidate()
    // Rascunho novo já foi gravado: passa a editar ele (senão reenviar criaria outro).
    if (id == null && novo != null) onCriado(novo)
  }
  const onExcluir = async () => {
    if (!id || !confirm('Apagar este rascunho?')) return
    await excluir.mutateAsync({ id })
    utils.cadastrosClientes.meus.invalidate()
    utils.cadastrosClientes.analise.invalidate()
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
          <Clock size={16} className="shrink-0 mt-0.5" /> Cliente criado no SAP (inativo). Esperando o financeiro conferir e ativar no SAP — você recebe um aviso assim que ficar ativo. Até lá não dá pra enviar cotação/pedido dele ao SAP.
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
          {op.vendedores.length > 0 && (
            <Select
              label="Resp. comercial (vendedor no SAP)"
              value={d.respComercial ?? ''}
              disabled={travado}
              placeholder="— sem vendedor —"
              onChange={(e) => set('respComercial', e.target.value ? Number(e.target.value) : null)}
              options={op.vendedores.map((v) => ({ value: v.v, label: v.l }))}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-dark-400">Pesquisar o cliente:</span>
          {SITES.map((s) => (
            <a
              key={s.nome}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                const doc = d.pessoa === 'juridica' ? so(d.cnpj) : so(d.cpf)
                if (doc) navigator.clipboard?.writeText(doc).then(() => toast.success('CNPJ/CPF copiado — é só colar no site'), () => {})
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-white ${s.cor} hover:opacity-90`}
            >
              {s.nome} <ExternalLink size={12} />
            </a>
          ))}
          <button
            type="button"
            onClick={() => copiar(textoParaCliente(d), 'Texto copiado — cole no WhatsApp/e-mail do cliente')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dark-500 px-2.5 py-1 text-xs text-dark-100 hover:border-gold-600"
          >
            <MessageSquareText size={13} /> Texto pro cliente preencher <Copy size={12} />
          </button>
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
                        setD((x) => {
                          const y = { ...x, ieIsento: isento, ...(indicadoresDoGrupo(x.grupoTributario, isento) ?? {}) }
                          return isento ? comRegrasIsento(y, listaIsento) : { ...y, grupoCliente: y.grupoCliente === GRUPO_CLIENTE_ISENTO ? 100 : y.grupoCliente }
                        })
                      }}
                    />
                    Isento
                  </label>
                </div>
              )}
              <Select label="Grupo tributário *" value={d.grupoTributario} disabled={travado} placeholder="Escolha…" onChange={(e) => trocarGrupo(e.target.value)} options={op.gruposTributarios.map((g) => ({ value: g.v, label: g.l }))} />
              <Select label={isento ? 'Indicador da IE * (isento → Não contribuinte)' : 'Indicador da IE *'} value={d.indicadorIE} disabled={travado || isento} placeholder="Escolha…" onChange={(e) => set('indicadorIE', e.target.value)} options={op.indicadoresIE.map((g) => ({ value: g.v, label: g.l }))} />
              <Select label={isento ? 'Indicador de op. consumidor * (isento → Consumidor final)' : 'Indicador de op. consumidor *'} value={d.indicadorConsumidor} disabled={travado || isento} placeholder="Escolha…" onChange={(e) => set('indicadorConsumidor', e.target.value)} options={op.indicadoresConsumidor.map((g) => ({ value: g.v, label: g.l }))} />
              <Input label="SUFRAMA" value={d.suframa} disabled={travado} onChange={(e) => set('suframa', e.target.value)} />
              <Select label="Região SUFRAMA" value={d.regiaoSuframa} disabled={travado} onChange={(e) => set('regiaoSuframa', e.target.value)} options={op.regioesSuframa.map((g) => ({ value: g.v, label: g.l }))} />
              {isento && (
                <p className="md:col-span-2 text-xs rounded-lg bg-amber-900/20 text-amber-200 px-3 py-2 flex gap-2">
                  <Lock size={14} className="shrink-0 mt-0.5" /> Cliente isento: Indicador da IE = Não contribuinte, Consumidor final, uso principal Venda consumo, grupo ISENTO e lista de preço de cliente isento — travados.
                </p>
              )}
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
                  <Input label="Celular / WhatsApp de quem está conversando *" value={d.celular} disabled={travado} onChange={(e) => set('celular', e.target.value)} />
                </div>
              </div>
              <Input label="E-mail *" type="email" value={d.email} disabled={travado} onChange={(e) => set('email', e.target.value)} />
              <Input label="E-mail do financeiro *" type="email" value={d.emailFinanceiro} disabled={travado} onChange={(e) => set('emailFinanceiro', e.target.value)} placeholder="para onde vão boletos e notas" />
              <Input label="Contato do financeiro (nome)" value={d.contatoFinanceiro} disabled={travado} onChange={(e) => set('contatoFinanceiro', e.target.value)} />
              <div className="flex gap-2">
                <div className="w-20">
                  <Input label="DDD" value={d.dddFinanceiro} disabled={travado} onChange={(e) => set('dddFinanceiro', e.target.value)} />
                </div>
                <div className="flex-1">
                  <Input label="Telefone do financeiro da empresa" value={d.telefoneFinanceiro} disabled={travado} onChange={(e) => set('telefoneFinanceiro', e.target.value)} />
                </div>
              </div>
              <Select label={isento ? 'Uso principal (isento → Venda consumo)' : 'Uso principal'} value={d.usoPrincipal} disabled={travado || isento} onChange={(e) => set('usoPrincipal', Number(e.target.value))} options={op.usosPrincipais.map((g) => ({ value: g.v, label: g.l }))} />
              {op.segmentos.length > 0 && (
                <Select label="Segmento" value={d.segmento ?? ''} disabled={travado} placeholder="— nenhum —" onChange={(e) => set('segmento', e.target.value ? Number(e.target.value) : null)} options={op.segmentos.map((g) => ({ value: g.v, label: g.l }))} />
              )}
              {op.territorios.length > 0 && (
                <Select label="Território" value={d.territorio ?? ''} disabled={travado} placeholder="— nenhum —" onChange={(e) => set('territorio', e.target.value ? Number(e.target.value) : null)} options={op.territorios.map((g) => ({ value: g.v, label: g.l }))} />
              )}
              <div className="md:col-span-2">
                <Textarea label="Observações" rows={2} value={d.observacoes} disabled={travado} onChange={(e) => set('observacoes', e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <p className="text-sm text-dark-300 mb-1.5">Atribuição de filial * (em quais empresas o cliente pode comprar)</p>
                <div className="flex flex-wrap gap-2">
                  {op.filiais.map((f) => {
                    const marcado = d.filiais.includes(f.v)
                    return (
                      <label key={f.v} className={`flex items-center gap-2 text-sm rounded-lg px-3 py-1.5 border ${marcado ? 'border-gold-600 text-gold-300 bg-gold-900/10' : 'border-dark-600 text-dark-300'}`}>
                        <input
                          type="checkbox"
                          className="accent-gold-500"
                          disabled={travado}
                          checked={marcado}
                          onChange={(e) => set('filiais', e.target.checked ? [...d.filiais, f.v] : d.filiais.filter((x) => x !== f.v))}
                        />
                        {f.l}
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
          {aba === 'contato' && (
            <div className="space-y-3">
              {d.contatos.length === 0 && <p className="text-sm text-dark-400">Nenhum contato. O primeiro da lista vira o contato principal no SAP.</p>}
              {d.contatos.map((c, i) => {
                const setC = (k: keyof Contato, v: string) => set('contatos', d.contatos.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
                return (
                  <div key={i} className="rounded-xl border border-dark-700 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-dark-400">{i === 0 ? 'Contato principal' : `Contato ${i + 1}`}</span>
                      {!travado && (
                        <button type="button" onClick={() => set('contatos', d.contatos.filter((_, j) => j !== i))} className="text-dark-400 hover:text-red-300" aria-label="Tirar contato">
                          <X size={16} />
                        </button>
                      )}
                    </div>
                    <div className="grid md:grid-cols-3 gap-3">
                      <Input label="Nome" value={c.nome} disabled={travado} onChange={(e) => setC('nome', e.target.value)} placeholder="Ex.: COMPRAS, João" />
                      <Input label="Cargo / setor" value={c.cargo} disabled={travado} onChange={(e) => setC('cargo', e.target.value)} />
                      <Input label="E-mail" value={c.email} disabled={travado} onChange={(e) => setC('email', e.target.value)} />
                      <Input label="Telefone" value={c.telefone} disabled={travado} onChange={(e) => setC('telefone', e.target.value)} />
                      <Input label="Celular" value={c.celular} disabled={travado} onChange={(e) => setC('celular', e.target.value)} />
                    </div>
                  </div>
                )
              })}
              {!travado && (
                <Button variant="outline" onClick={() => set('contatos', [...d.contatos, { ...CONTATO_VAZIO }])}>
                  <Plus size={15} /> Novo contato
                </Button>
              )}
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
                  <Input label="CEP * (preenche o endereço sozinho)" value={end.cep} disabled={endTravado} onChange={(e) => trocarCep(enderecoAba, e.target.value)} />
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
              <Select label={isento ? 'Lista de preço * (cliente isento)' : 'Lista de preço *'} value={d.listaPreco} disabled={travado || (isento && listaIsento != null)} onChange={(e) => set('listaPreco', Number(e.target.value))} options={op.listas.map((p) => ({ value: p.v, label: p.l }))} />
            </div>
          )}
          {aba === 'execucao' && (
            <div className="space-y-2">
              <p className="text-sm text-dark-300">Formas de pagamento do cliente *</p>
              {op.formas.length === 0 ? (
                <p className="text-sm text-dark-400">Não consegui ler as formas do SAP agora — vão as padrão da empresa.</p>
              ) : (
                <div className="grid md:grid-cols-2 gap-2">
                  {op.formas.map((f) => {
                    const atuais = d.formasPagamento ?? op.formas.map((x) => x.codigo)
                    const marcado = atuais.includes(f.codigo)
                    return (
                      <label key={f.codigo} className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 border ${marcado ? 'border-gold-600 text-gold-200 bg-gold-900/10' : 'border-dark-600 text-dark-300'}`}>
                        <input
                          type="checkbox"
                          className="accent-gold-500"
                          disabled={travado}
                          checked={marcado}
                          onChange={(e) => set('formasPagamento', e.target.checked ? [...atuais, f.codigo] : atuais.filter((x) => x !== f.codigo))}
                        />
                        {f.nome}
                      </label>
                    )
                  })}
                </div>
              )}
              <p className="text-xs text-dark-500">Todas as opções já vêm marcadas (regra do financeiro). Só desmarque se tiver certeza.</p>
            </div>
          )}
          {aba === 'anexos' && <AnexosCadastro anexos={d.anexos ?? []} podeMexer={!travado} onMudar={(a) => set('anexos', a)} />}
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

// Anexos do cadastro (contrato social, cartão CNPJ, consulta Serasa…).
function AnexosCadastro({ anexos, podeMexer, onMudar }: { anexos: Anexo[]; podeMexer: boolean; onMudar: (a: Anexo[]) => void }) {
  const [enviando, setEnviando] = useState(false)
  const enviar = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return
    setEnviando(true)
    try {
      const novos: Anexo[] = []
      for (const f of Array.from(arquivos)) {
        const form = new FormData()
        form.append('file', f)
        const r = await fetch('/upload/lead-attachment', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('odin_token')}` }, body: form })
        if (!r.ok) throw new Error(`Falha ao enviar ${f.name}`)
        const j = (await r.json()) as { path: string; originalName: string; mimeType: string }
        novos.push({ nome: j.originalName || f.name, arquivo: j.path, tipo: j.mimeType || null })
      }
      onMudar([...anexos, ...novos].slice(0, 15))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <div className="space-y-2">
      {anexos.length === 0 && <p className="text-sm text-dark-400">Nenhum anexo. Ex.: cartão CNPJ, contrato social, consulta Serasa, comprovante de endereço.</p>}
      <ul className="space-y-1">
        {anexos.map((a, i) => (
          <li key={a.arquivo} className="flex items-center gap-2 text-sm">
            <a className="text-blue-400 hover:underline truncate" href={`/uploads/${a.arquivo}`} target="_blank" rel="noreferrer">
              📎 {a.nome}
            </a>
            {podeMexer && (
              <button type="button" className="text-dark-500 hover:text-red-400" aria-label="Tirar anexo" onClick={() => onMudar(anexos.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {podeMexer && anexos.length < 15 && (
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dark-600 px-3 py-1.5 text-sm text-dark-200 hover:border-gold-600">
          {enviando ? 'Enviando…' : '+ Anexar arquivo'}
          <input type="file" multiple className="hidden" disabled={enviando} onChange={(e) => (enviar(e.target.files), (e.target.value = ''))} />
        </label>
      )}
    </div>
  )
}
