// Relatórios Odin → Pós-venda: Satisfação dos clientes (pesquisa do
// Pós-venda de máquina) e Agendamentos de peças. Pedido do João, 2026-10-29.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, MessageSquare, Phone, Send, Star } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { ATENDEU_LABEL, Estrelas } from './FormPesquisa'
import PassoAPasso from './PassoAPasso'

type Filtro = { dataDe?: string; dataAte?: string }

const dataBr = (v: string | null) => (v ? new Date(v.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR') : '—')
const diaBr = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—')

function baixarCsv(nome: string, linhas: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const blob = new Blob(['﻿' + linhas.map((l) => l.map(esc).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nome
  a.click()
  URL.revokeObjectURL(a.href)
}

function Kpi({ label, valor, sub, icon, cor }: { label: string; valor: string | number; sub?: string; icon: React.ReactNode; cor: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 flex items-center gap-3">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${cor}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-dark-50 leading-tight">{valor}</p>
        <p className="text-xs text-dark-400 leading-tight mt-0.5">{label}</p>
        {sub && <p className="text-[11px] text-dark-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// Distribuição das notas 1..5 — barras horizontais finas, valor ao lado.
function Distribuicao({ titulo, media, valores }: { titulo: string; media: number | null; valores: number[] }) {
  const max = Math.max(1, ...valores)
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-dark-200">{titulo}</p>
        <p className="text-sm text-dark-300">
          média <span className="text-lg font-bold text-dark-50">{media ?? '—'}</span>
        </p>
      </div>
      <div className="space-y-1.5">
        {[5, 4, 3, 2, 1].map((n) => (
          <div key={n} className="flex items-center gap-2 text-xs" title={`${valores[n - 1]} resposta(s) com nota ${n}`}>
            <span className="w-6 text-dark-400 flex items-center gap-0.5">{n}<Star size={10} className="fill-amber-400 text-amber-400" /></span>
            <div className="flex-1 h-2 bg-dark-700 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(valores[n - 1] / max) * 100}%`, background: n >= 4 ? '#22c55e' : n === 3 ? '#eab308' : '#ef4444' }} />
            </div>
            <span className="w-6 text-right text-dark-300">{valores[n - 1]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TabelaGrupo({ titulo, linhas }: { titulo: string; linhas: { nome: string; respostas: number; media: number | null }[] }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
      <p className="text-sm font-semibold text-dark-200 mb-2">{titulo}</p>
      {linhas.length === 0 ? (
        <p className="text-sm text-dark-500">Sem respostas no período.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-dark-500">
              <th className="py-1 font-medium">Nome</th>
              <th className="py-1 font-medium text-right">Respostas</th>
              <th className="py-1 font-medium text-right">Nota média</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.nome} className="border-t border-dark-700">
                <td className="py-1.5 text-dark-200">{l.nome}</td>
                <td className="py-1.5 text-right text-dark-300">{l.respostas}</td>
                <td className="py-1.5 text-right">
                  <span className={`font-semibold ${l.media == null ? 'text-dark-500' : l.media >= 4 ? 'text-green-400' : l.media >= 3 ? 'text-amber-400' : 'text-red-400'}`}>{l.media ?? '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function RelatorioSatisfacao({ filtro }: { filtro: Filtro }) {
  const { user } = useAuth()
  const base = user?.role === 'admin' ? '/admin' : '/vendedor'
  const [tipo, setTipo] = useState<'' | 'maquina' | 'peca'>('')
  const { data, isLoading } = trpc.posVendaOdin.relatorioSatisfacao.useQuery({ dataDe: filtro.dataDe, dataAte: filtro.dataAte, tipo: tipo || undefined })
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  const totalAtendeu = data.atendeu.sim + data.atendeu.parcial + data.atendeu.nao
  const pct = (n: number) => (totalAtendeu ? `${Math.round((n / totalAtendeu) * 100)}%` : '—')

  function csv() {
    baixarCsv(`satisfacao_pos_venda_${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Pedido', 'Tipo', 'Nº pedido', 'Cliente', 'Vendedor', 'Respondida em', 'Via', 'Nota Odin', 'Nota transportadora', 'Transportadora', 'Nota técnico', 'Técnico', 'Atendeu', 'Comentário', 'Quer contato', 'Precisa atenção', 'Resolvido'],
      ...data!.respostas.map((r) => [r.ordemId, r.orderType === 'peca' ? 'Peça' : 'Máquina', r.numeroPedido, r.clienteNome, r.vendedorNome, dataBr(r.respondidoEm), r.via === 'equipe' ? 'Equipe' : 'Cliente', r.notaOdin, r.notaTransportadora, r.transportadora, r.notaTecnico, r.tecnicoNome, r.atendeu ? ATENDEU_LABEL[r.atendeu] : '', r.comentario, r.querContato ? 'Sim' : 'Não', r.pedeAtencao ? 'Sim' : 'Não', r.resolvido ? 'Sim' : 'Não']),
    ])
  }

  return (
    <div className="space-y-5">
      <PassoAPasso
        chave="rel_satisfacao"
        titulo="Como ler este relatório"
        passos={[
          <>Escolha o período nos filtros acima (ou deixe em branco para ver tudo). Use <b>Máquinas / Peças</b> para ver só um tipo de pedido.</>,
          <>Os 4 quadros do topo mostram quantas pesquisas foram enviadas, quantas voltaram e quantas pedem atenção.</>,
          <>As 3 caixas de estrelas mostram a média e quantas notas de 1 a 5 cada pergunta recebeu (Odin, entrega, técnico).</>,
          <>As tabelas mostram a nota de <b>cada transportadora</b> e de <b>cada técnico</b>: use para ver quem precisa melhorar.</>,
          <>Na lista <b>Respostas</b>, as linhas em vermelho precisam de acompanhamento. Clique no número do pedido para abrir e registrar o que foi feito.</>,
          <>Em <b>Enviadas e ainda sem resposta</b>, veja quem ainda não respondeu e cobre se já passou muito tempo.</>,
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {([['', 'Todos'], ['maquina', 'Máquinas'], ['peca', 'Peças']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setTipo(v)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${tipo === v ? 'border-gold-500 bg-gold-900/20 text-gold-300' : 'border-dark-600 text-dark-300 hover:bg-dark-800'}`}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={csv} className="rounded-lg border border-dark-600 px-3 py-1.5 text-xs font-medium text-dark-300 hover:bg-dark-800">Exportar CSV</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Pesquisas enviadas" valor={data.enviadas} icon={<Send size={18} className="text-white" />} cor="bg-blue-600" />
        <Kpi label="Respondidas" valor={data.respondidas} sub={data.taxaResposta != null ? `${data.taxaResposta}% das enviadas no período` : undefined} icon={<CheckCircle2 size={18} className="text-white" />} cor="bg-emerald-600" />
        <Kpi label="Pediram contato" valor={data.queremContato} icon={<Phone size={18} className="text-white" />} cor="bg-amber-600" />
        <Kpi label="Precisam de acompanhamento" valor={data.pendentesAcompanhamento} sub="nota 1-2, não atendeu ou pediu contato" icon={<AlertTriangle size={18} className="text-white" />} cor={data.pendentesAcompanhamento ? 'bg-red-600' : 'bg-dark-600'} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Distribuicao titulo="Odin como fornecedora" media={data.mediaOdin} valores={data.distribuicao.odin} />
        <Distribuicao titulo="Transportadora e entrega" media={data.mediaTransportadora} valores={data.distribuicao.transportadora} />
        <Distribuicao titulo="Técnico da partida" media={data.mediaTecnico} valores={data.distribuicao.tecnico} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-sm font-semibold text-dark-200 mb-3">O equipamento e o atendimento atenderam?</p>
          {(['sim', 'parcial', 'nao'] as const).map((k) => (
            <div key={k} className="flex items-center justify-between text-sm py-1">
              <span className={k === 'sim' ? 'text-green-400' : k === 'parcial' ? 'text-amber-400' : 'text-red-400'}>{ATENDEU_LABEL[k]}</span>
              <span className="text-dark-200">
                <b>{data.atendeu[k]}</b> <span className="text-dark-500 text-xs">({pct(data.atendeu[k])})</span>
              </span>
            </div>
          ))}
        </div>
        <TabelaGrupo titulo="Nota por transportadora" linhas={data.porTransportadora} />
        <TabelaGrupo titulo="Nota por técnico" linhas={data.porTecnico} />
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 overflow-x-auto">
        <p className="text-sm font-semibold text-dark-200 mb-2 flex items-center gap-2"><MessageSquare size={15} /> Respostas</p>
        {data.respostas.length === 0 ? (
          <p className="text-sm text-dark-500">Nenhuma resposta no período.</p>
        ) : (
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-xs text-dark-500">
                <th className="py-1.5 font-medium">Pedido / cliente</th>
                <th className="py-1.5 font-medium">Data</th>
                <th className="py-1.5 font-medium">Odin</th>
                <th className="py-1.5 font-medium">Entrega</th>
                <th className="py-1.5 font-medium">Técnico</th>
                <th className="py-1.5 font-medium">Atendeu</th>
                <th className="py-1.5 font-medium">Comentário</th>
              </tr>
            </thead>
            <tbody>
              {data.respostas.map((r) => (
                <tr key={r.ordemId} className={`border-t border-dark-700 align-top ${r.pedeAtencao && !r.resolvido ? 'bg-red-900/10' : ''}`}>
                  <td className="py-2 pr-2">
                    <Link to={`${base}/ordens/${r.ordemId}`} className="text-blue-400 hover:underline">#{r.ordemId}{r.numeroPedido ? ` · ${r.numeroPedido}` : ''}</Link>
                    <p className="text-dark-200">{r.clienteNome}</p>
                    <p className="text-[11px] text-dark-500">{r.vendedorNome}</p>
                    {r.pedeAtencao && (
                      <p className={`text-[11px] mt-0.5 ${r.resolvido ? 'text-green-400' : 'text-red-300'}`}>{r.resolvido ? '✓ acompanhamento feito' : '⚠ precisa acompanhamento'}</p>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-dark-300 whitespace-nowrap">{dataBr(r.respondidoEm)}<p className="text-[11px] text-dark-500">{r.via === 'equipe' ? 'pela equipe' : 'pelo cliente'}</p></td>
                  <td className="py-2 pr-2"><Estrelas nota={r.notaOdin} tamanho={11} /></td>
                  <td className="py-2 pr-2"><Estrelas nota={r.notaTransportadora} tamanho={11} />{r.transportadora && <p className="text-[11px] text-dark-500">{r.transportadora}</p>}</td>
                  <td className="py-2 pr-2"><Estrelas nota={r.notaTecnico} tamanho={11} />{r.tecnicoNome && <p className="text-[11px] text-dark-500">{r.tecnicoNome}</p>}</td>
                  <td className={`py-2 pr-2 text-xs ${r.atendeu === 'sim' ? 'text-green-400' : r.atendeu === 'parcial' ? 'text-amber-400' : 'text-red-400'}`}>{r.atendeu ? ATENDEU_LABEL[r.atendeu] : '—'}{r.querContato && <p className="text-amber-300">📞 quer contato</p>}</td>
                  <td className="py-2 text-dark-300 text-xs max-w-xs">{r.comentario ?? '—'}{r.acompanhamentoObs && <p className="text-green-400 mt-1">➜ {r.acompanhamentoObs}</p>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.aguardando.length > 0 && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-sm font-semibold text-dark-200 mb-2 flex items-center gap-2"><Clock size={15} /> Enviadas e ainda sem resposta ({data.aguardando.length})</p>
          <div className="divide-y divide-dark-700">
            {data.aguardando.map((a) => (
              <div key={a.ordemId} className="flex items-center justify-between py-1.5 text-sm">
                <Link to={`${base}/ordens/${a.ordemId}`} className="text-dark-200 hover:underline">#{a.ordemId} · {a.clienteNome}</Link>
                <span className={`text-xs ${a.dias >= 7 ? 'text-red-300' : 'text-dark-400'}`}>enviada há {a.dias} dia{a.dias === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const RESULTADO_LABEL: Record<string, string> = { venda: 'Vendeu peça', revenda: 'Foi para a revenda', sem_interesse: 'Sem interesse', outro: 'Outro' }

export function RelatorioAgendamentosPecas({ filtro }: { filtro: Filtro }) {
  const { data, isLoading } = trpc.posVendaOdin.relatorioAgendamentos.useQuery({ dataDe: filtro.dataDe, dataAte: filtro.dataAte })
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)

  function csv() {
    baixarCsv(`agendamentos_pecas_${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Cliente', 'Revenda', 'Responsável', 'Próximo contato', 'Contatos no período', 'Pedido'],
      ...data!.lista.map((a) => [a.clienteNome, a.revendaNome, a.vendedorNome, diaBr(a.proximoContato), a.contatos, a.ordemId]),
    ])
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button onClick={csv} className="rounded-lg border border-dark-600 px-3 py-1.5 text-xs font-medium text-dark-300 hover:bg-dark-800">Exportar CSV</button>
      </div>
      <PassoAPasso
        chave="rel_agendamentos"
        titulo="Como ler este relatório"
        passos={[
          <><b>Em aberto, Atrasados, Próximos e Sem data</b> mostram como está a agenda hoje (não mudam com o filtro de data).</>,
          <><b>Criados, Contatos e Concluídos</b> contam só o período escolhido nos filtros.</>,
          <><b>Como terminaram</b> mostra quantos agendamentos viraram venda de peça.</>,
          <>A <b>Agenda de contatos</b> lista todos em aberto, do mais urgente para o mais distante (vermelho = atrasado).</>,
        ]}
      />
      <p className="text-xs text-dark-500 -mt-3">Os números de "agora" (em aberto, atrasados, próximos) não usam o filtro de data. Criados, contatos e concluídos usam o período escolhido.</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Em aberto agora" valor={data.abertos} icon={<CalendarClock size={18} className="text-white" />} cor="bg-purple-600" />
        <Kpi label="Atrasados" valor={data.atrasados} sub={`${data.hoje} para hoje`} icon={<AlertTriangle size={18} className="text-white" />} cor={data.atrasados ? 'bg-red-600' : 'bg-dark-600'} />
        <Kpi label="Próximos 7 dias" valor={data.proximos7} sub={`${data.proximos30} nos próximos 30 dias`} icon={<Clock size={18} className="text-white" />} cor="bg-blue-600" />
        <Kpi label="Sem data marcada" valor={data.semData} icon={<CalendarClock size={18} className="text-white" />} cor="bg-dark-600" />
        <Kpi label="Criados no período" valor={data.criados} sub="pedidos de máquina concluídos" icon={<CheckCircle2 size={18} className="text-white" />} cor="bg-emerald-600" />
        <Kpi label="Contatos feitos no período" valor={data.contatos} icon={<Phone size={18} className="text-white" />} cor="bg-amber-600" />
        <Kpi label="Concluídos no período" valor={data.concluidos} sub={`${data.porResultado.venda} com venda de peça`} icon={<CheckCircle2 size={18} className="text-white" />} cor="bg-green-700" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-sm font-semibold text-dark-200 mb-2">Como terminaram (período)</p>
          {Object.entries(data.porResultado).map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm py-1"><span className="text-dark-300">{RESULTADO_LABEL[k]}</span><b className="text-dark-100">{v}</b></div>
          ))}
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-sm font-semibold text-dark-200 mb-2">Em aberto por revenda</p>
          {data.porRevenda.length === 0 ? <p className="text-sm text-dark-500">—</p> : data.porRevenda.map((r) => (
            <div key={r.nome} className="flex justify-between text-sm py-1"><span className="text-dark-300 truncate pr-2">{r.nome}</span><b className="text-dark-100">{r.qtd}</b></div>
          ))}
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-sm font-semibold text-dark-200 mb-2">Em aberto por responsável</p>
          {data.porVendedor.length === 0 ? <p className="text-sm text-dark-500">—</p> : data.porVendedor.map((r) => (
            <div key={r.nome} className="flex justify-between text-sm py-1"><span className="text-dark-300">{r.nome}</span><b className="text-dark-100">{r.qtd}</b></div>
          ))}
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 overflow-x-auto">
        <p className="text-sm font-semibold text-dark-200 mb-2">Agenda de contatos (em aberto)</p>
        {data.lista.length === 0 ? (
          <p className="text-sm text-dark-500">Nenhum agendamento em aberto.</p>
        ) : (
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs text-dark-500">
                <th className="py-1.5 font-medium">Próximo contato</th>
                <th className="py-1.5 font-medium">Cliente</th>
                <th className="py-1.5 font-medium">Revenda</th>
                <th className="py-1.5 font-medium">Responsável</th>
                <th className="py-1.5 font-medium text-right">Contatos</th>
              </tr>
            </thead>
            <tbody>
              {data.lista.map((a) => (
                <tr key={a.id} className="border-t border-dark-700">
                  <td className={`py-1.5 whitespace-nowrap ${a.proximoContato && a.proximoContato < hoje ? 'text-red-300' : a.proximoContato === hoje ? 'text-gold-300' : 'text-dark-300'}`}>{diaBr(a.proximoContato)}</td>
                  <td className="py-1.5 text-dark-200">{a.clienteNome}</td>
                  <td className="py-1.5 text-dark-400">{a.revendaNome ?? '—'}</td>
                  <td className="py-1.5 text-dark-400">{a.vendedorNome ?? '—'}</td>
                  <td className="py-1.5 text-right text-dark-300">{a.contatos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
