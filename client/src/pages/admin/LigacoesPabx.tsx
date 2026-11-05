import { Fragment, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { PhoneCall, PhoneIncoming, PhoneOutgoing, Settings2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import GravacaoLigacao from '../../components/ui/GravacaoLigacao'
import { useAuth } from '../../contexts/AuthContext'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'

// Telefonia PABXONE360 das 3 empresas Odin (uma conta só) — pedido do João,
// 2026-10-30. Relatório de ligações separando TENTATIVA (toda chamada) de
// LIGAÇÃO EFETIVA (atendida e com a duração mínima), por vendedor (ramal).
// SuperAdmin ainda vê a configuração (usuário/token, ligar, Ligar pelo CRM)
// e a tabela de ramais × vendedor. Servidor: router/pabx.ts.

const STATUS: Record<string, { label: string; classe: string }> = {
  atendida: { label: 'Efetiva', classe: 'bg-green-500/15 text-green-300 border-green-500/30' },
  curta: { label: 'Atendida, curta', classe: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  nao_atendida: { label: 'Não atendeu', classe: 'bg-dark-700 text-dark-300 border-dark-600' },
  ocupado: { label: 'Ocupado', classe: 'bg-dark-700 text-dark-300 border-dark-600' },
  falha: { label: 'Falhou', classe: 'bg-red-500/15 text-red-300 border-red-500/30' },
}

const TIPO: Record<string, { label: string; classe: string }> = {
  lead: { label: 'Lead', classe: 'text-sky-300' },
  carteira: { label: 'Carteira', classe: 'text-gold-300' },
  prospeccao: { label: 'Prospecção', classe: 'text-violet-300' },
  cliente: { label: 'Cliente (fora do mês)', classe: 'text-dark-300' },
  nao_identificado: { label: 'Fora do CRM', classe: 'text-dark-500' },
}

function BarraMeta({ feito, meta }: { feito: number; meta: number }) {
  if (!meta) return <span className="text-dark-500">—</span>
  const pct = Math.min(100, Math.round((feito / meta) * 100))
  const cor = feito >= meta ? 'bg-green-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2 justify-end">
      <span className={`font-mono ${feito >= meta ? 'text-green-300' : ''}`}>
        {feito}/{meta}
      </span>
      <div className="w-16 h-1.5 rounded-full bg-dark-700 overflow-hidden">
        <div className={`h-full ${cor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function hojeBr() {
  return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
}
function inicioMesBr() {
  return `${hojeBr().slice(0, 7)}-01`
}
function dataHoraBr(utc: string | null) {
  if (!utc) return '—'
  return new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function duracao(seg: number | null) {
  if (!seg) return '0s'
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  const s = seg % 60
  return h ? `${h}h${String(m).padStart(2, '0')}` : m ? `${m}min${s ? ` ${s}s` : ''}` : `${s}s`
}
function telefone(n: string | null) {
  const d = (n ?? '').replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return n ?? '—'
}

function Configuracao() {
  const utils = trpc.useUtils()
  const { data: st } = trpc.pabx.status.useQuery()
  const [form, setForm] = useState<{ usuario: string; token: string; ligada: boolean; click2call: boolean; duracaoMinima: string; prefixo: string; metas: Record<number, string> } | null>(null)
  const f = form ?? (st ? { usuario: st.usuario, token: '', ligada: st.ligada, click2call: st.click2call, duracaoMinima: String(st.duracaoMinima), prefixo: st.prefixoDiscagem, metas: Object.fromEntries(st.metas.map((m) => [m.empresaId, String(m.meta)])) } : null)
  const salvar = trpc.pabx.salvarConfig.useMutation({
    onSuccess: () => {
      toast.success('Configuração salva')
      setForm(null)
      utils.pabx.status.invalidate()
      utils.pabx.meuRamal.invalidate()
      utils.pabx.minhaMetaHoje.invalidate()
      utils.pabx.relatorio.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const testar = trpc.pabx.testarConexao.useMutation({
    onSuccess: (r) => toast.success(`Conectado: ${r.ramais} ramais · hoje ${r.chamadasHoje} chamadas (${r.efetivasHoje} efetivas)`),
    onError: (e) => toast.error(e.message),
  })
  const [periodo, setPeriodo] = useState({ de: hojeBr(), ate: hojeBr() })
  const sincronizar = trpc.pabx.sincronizarAgora.useMutation({
    onSuccess: (r) => {
      toast.success(`${r.novas} ligação(ões) nova(s), ${r.registradas} registrada(s) em cliente/lead`)
      utils.pabx.relatorio.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  if (!st || !f) return <div className="h-32 rounded-2xl bg-dark-800 animate-pulse" />
  const set = (p: Partial<typeof f>) => setForm({ ...f, ...p })

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-dark-100 flex items-center gap-2">
          <Settings2 size={16} /> Configuração da PABXONE360 <span className="text-xs font-normal text-dark-500">(só superAdmin)</span>
        </h2>
        <span className="text-xs text-dark-500">
          Última sincronização: {dataHoraBr(st.ultimaSync)}
          {st.ultimoErro ? <span className="text-red-300"> · erro: {st.ultimoErro}</span> : null}
          {st.atrasoApi ? <span> · PABX liberou a última ligação acompanhada em {st.atrasoApi.split(' — ')[1] ?? st.atrasoApi}</span> : null}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input label="Usuário da API" value={f.usuario} onChange={(e) => set({ usuario: e.target.value })} />
        <Input
          label="Token da API"
          type="password"
          autoComplete="new-password"
          placeholder={st.tokenConfigurado ? '•••••• (configurado — deixe vazio pra manter)' : 'cole o token aqui'}
          value={f.token}
          onChange={(e) => set({ token: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Duração mínima (s)" type="number" min={0} value={f.duracaoMinima} onChange={(e) => set({ duracaoMinima: e.target.value })} />
          <Input label="Prefixo de discagem" value={f.prefixo} onChange={(e) => set({ prefixo: e.target.value })} />
        </div>
      </div>
      <p className="text-xs text-dark-500">Ligação efetiva = atendida e com pelo menos a duração mínima. Abaixo disso conta só como tentativa.</p>
      <div className="space-y-2">
        <p className="text-sm text-dark-200">Meta diária de ligações efetivas, por vendedor</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {st.metas.map((m) => (
            <Input
              key={m.empresaId}
              label={m.nome}
              type="number"
              min={0}
              value={f.metas[m.empresaId] ?? '0'}
              onChange={(e) => set({ metas: { ...f.metas, [m.empresaId]: e.target.value } })}
            />
          ))}
        </div>
        <p className="text-xs text-dark-500">Soma todas as ligações efetivas do ramal: lead, carteira, prospecção e número fora do CRM. 0 = sem meta.</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-dark-200">
          <input type="checkbox" checked={f.ligada} onChange={(e) => set({ ligada: e.target.checked })} />
          Registrar as ligações sozinho (a cada minuto)
        </label>
        <label className="flex items-center gap-2 text-sm text-dark-200">
          <input type="checkbox" checked={f.click2call} onChange={(e) => set({ click2call: e.target.checked })} />
          Botão Ligar liga pelo PABX (Click2Call)
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={salvar.isPending}
          onClick={() =>
            salvar.mutate({
              usuario: f.usuario,
              token: f.token || undefined,
              ligada: f.ligada,
              click2call: f.click2call,
              duracaoMinima: Number(f.duracaoMinima) || 0,
              prefixoDiscagem: f.prefixo,
              metas: Object.entries(f.metas).map(([empresaId, meta]) => ({ empresaId: Number(empresaId), meta: Math.max(0, Math.round(Number(meta) || 0)) })),
            })
          }
        >
          Salvar
        </Button>
        <Button size="sm" variant="secondary" loading={testar.isPending} onClick={() => testar.mutate()}>
          Testar conexão
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-dark-700 pt-4">
        <Input label="Reprocessar de" type="date" value={periodo.de} onChange={(e) => setPeriodo({ ...periodo, de: e.target.value })} />
        <Input label="até" type="date" value={periodo.ate} onChange={(e) => setPeriodo({ ...periodo, ate: e.target.value })} />
        <Button size="sm" variant="secondary" loading={sincronizar.isPending} onClick={() => sincronizar.mutate({ dataInicio: periodo.de, dataFim: periodo.ate })}>
          <RefreshCw size={14} className="mr-1" /> Buscar ligações do período
        </Button>
        <span className="text-xs text-dark-500">Use depois de cadastrar ramais. Não duplica nada.</span>
      </div>
    </div>
  )
}

function Ramais() {
  const utils = trpc.useUtils()
  const { data } = trpc.pabx.ramais.useQuery()
  const salvar = trpc.pabx.salvarRamal.useMutation({
    onSuccess: () => {
      toast.success('Ramal salvo')
      utils.pabx.ramais.invalidate()
      utils.pabx.filtrosRelatorio.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const [novo, setNovo] = useState('')
  if (!data) return <div className="h-32 rounded-2xl bg-dark-800 animate-pulse" />
  const opcoes = [{ value: '', label: '— sem vendedor —' }, ...data.usuarios.map((u) => ({ value: String(u.id), label: `${u.name} · ${u.empresa}` }))]

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-dark-100">Ramais × vendedor</h2>
      <p className="text-xs text-dark-500">Cada ramal ligado a uma pessoa: é assim que o CRM sabe quem fez a ligação. Um vendedor só pode ter um ramal.</p>
      {data.erro && <p className="text-xs text-red-300">Não consegui ler os ramais do PABX: {data.erro}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-dark-400 text-left">
              <th className="py-1.5 pr-3 font-medium">Ramal</th>
              <th className="py-1.5 pr-3 font-medium">Nome no PABX</th>
              <th className="py-1.5 font-medium">Vendedor no CRM</th>
            </tr>
          </thead>
          <tbody>
            {data.ramais.map((r) => (
              <tr key={r.ramal} className="border-t border-dark-700/70">
                <td className="py-1.5 pr-3 font-mono">{r.ramal}</td>
                <td className="py-1.5 pr-3 text-dark-300">
                  {r.nome || '—'}
                  {!r.noPabx && <span className="text-xs text-amber-300"> (não veio do PABX)</span>}
                </td>
                <td className="py-1.5 w-80">
                  <Select
                    options={opcoes}
                    value={r.userId ? String(r.userId) : ''}
                    onChange={(e) => salvar.mutate({ ramal: r.ramal, nome: r.nome || undefined, userId: e.target.value ? Number(e.target.value) : null })}
                  />
                </td>
              </tr>
            ))}
            {!data.ramais.length && (
              <tr>
                <td colSpan={3} className="py-3 text-dark-400">
                  Nenhum ramal ainda — confira usuário/token ou adicione abaixo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-end gap-2">
        <Input label="Adicionar ramal à mão" placeholder="ex.: 201" value={novo} onChange={(e) => setNovo(e.target.value)} />
        <Button
          size="sm"
          variant="secondary"
          disabled={!novo.trim()}
          onClick={() => {
            salvar.mutate({ ramal: novo.trim(), userId: null })
            setNovo('')
          }}
        >
          Adicionar
        </Button>
      </div>
    </div>
  )
}

export default function LigacoesPabx() {
  const { user } = useAuth()
  const superAdmin = !!user?.superAdmin
  const [de, setDe] = useState(inicioMesBr())
  const [ate, setAte] = useState(hojeBr())
  const [empresaId, setEmpresaId] = useState('')
  const [userId, setUserId] = useState('')
  const [filtro, setFiltro] = useState<'todas' | 'efetivas' | 'tentativas'>('todas')
  const [aberta, setAberta] = useState<number | null>(null)
  const [aba, setAba] = useState<'relatorio' | 'config'>('relatorio')
  const { data: filtros } = trpc.pabx.filtrosRelatorio.useQuery()
  const { data, isLoading } = trpc.pabx.relatorio.useQuery({
    dataInicio: de,
    dataFim: ate,
    empresaId: empresaId ? Number(empresaId) : null,
    userId: userId ? Number(userId) : null,
  })

  const chamadas = useMemo(
    () => (data?.chamadas ?? []).filter((c) => (filtro === 'efetivas' ? c.efetiva : filtro === 'tentativas' ? !c.efetiva : true)),
    [data, filtro]
  )
  const totais = useMemo(() => {
    const p = data?.porVendedor ?? []
    return {
      tentativas: p.reduce((s, v) => s + v.tentativas, 0),
      efetivas: p.reduce((s, v) => s + v.efetivas, 0),
      segundos: p.reduce((s, v) => s + v.segundosFalados, 0),
    }
  }, [data])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold-500/15 border border-gold-500/30 flex items-center justify-center">
            <PhoneCall size={20} className="text-gold-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Ligações (PABX)</h1>
            <p className="text-sm text-dark-400">Tentativas × ligações efetivas por vendedor · PABXONE360</p>
          </div>
        </div>
        {superAdmin && (
          <div className="flex gap-1 bg-dark-800 border border-dark-600 rounded-xl p-1">
            {(['relatorio', 'config'] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAba(a)}
                className={`px-3 py-1.5 rounded-lg text-sm ${aba === a ? 'bg-gold-600/20 text-gold-300' : 'text-dark-300 hover:text-dark-100'}`}
              >
                {a === 'relatorio' ? 'Relatório' : 'Configuração e ramais'}
              </button>
            ))}
          </div>
        )}
      </div>

      {superAdmin && aba === 'config' ? (
        <>
          <Configuracao />
          <Ramais />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Input label="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
            <Input label="Até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            {data?.veTudo && superAdmin && (
              <div className="w-56">
                <Select
                  label="Empresa"
                  value={empresaId}
                  onChange={(e) => setEmpresaId(e.target.value)}
                  options={[{ value: '', label: 'As 3 empresas Odin' }, ...(filtros?.empresas ?? []).map((e) => ({ value: String(e.id), label: e.nome }))]}
                />
              </div>
            )}
            {data?.veTudo && (
              <div className="w-56">
                <Select
                  label="Vendedor"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  options={[{ value: '', label: 'Todos' }, ...(filtros?.vendedores ?? []).map((v) => ({ value: String(v.id), label: `${v.name} (ramal ${v.ramal})` }))]}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
              <p className="text-xs text-dark-400">Tentativas (todas as chamadas)</p>
              <p className="text-2xl font-bold font-mono text-dark-50">{totais.tentativas}</p>
            </div>
            <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
              <p className="text-xs text-green-300">Ligações efetivas</p>
              <p className="text-2xl font-bold font-mono text-green-300">{totais.efetivas}</p>
            </div>
            <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
              <p className="text-xs text-dark-400">% efetivas</p>
              <p className="text-2xl font-bold font-mono text-dark-50">{totais.tentativas ? Math.round((totais.efetivas / totais.tentativas) * 100) : 0}%</p>
            </div>
            <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
              <p className="text-xs text-dark-400">Tempo falado</p>
              <p className="text-2xl font-bold font-mono text-dark-50">{duracao(totais.segundos)}</p>
            </div>
          </div>

          {isLoading ? (
            <div className="h-40 rounded-2xl bg-dark-800 animate-pulse" />
          ) : (
            <>
              <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-2">
                <h2 className="text-sm font-semibold text-dark-100">Por vendedor</h2>
                <p className="text-xs text-dark-500">
                  Meta conta só ligações efetivas — de qualquer tipo (lead, carteira, prospecção, fora do CRM). Meta do período = meta do dia × {data?.diasUteis ?? 0} dia(s) útil(eis) até hoje.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-dark-400 text-left">
                        <th className="py-1.5 pr-3 font-medium">Vendedor</th>
                        <th className="py-1.5 pr-3 font-medium">Ramal</th>
                        <th className="py-1.5 pr-3 font-medium text-right">Tentativas</th>
                        <th className="py-1.5 pr-3 font-medium text-right">Efetivas</th>
                        <th className="py-1.5 pr-3 font-medium text-right">% efetivas</th>
                        {data?.hojeNoPeriodo && <th className="py-1.5 pr-3 font-medium text-right">Meta hoje</th>}
                        <th className="py-1.5 pr-3 font-medium text-right">Meta do período</th>
                        <th className="py-1.5 pr-3 font-medium text-right" title="Efetivas: lead / carteira / prospecção / outras">Lead · Cart. · Prosp. · Outras</th>
                        <th className="py-1.5 pr-3 font-medium text-right">Feitas / recebidas</th>
                        <th className="py-1.5 font-medium text-right">Tempo falado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.porVendedor ?? []).map((v) => (
                        <tr key={`${v.userId ?? 'r'}-${v.ramal ?? ''}`} className="border-t border-dark-700/70">
                          <td className="py-1.5 pr-3">{v.vendedor}</td>
                          <td className="py-1.5 pr-3 font-mono text-dark-300">{v.ramal ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{v.tentativas}</td>
                          <td className="py-1.5 pr-3 text-right font-mono text-green-300">{v.efetivas}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{v.tentativas ? Math.round((v.efetivas / v.tentativas) * 100) : 0}%</td>
                          {data?.hojeNoPeriodo && (
                            <td className="py-1.5 pr-3">
                              <BarraMeta feito={v.efetivasHoje} meta={v.metaDia} />
                            </td>
                          )}
                          <td className="py-1.5 pr-3">
                            <BarraMeta feito={v.efetivas} meta={v.metaPeriodo} />
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono whitespace-nowrap">
                            <span className="text-sky-300">{v.efetivasPorTipo.lead}</span> · <span className="text-gold-300">{v.efetivasPorTipo.carteira}</span> ·{' '}
                            <span className="text-violet-300">{v.efetivasPorTipo.prospeccao}</span> ·{' '}
                            <span className="text-dark-400">{v.efetivasPorTipo.cliente + v.efetivasPorTipo.nao_identificado}</span>
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono text-dark-300">
                            {v.feitas} / {v.recebidas}
                          </td>
                          <td className="py-1.5 text-right font-mono">{duracao(v.segundosFalados)}</td>
                        </tr>
                      ))}
                      {!data?.porVendedor.length && (
                        <tr>
                          <td colSpan={11} className="py-3 text-dark-400">
                            Nenhuma ligação no período.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-dark-100">
                    Ligações {data && data.totalChamadas > data.chamadas.length ? `(mostrando ${data.chamadas.length} de ${data.totalChamadas})` : ''}
                  </h2>
                  <div className="flex gap-1">
                    {(['todas', 'efetivas', 'tentativas'] as const).map((x) => (
                      <button
                        key={x}
                        type="button"
                        onClick={() => setFiltro(x)}
                        className={`px-2.5 py-1 rounded-lg text-xs border ${filtro === x ? 'border-gold-600 text-gold-300 bg-gold-900/10' : 'border-dark-600 text-dark-300'}`}
                      >
                        {x === 'todas' ? 'Todas' : x === 'efetivas' ? 'Só efetivas' : 'Só tentativas'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-dark-400 text-left">
                        <th className="py-1.5 pr-2 font-medium" />
                        <th className="py-1.5 pr-3 font-medium">Quando</th>
                        <th className="py-1.5 pr-3 font-medium">Vendedor</th>
                        <th className="py-1.5 pr-3 font-medium">Número</th>
                        <th className="py-1.5 pr-3 font-medium">Cliente / lead</th>
                        <th className="py-1.5 pr-3 font-medium">Situação</th>
                        <th className="py-1.5 font-medium text-right">Duração</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chamadas.map((c) => {
                        const st = STATUS[c.status ?? ''] ?? { label: c.efetiva ? 'Efetiva' : 'Tentativa', classe: 'bg-dark-700 text-dark-300 border-dark-600' }
                        const temDetalhe = !!(c.resumo || c.transcricao || c.linkGravacao || c.motivo)
                        return (
                          <Fragment key={c.id}>
                            <tr className={`border-t border-dark-700/70 ${temDetalhe ? 'cursor-pointer hover:bg-dark-700/30' : ''}`} onClick={() => temDetalhe && setAberta(aberta === c.id ? null : c.id)}>
                              <td className="py-1.5 pr-2 text-dark-400">
                                {temDetalhe ? aberta === c.id ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
                              </td>
                              <td className="py-1.5 pr-3 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1">
                                  {c.direcao === 'INBOUND' ? <PhoneIncoming size={13} className="text-sky-300" /> : <PhoneOutgoing size={13} className="text-gold-300" />}
                                  {dataHoraBr(c.dataHora)}
                                </span>
                              </td>
                              <td className="py-1.5 pr-3 whitespace-nowrap">{c.vendedor ?? (c.ramal ? `Ramal ${c.ramal}` : '—')}</td>
                              <td className="py-1.5 pr-3 whitespace-nowrap font-mono text-dark-300">{telefone(c.numero)}</td>
                              <td className="py-1.5 pr-3">
                                {c.contato ?? <span className="text-dark-500">não encontrado no CRM</span>}
                                <span className={`ml-1.5 text-[10px] uppercase ${TIPO[c.tipo]?.classe ?? ''}`}>{TIPO[c.tipo]?.label ?? ''}</span>
                              </td>
                              <td className="py-1.5 pr-3 whitespace-nowrap">
                                <span className={`text-xs rounded-full border px-2 py-0.5 ${st.classe}`}>{st.label}</span>
                              </td>
                              <td className="py-1.5 text-right font-mono whitespace-nowrap">{duracao(c.duracao)}</td>
                            </tr>
                            {aberta === c.id && (
                              <tr className="bg-dark-900/40">
                                <td />
                                <td colSpan={6} className="py-2 pr-3 space-y-2 text-sm">
                                  {c.linkGravacao && <GravacaoLigacao ligacaoId={c.id} partes={c.linkGravacao.split('\n').filter(Boolean).length} />}
                                  {c.resumo && (
                                    <p>
                                      <span className="text-dark-400">Resumo: </span>
                                      {c.resumo}
                                    </p>
                                  )}
                                  {c.transcricao && (
                                    <details>
                                      <summary className="text-dark-400 cursor-pointer">Transcrição</summary>
                                      <p className="whitespace-pre-wrap text-dark-300 mt-1">{c.transcricao}</p>
                                    </details>
                                  )}
                                  {c.motivo && <p className="text-xs text-dark-500">Não registrada no CRM: {c.motivo}</p>}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                      {!chamadas.length && (
                        <tr>
                          <td colSpan={7} className="py-3 text-dark-400">
                            Nenhuma ligação neste filtro.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

