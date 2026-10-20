import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Clock, MessageCircle, PhoneCall, PhoneIncoming, Users } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { formatarDataCurta } from '../../../components/relatorios/filtros'
import { Abas, Etiqueta, KpiCard, Medidor, Secao, numero, pct } from '../../../components/relatorios/blocos'
import TabelaDados from '../../../components/relatorios/TabelaDados'
import type { Coluna } from '../../../components/relatorios/TabelaDados'
import type { PropsDetalhe } from './tipos'

const estiloTooltip = { background: 'var(--color-dark-900)', border: '1px solid var(--color-dark-600)', borderRadius: 8, fontSize: 12 }
const tick = { fill: 'var(--color-dark-400)', fontSize: 11 }
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

function BarraPct({ valor, cor }: { valor: number; cor: string }) {
  return (
    <span className="inline-flex items-center gap-2 justify-end">
      <span className="w-16 h-1.5 rounded-full bg-dark-700 overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, valor)}%`, background: cor }} />
      </span>
      {pct(valor)}
    </span>
  )
}

// ── Contatos e cobertura ────────────────────────────────────────────────
export function Contatos({ f, simples, mostrarResumo, clientesBase }: PropsDetalhe) {
  const { data: cobertura, isLoading } = trpc.reports.contatosCoberturaPorVendedor.useQuery(f.periodo)
  const { data: porCliente } = trpc.reports.contatosPorCliente.useQuery(f.periodo)
  const { data: porDia } = trpc.reports.contatosPorDia.useQuery(f.periodo)
  const { data: porDiaAnt } = trpc.reports.contatosPorDia.useQuery(f.anterior)
  const [aba, setAba] = useState<'vendedor' | 'cliente' | 'dia'>(simples ? 'cliente' : 'vendedor')

  const tot = useMemo(() => {
    const s = { total: 0, ligacao: 0, whatsapp: 0, visita: 0, email: 0 }
    for (const d of porDia ?? []) {
      s.total += d.total
      s.ligacao += d.ligacao
      s.whatsapp += d.whatsapp
      s.visita += d.visita
      s.email += d.email
    }
    return s
  }, [porDia])
  const totAnt = (porDiaAnt ?? []).reduce((s, d) => s + d.total, 0)
  const carteira = (cobertura ?? []).reduce((s, l) => s + l.totalCarteira, 0)
  const contatados = (cobertura ?? []).reduce((s, l) => s + l.contatados, 0)

  type C = NonNullable<typeof cobertura>[number]
  type P = NonNullable<typeof porCliente>[number]
  type D = NonNullable<typeof porDia>[number]
  const colCob: Coluna<C>[] = [
    { id: 'nome', rotulo: 'Vendedor', valor: (l) => l.nome, render: (l) => <span className="font-medium text-dark-50">{l.nome}</span> },
    { id: 'carteira', rotulo: 'Carteira', valor: (l) => l.totalCarteira, formato: 'numero', somar: true },
    { id: 'contatados', rotulo: 'Contatados', valor: (l) => l.contatados, formato: 'numero', somar: true },
    { id: 'sem', rotulo: 'Sem contato', valor: (l) => l.semContato, formato: 'numero', somar: true },
    { id: 'pct', rotulo: '% da carteira', valor: (l) => l.percentual, formato: 'pct', render: (l) => <BarraPct valor={l.percentual} cor="#3b82f6" /> },
  ]
  const colCli: Coluna<P>[] = [
    { id: 'cliente', rotulo: 'Cliente', valor: (l) => l.razaoSocial, render: (l) => <span className="font-medium text-dark-50">{l.razaoSocial}</span> },
    { id: 'total', rotulo: 'Contatos', valor: (l) => l.totalContatos, formato: 'numero', somar: true },
    { id: 'lig', rotulo: 'Ligações', valor: (l) => l.totalLigacoes, formato: 'numero', somar: true },
    { id: 'outros', rotulo: 'WhatsApp / outros', valor: (l) => l.totalContatos - l.totalLigacoes, formato: 'numero', somar: true },
  ]
  const colDia: Coluna<D>[] = [
    { id: 'data', rotulo: 'Dia', valor: (d) => d.data, formato: 'data' },
    { id: 'whatsapp', rotulo: 'WhatsApp', valor: (d) => d.whatsapp, formato: 'numero', somar: true },
    { id: 'ligacao', rotulo: 'Ligações', valor: (d) => d.ligacao, formato: 'numero', somar: true },
    { id: 'visita', rotulo: 'Visitas', valor: (d) => d.visita, formato: 'numero', somar: true },
    { id: 'email', rotulo: 'E-mail', valor: (d) => d.email, formato: 'numero', somar: true, oculta: true },
    { id: 'total', rotulo: 'Total', valor: (d) => d.total, formato: 'numero', somar: true },
  ]

  return (
    <div className="space-y-5">
      {mostrarResumo && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard titulo="Contatos registrados" icone={Users} cor="#3b82f6" valor={numero(tot.total)} atual={tot.total} anterior={totAnt} />
            <KpiCard titulo="WhatsApp" icone={MessageCircle} cor="#22a861" valor={numero(tot.whatsapp)} detalhe={tot.total ? `${pct((tot.whatsapp / tot.total) * 100, 0)} dos contatos` : undefined} />
            <KpiCard titulo="Ligações" icone={PhoneCall} cor="#06b6d4" valor={numero(tot.ligacao)} detalhe={tot.total ? `${pct((tot.ligacao / tot.total) * 100, 0)} dos contatos` : undefined} />
            <KpiCard titulo="Carteira contatada no mês" icone={Users} cor="#8b5cf6" valor={pct(carteira ? (contatados / carteira) * 100 : 0)} detalhe={`${numero(contatados)} de ${numero(carteira)} clientes`} />
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            <Secao titulo="Cobertura da carteira" subtitulo={`Mês de ${f.inicio.slice(5, 7)}/${f.inicio.slice(0, 4)} — qualquer tipo de contato`}>
              <Medidor percentual={carteira ? (contatados / carteira) * 100 : 0} cor="#3b82f6" rotulo={`${numero(contatados)} de ${numero(carteira)}`} />
            </Secao>
            <Secao className="lg:col-span-2" titulo="Contatos por dia" subtitulo={`${formatarDataCurta(f.inicio)} a ${formatarDataCurta(f.fim)}`}>
              {porDia?.length ? (
                <div className="h-56 -ml-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={porDia} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-dark-700)" vertical={false} />
                      <XAxis dataKey="data" tickFormatter={diaMes} tick={tick} axisLine={false} tickLine={false} minTickGap={14} />
                      <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={32} />
                      <Tooltip labelFormatter={(d) => formatarDataCurta(String(d))} contentStyle={estiloTooltip} cursor={{ fill: 'var(--color-dark-700)', opacity: 0.4 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="whatsapp" name="WhatsApp" stackId="c" fill="#22a861" />
                      <Bar dataKey="ligacao" name="Ligação" stackId="c" fill="#06b6d4" />
                      <Bar dataKey="visita" name="Visita" stackId="c" fill="#8b5cf6" />
                      <Bar dataKey="email" name="E-mail" stackId="c" fill="#f2a516" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-dark-500 py-12 text-center">Nenhum contato no período.</p>
              )}
            </Secao>
          </div>
        </>
      )}
      <Abas<'vendedor' | 'cliente' | 'dia'>
        valor={aba}
        onChange={setAba}
        opcoes={[
          ...(simples ? [] : [{ valor: 'vendedor' as const, rotulo: 'Por vendedor', contagem: cobertura?.length }]),
          { valor: 'cliente', rotulo: 'Por cliente', contagem: porCliente?.length },
          { valor: 'dia', rotulo: 'Por dia', contagem: porDia?.length },
        ]}
      />
      {aba === 'vendedor' && !simples && (
        <TabelaDados id="contatos-vendedor" linhas={cobertura} colunas={colCob} chave={(l) => l.vendedorId} buscaEm={(l) => l.nome} placeholderBusca="Buscar vendedor..." nomeArquivo="cobertura-por-vendedor.csv" ordemInicial={{ coluna: 'pct', direcao: 'desc' }} carregando={isLoading} />
      )}
      {aba === 'cliente' && (
        <TabelaDados id="contatos-cliente" linhas={porCliente} colunas={colCli} chave={(l) => l.clienteId} buscaEm={(l) => l.razaoSocial} placeholderBusca="Buscar cliente..." nomeArquivo="contatos-por-cliente.csv" link={(l) => `${clientesBase}/${l.clienteId}`} ordemInicial={{ coluna: 'total', direcao: 'desc' }} simples={simples} />
      )}
      {aba === 'dia' && <TabelaDados id="contatos-dia" linhas={porDia} colunas={colDia} chave={(d) => d.data} nomeArquivo="contatos-por-dia.csv" ordemInicial={{ coluna: 'data', direcao: 'desc' }} simples={simples} />}
    </div>
  )
}

// ── Ligações ────────────────────────────────────────────────────────────
const RESULTADO: Record<string, string> = { respondeu: 'Respondeu', nao_respondeu: 'Não respondeu', numero_errado: 'Número errado', caixa_postal: 'Caixa postal', confirmado: 'Confirmado' }
const ORIGEM: Record<string, string> = { manual: 'Manual', whatsapp_automatico: 'WhatsApp automático', ligacao_automatica: 'Automática (PABX)' }
const duracao = (s: number | null | undefined) => (s ? `${Math.floor(s / 60)}min ${String(Math.round(s % 60)).padStart(2, '0')}s` : '—')

export function Ligacoes({ f, simples, mostrarResumo, clientesBase }: PropsDetalhe) {
  const { data: porVendedor, isLoading } = trpc.reports.ligacoesEfetividade.useQuery(f.periodo)
  const { data: porCliente } = trpc.reports.ligacoesPorCliente.useQuery(f.periodo)
  const { data: detalhado } = trpc.reports.ligacoesDetalhado.useQuery(f.periodo)
  const { data: ant } = trpc.reports.ligacoesEfetividade.useQuery(f.anterior)
  const [aba, setAba] = useState<'vendedor' | 'cliente' | 'todas'>(simples ? 'todas' : 'vendedor')

  const tent = (porVendedor ?? []).reduce((s, l) => s + l.tentativas, 0)
  const efet = (porVendedor ?? []).reduce((s, l) => s + l.efetivas, 0)
  const tentAnt = (ant ?? []).reduce((s, l) => s + l.tentativas, 0)
  const pendentes = (porCliente ?? []).reduce((s, l) => s + l.pendentes, 0)
  const porDia = useMemo(() => {
    const m = new Map<string, { data: string; tentativas: number; efetivas: number }>()
    for (const l of detalhado ?? []) {
      const d = l.dataHora.slice(0, 10)
      const a = m.get(d) ?? { data: d, tentativas: 0, efetivas: 0 }
      a.tentativas++
      if (l.efetiva) a.efetivas++
      m.set(d, a)
    }
    return [...m.values()].sort((a, b) => (a.data < b.data ? -1 : 1))
  }, [detalhado])

  type V = NonNullable<typeof porVendedor>[number]
  type C = NonNullable<typeof porCliente>[number]
  type L = NonNullable<typeof detalhado>[number]
  const colV: Coluna<V>[] = [
    { id: 'nome', rotulo: 'Vendedor', valor: (l) => l.nome, render: (l) => <span className="font-medium text-dark-50">{l.nome}</span> },
    { id: 'tent', rotulo: 'Tentativas', valor: (l) => l.tentativas, formato: 'numero', somar: true },
    { id: 'efet', rotulo: 'Efetivas', valor: (l) => l.efetivas, formato: 'numero', somar: true },
    { id: 'pct', rotulo: '% efetivas', valor: (l) => l.percentualEfetividade, formato: 'pct', render: (l) => <BarraPct valor={l.percentualEfetividade} cor="#06b6d4" /> },
  ]
  const colC: Coluna<C>[] = [
    { id: 'cliente', rotulo: 'Cliente', valor: (l) => l.razaoSocial, render: (l) => <span className="font-medium text-dark-50">{l.razaoSocial}</span> },
    { id: 'tent', rotulo: 'Tentativas', valor: (l) => l.tentativas, formato: 'numero', somar: true },
    { id: 'efet', rotulo: 'Efetivas', valor: (l) => l.efetivas, formato: 'numero', somar: true },
    { id: 'pend', rotulo: 'Sem resultado', valor: (l) => l.pendentes, formato: 'numero', somar: true },
    { id: 'pct', rotulo: '% efetivas', valor: (l) => l.percentualEfetividade, formato: 'pct' },
    { id: 'dur', rotulo: 'Duração média', valor: (l) => Math.round(l.duracaoMediaSegundos ?? 0), render: (l) => duracao(l.duracaoMediaSegundos), formato: 'numero' },
  ]
  const colL: Coluna<L>[] = [
    { id: 'data', rotulo: 'Data e hora', valor: (l) => l.dataHora, render: (l) => `${formatarDataCurta(l.dataHora)} ${l.dataHora.slice(11, 16)}` },
    ...(simples ? [] : [{ id: 'vendedor', rotulo: 'Vendedor', valor: (l: L) => l.vendedorNome }]),
    { id: 'cliente', rotulo: 'Cliente', valor: (l) => l.razaoSocial, render: (l) => <span className="font-medium text-dark-50">{l.razaoSocial}</span> },
    { id: 'dur', rotulo: 'Duração', valor: (l) => l.duracaoSegundos, render: (l) => duracao(l.duracaoSegundos), formato: 'numero' },
    { id: 'resultado', rotulo: 'Resultado', valor: (l) => (l.resultado ? RESULTADO[l.resultado] ?? l.resultado : 'Pendente'), render: (l) => (l.resultado ? RESULTADO[l.resultado] ?? l.resultado : <Etiqueta cor="#f2a516">Pendente</Etiqueta>) },
    { id: 'efetiva', rotulo: 'Efetiva', valor: (l) => (l.efetiva ? 'Sim' : 'Não'), render: (l) => (l.efetiva ? <Etiqueta cor="#22a861">Sim</Etiqueta> : <Etiqueta cor="#9aa5b1">Não</Etiqueta>) },
    { id: 'origem', rotulo: 'Origem', valor: (l) => ORIGEM[l.origem] ?? l.origem, oculta: true },
    { id: 'obs', rotulo: 'Observação', valor: (l) => l.observacao, oculta: true, quebrar: true },
  ]

  return (
    <div className="space-y-5">
      {mostrarResumo && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard titulo="Tentativas" icone={PhoneCall} cor="#06b6d4" valor={numero(tent)} atual={tent} anterior={tentAnt} />
            <KpiCard titulo="Efetivas" icone={PhoneIncoming} cor="#22a861" valor={numero(efet)} detalhe="atendeu ou passou do tempo mínimo" />
            <KpiCard titulo="% efetivas" icone={PhoneIncoming} cor="#8b5cf6" valor={pct(tent ? (efet / tent) * 100 : 0)} />
            <KpiCard titulo="Sem resultado confirmado" icone={Clock} cor="#f2a516" valor={numero(pendentes)} detalhe="ninguém marcou se atendeu" destaque={pendentes ? 'ruim' : undefined} />
          </div>
          <Secao titulo="Ligações por dia" subtitulo="Tentativas x efetivas">
            {porDia.length ? (
              <div className="h-56 -ml-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={porDia} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-dark-700)" vertical={false} />
                    <XAxis dataKey="data" tickFormatter={diaMes} tick={tick} axisLine={false} tickLine={false} minTickGap={14} />
                    <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={32} />
                    <Tooltip labelFormatter={(d) => formatarDataCurta(String(d))} contentStyle={estiloTooltip} cursor={{ fill: 'var(--color-dark-700)', opacity: 0.4 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="tentativas" name="Tentativas" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="efetivas" name="Efetivas" fill="#22a861" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-dark-500 py-12 text-center">Nenhuma ligação no período.</p>
            )}
          </Secao>
        </>
      )}
      <Abas<'vendedor' | 'cliente' | 'todas'>
        valor={aba}
        onChange={setAba}
        opcoes={[
          ...(simples ? [] : [{ valor: 'vendedor' as const, rotulo: 'Por vendedor', contagem: porVendedor?.length }]),
          { valor: 'cliente', rotulo: 'Por cliente', contagem: porCliente?.length },
          { valor: 'todas', rotulo: 'Uma a uma', contagem: detalhado?.length },
        ]}
      />
      {aba === 'vendedor' && !simples && (
        <TabelaDados id="ligacoes-vendedor" linhas={porVendedor} colunas={colV} chave={(l) => l.vendedorId} buscaEm={(l) => l.nome} placeholderBusca="Buscar vendedor..." nomeArquivo="ligacoes-por-vendedor.csv" ordemInicial={{ coluna: 'tent', direcao: 'desc' }} carregando={isLoading} />
      )}
      {aba === 'cliente' && (
        <TabelaDados id="ligacoes-cliente" linhas={porCliente} colunas={colC} chave={(l) => l.clienteId} buscaEm={(l) => l.razaoSocial} placeholderBusca="Buscar cliente..." nomeArquivo="ligacoes-por-cliente.csv" link={(l) => `${clientesBase}/${l.clienteId}`} ordemInicial={{ coluna: 'tent', direcao: 'desc' }} simples={simples} />
      )}
      {aba === 'todas' && (
        <TabelaDados
          id="ligacoes-todas"
          linhas={detalhado}
          colunas={colL}
          chave={(l) => l.id}
          buscaEm={(l) => `${l.razaoSocial} ${l.vendedorNome} ${l.observacao ?? ''}`}
          placeholderBusca="Buscar cliente, vendedor ou observação..."
          nomeArquivo="ligacoes-detalhado.csv"
          link={(l) => `${clientesBase}/${l.clienteId}`}
          ordemInicial={{ coluna: 'data', direcao: 'desc' }}
          simples={simples}
        />
      )}
    </div>
  )
}
