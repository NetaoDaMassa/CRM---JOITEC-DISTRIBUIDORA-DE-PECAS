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
import { eq, and, gte, lte, lt, ne, inArray } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, users, propostas, propostaArquivos, ordens, ordemPosVenda, ordemDetalhes, ordemFaturamento, estoqueMaquinas, visitas } from '../db/schema.js'
import { buscarOrdensFaturadas } from '../lib/faturamentoOdin.js'

const SLUG_RELATORIOS = 'odin-compressores'

async function assertEmpresa(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_RELATORIOS) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
}

const filtroData = z.object({ dataDe: z.string().optional(), dataAte: z.string().optional(), vendedorId: z.number().optional() }).optional()

export const relatoriosOdinRouter = router({
  // Aba "Pedidos em Processo" — portado da aba padrão (primeira) de
  // Relatorios.tsx do odincrm original: KPIs + tabela linha-a-linha dos
  // pedidos que batem com o filtro (não só contagem agregada, como as
  // outras abas — aqui dá pra ver CADA pedido).
  pedidosProcesso: adminProcedure
    .input(z.object({ dataDe: z.string().optional(), dataAte: z.string().optional(), vendedorId: z.number().optional(), status: z.enum(['ativo', 'concluido', 'cancelado']).optional() }).optional())
    .query(async ({ ctx, input }) => {
      await assertEmpresa(ctx.empresaId)
      const condicoes = [eq(ordens.empresaId, ctx.empresaId)]
      if (input?.dataDe) condicoes.push(gte(ordens.createdAt, input.dataDe))
      if (input?.dataAte) condicoes.push(lte(ordens.createdAt, `${input.dataAte} 23:59:59`))
      if (input?.vendedorId) condicoes.push(eq(ordens.vendedorId, input.vendedorId))
      if (input?.status) condicoes.push(eq(ordens.status, input.status))

      const pedidos = await db.query.ordens.findMany({
        where: and(...condicoes),
        with: { cliente: { columns: { id: true, razaoSocial: true } }, vendedor: { columns: { id: true, name: true } } },
        orderBy: (o, { desc }) => [desc(o.createdAt)],
      })

      let active = 0
      let completed = 0
      let cancelled = 0
      const rows = pedidos.map((p) => {
        const estaConcluido = p.stage === 'pos_venda' || p.status === 'concluido'
        if (p.status === 'cancelado') cancelled++
        else if (estaConcluido) completed++
        else active++
        const tempoHoras = estaConcluido ? Math.round(((new Date(p.updatedAt.replace(' ', 'T') + 'Z').getTime() - new Date(p.createdAt.replace(' ', 'T') + 'Z').getTime()) / 3_600_000) * 10) / 10 : null
        return {
          id: p.id,
          clienteNome: p.cliente?.razaoSocial ?? '—',
          vendedorNome: p.vendedor?.name ?? '—',
          stage: p.stage,
          status: p.status,
          createdAt: p.createdAt,
          tempoHoras,
        }
      })

      return { total: rows.length, active, completed, cancelled, rows }
    }),

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

  // Antes filtrava `ordens.createdAt` (data de CRIAÇÃO do pedido) e somava
  // pedido de qualquer etapa, inclusive cancelado — uma conta própria,
  // diferente da regra única fixada em lib/faturamentoOdin.ts (faturado =
  // entrou na etapa Faturamento ou além, data de referência = quando entrou
  // lá, exclui cancelado), que Painel Financeiro e Dashboard Odin já usam.
  // Resultado do bug: esse card mostrava um número que não batia com as
  // outras duas telas pro mesmo período. Corrigido em 2026-09-29 (achado
  // via auditoria) pra usar a mesma fonte — `buscarOrdensFaturadas` já
  // filtra cancelado e resolve a data de entrada em Faturamento sozinha.
  faturamento: adminProcedure.input(filtroData).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)

    const todasFaturadas = await buscarOrdensFaturadas(ctx.empresaId)
    const faturadas = todasFaturadas.filter((o) => {
      if (input?.vendedorId && o.vendedorId !== input.vendedorId) return false
      if (input?.dataDe && o.dataRef.slice(0, 10) < input.dataDe) return false
      if (input?.dataAte && o.dataRef.slice(0, 10) > input.dataAte) return false
      return true
    })

    // buscarOrdensFaturadas não traz cliente/confirmação de pagamento (é
    // reaproveitada pelo Painel Financeiro/Dashboard, que não precisam
    // disso) — busca só pelos ids que sobraram do filtro, igual o Dashboard
    // Odin já faz.
    const ids = faturadas.map((o) => o.id)
    const detalhesPedidos = ids.length
      ? await db.query.ordens.findMany({
          where: inArray(ordens.id, ids),
          columns: { id: true },
          with: {
            cliente: { columns: { razaoSocial: true } },
            faturamento: { columns: { pagamentoConfirmado: true } },
          },
        })
      : []
    const detalhePorId = new Map(detalhesPedidos.map((p) => [p.id, p]))

    let valorTotal = 0
    let valorConfirmado = 0
    let qtdConfirmado = 0
    const lista = faturadas.map((o) => {
      const detalhe = detalhePorId.get(o.id)
      const confirmado = !!detalhe?.faturamento?.pagamentoConfirmado
      valorTotal += o.valor
      if (confirmado) {
        valorConfirmado += o.valor
        qtdConfirmado++
      }
      return { id: o.id, clienteNome: detalhe?.cliente?.razaoSocial ?? '—', valor: o.valor, confirmado }
    })

    return { totalPedidos: faturadas.length, valorTotal, valorConfirmado, qtdConfirmado, pedidos: lista }
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

  // Relatório individual da semana (segunda a domingo) por vendedor — pedido
  // do João 2026-10-19: visitas (com GPS × manual), tempo médio de visita,
  // propostas feitas e fechamentos. Regras:
  //   - Visita "com GPS" = check-in gravou localização (latCheckin); o resto
  //     é "manual" (registrada sem GPS — sinal fraco, ou lançada depois).
  //   - Semana pela `dataVisita` (já é horário de Brasília, ver memória
  //     visitas-campo-odin). Propostas/pedidos têm createdAt em UTC → a
  //     janela é deslocada +3h pra bater com a semana de Brasília.
  //   - Tempo de visita = check-in → check-out. Acima de 12h é check-out
  //     esquecido (fechou no dia seguinte) e fica fora da média.
  //   - Fechamento = pedido (ordens) não cancelado criado na semana — mesma
  //     regra do Dashboard/Painel TV Odin (João 2026-09-04: proposta virou
  //     pedido = venda fechada do vendedor), não a data de faturamento.
  semanalVendedores: adminProcedure.input(z.object({ semana: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)

    // Normaliza pra segunda-feira da semana informada (qualquer dia serve).
    const base = new Date(`${input.semana}T12:00:00Z`)
    const diaSemana = (base.getUTCDay() + 6) % 7 // 0 = segunda
    const segunda = new Date(base.getTime() - diaSemana * 86_400_000)
    const proximaSegunda = new Date(segunda.getTime() + 7 * 86_400_000)
    const ymd = (d: Date) => d.toISOString().slice(0, 10)
    const inicio = ymd(segunda)
    const fimExclusivo = ymd(proximaSegunda)
    const domingo = ymd(new Date(proximaSegunda.getTime() - 86_400_000))
    const inicioUtc = `${inicio} 03:00:00`
    const fimUtc = `${fimExclusivo} 03:00:00`

    const [vendedoresAtivos, visitasSemana, propostasSemana, pedidosSemana] = await Promise.all([
      db.query.users.findMany({
        where: and(eq(users.empresaId, ctx.empresaId), eq(users.role, 'vendor'), eq(users.isActive, true)),
        columns: { id: true, name: true, fotoUrl: true, canalVenda: true },
      }),
      db.query.visitas.findMany({
        where: and(eq(visitas.empresaId, ctx.empresaId), gte(visitas.dataVisita, inicio), lt(visitas.dataVisita, fimExclusivo)),
        columns: { id: true, vendedorId: true, dataVisita: true, checkinEm: true, checkoutEm: true, latCheckin: true, clienteNome: true, nomeEmpresa: true, resultado: true },
        with: { vendedor: { columns: { id: true, name: true, fotoUrl: true, canalVenda: true } } },
      }),
      db.query.propostas.findMany({
        where: and(eq(propostas.empresaId, ctx.empresaId), gte(propostas.createdAt, inicioUtc), lt(propostas.createdAt, fimUtc)),
        columns: { id: true, vendedorId: true, clienteNome: true, stage: true, createdAt: true },
        with: { vendedor: { columns: { id: true, name: true, fotoUrl: true, canalVenda: true } } },
      }),
      db.query.ordens.findMany({
        where: and(eq(ordens.empresaId, ctx.empresaId), ne(ordens.status, 'cancelado'), gte(ordens.createdAt, inicioUtc), lt(ordens.createdAt, fimUtc)),
        columns: { id: true, vendedorId: true, createdAt: true, stage: true, orderType: true },
        with: {
          vendedor: { columns: { id: true, name: true, fotoUrl: true, canalVenda: true } },
          cliente: { columns: { razaoSocial: true } },
          detalhes: { columns: { valorPedido: true } },
        },
      }),
    ])

    type Linha = {
      vendedorId: number
      nome: string
      fotoUrl: string | null
      canalVenda: string
      visitas: { id: number; dataVisita: string; cliente: string; comGps: boolean; semCheckout: boolean; duracaoMin: number | null; resultado: string | null }[]
      propostas: { id: number; cliente: string; stage: string; createdAt: string }[]
      fechamentos: { id: number; cliente: string; valor: number; stage: string; createdAt: string }[]
    }
    const porVendedor = new Map<number, Linha>()
    function linha(v: { id: number; name: string; fotoUrl: string | null; canalVenda: string }): Linha {
      let l = porVendedor.get(v.id)
      if (!l) {
        l = { vendedorId: v.id, nome: v.name, fotoUrl: v.fotoUrl, canalVenda: v.canalVenda, visitas: [], propostas: [], fechamentos: [] }
        porVendedor.set(v.id, l)
      }
      return l
    }
    // Todo vendedor ativo aparece (mesmo zerado — zerado também é informação);
    // inativo/admin só entra se teve movimento na semana.
    for (const v of vendedoresAtivos) linha(v)

    const MAX_MIN_VISITA = 12 * 60
    for (const v of visitasSemana) {
      if (!v.vendedor) continue
      let duracaoMin: number | null = null
      if (v.checkinEm && v.checkoutEm) {
        const min = (new Date(v.checkoutEm.replace(' ', 'T') + 'Z').getTime() - new Date(v.checkinEm.replace(' ', 'T') + 'Z').getTime()) / 60000
        if (min > 0 && min <= MAX_MIN_VISITA) duracaoMin = Math.round(min)
      }
      linha(v.vendedor).visitas.push({
        id: v.id,
        semCheckout: !!v.checkinEm && !v.checkoutEm,
        dataVisita: v.dataVisita,
        cliente: (v.clienteNome || v.nomeEmpresa || '—').trim(),
        comGps: v.latCheckin != null,
        duracaoMin,
        resultado: v.resultado,
      })
    }
    for (const p of propostasSemana) {
      if (!p.vendedor) continue
      linha(p.vendedor).propostas.push({ id: p.id, cliente: p.clienteNome, stage: p.stage, createdAt: p.createdAt })
    }
    for (const o of pedidosSemana) {
      if (!o.vendedor) continue
      linha(o.vendedor).fechamentos.push({
        id: o.id,
        cliente: o.cliente?.razaoSocial ?? '—',
        valor: o.detalhes?.valorPedido ?? 0,
        stage: o.stage,
        createdAt: o.createdAt,
      })
    }

    const vendedores = [...porVendedor.values()]
      .map((l) => {
        const comDuracao = l.visitas.filter((v) => v.duracaoMin != null)
        const visitasGps = l.visitas.filter((v) => v.comGps).length
        return {
          ...l,
          visitasTotal: l.visitas.length,
          visitasGps,
          visitasManual: l.visitas.length - visitasGps,
          tempoMedioMin: comDuracao.length ? Math.round(comDuracao.reduce((a, v) => a + (v.duracaoMin ?? 0), 0) / comDuracao.length) : null,
          visitasComTempo: comDuracao.length,
          visitasSemCheckout: l.visitas.filter((v) => v.semCheckout).length,
          qtdPropostas: l.propostas.length,
          qtdFechamentos: l.fechamentos.length,
          valorFechado: l.fechamentos.reduce((a, f) => a + f.valor, 0),
        }
      })
      .sort((a, b) => b.qtdFechamentos - a.qtdFechamentos || b.valorFechado - a.valorFechado || b.visitasTotal - a.visitasTotal || a.nome.localeCompare(b.nome))

    const todasComTempo = vendedores.flatMap((v) => v.visitas.filter((x) => x.duracaoMin != null))
    return {
      inicio,
      fim: domingo,
      vendedores,
      totais: {
        visitas: vendedores.reduce((a, v) => a + v.visitasTotal, 0),
        visitasGps: vendedores.reduce((a, v) => a + v.visitasGps, 0),
        visitasManual: vendedores.reduce((a, v) => a + v.visitasManual, 0),
        visitasSemCheckout: vendedores.reduce((a, v) => a + v.visitasSemCheckout, 0),
        tempoMedioMin: todasComTempo.length ? Math.round(todasComTempo.reduce((a, v) => a + (v.duracaoMin ?? 0), 0) / todasComTempo.length) : null,
        propostas: vendedores.reduce((a, v) => a + v.qtdPropostas, 0),
        fechamentos: vendedores.reduce((a, v) => a + v.qtdFechamentos, 0),
        valorFechado: vendedores.reduce((a, v) => a + v.valorFechado, 0),
      },
    }
  }),
})
