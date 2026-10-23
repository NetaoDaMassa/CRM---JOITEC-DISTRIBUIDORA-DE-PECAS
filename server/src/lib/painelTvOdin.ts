// Painel de TV da Odin Compressores (telão 75") — uma tela por equipe, cada
// uma com o que aquela equipe acompanha (pedido do João, 2026-10-23):
//   Externos (canalVenda 'visitas'): visitas → propostas → pedidos. SEM meta
//     individual (a empresa não tem meta por vendedor externo).
//   Interno leads ('leads'): leads recebidos/aguardando → contatos →
//     propostas → pedidos, com meta individual (metas_mensais).
//   Interno peças ('pecas'): carteira (cobertura) → contatos/ligações →
//     orçamentos → vendas do Kanban, com meta individual.
//   Geral: % da meta da empresa (meta_faturamento_empresa_<id>, ex.: 3 mi).
//
// Sem R$ na TV (fica visível pra quem passa — regra do João de 2026-09-11,
// ver PainelTV.tsx): só %, quantidades e participação. Por isso a API nem
// devolve valores em reais.
//
// Regras de "venda" iguais ao dashboardOdin.equipes: externos/leads = pedido
// (ordens) não cancelado criado no período; peças = venda registrada no
// Kanban (tabela `vendas`). Colunas em UTC (datetime('now')) → janelas
// deslocadas +3h; visitas.dataVisita já é dia de Brasília.
import { and, eq, gte, inArray, isNull, lt, ne } from 'drizzle-orm'
import { db } from '../db/client.js'
import { funilMensal, leadContactAttempts, leads, ordemDetalhes, ordens, propostas, registroContato, users, vendas, visitas } from '../db/schema.js'
import { coberturaContatosVendedor } from './coberturaContatos.js'
import { getConfigNumero } from './configuracoes.js'
import { diasUteisDecorridos, diasUteisNoMes, hojeBrString, mesReferenciaAtual } from './dataBr.js'
import { metasVigentesPorVendedor } from './metasVigentes.js'

const proximoDia = (dia: string) => new Date(new Date(`${dia}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
const proximoMes = (mes: string) => {
  const d = new Date(`${mes}T12:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
}
const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 1000) / 10 : 0)

