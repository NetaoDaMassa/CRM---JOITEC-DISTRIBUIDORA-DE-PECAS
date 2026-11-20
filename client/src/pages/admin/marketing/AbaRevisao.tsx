// Revisão de roteiros: o Claude dá nota e separa o que precisa do João do que já pode ir pra gravação.
import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../../lib/trpc'
import Button from '../../../components/ui/Button'
import IaAcao, { useIa } from './IaAcao'
import { AnaliseBox, type Peca } from './PecaModal'
import { diaLabel, emRevisao, mesLongo, precisaAnalise } from './comum'

type Marca = { empresaId: number; nome: string }

export default function AbaRevisao({ mes, marcas, pecas, abrirPeca }: { mes: string; marcas: Marca[]; pecas: Peca[]; abrirPeca: (p: Peca) => void }) {
  const utils = trpc.useUtils()
  const { temChave, executar } = useIa()
  const aprovar = trpc.marketingModulo.aprovarPecas.useMutation({ onSuccess: () => utils.marketingModulo.pecas.invalidate() })
  const salvarPeca = trpc.marketingModulo.salvarPeca.useMutation({ onSuccess: () => utils.marketingModulo.pecas.invalidate() })
  const [filtro, setFiltro] = useState<number | 'todas'>('todas')
  const [prog, setProg] = useState<{ feitos: number; total: number } | null>(null)
  const parar = useRef(false)
  const [confirmaTodos, setConfirmaTodos] = useState(false)

  const lista = pecas.filter((p) => filtro === 'todas' || p.empresaId === filtro)
  const nome = (id: number) => marcas.find((m) => m.empresaId === id)?.nome || ''
  const pend = lista.filter((p) => emRevisao(p) && precisaAnalise(p))
  const an = lista.filter((p) => emRevisao(p) && p.analise && !precisaAnalise(p))
  const voce = an.filter((p) => p.analise.veredito !== 'aprovar').sort((a, b) => a.analise.nota - b.analise.nota)
  const prontos = an.filter((p) => p.analise.veredito === 'aprovar').sort((a, b) => (a.data || '').localeCompare(b.data || ''))
  const aprovados = lista.filter((p) => !emRevisao(p))
  const semRot = lista.filter((p) => emRevisao(p) && (p.roteiro || '').trim().length <= 20)

  const revisarTodas = async () => {
    parar.current = false
    const ids = pend.map((p) => p.id)
    setProg({ feitos: 0, total: ids.length })
    for (let i = 0; i < ids.length && !parar.current; i += 5) {
      try {
        await executar.mutateAsync({ tipo: 'revisao', params: { pecaIds: ids.slice(i, i + 5) } })
      } catch (e) {
        toast.error((e as Error).message, { duration: 9000 })
        break
      }
      setProg({ feitos: Math.min(ids.length, i + 5), total: ids.length })
      utils.marketingModulo.pecas.invalidate()
    }
    setProg(null)
  }

  const Item = ({ p, modo }: { p: Peca; modo: 'voce' | 'pronto' | 'pend' }) => {
    const a = p.analise
    const borda = !a ? 'border-l-dark-500' : a.veredito === 'aprovar' ? 'border-l-green-500' : a.veredito === 'ajustar' ? 'border-l-yellow-500' : 'border-l-red-500'
    return (
      <div className={`bg-dark-800 border border-dark-700 border-l-4 ${borda} rounded-xl p-4 space-y-2`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold text-dark-100">{nome(p.empresaId)} · {diaLabel(p.data)} · {p.tipo} — {p.titulo || 'Sem título'}</span>
          {a && <span className="text-xl font-bold text-dark-100">{a.nota}/10</span>}
        </div>
        {a ? <AnaliseBox a={a} peca={p} /> : <p className="text-sm text-dark-400">Ainda não revisado.</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="secondary" onClick={() => abrirPeca(p)}>Abrir peça</Button>
          {a?.gancho && <Button size="sm" variant="outline" onClick={() => salvarPeca.mutate({ id: p.id, gancho: a.gancho })}>Usar gancho sugerido</Button>}
          {modo === 'voce' && <IaAcao pequeno tipo="reescrever" params={{ pecaId: p.id }} rotulo="Claude reescreve" onResultado={(r) => salvarPeca.mutate({ id: p.id, roteiro: r.roteiro })} />}
          <Button size="sm" onClick={() => aprovar.mutate({ ids: [p.id] })}>Aprovar</Button>
        </div>
      </div>
    )
  }
  const Grupo = ({ t, arr, vazio, modo }: { t: string; arr: Peca[]; vazio: string; modo: 'voce' | 'pronto' | 'pend' }) => (
    <section className="space-y-2">
      <h3 className="text-lg font-bold text-dark-100">{t} ({arr.length})</h3>
      {arr.length ? arr.map((p) => <Item key={p.id} p={p} modo={modo} />) : <p className="text-sm text-dark-400">{vazio}</p>}
    </section>
  )
  const Placa = ({ rot, n, txt, alerta }: { rot: string; n: number; txt: string; alerta?: boolean }) => (
    <div className={`bg-dark-800 border rounded-xl p-4 ${alerta && n ? 'border-red-700' : 'border-dark-700'}`}>
      <div className="text-[11px] uppercase tracking-wider text-dark-400">{rot}</div>
      <div className={`text-3xl font-bold ${alerta && n ? 'text-red-400' : 'text-dark-100'}`}>{n}</div>
      <div className="text-xs text-dark-400">{txt}</div>
    </div>
  )

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-dark-100">Revisão de roteiros · {mesLongo(mes)}</h2>
        <p className="text-sm text-dark-400">Você não precisa ler todos. Leia só os vermelhos e amarelos.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {[{ id: 'todas' as const, nome: 'Todas' }, ...marcas.map((m) => ({ id: m.empresaId, nome: m.nome }))].map((m) => (
          <button key={String(m.id)} onClick={() => setFiltro(m.id)} className={`px-3 py-1.5 rounded-full text-sm border ${filtro === m.id ? 'bg-dark-100 text-dark-900 border-dark-100' : 'border-dark-600 text-dark-300 hover:text-dark-100'}`}>{m.nome}</button>
        ))}
      </div>
      <div className="bg-dark-800 border border-dark-700 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-dark-100">{prog ? `Claude revisando… ${prog.feitos} de ${prog.total}` : pend.length ? `${pend.length} roteiro(s) esperando revisão` : 'Todos os roteiros revisados'}</div>
          <div className="text-xs text-dark-400">{temChave ? 'Pelo Claude do CRM (chave da Anthropic) ou copiando o pedido (de 8 em 8).' : 'Sem chave da Anthropic: use Copiar pedido (de 8 em 8 roteiros).'}</div>
        </div>
        {prog && <div className="flex-1 min-w-[160px] h-2 bg-dark-700 rounded-full overflow-hidden"><div className="h-full bg-gold-500" style={{ width: `${Math.round((prog.feitos / Math.max(1, prog.total)) * 100)}%` }} /></div>}
        <div className="flex flex-wrap gap-2">
          {prog ? <Button variant="secondary" onClick={() => { parar.current = true }}>Parar</Button> : (
            <>
              {temChave && pend.length > 0 && <Button onClick={revisarTodas}>✨ Claude, revisa esses {pend.length}</Button>}
              {pend.length > 0 && <IaAcao tipo="revisao" params={{ pecaIds: pend.slice(0, 8).map((p) => p.id) }} rotulo={`Revisar ${Math.min(8, pend.length)}`} onResultado={() => utils.marketingModulo.pecas.invalidate()} />}
            </>
          )}
          {prontos.length > 0 && !prog && (confirmaTodos
            ? <Button onClick={() => { aprovar.mutate({ ids: prontos.map((p) => p.id) }); setConfirmaTodos(false) }}>Confirmar: aprovar {prontos.length}</Button>
            : <Button variant="outline" onClick={() => setConfirmaTodos(true)}>Aprovar os {prontos.length} prontos</Button>)}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Placa rot="Precisam de você" n={voce.length} txt="Nota até 7. Leia só esses." alerta />
        <Placa rot="Prontos pra aprovar" n={prontos.length} txt="Nota 8+. Um clique e vão pra gravação." />
        <Placa rot="Aprovados / em produção" n={aprovados.length} txt="Já saíram da fase de roteiro." />
        <Placa rot="Sem roteiro" n={semRot.length} txt="Abra a peça e use Criar com Claude." />
      </div>
      <Grupo t="Precisam de você" arr={voce} vazio="Nenhum roteiro com problema." modo="voce" />
      <Grupo t="Prontos pra aprovar" arr={prontos} vazio="Nenhum pronto ainda. Peça a revisão acima." modo="pronto" />
      {pend.length > 0 && !prog && <Grupo t="Ainda não revisados" arr={pend} vazio="" modo="pend" />}
    </div>
  )
}
