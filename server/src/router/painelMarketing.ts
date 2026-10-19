import { and, eq, inArray, isNull } from 'drizzle-orm'
import { router, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { leads, leadContactAttempts, leadCampaigns, users, empresas, metasMarketing } from '../db/schema.js'
import { businessHoursElapsedMs, toLocalDateKey, toUtcISO } from '../lib/businessHours.js'
import { isTerminalStatus } from '../lib/leadsStatus.js'
import { calcularReportGeral } from './leadsRelatorios.js'
import { diasUteisDecorridos, diasUteisNoMes } from '../lib/dataBr.js'

// Painel de TV só de Marketing/Leads (pedido do João, 2026-10-19) — tela
// única pro telão de 75", tudo da empresa ativa. Os números de "mês" e as
// metas vêm de `calcularReportGeral` (mesma conta de Relatórios de Leads >
// Geral, pra nunca divergir do relatório); o resto ("hoje", ranking, origem,
// últimos leads) é calculado aqui.

// `source` é texto livre digitado de jeitos diferentes ("INSTA", "insta",
// "Instagram ", "FACE"...) — agrupa por canal pra o gráfico de origem não
// virar 20 fatias. Campanha (Meta Ads) tem prioridade quando existe.
function canalDoLead(source: string | null, campanhaCanal: string | null): string {
  if (campanhaCanal === 'facebook' || campanhaCanal === 'instagram') return 'Meta Ads'
  const s = (source ?? '').toLowerCase().trim()
  if (!s && !campanhaCanal) return 'Não informado'
  if (campanhaCanal === 'google' || s.includes('google')) return 'Google'
  if (s.startsWith('insta') || s.startsWith('instagram')) return 'Instagram'
  if (s.startsWith('face') || s.includes('meta')) return 'Meta Ads'
  if (s.includes('whats') || campanhaCanal === 'whatsapp') return 'WhatsApp'
  if (s.startsWith('brevo') || s.includes('email') || s.includes('e-mail')) return 'E-mail'
  if (s === 'form_submit' || s === 'site' || s.includes('ebook') || campanhaCanal === 'site') return 'Site'
  if (s.includes('indica') || campanhaCanal === 'indicacao') return 'Indicação'
  return 'Outros'
}

// Data de hoje em Brasília (YYYY-MM-DD) — mesmo fuso de toLocalDateKey.
function hojeLocal(): string {
  return toLocalDateKey(new Date().toISOString())
}

export const painelMarketingRouter = router({
  resumo: adminOrFeatureProcedure('painel_tv_marketing').query(async ({ ctx }) => {
    const hoje = hojeLocal()
    const mesReferencia = `${hoje.slice(0, 7)}-01`
    const [ano, mes] = hoje.split('-').map(Number)
    const fimMes = `${hoje.slice(0, 7)}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`

    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { nome: true } })
    const [geral, meta] = await Promise.all([
      calcularReportGeral(ctx.empresaId, mesReferencia, fimMes),
      db.query.metasMarketing.findFirst({
        where: and(eq(metasMarketing.empresaId, ctx.empresaId), eq(metasMarketing.mesReferencia, mesReferencia)),
      }),
    ])

    const todos = await db.query.leads.findMany({
      where: and(eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt)),
      columns: {
        id: true,
        name: true,
        city: true,
        status: true,
        vendorId: true,
        source: true,
        campaignId: true,
        nextContactAt: true,
        orderValue: true,
        statusChangedAt: true,
        updatedAt: true,
        createdAt: true,
      },
    })
    const ids = todos.map((l) => l.id)

    const campanhas = await db.query.leadCampaigns.findMany({
      where: eq(leadCampaigns.empresaId, ctx.empresaId),
      columns: { id: true, channel: true },
    })
    const canalCampanha = new Map(campanhas.map((c) => [c.id, c.channel]))

    const vendedores = await db.query.users.findMany({
      where: eq(users.empresaId, ctx.empresaId),
      columns: { id: true, name: true, fotoUrl: true },
    })
    const vendedorPorId = new Map(vendedores.map((v) => [v.id, v]))

    const criadoLocal = (l: { createdAt: string }) => toLocalDateKey(toUtcISO(l.createdAt))
    const ativos = todos.filter((l) => !isTerminalStatus(l.status))

    // Mesmo critério da etiqueta ATRASADO/HOJE do Kanban de Leads
    // (getLeadContactUrgency) — compara só a data do próximo contato, que
    // é gravado em horário de Brasília.
    const emAtraso = ativos.filter((l) => l.nextContactAt && l.nextContactAt.slice(0, 10) < hoje).length
    const praChamarHoje = ativos.filter((l) => l.nextContactAt && l.nextContactAt.slice(0, 10) === hoje).length
    const aguardandoPrimeiroContato = todos.filter((l) => l.status === 'novo').length

    const tentativas = ids.length
      ? await db.query.leadContactAttempts.findMany({
          where: inArray(leadContactAttempts.leadId, ids),
          columns: { leadId: true, result: true, createdAt: true },
          orderBy: (c, { asc }) => [asc(c.createdAt)],
        })
      : []
    const contatadosHoje = new Set(tentativas.filter((t) => toLocalDateKey(toUtcISO(t.createdAt)) === hoje).map((t) => t.leadId)).size

    // 1ª resposta = 1ª tentativa CONFIRMADA (result preenchido), em horas
    // úteis — mesmo critério do "Tempo médio até 1º contato" do relatório.
    const primeiraPorLead = new Map<number, string>()
    for (const t of tentativas) {
      if (t.result && !primeiraPorLead.has(t.leadId)) primeiraPorLead.set(t.leadId, t.createdAt)
    }

    const leadsDoMes = todos.filter((l) => criadoLocal(l) >= mesReferencia && criadoLocal(l) <= fimMes)
    const leadsHoje = todos.filter((l) => criadoLocal(l) === hoje).length

    const temposPorVendedor = new Map<number, number[]>()
    for (const l of leadsDoMes) {
      const primeira = primeiraPorLead.get(l.id)
      if (!primeira || l.vendorId == null) continue
      const minutos = businessHoursElapsedMs(l.createdAt, primeira) / 60000
      if (!temposPorVendedor.has(l.vendorId)) temposPorVendedor.set(l.vendorId, [])
      temposPorVendedor.get(l.vendorId)!.push(minutos)
    }
    const media = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
    const rankingResposta = [...temposPorVendedor.entries()]
      .map(([id, tempos]) => ({
        id,
        nome: vendedorPorId.get(id)?.name ?? `Vendedor #${id}`,
        fotoUrl: vendedorPorId.get(id)?.fotoUrl ?? null,
        mediaMinutos: media(tempos),
        leadsAtendidos: tempos.length,
      }))
      .sort((a, b) => a.mediaMinutos - b.mediaMinutos)

    // Leads em negociação AGORA (fotografia do momento, qualquer mês de
    // entrada) — trocou o gráfico de "Leads por dia" a pedido do João,
    // 2026-10-19. Valor = orçamento do lead (orderValue).
    const negociando = todos
      .filter((l) => l.status === 'em_negociacao')
      .map((l) => ({
        id: l.id,
        nome: l.name.trim().split(/\s+/)[0],
        cidade: l.city,
        vendedor: l.vendorId ? vendedorPorId.get(l.vendorId)?.name.split(' ')[0] ?? null : null,
        valor: l.orderValue ?? 0,
        desde: toUtcISO(l.statusChangedAt ?? l.updatedAt),
      }))
      .sort((a, b) => b.valor - a.valor)
    const emNegociacao = {
      quantidade: negociando.length,
      valor: negociando.reduce((s, l) => s + l.valor, 0),
      semValor: negociando.filter((l) => !l.valor).length,
      maiores: negociando.slice(0, 5),
    }

    const origemMap = new Map<string, number>()
    for (const l of leadsDoMes) {
      const canal = canalDoLead(l.source, l.campaignId ? canalCampanha.get(l.campaignId) ?? null : null)
      origemMap.set(canal, (origemMap.get(canal) ?? 0) + 1)
    }
    const porOrigem = [...origemMap.entries()].map(([canal, qtd]) => ({ canal, qtd })).sort((a, b) => b.qtd - a.qtd)

    const ultimosLeads = todos
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6)
      .map((l) => ({
        id: l.id,
        // Só o primeiro nome — o telão fica visível pra qualquer um que passar.
        nome: l.name.trim().split(/\s+/)[0],
        cidade: l.city,
        canal: canalDoLead(l.source, l.campaignId ? canalCampanha.get(l.campaignId) ?? null : null),
        vendedor: l.vendorId ? vendedorPorId.get(l.vendorId)?.name.split(' ')[0] ?? null : null,
        criadoEm: toUtcISO(l.createdAt),
      }))

    const contar = (...status: string[]) => geral.funnel.filter((f) => status.includes(f.status)).reduce((s, f) => s + f.count, 0)
    const funil = [
      { etapa: 'Novo', qtd: contar('novo', 'novo_consumidor_final') },
      { etapa: 'Abordagem', qtd: contar('abordagem') },
      { etapa: 'Qualificado', qtd: contar('qualificado') },
      { etapa: 'Negociação', qtd: contar('em_negociacao') },
      { etapa: 'Ganho', qtd: contar('ganho') },
    ]

    return {
      empresaNome: empresa?.nome ?? '',
      hoje: {
        leadsNovos: leadsHoje,
        emAtraso,
        praChamarHoje,
        contatados: contatadosHoje,
        aguardandoPrimeiroContato,
      },
      mes: {
        totalLeads: geral.totalLeads,
        totalGanhos: geral.totalGanhos,
        taxaConversaoPct: geral.taxaConversaoPct,
        primeiraRespostaHoras: geral.tempoMedioPrimeiroContatoHoras,
        amostraPrimeiraResposta: geral.amostraPrimeiroContato,
      },
      // A meta "clientes" (coluna metaClientesAbertos, nome antigo) é de
      // leads GANHOS no mês, não de leads recebidos — corrigido a pedido do
      // João, 2026-10-19. Ritmo esperado proporcional aos dias úteis.
      metas: {
        clientesGanhos: meta?.metaClientesAbertos ?? null,
        ritmoClientesGanhos:
          meta?.metaClientesAbertos != null
            ? (meta.metaClientesAbertos * diasUteisDecorridos(mesReferencia)) / Math.max(1, diasUteisNoMes(mesReferencia))
            : null,
        taxaConversaoPct: meta?.metaTaxaConversaoPct ?? null,
        atendimentoRapidoHoras: meta?.metaAtendimentoRapidoHoras ?? null,
      },
      funil,
      rankingResposta,
      emNegociacao,
      porOrigem,
      ultimosLeads,
    }
  }),
})
