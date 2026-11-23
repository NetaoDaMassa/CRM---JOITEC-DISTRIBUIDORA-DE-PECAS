// Editar uma peça (pauta, roteiro, legenda…) com Criar/Analisar/Reescrever pelo Claude.
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../../lib/trpc'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import IaAcao, { useIa } from './IaAcao'
import Anexos from './Anexos'
import { CANAIS, CANAIS_P, CANAIS_V, MODELO_P, MODELO_V, STATUS, cls, dataHora, rotHash, type Anexo } from './comum'

export type Peca = {
  id: string; empresaId: number; planoId: string; data: string | null; hora: string | null; tipo: string; pilar: string | null
  titulo: string; gancho: string; cta: string; canais: string[]; status: string; roteiro: string; legenda: string; obs: string; analise: any
  responsavelId?: number | null; checklist?: { t: string; ok: boolean }[]; origem?: string; linkMidia?: string; updatedAt?: string
  anexos?: Anexo[]; roteiroAprovadoEm?: string | null; roteiroAprovadoPor?: string | null; finalAprovadoEm?: string | null; finalAprovadoPor?: string | null
}
type Pilar = { id: string; nome: string; cor?: string; desc?: string }

// A etapa (status) não vai aqui: ela é salva na hora pelo seletor, com as travas.
function paraSalvar(x: Peca) {
  const { id, data, hora, tipo, pilar, titulo, gancho, cta, canais, roteiro, legenda, obs, responsavelId, checklist, linkMidia } = x
  return { id, data: data || null, hora: hora || null, tipo: tipo as 'Vídeo' | 'Post', pilar, titulo, gancho, cta, canais, roteiro, legenda, obs, responsavelId: responsavelId ?? null, checklist: checklist || [], linkMidia: linkMidia || '' }
}

function Comentarios({ pecaId }: { pecaId: string }) {
  const utils = trpc.useUtils()
  const q = trpc.marketingFluxo.comentarios.useQuery({ pecaId })
  const [t, setT] = useState('')
  const enviar = trpc.marketingFluxo.comentar.useMutation({ onSuccess: () => { setT(''); utils.marketingFluxo.comentarios.invalidate({ pecaId }); utils.marketingFluxo.ultimosRetornos.invalidate() }, onError: (e) => toast.error(e.message) })
  const icone: Record<string, string> = { aprovado: '✅', ajuste: '✏️', comentario: '💬' }
  return (
    <div className="space-y-2">
      <span className={cls.rotulo}>Comentários e revisões</span>
      <div className="flex gap-2">
        <input className={cls.input} placeholder="Escreva um comentário para a equipe…" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && t.trim()) enviar.mutate({ pecaId, texto: t }) }} />
        <Button size="sm" onClick={() => enviar.mutate({ pecaId, texto: t })} disabled={!t.trim()} loading={enviar.isPending}>Enviar</Button>
      </div>
      {(q.data || []).map((c) => (
        <div key={c.id} className={`text-sm rounded-lg px-3 py-2 ${c.tipo === 'ajuste' ? 'bg-yellow-900/20 border border-yellow-800/40' : c.tipo === 'aprovado' ? 'bg-green-900/20 border border-green-800/40' : 'bg-dark-900/60'}`}>
          <div className="text-xs text-dark-400">{icone[c.tipo] || '💬'} <b className="text-dark-200">{c.autorNome}</b> · {dataHora(c.createdAt)}{c.tipo === 'aprovado' ? ' · aprovou' : c.tipo === 'ajuste' ? ' · pediu ajuste' : ''}</div>
          {c.texto && <div className="text-dark-100 whitespace-pre-wrap">{c.texto}</div>}
        </div>
      ))}
    </div>
  )
}

