// Relatórios (Odin Compressores) — portado dos 5 relatórios do odincrm
// (propostas_reports, pipeline_reports, pos_venda_reports,
// faturamento_reports, machine_reports, marketing_reports=visitas). Só
// contagens/agregações — não é módulo de dados novo, consulta os módulos
// já existentes (Propostas, Ordens, Estoque, Visitas). Gestor-only, igual
// ao odincrm original. A análise de tempo-por-etapa do pipeline original
// (bem mais complexa, caminha o histórico calculando duração) foi
// simplificada aqui pra contagem por etapa — o essencial pra gestão do
// dia a dia sem a complexidade de recalcular série temporal.
import { z } from 'zod'
import { eq, and, gte, lte } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, propostas, ordens, ordemPosVenda, ordemDetalhes, ordemFaturamento, estoqueMaquinas, visitas } from '../db/schema.js'

const SLUG_RELATORIOS = 'odin-compressores'

async function assertEmpresa(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_RELATORIOS) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
}

const filtroData = z.object({ dataDe: z.string().optional(), dataAte: z.string().optional() }).optional()

export const relatoriosOdinRouter = router({
  propostas: adminProcedure.input(filtroData).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const condicoes = [eq(propostas.empresaId, ctx.empresaId)]
    if (input?.dataDe) condicoes.push(gte(propostas.createdAt, input.dataDe))
    if (input?.dataAte) condicoes.push(lte(propostas.createdAt, `${input.dataAte} 23:59:59`))
    const todas = await db.query.propostas.findMany({ where: and(...condicoes), with: { vendedor: { columns: { id: true, name: true } } } })

    const total = todas.length
    const convertidas = todas.filter((p) => p.convertidoParaOrdemId !== null).length
    const porEtapa: Record<string, number> = {}
    const porVendedor: Record<number, { vendedorId: number; vendedorNome: string; total: number; convertidas: number }> = {}
    for (const p of todas) {
      porEtapa[p.stage] = (porEtapa[p.stage] ?? 0) + 1
      const key = p.vendedorId
      if (!porVendedor[key]) porVendedor[key] = { vendedorId: key, vendedorNome: p.vendedor?.name ?? '—', total: 0, convertidas: 0 }
      porVendedor[key].total++
      if (p.convertidoParaOrdemId) porVendedor[key].convertidas++
    }
    return {
      total,
      convertidas,
      taxaConversao: total ? Math.round((convertidas / total) * 1000) / 10 : 0,
      porEtapa,
      porVendedor: Object.values(porVendedor).sort((a, b) => b.total - a.total),
    }
  }),

  pipeline: adminProcedure.input(filtroData).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const condicoes = [eq(ordens.empresaId, ctx.empresaId)]
    if (input?.dataDe) condicoes.push(gte(ordens.createdAt, input.dataDe))
    if (input?.dataAte) condicoes.push(lte(ordens.createdAt, `${input.dataAte} 23:59:59`))
    const todos = await db.query.ordens.findMany({ where: and(...condicoes), with: { vendedor: { columns: { id: true, name: true } } } })

    const porEtapa: Record<string, number> = {}
    const porStatus: Record<string, number> = {}
    const porTipo: Record<string, number> = {}
    for (const o of todos) {
      porEtapa[o.stage] = (porEtapa[o.stage] ?? 0) + 1
      porStatus[o.status] = (porStatus[o.status] ?? 0) + 1
      porTipo[o.orderType] = (porTipo[o.orderType] ?? 0) + 1
    }
    return { total: todos.length, porEtapa, porStatus, porTipo }
  }),

  posVenda: adminProcedure.query(async ({ ctx }) => {
    await assertEmpresa(ctx.empresaId)
    const [registros, pedidosDaEmpresa] = await Promise.all([
      db.query.ordemPosVenda.findMany(),
      db.query.ordens.findMany({ where: eq(ordens.empresaId, ctx.empresaId), columns: { id: true } }),
    ])
    const idsDaEmpresa = new Set(pedidosDaEmpresa.map((o) => o.id))
    const daEmpresa = registros.filter((r) => idsDaEmpresa.has(r.ordemId))
    const comNps = daEmpresa.filter((r) => r.npsScore !== null)
    const mediaNps = comNps.length ? Math.round((comNps.reduce((acc, r) => acc + (r.npsScore ?? 0), 0) / comNps.length) * 10) / 10 : null
    return { total: daEmpresa.length, comFeedback: daEmpresa.filter((r) => r.feedbackCliente).length, mediaNps, comLembretePendente: daEmpresa.filter((r) => r.dataLembrete).length }
  }),

  faturamento: adminProcedure.input(filtroData).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const condicoes = [eq(ordens.empresaId, ctx.empresaId)]
    if (input?.dataDe) condicoes.push(gte(ordens.createdAt, input.dataDe))
    if (input?.dataAte) condicoes.push(lte(ordens.createdAt, `${input.dataAte} 23:59:59`))
    const pedidos = await db.query.ordens.findMany({ where: and(...condicoes) })
    const ids = pedidos.map((p) => p.id)

    const [detalhes, faturamentos] = await Promise.all([
      db.query.ordemDetalhes.findMany(),
      db.query.ordemFaturamento.findMany(),
    ])
    const detalhesPorOrdem = new Map(detalhes.map((d) => [d.ordemId, d]))
    const faturamentoPorOrdem = new Map(faturamentos.map((f) => [f.ordemId, f]))

    let valorTotal = 0
    let valorConfirmado = 0
    let qtdConfirmado = 0
    for (const id of ids) {
      const valor = detalhesPorOrdem.get(id)?.valorPedido ?? 0
      valorTotal += valor
      const fat = faturamentoPorOrdem.get(id)
      if (fat?.pagamentoConfirmado) {
        valorConfirmado += valor
        qtdConfirmado++
      }
    }
    return { totalPedidos: ids.length, valorTotal, valorConfirmado, qtdConfirmado }
  }),

  maquinas: adminProcedure.query(async ({ ctx }) => {
    await assertEmpresa(ctx.empresaId)
    const todas = await db.query.estoqueMaquinas.findMany({ where: eq(estoqueMaquinas.empresaId, ctx.empresaId) })
    const porStatus: Record<string, number> = {}
    const porPorte: Record<string, number> = {}
    for (const m of todas) {
      porStatus[m.status] = (porStatus[m.status] ?? 0) + 1
      porPorte[m.porte] = (porPorte[m.porte] ?? 0) + 1
    }
    return { total: todas.length, porStatus, porPorte }
  }),

  visitas: adminProcedure.input(filtroData).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const condicoes = [eq(visitas.empresaId, ctx.empresaId)]
    if (input?.dataDe) condicoes.push(gte(visitas.dataVisita, input.dataDe))
    if (input?.dataAte) condicoes.push(lte(visitas.dataVisita, `${input.dataAte} 23:59:59`))
    const todas = await db.query.visitas.findMany({ where: and(...condicoes), with: { vendedor: { columns: { id: true, name: true } } } })

    const porResultado: Record<string, number> = {}
    const porVendedor: Record<number, { vendedorId: number; vendedorNome: string; total: number; propostas: number }> = {}
    for (const v of todas) {
      const key = v.resultado || 'em_andamento'
      porResultado[key] = (porResultado[key] ?? 0) + 1
      const vid = v.vendedorId
      if (!porVendedor[vid]) porVendedor[vid] = { vendedorId: vid, vendedorNome: v.vendedor?.name ?? '—', total: 0, propostas: 0 }
      porVendedor[vid].total++
      if (v.convertidoParaPropostaId) porVendedor[vid].propostas++
    }
    return { total: todas.length, porResultado, porVendedor: Object.values(porVendedor).sort((a, b) => b.total - a.total) }
  }),
})
