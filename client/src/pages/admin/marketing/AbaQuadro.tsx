// Quadro por etapa (estilo Trello/ClickUp): arrasta a peça entre as etapas,
// mostra responsável, prazo (data de postar), atrasadas em vermelho e peças
// paradas. Também cria as peças da semana e gera o link de aprovação.
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../../lib/trpc'
import { useAuth } from '../../../contexts/AuthContext'
import Button from '../../../components/ui/Button'
import LinkAprovacao from './LinkAprovacao'
import { STATUS, atrasada, cls, diaLabel, diasParada, hojeBR, iniciais, nomeCurtoMarca, semanasDoMes, faixaSemana } from './comum'
import type { Peca } from './PecaModal'

type Marca = { empresaId: number; nome: string }

export default function AbaQuadro({ mes, marcas, pecas, abrirPeca }: { mes: string; marcas: Marca[]; pecas: Peca[]; abrirPeca: (p: Peca) => void }) {
  const { user } = useAuth()
  const utils = trpc.useUtils()
  const [fMarca, setFMarca] = useState<number | 0>(0)
  const [fResp, setFResp] = useState<'todos' | 'meus' | 'sem'>('todos')
  const [fSemana, setFSemana] = useState(0)
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [linkAberto, setLinkAberto] = useState(false)
  const equipe = trpc.marketingFluxo.equipe.useQuery()
  const auto = trpc.marketingFluxo.autoSemana.useQuery()
  const salvarAuto = trpc.marketingFluxo.salvarAutoSemana.useMutation({ onSuccess: () => utils.marketingFluxo.autoSemana.invalidate() })
  const retornos = trpc.marketingFluxo.ultimosRetornos.useQuery({ pecaIds: pecas.map((p) => p.id) }, { enabled: pecas.length > 0 })
  const mover = trpc.marketingModulo.salvarPeca.useMutation({ onSuccess: () => utils.marketingModulo.pecas.invalidate(), onError: (e) => toast.error(e.message) })
  const gerar = trpc.marketingFluxo.gerarSemana.useMutation({
    onSuccess: (r) => {
      utils.marketingModulo.pecas.invalidate(); utils.marketingModulo.planos.invalidate()
      toast.success(r.total ? `${r.total} peças criadas (${r.marcas.filter((m) => m.videos + m.posts).map((m) => `${nomeCurtoMarca(m.nome)}: ${m.videos}V ${m.posts}P`).join(' · ')})` : 'Todas as marcas já têm as peças da semana.', { duration: 8000 })
    },
    onError: (e) => toast.error(e.message),
  })

  const semanas = semanasDoMes(mes)
  const nomeMarca = (id: number) => nomeCurtoMarca(marcas.find((m) => m.empresaId === id)?.nome || '')
  const nomePessoa = (id?: number | null) => equipe.data?.find((u) => u.id === id)?.name || ''
  const lista = useMemo(() => {
    let l = pecas
    if (fMarca) l = l.filter((p) => p.empresaId === fMarca)
    if (fResp === 'meus') l = l.filter((p) => p.responsavelId === user?.id)
    if (fResp === 'sem') l = l.filter((p) => !p.responsavelId)
    if (fSemana) { const [a, b] = faixaSemana(mes, semanas[fSemana - 1]); l = l.filter((p) => p.data && p.data >= a && p.data <= b) }
    return [...l].sort((a, b) => (a.data || '9').localeCompare(b.data || '9'))
  }, [pecas, fMarca, fResp, fSemana, user?.id])

  // Carga da semana atual por pessoa (peças ainda não agendadas).
  const carga = useMemo(() => {
    const h = hojeBR()
    const w = semanas.find((s) => { const [a, b] = faixaSemana(mes, s); return h >= a && h <= b })
    if (!w) return []
    const [a, b] = faixaSemana(mes, w)
    const abertas = pecas.filter((p) => p.data && p.data >= a && p.data <= b && !['Agendado na mLabs', 'Publicado'].includes(p.status))
    const m = new Map<string, number>()
    abertas.forEach((p) => { const k = nomePessoa(p.responsavelId) || 'Sem responsável'; m.set(k, (m.get(k) || 0) + 1) })
    return [...m.entries()].sort((x, y) => y[1] - x[1])
  }, [pecas, equipe.data])

  const atrasadas = lista.filter(atrasada).length
  const paradas = lista.filter((p) => diasParada(p) >= 3).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {[{ empresaId: 0, nome: 'Todas' }, ...marcas].map((m) => (
            <button key={m.empresaId} onClick={() => setFMarca(m.empresaId)} className={`px-3 py-1 rounded-full text-xs border ${fMarca === m.empresaId ? 'bg-dark-100 text-dark-900 border-dark-100 font-semibold' : 'border-dark-600 text-dark-300'}`}>{nomeCurtoMarca(m.nome)}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={cls.input + ' w-auto'} value={fSemana} onChange={(e) => setFSemana(Number(e.target.value))}><option value={0}>Mês inteiro</option>{semanas.map((s) => <option key={s.n} value={s.n}>Semana {s.n} ({s.ini}–{s.fim})</option>)}</select>
          <select className={cls.input + ' w-auto'} value={fResp} onChange={(e) => setFResp(e.target.value as any)}><option value="todos">Todos</option><option value="meus">Só as minhas</option><option value="sem">Sem responsável</option></select>
          <Button size="sm" variant="secondary" onClick={() => gerar.mutate({ empresaId: fMarca || undefined })} loading={gerar.isPending}>Criar peças da semana</Button>
          <Button size="sm" onClick={() => setLinkAberto(true)}>Link de aprovação</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="text-dark-300">{lista.length} peças</span>
        {atrasadas > 0 && <span className="text-red-400 font-semibold">{atrasadas} atrasadas</span>}
        {paradas > 0 && <span className="text-orange-300">{paradas} paradas há 3+ dias</span>}
        {carga.length > 0 && <span className="text-dark-400">Carga desta semana: {carga.map(([n, q]) => <b key={n} className="text-dark-200 mr-2">{n.split(' ')[0]} {q}</b>)}</span>}
        <label className="ml-auto flex items-center gap-2 text-dark-400 cursor-pointer">
          <input type="checkbox" checked={!!auto.data?.ligado} onChange={(e) => salvarAuto.mutate({ ligado: e.target.checked })} />
          Criar sozinho toda segunda às 6h (meta da semana de cada marca)
        </label>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3">
        {STATUS.map((st) => {
          const col = lista.filter((p) => (p.status || 'Ideia') === st)
          return (
            <div key={st} className={`min-w-[250px] w-[250px] flex-shrink-0 rounded-xl border ${arrastando ? 'border-dashed border-dark-500' : 'border-dark-700'} bg-dark-900/40`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); setArrastando(null); const p = pecas.find((x) => x.id === id); if (p && p.status !== st) mover.mutate({ id, status: st }) }}>
              <div className="px-3 py-2 border-b border-dark-700 flex justify-between text-sm"><b className="text-dark-100">{st}</b><span className="text-dark-400">{col.length}</span></div>
              <div className="p-2 space-y-2 min-h-[120px]">
                {col.map((p) => {
                  const atr = atrasada(p)
                  const par = diasParada(p)
                  const ret = retornos.data?.[p.id]
                  const resp = nomePessoa(p.responsavelId)
                  const feitos = (p.checklist || []).filter((c) => c.ok).length
                  return (
                    <div key={p.id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); setArrastando(p.id) }} onDragEnd={() => setArrastando(null)} onClick={() => abrirPeca(p)}
                      className={`cursor-pointer rounded-lg p-2.5 space-y-1.5 border bg-dark-800 hover:border-dark-500 ${atr ? 'border-red-600' : 'border-dark-700'}`}>
                      <div className="flex justify-between text-[11px] text-dark-400"><span>{nomeMarca(p.empresaId)} · {p.tipo}</span><span className={atr ? 'text-red-400 font-semibold' : ''}>{diaLabel(p.data)}</span></div>
                      <div className="text-sm font-semibold text-dark-100 leading-snug">{p.titulo || 'Sem título'}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {resp ? <span title={resp} className="w-6 h-6 rounded-full bg-gold-900/50 text-gold-200 flex items-center justify-center font-bold">{iniciais(resp)}</span> : <span className="text-dark-500">sem responsável</span>}
                        {(p.checklist || []).length > 0 && <span className="text-dark-300">☑ {feitos}/{p.checklist!.length}</span>}
                        {atr && <span className="text-red-400 font-semibold">atrasada</span>}
                        {!atr && par >= 3 && <span className="text-orange-300">parada {par}d</span>}
                        {ret?.tipo === 'ajuste' && <span className="text-yellow-300" title={ret.texto}>ajuste pedido</span>}
                        {ret?.tipo === 'aprovado' && <span className="text-green-400">aprovada</span>}
                        {p.origem === 'auto' && p.titulo.includes('pauta a definir') && <span className="text-dark-500">automática</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <LinkAprovacao open={linkAberto} onClose={() => setLinkAberto(false)} pecas={lista.filter((p) => !['Agendado na mLabs', 'Publicado'].includes(p.status))}
        tituloPadrao={`Aprovação de conteúdo${fMarca ? ' · ' + nomeMarca(fMarca) : ''}${fSemana ? ' · semana ' + fSemana : ''}`} nomeMarca={nomeMarca} />
    </div>
  )
}