export function AnaliseBox({ a, peca }: { a: any; peca: Peca }) {
  if (!a) return <p className="text-sm text-dark-400">Sem revisão do Claude ainda.</p>
  const cor = a.veredito === 'aprovar' ? 'text-green-400' : a.veredito === 'ajustar' ? 'text-yellow-400' : 'text-red-400'
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2"><b className={cor}>Nota {a.nota}/10 · {a.veredito}</b>{a.hash !== rotHash(peca) && <span className="text-xs text-dark-400">(o roteiro mudou depois da revisão)</span>}</div>
      <div className="text-dark-200">{a.resumo}</div>
      {a.problemas?.length > 0 && <ul className="list-disc pl-5 text-dark-300">{a.problemas.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>}
      {a.confirmar?.length > 0 && <div className="text-orange-300 text-xs">Confirmar antes de gravar: {a.confirmar.join(' · ')}</div>}
      {a.gancho && <div className="bg-gold-900/20 border border-gold-800/40 rounded-lg px-3 py-2 text-dark-100"><b>Gancho sugerido:</b> {a.gancho}</div>}
    </div>
  )
}

// "Colar roteiro completo" (João, 2026-11-23): cola o texto inteiro e o CRM
// separa pauta, gancho, roteiro, legenda e CTA pelos títulos do texto.
export function separarTexto(t: string) {
  const linhas = t.replace(/\r/g, '').split('\n')
  const out = { titulo: '', gancho: '', roteiro: [] as string[], legenda: [] as string[], cta: '' }
  let sec: 'roteiro' | 'legenda' = 'roteiro'
  let capt: 'gancho' | 'cta' | null = null
  let buf: string[] = []
  const fim = () => {
    const v = buf.join(' ').replace(/^(fala|texto)\s*:\s*/i, '').replace(/^["“]|["”]$/g, '').trim()
    if (capt === 'gancho' && !out.gancho) out.gancho = v
    if (capt === 'cta' && !out.cta) out.cta = v
    capt = null; buf = []
  }
  for (const l of linhas) {
    const s = l.trim()
    const h = s.replace(/^[#>\-\s]+/, '').replace(/\*+/g, '').trim()
    let m: RegExpMatchArray | null
    if ((m = h.match(/^(t[ií]tulo|pauta|tema)\s*[:\-–]\s*(.*)$/i))) { fim(); out.titulo = m[2].trim(); sec = 'roteiro'; continue }
    if ((m = h.match(/^(legenda|copy|descri[cç][aã]o(?: do post)?)\s*(?:[:\-–]\s*(.*))?$/i))) { fim(); sec = 'legenda'; if (m[2]) out.legenda.push(m[2]); continue }
    if ((m = h.match(/^hashtags?\s*(?:[:\-–]\s*(.*))?$/i))) { fim(); sec = 'legenda'; if (m[1]) out.legenda.push(m[1]); continue }
    if (sec === 'legenda' && /^(roteiro|gancho|cena|desenvolvimento)\b/i.test(h)) sec = 'roteiro'
    if (sec === 'legenda') { out.legenda.push(l); continue }
    out.roteiro.push(l)
    if ((m = h.match(/^gancho\b[^:]*:?\s*(.*)$/i))) { fim(); capt = 'gancho'; if (m[1]) buf.push(m[1]); continue }
    if ((m = h.match(/^(cta|chamada)\b[^:]*:?\s*(.*)$/i))) { fim(); capt = 'cta'; if (m[2]) buf.push(m[2]); continue }
    if (capt) {
      if (!s || /^[A-ZÁÉÍÓÚÂÊÔÇÃÕ ]{4,}[:)]?$/.test(h) || /^\d+[.)]/.test(h)) fim()
      else if (!/^na tela\s*:/i.test(h)) buf.push(s)
    }
  }
  fim()
  return { titulo: out.titulo, gancho: out.gancho, roteiro: out.roteiro.join('\n').trim(), legenda: out.legenda.join('\n').trim(), cta: out.cta }
}

