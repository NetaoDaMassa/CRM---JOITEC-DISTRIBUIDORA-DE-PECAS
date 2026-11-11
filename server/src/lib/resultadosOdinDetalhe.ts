// "Resultados Odin" clicável — pedido do João, 2026-11-11 ("esses 14
// aguardando, não sei quem são"). Cada número da tela abre a lista do que
// ele conta, com os MESMOS filtros de lib/resultadosOdin.ts (mesma equipe por
// users.canalVenda, mesmo período em dia de Brasília → UTC +3h). Se mudar a
// regra de um número lá, mude aqui também.
import { and, desc, eq, gte, inArray, isNull, lt, ne } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, funilMensal, leadContactAttempts, leads, ordemDetalhes, ordens, propostas, registroContato, users, vendas, visitas } from '../db/schema.js'

export const TIPOS_DETALHE_ODIN = ['leads', 'aguardando', 'contatos', 'propostas', 'pedidos', 'visitas', 'vendas', 'ligacoes'] as const
export type TipoDetalheOdin = (typeof TIPOS_DETALHE_ODIN)[number]
export type FrenteDetalheOdin = 'geral' | 'externos' | 'leads' | 'pecas'

export type LinhaDetalheOdin = {
  id: number
  nome: string
  detalhe: string | null
  vendedor: string
  data: string | null // UTC "YYYY-MM-DD HH:MM:SS" ou dia "YYYY-MM-DD"
  valor: number | null
  link: string | null // relativo a /admin ou /vendedor (ex: "leads/12")
}

