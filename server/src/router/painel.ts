import { and, between, count, desc, eq, inArray, isNull, sql, sum } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { users, funilMensal, registroContato, metasMensais, clientes, vendas } from '../db/schema.js'
import { getConfigNumero } from '../lib/configuracoes.js'
import {
  diasDesde,
  diasUteisDecorridos,
  diasUteisNoMes,
  hojeBr,
  hojeBrString,
  inicioSemanaBrString,
  inicioSemanaPassadaBrString,
  mesReferenciaAtual,
} from '../lib/dataBr.js'

const DIAS_HISTORICO = 14

// Sequência atual de dias seguidos vendendo pelo menos 1 negócio — conta pra
// trás a partir de hoje. Se hoje ainda não vendeu, não quebra a sequência
// (o dia não acabou), só não soma o dia de hoje ainda.
function calcularSequenciaDias(diasComVenda: Set<string>, hoje: Date): number {
  const chaveHoje = hoje.toISOString().slice(0, 10)
  let sequencia = diasComVenda.has(chaveHoje) ? 1 : 0
  const cursor = new Date(hoje)
  cursor.setUTCDate(cursor.getUTCDate() - 1)
  while (diasComVenda.has(cursor.toISOString().slice(0, 10))) {
    sequencia++
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return sequencia
}

// Monta os últimos N dias (rótulo dd/mm) já preenchidos com zero, pra série
// do gráfico de linha nunca ter buracos nos dias sem venda/contato.
function ultimosDias(n: number): { chave: string; rotulo: string }[] {
  const dias: { chave: string; rotulo: string }[] = []
  const hoje = hojeBr()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoje)
    d.setUTCDate(d.getUTCDate() - i)
    const chave = d.toISOString().slice(0, 10)
    const [, mes, dia] = chave.split('-')
    dias.push({ chave, rotulo: `${dia}/${mes}` })
  }
  return dias
}

