// Módulo Marketing — central do setor de marketing das 5 marcas do grupo.
// Pedido do João, 2026-11-20: trazer para dentro do CRM o painel que estava
// no claude.ai (metas semanais, revisão de roteiros, Radar do Instagram,
// persona/SWOT, calendário, plano do mês e brainstorm).
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Target, ClipboardCheck, Radar, Building2, CalendarDays, Map, Lightbulb, Plug, KanbanSquare, Inbox, BarChart3, Sun } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import Button from '../../components/ui/Button'
import AbaMetas from './marketing/AbaMetas'
import AbaRevisao from './marketing/AbaRevisao'
import AbaRadar from './marketing/AbaRadar'
import AbaEmpresa from './marketing/AbaEmpresa'
import AbaCalendario from './marketing/AbaCalendario'
import AbaPlano from './marketing/AbaPlano'
import AbaBrainstorm from './marketing/AbaBrainstorm'
import AbaConexoes from './marketing/AbaConexoes'
import AbaQuadro from './marketing/AbaQuadro'
import AbaPedidos from './marketing/AbaPedidos'
import AbaRelatorios from './marketing/AbaRelatorios'
import AbaHoje from './marketing/AbaHoje'
import GuiaMarketing, { DICA_ABA } from './marketing/Guia'
import PecaModal, { type Peca } from './marketing/PecaModal'
import { mesAtual, mesLongo, mesSomar, nomeCurtoMarca } from './marketing/comum'

type Aba = 'hoje' | 'metas' | 'quadro' | 'pedidos' | 'revisao' | 'radar' | 'empresa' | 'calendario' | 'plano' | 'brainstorm' | 'conexoes' | 'relatorios'
const ABAS: { id: Aba; rotulo: string; icone: typeof Target; porMarca?: boolean }[] = [
  { id: 'hoje', rotulo: 'Hoje', icone: Sun, porMarca: true },
  { id: 'plano', rotulo: 'Plano do mês', icone: Map, porMarca: true },
  { id: 'calendario', rotulo: 'Calendário', icone: CalendarDays, porMarca: true },
  { id: 'brainstorm', rotulo: 'Ideias', icone: Lightbulb, porMarca: true },
  { id: 'quadro', rotulo: 'Quadro', icone: KanbanSquare },
  { id: 'pedidos', rotulo: 'Pedidos', icone: Inbox },
  { id: 'revisao', rotulo: 'Revisão', icone: ClipboardCheck },
  { id: 'metas', rotulo: 'Metas', icone: Target },
  { id: 'relatorios', rotulo: 'Relatórios', icone: BarChart3 },
  { id: 'radar', rotulo: 'Radar', icone: Radar, porMarca: true },
  { id: 'empresa', rotulo: 'Empresa', icone: Building2, porMarca: true },
  { id: 'conexoes', rotulo: 'Conexões', icone: Plug },
]
// Design novo (João, 2026-11-23): 5 lugares principais + Empresa e Ajustes.
const SECOES: { id: string; rotulo: string; sub: string; icone: typeof Target; abas: Aba[]; soSuper?: boolean; canto?: boolean }[] = [
  { id: 'hoje', rotulo: 'Hoje', sub: 'o que fazer agora', icone: Sun, abas: ['hoje'] },
  { id: 'planejar', rotulo: 'Planejar', sub: 'plano, calendário, ideias', icone: Map, abas: ['plano', 'calendario', 'brainstorm'] },
  { id: 'produzir', rotulo: 'Produzir', sub: 'quadro e pedidos', icone: KanbanSquare, abas: ['quadro', 'pedidos'] },
  { id: 'aprovar', rotulo: 'Aprovar', sub: 'roteiros e peças prontas', icone: ClipboardCheck, abas: ['revisao'] },
  { id: 'resultados', rotulo: 'Resultados', sub: 'metas, redes, radar', icone: BarChart3, abas: ['metas', 'relatorios', 'radar'] },
  { id: 'empresa', rotulo: 'Empresa', sub: 'documentos e persona', icone: Building2, abas: ['empresa'], canto: true },
  { id: 'ajustes', rotulo: 'Ajustes', sub: 'revisores e conexões', icone: Plug, abas: ['conexoes'], soSuper: true, canto: true },
]

function lerLocal(chave: string, padrao: string) {
  try { return localStorage.getItem(chave) || padrao } catch { return padrao }
}