export async function montarPainelTvOdin(empresaId: number) {
  const hoje = hojeBrString()
  const mes = mesReferenciaAtual()
  const fimMes = proximoMes(mes)
  const amanha = proximoDia(hoje)
  // Janelas em UTC pras colunas gravadas com datetime('now').
  const mesUtc = { de: `${mes} 03:00:00`, ate: `${fimMes} 03:00:00` }
  const hojeUtc = { de: `${hoje} 03:00:00`, ate: `${amanha} 03:00:00` }
  const ehHoje = (utc: string | null | undefined) => !!utc && utc >= hojeUtc.de && utc < hojeUtc.ate

  const membros = await db.query.users.findMany({
    where: and(eq(users.empresaId, empresaId), eq(users.isActive, true), ne(users.canalVenda, 'nenhum'), eq(users.ocultoPainelTv, false)),
    columns: { id: true, name: true, fotoUrl: true, canalVenda: true },
  })
  const ids = membros.map((m) => m.id)
  const semIds = !ids.length

  const [ordensMes, ordensEmpresaMes, visitasMes, propostasMes, leadsMes, leadsAguardando, tentativasLead, vendasPecas, contatosPecas, orcamentosAbertos, metas, metaEmpresa] =
    await Promise.all([
      semIds
        ? []
        : db
            .select({ vendedorId: ordens.vendedorId, valor: ordemDetalhes.valorPedido, criadoEm: ordens.createdAt })
            .from(ordens)
            .leftJoin(ordemDetalhes, eq(ordemDetalhes.ordemId, ordens.id))
            .where(and(eq(ordens.empresaId, empresaId), inArray(ordens.vendedorId, ids), ne(ordens.status, 'cancelado'), gte(ordens.createdAt, mesUtc.de), lt(ordens.createdAt, mesUtc.ate))),
      // Faturamento da empresa inteira (todas as equipes e quem não tem
      // equipe) — mesma base do Painel Financeiro (pedidos locais).
      db
        .select({ valor: ordemDetalhes.valorPedido, vendedorId: ordens.vendedorId, criadoEm: ordens.createdAt })
        .from(ordens)
        .leftJoin(ordemDetalhes, eq(ordemDetalhes.ordemId, ordens.id))
        .where(and(eq(ordens.empresaId, empresaId), ne(ordens.status, 'cancelado'), gte(ordens.createdAt, mesUtc.de), lt(ordens.createdAt, mesUtc.ate))),
      semIds
        ? []
        : db.query.visitas.findMany({
            where: and(eq(visitas.empresaId, empresaId), inArray(visitas.vendedorId, ids), gte(visitas.dataVisita, mes), lt(visitas.dataVisita, fimMes)),
            columns: { vendedorId: true, dataVisita: true, latCheckin: true },
          }),
      semIds
        ? []
        : db.query.propostas.findMany({
            where: and(eq(propostas.empresaId, empresaId), inArray(propostas.vendedorId, ids), gte(propostas.createdAt, mesUtc.de), lt(propostas.createdAt, mesUtc.ate)),
            columns: { vendedorId: true, createdAt: true, convertidoParaOrdemId: true },
          }),
      db.query.leads.findMany({
        where: and(eq(leads.empresaId, empresaId), gte(leads.createdAt, mesUtc.de), lt(leads.createdAt, mesUtc.ate)),
        columns: { vendorId: true, createdAt: true },
      }),
      // Foto do momento: lead com dono ainda sem nenhum atendimento.
      db.query.leads.findMany({
        where: and(eq(leads.empresaId, empresaId), inArray(leads.status, ['novo', 'novo_consumidor_final'])),
        columns: { vendorId: true },
      }),
      semIds
        ? []
        : db.query.leadContactAttempts.findMany({
            where: and(inArray(leadContactAttempts.userId, ids), gte(leadContactAttempts.createdAt, mesUtc.de), lt(leadContactAttempts.createdAt, mesUtc.ate)),
            columns: { userId: true, channel: true, createdAt: true },
          }),
      semIds
        ? []
        : db.query.vendas.findMany({
            where: and(inArray(vendas.vendedorId, ids), isNull(vendas.deletedAt), gte(vendas.dataFechamento, mesUtc.de), lt(vendas.dataFechamento, mesUtc.ate)),
            columns: { vendedorId: true, valorFechado: true, dataFechamento: true },
          }),
      semIds
        ? []
        : db
            .select({ vendedorId: registroContato.vendedorId, tipo: registroContato.tipo, dataHora: registroContato.dataHora })
            .from(registroContato)
            .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
            .where(and(inArray(registroContato.vendedorId, ids), isNull(registroContato.deletedAt), gte(registroContato.dataHora, mesUtc.de), lt(registroContato.dataHora, mesUtc.ate))),
      semIds
        ? []
        : db.query.funilMensal.findMany({
            where: and(inArray(funilMensal.vendedorId, ids), eq(funilMensal.etapa, 'negociacao'), eq(funilMensal.mesReferencia, mes), isNull(funilMensal.deletedAt)),
            columns: { vendedorId: true },
          }),
      metasVigentesPorVendedor(mes),
      getConfigNumero(`meta_faturamento_empresa_${empresaId}`, 0),
    ])

  const diasUteisMes = diasUteisNoMes(mes)
  const diasUteisAteHoje = Math.min(diasUteisMes, diasUteisDecorridos(mes))
  const percentualIdealHoje = pct(diasUteisAteHoje, diasUteisMes)

  const de = <T, K extends keyof T>(lista: T[], campo: K, id: number) => lista.filter((x) => x[campo] === (id as T[K]))
  const metaDe = (id: number) => metas.get(id)?.metaFaturamento ?? null
  const comMeta = (vendido: number, id: number) => {
    const meta = metaDe(id)
    return meta && meta > 0 ? { temMeta: true, percentualMeta: pct(vendido, meta), bateuMeta: vendido >= meta } : { temMeta: false, percentualMeta: 0, bateuMeta: false }
  }
  const base = (m: (typeof membros)[number]) => ({ id: m.id, nome: m.name, fotoUrl: m.fotoUrl })
  const pedidosDe = (id: number) => de(ordensMes, 'vendedorId', id)
  const valorPedidos = (id: number) => pedidosDe(id).reduce((a, o) => a + (o.valor ?? 0), 0)

  const externos = membros
    .filter((m) => m.canalVenda === 'visitas')
    .map((m) => {
      const vis = de(visitasMes, 'vendedorId', m.id)
      const props = de(propostasMes, 'vendedorId', m.id)
      const peds = pedidosDe(m.id)
      return {
        ...base(m),
        visitasHoje: vis.filter((v) => v.dataVisita.slice(0, 10) === hoje).length,
        visitasMes: vis.length,
        visitasGps: vis.filter((v) => v.latCheckin != null).length,
        propostasHoje: props.filter((p) => ehHoje(p.createdAt)).length,
        propostasMes: props.length,
        pedidosMes: peds.length,
        conversaoVisitaProposta: vis.length ? pct(props.length, vis.length) : null,
      }
    })
    .sort((a, b) => b.pedidosMes - a.pedidosMes || b.propostasMes - a.propostasMes || b.visitasMes - a.visitasMes || a.nome.localeCompare(b.nome))

  const leadsEquipe = membros
    .filter((m) => m.canalVenda === 'leads')
    .map((m) => {
      const recebidos = de(leadsMes, 'vendorId', m.id)
      const tent = de(tentativasLead, 'userId', m.id)
      const props = de(propostasMes, 'vendedorId', m.id)
      return {
        ...base(m),
        leadsHoje: recebidos.filter((l) => ehHoje(l.createdAt)).length,
        leadsMes: recebidos.length,
        aguardando: de(leadsAguardando, 'vendorId', m.id).length,
        contatosHoje: tent.filter((t) => ehHoje(t.createdAt)).length,
        contatosMes: tent.length,
        propostasMes: props.length,
        pedidosMes: pedidosDe(m.id).length,
        ...comMeta(valorPedidos(m.id), m.id),
      }
    })
    .sort((a, b) => b.percentualMeta - a.percentualMeta || b.pedidosMes - a.pedidosMes || a.nome.localeCompare(b.nome))

  const pecasEquipe = await Promise.all(
    membros
      .filter((m) => m.canalVenda === 'pecas')
      .map(async (m) => {
        const cont = de(contatosPecas, 'vendedorId', m.id)
        const vendasDele = de(vendasPecas, 'vendedorId', m.id)
        const cobertura = await coberturaContatosVendedor(empresaId, m.id, mes)
        return {
          ...base(m),
          carteira: cobertura.total,
          coberturaPercentual: cobertura.percentual,
          semContato: cobertura.semContato,
          contatosHoje: cont.filter((c) => ehHoje(c.dataHora)).length,
          contatosMes: cont.length,
          ligacoesHoje: cont.filter((c) => c.tipo === 'ligacao' && ehHoje(c.dataHora)).length,
          ligacoesMes: cont.filter((c) => c.tipo === 'ligacao').length,
          orcamentosAbertos: de(orcamentosAbertos, 'vendedorId', m.id).length,
          vendasHoje: vendasDele.filter((v) => ehHoje(v.dataFechamento)).length,
          vendasMes: vendasDele.length,
          ...comMeta(
            vendasDele.reduce((a, v) => a + v.valorFechado, 0),
            m.id,
          ),
        }
      }),
  )
  pecasEquipe.sort((a, b) => b.percentualMeta - a.percentualMeta || a.nome.localeCompare(b.nome))

  // Geral: % da meta da empresa + de onde veio o faturamento (participação
  // de cada equipe, em %, sem R$).
  const totalEmpresa = ordensEmpresaMes.reduce((a, o) => a + (o.valor ?? 0), 0)
  const equipeDe = new Map(membros.map((m) => [m.id, m.canalVenda]))
  const somaEquipe = (canal: string) => ordensEmpresaMes.filter((o) => o.vendedorId != null && equipeDe.get(o.vendedorId) === canal).reduce((a, o) => a + (o.valor ?? 0), 0)
  const participacao = {
    externos: pct(somaEquipe('visitas'), totalEmpresa),
    leads: pct(somaEquipe('leads'), totalEmpresa),
    pecas: pct(somaEquipe('pecas'), totalEmpresa),
  }

  return {
    mes,
    percentualIdealHoje,
    diasUteisMes,
    diasUteisAteHoje,
    geral: {
      temMeta: metaEmpresa > 0,
      percentualMeta: pct(totalEmpresa, metaEmpresa),
      bateuMeta: metaEmpresa > 0 && totalEmpresa >= metaEmpresa,
      noRitmo: metaEmpresa > 0 && pct(totalEmpresa, metaEmpresa) >= percentualIdealHoje,
      pedidosHoje: ordensEmpresaMes.filter((o) => ehHoje(o.criadoEm)).length,
      pedidosMes: ordensEmpresaMes.length,
      propostasMes: propostasMes.length,
      visitasMes: visitasMes.length,
      leadsMes: leadsMes.length,
      leadsAguardando: leadsAguardando.filter((l) => l.vendorId != null).length,
      participacao,
    },
    externos,
    leads: leadsEquipe,
    pecas: pecasEquipe,
  }
}
