import { useState } from 'react'
import { Plus, Search, Download, RefreshCw, ChevronDown, ChevronUp, Pencil, Trash2, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import { Input, Textarea } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import ContatoButtons from '../components/ui/ContatoButtons'
import { formatDate, timeAgo } from '../lib/utils'

// Esteira da Bruna (Odin Compressores): cadastra clientes que já compraram
// máquina, liga/manda WhatsApp/e-mail, registra o retorno e a situação,
// classifica como Revenda ou Consumidor Final e envia pra carteira.
// Backend: server/src/router/prospeccaoOdin.ts (+ prospeccao.ts pro histórico).

const SITUACOES = [
  { value: 'novo', label: 'Novo' },
  { value: 'em_negociacao', label: 'Em negociação' },
  { value: 'sem_interesse', label: 'Sem interesse' },
  { value: 'retornar_depois', label: 'Retornar depois' },
  { value: 'pronto_carteira', label: 'Pronto pra carteira' },
]
const SITUACAO_LABEL: Record<string, string> = Object.fromEntries(SITUACOES.map((s) => [s.value, s.label]))
const SITUACAO_COR: Record<string, string> = {
  novo: 'text-dark-200 bg-dark-700/40 border-dark-600',
  em_negociacao: 'text-amber-400 bg-amber-900/20 border-amber-700/40',
  sem_interesse: 'text-red-400 bg-red-900/20 border-red-700/40',
  retornar_depois: 'text-purple-400 bg-purple-900/20 border-purple-700/40',
  pronto_carteira: 'text-green-400 bg-green-900/20 border-green-700/40',
}

const CLASSIFICACOES = [
  { value: 'revenda', label: 'Revenda' },
  { value: 'consumidor_final', label: 'Consumidor Final' },
]
const CLASSIFICACAO_LABEL: Record<string, string> = Object.fromEntries(CLASSIFICACOES.map((c) => [c.value, c.label]))

const TIPO_REGISTRO = [
  { value: 'nota', label: 'Anotação' },
  { value: 'ligacao', label: 'Ligação' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
  { value: 'visita', label: 'Visita' },
]
const TIPO_REGISTRO_ICONE: Record<string, string> = { ligacao: '📞', whatsapp: '💬', email: '📧', visita: '🚗', nota: '📝' }

// Atalho "Mês" — preenche De/Até com o mês inteiro, mesmo padrão de
// Pedidos/Propostas/Visitas.
function mesParaIntervalo(mes: string): { de: string; ate: string } {
  const [ano, m] = mes.split('-').map(Number)
  const ultimoDia = new Date(ano, m, 0).getDate()
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimoDia).padStart(2, '0')}` }
}

type ProspectRow = {
  id: number
  razaoSocial: string
  cnpj: string | null
  codigo: string
  nomeContato: string | null
  telefoneWhatsapp: string | null
  email: string | null
  cidade: string | null
  estado: string | null
  observacoes: string | null
  classificacaoComercial: string | null
  prospeccaoSituacao: string
  createdAt: string
  qtdTentativas: number
  ultimoContatoEm: string | null
  telefonesExtras?: { id: number; numero: string; rotulo?: string | null }[]
  vendedorAtual?: { id: number; name: string } | null
}

function baixarCsv(rows: ProspectRow[]) {
  const head = ['Código', 'Nome', 'CNPJ', 'Contato', 'Telefone', 'Cidade/UF', 'Classificação', 'Situação', 'Tentativas', 'Último contato', 'Cadastrado em', 'Observações']
  const limpar = (v: string | null | undefined) => (v ?? '').replace(/[\r\n,;]+/g, ' ').trim()
  const linhas = [head.join(',')]
  for (const r of rows) {
    linhas.push(
      [
        limpar(r.codigo),
        limpar(r.razaoSocial),
        limpar(r.cnpj),
        limpar(r.nomeContato),
        limpar(r.telefoneWhatsapp),
        limpar([r.cidade, r.estado].filter(Boolean).join(' - ')),
        CLASSIFICACAO_LABEL[r.classificacaoComercial ?? ''] ?? '',
        SITUACAO_LABEL[r.prospeccaoSituacao] ?? r.prospeccaoSituacao,
        String(r.qtdTentativas),
        r.ultimoContatoEm ? formatDate(r.ultimoContatoEm) : '',
        formatDate(r.createdAt),
        limpar(r.observacoes),
      ].join(',')
    )
  }
  const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `prospeccao_odin_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

type Form = {
  razaoSocial: string
  cnpj: string
  codigo: string
  nomeContato: string
  telefoneWhatsapp: string
  email: string
  cidade: string
  estado: string
  classificacaoComercial: string
  prospeccaoSituacao: string
  observacoes: string
}
const FORM_VAZIO: Form = {
  razaoSocial: '', cnpj: '', codigo: '', nomeContato: '', telefoneWhatsapp: '', email: '',
  cidade: '', estado: '', classificacaoComercial: '', prospeccaoSituacao: 'novo', observacoes: '',
}

export default function ProspeccaoOdin() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const utils = trpc.useUtils()

  const [vendedorId, setVendedorId] = useState('')
  const [filtroPor, setFiltroPor] = useState<'cadastro' | 'ultimo_contato'>('cadastro')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [mes, setMes] = useState('')
  const [classificacao, setClassificacao] = useState('')
  const [situacao, setSituacao] = useState('')
  const [busca, setBusca] = useState('')

  const [expandidoId, setExpandidoId] = useState<number | null>(null)
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [form, setForm] = useState<Form>(FORM_VAZIO)
  const [excluindo, setExcluindo] = useState<{ id: number; nome: string } | null>(null)

  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: isAdmin })

  const { data: lista, isLoading } = trpc.prospeccaoOdin.listar.useQuery({
    vendedorId: isAdmin && vendedorId ? Number(vendedorId) : undefined,
    filtroPor,
    dataDe: dataDe || undefined,
    dataAte: dataAte || undefined,
    classificacao: (classificacao || undefined) as 'revenda' | 'consumidor_final' | undefined,
    situacao: (situacao || undefined) as never,
    busca: busca.trim() || undefined,
  })

  function invalidar() {
    utils.prospeccaoOdin.listar.invalidate()
  }
  function aplicarMes(m: string) {
    setMes(m)
    if (m) {
      const { de, ate } = mesParaIntervalo(m)
      setDataDe(de)
      setDataAte(ate)
    } else {
      setDataDe('')
      setDataAte('')
    }
  }
  function alterarData(campo: 'de' | 'ate', valor: string) {
    if (campo === 'de') setDataDe(valor)
    else setDataAte(valor)
    setMes('')
  }

  const criarMut = trpc.prospeccaoOdin.criar.useMutation({
    onSuccess: () => { toast.success('Prospecção cadastrada'); fechar(); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const atualizarMut = trpc.prospeccaoOdin.atualizar.useMutation({
    onSuccess: () => { toast.success('Salvo'); fechar(); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const situacaoMut = trpc.prospeccaoOdin.mudarSituacao.useMutation({
    onSuccess: () => invalidar(),
    onError: (e) => toast.error(e.message),
  })
  const enviarMut = trpc.prospeccaoOdin.enviarParaCarteira.useMutation({
    onSuccess: () => { toast.success('Enviado pra carteira — já aparece no Kanban.'); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const descartarMut = trpc.prospeccao.descartar.useMutation({
    onSuccess: () => { toast.success('Prospect descartado'); setExcluindo(null); invalidar() },
    onError: (e) => toast.error(e.message),
  })

  function fechar() {
    setModalAberto(false)
    setEditando(null)
    setForm(FORM_VAZIO)
  }
  function abrirNovo() {
    setEditando(null)
    setForm(FORM_VAZIO)
    setModalAberto(true)
  }
  function abrirEdicao(p: ProspectRow) {
    setEditando(p.id)
    setForm({
      razaoSocial: p.razaoSocial ?? '',
      cnpj: p.cnpj ?? '',
      codigo: p.codigo?.startsWith('P') && /^P\d{10,}$/.test(p.codigo) ? '' : (p.codigo ?? ''),
      nomeContato: p.nomeContato ?? '',
      telefoneWhatsapp: p.telefoneWhatsapp ?? '',
      email: p.email ?? '',
      cidade: p.cidade ?? '',
      estado: p.estado ?? '',
      classificacaoComercial: p.classificacaoComercial ?? '',
      prospeccaoSituacao: p.prospeccaoSituacao ?? 'novo',
      observacoes: p.observacoes ?? '',
    })
    setModalAberto(true)
  }
  function salvar() {
    if (!form.razaoSocial.trim()) return toast.error('Informe o nome do cliente.')
    const payload = {
      razaoSocial: form.razaoSocial.trim(),
      cnpj: form.cnpj.trim() || undefined,
      codigo: form.codigo.trim() || undefined,
      nomeContato: form.nomeContato.trim() || undefined,
      telefoneWhatsapp: form.telefoneWhatsapp.trim() || undefined,
      email: form.email.trim() || undefined,
      cidade: form.cidade.trim() || undefined,
      estado: form.estado.trim() || undefined,
      classificacaoComercial: (form.classificacaoComercial || undefined) as 'revenda' | 'consumidor_final' | undefined,
      prospeccaoSituacao: form.prospeccaoSituacao as never,
      observacoes: form.observacoes.trim() || undefined,
    }
    if (editando) atualizarMut.mutate({ id: editando, ...payload })
    else criarMut.mutate({ ...payload, vendedorId: isAdmin && vendedorId ? Number(vendedorId) : undefined })
  }

  const rows = (lista ?? []) as ProspectRow[]
  const temFiltroData = !!(dataDe || dataAte)

  return (
    <div className="p-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="font-heading text-2xl text-dark-50 font-bold flex items-center gap-2">
            <Search size={20} /> Prospecção
          </h1>
          <p className="text-dark-400 text-sm mt-0.5">Clientes que já compraram máquina — ligar, registrar o retorno e enviar pra carteira.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => baixarCsv(rows)}
            className="flex items-center gap-1.5 rounded-lg border border-dark-600 px-3 py-1.5 text-xs font-medium text-dark-300 hover:bg-dark-800 transition-colors"
          >
            <Download size={13} /> Exportar CSV
          </button>
          <button
            onClick={() => invalidar()}
            className="flex items-center gap-1.5 text-xs text-dark-400 hover:text-gold-400 transition-colors"
          >
            <RefreshCw size={13} /> Atualizar
          </button>
          <Button size="sm" onClick={abrirNovo}><Plus size={14} className="mr-1" /> Nova prospecção</Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-end gap-3 flex-wrap mb-4 bg-dark-800/50 border border-dark-700 rounded-xl p-3">
        {isAdmin && (
          <div className="w-48">
            <Select
              label="Vendedor"
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value)}
              placeholder="Todos"
              // Inclui admin com carteira própria (tem região definida) — ex:
              // a Bruna, que é admin da Odin mas também faz prospecção. Só o
              // "admin puro" sem região fica de fora (evita poluir com contas
              // administrativas que não vendem).
              options={(vendedores ?? [])
                .filter((v) => v.role === 'vendor' || !!v.regiao)
                .map((v) => ({ value: v.id, label: v.name }))}
            />
          </div>
        )}
        <div className="w-40">
          <Select
            label="Filtrar data por"
            value={filtroPor}
            onChange={(e) => setFiltroPor(e.target.value as 'cadastro' | 'ultimo_contato')}
            options={[
              { value: 'cadastro', label: 'Cadastro' },
              { value: 'ultimo_contato', label: 'Último contato' },
            ]}
          />
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-dark-600 px-2 py-1.5">
          <input
            type="month"
            value={mes}
            title="Atalho: preenche De/Até com o mês inteiro"
            onChange={(e) => aplicarMes(e.target.value)}
            className="bg-transparent text-xs py-0.5 px-1 w-[110px] text-dark-100 focus:outline-none"
          />
          <span className="text-dark-600">|</span>
          <input type="date" value={dataDe} onChange={(e) => alterarData('de', e.target.value)} className="bg-transparent text-xs py-0.5 px-1 w-[120px] text-dark-100 focus:outline-none" />
          <span className="text-dark-500 text-xs">até</span>
          <input type="date" value={dataAte} onChange={(e) => alterarData('ate', e.target.value)} className="bg-transparent text-xs py-0.5 px-1 w-[120px] text-dark-100 focus:outline-none" />
          {temFiltroData && (
            <button onClick={() => aplicarMes('')} className="text-dark-500 hover:text-dark-300 text-xs px-1">limpar</button>
          )}
        </div>
        <div className="w-44">
          <Select
            label="Classificação"
            value={classificacao}
            onChange={(e) => setClassificacao(e.target.value)}
            placeholder="Todas"
            options={CLASSIFICACOES}
          />
        </div>
        <div className="w-44">
          <Select
            label="Situação"
            value={situacao}
            onChange={(e) => setSituacao(e.target.value)}
            placeholder="Todas"
            options={SITUACOES}
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <Input
            label="Buscar"
            icon={<Search size={14} />}
            placeholder="CNPJ, nome, código, contato, cidade..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      <p className="text-xs text-dark-500 mb-2">{rows.length} {rows.length === 1 ? 'prospecção' : 'prospecções'}</p>

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : rows.length === 0 ? (
        <p className="text-dark-500 text-sm">Nenhuma prospecção encontrada.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((p) => {
            const expandido = expandidoId === p.id
            return (
              <div key={p.id} className="bg-dark-800 rounded-xl border border-dark-600">
                <div className="flex items-start justify-between gap-3 p-4">
                  <button onClick={() => setExpandidoId(expandido ? null : p.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      {expandido ? <ChevronUp size={14} className="text-dark-500 shrink-0" /> : <ChevronDown size={14} className="text-dark-500 shrink-0" />}
                      <span className="font-semibold text-dark-100 truncate">{p.razaoSocial}</span>
                      {p.classificacaoComercial && (
                        <Badge className="text-blue-300 bg-blue-900/20 border-blue-700/40">{CLASSIFICACAO_LABEL[p.classificacaoComercial]}</Badge>
                      )}
                      <Badge className={SITUACAO_COR[p.prospeccaoSituacao]}>{SITUACAO_LABEL[p.prospeccaoSituacao] ?? p.prospeccaoSituacao}</Badge>
                      {p.qtdTentativas > 0 && (
                        <span className="text-[11px] text-dark-500">{p.qtdTentativas} tentativa{p.qtdTentativas > 1 ? 's' : ''}{p.ultimoContatoEm ? ` · último ${timeAgo(p.ultimoContatoEm)}` : ''}</span>
                      )}
                    </div>
                    <div className="mt-1 ml-6 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-dark-500">
                      {p.cnpj && <span>CNPJ {p.cnpj}</span>}
                      {p.codigo && !/^P\d{10,}$/.test(p.codigo) && <span>Cód. {p.codigo}</span>}
                      {p.nomeContato && <span>{p.nomeContato}</span>}
                      {(p.cidade || p.estado) && <span>{[p.cidade, p.estado].filter(Boolean).join(' - ')}</span>}
                      {isAdmin && p.vendedorAtual && <span className="text-dark-600">{p.vendedorAtual.name}</span>}
                    </div>
                    {p.observacoes && <p className="mt-1 ml-6 text-xs text-dark-400 line-clamp-2">{p.observacoes}</p>}
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <ContatoButtons telefone={p.telefoneWhatsapp} email={p.email} telefonesExtras={p.telefonesExtras} size="sm" />
                    <div className="w-40">
                      <Select
                        value={p.prospeccaoSituacao}
                        onChange={(e) => situacaoMut.mutate({ id: p.id, situacao: e.target.value as never })}
                        options={SITUACOES}
                      />
                    </div>
                    <button
                      onClick={() => enviarMut.mutate({ id: p.id })}
                      disabled={enviarMut.isPending}
                      title="Enviar pra carteira"
                      className="inline-flex items-center gap-1 rounded-lg bg-green-600/20 hover:bg-green-600/40 text-green-400 border border-green-600/30 px-2.5 py-1.5 text-xs font-medium disabled:opacity-60"
                    >
                      <Send size={13} /> Carteira
                    </button>
                    <button onClick={() => abrirEdicao(p)} className="p-1.5 rounded-lg text-dark-400 hover:text-gold-400 hover:bg-gold-900/10"><Pencil size={14} /></button>
                    <button onClick={() => setExcluindo({ id: p.id, nome: p.razaoSocial })} className="p-1.5 rounded-lg text-dark-400 hover:text-red-400 hover:bg-red-900/20"><Trash2 size={14} /></button>
                  </div>
                </div>

                {expandido && <Timeline clienteId={p.id} />}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal cadastro/edição */}
      <Modal open={modalAberto} onClose={fechar} title={editando ? 'Editar prospecção' : 'Nova prospecção'} size="lg">
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <Input label="Nome / Razão social *" value={form.razaoSocial} onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="CNPJ" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} />
            <Input label="Código (opcional)" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="do sistema antigo, se tiver" />
            <Input label="Pessoa de contato" value={form.nomeContato} onChange={(e) => setForm({ ...form, nomeContato: e.target.value })} />
            <Input label="Telefone / WhatsApp" value={form.telefoneWhatsapp} onChange={(e) => setForm({ ...form, telefoneWhatsapp: e.target.value })} />
            <Input label="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <div />
            <Input label="Cidade" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
            <Input label="Estado (UF)" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} maxLength={2} />
            <Select
              label="Classificação"
              value={form.classificacaoComercial}
              onChange={(e) => setForm({ ...form, classificacaoComercial: e.target.value })}
              placeholder="Definir depois..."
              options={CLASSIFICACOES}
            />
            <Select
              label="Situação"
              value={form.prospeccaoSituacao}
              onChange={(e) => setForm({ ...form, prospeccaoSituacao: e.target.value })}
              options={SITUACOES}
            />
          </div>
          <Textarea label="Observações" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} rows={3} placeholder="Máquinas que comprou, quem indicou, contexto..." />
          <p className="text-[11px] text-dark-500">A Classificação (Revenda / Consumidor Final) é obrigatória só na hora de enviar pra carteira.</p>
          <Button className="w-full" loading={criarMut.isPending || atualizarMut.isPending} onClick={salvar}>
            {editando ? 'Salvar' : 'Cadastrar prospecção'}
          </Button>
        </div>
      </Modal>

      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Descartar prospecção" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Descartar "{excluindo?.nome}"? (não some da carteira se já foi enviado)</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExcluindo(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={descartarMut.isPending} onClick={() => excluindo && descartarMut.mutate({ id: excluindo.id })}>Descartar</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// Linha do tempo de tentativas de contato do prospect — reaproveita o router
// genérico `prospeccao` (funciona pra qualquer empresa, escopado por dono).
function Timeline({ clienteId }: { clienteId: number }) {
  const utils = trpc.useUtils()
  const { data: registros, isLoading } = trpc.prospeccao.listarRegistros.useQuery({ clienteId })
  const [tipo, setTipo] = useState('nota')
  const [observacao, setObservacao] = useState('')

  const registrarMut = trpc.prospeccao.registrarContato.useMutation({
    onSuccess: () => {
      toast.success('Registrado')
      setObservacao('')
      utils.prospeccao.listarRegistros.invalidate({ clienteId })
      utils.prospeccaoOdin.listar.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!observacao.trim()) return toast.error('Escreva o que aconteceu.')
    registrarMut.mutate({ clienteId, tipo: tipo as never, observacao: observacao.trim() })
  }

  return (
    <div className="border-t border-dark-700 bg-dark-900/40 px-4 py-3 space-y-3">
      <form onSubmit={enviar} className="flex flex-col sm:flex-row gap-2">
        <div className="sm:w-36 shrink-0">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value)} options={TIPO_REGISTRO} />
        </div>
        <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={1} placeholder="O retorno da empresa, o que ficou combinado..." className="flex-1" />
        <Button type="submit" size="sm" loading={registrarMut.isPending} className="shrink-0">Registrar</Button>
      </form>
      <div className="space-y-1.5 max-h-56 overflow-y-auto">
        {isLoading && <p className="text-xs text-dark-500">Carregando...</p>}
        {!isLoading && !registros?.length && <p className="text-xs text-dark-500">Nenhum registro ainda.</p>}
        {registros?.map((r) => (
          <div key={r.id} className="text-xs bg-dark-800 rounded-lg px-3 py-2">
            <p className="text-dark-200">{TIPO_REGISTRO_ICONE[r.tipo]} {r.observacao}</p>
            <p className="text-dark-500 mt-0.5">{r.registradoPor?.name ?? '—'} · {timeAgo(r.createdAt)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
