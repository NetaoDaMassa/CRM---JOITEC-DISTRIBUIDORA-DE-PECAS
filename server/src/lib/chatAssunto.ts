import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, expedicaoPedidos, leads, ordens, solicitacoesCredito, visitas } from '../db/schema.js'

// "Do que se trata" cada conversa, pra lista e o topo da conversa (João,
// 2026-11-27: "pro vendedor e pros outros gerentes é difícil entender do que
// de fato estão falando ou de qual cliente"). Antes a lista só mostrava o
// título "Vendedor — Consulta de crédito — Cliente" cortado no meio; agora
// cliente, código do SAP e nº do pedido vêm separados.

export type Assunto = {
  clienteId: number | null
  clienteNome: string | null
  clienteCodigo: string | null
  pedidoSap: string | null
  responsavel: string | null
}

type Conv = { id: number; tipoOrigem: string; idOrigem: number | null; tituloSnapshot: string | null }

const VAZIO: Assunto = { clienteId: null, clienteNome: null, clienteCodigo: null, pedidoSap: null, responsavel: null }

function responsavelDoTitulo(c: Conv): string | null {
  if (c.tipoOrigem === 'direta' || c.tipoOrigem === 'grupo') return null
  const partes = (c.tituloSnapshot ?? '').split(' — ')
  return partes.length >= 2 ? partes[0].trim() || null : null
}

const porIds = <T,>(lista: Conv[], tipo: string) => [...new Set(lista.filter((c) => c.tipoOrigem === tipo && c.idOrigem).map((c) => c.idOrigem!))] as T[]

export async function assuntosDasConversas(conversas: Conv[]): Promise<Map<number, Assunto>> {
  const out = new Map<number, Assunto>()
  for (const c of conversas) out.set(c.id, { ...VAZIO, responsavel: responsavelDoTitulo(c) })

  const idsCliente = porIds<number>(conversas, 'cliente')
  const idsCredito = porIds<number>(conversas, 'consulta_credito')
  const idsPedido = porIds<number>(conversas, 'pedido')
  const idsVisita = porIds<number>(conversas, 'visita')
  const idsLead = porIds<number>(conversas, 'lead')
  const entries = porIds<number>(conversas, 'expedicao')

  const creditos = idsCredito.length
    ? await db.select({ id: solicitacoesCredito.id, clienteId: solicitacoesCredito.clienteId }).from(solicitacoesCredito).where(inArray(solicitacoesCredito.id, idsCredito))
    : []
  const pedidos = idsPedido.length ? await db.select({ id: ordens.id, clienteId: ordens.clienteId }).from(ordens).where(inArray(ordens.id, idsPedido)) : []
  const todosClientes = [...new Set([...idsCliente, ...creditos.map((c) => c.clienteId), ...pedidos.map((p) => p.clienteId).filter((x): x is number => !!x)])]
  const cadastros = todosClientes.length
    ? await db.select({ id: clientes.id, razaoSocial: clientes.razaoSocial, codigo: clientes.codigo }).from(clientes).where(inArray(clientes.id, todosClientes))
    : []
  const cliPorId = new Map(cadastros.map((c) => [c.id, c]))
  const credPorId = new Map(creditos.map((c) => [c.id, c.clienteId]))
  const pedPorId = new Map(pedidos.map((p) => [p.id, p.clienteId]))

  const vis = idsVisita.length ? await db.select({ id: visitas.id, clienteNome: visitas.clienteNome }).from(visitas).where(inArray(visitas.id, idsVisita)) : []
  const visPorId = new Map(vis.map((v) => [v.id, v.clienteNome]))
  const lds = idsLead.length ? await db.select({ id: leads.id, name: leads.name, company: leads.company }).from(leads).where(inArray(leads.id, idsLead)) : []
  const leadPorId = new Map(lds.map((l) => [l.id, l.company || l.name]))

  // Pedido do SAP na expedição: o DocEntry fica em orderEntriesSap (lista).
  const exp = entries.length
    ? await db
        .select({ orderEntriesSap: expedicaoPedidos.orderEntriesSap, pedidosSap: expedicaoPedidos.pedidosSap, clienteNome: expedicaoPedidos.clienteNome, clienteCodigo: expedicaoPedidos.clienteCodigo, empresaId: expedicaoPedidos.empresaId })
        .from(expedicaoPedidos)
        .where(or(...entries.map((e) => sql`',' || ${expedicaoPedidos.orderEntriesSap} || ',' like ${`%,${e},%`}`)))
    : []
  const expPorEntry = new Map<number, (typeof exp)[number]>()
  for (const e of exp) for (const n of e.orderEntriesSap.split(',').map(Number)) if (!expPorEntry.has(n)) expPorEntry.set(n, e)
  // id do cadastro do cliente da expedição (pra "Ver ficha"), mesma empresa.
  const codsExp = [...new Set(exp.map((e) => e.clienteCodigo?.trim().toUpperCase()).filter((x): x is string => !!x))]
  const cadExp = codsExp.length
    ? await db
        .select({ id: clientes.id, codigo: clientes.codigo, empresaId: clientes.empresaId })
        .from(clientes)
        .where(and(inArray(sql`upper(trim(${clientes.codigo}))`, codsExp), sql`${clientes.deletedAt} is null`))
    : []
  const cadExpPor = new Map(cadExp.map((c) => [`${c.empresaId}|${c.codigo.trim().toUpperCase()}`, c.id]))

  for (const c of conversas) {
    const a = out.get(c.id)!
    if (!c.idOrigem) continue
    let cliId: number | null | undefined = null
    if (c.tipoOrigem === 'cliente') cliId = c.idOrigem
    else if (c.tipoOrigem === 'consulta_credito') cliId = credPorId.get(c.idOrigem)
    else if (c.tipoOrigem === 'pedido') {
      cliId = pedPorId.get(c.idOrigem)
      a.pedidoSap = `#${c.idOrigem}`
    } else if (c.tipoOrigem === 'visita') a.clienteNome = visPorId.get(c.idOrigem) ?? null
    else if (c.tipoOrigem === 'lead') a.clienteNome = leadPorId.get(c.idOrigem) ?? null
    else if (c.tipoOrigem === 'expedicao') {
      const e = expPorEntry.get(c.idOrigem)
      if (e) {
        a.clienteNome = e.clienteNome
        a.clienteCodigo = e.clienteCodigo?.trim() || null
        a.pedidoSap = e.pedidosSap
        a.clienteId = e.clienteCodigo ? cadExpPor.get(`${e.empresaId}|${e.clienteCodigo.trim().toUpperCase()}`) ?? null : null
      }
    }
    if (cliId) {
      const cli = cliPorId.get(cliId)
      if (cli) {
        a.clienteId = cli.id
        a.clienteNome = cli.razaoSocial
        a.clienteCodigo = cli.codigo
      }
    }
    // Registro apagado: tira o cliente do próprio título salvo.
    if (!a.clienteNome && c.tituloSnapshot) {
      const partes = c.tituloSnapshot.split(' — ')
      if (partes.length >= 2) a.clienteNome = partes[partes.length - 1].trim() || null
    }
  }
  return out
}
