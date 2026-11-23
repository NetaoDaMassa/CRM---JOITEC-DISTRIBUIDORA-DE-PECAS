// Módulo Marketing — central do setor de marketing das 5 marcas do grupo.
// Pedido do João, 2026-11-20: trazer para dentro do CRM o painel que estava
// no claude.ai (metas semanais, revisão de roteiros, Radar do Instagram,
// persona/SWOT, calendário, plano do mês e brainstorm).
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Target, ClipboardCheck, Radar, Building2, CalendarDays, Map, Lightbulb, Plug, KanbanSquare, Inbox } from 'lucide-react'
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
import PecaModal, { type Peca } from './marketing/PecaModal'
import { mesAtual, mesLongo, mesSomar } from './marketing/comum'

type Aba = 'metas' | 'quadro' | 'pedidos' | 'revisao' | 'radar' | 'empresa' | 'calendario' | 'plano' | 'brainstorm' | 'conexoes'
// Ordem do trabalho do mês (João, 2026-11-23): 1. Planejar → 2. Produzir → 3. Acompanhar.
type Grupo = '1. Planejar' | '2. Produzir' | '3. Acompanhar' | 'Ajustes'
const ABAS: { id: Aba; rotulo: string; icone: typeof Target; porMarca?: boolean; soSuper?: boolean; grupo: Grupo }[] = [
  { id: 'empresa', rotulo: 'Empresa', icone: Building2, porMarca: true, grupo: '1. Planejar' },
  { id: 'brainstorm', rotulo: 'Brainstorm', icone: Lightbulb, porMarca: true, grupo: '1. Planejar' },
  { id: 'plano', rotulo: 'Plano do mês', icone: Map, porMarca: true, grupo: '1. Planejar' },
  { id: 'calendario', rotulo: 'Calendário', icone: CalendarDays, porMarca: true, grupo: '1. Planejar' },
  { id: 'pedidos', rotulo: 'Pedidos', icone: Inbox, grupo: '2. Produzir' },
  { id: 'quadro', rotulo: 'Quadro', icone: KanbanSquare, grupo: '2. Produzir' },
  { id: 'revisao', rotulo: 'Revisão', icone: ClipboardCheck, grupo: '2. Produzir' },
  { id: 'metas', rotulo: 'Metas', icone: Target, grupo: '3. Acompanhar' },
  { id: 'radar', rotulo: 'Radar', icone: Radar, porMarca: true, grupo: '3. Acompanhar' },
  { id: 'conexoes', rotulo: 'Conexões', icone: Plug, soSuper: true, grupo: 'Ajustes' },
]

function lerLocal(chave: string, padrao: string) {
  try { return localStorage.getItem(chave) || padrao } catch { return padrao }
}

export default function MarketingModulo() {
  const { user } = useAuth()
  const superAdmin = !!(user as { superAdmin?: boolean } | null)?.superAdmin
  const utils = trpc.useUtils()
  const [aba, setAbaS] = useState<Aba>(() => lerLocal('mkt_aba', 'metas') as Aba)
  const [mes, setMes] = useState(mesAtual())
  const [empresaId, setEmpS] = useState<number>(() => Number(lerLocal('mkt_marca', '4')))
  const [aberta, setAberta] = useState<Peca | null>(null)
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-dark-400">Grupo Odin · Marketing</div>
          <h1 className="text-3xl font-bold text-dark-100">Marketing</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setMes(mesSomar(mes, -1))}>←</Button>
          <span className="min-w-[150px] text-center font-semibold text-dark-100 capitalize">{mesLongo(mes)}</span>
          <Button variant="secondary" size="sm" onClick={() => setMes(mesSomar(mes, 1))}>→</Button>
          {mes !== mesAtual() && <Button variant="ghost" size="sm" onClick={() => setMes(mesAtual())}>Hoje</Button>}
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto border-b border-dark-700">
        {(['1. Planejar', '2. Produzir', '3. Acompanhar', 'Ajustes'] as Grupo[]).map((g) => {
          const abas = ABAS.filter((a) => a.grupo === g && (!a.soSuper || superAdmin))
          if (!abas.length) return null
          return (
            <div key={g} className="flex flex-col shrink-0">
              <span className="px-4 text-[10px] font-semibold uppercase tracking-wider text-dark-500">{g}</span>
              <div className="flex gap-1">
                {abas.map((a) => (
                  <button key={a.id} onClick={() => setAba(a.id)} className={`flex items-center gap-1.5 px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px ${aba === a.id ? 'border-gold-400 text-gold-200 font-semibold' : 'border-transparent text-dark-400 hover:text-dark-100'}`}>
                    <a.icone className="w-4 h-4" />{a.rotulo}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {abaInfo.porMarca && (
        <div className="flex flex-wrap gap-2">
          {listaMarcas.map((m) => (
            <button key={m.empresaId} onClick={() => setEmpresaId(m.empresaId)} className={`px-3 py-1.5 rounded-full text-sm border ${empresaId === m.empresaId ? 'bg-dark-100 text-dark-900 border-dark-100 font-semibold' : 'border-dark-600 text-dark-300 hover:text-dark-100'}`}>{m.nome}</button>
          ))}
        </div>
      )}

      {aba === 'metas' && <AbaMetas mes={mes} marcas={listaMarcas} pecas={(pecasMes.data || []) as Peca[]} temPlano={(id) => (planos.data || []).some((p) => p.empresaId === id && p.mes === mes)} abrirPeca={setAberta} />}
      {aba === 'quadro' && <AbaQuadro mes={mes} marcas={listaMarcas} pecas={(pecasMes.data || []) as Peca[]} abrirPeca={setAberta} />}
      {aba === 'pedidos' && <AbaPedidos />}
      {aba === 'revisao' && <AbaRevisao mes={mes} marcas={listaMarcas} pecas={(pecasMes.data || []) as Peca[]} abrirPeca={setAberta} />}
      {aba === 'radar' && <AbaRadar empresaId={empresaId} nomeMarca={nomeMarca} mes={mes} plano={plano} />}
      {aba === 'empresa' && <AbaEmpresa empresaId={empresaId} nomeMarca={nomeMarca} mes={mes} />}
      {aba === 'calendario' && (plano ? <AbaCalendario plano={plano} pecas={(pecasPlano.data || []) as Peca[]} abrirPeca={setAberta} salvarDados={(d) => salvarPlano.mutate({ id: plano.id, dados: d })} /> : semPlano)}
      {aba === 'plano' && (plano ? <AbaPlano key={plano.id} plano={plano} nomeMarca={nomeMarca} pecas={(pecasPlano.data || []) as Peca[]} salvarDados={(d) => salvarPlano.mutate({ id: plano.id, dados: d })} /> : semPlano)}
      {aba === 'brainstorm' && <AbaBrainstorm empresaId={empresaId} nomeMarca={nomeMarca} />}
      {aba === 'conexoes' && superAdmin && <AbaConexoes marcas={listaMarcas} />}

      <PecaModal peca={aberta} pilares={aberta ? pilaresDe(aberta.planoId) : []} personaResumo={personaResumo} onClose={() => setAberta(null)} />
    </div>
  )
}
