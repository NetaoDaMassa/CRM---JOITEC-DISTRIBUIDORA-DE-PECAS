// Revisão (João, 2026-11-23): os revisores aprovam o roteiro (libera para
// gravação) e a peça pronta (aprovação final). João revisa vídeo e post,
// Maria só vídeo, Gaby só post (lista em Conexões). Cada mudança que um
// revisor faz no roteiro aparece na cor dele. A nota da IA continua como ajuda.
import { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../../lib/trpc'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import IaAcao, { useIa } from './IaAcao'
import { AnaliseBox, type Peca } from './PecaModal'
import { PreviaAnexo } from './Anexos'
import { CORES_REVISOR, autoria, cls, dataHora, diaLabel, mesLongo, nomeCurtoMarca, precisaAnalise } from './comum'

type Marca = { empresaId: number; nome: string }
type Revisor = { userId: number; nome: string; video: boolean; post: boolean; ordem: number }

function useCores(lista: Revisor[]) {
  return (nome: string | null) => {
    if (!nome) return null
    const i = lista.findIndex((r) => r.nome === nome)
    return CORES_REVISOR[(i < 0 ? lista.length + (nome.length % 3) : i) % CORES_REVISOR.length]
  }
}

function Legenda({ lista }: { lista: Revisor[] }) {
  const cor = useCores(lista)
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-dark-400">Cores:</span>
      <span className="px-2 py-0.5 rounded bg-dark-700 text-dark-200">texto original</span>
      {lista.map((r) => { const c = cor(r.nome)!; return <span key={r.userId} className="px-2 py-0.5 rounded" style={{ background: c.fundo, color: c.texto }}>{r.nome.split(' ')[0]} · {r.video && r.post ? 'vídeo e post' : r.video ? 'só vídeo' : 'só post'}</span> })}
    </div>
  )
}