export default function MarketingModulo() {
  const { user } = useAuth()
  const superAdmin = !!(user as { superAdmin?: boolean } | null)?.superAdmin
  const utils = trpc.useUtils()
  const [aba, setAbaS] = useState<Aba>(() => { const a = lerLocal('mkt_aba', 'hoje') as Aba; return ABAS.some((x) => x.id === a) ? a : 'hoje' })
  const [mes, setMes] = useState(mesAtual())
  const [empresaId, setEmpS] = useState<number>(() => Number(lerLocal('mkt_marca', '4')))
  const [aberta, setAberta] = useState<Peca | null>(null)
  // Guia abre sozinho na primeira visita; depois só pelo botão.
  const [guia, setGuiaS] = useState(() => lerLocal('mkt_guia_visto', '') !== '1')
  const setGuia = (v: boolean) => { setGuiaS(v); if (!v) try { localStorage.setItem('mkt_guia_visto', '1') } catch { /* ok */ } }
  const setAba = (a: Aba) => { setAbaS(a); try { localStorage.setItem('mkt_aba', a) } catch { /* ok */ } }
  const setEmpresaId = (n: number) => { setEmpS(n); try { localStorage.setItem('mkt_marca', String(n)) } catch { /* ok */ } }

  const marcas = trpc.marketingModulo.marcas.useQuery()
  const planos = trpc.marketingModulo.planos.useQuery()
  const pecasMes = trpc.marketingModulo.pecas.useQuery({ mes })
  const plano = useMemo(() => (planos.data || []).find((p) => p.empresaId === empresaId && p.mes === mes) || null, [planos.data, empresaId, mes])
  const pecasPlano = trpc.marketingModulo.pecas.useQuery({ planoId: plano?.id || '' }, { enabled: !!plano })
  const perfil = trpc.marketingModulo.perfil.useQuery({ empresaId })
  const salvarPlano = trpc.marketingModulo.salvarPlano.useMutation({ onSuccess: () => utils.marketingModulo.planos.invalidate(), onError: (e) => toast.error(e.message) })
  const criarPlano = trpc.marketingModulo.criarPlano.useMutation({ onSuccess: () => { utils.marketingModulo.planos.invalidate(); toast.success('Plano criado') }, onError: (e) => toast.error(e.message) })

  const listaMarcas = marcas.data || []
  const nomeMarca = listaMarcas.find((m) => m.empresaId === empresaId)?.nome || ''
  const abaInfo = ABAS.find((a) => a.id === aba)!
  const planoAnterior = (planos.data || []).filter((p) => p.empresaId === empresaId && p.mes < mes).sort((a, b) => b.mes.localeCompare(a.mes))[0]
  const pilaresDe = (planoId: string) => ((planos.data || []).find((p) => p.id === planoId)?.dados?.pilares || []) as { id: string; nome: string; cor?: string }[]
  const personaResumo = useMemo(() => {
    const p = perfil.data
    if (!p || !aberta || aberta.empresaId !== empresaId) return ''
    const ps = p.personas.map((x: any) => [x.nome, x.quem, x.dores && `Dores: ${x.dores}`, x.tom && `Tom: ${x.tom}`].filter(Boolean).join(' · ')).join('\n')
    const sw = Object.entries(p.swot).map(([k, v]) => (v as string[]).length ? `${k}: ${(v as string[]).join('; ')}` : '').filter(Boolean).join('\n')
    return [ps, sw].filter(Boolean).join('\n\n')
  }, [perfil.data, aberta, empresaId])

  const semPlano = (
    <div className="bg-dark-800 border border-dashed border-dark-600 rounded-xl p-8 space-y-3 max-w-xl">
      <h2 className="text-xl font-bold text-dark-100">Sem plano de {nomeMarca} para {mesLongo(mes)}</h2>
      <p className="text-sm text-dark-400">Crie o plano do mês para montar o calendário e as peças.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => criarPlano.mutate({ empresaId, mes, copiarDe: planoAnterior?.id })} loading={criarPlano.isPending}>{planoAnterior ? `Criar copiando pilares de ${mesLongo(planoAnterior.mes)}` : 'Criar plano'}</Button>
        {planoAnterior && <Button variant="secondary" onClick={() => criarPlano.mutate({ empresaId, mes })}>Criar em branco</Button>}
      </div>
    </div>
  )

  const secaoAtual = SECOES.find((x) => x.abas.includes(aba)) || SECOES[0]
  const pecasM = (pecasMes.data || []) as Peca[]
  const aprovarN = pecasM.filter((p) => p.status === 'Aprovação do roteiro' || (p.status === 'Aprovação final' && !p.finalAprovadoEm)).length
  const navBtn = (x: (typeof SECOES)[number]) => {
    const ativo = x.id === secaoAtual.id
    return (
      <button key={x.id} onClick={() => setAba(x.abas[0])} aria-current={ativo ? 'page' : undefined} className={`text-left rounded-xl px-4 py-3 border-2 transition-colors ${ativo ? 'bg-dark-700/70 border-gold-500' : 'bg-dark-800/60 border-dark-700 hover:border-dark-500'}`}>
        <span className="flex items-center gap-2 font-bold text-dark-100"><x.icone className="w-4 h-4" />{x.rotulo}{x.id === 'aprovar' && aprovarN > 0 && <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded-full bg-gold-500 text-dark-900">{aprovarN}</span>}</span>
        <span className="block text-xs text-dark-400 mt-0.5">{x.sub}</span>
      </button>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-dark-400">Grupo Odin · Marketing</div>
          <h1 className="text-3xl font-bold text-dark-100">Marketing</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setGuia(!guia)}>📖 Como funciona</Button>
          <Button variant="secondary" size="sm" onClick={() => setMes(mesSomar(mes, -1))} aria-label="Mês anterior">←</Button>
          <span className="min-w-[150px] text-center font-semibold text-dark-100 capitalize">{mesLongo(mes)}</span>
          <Button variant="secondary" size="sm" onClick={() => setMes(mesSomar(mes, 1))} aria-label="Próximo mês">→</Button>
          {mes !== mesAtual() && <Button variant="ghost" size="sm" onClick={() => setMes(mesAtual())}>Mês atual</Button>}
        </div>
      </div>

      {guia && <GuiaMarketing fechar={() => setGuia(false)} />}

      <nav className="flex flex-wrap gap-2.5" aria-label="Seções do marketing">
        <div className="grid gap-2.5 flex-[999_1_640px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>{SECOES.filter((x) => !x.canto).map(navBtn)}</div>
        <div className="grid gap-2.5 flex-[1_1_300px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>{SECOES.filter((x) => x.canto && (!x.soSuper || superAdmin)).map(navBtn)}</div>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {secaoAtual.abas.length > 1 ? (
          <div className="flex flex-wrap gap-2" role="tablist">
            {secaoAtual.abas.map((id) => { const a = ABAS.find((x) => x.id === id)!; return (
              <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold ${aba === id ? 'bg-dark-100 text-dark-900' : 'border border-dark-600 text-dark-300 hover:text-dark-100'}`}><a.icone className="w-4 h-4" />{a.rotulo}</button>
            ) })}
          </div>
        ) : <span />}
        {abaInfo.porMarca && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Marca">
            {listaMarcas.map((m) => (
              <button key={m.empresaId} onClick={() => setEmpresaId(m.empresaId)} className={`px-3 py-1.5 rounded-full text-sm border ${empresaId === m.empresaId ? 'bg-dark-100 text-dark-900 border-dark-100 font-semibold' : 'border-dark-600 text-dark-300 hover:text-dark-100'}`}>{nomeCurtoMarca(m.nome)}</button>
            ))}
          </div>
        )}
      </div>

      {DICA_ABA[aba] && <p className="text-xs text-dark-400 -mt-2">💡 {DICA_ABA[aba]}</p>}

      {aba === 'hoje' && <AbaHoje mes={mes} marcas={listaMarcas} pecas={pecasM} empresaId={empresaId} irPara={(a: Aba) => setAba(a)} abrirPeca={setAberta} pilaresDe={pilaresDe} />}
      {aba === 'metas' && <AbaMetas mes={mes} marcas={listaMarcas} pecas={(pecasMes.data || []) as Peca[]} temPlano={(id) => (planos.data || []).some((p) => p.empresaId === id && p.mes === mes)} abrirPeca={setAberta} />}
      {aba === 'quadro' && <AbaQuadro mes={mes} marcas={listaMarcas} pecas={(pecasMes.data || []) as Peca[]} abrirPeca={setAberta} />}
      {aba === 'pedidos' && <AbaPedidos />}
      {aba === 'revisao' && <AbaRevisao mes={mes} marcas={listaMarcas} pecas={(pecasMes.data || []) as Peca[]} abrirPeca={setAberta} />}
      {aba === 'radar' && <AbaRadar empresaId={empresaId} nomeMarca={nomeMarca} mes={mes} plano={plano} />}
      {aba === 'empresa' && <AbaEmpresa empresaId={empresaId} nomeMarca={nomeMarca} mes={mes} />}
      {aba === 'calendario' && (plano ? <AbaCalendario plano={plano} pecas={(pecasPlano.data || []) as Peca[]} abrirPeca={setAberta} salvarDados={(d) => salvarPlano.mutate({ id: plano.id, dados: d })} /> : semPlano)}
      {aba === 'plano' && (plano ? <AbaPlano key={plano.id} plano={plano} nomeMarca={nomeMarca} pecas={(pecasPlano.data || []) as Peca[]} salvarDados={(d) => salvarPlano.mutate({ id: plano.id, dados: d })} /> : semPlano)}
      {aba === 'brainstorm' && <AbaBrainstorm empresaId={empresaId} nomeMarca={nomeMarca} mes={mes} />}
      {aba === 'relatorios' && <AbaRelatorios mes={mes} marcas={listaMarcas} />}
      {aba === 'conexoes' && superAdmin && <AbaConexoes marcas={listaMarcas} />}

      <PecaModal peca={aberta} pilares={aberta ? pilaresDe(aberta.planoId) : []} personaResumo={personaResumo} onClose={() => setAberta(null)} />
    </div>
  )
}
