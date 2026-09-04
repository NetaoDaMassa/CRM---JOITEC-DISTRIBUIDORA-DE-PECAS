// Dashboard consolidado (Odin Compressores) — portado de
// app/services/dashboard_service.py + app/services/alert_service.py do
// odincrm.duckdns.org. Junta num só resumo o que hoje vive espalhado em
// telas separadas (Pedidos, Propostas, Visitas, Almoxarifado): visão geral
// de pedidos por etapa/status, propostas, visitas, alertas de pedido parado,
// últimos pedidos e performance por vendedor. Só agregação — não introduz
// tabela nova. Igual aos módulos irmãos (pedidos_odin etc.), gestor e
// vendedor (vendedor só vê os próprios números, sem a tabela por vendedor).
import { z } from 'zod'
import { eq, and, gte, lte, inArray } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, ordens, ordemDetalhes, propostas, visitas, estoqueMaquinas, users, leads } from '../db/schema.js'
import { buscarOrdensFaturadas } from '../lib/faturamentoOdin.js'

const SLUG_DASHBOARD = 'odin-compressores'

async function assertEmpresa(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_DASHBOARD) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
}

const filtroInput = z.object({ dataDe: z.string().optional(), dataAte: z.string().optional(), vendedorId: z.number().optional() }).optional()

// Mesmos limites do nivelAlerta em client/src/components/OrdensBoard.tsx —
// mantém alerta de vitrine (Kanban) e alerta de dashboard consistentes.
function nivelAlerta(stage: string, updatedAt: string): 'vermelho' | 'laranja' | null {
  const horas = (Date.now() - new Date(updatedAt.replace(' ', 'T') + 'Z').getTime()) / 3_600_000
  if (stage === 'coleta' && horas > 24) return 'vermelho'
  if (stage === 'preparacao' && horas > 72) return 'vermelho'
  if (horas > 48) return 'laranja'
  return null
}

