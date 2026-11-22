// Página pública de aprovação de conteúdo (abre sem login, pelo link que o
// marketing manda no WhatsApp). Aprovar ou pedir ajuste peça por peça.
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, PencilLine, ExternalLink } from 'lucide-react'
import { trpc } from '../lib/trpc'

function lerNome() { try { return localStorage.getItem('aprov_nome') || '' } catch { return '' } }
function dia(iso?: string | null) {
  if (!iso) return 'sem data'
  const [y, m, d] = iso.split('-').map(Number)
  return `${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(y, m - 1, d).getDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

export default function AprovarPecas() {
  const { token = '' } = useParams()
  const q = trpc.marketingFluxo.aprovacaoObter.useQuery({ token }, { retry: false, enabled: token.length >= 10 })
  const [nome, setNome] = useState(lerNome())
  const [ajusteDe, setAjusteDe] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [feito, setFeito] = useState<Record<string, 'aprovar' | 'ajuste'>>({})
  const [erro, setErro] = useState('')
  const resp = trpc.marketingFluxo.aprovacaoResponder.useMutation({
    onSuccess: (_r, v) => { setFeito((f) => ({ ...f, [v.pecaId]: v.acao })); setAjusteDe(null); setTexto(''); setErro('') },
    onError: (e) => setErro(e.message),
  })
  const responder = (pecaId: string, acao: 'aprovar' | 'ajuste') => {
    if (nome.trim().length < 2) { setErro('Escreva seu nome no topo antes de responder.'); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    try { localStorage.setItem('aprov_nome', nome.trim()) } catch { /* ok */ }
    resp.mutate({ token, pecaId, acao, nome: nome.trim(), texto: acao === 'ajuste' ? texto : '' })
  }
  const pecas = q.data?.pecas || []
  const respondidas = pecas.filter((p) => feito[p.id]).length

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4" style={{ colorScheme: 'light' }}>
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Grupo Odin · Marketing</div>
          <h1 className="text-2xl font-bold text-slate-900">{q.data?.titulo || 'Aprovação de conteúdo'}</h1>
          {q.isLoading && <p className="text-slate-500 text-sm">Carregando…</p>}
          {q.error && <p className="text-slate-700">{q.error.message}</p>}
          {q.data && (
            <>
              <p className="text-sm text-slate-600">Leia cada peça e toque em <b>Aprovar</b> ou <b>Pedir ajuste</b>. {respondidas > 0 && `${respondidas} de ${pecas.length} respondidas.`}</p>
              <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900" placeholder="Seu nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </>
          )}
          {erro && <p className="text-sm text-red-600">{erro}</p>}
        </div>

        {pecas.map((p) => (
          <div key={p.id} className={`bg-white rounded-2xl border p-5 space-y-3 ${feito[p.id] === 'aprovar' ? 'border-green-400' : feito[p.id] === 'ajuste' ? 'border-amber-400' : 'border-slate-200'}`}>
            <div className="text-xs text-slate-500">{p.marca} · {p.tipo} · {dia(p.data)}{p.hora ? ` ${p.hora}` : ''} · etapa: {p.status}</div>
            <h2 className="text-lg font-bold text-slate-900">{p.titulo || 'Sem título'}</h2>
            {p.gancho && <p className="text-slate-800"><b>Gancho:</b> {p.gancho}</p>}
            {p.linkMidia && <a href={p.linkMidia} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 font-semibold"><ExternalLink size={16} /> Ver o vídeo / arte</a>}
            {p.roteiro && <details open={!p.linkMidia}><summary className="cursor-pointer text-sm font-semibold text-slate-700">Roteiro</summary><pre className="whitespace-pre-wrap text-sm text-slate-800 bg-slate-50 rounded-lg p-3 mt-2 font-sans">{p.roteiro}</pre></details>}
            {p.legenda && <details><summary className="cursor-pointer text-sm font-semibold text-slate-700">Legenda</summary><p className="whitespace-pre-wrap text-sm text-slate-800 bg-slate-50 rounded-lg p-3 mt-2">{p.legenda}</p></details>}
            {p.historico.length > 0 && <div className="text-xs text-slate-500 space-y-0.5">{p.historico.map((h, i) => <div key={i}>{h.tipo === 'aprovado' ? '✅ Aprovado' : '✏️ Ajuste'} por {h.autorNome}{h.texto && `: ${h.texto}`}</div>)}</div>}

            {feito[p.id] ? (
              <div className={`flex items-center gap-2 font-semibold ${feito[p.id] === 'aprovar' ? 'text-green-700' : 'text-amber-700'}`}>
                {feito[p.id] === 'aprovar' ? <><CheckCircle2 size={20} /> Aprovado. Obrigado!</> : <><PencilLine size={20} /> Ajuste enviado ao marketing.</>}
              </div>
            ) : ajusteDe === p.id ? (
              <div className="space-y-2">
                <textarea autoFocus rows={3} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900" placeholder="O que precisa mudar?" value={texto} onChange={(e) => setTexto(e.target.value)} />
                <div className="flex gap-2">
                  <button disabled={!texto.trim() || resp.isPending} onClick={() => responder(p.id, 'ajuste')} className="flex-1 bg-amber-500 text-white font-semibold rounded-lg py-2.5 disabled:opacity-50">Enviar ajuste</button>
                  <button onClick={() => setAjusteDe(null)} className="px-4 text-slate-600">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button disabled={resp.isPending} onClick={() => responder(p.id, 'aprovar')} className="flex-1 bg-green-600 text-white font-semibold rounded-lg py-2.5 disabled:opacity-50">Aprovar</button>
                <button onClick={() => { setAjusteDe(p.id); setTexto('') }} className="flex-1 border border-amber-500 text-amber-700 font-semibold rounded-lg py-2.5">Pedir ajuste</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