export const painelRouter = router({
  resumo: protectedProcedure.query(async ({ ctx }) => {
    const hoje = hojeBrString()
    const inicioHoje = `${hoje} 00:00:00`
    const fimHoje = `${hoje} 23:59:59`
    const mesAtual = mesReferenciaAtual()

    const vendedores = await db.query.users.findMany({
      where: and(
        eq(users.isActive, true),
        eq(users.superAdmin, false),
        eq(users.ocultoPainelTv, false),
        eq(users.empresaId, ctx.empresaId)
      ),
      columns: { id: true, name: true, fotoUrl: true },
    })
    const vendedorIds = vendedores.map((v) => v.id)
    // Nenhum vendedor nesta empresa ainda — evita `IN ()` (SQL inválido) nas
    // consultas agregadas abaixo.
    // Filtra por funilMensal.vendedorId (sempre em dia, mesmo campo que o
    // Kanban usa), não vendas.vendedorId — esse último é gravado uma vez no
    // fechamento e fica desatualizado se o cliente for transferido de
    // carteira depois (transferirCliente atualiza o funil_mensal do mês, mas
    // não a venda já criada).
    const filtroVendedorEmpresa = vendedorIds.length ? inArray(funilMensal.vendedorId, vendedorIds) : sql`0`
    const filtroFunilEmpresa = vendedorIds.length ? inArray(funilMensal.vendedorId, vendedorIds) : sql`0`
    const filtroContatoEmpresa = vendedorIds.length ? inArray(registroContato.vendedorId, vendedorIds) : sql`0`

    const metas = await db.query.metasMensais.findMany({ where: eq(metasMensais.mesReferencia, mesAtual) })
    const metaPorVendedor = new Map(metas.map((m) => [m.vendedorId, m]))

    const diasUteisMes = diasUteisNoMes(mesAtual)
    const diasUteisAteHoje = diasUteisDecorridos(mesAtual)

    const inicioSemana = `${inicioSemanaBrString()} 00:00:00`
    const inicioSemanaPassada = `${inicioSemanaPassadaBrString()} 00:00:00`
    const inicioJanelaStreak = new Date(hojeBr())
    inicioJanelaStreak.setUTCDate(inicioJanelaStreak.getUTCDate() - (DIAS_HISTORICO - 1))
    const inicioStreakString = `${inicioJanelaStreak.toISOString().slice(0, 10)} 00:00:00`

    const vendedoresComDados = await Promise.all(
      vendedores.map(async (v) => {
        const [{ valorSemana }] = await db
          .select({ valorSemana: sum(vendas.valorFechado).mapWith(Number) })
          .from(vendas)
          .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
          .where(
            and(eq(funilMensal.vendedorId, v.id), sql`${vendas.dataFechamento} >= ${inicioSemana}`, isNull(vendas.deletedAt))
          )

        const [{ valorSemanaPassada }] = await db
          .select({ valorSemanaPassada: sum(vendas.valorFechado).mapWith(Number) })
          .from(vendas)
          .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
          .where(
            and(
              eq(funilMensal.vendedorId, v.id),
              sql`${vendas.dataFechamento} >= ${inicioSemanaPassada} AND ${vendas.dataFechamento} < ${inicioSemana}`,
              isNull(vendas.deletedAt)
            )
          )

        const [{ qtdPerdidosMes }] = await db
          .select({ qtdPerdidosMes: count() })
          .from(funilMensal)
          .where(
            and(
              eq(funilMensal.vendedorId, v.id),
              eq(funilMensal.etapa, 'perdido'),
              eq(funilMensal.mesReferencia, mesAtual),
              isNull(funilMensal.deletedAt)
            )
          )

        const [{ ligacoesMes }] = await db
          .select({ ligacoesMes: count() })
          .from(registroContato)
          .where(
            and(
              eq(registroContato.vendedorId, v.id),
              eq(registroContato.tipo, 'ligacao'),
              sql`${registroContato.dataHora} >= ${mesAtual + ' 00:00:00'}`,
              isNull(registroContato.deletedAt)
            )
          )

        const diasComVendaVendedor = await db
          .select({ dia: sql<string>`substr(${vendas.dataFechamento}, 1, 10)` })
          .from(vendas)
          .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
          .where(
            and(eq(funilMensal.vendedorId, v.id), sql`${vendas.dataFechamento} >= ${inicioStreakString}`, isNull(vendas.deletedAt))
          )
          .groupBy(sql`substr(${vendas.dataFechamento}, 1, 10)`)
        const sequenciaDiasVendendo = calcularSequenciaDias(new Set(diasComVendaVendedor.map((d) => d.dia)), hojeBr())

        const [{ ligacoesHoje }] = await db
          .select({ ligacoesHoje: count() })
          .from(registroContato)
          .where(
            and(
              eq(registroContato.vendedorId, v.id),
              eq(registroContato.tipo, 'ligacao'),
              between(registroContato.dataHora, inicioHoje, fimHoje),
              isNull(registroContato.deletedAt)
            )
          )

        // "Tentativa" = toda ligação registrada (ligacoesHoje acima).
        // "Efetiva" = durou pelo menos o mínimo configurado (GoTo) ou foi
        // marcada como respondida manualmente — subconjunto de tentativas.
        const [{ ligacoesEfetivasHoje }] = await db
          .select({ ligacoesEfetivasHoje: count() })
          .from(registroContato)
          .where(
            and(
              eq(registroContato.vendedorId, v.id),
              eq(registroContato.tipo, 'ligacao'),
              eq(registroContato.efetiva, true),
              between(registroContato.dataHora, inicioHoje, fimHoje),
              isNull(registroContato.deletedAt)
            )
          )

        const [{ qtdVendasMes, valorFechadoMes }] = await db
          .select({ qtdVendasMes: count(), valorFechadoMes: sum(vendas.valorFechado).mapWith(Number) })
          .from(vendas)
          .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
          .where(and(eq(funilMensal.vendedorId, v.id), eq(vendas.mesReferencia, mesAtual), isNull(vendas.deletedAt)))

        const meta = metaPorVendedor.get(v.id)
        const metaLigacoesDia = meta?.metaLigacoesDia ?? 25
        const valorMes = valorFechadoMes ?? 0

        // Taxa de conversão = fechados / (fechados + perdidos) — só entre
        // negócios já decididos, não fechados / total de leads na carteira.
        // Isso evita punir quem tem uma carteira gigante e ainda intocada
        // (a maioria só entra "Novo" e nunca vira decisão nenhuma).
        const decididos = qtdVendasMes + qtdPerdidosMes
        const taxaConversao = decididos > 0 ? Math.round((qtdVendasMes / decididos) * 1000) / 10 : null

        // Meta do dia = ritmo acumulado, não um valor isolado por dia: é a
        // meta mensal dividida pelos dias úteis do mês, multiplicada pelos
        // dias úteis já passados (incluindo hoje). Assim quem fica devendo
        // num dia carrega o déficit pros próximos — não "reseta" a cada dia.
        const metaFaturamentoDia = meta?.metaFaturamento ? meta.metaFaturamento / diasUteisMes : null
        const metaAcumuladaAteHoje = metaFaturamentoDia ? metaFaturamentoDia * diasUteisAteHoje : null

        // Mesmo esquema de ritmo acumulado da meta de faturamento: a meta de
        // ligações não é "25 hoje", é "25 × dias úteis já passados no mês" —
        // quem ficou devendo num dia carrega o déficit pros próximos, em vez
        // de resetar a cobrança toda manhã.
        const metaLigacoesAcumulada = Math.round(metaLigacoesDia * diasUteisAteHoje)

        return {
          id: v.id,
          nome: v.name,
          fotoUrl: v.fotoUrl,
          ligacoesHoje,
          ligacoesEfetivasHoje,
          percentualEfetividadeHoje: ligacoesHoje > 0 ? Math.round((ligacoesEfetivasHoje / ligacoesHoje) * 1000) / 10 : 0,
          metaLigacoesDia,
          metaLigacoesAcumulada,
          bateuMetaLigacoes: metaLigacoesAcumulada > 0 ? ligacoesMes >= metaLigacoesAcumulada : false,
          percentualMetaLigacoes: metaLigacoesAcumulada > 0 ? Math.round((ligacoesMes / metaLigacoesAcumulada) * 1000) / 10 : 0,
          qtdVendasMes,
          qtdPerdidosMes,
          taxaConversao,
          valorFechadoMes: valorMes,
          valorFechadoSemana: valorSemana ?? 0,
          valorFechadoSemanaPassada: valorSemanaPassada ?? 0,
          evolucaoSemana: (valorSemana ?? 0) - (valorSemanaPassada ?? 0),
          ligacoesMes,
          sequenciaDiasVendendo,
          ticketMedioMes: qtdVendasMes > 0 ? valorMes / qtdVendasMes : 0,
          metaFaturamento: meta?.metaFaturamento ?? null,
          bateuMetaFaturamento: meta?.metaFaturamento ? valorMes >= meta.metaFaturamento : false,
          percentualMetaFaturamento: meta?.metaFaturamento ? Math.round((valorMes / meta.metaFaturamento) * 1000) / 10 : 0,
          metaFaturamentoDia,
          metaAcumuladaAteHoje,
          bateuMetaDia: metaAcumuladaAteHoje ? valorMes >= metaAcumuladaAteHoje : false,
          percentualMetaDia: metaAcumuladaAteHoje ? Math.round((valorMes / metaAcumuladaAteHoje) * 1000) / 10 : 0,
        }
      })
    )

    const [{ vendasHojeQtd, vendasHojeValor }] = await db
      .select({ vendasHojeQtd: count(), vendasHojeValor: sum(vendas.valorFechado).mapWith(Number) })
      .from(vendas)
      .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
      .where(and(between(vendas.dataFechamento, inicioHoje, fimHoje), isNull(vendas.deletedAt), filtroVendedorEmpresa))

    const [{ vendasMesQtd, vendasMesValor }] = await db
      .select({ vendasMesQtd: count(), vendasMesValor: sum(vendas.valorFechado).mapWith(Number) })
      .from(vendas)
      .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
      .where(and(eq(vendas.mesReferencia, mesAtual), isNull(vendas.deletedAt), filtroVendedorEmpresa))

    // Sem limite de propósito — o Painel de TV rola a página inteira sozinho
    // (useAutoScroll no client) até o fim do slide antes de trocar, então
    // cortar em 15 escondia negociação de quem tem mais que isso aberto (o
    // selo do topo já mostrava o total certo, só a tabela ficava incompleta).
    const negociosAbertos = await db
      .select({
        clienteId: funilMensal.clienteId,
        razaoSocial: clientes.razaoSocial,
        vendedorNome: users.name,
        dataEntradaEtapa: funilMensal.dataEntradaEtapa,
        etapa: funilMensal.etapa,
        valorOrcado: funilMensal.valorOrcado,
      })
      .from(funilMensal)
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .where(
        and(
          eq(funilMensal.etapa, 'negociacao'),
          eq(funilMensal.mesReferencia, mesAtual),
          isNull(funilMensal.deletedAt),
          eq(users.empresaId, ctx.empresaId)
        )
      )
      // Maior valor orçado primeiro — pedido do João, quem tem mais dinheiro
      // parado em negociação chama mais atenção no telão do que quem entrou
      // na etapa mais recentemente. Sem valor lançado fica por último (NULL
      // ordena como "menor que qualquer valor" no SQLite, já cai no fim sozinho).
      .orderBy(desc(funilMensal.valorOrcado))

    // Total de orçamentos/propostas em aberto (todos os negócios em
    // "negociação" esse mês — mesma lista de `negociosAbertos` acima, contada
    // e somada) — pro tile de resumo no Dashboard e no Painel de TV.
    const [{ orcamentosAbertosValor, orcamentosAbertosQtd }] = await db
      .select({ orcamentosAbertosValor: sum(funilMensal.valorOrcado).mapWith(Number), orcamentosAbertosQtd: count() })
      .from(funilMensal)
      .where(
        and(
          eq(funilMensal.etapa, 'negociacao'),
          eq(funilMensal.mesReferencia, mesAtual),
          isNull(funilMensal.deletedAt),
          filtroFunilEmpresa
        )
      )

    // Série dos últimos 14 dias pros gráficos de linha (tendência de vendas e
    // de clientes chamados/dia) — agrupa por substr da coluna datetime porque
    // ela é salva como texto "YYYY-MM-DD HH:MM:SS", sem tipo date nativo.
    const dias = ultimosDias(DIAS_HISTORICO)
    const inicioHistorico = `${dias[0].chave} 00:00:00`

    const vendasPorDia = await db
      .select({
        dia: sql<string>`substr(${vendas.dataFechamento}, 1, 10)`,
        quantidade: count(),
        valor: sum(vendas.valorFechado).mapWith(Number),
      })
      .from(vendas)
      .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
      .where(and(sql`${vendas.dataFechamento} >= ${inicioHistorico}`, isNull(vendas.deletedAt), filtroVendedorEmpresa))
      .groupBy(sql`substr(${vendas.dataFechamento}, 1, 10)`)

    const contatosPorDia = await db
      .select({
        dia: sql<string>`substr(${registroContato.dataHora}, 1, 10)`,
        quantidade: count(),
      })
      .from(registroContato)
      .where(
        and(
          eq(registroContato.tipo, 'ligacao'),
          sql`${registroContato.dataHora} >= ${inicioHistorico}`,
          isNull(registroContato.deletedAt),
          filtroContatoEmpresa
        )
      )
      .groupBy(sql`substr(${registroContato.dataHora}, 1, 10)`)

    const vendasPorDiaMap = new Map(vendasPorDia.map((v) => [v.dia, v]))
    const contatosPorDiaMap = new Map(contatosPorDia.map((c) => [c.dia, c.quantidade]))

    const historico = dias.map(({ chave, rotulo }) => ({
      dia: rotulo,
      vendas: vendasPorDiaMap.get(chave)?.quantidade ?? 0,
      valorVendas: vendasPorDiaMap.get(chave)?.valor ?? 0,
      contatos: contatosPorDiaMap.get(chave) ?? 0,
    }))

    const vendasHojeValorNum = vendasHojeValor ?? 0
    const vendasMesValorNum = vendasMesValor ?? 0

    // Meta da empresa inteira (soma de todos os vendedores) — mesmo cálculo
    // de ritmo diário usado por vendedor: meta mensal ÷ dias úteis do mês ×
    // dias úteis já passados, pra não "resetar" o déficit a cada dia.
    const metaFaturamentoEmpresa = await getConfigNumero(`meta_faturamento_empresa_${ctx.empresaId}`, 0)
    const metaFaturamentoDiaEmpresa = metaFaturamentoEmpresa / diasUteisMes
    const metaAcumuladaAteHojeEmpresa = metaFaturamentoDiaEmpresa * diasUteisAteHoje
    const metaEmpresa = {
      metaFaturamento: metaFaturamentoEmpresa,
      valorFechadoMes: vendasMesValorNum,
      percentualMetaFaturamento: metaFaturamentoEmpresa > 0 ? Math.round((vendasMesValorNum / metaFaturamentoEmpresa) * 1000) / 10 : 0,
      bateuMetaFaturamento: vendasMesValorNum >= metaFaturamentoEmpresa,
      metaAcumuladaAteHoje: metaAcumuladaAteHojeEmpresa,
      percentualMetaDia: metaAcumuladaAteHojeEmpresa > 0 ? Math.round((vendasMesValorNum / metaAcumuladaAteHojeEmpresa) * 1000) / 10 : 0,
      bateuMetaDia: vendasMesValorNum >= metaAcumuladaAteHojeEmpresa,
    }

    // Quanto da meta (do mês inteiro, não só o acumulado) já deveria ter
    // sido batido a essa altura — dias úteis já passados ÷ dias úteis do
    // mês. Mesmo número serve pra empresa e pra qualquer vendedor, já que
    // não depende de meta individual, só do calendário.
    const percentualIdealHoje = diasUteisMes > 0 ? Math.round((diasUteisAteHoje / diasUteisMes) * 1000) / 10 : 0

    return {
      vendedores: vendedoresComDados.sort((a, b) => b.valorFechadoMes - a.valorFechadoMes),
      rankingLigacoes: [...vendedoresComDados].sort((a, b) => b.ligacoesHoje - a.ligacoesHoje),
      rankingSemanal: [...vendedoresComDados].sort((a, b) => b.valorFechadoSemana - a.valorFechadoSemana),
      rankingConversao: [...vendedoresComDados]
        .filter((v) => v.taxaConversao !== null)
        .sort((a, b) => (b.taxaConversao ?? 0) - (a.taxaConversao ?? 0)),
      rankingEvolucao: [...vendedoresComDados].sort((a, b) => b.evolucaoSemana - a.evolucaoSemana),
      vendasHoje: {
        quantidade: vendasHojeQtd,
        valor: vendasHojeValorNum,
        ticketMedio: vendasHojeQtd > 0 ? vendasHojeValorNum / vendasHojeQtd : 0,
      },
      vendasMes: {
        quantidade: vendasMesQtd,
        valor: vendasMesValorNum,
        ticketMedio: vendasMesQtd > 0 ? vendasMesValorNum / vendasMesQtd : 0,
      },
      historico,
      negociosAbertos,
      orcamentosAbertos: { valor: orcamentosAbertosValor ?? 0, quantidade: orcamentosAbertosQtd },
      metaEmpresa,
      percentualIdealHoje,
    }
  }),

  // Resumo pessoal do vendedor logado — mesma base de cálculo do `resumo`
  // (ritmo acumulado, ticket médio, etc.), mas só a própria produção + a
  // posição no ranking do time, pra alimentar o dashboard individual sem
  // expor os números de faturamento dos outros vendedores.
  meuResumo: protectedProcedure.query(async ({ ctx }) => {
    const hoje = hojeBrString()
    const inicioHoje = `${hoje} 00:00:00`
    const fimHoje = `${hoje} 23:59:59`
    const mesAtual = mesReferenciaAtual()
    const vendedorId = ctx.user.id

    const meta = await db.query.metasMensais.findFirst({
      where: and(eq(metasMensais.vendedorId, vendedorId), eq(metasMensais.mesReferencia, mesAtual)),
    })

    const [{ ligacoesHoje }] = await db
      .select({ ligacoesHoje: count() })
      .from(registroContato)
      .where(
        and(
          eq(registroContato.vendedorId, vendedorId),
          eq(registroContato.tipo, 'ligacao'),
          between(registroContato.dataHora, inicioHoje, fimHoje),
          isNull(registroContato.deletedAt)
        )
      )

    const [{ ligacoesEfetivasHoje }] = await db
      .select({ ligacoesEfetivasHoje: count() })
      .from(registroContato)
      .where(
        and(
          eq(registroContato.vendedorId, vendedorId),
          eq(registroContato.tipo, 'ligacao'),
          eq(registroContato.efetiva, true),
          between(registroContato.dataHora, inicioHoje, fimHoje),
          isNull(registroContato.deletedAt)
        )
      )

    const [{ ligacoesMes }] = await db
      .select({ ligacoesMes: count() })
      .from(registroContato)
      .where(
        and(
          eq(registroContato.vendedorId, vendedorId),
          eq(registroContato.tipo, 'ligacao'),
          sql`${registroContato.dataHora} >= ${mesAtual + ' 00:00:00'}`,
          isNull(registroContato.deletedAt)
        )
      )

    const [{ vendasHojeQtd, vendasHojeValor }] = await db
      .select({ vendasHojeQtd: count(), vendasHojeValor: sum(vendas.valorFechado).mapWith(Number) })
      .from(vendas)
      .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
      .where(and(eq(funilMensal.vendedorId, vendedorId), between(vendas.dataFechamento, inicioHoje, fimHoje), isNull(vendas.deletedAt)))

    const [{ vendasMesQtd, vendasMesValor }] = await db
      .select({ vendasMesQtd: count(), vendasMesValor: sum(vendas.valorFechado).mapWith(Number) })
      .from(vendas)
      .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
      .where(and(eq(funilMensal.vendedorId, vendedorId), eq(vendas.mesReferencia, mesAtual), isNull(vendas.deletedAt)))

    const diasUteisMes = diasUteisNoMes(mesAtual)
    const diasUteisAteHoje = diasUteisDecorridos(mesAtual)
    const valorMes = vendasMesValor ?? 0
    const metaLigacoesDia = meta?.metaLigacoesDia ?? 25
    // Ritmo acumulado, mesmo esquema da meta de faturamento: 25/dia × dias
    // úteis já passados no mês, não "25 hoje".
    const metaLigacoesAcumulada = Math.round(metaLigacoesDia * diasUteisAteHoje)
    const metaFaturamentoDia = meta?.metaFaturamento ? meta.metaFaturamento / diasUteisMes : null
    const metaAcumuladaAteHoje = metaFaturamentoDia ? metaFaturamentoDia * diasUteisAteHoje : null
    // Quanto da meta do mês inteiro já deveria ter sido batido a essa altura
    // — dias úteis já passados ÷ dias úteis do mês (ver mesmo cálculo em
    // `resumo`, acima).
    const percentualIdealHoje = diasUteisMes > 0 ? Math.round((diasUteisAteHoje / diasUteisMes) * 1000) / 10 : 0

    // Posição no ranking do time (só pra saber a colocação, sem expor os
    // valores de faturamento dos colegas).
    const todosVendedores = await db.query.users.findMany({
      where: and(eq(users.isActive, true), eq(users.superAdmin, false), eq(users.empresaId, ctx.empresaId)),
    })
    const valoresPorVendedor = await Promise.all(
      todosVendedores.map(async (v) => {
        const [{ valor }] = await db
          .select({ valor: sum(vendas.valorFechado).mapWith(Number) })
          .from(vendas)
          .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
          .where(and(eq(funilMensal.vendedorId, v.id), eq(vendas.mesReferencia, mesAtual), isNull(vendas.deletedAt)))
        return { id: v.id, valor: valor ?? 0 }
      })
    )
    valoresPorVendedor.sort((a, b) => b.valor - a.valor)
    const posicaoRanking = valoresPorVendedor.findIndex((v) => v.id === vendedorId) + 1

    // Série pessoal dos últimos 14 dias (vendas + contatos), mesmo esquema
    // do painel de TV, só que filtrado pelo próprio vendedor.
    const dias = ultimosDias(DIAS_HISTORICO)
    const inicioHistorico = `${dias[0].chave} 00:00:00`

    const vendasPorDia = await db
      .select({ dia: sql<string>`substr(${vendas.dataFechamento}, 1, 10)`, quantidade: count() })
      .from(vendas)
      .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
      .where(
        and(eq(funilMensal.vendedorId, vendedorId), sql`${vendas.dataFechamento} >= ${inicioHistorico}`, isNull(vendas.deletedAt))
      )
      .groupBy(sql`substr(${vendas.dataFechamento}, 1, 10)`)

    const contatosPorDia = await db
      .select({ dia: sql<string>`substr(${registroContato.dataHora}, 1, 10)`, quantidade: count() })
      .from(registroContato)
      .where(
        and(
          eq(registroContato.vendedorId, vendedorId),
          eq(registroContato.tipo, 'ligacao'),
          sql`${registroContato.dataHora} >= ${inicioHistorico}`,
          isNull(registroContato.deletedAt)
        )
      )
      .groupBy(sql`substr(${registroContato.dataHora}, 1, 10)`)

    const vendasPorDiaMap = new Map(vendasPorDia.map((v) => [v.dia, v.quantidade]))
    const contatosPorDiaMap = new Map(contatosPorDia.map((c) => [c.dia, c.quantidade]))
    const historico = dias.map(({ chave, rotulo }) => ({
      dia: rotulo,
      vendas: vendasPorDiaMap.get(chave) ?? 0,
      contatos: contatosPorDiaMap.get(chave) ?? 0,
    }))
    const sequenciaDiasVendendo = calcularSequenciaDias(new Set(vendasPorDia.filter((v) => v.quantidade > 0).map((v) => v.dia)), hojeBr())

    // Clientes da própria carteira há mais tempo sem contato, pra saber
    // quem priorizar hoje.
    const carteira = await db.query.clientes.findMany({
      where: and(eq(clientes.vendedorAtualId, vendedorId), isNull(clientes.deletedAt)),
      columns: { id: true, razaoSocial: true },
      with: {
        funis: {
          where: and(eq(funilMensal.mesReferencia, mesAtual), isNull(funilMensal.deletedAt)),
          columns: { dataUltimoContato: true, dataEntradaEtapa: true },
        },
      },
    })
    const clientesSemContato = carteira
      .map((c) => {
        const funil = c.funis[0]
        const dias = funil ? diasDesde(funil.dataUltimoContato ?? funil.dataEntradaEtapa) : null
        return { clienteId: c.id, razaoSocial: c.razaoSocial, dias }
      })
      .filter((c) => c.dias !== null)
      .sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0))
      .slice(0, 5)

    const vendasHojeValorNum = vendasHojeValor ?? 0

    return {
      vendasHoje: { quantidade: vendasHojeQtd, valor: vendasHojeValorNum, ticketMedio: vendasHojeQtd > 0 ? vendasHojeValorNum / vendasHojeQtd : 0 },
      vendasMes: { quantidade: vendasMesQtd, valor: valorMes, ticketMedio: vendasMesQtd > 0 ? valorMes / vendasMesQtd : 0 },
      ligacoesHoje,
      ligacoesEfetivasHoje,
      percentualEfetividadeHoje: ligacoesHoje > 0 ? Math.round((ligacoesEfetivasHoje / ligacoesHoje) * 1000) / 10 : 0,
      ligacoesMes,
      metaLigacoesDia,
      metaLigacoesAcumulada,
      bateuMetaLigacoes: metaLigacoesAcumulada > 0 ? ligacoesMes >= metaLigacoesAcumulada : false,
      percentualMetaLigacoes: metaLigacoesAcumulada > 0 ? Math.round((ligacoesMes / metaLigacoesAcumulada) * 1000) / 10 : 0,
      metaFaturamento: meta?.metaFaturamento ?? null,
      percentualMetaFaturamento: meta?.metaFaturamento ? Math.round((valorMes / meta.metaFaturamento) * 1000) / 10 : 0,
      metaAcumuladaAteHoje,
      percentualRitmo: metaAcumuladaAteHoje ? Math.round((valorMes / metaAcumuladaAteHoje) * 1000) / 10 : 0,
      percentualIdealHoje,
      posicaoRanking,
      totalVendedores: todosVendedores.length,
      historico,
      clientesSemContato,
      sequenciaDiasVendendo,
    }
  }),
})