export const dashboardOdinRouter = router({
  resumo: adminOrFeatureProcedure('dashboard_odin').input(filtroInput).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const isAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
    const vendedorId = isAdmin ? input?.vendedorId : ctx.user.id

    const condOrdens = [eq(ordens.empresaId, ctx.empresaId)]
    if (vendedorId) condOrdens.push(eq(ordens.vendedorId, vendedorId))
    if (input?.dataDe) condOrdens.push(gte(ordens.createdAt, input.dataDe))
    if (input?.dataAte) condOrdens.push(lte(ordens.createdAt, `${input.dataAte} 23:59:59`))

    const todasOrdens = await db.query.ordens.findMany({
      where: and(...condOrdens),
      with: { cliente: { columns: { id: true, razaoSocial: true } }, vendedor: { columns: { id: true, name: true } } },
      orderBy: (o, { desc }) => [desc(o.createdAt)],
    })

    let active = 0
    let completed = 0
    let cancelled = 0
    const byStage: Record<string, number> = {}
    for (const o of todasOrdens) {
      byStage[o.stage] = (byStage[o.stage] ?? 0) + 1
      if (o.status === 'cancelado') cancelled++
      else if (o.stage === 'pos_venda') completed++
      else active++
    }

    const ids = todasOrdens.map((o) => o.id)
    const detalhes = ids.length ? await db.query.ordemDetalhes.findMany({ where: inArray(ordemDetalhes.ordemId, ids) }) : []
    const valores = detalhes.map((d) => d.valorPedido).filter((v): v is number => v != null)
    const ticketMedio = valores.length ? Math.round(valores.reduce((a, b) => a + b, 0) / valores.length) : null

    const ciclos = todasOrdens
      .filter((o) => o.stage === 'pos_venda')
      .map((o) => (new Date(o.updatedAt.replace(' ', 'T') + 'Z').getTime() - new Date(o.createdAt.replace(' ', 'T') + 'Z').getTime()) / 3_600_000)
    const cicloMedioHoras = ciclos.length ? Math.round((ciclos.reduce((a, b) => a + b, 0) / ciclos.length) * 10) / 10 : null

    // Pedidos criados nos últimos 30 dias — janela rolante, independente do filtro de data acima.
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
    const condRecentes = [eq(ordens.empresaId, ctx.empresaId), gte(ordens.createdAt, since30)]
    if (vendedorId) condRecentes.push(eq(ordens.vendedorId, vendedorId))
    const recentes30d = (await db.query.ordens.findMany({ where: and(...condRecentes), columns: { id: true } })).length

    // Máquinas vendidas — vinculada a pedido não cancelado (mesmo sinal do
    // machine_reports.py original: o status manual "vendida" quase nunca é preenchido).
    const maquinasTodas = await db.query.estoqueMaquinas.findMany({
      where: eq(estoqueMaquinas.empresaId, ctx.empresaId),
      with: { ordem: { columns: { id: true, status: true, vendedorId: true } } },
    })
    const maquinasVendidas = maquinasTodas.filter((m) => {
      if (!m.ordem || m.ordem.status === 'cancelado') return false
      if (vendedorId && m.ordem.vendedorId !== vendedorId) return false
      if (input?.dataDe && m.updatedAt < input.dataDe) return false
      if (input?.dataAte && m.updatedAt > `${input.dataAte} 23:59:59`) return false
      return true
    }).length

    // Faturamento — pedidos que já entraram na etapa Faturamento ou além,
    // dentro do período filtrado (mesma regra do Painel Financeiro, ver
    // lib/faturamentoOdin.ts). Fica separado de "Concluídos" acima (que só
    // conta pos_venda, o fim de todo o funil): entrar em Faturamento já
    // significa que a venda foi faturada, mesmo com entrega/pós-venda ainda
    // em aberto.
    const todasFaturadas = await buscarOrdensFaturadas(ctx.empresaId)
    const faturadasFiltradas = todasFaturadas.filter((o) => {
      if (vendedorId && o.vendedorId !== vendedorId) return false
      if (input?.dataDe && o.dataRef.slice(0, 10) < input.dataDe) return false
      if (input?.dataAte && o.dataRef.slice(0, 10) > input.dataAte) return false
      return true
    })
    const faturamento = { qtd: faturadasFiltradas.length, valor: faturadasFiltradas.reduce((s, o) => s + o.valor, 0) }

    // Propostas
    const condProp = [eq(propostas.empresaId, ctx.empresaId)]
    if (vendedorId) condProp.push(eq(propostas.vendedorId, vendedorId))
    if (input?.dataDe) condProp.push(gte(propostas.createdAt, input.dataDe))
    if (input?.dataAte) condProp.push(lte(propostas.createdAt, `${input.dataAte} 23:59:59`))
    const todasProp = await db.query.propostas.findMany({ where: and(...condProp), columns: { id: true, convertidoParaOrdemId: true } })
    const totalPropostas = todasProp.length
    const propostasConvertidas = todasProp.filter((p) => p.convertidoParaOrdemId != null).length

    // Visitas
    const condVis = [eq(visitas.empresaId, ctx.empresaId)]
    if (vendedorId) condVis.push(eq(visitas.vendedorId, vendedorId))
    if (input?.dataDe) condVis.push(gte(visitas.dataVisita, input.dataDe))
    if (input?.dataAte) condVis.push(lte(visitas.dataVisita, input.dataAte))
    const totalVisitas = (await db.query.visitas.findMany({ where: and(...condVis), columns: { id: true } })).length

    const inicioMes = new Date().toISOString().slice(0, 8) + '01'
    const condVisMes = [eq(visitas.empresaId, ctx.empresaId), gte(visitas.dataVisita, inicioMes)]
    if (vendedorId) condVisMes.push(eq(visitas.vendedorId, vendedorId))
    const visitasMes = (await db.query.visitas.findMany({ where: and(...condVisMes), columns: { id: true } })).length

    // Alertas — pedidos ativos parados demais na etapa atual.
    const alertas = todasOrdens
      .filter((o) => o.status === 'ativo' && o.stage !== 'pos_venda')
      .map((o) => ({ ordemId: o.id, stage: o.stage, clienteNome: o.cliente?.razaoSocial ?? '—', nivel: nivelAlerta(o.stage, o.updatedAt) }))
      .filter((a): a is typeof a & { nivel: 'vermelho' | 'laranja' } => a.nivel !== null)
      .sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'vermelho' ? -1 : 1))

    const recentes = todasOrdens.slice(0, 8).map((o) => ({
      id: o.id,
      clienteNome: o.cliente?.razaoSocial ?? '—',
      vendedorNome: o.vendedor?.name ?? '—',
      stage: o.stage,
      status: o.status,
      createdAt: o.createdAt,
    }))

    // Performance por vendedor — sempre TODOS os vendedores da empresa,
    // sem aplicar o filtro de data/vendedor acima (mesmo comportamento do
    // get_seller_stats original: número "de sempre", não do período filtrado).
    let porVendedor: { vendedorId: number; nome: string; total: number; active: number; completed: number; cancelled: number }[] = []
    if (isAdmin) {
      const todasSemFiltro = await db.query.ordens.findMany({
        where: eq(ordens.empresaId, ctx.empresaId),
        with: { vendedor: { columns: { id: true, name: true } } },
      })
      const mapa = new Map<number, { vendedorId: number; nome: string; total: number; active: number; completed: number; cancelled: number }>()
      for (const o of todasSemFiltro) {
        if (!o.vendedorId) continue
        if (!mapa.has(o.vendedorId)) mapa.set(o.vendedorId, { vendedorId: o.vendedorId, nome: o.vendedor?.name ?? '—', total: 0, active: 0, completed: 0, cancelled: 0 })
        const linha = mapa.get(o.vendedorId)!
        linha.total++
        if (o.status === 'cancelado') linha.cancelled++
        else if (o.stage === 'pos_venda') linha.completed++
        else linha.active++
      }
      porVendedor = Array.from(mapa.values()).sort((a, b) => b.total - a.total)
    }

    return {
      pedidos: { total: todasOrdens.length, active, completed, cancelled, byStage, recentes30d, ticketMedio, cicloMedioHoras, maquinasVendidas },
      faturamento,
      propostas: { total: totalPropostas, convertidas: propostasConvertidas, taxaConversao: totalPropostas ? Math.round((propostasConvertidas / totalPropostas) * 1000) / 10 : 0 },
      visitas: { total: totalVisitas, mesAtual: visitasMes },
      alertas,
      recentes,
      porVendedor,
    }
  }),

  // Painel de TV específico da Odin Compressores (pedido do João: repensar
  // o painel como um comercial estratégico) — dois funis de 4 etapas, mês
  // corrente:
  //   Equipe de campo: visita → proposta → pedido → faturado (visita não é
  //   obrigatória pra fechar negócio — nem toda proposta desse time nasce
  //   de uma visita registrada, então a conversão visita→proposta é só um
  //   indicador, não uma regra fechada).
  //   Equipe de leads (Emily/Rodrigo/Matheus e quem mais tiver `canalVenda:
  //   'leads'` em Usuários): lead do site → proposta → pedido → faturado.
  // "Pedido" = qualquer `ordens` não cancelada criada no mês — pedido do
  // João 2026-09-04: proposta convertida em pedido JÁ é venda fechada do
  // vendedor (o trabalho comercial dele terminou ali), então "Pedido" aqui
  // TAMBÉM é a venda — não existe mais uma 4ª etapa "Venda" separada
  // esperando o fim do processo. "Faturado" é a 4ª etapa de verdade: o
  // subconjunto de pedidos que já entrou na etapa Faturamento (ou além) —
  // mesma regra do Painel Financeiro, ver lib/faturamentoOdin.ts — e mede o
  // operacional (financeiro/logística), não a performance do vendedor.
  painelTv: adminOrFeatureProcedure('painel_tv_odin').query(async ({ ctx }) => {
    await assertEmpresa(ctx.empresaId)

    const inicioMes = new Date().toISOString().slice(0, 8) + '01'

    const vendedores = await db.query.users.findMany({
      where: and(eq(users.empresaId, ctx.empresaId), eq(users.role, 'vendor'), eq(users.isActive, true), eq(users.ocultoPainelTv, false)),
      columns: { id: true, name: true, fotoUrl: true, canalVenda: true },
    })

    const [todasVisitas, todasPropostas, todasOrdens, todosLeads, todasFaturadas] = await Promise.all([
      db.query.visitas.findMany({
        where: and(eq(visitas.empresaId, ctx.empresaId), gte(visitas.dataVisita, inicioMes)),
        columns: { id: true, vendedorId: true, convertidoParaPropostaId: true },
      }),
      db.query.propostas.findMany({
        where: and(eq(propostas.empresaId, ctx.empresaId), gte(propostas.createdAt, inicioMes)),
        columns: { id: true, vendedorId: true, convertidoParaOrdemId: true },
      }),
      db.query.ordens.findMany({
        where: and(eq(ordens.empresaId, ctx.empresaId), gte(ordens.createdAt, inicioMes)),
        columns: { id: true, vendedorId: true, status: true, stage: true },
      }),
      db.query.leads.findMany({
        where: and(eq(leads.empresaId, ctx.empresaId), gte(leads.createdAt, inicioMes)),
        columns: { id: true, vendorId: true },
      }),
      buscarOrdensFaturadas(ctx.empresaId),
    ])

    const pedidosValidos = todasOrdens.filter((o) => o.status !== 'cancelado')
    // "Faturado" usa a própria data em que entrou em Faturamento como
    // referência de mês (não a data do pedido) — por isso filtra
    // separadamente de `todasOrdens`, que já veio filtrada por createdAt.
    const faturadasMes = todasFaturadas.filter((o) => o.dataRef >= inicioMes)

    function calcularEquipe(vendedoresDoTime: typeof vendedores) {
      const ids = new Set(vendedoresDoTime.map((v) => v.id))
      const visitasTime = todasVisitas.filter((v) => ids.has(v.vendedorId))
      const propostasTime = todasPropostas.filter((p) => ids.has(p.vendedorId))
      const pedidosTime = pedidosValidos.filter((o) => o.vendedorId != null && ids.has(o.vendedorId))
      const leadsTime = todosLeads.filter((l) => l.vendorId != null && ids.has(l.vendorId))
      const faturadasTime = faturadasMes.filter((o) => o.vendedorId != null && ids.has(o.vendedorId))

      const visitasConvertidas = visitasTime.filter((v) => v.convertidoParaPropostaId != null).length
      const propostasConvertidas = propostasTime.filter((p) => p.convertidoParaOrdemId != null).length

      const porVendedor = vendedoresDoTime
        .map((v) => {
          const visitasDele = visitasTime.filter((x) => x.vendedorId === v.id)
          const propostasDele = propostasTime.filter((x) => x.vendedorId === v.id)
          const pedidosDele = pedidosTime.filter((x) => x.vendedorId === v.id)
          const faturadosDele = faturadasTime.filter((x) => x.vendedorId === v.id)
          const leadsDele = leadsTime.filter((x) => x.vendorId === v.id)
          const visitasConvDele = visitasDele.filter((x) => x.convertidoParaPropostaId != null).length
          const propostasConvDele = propostasDele.filter((x) => x.convertidoParaOrdemId != null).length
          return {
            id: v.id,
            nome: v.name,
            fotoUrl: v.fotoUrl,
            visitas: visitasDele.length,
            leads: leadsDele.length,
            propostas: propostasDele.length,
            pedidos: pedidosDele.length,
            faturados: faturadosDele.length,
            conversaoVisitaProposta: visitasDele.length ? Math.round((visitasConvDele / visitasDele.length) * 1000) / 10 : null,
            conversaoPropostaPedido: propostasDele.length ? Math.round((propostasConvDele / propostasDele.length) * 1000) / 10 : null,
            conversaoPedidoFaturado: pedidosDele.length ? Math.round((faturadosDele.length / pedidosDele.length) * 1000) / 10 : null,
          }
        })
        .sort((a, b) => b.pedidos - a.pedidos)

      return {
        porVendedor,
        totais: {
          visitas: visitasTime.length,
          leads: leadsTime.length,
          propostas: propostasTime.length,
          pedidos: pedidosTime.length,
          faturados: faturadasTime.length,
          conversaoVisitaProposta: visitasTime.length ? Math.round((visitasConvertidas / visitasTime.length) * 1000) / 10 : null,
          conversaoPropostaPedido: propostasTime.length ? Math.round((propostasConvertidas / propostasTime.length) * 1000) / 10 : null,
          conversaoPedidoFaturado: pedidosTime.length ? Math.round((faturadasTime.length / pedidosTime.length) * 1000) / 10 : null,
        },
      }
    }

    const equipeCampo = calcularEquipe(vendedores.filter((v) => v.canalVenda === 'visitas'))
    const equipeLeads = calcularEquipe(vendedores.filter((v) => v.canalVenda === 'leads'))

    return {
      mesReferencia: inicioMes.slice(0, 7),
      equipeCampo,
      equipeLeads,
      geral: {
        leads: todosLeads.length,
        propostas: todasPropostas.length,
        pedidos: pedidosValidos.length,
        faturados: faturadasMes.length,
      },
    }
  }),
})
