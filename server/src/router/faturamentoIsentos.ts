import { z } from 'zod'
import { and, eq, inArray, isNull, notInArray, or } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, empresas, expedicaoPedidos, users, vendas } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { entriesDoCard } from '../lib/adiantamentoPix.js'

// Faturista (Dani, financeiro 2026-11-13): a parte da expedição dos clientes
// ISENTOS — pedido a pedido, "Aguardando pagamento" ou "Pago". Cross-empresa
// (Joitec, Odin Tubos, Odin Automação), sem trocar de empresa. Isento = o
// mesmo selo "CLIENTE ISENTO" da expedição (Status fiscal do cadastro).
const FEATURE = 'faturamento_isentos'
const EMPRESAS = ['joitec', 'odin-tubos', 'joitec-automacao']

const ETAPA_LABEL: Record<string, string> = {
  separacao: 'Separação',
  conferencia: 'Conferência',
  embalagem: 'Embalagem',
  nf: 'Aguardando NF',
  agendamento: 'Agendamento',
  coleta: 'Coleta agendada',
  coletado: 'Coletado',
}

async function pedidosIsentos() {
  const emp = await db.select({ id: empresas.id, nome: empresas.nome }).from(empresas).where(inArray(empresas.slug, EMPRESAS))
  if (!emp.length) return []
  const nomeEmpresa = new Map(emp.map((e) => [e.id, e.nome]))
  const pedidos = await db
    .select()
    .from(expedicaoPedidos)
    .where(and(inArray(expedicaoPedidos.empresaId, emp.map((e) => e.id)), eq(expedicaoPedidos.historico, false), notInArray(expedicaoPedidos.etapa, ['cancelado', 'descartado'])))
  const codigos = [...new Set(pedidos.map((p) => p.clienteCodigo).filter((c): c is string => !!c))]
  if (!codigos.length) return []
  const cadastros = await db
    .select({ codigo: clientes.codigo, codigoAntigo: clientes.codigoAntigo, empresaId: clientes.empresaId, statusFiscal: clientes.statusFiscal })
    .from(clientes)
    .where(and(isNull(clientes.deletedAt), or(inArray(clientes.codigo, codigos), inArray(clientes.codigoAntigo, codigos))))
  // Mesma regra do selo da expedição: vale o cadastro da empresa do pedido;
  // sem status lá, o de outra empresa com o mesmo código.
  const isento = (codigo: string | null, empresaId: number) => {
    if (!codigo) return false
    const doCodigo = cadastros.filter((c) => c.statusFiscal && (c.codigo === codigo || c.codigoAntigo === codigo))
    const daEmpresa = doCodigo.filter((c) => c.empresaId === empresaId)
    return (daEmpresa.length ? daEmpresa : doCodigo).some((c) => c.statusFiscal === 'isento')
  }
  const lista = pedidos.filter((p) => isento(p.clienteCodigo, p.empresaId))
  // Valor e condição de pagamento vêm da venda ligada ao pedido do SAP.
  const entries = lista.flatMap((p) => entriesDoCard(p.orderEntriesSap))
  const vs = entries.length
    ? await db
        .select({ entry: vendas.pedidoSapEntry, valor: vendas.valorFechado, condicao: vendas.condicaoPagamento, vendedor: users.name })
        .from(vendas)
        .innerJoin(users, eq(users.id, vendas.vendedorId))
        .where(and(inArray(vendas.pedidoSapEntry, entries), isNull(vendas.deletedAt)))
    : []
  const porEntry = new Map(vs.map((v) => [v.entry, v]))
  const quem = new Map(
    (
      await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, [...new Set(lista.map((p) => p.pagamentoAlteradoPor).filter((x): x is number => !!x))].concat(0)))
    ).map((u) => [u.id, u.name])
  )
  return lista.map((p) => {
    const vendasDoPedido = entriesDoCard(p.orderEntriesSap).map((e) => porEntry.get(e)).filter(Boolean)
    return {
      id: p.id,
      empresaNome: nomeEmpresa.get(p.empresaId) ?? '',
      pedidosSap: p.pedidosSap,
      clienteNome: p.clienteNome,
      clienteCodigo: p.clienteCodigo,
      vendedor: vendasDoPedido[0]?.vendedor ?? p.vendedorSap,
      valor: vendasDoPedido.reduce((s, v) => s + (v?.valor ?? 0), 0) || null,
      condicao: vendasDoPedido[0]?.condicao ?? null,
      etapa: p.etapa,
      etapaLabel: ETAPA_LABEL[p.etapa] ?? p.etapa,
      nfNumero: p.nfNumero,
      dataPicking: p.dataPicking,
      coletadoEm: p.coletadoEm,
      pagamentoStatus: p.pagamentoStatus === 'pago' ? ('pago' as const) : ('aguardando' as const),
      pagamentoAlteradoEm: p.pagamentoAlteradoEm,
      pagamentoAlteradoPor: p.pagamentoAlteradoPor ? quem.get(p.pagamentoAlteradoPor) ?? null : null,
    }
  })
}

export const faturamentoIsentosRouter = router({
  listar: featureProcedure(FEATURE)
    .input(z.object({ aba: z.enum(['aguardando', 'pago']) }))
    .query(async ({ input }) => {
      const todos = await pedidosIsentos()
      const lista = todos.filter((p) => p.pagamentoStatus === input.aba)
      // Aguardando: mais antigos primeiro (esperando há mais tempo). Pago: últimos marcados.
      if (input.aba === 'aguardando') lista.sort((a, b) => a.dataPicking.localeCompare(b.dataPicking))
      else lista.sort((a, b) => (b.pagamentoAlteradoEm ?? '').localeCompare(a.pagamentoAlteradoEm ?? ''))
      return { lista, total: { aguardando: todos.filter((p) => p.pagamentoStatus === 'aguardando').length, pago: todos.filter((p) => p.pagamentoStatus === 'pago').length } }
    }),

  marcar: featureProcedure(FEATURE)
    .input(z.object({ id: z.number(), status: z.enum(['aguardando', 'pago']) }))
    .mutation(async ({ ctx, input }) => {
      const p = await db.query.expedicaoPedidos.findFirst({ where: eq(expedicaoPedidos.id, input.id) })
      if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pedido não encontrado' })
      await db
        .update(expedicaoPedidos)
        .set({ pagamentoStatus: input.status, pagamentoAlteradoEm: agoraSqlite(), pagamentoAlteradoPor: ctx.user.id })
        .where(eq(expedicaoPedidos.id, p.id))
      return { ok: true }
    }),
})