function RevisarModal({ peca, modo, lista, posso, onClose }: { peca: Peca | null; modo: 'roteiro' | 'final'; lista: Revisor[]; posso: boolean; onClose: () => void }) {
  const utils = trpc.useUtils()
  const versoes = trpc.marketingFluxo.versoes.useQuery({ pecaId: peca?.id || '' }, { enabled: !!peca })
  const [texto, setTexto] = useState(peca?.roteiro || '')
  const [editando, setEditando] = useState(false)
  const [obs, setObs] = useState('')
  const cor = useCores(lista)
  const fim = (msg: string) => { utils.marketingModulo.pecas.invalidate(); utils.marketingFluxo.versoes.invalidate(); toast.success(msg); onClose() }
  const revisar = trpc.marketingFluxo.revisarRoteiro.useMutation({ onError: (e) => toast.error(e.message, { duration: 8000 }) })
  const final = trpc.marketingFluxo.aprovarFinal.useMutation({ onError: (e) => toast.error(e.message, { duration: 8000 }) })
  const trechos = useMemo(() => autoria(versoes.data || [], editando ? texto : peca?.roteiro || ''), [versoes.data, texto, editando, peca?.roteiro])
  if (!peca) return null
  const mudou = texto !== peca.roteiro

  return (
    <Modal open={!!peca} onClose={onClose} title={modo === 'roteiro' ? 'Aprovar roteiro' : 'Aprovação final'} size="xl">
      <div className="space-y-4">
        <div>
          <div className="text-lg font-bold text-dark-100">{peca.titulo || 'Sem título'}</div>
          <div className="text-xs text-dark-400">{peca.tipo} · {diaLabel(peca.data)}{peca.gancho ? ` · Gancho: ${peca.gancho}` : ''}</div>
        </div>

        {modo === 'final' && (
          <div className="space-y-2">
            {(peca.anexos || []).length ? (peca.anexos || []).map((a) => (
              <div key={a.arquivoId} className="space-y-1"><PreviaAnexo a={a} grande /><a href={a.path} target="_blank" rel="noopener noreferrer" className="text-sm text-gold-400 hover:underline">{a.nome}</a></div>
            )) : <p className="text-sm text-orange-300">Sem anexo — não dá para aprovar.</p>}
            {peca.legenda && <div><div className={cls.rotulo}>Legenda</div><p className="text-sm text-dark-200 whitespace-pre-wrap bg-dark-900 rounded-lg p-3">{peca.legenda}</p></div>}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cls.rotulo}>Roteiro</span>
            {modo === 'roteiro' && posso && <Button size="sm" variant="ghost" onClick={() => setEditando(!editando)}>{editando ? 'Ver mudanças coloridas' : '✏️ Editar o roteiro'}</Button>}
          </div>
          <Legenda lista={lista} />
          {editando ? (
            <textarea className={cls.input + ' font-mono text-[13px] leading-relaxed'} rows={16} value={texto} onChange={(e) => setTexto(e.target.value)} />
          ) : (
            <div className="bg-dark-900 border border-dark-700 rounded-lg p-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-dark-200">
              {trechos.map((t, i) => { const c = cor(t.autor); return c ? <span key={i} title={`Mudado por ${t.autor}`} style={{ background: c.fundo, color: c.texto }}>{t.t}</span> : <span key={i}>{t.t}</span> })}
              {!peca.roteiro && <span className="text-dark-500">Sem roteiro.</span>}
            </div>
          )}
          {(versoes.data || []).length > 0 && (
            <div className="text-xs text-dark-400">Histórico: {(versoes.data || []).map((v) => { const c = v.revisor ? cor(v.autorNome) : null; return <span key={v.id} className="mr-2"><b style={c ? { color: c.texto } : undefined}>{v.autorNome}</b> {dataHora(v.createdAt)}</span> })}</div>
          )}
        </div>

        {modo === 'roteiro' && peca.analise && <div className="bg-dark-900/60 border border-dark-700 rounded-xl p-3"><div className={cls.rotulo + ' mb-1'}>Nota da IA (ajuda)</div><AnaliseBox a={peca.analise} peca={peca} /></div>}

        {posso ? (
          <div className="space-y-2 border-t border-dark-700 pt-3">
            <textarea rows={2} className={cls.input} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Comentário (obrigatório para pedir ajuste)" />
            <div className="flex flex-wrap justify-end gap-2">
              {modo === 'roteiro' && editando && <Button variant="secondary" disabled={!mudou} loading={revisar.isPending} onClick={() => revisar.mutate({ pecaId: peca.id, roteiro: texto, acao: 'salvar' }, { onSuccess: () => { utils.marketingModulo.pecas.invalidate(); utils.marketingFluxo.versoes.invalidate(); setEditando(false); toast.success('Mudanças salvas na sua cor') } })}>Salvar mudanças</Button>}
              <Button variant="outline" loading={revisar.isPending || final.isPending} onClick={() => (modo === 'roteiro'
                ? revisar.mutate({ pecaId: peca.id, roteiro: mudou ? texto : undefined, acao: 'ajuste', texto: obs }, { onSuccess: () => fim('Voltou para Roteiro com o seu pedido de ajuste') })
                : final.mutate({ pecaId: peca.id, acao: 'ajuste', texto: obs }, { onSuccess: () => fim('Voltou para Produção com o seu pedido de ajuste') }))}>Pedir ajuste</Button>
              <Button loading={revisar.isPending || final.isPending} onClick={() => (modo === 'roteiro'
                ? revisar.mutate({ pecaId: peca.id, roteiro: mudou ? texto : undefined, acao: 'aprovar', texto: obs }, { onSuccess: () => fim('Roteiro aprovado — liberado para gravação') })
                : final.mutate({ pecaId: peca.id, acao: 'aprovar', texto: obs }, { onSuccess: () => fim('Aprovado — pode agendar na mLabs') }))}>
                {modo === 'roteiro' ? '✅ Aprovar roteiro (liberar gravação)' : '✅ Aprovar — pode agendar'}
              </Button>
            </div>
          </div>
        ) : <p className="text-sm text-dark-400 border-t border-dark-700 pt-3">Você não revisa {peca.tipo === 'Post' ? 'posts' : 'vídeos'}. Quem revisa: {lista.filter((r) => (peca.tipo === 'Post' ? r.post : r.video)).map((r) => r.nome.split(' ')[0]).join(', ') || 'ninguém cadastrado (Conexões → Revisores)'}.</p>}
      </div>
    </Modal>
  )
}

export default function AbaRevisao({ mes, marcas, pecas, abrirPeca }: { mes: string; marcas: Marca[]; pecas: Peca[]; abrirPeca: (p: Peca) => void }) {
  const utils = trpc.useUtils()
  const { temChave, executar } = useIa()
  const rev = trpc.marketingFluxo.revisores.useQuery()
  const lista = (rev.data?.lista || []) as Revisor[]
  const eu = rev.data?.eu || { video: false, post: false }
  const posso = (p: Peca) => (p.tipo === 'Post' ? eu.post : eu.video)
  const [filtro, setFiltro] = useState<number | 'todas'>('todas')
  const [aberta, setAberta] = useState<{ p: Peca; modo: 'roteiro' | 'final' } | null>(null)
  const [prog, setProg] = useState<{ feitos: number; total: number } | null>(null)
  const parar = useRef(false)

  const l = pecas.filter((p) => filtro === 'todas' || p.empresaId === filtro)
  const nome = (id: number) => nomeCurtoMarca(marcas.find((m) => m.empresaId === id)?.nome || '')
  const roteiros = l.filter((p) => p.status === 'Aprovação do roteiro').sort((a, b) => (a.data || '').localeCompare(b.data || ''))
  const finais = l.filter((p) => p.status === 'Aprovação final' && !p.finalAprovadoEm).sort((a, b) => (a.data || '').localeCompare(b.data || ''))
  const escrevendo = l.filter((p) => ['Ideia', 'Roteiro'].includes(p.status) && p.origem !== 'complementar')
  const semNota = l.filter((p) => ['Roteiro', 'Aprovação do roteiro'].includes(p.status) && precisaAnalise(p))

  const notaTodas = async () => {
    parar.current = false
    const ids = semNota.map((p) => p.id)
    setProg({ feitos: 0, total: ids.length })
    for (let i = 0; i < ids.length && !parar.current; i += 5) {
      try { await executar.mutateAsync({ tipo: 'revisao', params: { pecaIds: ids.slice(i, i + 5) } }) } catch (e) { toast.error((e as Error).message, { duration: 9000 }); break }
      setProg({ feitos: Math.min(ids.length, i + 5), total: ids.length })
      utils.marketingModulo.pecas.invalidate()
    }
    setProg(null)
  }

  const Item = ({ p, modo }: { p: Peca; modo: 'roteiro' | 'final' }) => {
    const a = p.analise
    const meu = posso(p)
    return (
      <div className={`bg-dark-800 border border-dark-700 border-l-4 ${meu ? 'border-l-gold-500' : 'border-l-dark-600'} rounded-xl p-3 flex flex-wrap items-center gap-3`}>
        <div className="flex-1 min-w-[220px]">
          <div className="font-semibold text-dark-100">{p.titulo || 'Sem título'}</div>
          <div className="text-xs text-dark-400">{nome(p.empresaId)} · {p.tipo} · {diaLabel(p.data)}{modo === 'final' ? ` · ${(p.anexos || []).length} anexo(s)` : ''}</div>
        </div>
        {modo === 'roteiro' && a && <span className={`text-sm font-bold ${a.veredito === 'aprovar' ? 'text-green-400' : a.veredito === 'ajustar' ? 'text-yellow-400' : 'text-red-400'}`} title={a.resumo}>IA {a.nota}/10</span>}
        {!meu && <span className="text-xs text-dark-500">{p.tipo === 'Post' ? 'post' : 'vídeo'} — não é seu</span>}
        <Button size="sm" variant="ghost" onClick={() => abrirPeca(p)}>Abrir peça</Button>
        <Button size="sm" variant={meu ? 'primary' : 'secondary'} onClick={() => setAberta({ p, modo })}>{meu ? 'Revisar' : 'Ver'}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-dark-100">Revisão · {mesLongo(mes)}</h2>
          <p className="text-sm text-dark-400">
            {eu.video || eu.post ? <>Você revisa <b className="text-dark-200">{eu.video && eu.post ? 'vídeos e posts' : eu.video ? 'só vídeos' : 'só posts'}</b>. As peças que são suas ficam com a borda dourada.</> : 'Você não está na lista de revisores — pode ver, mas não aprovar. (Super admin: Conexões → Revisores.)'}
          </p>
        </div>
        <Legenda lista={lista} />
      </div>
      <div className="flex flex-wrap gap-2">
        {[{ id: 'todas' as const, nome: 'Todas' }, ...marcas.map((m) => ({ id: m.empresaId, nome: nomeCurtoMarca(m.nome) }))].map((m) => (
          <button key={String(m.id)} onClick={() => setFiltro(m.id)} className={`px-3 py-1.5 rounded-full text-sm border ${filtro === m.id ? 'bg-dark-100 text-dark-900 border-dark-100' : 'border-dark-600 text-dark-300 hover:text-dark-100'}`}>{m.nome}</button>
        ))}
      </div>

      <section className="space-y-2">
        <h3 className="text-lg font-bold text-dark-100">1. Roteiros esperando aprovação ({roteiros.length})</h3>
        <p className="text-xs text-dark-400">Aprovar o roteiro manda a peça para Produção com a etiqueta "Liberado para gravação". Pedir ajuste volta para Roteiro.</p>
        {roteiros.length ? roteiros.map((p) => <Item key={p.id} p={p} modo="roteiro" />) : <p className="text-sm text-dark-400">Nenhum roteiro esperando.</p>}
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-bold text-dark-100">2. Aprovação final — vídeo/arte pronto ({finais.length})</h3>
        <p className="text-xs text-dark-400">Veja o anexo. Aprovado, a equipe agenda na mLabs e arrasta para "Agendado na mLabs".</p>
        {finais.length ? finais.map((p) => <Item key={p.id} p={p} modo="final" />) : <p className="text-sm text-dark-400">Nada esperando a aprovação final.</p>}
      </section>

      <section className="bg-dark-800 border border-dark-700 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-dark-100">{prog ? `IA dando nota… ${prog.feitos} de ${prog.total}` : `Nota da IA: ${semNota.length} roteiro(s) sem nota`}</div>
          <div className="text-xs text-dark-400">Ajuda para o revisor: a IA dá nota de 0 a 10 e aponta o que melhorar. Quem aprova é o revisor. {escrevendo.length} peça(s) ainda em Ideia/Roteiro.</div>
        </div>
        {prog && <div className="flex-1 min-w-[160px] h-2 bg-dark-700 rounded-full overflow-hidden"><div className="h-full bg-gold-500" style={{ width: `${Math.round((prog.feitos / Math.max(1, prog.total)) * 100)}%` }} /></div>}
        <div className="flex flex-wrap gap-2">
          {prog ? <Button variant="secondary" onClick={() => { parar.current = true }}>Parar</Button> : semNota.length > 0 && (
            <>
              {temChave && <Button variant="secondary" onClick={notaTodas}>✨ IA, dá nota nesses {semNota.length}</Button>}
              <IaAcao tipo="revisao" params={{ pecaIds: semNota.slice(0, 8).map((p) => p.id) }} rotulo={`Nota em ${Math.min(8, semNota.length)}`} onResultado={() => utils.marketingModulo.pecas.invalidate()} />
            </>
          )}
        </div>
      </section>

      <RevisarModal key={aberta ? aberta.p.id + aberta.modo : 'x'} peca={aberta?.p || null} modo={aberta?.modo || 'roteiro'} lista={lista} posso={!!aberta && posso(aberta.p)} onClose={() => setAberta(null)} />
    </div>
  )
}