type Separado = ReturnType<typeof separarTexto>
function ColarRoteiro({ open, tipo, onClose, aplicar }: { open: boolean; tipo: string; onClose: () => void; aplicar: (r: Separado) => void }) {
  const { temChave } = useIa()
  const [texto, setTexto] = useState('')
  const [r, setR] = useState<Separado | null>(null)
  const ia = trpc.marketingModulo.separarRoteiro.useMutation({ onSuccess: setR, onError: (e) => toast.error(e.message, { duration: 8000 }) })
  const fechar = () => { setTexto(''); setR(null); onClose() }
  const campo = (k: keyof Separado, rot: string, linhas: number) => (
    <label className="block space-y-1"><span className={cls.rotulo}>{rot}</span>
      <textarea rows={linhas} className={cls.input + (k === 'roteiro' ? ' font-mono text-[13px]' : '')} value={r![k]} onChange={(e) => setR({ ...r!, [k]: e.target.value })} placeholder="(vazio — o campo da peça não muda)" /></label>
  )
  return (
    <Modal open={open} onClose={fechar} title="Colar roteiro completo" size="xl">
      {!r ? (
        <div className="space-y-3">
          <p className="text-sm text-dark-300">Cole o texto inteiro (do Claude, do WhatsApp, de onde for). O CRM separa sozinho: <b>pauta</b>, <b>gancho</b>, <b>roteiro</b>, <b>legenda</b> e <b>CTA</b>. Você confere antes de aplicar.</p>
          <p className="text-xs text-dark-400">Dica: o texto separa melhor com títulos como <code>TÍTULO:</code>, <code>GANCHO:</code>, <code>LEGENDA:</code>, <code>HASHTAGS:</code>, <code>CTA:</code>.</p>
          <textarea rows={16} className={cls.input + ' font-mono text-[13px]'} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Cole aqui o roteiro completo…" />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={fechar}>Cancelar</Button>
            {temChave && <Button variant="secondary" onClick={() => ia.mutate({ texto, tipo })} loading={ia.isPending} disabled={texto.trim().length < 10}>✨ Separar com IA</Button>}
            <Button onClick={() => setR(separarTexto(texto))} disabled={texto.trim().length < 10}>Separar</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-dark-300">Confira e corrija se precisar. Campo vazio não muda nada na peça.</p>
          {campo('titulo', 'Pauta', 1)}
          {campo('gancho', 'Gancho', 2)}
          {campo('roteiro', 'Roteiro', 12)}
          <div className="grid md:grid-cols-[2fr_1fr] gap-3">{campo('legenda', 'Legenda e hashtags', 5)}{campo('cta', 'CTA', 5)}</div>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setR(null)}>← Voltar ao texto</Button>
            <Button onClick={() => { aplicar(r); fechar() }}>Aplicar na peça</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default function PecaModal({ peca, pilares, personaResumo, onClose }: { peca: Peca | null; pilares: Pilar[]; personaResumo?: string; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [p, setP] = useState<Peca | null>(peca)
  const [salvo, setSalvo] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const salvar = trpc.marketingModulo.salvarPeca.useMutation({ onSuccess: () => { setSalvo(true); utils.marketingModulo.pecas.invalidate() }, onError: (e) => toast.error(e.message) })
  const excluir = trpc.marketingModulo.excluirPeca.useMutation({ onSuccess: () => { utils.marketingModulo.pecas.invalidate(); onClose() } })
  const [confirmaExcluir, setConfirmaExcluir] = useState(false)
  const [colar, setColar] = useState(false)
  const [novoItem, setNovoItem] = useState('')
  const equipe = trpc.marketingFluxo.equipe.useQuery()
  // Etapa salva na hora (não espera): se a trava do servidor recusar, volta.
  const etapa = trpc.marketingModulo.salvarPeca.useMutation({ onSuccess: () => utils.marketingModulo.pecas.invalidate() })
  const enviarAprov = trpc.marketingFluxo.enviarAprovacaoRoteiro.useMutation({ onSuccess: () => { utils.marketingModulo.pecas.invalidate(); setP((o) => (o ? { ...o, status: 'Aprovação do roteiro' } : o)); toast.success('Mandado para aprovação do roteiro') }, onError: (e) => toast.error(e.message) })
  const atualizarAnexos = (anexos: Anexo[]) => { setP((o) => (o ? { ...o, anexos } : o)); utils.marketingModulo.pecas.invalidate() }
  const anexar = trpc.marketingFluxo.anexarPeca.useMutation()
  const tirarAnexo = trpc.marketingFluxo.removerAnexoPeca.useMutation({ onError: (e) => toast.error(e.message) })
  useEffect(() => { setP(peca); setSalvo(true) }, [peca?.id])

  if (!p) return null
  const mudar = (campos: Partial<Peca>) => {
    const novo = { ...p, ...campos }
    if (novo.status === 'Ideia' && (novo.roteiro || '').trim().length > 20) novo.status = 'Roteiro'
    setP(novo)
    setSalvo(false)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      salvar.mutate(paraSalvar(novo))
    }, 700)
  }
  const fechar = () => {
    if (!salvo) {
      clearTimeout(timer.current)
      salvar.mutate(paraSalvar(p))
    }
    onClose()
  }
  const campo = (rot: string, el: React.ReactNode) => <label className="block space-y-1"><span className={cls.rotulo}>{rot}</span>{el}</label>

  return (
    <Modal open={!!peca} onClose={fechar} title="Editar peça" size="xl">
      <div className="space-y-4">
        {campo('Pauta', <textarea className={cls.input + ' font-semibold'} rows={2} value={p.titulo} onChange={(e) => mudar({ titulo: e.target.value })} />)}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {campo('Data', <input type="date" className={cls.input} value={p.data || ''} onChange={(e) => mudar({ data: e.target.value || null })} />)}
          {campo('Hora', <input type="time" className={cls.input} value={p.hora || ''} onChange={(e) => mudar({ hora: e.target.value || null })} />)}
          {campo('Tipo', <select className={cls.input} value={p.tipo} onChange={(e) => mudar({ tipo: e.target.value })}><option>Vídeo</option><option>Post</option></select>)}
          {campo('Pilar', <select className={cls.input} value={p.pilar || ''} onChange={(e) => mudar({ pilar: e.target.value })}><option value="">—</option>{pilares.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>)}
          {campo('Etapa', <select className={cls.input} value={p.status} onChange={(e) => {
            const antes = p.status
            const novo = e.target.value
            if (!salvo) { clearTimeout(timer.current); salvar.mutate(paraSalvar(p)) }
            setP({ ...p, status: novo })
            etapa.mutate({ id: p.id, status: novo }, { onError: (err) => { toast.error(err.message, { duration: 8000 }); setP((o) => (o ? { ...o, status: antes } : o)) } })
          }}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select>)}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {p.origem === 'complementar' && <span className="px-2 py-1 rounded bg-purple-900/40 text-purple-200">Demanda complementar (não passa pela aprovação do roteiro)</span>}
          {p.roteiroAprovadoEm ? <span className="px-2 py-1 rounded bg-green-900/40 text-green-200">✅ Liberado para gravação{p.roteiroAprovadoPor ? ` · roteiro aprovado por ${p.roteiroAprovadoPor}` : ''}</span>
            : p.status === 'Aprovação do roteiro' ? <span className="px-2 py-1 rounded bg-yellow-900/40 text-yellow-200">⏳ Esperando um revisor aprovar o roteiro (aba Revisão)</span>
            : p.origem !== 'complementar' && ['Ideia', 'Roteiro'].includes(p.status) && <Button size="sm" variant="outline" onClick={() => { if (!salvo) { clearTimeout(timer.current); salvar.mutate(paraSalvar(p)) } enviarAprov.mutate({ pecaId: p.id }) }} loading={enviarAprov.isPending} disabled={(p.roteiro || '').trim().length < 20}>Mandar roteiro para aprovação</Button>}
          {p.finalAprovadoEm && <span className="px-2 py-1 rounded bg-green-900/40 text-green-200">✅ Aprovação final{p.finalAprovadoPor ? ` por ${p.finalAprovadoPor}` : ''} — pode agendar na mLabs</span>}
          {!p.finalAprovadoEm && p.status === 'Aprovação final' && <span className="px-2 py-1 rounded bg-yellow-900/40 text-yellow-200">⏳ Esperando a aprovação final (aba Revisão)</span>}
        </div>
        <div className="grid md:grid-cols-[220px_1fr] gap-3">
          {campo('Responsável', <select className={cls.input} value={p.responsavelId ?? ''} onChange={(e) => mudar({ responsavelId: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{(equipe.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>)}
          {campo('Link extra (Drive, referência…)', <input className={cls.input} placeholder="Opcional — o vídeo/arte final vai em Anexos, mais abaixo" value={p.linkMidia || ''} onChange={(e) => mudar({ linkMidia: e.target.value })} />)}
        </div>
        <div className="space-y-1">
          <span className={cls.rotulo}>Checklist</span>
          <div className="flex flex-wrap gap-2 items-center">
            {(p.checklist || []).map((c, i) => (
              <span key={i} className={`group text-xs px-2.5 py-1 rounded-full border cursor-pointer select-none ${c.ok ? 'bg-green-900/40 border-green-700 text-green-200 line-through' : 'border-dark-600 text-dark-200'}`}
                onClick={() => mudar({ checklist: (p.checklist || []).map((x, j) => (j === i ? { ...x, ok: !x.ok } : x)) })}>
                {c.ok ? '☑' : '☐'} {c.t}
                <button className="ml-1 text-dark-500 hover:text-red-400 hidden group-hover:inline" onClick={(e) => { e.stopPropagation(); mudar({ checklist: (p.checklist || []).filter((_, j) => j !== i) }) }}>×</button>
              </span>))}
            <input className="bg-transparent border-b border-dashed border-dark-600 text-xs text-dark-200 px-1 py-0.5 outline-none w-32" placeholder="+ item" value={novoItem} onChange={(e) => setNovoItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && novoItem.trim()) { mudar({ checklist: [...(p.checklist || []), { t: novoItem.trim(), ok: false }] }); setNovoItem('') } }} />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between"><span className={cls.rotulo}>Canais</span><button className="text-xs text-gold-400 hover:underline" onClick={() => mudar({ canais: p.tipo === 'Post' ? [...CANAIS_P] : [...CANAIS_V] })}>Canais padrão do tipo</button></div>
          <div className="flex flex-wrap gap-2">{CANAIS.map((c) => (
            <label key={c} className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer ${p.canais.includes(c) ? 'bg-gold-900/40 border-gold-600 text-gold-200' : 'border-dark-600 text-dark-300'}`}>
              <input type="checkbox" className="hidden" checked={p.canais.includes(c)} onChange={(e) => mudar({ canais: e.target.checked ? [...p.canais, c] : p.canais.filter((z) => z !== c) })} />{c}
            </label>))}</div>
        </div>
        {personaResumo && <details className="text-sm"><summary className="cursor-pointer text-dark-300 font-semibold">Persona e SWOT da marca</summary><pre className="whitespace-pre-wrap text-xs text-dark-300 bg-dark-900 rounded-lg p-3 mt-2">{personaResumo}</pre></details>}
        {campo('Gancho (primeiros 3 segundos)', <textarea className={cls.input} rows={2} value={p.gancho} onChange={(e) => mudar({ gancho: e.target.value })} />)}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cls.rotulo}>Roteiro</span>
            <span className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setColar(true)}>Colar roteiro completo</Button>
              <IaAcao pequeno tipo="criar" params={{ pecaId: p.id }} rotulo="Criar com Claude" onResultado={(r) => mudar({ roteiro: r.roteiro, legenda: p.legenda.trim() ? p.legenda : r.legenda || '' })} />
              <Button size="sm" variant="ghost" onClick={() => { if (!p.roteiro.trim() || confirm('Substituir o roteiro pelo modelo em branco?')) mudar({ roteiro: p.tipo === 'Post' ? MODELO_P : MODELO_V }) }}>Inserir modelo</Button>
            </span>
          </div>
          <textarea className={cls.input + ' font-mono text-[13px] leading-relaxed'} rows={14} value={p.roteiro} onChange={(e) => mudar({ roteiro: e.target.value })} />
        </div>
        <div className="bg-dark-900/60 border border-dark-700 rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cls.rotulo}>Revisão do Claude</span>
            <span className="flex flex-wrap gap-2">
              <IaAcao pequeno tipo="revisao" params={{ pecaIds: [p.id] }} rotulo="Analisar" onResultado={() => utils.marketingModulo.pecas.invalidate().then(() => utils.marketingModulo.pecas.fetch({ planoId: p.planoId }).then((l) => { const n = l.find((x) => x.id === p.id); if (n) setP((o) => (o ? { ...o, analise: n.analise } : o)) }))} />
              {p.analise && <IaAcao pequeno tipo="reescrever" params={{ pecaId: p.id }} rotulo="Reescrever" onResultado={(r) => mudar({ roteiro: r.roteiro })} />}
            </span>
          </div>
          <AnaliseBox a={p.analise} peca={p} />
          {p.analise?.gancho && <Button size="sm" variant="outline" onClick={() => mudar({ gancho: p.analise.gancho })}>Usar gancho sugerido</Button>}
        </div>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cls.rotulo}>Legenda (copy) e hashtags</span>
            <IaAcao pequeno tipo="legenda" params={{ pecaId: p.id }} rotulo="Gerar legenda" onResultado={(r) => { if (!p.legenda.trim() || confirm('Trocar a legenda atual pela nova?')) mudar({ legenda: r.legenda }) }} />
          </div>
          <textarea className={cls.input} rows={4} value={p.legenda} onChange={(e) => mudar({ legenda: e.target.value })} />
        </div>
        {campo('CTA', <input className={cls.input} value={p.cta} onChange={(e) => mudar({ cta: e.target.value })} />)}
        {campo('Observações', <textarea className={cls.input} rows={2} value={p.obs} onChange={(e) => mudar({ obs: e.target.value })} />)}
        <div className="bg-dark-900/60 border border-dark-700 rounded-xl p-3">
          <Anexos anexos={p.anexos || []} aviso={p.tipo === 'Post' ? 'Anexe a arte pronta: sem ela a peça não vai para a aprovação final nem para Agendado na mLabs.' : 'Anexe o vídeo editado: sem ele a peça não vai para a aprovação final nem para Agendado na mLabs.'}
            enviar={async (arq) => { const a = await anexar.mutateAsync({ pecaId: p.id, arquivo: arq }); setP((o) => (o ? { ...o, anexos: [...(o.anexos || []), a as Anexo] } : o)); utils.marketingModulo.pecas.invalidate(); toast.success('Anexado') }}
            remover={(arquivoId) => tirarAnexo.mutate({ pecaId: p.id, arquivoId }, { onSuccess: () => atualizarAnexos((p.anexos || []).filter((a) => a.arquivoId !== arquivoId)) })} />
        </div>
        <div className="bg-dark-900/60 border border-dark-700 rounded-xl p-3 space-y-2">
          <Comentarios pecaId={p.id} />
        </div>
        <ColarRoteiro open={colar} tipo={p.tipo} onClose={() => setColar(false)} aplicar={(r) => mudar({ ...(r.titulo ? { titulo: r.titulo } : {}), ...(r.gancho ? { gancho: r.gancho } : {}), ...(r.roteiro ? { roteiro: r.roteiro } : {}), ...(r.legenda ? { legenda: r.legenda } : {}), ...(r.cta ? { cta: r.cta } : {}) })} />
        <div className="flex items-center justify-between pt-2 border-t border-dark-700">
          {confirmaExcluir ? (
            <span className="flex gap-2"><Button variant="danger" size="sm" onClick={() => excluir.mutate({ id: p.id })}>Confirmar exclusão</Button><Button size="sm" variant="ghost" onClick={() => setConfirmaExcluir(false)}>Cancelar</Button></span>
          ) : <Button variant="danger" size="sm" onClick={() => setConfirmaExcluir(true)}>Excluir peça</Button>}
          <span className="text-xs text-dark-400">{salvo ? 'Salvo' : 'Salvando…'}</span>
        </div>
      </div>
    </Modal>
  )
}
