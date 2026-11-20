// Radar: directs, comentários (com texto), concorrentes e ideias da semana, por marca e mês.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../../lib/trpc'
import Button from '../../../components/ui/Button'
import IaAcao from './IaAcao'
import { cls, dataHora, fmtN, mesLongo } from './comum'

type Plano = { id: string; empresaId: number; mes: string; dados: any }

export default function AbaRadar({ empresaId, nomeMarca, mes, plano }: { empresaId: number; nomeMarca: string; mes: string; plano: Plano | null }) {
  const utils = trpc.useUtils()
  const d = trpc.marketingModulo.igEmpresa.useQuery({ empresaId, mes })
  const perfil = trpc.marketingModulo.perfil.useQuery({ empresaId })
  const analises = trpc.marketingModulo.analises.useQuery({ empresaId })
  const sinc = trpc.marketingModulo.sincronizar.useMutation({ onSuccess: (r) => { toast.success(`Atualizado: ${r.midias} posts, ${r.comentarios} comentários, ${r.conversas} conversas`); utils.marketingModulo.igEmpresa.invalidate(); utils.marketingModulo.igMes.invalidate() }, onError: (e) => toast.error(e.message, { duration: 9000 }) })
  const salvarPerfil = trpc.marketingModulo.salvarPerfil.useMutation({ onSuccess: () => utils.marketingModulo.perfil.invalidate() })
  const criarPeca = trpc.marketingModulo.criarPeca.useMutation({ onSuccess: () => { utils.marketingModulo.pecas.invalidate(); toast.success('Peça criada no Calendário (sem data, em Ideia)') } })
  const [aberta, setAberta] = useState<string | null>(null)
  const [handle, setHandle] = useState('')
  const [obs, setObs] = useState('')
  const [soNaoResp, setSoNaoResp] = useState(true)

  const dados = d.data
  const dirA = (analises.data || []).find((x) => x.chave === `directs-${empresaId}-${mes}`)
  const ideiasA = (analises.data || []).find((x) => x.chave === `ideias-${empresaId}-${mes}`)
  const coms = (dados?.comentarios || []).filter((c) => !soNaoResp || !c.respondido)
  const comMes = dados?.comentarios.length || 0
  const naoResp = (dados?.comentarios || []).filter((c) => !c.respondido).length

  const addConc = () => {
    const h = handle.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '')
    if (!h || !perfil.data) return
    salvarPerfil.mutate({ empresaId, personas: perfil.data.personas, swot: perfil.data.swot, concorrentes: [...perfil.data.concorrentes, { handle: h, obs }] }, { onSuccess: () => { setHandle(''); setObs('') } })
  }
  const remConc = (h: string) => perfil.data && salvarPerfil.mutate({ empresaId, personas: perfil.data.personas, swot: perfil.data.swot, concorrentes: perfil.data.concorrentes.filter((c: any) => c.handle !== h) })

  if (!dados?.conta) return (
    <div className={cls.card + ' p-6 text-dark-300'}>O Instagram de <b>{nomeMarca}</b> ainda não está ligado. O super admin liga em <b>Marketing → Conexões</b>.</div>
  )
  const Placa = ({ rot, n, txt, alerta }: { rot: string; n: number; txt: string; alerta?: boolean }) => (
    <div className={`bg-dark-800 border rounded-xl p-4 ${alerta && n ? 'border-red-700' : 'border-dark-700'}`}>
      <div className="text-[11px] uppercase tracking-wider text-dark-400">{rot}</div>
      <div className={`text-3xl font-bold ${alerta && n ? 'text-red-400' : 'text-dark-100'}`}>{n}</div>
      <div className="text-xs text-dark-400">{txt}</div>
    </div>
  )
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-dark-100">Radar · {nomeMarca}</h2>
          <p className="text-sm text-dark-400">@{dados.conta.username} · atualizado {dataHora(dados.conta.ultimoSync) || 'nunca'} · {mesLongo(mes)}</p>
          {dados.conta.ultimoErro && <p className="text-xs text-orange-300 mt-1">{dados.conta.ultimoErro}</p>}
        </div>
        <Button variant="secondary" onClick={() => sinc.mutate({ empresaId })} loading={sinc.isPending}>Atualizar agora</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Placa rot="Directs no mês" n={dados.conversas.length} txt="conversas com mensagem no mês" />
        <Placa rot="Directs sem resposta" n={dados.semResposta.length} txt="última mensagem é do cliente" alerta />
        <Placa rot="Comentários no mês" n={comMes} txt="de clientes (sem os da marca)" />
        <Placa rot="Comentários sem resposta" n={naoResp} txt="responda na primeira hora" alerta />
      </div>

      <section className={cls.card + ' p-4 space-y-3'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-dark-100">Directs</h3>
          <IaAcao tipo="directs" params={{ empresaId, mes }} rotulo="Claude, lê os directs do mês" desabilitado={!dados.conversas.length} onResultado={() => utils.marketingModulo.analises.invalidate()} />
        </div>
        {[...dados.semResposta.filter((c) => !dados.conversas.some((x) => x.id === c.id)), ...dados.conversas].slice(0, 40).map((c) => (
          <div key={c.id} className="border-b border-dark-700/50 py-2">
            <button onClick={() => setAberta(aberta === c.id ? null : c.id)} className="w-full flex items-center gap-2 text-left text-sm">
              <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${c.ultimaDoCliente ? 'bg-red-900/50 text-red-200' : 'bg-dark-700 text-dark-300'}`}>{c.ultimaDoCliente ? 'esperando resposta' : 'respondido'}</span>
              <b className="text-dark-100">@{c.contato || '?'}</b>
              <span className="text-dark-300 truncate flex-1">{c.ultimaMensagem}</span>
              <span className="text-xs text-dark-500 whitespace-nowrap">{dataHora(c.ultimaEm)}</span>
            </button>
            {aberta === c.id && <div className="mt-2 space-y-1.5 pl-2">{c.mensagens.map((m: any, i: number) => (
              <div key={i} className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${m.de === 'marca' ? 'ml-auto bg-gold-900/30 text-dark-100' : 'bg-dark-700 text-dark-100'}`}><div className="text-[10px] text-dark-400">{m.de === 'marca' ? 'Marca' : 'Cliente'} · {dataHora(m.em)}</div>{m.texto || '(anexo)'}</div>))}
              <p className="text-xs text-dark-500">Para responder, use o Instagram ou a mLabs Chat.</p></div>}
          </div>))}
        {!dados.conversas.length && !dados.semResposta.length && <p className="text-sm text-dark-400">Nenhum direct no mês.</p>}
        {dirA?.texto && <pre className="whitespace-pre-wrap text-sm text-dark-200 font-sans bg-dark-900/60 rounded-lg p-3">{dirA.texto}</pre>}
      </section>

      <section className={cls.card + ' p-4 space-y-3'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-dark-100">Comentários</h3>
          <label className="text-sm text-dark-300 flex items-center gap-2"><input type="checkbox" checked={soNaoResp} onChange={(e) => setSoNaoResp(e.target.checked)} />Só os sem resposta</label>
        </div>
        {coms.length ? coms.slice(0, 60).map((c) => (
          <div key={c.id} className="flex gap-3 py-2 border-b border-dark-700/50 text-sm">
            <div className="flex-1 min-w-0">
              <div><b className="text-dark-100">@{c.usuario}</b> <span className="text-dark-200">{c.texto}</span></div>
              <div className="text-xs text-dark-500">{dataHora(c.publicadoEm)} · em <a className="text-gold-400 hover:underline" href={c.post?.link || '#'} target="_blank" rel="noopener noreferrer">{c.post?.legenda || 'post'}</a></div>
            </div>
            <span className={`text-xs h-fit px-2 py-0.5 rounded ${c.respondido ? 'bg-green-900/40 text-green-300' : 'bg-red-900/50 text-red-200'}`}>{c.respondido ? 'respondido' : 'sem resposta'}</span>
          </div>)) : <p className="text-sm text-dark-400">Nenhum comentário {soNaoResp ? 'sem resposta ' : ''}no mês.</p>}
      </section>

      <section className={cls.card + ' p-4 space-y-3'}>
        <h3 className="text-lg font-bold text-dark-100">Concorrentes</h3>
        <p className="text-sm text-dark-400">Anote o @ de contas comerciais públicas. O CRM puxa seguidores e os últimos posts deles todo dia, direto da Meta.</p>
        <div className="grid md:grid-cols-2 gap-3">
          {(perfil.data?.concorrentes || []).map((c: any) => {
            const f = dados.concorrentes.find((x: any) => x.handle === c.handle)
            const atual = f?.atual
            const delta = atual?.seguidores != null && f?.anterior?.seguidores != null ? atual.seguidores - f.anterior.seguidores : null
            const top = (atual?.midias || []).slice().sort((a: any, b: any) => b.curtidas + b.comentarios - (a.curtidas + a.comentarios)).slice(0, 3)
            return (
              <div key={c.handle} className="bg-dark-900/60 border border-dark-700 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <a href={`https://www.instagram.com/${encodeURIComponent(c.handle)}/`} target="_blank" rel="noopener noreferrer" className="font-semibold text-gold-400 hover:underline">@{c.handle}</a>
                  <span className="flex gap-2 items-center">
                    <a className="text-xs text-dark-300 hover:text-dark-100 underline" href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&q=${encodeURIComponent(c.handle)}`} target="_blank" rel="noopener noreferrer">anúncios ativos</a>
                    <button className="text-dark-500 hover:text-red-400" onClick={() => remConc(c.handle)} aria-label="Remover">×</button>
                  </span>
                </div>
                {c.obs && <div className="text-xs text-dark-400">{c.obs}</div>}
                {atual?.erro ? <div className="text-xs text-orange-300">{atual.erro}</div> : atual ? (
                  <>
                    <div className="text-sm text-dark-200">{fmtN(atual.seguidores)} seguidores {delta != null && <span className={delta >= 0 ? 'text-green-400' : 'text-red-400'}>({delta >= 0 ? '+' : ''}{fmtN(delta)} na semana)</span>} · {fmtN(atual.posts)} posts</div>
                    {top.map((m: any, i: number) => <a key={i} href={m.link} target="_blank" rel="noopener noreferrer" className="block text-xs text-dark-300 hover:text-dark-100 truncate">❤ {fmtN(m.curtidas)} · 💬 {fmtN(m.comentarios)} — {m.legenda.slice(0, 90)}</a>)}
                  </>
                ) : <div className="text-xs text-dark-500">Ainda não puxado — clique em Atualizar agora.</div>}
              </div>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <input className={cls.input + ' max-w-[200px]'} placeholder="@concorrente" value={handle} onChange={(e) => setHandle(e.target.value)} />
          <input className={cls.input + ' flex-1 min-w-[200px]'} placeholder="O que observar (produto, preço, estilo)" value={obs} onChange={(e) => setObs(e.target.value)} />
          <Button onClick={addConc} disabled={!handle.trim()}>Adicionar</Button>
        </div>
      </section>

      <section className={cls.card + ' p-4 space-y-3'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-dark-100">Ideias da semana</h3>
            <p className="text-sm text-dark-400">Junta persona, SWOT, o que funcionou, as dúvidas dos directs e os concorrentes.</p>
          </div>
          <IaAcao tipo="ideias" params={{ empresaId, mes }} rotulo="Gerar 10 ideias" onResultado={() => utils.marketingModulo.analises.invalidate()} />
        </div>
        {(ideiasA?.dados || []).map((it: any, i: number) => (
          <div key={i} className="bg-dark-900/60 border border-dark-700 border-l-4 border-l-yellow-500 rounded-xl p-3 space-y-1">
            <div className="flex flex-wrap justify-between gap-2"><b className="text-dark-100">{i + 1}. {it.titulo}</b><span className="text-xs text-dark-400">{it.tipo} · {it.pilar}</span></div>
            {it.gancho && <div className="text-sm text-dark-200"><b>Gancho:</b> {it.gancho}</div>}
            {it.porque && <div className="text-xs text-dark-400">{it.porque}</div>}
            <Button size="sm" variant="outline" disabled={!plano} onClick={() => plano && criarPeca.mutate({ planoId: plano.id, tipo: it.tipo === 'Post' ? 'Post' : 'Vídeo', titulo: it.titulo, gancho: it.gancho, status: 'Ideia', obs: `Ideia do Claude (Radar): ${it.porque || ''}`, pilar: (plano.dados.pilares || []).find((p: any) => p.nome?.toLowerCase() === String(it.pilar || '').toLowerCase())?.id || null })}>{plano ? 'Criar peça no Calendário' : 'Crie o plano do mês primeiro'}</Button>
          </div>))}
      </section>
    </div>
  )
}