const proximoDia = (dia: string) => new Date(new Date(`${dia}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
const CANAL: Record<Exclude<FrenteDetalheOdin, 'geral'>, 'visitas' | 'leads' | 'pecas'> = { externos: 'visitas', leads: 'leads', pecas: 'pecas' }
const ROTULO_STATUS: Record<string, string> = {
  novo: 'Novo', novo_consumidor_final: 'Novo', abordagem: 'Abordagem', qualificado: 'Qualificado', repasse_comercial: 'Repasse Comercial',
  em_negociacao: 'Em Negociação', ganho: 'Ganho', perdido: 'Perdido', desqualificado: 'Desqualificado', consumidor_final: 'Consumidor Final',
}
const ROTULO_ETAPA_PROPOSTA: Record<string, string> = {
  proposta: 'Proposta', negociacao: 'Negociação', fechado: 'Fechado', convertido: 'Virou pedido', perdido: 'Perdida', chamar_depois: 'Chamar depois',
}
const ROTULO_CANAL: Record<string, string> = { ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail' }
const ROTULO_RESULTADO: Record<string, string> = {
  confirmado: 'confirmado', sem_resposta: 'sem resposta', nao_atendeu: 'não atendeu', reagendou: 'reagendou', recusou: 'recusou', avancou: 'avançou',
}

export async function resultadosOdinDetalhe(params: {
  empresaId: number
  frente: FrenteDetalheOdin
  tipo: TipoDetalheOdin
  de: string
  ate: string
  vendedorId?: number
  somenteVendedorId?: number
}): Promise<LinhaDetalheOdin[]> {
  const { empresaId, frente, tipo, de, ate } = params
  const fimExclusivo = proximoDia(ate)
  const utc = { de: `${de} 03:00:00`, ate: `${fimExclusivo} 03:00:00` }

  const todos = await db.query.users.findMany({
    where: and(eq(users.empresaId, empresaId), eq(users.isActive, true), ne(users.canalVenda, 'nenhum')),
    columns: { id: true, name: true, canalVenda: true },
  })
  const nomeDe = new Map((await db.query.users.findMany({ where: eq(users.empresaId, empresaId), columns: { id: true, name: true } })).map((u) => [u.id, u.name]))
  const vendedor = (id: number | null | undefined) => (id ? nomeDe.get(id) ?? '—' : 'Sem vendedor')

  let membros = frente === 'geral' ? todos : todos.filter((m) => m.canalVenda === CANAL[frente])
  if (params.somenteVendedorId) membros = membros.filter((m) => m.id === params.somenteVendedorId)
  if (params.vendedorId) membros = membros.filter((m) => m.id === params.vendedorId)
  const ids = membros.map((m) => m.id)
  if (!ids.length && !(frente === 'geral' && tipo === 'pedidos' && !params.somenteVendedorId && !params.vendedorId)) return []

  if (tipo === 'leads' || tipo === 'aguardando') {
    const where =
      tipo === 'leads'
        ? and(eq(leads.empresaId, empresaId), inArray(leads.vendorId, ids), isNull(leads.deletedAt), gte(leads.createdAt, utc.de), lt(leads.createdAt, utc.ate))
        : and(eq(leads.empresaId, empresaId), inArray(leads.vendorId, ids), isNull(leads.deletedAt), inArray(leads.status, ['novo', 'novo_consumidor_final']))
    const lista = await db.query.leads.findMany({
      where,
      columns: { id: true, name: true, company: true, city: true, status: true, vendorId: true, createdAt: true, deletedAt: true },
      orderBy: (l, o) => (tipo === 'aguardando' ? [o.asc(l.createdAt)] : [o.desc(l.createdAt)]),
    })
    return lista.map((l) => ({
      id: l.id,
      nome: l.name,
      detalhe: [l.company, l.city, tipo === 'leads' ? ROTULO_STATUS[l.status] ?? l.status : null, l.deletedAt ? 'excluído' : null].filter(Boolean).join(' · ') || null,
      vendedor: vendedor(l.vendorId),
      data: l.createdAt,
      valor: null,
      link: l.deletedAt ? null : `leads/${l.id}`,
    }))
  }

  if (tipo === 'contatos' && frente === 'leads') {
    const lista = await db
      .select({ id: leadContactAttempts.id, leadId: leadContactAttempts.leadId, userId: leadContactAttempts.userId, channel: leadContactAttempts.channel, result: leadContactAttempts.result, createdAt: leadContactAttempts.createdAt, nome: leads.name, company: leads.company })
      .from(leadContactAttempts)
      .leftJoin(leads, eq(leads.id, leadContactAttempts.leadId))
      .where(and(inArray(leadContactAttempts.userId, ids), gte(leadContactAttempts.createdAt, utc.de), lt(leadContactAttempts.createdAt, utc.ate)))
      .orderBy(desc(leadContactAttempts.createdAt))
    return lista.map((t) => ({
      id: t.id,
      nome: t.nome ?? `Lead #${t.leadId}`,
      detalhe: [t.company, `${ROTULO_CANAL[t.channel] ?? t.channel}${t.result ? ` — ${ROTULO_RESULTADO[t.result] ?? t.result}` : ''}`].filter(Boolean).join(' · '),
      vendedor: vendedor(t.userId),
      data: t.createdAt,
      valor: null,
      link: `leads/${t.leadId}`,
    }))
  }

  if (tipo === 'propostas') {
    const lista = await db.query.propostas.findMany({
      where: and(eq(propostas.empresaId, empresaId), inArray(propostas.vendedorId, ids), gte(propostas.createdAt, utc.de), lt(propostas.createdAt, utc.ate)),
      columns: { id: true, clienteNome: true, stage: true, vendedorId: true, createdAt: true, produtosDescricao: true },
      orderBy: (p, o) => [o.desc(p.createdAt)],
    })
    return lista.map((p) => ({
      id: p.id,
      nome: p.clienteNome,
      detalhe: [ROTULO_ETAPA_PROPOSTA[p.stage] ?? p.stage, p.produtosDescricao?.replace(/[•\s]+/g, ' ').trim().slice(0, 80)].filter(Boolean).join(' · '),
      vendedor: vendedor(p.vendedorId),
      data: p.createdAt,
      valor: null,
      link: `propostas/${p.id}`,
    }))
  }

  if (tipo === 'pedidos') {
    const filtros = [eq(ordens.empresaId, empresaId), ne(ordens.status, 'cancelado'), gte(ordens.createdAt, utc.de), lt(ordens.createdAt, utc.ate)]
    if (ids.length && (frente !== 'geral' || params.somenteVendedorId || params.vendedorId)) filtros.push(inArray(ordens.vendedorId, ids))
    const lista = await db
      .select({ id: ordens.id, vendedorId: ordens.vendedorId, createdAt: ordens.createdAt, stage: ordens.stage, codSap: ordens.codSap, valor: ordemDetalhes.valorPedido, numeroPedido: ordemDetalhes.numeroPedido, cliente: clientes.razaoSocial })
      .from(ordens)
      .leftJoin(ordemDetalhes, eq(ordemDetalhes.ordemId, ordens.id))
      .leftJoin(clientes, eq(clientes.id, ordens.clienteId))
      .where(and(...filtros))
      .orderBy(desc(ordens.createdAt))
    return lista.map((o) => ({
      id: o.id,
      nome: o.cliente ?? `Pedido #${o.id}`,
      detalhe: [`Pedido #${o.id}`, o.numeroPedido ? `nº ${o.numeroPedido}` : null, o.codSap ? `SAP ${o.codSap}` : null].filter(Boolean).join(' · '),
      vendedor: vendedor(o.vendedorId),
      data: o.createdAt,
      valor: o.valor ?? 0,
      link: `ordens/${o.id}`,
    }))
  }

  if (tipo === 'visitas') {
    const lista = await db.query.visitas.findMany({
      where: and(eq(visitas.empresaId, empresaId), inArray(visitas.vendedorId, ids), gte(visitas.dataVisita, de), lt(visitas.dataVisita, fimExclusivo)),
      columns: { id: true, clienteNome: true, nomeEmpresa: true, dataVisita: true, vendedorId: true, latCheckin: true, resultado: true, convertidoParaPropostaId: true },
      orderBy: (v, o) => [o.desc(v.dataVisita)],
    })
    return lista.map((v) => ({
      id: v.id,
      nome: v.nomeEmpresa || v.clienteNome || `Visita #${v.id}`,
      detalhe: [v.latCheckin != null ? 'com GPS' : 'sem GPS', v.convertidoParaPropostaId ? `virou Proposta #${v.convertidoParaPropostaId}` : null, v.resultado?.replace(/\s+/g, ' ').slice(0, 80)].filter(Boolean).join(' · '),
      vendedor: vendedor(v.vendedorId),
      data: v.dataVisita ? v.dataVisita.slice(0, 10) : null, // hora de Brasília, sem fuso — só o dia
      valor: null,
      link: v.convertidoParaPropostaId ? `propostas/${v.convertidoParaPropostaId}` : 'visitas',
    }))
  }

  if (tipo === 'contatos' || tipo === 'ligacoes') {
    const filtros = [inArray(registroContato.vendedorId, ids), isNull(registroContato.deletedAt), gte(registroContato.dataHora, utc.de), lt(registroContato.dataHora, utc.ate)]
    if (tipo === 'ligacoes') filtros.push(eq(registroContato.tipo, 'ligacao'))
    const lista = await db
      .select({ id: registroContato.id, vendedorId: registroContato.vendedorId, tipo: registroContato.tipo, resultado: registroContato.resultado, dataHora: registroContato.dataHora, clienteId: funilMensal.clienteId, cliente: clientes.razaoSocial })
      .from(registroContato)
      .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
      .leftJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros))
      .orderBy(desc(registroContato.dataHora))
    return lista.map((c) => ({
      id: c.id,
      nome: c.cliente ?? `Cliente #${c.clienteId}`,
      detalhe: [ROTULO_CANAL[c.tipo] ?? c.tipo, c.resultado].filter(Boolean).join(' · '),
      vendedor: vendedor(c.vendedorId),
      data: c.dataHora,
      valor: null,
      link: `clientes/${c.clienteId}`,
    }))
  }

  if (tipo === 'vendas') {
    const lista = await db
      .select({ id: vendas.id, vendedorId: vendas.vendedorId, valor: vendas.valorFechado, data: vendas.dataFechamento, clienteId: vendas.clienteId, cliente: clientes.razaoSocial, numeroPedido: vendas.numeroPedido, nf: vendas.numeroNotaFiscal })
      .from(vendas)
      .leftJoin(clientes, eq(clientes.id, vendas.clienteId))
      .where(and(inArray(vendas.vendedorId, ids), isNull(vendas.deletedAt), gte(vendas.dataFechamento, utc.de), lt(vendas.dataFechamento, utc.ate)))
      .orderBy(desc(vendas.dataFechamento))
    return lista.map((v) => ({
      id: v.id,
      nome: v.cliente ?? `Cliente #${v.clienteId}`,
      detalhe: [v.numeroPedido ? `pedido ${v.numeroPedido}` : null, v.nf ? `NF ${v.nf}` : null].filter(Boolean).join(' · ') || null,
      vendedor: vendedor(v.vendedorId),
      data: v.data,
      valor: v.valor,
      link: `clientes/${v.clienteId}`,
    }))
  }

  return []
}
