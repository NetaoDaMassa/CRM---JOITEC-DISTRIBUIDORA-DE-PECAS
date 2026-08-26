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
import { empresas, propostas, propostaArquivos, ordens, ordemPosVenda, ordemDetalhes, ordemFaturamento, estoqueMaquinas, visitas } from '../db/schema.js'

const SLUG_RELATORIOS = 'odin-compressores'

async function assertEmpresa(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_RELATORIOS) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
}

const filtroData = z.object({ dataDe: z.string().optional(), dataAte: z.string().optional(), vendedorId: z.number().optional() }).optional()

export const relatoriosOdinRouter = router({
  propostas: adminProcedure.input(filtroData).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const condicoes = [eq(propostas.empresaId, ctx.empresaId)]
    if (input?.dataDe) condicoes.push(gte(propostas.createdAt, input.dataDe))
    if (input?.dataAte) condicoes.push(lte(propostas.createdAt, `${input.dataAte} 23:59:59`))
    if (input?.vendedorId) condicoes.push(eq(propostas.vendedorId, input.vendedorId))
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
    if (input?.vendedorId) condicoes.push(eq(ordens.vendedorId, input.vendedorId))
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

  posVenda: adminProcedure.input(filtroData).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const condicoes = [eq(ordens.empresaId, ctx.empresaId)]
    if (input?.dataDe) condicoes.push(gte(ordens.createdAt, input.dataDe))
    if (input?.dataAte) condicoes.push(lte(ordens.createdAt, `${input.dataAte} 23:59:59`))
    if (input?.vendedorId) condicoes.push(eq(ordens.vendedorId, input.vendedorId))
    const [registros, pedidosDaEmpresa] = await Promise.all([
      db.query.ordemPosVenda.findMany(),
      db.query.ordens.findMany({ where: and(...condicoes), columns: { id: true } }),
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
    if (input?.vendedorId) condicoes.push(eq(ordens.vendedorId, input.vendedorId))
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

  // Relatório de Marketing — junta Visitas + Propostas num funil só,
  // portado de app/routers/marketing_reports.py do odincrm original
  // (rota /api/reports/marketing). Mais rico que os relatórios individuais
  // acima: por objetivo da visita, evolução mensal, top empresas visitadas,
  // por forma de pagamento/revenda da proposta, funil completo visita→pedido.
  marketing: adminProcedure.input(filtroData).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const condVis = [eq(visitas.empresaId, ctx.empresaId)]
    if (input?.dataDe) condVis.push(gte(visitas.dataVisita, input.dataDe))
    if (input?.dataAte) condVis.push(lte(visitas.dataVisita, `${input.dataAte} 23:59:59`))
    if (input?.vendedorId) condVis.push(eq(visitas.vendedorId, input.vendedorId))
    const condProp = [eq(propostas.empresaId, ctx.empresaId)]
    if (input?.dataDe) condProp.push(gte(propostas.createdAt, input.dataDe))
    if (input?.dataAte) condProp.push(lte(propostas.createdAt, `${input.dataAte} 23:59:59`))
    if (input?.vendedorId) condProp.push(eq(propostas.vendedorId, input.vendedorId))

    const [todasVisitas, todasProp] = await Promise.all([
      db.query.visitas.findMany({ where: and(...condVis), with: { vendedor: { columns: { id: true, name: true } } } }),
      db.query.propostas.findMany({ where: and(...condProp), with: { vendedor: { columns: { id: true, name: true } }, arquivos: true } }),
    ])

    // ── Visitas ──────────────────────────────────────────────────────────
    const totalVisitas = todasVisitas.length
    const planejadas = todasVisitas.filter((v) => v.planejada).length

    const porResultado: Record<string, number> = {}
    const porVendedorVis: Record<number, { vendedorId: number; nome: string; total: number; propostas: number; followUp: number; semInteresse: number }> = {}
    const porObjetivo: Record<string, number> = {}
    const porMesVis: Record<string, { total: number; propostas: number }> = {}
    const porEmpresaVisitada: Record<string, number> = {}
    let somaDuracaoMin = 0
    let qtdComDuracao = 0

    for (const v of todasVisitas) {
      const resultado = v.resultado || 'em_andamento'
      porResultado[resultado] = (porResultado[resultado] ?? 0) + 1

      const vid = v.vendedorId
      if (!porVendedorVis[vid]) porVendedorVis[vid] = { vendedorId: vid, nome: v.vendedor?.name ?? '—', total: 0, propostas: 0, followUp: 0, semInteresse: 0 }
      porVendedorVis[vid].total++
      if (v.resultado === 'gerar_proposta') porVendedorVis[vid].propostas++
      if (v.resultado === 'follow_up') porVendedorVis[vid].followUp++
      if (v.resultado === 'sem_interesse') porVendedorVis[vid].semInteresse++

      const objetivo = v.objetivo || 'Não informado'
      porObjetivo[objetivo] = (porObjetivo[objetivo] ?? 0) + 1

      const mes = (v.dataVisita || '').slice(0, 7)
      if (!porMesVis[mes]) porMesVis[mes] = { total: 0, propostas: 0 }
      porMesVis[mes].total++
      if (v.resultado === 'gerar_proposta') porMesVis[mes].propostas++

      const nomeEmpresa = (v.clienteNome || v.nomeEmpresa || 'Não identificado').trim()
      porEmpresaVisitada[nomeEmpresa] = (porEmpresaVisitada[nomeEmpresa] ?? 0) + 1

      if (v.checkinEm && v.checkoutEm) {
        const min = (new Date(v.checkoutEm.replace(' ', 'T') + 'Z').getTime() - new Date(v.checkinEm.replace(' ', 'T') + 'Z').getTime()) / 60000
        if (min > 0) {
          somaDuracaoMin += min
          qtdComDuracao++
        }
      }
    }

    const visitaParaPropostaTaxa = totalVisitas ? Math.round(((porResultado['gerar_proposta'] ?? 0) / totalVisitas) * 1000) / 10 : 0
    const duracaoMediaMinutos = qtdComDuracao ? Math.round(somaDuracaoMin / qtdComDuracao) : null

    const topEmpresas = Object.entries(porEmpresaVisitada)
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    // ── Propostas ────────────────────────────────────────────────────────
    const totalProp = todasProp.length
    const stageCounts: Record<string, number> = { proposta: 0, negociacao: 0, fechado: 0, convertido: 0, perdido: 0, chamar_depois: 0 }
    const porVendedorProp: Record<number, { vendedorId: number; nome: string; total: number; negociacao: number; fechado: number; convertido: number; semPdf: number }> = {}
    const porPagamento: Record<string, number> = {}
    const porRevenda: Record<string, number> = {}
    const porMesProp: Record<string, { total: number; fechado: number; convertido: number }> = {}
    let semPdfCount = 0

    const temPdf = (p: (typeof todasProp)[number]) => p.arquivos.some((a) => a.fileCategory === 'proposta_pdf' || a.tipoArquivo?.includes('pdf'))

    for (const p of todasProp) {
      stageCounts[p.stage] = (stageCounts[p.stage] ?? 0) + 1

      const vid = p.vendedorId
      if (!porVendedorProp[vid]) porVendedorProp[vid] = { vendedorId: vid, nome: p.vendedor?.name ?? '—', total: 0, negociacao: 0, fechado: 0, convertido: 0, semPdf: 0 }
      const linha = porVendedorProp[vid]
      linha.total++
      if (['negociacao', 'fechado', 'convertido'].includes(p.stage)) linha.negociacao++
      if (['fechado', 'convertido'].includes(p.stage)) linha.fechado++
      if (p.stage === 'convertido') linha.convertido++
      const pdf = temPdf(p)
      if (!pdf) {
        linha.semPdf++
        semPdfCount++
      }

      const pagamento = p.formaPagamento || 'Não informado'
      porPagamento[pagamento] = (porPagamento[pagamento] ?? 0) + 1
      const revenda = p.revenda || 'Sem revenda'
      porRevenda[revenda] = (porRevenda[revenda] ?? 0) + 1

      const mes = p.createdAt.slice(0, 7)
      if (!porMesProp[mes]) porMesProp[mes] = { total: 0, fechado: 0, convertido: 0 }
      porMesProp[mes].total++
      if (p.stage === 'fechado') porMesProp[mes].fechado++
      if (p.stage === 'convertido') porMesProp[mes].convertido++
    }

    const negociados = stageCounts.negociacao + stageCounts.fechado + stageCounts.convertido
    const fechados = stageCounts.fechado + stageCounts.convertido
    const taxaNegociacao = totalProp ? Math.round((negociados / totalProp) * 1000) / 10 : 0
    const taxaFechado = totalProp ? Math.round((fechados / totalProp) * 1000) / 10 : 0
    const taxaConvertido = totalProp ? Math.round((stageCounts.convertido / totalProp) * 1000) / 10 : 0

    // ── Funil + evolução mensal combinada ───────────────────────────────
    const funil = [
      { label: 'Visitas Realizadas', valor: totalVisitas, cor: '#6366f1' },
      { label: 'Propostas Geradas', valor: totalProp, cor: '#3b82f6' },
      { label: 'Em Negociação', valor: negociados, cor: '#f59e0b' },
      { label: 'Fechado', valor: fechados, cor: '#10b981' },
      { label: 'Convertido em Pedido', valor: stageCounts.convertido, cor: '#059669' },
    ]

    const todosMeses = Array.from(new Set([...Object.keys(porMesVis), ...Object.keys(porMesProp)])).sort()
    const mensal = todosMeses.map((mes) => ({
      mes,
      visitas: porMesVis[mes]?.total ?? 0,
      propostasGeradas: porMesVis[mes]?.propostas ?? 0,
      propostasCriadas: porMesProp[mes]?.total ?? 0,
      fechado: porMesProp[mes]?.fechado ?? 0,
      convertido: porMesProp[mes]?.convertido ?? 0,
    }))

    return {
      visitas: {
        total: totalVisitas,
        planejadas,
        campo: totalVisitas - planejadas,
        duracaoMediaMinutos,
        taxaConversaoProposta: visitaParaPropostaTaxa,
        porResultado,
        porVendedor: Object.values(porVendedorVis).sort((a, b) => b.total - a.total),
        porObjetivo: Object.entries(porObjetivo).sort((a, b) => b[1] - a[1]),
        topEmpresas,
      },
      propostas: {
        total: totalProp,
        semPdf: semPdfCount,
        taxaNegociacao,
        taxaFechado,
        taxaConvertido,
        porEtapa: stageCounts,
        porVendedor: Object.values(porVendedorProp).sort((a, b) => b.total - a.total),
        porPagamento: Object.entries(porPagamento).sort((a, b) => b[1] - a[1]).slice(0, 10),
        porRevenda: Object.entries(porRevenda).sort((a, b) => b[1] - a[1]).slice(0, 10),
      },
      funil,
      mensal,
    }
  }),
})
