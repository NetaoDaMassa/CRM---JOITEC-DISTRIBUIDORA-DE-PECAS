import { z } from 'zod'
import { and, between, count, desc, eq, inArray, isNotNull, isNull, or, sql, sum } from 'drizzle-orm'
import { router, protectedProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import {
  carteiraHistorico,
  clientes,
  clienteVinculos,
  empresas,
  funilMensal,
  registroContato,
  itensPedido,
  users,
  vendas as vendasTable,
  logAuditoria,
  ordens,
  ordemDetalhes,
  sapImportacoes,
  sapVendasHistorico,
  sapCotacoesHistorico,
} from '../db/schema.js'
import { diasDesde, mesReferenciaAtual } from '../lib/dataBr.js'
import { toLocalDateKey, toUtcISO } from '../lib/businessHours.js'
import { coberturaContatosVendedor } from '../lib/coberturaContatos.js'

// Desde quando o cliente está com o vendedor atual — pedido do João,
// 2026-10-21: nos "Clientes parados", um cliente passado pro vendedor há 3
// dias aparecia igual a um esquecido há meses. Vale a entrada mais recente
// do histórico de carteira pra esse par cliente+vendedor; sem histórico
// (cadastros antigos), cai na data de cadastro do cliente.
async function naCarteiraDesde(pares: { clienteId: number; vendedorId: number | null; cadastradoEm: string }[]): Promise<Map<number, string>> {
  const ultimaEntrada = new Map<string, string>()
  const ids = [...new Set(pares.map((p) => p.clienteId))]
  for (let i = 0; i < ids.length; i += 900) {
    const linhas = await db
      .select({ clienteId: carteiraHistorico.clienteId, vendedorId: carteiraHistorico.vendedorId, desde: sql<string>`max(${carteiraHistorico.createdAt})` })
      .from(carteiraHistorico)
      .where(inArray(carteiraHistorico.clienteId, ids.slice(i, i + 900)))
      .groupBy(carteiraHistorico.clienteId, carteiraHistorico.vendedorId)
    for (const l of linhas) ultimaEntrada.set(`${l.clienteId}-${l.vendedorId}`, l.desde)
  }
  return new Map(pares.map((p) => [p.clienteId, ultimaEntrada.get(`${p.clienteId}-${p.vendedorId}`) ?? p.cadastradoEm]))
}

// Vendedores que o usuário logado tem permissão de ver neste relatório —
// admin vê todos (ou só um, se filtrar) e vendedor só vê a si mesmo.
// Vários relatórios novos precisam da lista de vendedores pra fazer a conta
// "de quantos clientes" por vendedor, não só filtrar registros já existentes
// (ex: positivação/cobertura de contato precisam do denominador mesmo pro
// vendedor que não tem nenhum registro no período).
async function vendedoresPermitidos(ctx: { user: { role: 'admin' | 'vendor' | 'gestor'; id: number }; empresaId: number }, vendedorId: number | undefined) {
  const vendedores = await db.query.users.findMany({
    where: and(eq(users.empresaId, ctx.empresaId), eq(users.isActive, true), eq(users.superAdmin, false)),
    columns: { id: true, name: true },
  })
  if (ctx.user.role !== 'admin') return vendedores.filter((v) => v.id === ctx.user.id)
  return vendedorId ? vendedores.filter((v) => v.id === vendedorId) : vendedores
}

// Positivação de carteira contava cada CNPJ vinculado (`cliente_vinculos` —
// matriz/filial, mesmo cliente com CNPJ diferente) como um cliente à parte,
// distorcendo "de quantos clientes ele vendeu" (pedido do João 2026-08-25:
// vendedores já vinculam esses cadastros, mas o relatório não olhava pra
// isso). Agrupa por componente conexo (union-find) dentro do conjunto já
// filtrado — um vínculo pra um cliente fora do filtro (outro vendedor, outra
// região) não junta grupo nenhum, só é ignorado.
async function agruparCarteiraVinculada(
  clientesFiltrados: { id: number; dataUltimaCompra: string | null }[],
  inicio: string,
  fim: string,
  // Clientes com pedido do SAP no período (ver `vendasSap`) — também contam
  // como positivados.
  compraramNoSap: Set<number> = new Set()
): Promise<{ totalCarteira: number; ativados: number }> {
  const ids = clientesFiltrados.map((c) => c.id)
  if (ids.length === 0) return { totalCarteira: 0, ativados: 0 }

  const idSet = new Set(ids)
  const vinculosRows = await db.query.clienteVinculos.findMany({
    where: or(inArray(clienteVinculos.clienteId, ids), inArray(clienteVinculos.clienteVinculadoId, ids)),
  })

  const pai = new Map<number, number>(ids.map((id) => [id, id]))
  function encontrar(id: number): number {
    let raiz = id
    while (pai.get(raiz) !== raiz) raiz = pai.get(raiz)!
    while (pai.get(id) !== raiz) {
      const proximo = pai.get(id)!
      pai.set(id, raiz)
      id = proximo
    }
    return raiz
  }
  function unir(a: number, b: number) {
    const ra = encontrar(a)
    const rb = encontrar(b)
    if (ra !== rb) pai.set(ra, rb)
  }
  for (const v of vinculosRows) {
    if (idSet.has(v.clienteId) && idSet.has(v.clienteVinculadoId)) unir(v.clienteId, v.clienteVinculadoId)
  }

  // Mesma comparação textual usada no resto do arquivo (between em cima de
  // "YYYY-MM-DD HH:MM:SS") — dataUltimaCompra segue o mesmo formato.
  const grupoAtivado = new Map<number, boolean>()
  for (const c of clientesFiltrados) {
    const raiz = encontrar(c.id)
    const comprouAgora = (!!c.dataUltimaCompra && c.dataUltimaCompra >= inicio && c.dataUltimaCompra <= fim) || compraramNoSap.has(c.id)
    grupoAtivado.set(raiz, (grupoAtivado.get(raiz) ?? false) || comprouAgora)
  }

  return { totalCarteira: grupoAtivado.size, ativados: [...grupoAtivado.values()].filter(Boolean).length }
}

// Histórico do SAP (lotes LIGADOS) somado às vendas do CRM nos relatórios de
// venda — pedido do João, 2026-10-20: o SAP cobre abril–julho/2026, antes do
// CRM existir, e os relatórios precisam enxergar os dois como uma coisa só.
// Venda do SAP não tem vendedor: conta pro vendedor ATUAL do cliente
// (decisão do João). Metas, rankings e painéis NÃO usam isso. Desligar o
// lote tira tudo daqui na hora (nada é gravado em `clientes`/`vendas`).
async function vendasSap(params: {
  empresaId?: number
  dataInicio: string
  dataFim: string
  ctx?: { user: { role: 'admin' | 'vendor' | 'gestor'; id: number } }
  vendedorId?: number
  regiao?: string
  apenasMarketing?: boolean
}) {
  const filtros = [
    eq(sapImportacoes.ativo, true),
    between(sapVendasHistorico.dataPedido, params.dataInicio.slice(0, 10), params.dataFim.slice(0, 10)),
    isNull(clientes.deletedAt),
  ]
  if (params.empresaId) filtros.push(eq(sapVendasHistorico.empresaId, params.empresaId))
  if (params.ctx) {
    const filtroVend = filtroVendedor(params.ctx.user.role, params.ctx.user.id, params.vendedorId, clientes.vendedorAtualId)
    if (filtroVend) filtros.push(filtroVend)
  }
  const filtroReg = filtroRegiao(params.regiao, clientes.regiao)
  if (filtroReg) filtros.push(filtroReg)
  if (params.apenasMarketing) filtros.push(eq(clientes.origemMarketing, true))

  return db
    .select({
      clienteId: sapVendasHistorico.clienteId,
      empresaId: sapVendasHistorico.empresaId,
      data: sapVendasHistorico.dataPedido,
      valor: sapVendasHistorico.valor,
      razaoSocial: clientes.razaoSocial,
      vendedorId: clientes.vendedorAtualId,
      vendedorNome: users.name,
    })
    .from(sapVendasHistorico)
    .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapVendasHistorico.importacaoId))
    .innerJoin(clientes, eq(clientes.id, sapVendasHistorico.clienteId))
    .leftJoin(users, eq(users.id, clientes.vendedorAtualId))
    .where(and(...filtros))
}

// Pedidos da Odin Compressores (módulo Pedidos/`ordens`) — pedido do João,
// 2026-10-20: lá a maior parte das vendas (máquinas, equipes de externos e
// de leads) não passa pela Carteira, vira Pedido direto. Conta como venda o
// pedido não cancelado, na data em que foi criado (dia de Brasília) — mesma
// regra do bloco "Equipes de venda" do Dashboard Odin. Pedido de peça que
// nasceu de uma venda da Carteira (vendas.convertidoParaOrdemId) fica de
// fora, porque a venda já conta. Vendedor = quem está no pedido.
async function pedidosOdin(params: Parameters<typeof vendasSap>[0]) {
  const dataBr = sql<string>`date(${ordens.createdAt}, '-3 hours')`
  const filtros = [
    sql`${dataBr} between ${params.dataInicio.slice(0, 10)} and ${params.dataFim.slice(0, 10)}`,
    sql`${ordens.status} != 'cancelado'`,
    sql`not exists (select 1 from ${vendasTable} where ${vendasTable.convertidoParaOrdemId} = ${ordens.id} and ${vendasTable.deletedAt} is null)`,
    isNull(clientes.deletedAt),
  ]
  if (params.empresaId) filtros.push(eq(ordens.empresaId, params.empresaId))
  if (params.ctx) {
    const filtroVend = filtroVendedor(params.ctx.user.role, params.ctx.user.id, params.vendedorId, ordens.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
  }
  const filtroReg = filtroRegiao(params.regiao, clientes.regiao)
  if (filtroReg) filtros.push(filtroReg)
  if (params.apenasMarketing) filtros.push(eq(clientes.origemMarketing, true))

  const linhas = await db
    .select({
      clienteId: sql<number>`${ordens.clienteId}`.mapWith(Number),
      empresaId: ordens.empresaId,
      data: dataBr,
      valor: sql<number>`coalesce(${ordemDetalhes.valorPedido}, 0)`.mapWith(Number),
      razaoSocial: clientes.razaoSocial,
      vendedorId: ordens.vendedorId,
      vendedorNome: users.name,
    })
    .from(ordens)
    .innerJoin(clientes, eq(clientes.id, ordens.clienteId))
    .leftJoin(ordemDetalhes, eq(ordemDetalhes.ordemId, ordens.id))
    .leftJoin(users, eq(users.id, ordens.vendedorId))
    .where(and(...filtros))
  return linhas.map((l) => ({ ...l, origem: 'pedidos' as const }))
}

// Tudo que é venda mas não está na tabela `vendas` (Carteira): histórico do
// SAP + Pedidos da Odin. Mesmo formato (data "YYYY-MM-DD").
async function vendasExtras(params: Parameters<typeof vendasSap>[0]) {
  const [sap, pedidos] = await Promise.all([vendasSap(params), pedidosOdin(params)])
  return [...sap.map((v) => ({ ...v, origem: 'sap' as const })), ...pedidos]
}

// Última compra/compras por cliente vindas de Pedidos (Odin), pra posição
// da carteira — mesma exclusão de pedido que nasceu de venda da Carteira.
async function pedidosPorCliente(clienteIds: number[]) {
  if (!clienteIds.length) return []
  return db
    .select({
      clienteId: sql<number>`${ordens.clienteId}`.mapWith(Number),
      data: sql<string>`date(${ordens.createdAt}, '-3 hours')`,
      valor: sql<number>`coalesce(${ordemDetalhes.valorPedido}, 0)`.mapWith(Number),
    })
    .from(ordens)
    .leftJoin(ordemDetalhes, eq(ordemDetalhes.ordemId, ordens.id))
    .where(
      and(
        inArray(ordens.clienteId, clienteIds),
        sql`${ordens.status} != 'cancelado'`,
        sql`not exists (select 1 from ${vendasTable} where ${vendasTable.convertidoParaOrdemId} = ${ordens.id} and ${vendasTable.deletedAt} is null)`
      )
    )
}

// Data do pedido SAP vem só "YYYY-MM-DD" — meio-dia evita que a conversão
// de fuso (UTC → Brasília) em `diasDesde` jogue pro dia anterior.
function dataSapComoDatetime(data: string): string {
  return `${data} 12:00:00`
}

const regiaoEnum = z.enum(['norte', 'nordeste', 'centro_oeste', 'sudeste', 'sul']).optional()

const periodoInput = z.object({
  dataInicio: z.string(),
  dataFim: z.string(),
  vendedorId: z.number().optional(),
  regiao: regiaoEnum,
})

const filtroAtualInput = z.object({
  vendedorId: z.number().optional(),
  regiao: regiaoEnum,
})

function filtroVendedor(ctxRole: 'admin' | 'vendor' | 'gestor', ctxUserId: number, vendedorId: number | undefined, coluna: any) {
  if (ctxRole === 'admin') return vendedorId ? eq(coluna, vendedorId) : undefined
  return eq(coluna, ctxUserId)
}

// Filtro opcional por região do cliente (norte/nordeste/centro_oeste/sudeste/
// sul) — mesma ideia de `filtroVendedor`: undefined quando não filtrado, pra
// não poluir o array de condições do `and(...)`.
function filtroRegiao(regiao: string | undefined, coluna: any) {
  return regiao ? eq(coluna, regiao) : undefined
}

// input.dataFim vem como "YYYY-MM-DD" puro (input type="date"). Comparando
// como texto direto contra colunas datetime ("YYYY-MM-DD HH:MM:SS"), a data
// de hoje ficaria de fora do período (string mais curta "perde" de qualquer
// timestamp do mesmo dia na ordenação lexicográfica) — por isso sempre
// expandimos pros limites do dia antes de usar em between().
function limitesDia(input: { dataInicio: string; dataFim: string }) {
  return { inicio: `${input.dataInicio} 00:00:00`, fim: `${input.dataFim} 23:59:59` }
}

export const reportsRouter = router({
  curvaAbc: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [between(vendasTable.dataFechamento, inicio, fim), isNull(vendasTable.deletedAt), eq(clientes.empresaId, ctx.empresaId)]
    // Filtra por quem fechou o negócio (funil_mensal.vendedorId), não pelo
    // vendas.vendedorId — esse último é gravado uma vez na hora do fechamento
    // e fica desatualizado se o cliente for transferido de carteira depois
    // (transferirCliente atualiza o funil_mensal do mês, mas não a venda já
    // criada), fazendo a venda vazar pro filtro do vendedor errado.
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, funilMensal.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const linhas = await db
      .select({
        clienteId: vendasTable.clienteId,
        razaoSocial: clientes.razaoSocial,
        // Vendedor atual da carteira do cliente (não quem fechou a venda —
        // pode ter mudado de mãos desde então), pra bater com "de quem é
        // esse cliente hoje" que é o que o João pediu pra ver na curva ABC.
        vendedorNome: users.name,
        valorTotal: sum(vendasTable.valorFechado).mapWith(Number),
      })
      .from(vendasTable)
      .innerJoin(clientes, eq(clientes.id, vendasTable.clienteId))
      .innerJoin(funilMensal, eq(funilMensal.id, vendasTable.funilMensalId))
      .leftJoin(users, eq(users.id, clientes.vendedorAtualId))
      .where(and(...filtros))
      .groupBy(vendasTable.clienteId)
      .orderBy(desc(sql`sum(${vendasTable.valorFechado})`))

    // Soma o SAP por cliente junto com o CRM e reordena.
    const porCliente = new Map(linhas.map((l) => [l.clienteId, { ...l, valorTotal: l.valorTotal ?? 0 }]))
    for (const v of await vendasExtras({ empresaId: ctx.empresaId, dataInicio: input.dataInicio, dataFim: input.dataFim, ctx, vendedorId: input.vendedorId, regiao: input.regiao })) {
      const atual = porCliente.get(v.clienteId) ?? { clienteId: v.clienteId, razaoSocial: v.razaoSocial, vendedorNome: v.vendedorNome, valorTotal: 0 }
      atual.valorTotal += v.valor
      porCliente.set(v.clienteId, atual)
    }
    const linhasComSap = [...porCliente.values()].sort((a, b) => b.valorTotal - a.valorTotal)

    const totalGeral = linhasComSap.reduce((acc, l) => acc + (l.valorTotal ?? 0), 0)
    let acumulado = 0
    return linhasComSap.map((l) => {
      acumulado += l.valorTotal ?? 0
      const pctAcumulado = totalGeral > 0 ? (acumulado / totalGeral) * 100 : 0
      const classe = pctAcumulado <= 80 ? 'A' : pctAcumulado <= 95 ? 'B' : 'C'
      return { ...l, classe }
    })
  }),

  positivacaoCarteira: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    // Sem filtrar um vendedor específico, isso contava a empresa inteira —
    // inclusive quem está parado no Banco de Clientes (sem vendedor) e quem
    // pertence a um vendedor já desativado. João quer só a carteira ativa
    // aqui (pedido 2026-08-20), pra bater exatamente com a soma de
    // `positivacaoPorVendedor` (que só lista vendedores com isActive=true
    // via `vendedoresPermitidos` — vendedorAtualId nulo ou de alguém
    // desativado nunca aparece lá).
    const vendedoresAtivos = await vendedoresPermitidos(ctx, input.vendedorId)
    const idsVendedoresAtivos = vendedoresAtivos.map((v) => v.id)
    const filtrosCarteira = [
      isNull(clientes.deletedAt),
      eq(clientes.empresaId, ctx.empresaId),
      // idsVendedoresAtivos já reflete o filtro de vendedorId (admin filtrando
      // um só, ou vendedor vendo só a si mesmo) — ver vendedoresPermitidos.
      idsVendedoresAtivos.length ? inArray(clientes.vendedorAtualId, idsVendedoresAtivos) : sql`0`,
    ]
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtrosCarteira.push(filtroReg)

    const clientesFiltrados = await db.query.clientes.findMany({
      where: and(...filtrosCarteira),
      columns: { id: true, dataUltimaCompra: true },
    })
    const compraramNoSap = new Set(
      (await vendasExtras({ empresaId: ctx.empresaId, dataInicio: input.dataInicio, dataFim: input.dataFim })).map((v) => v.clienteId)
    )
    const { totalCarteira, ativados } = await agruparCarteiraVinculada(clientesFiltrados, inicio, fim, compraramNoSap)

    return {
      totalCarteira,
      ativados,
      percentual: totalCarteira > 0 ? (ativados / totalCarteira) * 100 : 0,
    }
  }),

  // Mesma métrica de `positivacaoCarteira`, mas quebrada por vendedor — "de
  // 100 clientes, pra quantos ele vendeu no mês" por pessoa, não só o
  // agregado da empresa inteira quando nenhum vendedor está filtrado.
  positivacaoPorVendedor: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const vendedores = await vendedoresPermitidos(ctx, input.vendedorId)

    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    const compraramNoSap = new Set(
      (await vendasExtras({ empresaId: ctx.empresaId, dataInicio: input.dataInicio, dataFim: input.dataFim })).map((v) => v.clienteId)
    )

    const linhas = await Promise.all(
      vendedores.map(async (v) => {
        const filtrosCarteira = [eq(clientes.vendedorAtualId, v.id), isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)]
        if (filtroReg) filtrosCarteira.push(filtroReg)
        const clientesDoVendedor = await db.query.clientes.findMany({
          where: and(...filtrosCarteira),
          columns: { id: true, dataUltimaCompra: true },
        })
        const { totalCarteira, ativados } = await agruparCarteiraVinculada(clientesDoVendedor, inicio, fim, compraramNoSap)

        // Total de contatos feitos pelo vendedor no período, quebrado por
        // canal (ligação x WhatsApp) — pedido do João pra ver ao lado da
        // positivação, não só a cobertura combinada dos dois canais.
        const filtrosContatos = [
          eq(registroContato.vendedorId, v.id),
          between(registroContato.dataHora, inicio, fim),
          isNull(registroContato.deletedAt),
        ]
        if (filtroReg) filtrosContatos.push(filtroReg)
        const [{ contatosLigacao, contatosWhatsapp }] = await db
          .select({
            contatosLigacao: sql<number>`sum(case when ${registroContato.tipo} = 'ligacao' then 1 else 0 end)`.mapWith(Number),
            contatosWhatsapp: sql<number>`sum(case when ${registroContato.tipo} = 'whatsapp' then 1 else 0 end)`.mapWith(Number),
          })
          .from(registroContato)
          .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
          .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
          .where(and(...filtrosContatos))

        return {
          vendedorId: v.id,
          nome: v.name,
          totalCarteira,
          ativados,
          contatosLigacao: contatosLigacao ?? 0,
          contatosWhatsapp: contatosWhatsapp ?? 0,
          percentual: totalCarteira > 0 ? Math.round((ativados / totalCarteira) * 1000) / 10 : 0,
        }
      })
    )
    return linhas.sort((a, b) => b.percentual - a.percentual)
  }),

  contatosPorCliente: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [
      between(registroContato.dataHora, inicio, fim),
      isNull(registroContato.deletedAt),
      eq(clientes.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, registroContato.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const linhas = await db
      .select({
        clienteId: funilMensal.clienteId,
        razaoSocial: clientes.razaoSocial,
        totalContatos: count(registroContato.id).mapWith(Number),
        totalLigacoes: sql<number>`sum(case when ${registroContato.tipo} = 'ligacao' then 1 else 0 end)`.mapWith(Number),
      })
      .from(registroContato)
      .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros))
      .groupBy(funilMensal.clienteId)
      .orderBy(desc(count(registroContato.id)))

    return linhas
  }),

  // "Vendedor tem 100 clientes, pra quantos ele teve contato no mês" — usa o
  // MESMO cálculo do widget do Kanban e do alerta (lib/coberturaContatos.ts):
  // denominador = carteira inteira; conta QUALQUER tipo de contato; CNPJ
  // vinculado do mesmo vendedor propaga. O mês vem da data de início do
  // filtro.
  contatosCoberturaPorVendedor: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const vendedores = await vendedoresPermitidos(ctx, input.vendedorId)
    const mesRef = `${input.dataInicio.slice(0, 7)}-01`

    const linhas = await Promise.all(
      vendedores.map(async (v) => {
        const c = await coberturaContatosVendedor(ctx.empresaId, v.id, mesRef, input.regiao)
        return {
          vendedorId: v.id,
          nome: v.name,
          totalCarteira: c.total,
          contatados: c.contatados,
          semContato: c.semContato,
          percentual: c.percentual,
        }
      }),
    )
    return linhas.sort((a, b) => b.percentual - a.percentual)
  }),

  // Tentativa = toda ligação registrada no período (manual ou automática via
  // GoTo). Efetiva = subconjunto que durou pelo menos o mínimo configurado
  // (GoTo) ou foi marcada como respondida manualmente — ver `efetiva` em
  // registro_contato. Agrupado por vendedor pra comparar quem liga muito mas
  // fala pouco (tentativas altas, % efetiva baixo) de quem liga menos mas
  // conversa de verdade.
  ligacoesEfetividade: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [
      eq(registroContato.tipo, 'ligacao' as const),
      between(registroContato.dataHora, inicio, fim),
      isNull(registroContato.deletedAt),
      eq(users.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, registroContato.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const linhas = await db
      .select({
        vendedorId: registroContato.vendedorId,
        nome: users.name,
        tentativas: count(registroContato.id).mapWith(Number),
        efetivas: sql<number>`sum(case when ${registroContato.efetiva} = 1 then 1 else 0 end)`.mapWith(Number),
      })
      .from(registroContato)
      .innerJoin(users, eq(users.id, registroContato.vendedorId))
      .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros))
      .groupBy(registroContato.vendedorId)
      .orderBy(desc(count(registroContato.id)))

    return linhas.map((l) => ({
      ...l,
      percentualEfetividade: l.tentativas > 0 ? Math.round((l.efetivas / l.tentativas) * 1000) / 10 : 0,
    }))
  }),

  // Mesma métrica de `ligacoesEfetividade`, mas agrupada por CLIENTE em vez
  // de vendedor — pra analisar quantas ligações cada cliente recebeu de
  // verdade no período, não só quem na equipe liga mais. "Pendentes" conta
  // ligações sem `resultado` confirmado ainda (a GoTo nunca sabe sozinha se
  // foi atendida ou caiu na caixa postal — só o vendedor confirmando decide
  // isso, ver `registrarLigacaoAutomatica` em goto.ts) — um número alto aqui
  // também é sinal de que ninguém está voltando pra confirmar as ligações.
  ligacoesPorCliente: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [
      eq(registroContato.tipo, 'ligacao' as const),
      between(registroContato.dataHora, inicio, fim),
      isNull(registroContato.deletedAt),
      eq(clientes.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, registroContato.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const linhas = await db
      .select({
        clienteId: funilMensal.clienteId,
        razaoSocial: clientes.razaoSocial,
        tentativas: count(registroContato.id).mapWith(Number),
        efetivas: sql<number>`sum(case when ${registroContato.efetiva} = 1 then 1 else 0 end)`.mapWith(Number),
        pendentes: sql<number>`sum(case when ${registroContato.resultado} is null then 1 else 0 end)`.mapWith(Number),
        duracaoMediaSegundos: sql<number>`avg(${registroContato.duracaoSegundos})`.mapWith(Number),
      })
      .from(registroContato)
      .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros))
      .groupBy(funilMensal.clienteId)
      .orderBy(desc(count(registroContato.id)))

    return linhas.map((l) => ({
      ...l,
      percentualEfetividade: l.tentativas > 0 ? Math.round((l.efetivas / l.tentativas) * 1000) / 10 : 0,
    }))
  }),

  vendas: protectedProcedure.input(periodoInput.extend({ apenasMarketing: z.boolean().optional() })).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [between(vendasTable.dataFechamento, inicio, fim), isNull(vendasTable.deletedAt), eq(users.empresaId, ctx.empresaId)]
    // Idem curvaAbc: filtra por funil_mensal.vendedorId (quem fechou o
    // negócio de verdade, sempre em dia), não por vendas.vendedorId (fica
    // preso ao vendedor de quando a venda foi criada, mesmo que o cliente
    // tenha sido transferido de carteira depois).
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, funilMensal.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)
    if (input.apenasMarketing) filtros.push(eq(clientes.origemMarketing, true))

    const [{ quantidade, valorTotal }] = await db
      .select({
        quantidade: count(),
        valorTotal: sum(vendasTable.valorFechado).mapWith(Number),
      })
      .from(vendasTable)
      .innerJoin(clientes, eq(clientes.id, vendasTable.clienteId))
      .innerJoin(funilMensal, eq(funilMensal.id, vendasTable.funilMensalId))
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .where(and(...filtros))

    const sap = await vendasExtras({
      empresaId: ctx.empresaId,
      dataInicio: input.dataInicio,
      dataFim: input.dataFim,
      ctx,
      vendedorId: input.vendedorId,
      regiao: input.regiao,
      apenasMarketing: input.apenasMarketing,
    })
    const quantidadeTotal = quantidade + sap.length
    const valorGeral = (valorTotal ?? 0) + sap.reduce((s, v) => s + v.valor, 0)
    // De onde veio cada venda — a tela mostra a divisão quando tem mais de
    // uma fonte (ex.: Odin = Carteira + Pedidos).
    const somaOrigem = (origem: 'sap' | 'pedidos') => {
      const l = sap.filter((v) => v.origem === origem)
      return { quantidade: l.length, valorTotal: l.reduce((s, v) => s + v.valor, 0) }
    }
    const porOrigem = [
      { origem: 'carteira' as const, quantidade, valorTotal: valorTotal ?? 0 },
      { origem: 'pedidos' as const, ...somaOrigem('pedidos') },
      { origem: 'sap' as const, ...somaOrigem('sap') },
    ]

    return {
      quantidade: quantidadeTotal,
      valorTotal: valorGeral,
      ticketMedio: quantidadeTotal > 0 ? valorGeral / quantidadeTotal : 0,
      porOrigem,
    }
  }),

  // Mesmo escopo de `vendas`, mas agrupado por dia + vendedor — o front
  // decide se soma tudo (visão "Geral da empresa") ou mantém separado
  // (visão "Por vendedor"), mesmo padrão de orcamentosPorPeriodo derivando
  // de orcamentosPorVendedor.
  vendasPorDia: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [between(vendasTable.dataFechamento, inicio, fim), isNull(vendasTable.deletedAt), eq(users.empresaId, ctx.empresaId)]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, funilMensal.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const linhas = await db
      .select({
        data: sql<string>`date(${vendasTable.dataFechamento})`,
        vendedorId: funilMensal.vendedorId,
        nome: users.name,
        valorFechado: vendasTable.valorFechado,
      })
      .from(vendasTable)
      .innerJoin(clientes, eq(clientes.id, vendasTable.clienteId))
      .innerJoin(funilMensal, eq(funilMensal.id, vendasTable.funilMensalId))
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .where(and(...filtros))

    const mapa = new Map<string, { data: string; vendedorId: number; nome: string; quantidade: number; valorTotal: number }>()
    for (const l of linhas) {
      const chave = `${l.data}|${l.vendedorId}`
      const atual = mapa.get(chave) ?? { data: l.data, vendedorId: l.vendedorId, nome: l.nome, quantidade: 0, valorTotal: 0 }
      atual.quantidade += 1
      atual.valorTotal += l.valorFechado
      mapa.set(chave, atual)
    }
    for (const v of await vendasExtras({ empresaId: ctx.empresaId, dataInicio: input.dataInicio, dataFim: input.dataFim, ctx, vendedorId: input.vendedorId, regiao: input.regiao })) {
      // Cliente sem vendedor hoje (Banco de Clientes) → vendedorId 0.
      const vendedorId = v.vendedorId ?? 0
      const chave = `${v.data}|${vendedorId}`
      const atual = mapa.get(chave) ?? { data: v.data, vendedorId, nome: v.vendedorNome ?? 'Sem vendedor', quantidade: 0, valorTotal: 0 }
      atual.quantidade += 1
      atual.valorTotal += v.valor
      mapa.set(chave, atual)
    }
    return [...mapa.values()].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.nome.localeCompare(b.nome)))
  }),

  // Contatos por dia, separados por tipo (ligação/whatsapp/email/visita) —
  // mesmo filtro de `contatosPorCliente`, só que agrupado por data em vez
  // de cliente.
  contatosPorDia: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [between(registroContato.dataHora, inicio, fim), isNull(registroContato.deletedAt), eq(clientes.empresaId, ctx.empresaId)]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, registroContato.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const linhas = await db
      .select({ data: sql<string>`date(${registroContato.dataHora})`, tipo: registroContato.tipo })
      .from(registroContato)
      .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros))

    const mapa = new Map<string, { data: string; ligacao: number; whatsapp: number; email: number; visita: number; total: number }>()
    for (const l of linhas) {
      const atual = mapa.get(l.data) ?? { data: l.data, ligacao: 0, whatsapp: 0, email: 0, visita: 0, total: 0 }
      atual[l.tipo as 'ligacao' | 'whatsapp' | 'email' | 'visita'] += 1
      atual.total += 1
      mapa.set(l.data, atual)
    }
    return [...mapa.values()].sort((a, b) => (a.data < b.data ? -1 : 1))
  }),

  // Ligações com todos os detalhes (uma linha por ligação, não agrupado) —
  // alimenta tanto o gráfico "por dia" (o front agrupa por data.slice(0,10))
  // quanto a exportação completa em Excel/CSV, mesmo filtro de
  // `ligacoesPorCliente`.
  ligacoesDetalhado: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [
      eq(registroContato.tipo, 'ligacao' as const),
      between(registroContato.dataHora, inicio, fim),
      isNull(registroContato.deletedAt),
      eq(clientes.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, registroContato.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    return db
      .select({
        id: registroContato.id,
        dataHora: registroContato.dataHora,
        vendedorNome: users.name,
        clienteId: funilMensal.clienteId,
        razaoSocial: clientes.razaoSocial,
        duracaoSegundos: registroContato.duracaoSegundos,
        resultado: registroContato.resultado,
        efetiva: registroContato.efetiva,
        origem: registroContato.origem,
        observacao: registroContato.observacao,
      })
      .from(registroContato)
      .innerJoin(users, eq(users.id, registroContato.vendedorId))
      .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros))
      .orderBy(desc(registroContato.dataHora))
  }),

  // Total de vendas somando as 3 empresas do Grupo Odin de uma vez —
  // separado do `vendas` normal (que é sempre escopado pra ctx.empresaId)
  // porque aqui não tem uma empresa ativa única, é uma visão consolidada.
  // Só o superAdmin (o João) enxerga isso, igual o resto do Painel
  // Financeiro.
  vendasTodasEmpresas: superAdminProcedure
    .input(z.object({ dataInicio: z.string(), dataFim: z.string() }))
    .query(async ({ input }) => {
      const { inicio, fim } = limitesDia(input)

      const linhas = await db
        .select({
          empresaId: clientes.empresaId,
          quantidade: count(),
          valorTotal: sum(vendasTable.valorFechado).mapWith(Number),
        })
        .from(vendasTable)
        .innerJoin(clientes, eq(clientes.id, vendasTable.clienteId))
        .where(and(between(vendasTable.dataFechamento, inicio, fim), isNull(vendasTable.deletedAt)))
        .groupBy(clientes.empresaId)

      const todasEmpresas = await db.query.empresas.findMany({ columns: { id: true, nome: true } })
      const porEmpresaId = new Map(linhas.map((l) => [l.empresaId, { quantidade: l.quantidade, valorTotal: l.valorTotal ?? 0 }]))
      for (const v of await vendasExtras({ dataInicio: input.dataInicio, dataFim: input.dataFim })) {
        const atual = porEmpresaId.get(v.empresaId) ?? { quantidade: 0, valorTotal: 0 }
        atual.quantidade += 1
        atual.valorTotal += v.valor
        porEmpresaId.set(v.empresaId, atual)
      }

      const porEmpresa = todasEmpresas
        .map((e) => ({
          empresaId: e.id,
          nome: e.nome,
          quantidade: porEmpresaId.get(e.id)?.quantidade ?? 0,
          valorTotal: porEmpresaId.get(e.id)?.valorTotal ?? 0,
        }))
        .sort((a, b) => b.valorTotal - a.valorTotal)

      const quantidadeGeral = porEmpresa.reduce((soma, e) => soma + e.quantidade, 0)
      const valorTotalGeral = porEmpresa.reduce((soma, e) => soma + e.valorTotal, 0)

      return {
        porEmpresa,
        quantidadeGeral,
        valorTotalGeral,
        ticketMedioGeral: quantidadeGeral > 0 ? valorTotalGeral / quantidadeGeral : 0,
      }
    }),

  // "Quantos clientes da carteira ainda faltam ser chamados" — mesma
  // definição de contato de `contatosCoberturaPorVendedor` (ligação ou
  // WhatsApp, não conta e-mail/visita), só que somando as empresas todas de
  // uma vez em vez de por vendedor de uma empresa só — pro João bater o
  // olho no card "Todas as Empresas" sem entrar empresa por empresa.
  contatoCoberturaTodasEmpresas: superAdminProcedure
    .input(z.object({ dataInicio: z.string(), dataFim: z.string() }))
    .query(async ({ input }) => {
      const { inicio, fim } = limitesDia(input)
      const todasEmpresas = await db.query.empresas.findMany({ columns: { id: true, nome: true } })

      const porEmpresa = await Promise.all(
        todasEmpresas.map(async (e) => {
          const [{ totalCarteira }] = await db
            .select({ totalCarteira: count() })
            .from(clientes)
            .where(and(eq(clientes.empresaId, e.id), isNull(clientes.deletedAt), isNotNull(clientes.vendedorAtualId)))

          const [{ contatados }] = await db
            .select({ contatados: sql<number>`count(distinct ${funilMensal.clienteId})`.mapWith(Number) })
            .from(registroContato)
            .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
            .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
            .where(
              and(
                eq(clientes.empresaId, e.id),
                sql`${registroContato.tipo} in ('whatsapp', 'ligacao')`,
                between(registroContato.dataHora, inicio, fim),
                isNull(registroContato.deletedAt)
              )
            )

          return {
            empresaId: e.id,
            nome: e.nome,
            totalCarteira,
            contatados,
            semContato: totalCarteira - contatados,
            percentual: totalCarteira > 0 ? Math.round((contatados / totalCarteira) * 1000) / 10 : 0,
          }
        })
      )

      const comCarteira = porEmpresa.filter((e) => e.totalCarteira > 0).sort((a, b) => b.semContato - a.semContato)
      const totalCarteiraGeral = porEmpresa.reduce((soma, e) => soma + e.totalCarteira, 0)
      const contatadosGeral = porEmpresa.reduce((soma, e) => soma + e.contatados, 0)

      return {
        porEmpresa: comCarteira,
        totalCarteiraGeral,
        contatadosGeral,
        semContatoGeral: totalCarteiraGeral - contatadosGeral,
        percentualGeral: totalCarteiraGeral > 0 ? Math.round((contatadosGeral / totalCarteiraGeral) * 1000) / 10 : 0,
      }
    }),

  // Pedido do João, 2026-09-11: mesmo tratamento (vendedor, filtro mínimo de
  // dias, "nunca" contado) que `clientesSemOrcamentoDias`/`clientesSemVendaDias`
  // — os 3 formam o mesmo bloco "alertas" com número grande na tela.
  diasSemContato: protectedProcedure
    .input(filtroAtualInput.extend({ minimoDias: z.number().min(1).default(30) }))
    .query(async ({ ctx, input }) => {
      // isNotNull(vendedorAtualId): mesmo motivo de clientesSemOrcamentoDias/
      // clientesSemVendaDias — sem isso o Banco de Clientes (sem vendedor,
      // sem card de funil) entrava inteiro como "nunca contatado".
      const filtros = [
        isNull(clientes.deletedAt),
        eq(clientes.empresaId, ctx.empresaId),
        eq(clientes.emProspeccao, false),
        isNotNull(clientes.vendedorAtualId),
      ]
      const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, clientes.vendedorAtualId)
      if (filtroVend) filtros.push(filtroVend)
      const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
      if (filtroReg) filtros.push(filtroReg)

      const lista = await db.query.clientes.findMany({
        where: and(...filtros),
        columns: { id: true, razaoSocial: true, codigo: true, vendedorAtualId: true, createdAt: true },
        with: {
          vendedorAtual: { columns: { name: true } },
          funis: {
            where: isNull(funilMensal.deletedAt),
            orderBy: (f, { desc }) => [desc(f.mesReferencia)],
            limit: 1,
            columns: { dataUltimoContato: true, dataEntradaEtapa: true },
          },
        },
      })

      const desde = await naCarteiraDesde(lista.map((c) => ({ clienteId: c.id, vendedorId: c.vendedorAtualId, cadastradoEm: c.createdAt })))
      const itens = lista
        .map((c) => {
          const ultimoFunil = c.funis[0]
          const dias = ultimoFunil ? diasDesde(ultimoFunil.dataUltimoContato ?? ultimoFunil.dataEntradaEtapa) : null
          return { clienteId: c.id, razaoSocial: c.razaoSocial, codigo: c.codigo, vendedorNome: c.vendedorAtual?.name ?? '—', dias, naCarteiraDesde: desde.get(c.id) ?? null }
        })
        .filter((c) => c.dias === null || c.dias >= input.minimoDias)
        .sort((a, b) => (b.dias ?? Infinity) - (a.dias ?? Infinity))
      return { totalCarteira: lista.length, itens }
    }),

  itensMaisComprados: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [
      between(itensPedido.createdAt, inicio, fim),
      isNull(itensPedido.deletedAt),
      eq(clientes.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, clientes.vendedorAtualId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    return db
      .select({
        descricao: itensPedido.descricao,
        quantidadeTotal: sum(itensPedido.quantidade).mapWith(Number),
        valorTotal: sum(itensPedido.valorTotal).mapWith(Number),
      })
      .from(itensPedido)
      .innerJoin(clientes, eq(clientes.id, itensPedido.clienteId))
      .where(and(...filtros))
      .groupBy(itensPedido.descricao)
      .orderBy(desc(sql`sum(${itensPedido.quantidade})`))
      .limit(50)
  }),

  // "Vendedor com 100 clientes, qual a quantidade média de itens que ele
  // vende por cliente" — mix de produtos por vendedor. Denominador é o
  // cliente que efetivamente COMPROU no período (não a carteira inteira de
  // 100 — dividir pela carteira toda afundaria o número pra quase zero e
  // não diria nada sobre o tamanho real da cesta de compra).
  mixProdutosPorVendedor: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [between(vendasTable.dataFechamento, inicio, fim), isNull(vendasTable.deletedAt), eq(users.empresaId, ctx.empresaId)]
    // Filtra e agrupa por funil_mensal.vendedorId, não vendas.vendedorId —
    // esse último é gravado uma vez no fechamento e fica desatualizado se o
    // cliente for transferido de carteira depois (ver curvaAbc/vendas acima).
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, funilMensal.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const linhas = await db
      .select({
        vendedorId: funilMensal.vendedorId,
        nome: users.name,
        clientesComVenda: sql<number>`count(distinct ${vendasTable.clienteId})`.mapWith(Number),
        totalLinhasItem: sql<number>`count(${itensPedido.id})`.mapWith(Number),
        totalQuantidade: sql<number>`coalesce(sum(${itensPedido.quantidade}), 0)`.mapWith(Number),
      })
      .from(vendasTable)
      .innerJoin(funilMensal, eq(funilMensal.id, vendasTable.funilMensalId))
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .innerJoin(clientes, eq(clientes.id, vendasTable.clienteId))
      .leftJoin(itensPedido, and(eq(itensPedido.vendaId, vendasTable.id), isNull(itensPedido.deletedAt)))
      .where(and(...filtros))
      .groupBy(funilMensal.vendedorId)

    return linhas.map((l) => ({
      ...l,
      mediaItensPorCliente: l.clientesComVenda > 0 ? Math.round((l.totalLinhasItem / l.clientesComVenda) * 10) / 10 : 0,
      mediaQuantidadePorCliente: l.clientesComVenda > 0 ? Math.round((l.totalQuantidade / l.clientesComVenda) * 10) / 10 : 0,
    }))
  }),

  // Orçamentos/propostas em aberto — negócios em "negociação" no mês
  // corrente, com o valor orçado que o vendedor lançou no Kanban. Não é um
  // relatório de período (é uma foto do que está em aberto agora), por isso
  // o input é só o filtro de vendedor, igual `diasSemContato`.
  orcamentosAbertos: protectedProcedure.input(filtroAtualInput).query(async ({ ctx, input }) => {
    const filtros = [
      eq(funilMensal.etapa, 'negociacao'),
      eq(funilMensal.mesReferencia, mesReferenciaAtual()),
      isNull(funilMensal.deletedAt),
      eq(users.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, funilMensal.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const linhas = await db
      .select({
        clienteId: funilMensal.clienteId,
        razaoSocial: clientes.razaoSocial,
        vendedorNome: users.name,
        valorOrcado: funilMensal.valorOrcado,
        dataEntradaEtapa: funilMensal.dataEntradaEtapa,
        carregado: funilMensal.carregadoMesAnterior,
      })
      .from(funilMensal)
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .where(and(...filtros))
      .orderBy(desc(funilMensal.valorOrcado))

    // Card que passou de um mês pro outro ainda em Negociação (resetMensal)
    // nasce com dataEntradaEtapa = dia 1º — o orçamento parecia "novo" todo
    // mês (achado do João, 2026-10-20). Volta mês a mês enquanto o cliente
    // tinha card em Negociação e usa a data de entrada do primeiro.
    const idsCarregados = [...new Set(linhas.filter((l) => l.carregado).map((l) => l.clienteId))]
    const entradaReal = new Map<number, string>()
    if (idsCarregados.length) {
      const mesAnterior = (mes: string) => {
        const [a, m] = mes.split('-').map(Number)
        return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`
      }
      const historico = new Map<number, Map<string, { data: string; carregado: boolean }>>()
      for (let i = 0; i < idsCarregados.length; i += 900) {
        const cards = await db
          .select({ clienteId: funilMensal.clienteId, mes: funilMensal.mesReferencia, data: funilMensal.dataEntradaEtapa, carregado: funilMensal.carregadoMesAnterior })
          .from(funilMensal)
          .where(and(inArray(funilMensal.clienteId, idsCarregados.slice(i, i + 900)), eq(funilMensal.etapa, 'negociacao'), isNull(funilMensal.deletedAt)))
        for (const c of cards) {
          const porMes = historico.get(c.clienteId) ?? new Map()
          const atual = porMes.get(c.mes)
          if (!atual || c.data < atual.data) porMes.set(c.mes, { data: c.data, carregado: !!c.carregado })
          historico.set(c.clienteId, porMes)
        }
      }
      for (const clienteId of idsCarregados) {
        const porMes = historico.get(clienteId)
        let mes = mesReferenciaAtual()
        let card = porMes?.get(mes)
        while (card?.carregado && porMes?.get(mesAnterior(mes))) {
          mes = mesAnterior(mes)
          card = porMes.get(mes)
        }
        if (card) entradaReal.set(clienteId, card.data)
      }
    }

    // Dias parado em negociação desde que entrou na etapa — pedido do João
    // pra enxergar quais orçamentos estão esfriando, não só o valor.
    const linhasComDias = linhas.map(({ carregado, ...l }) => {
      const desde = (carregado && entradaReal.get(l.clienteId)) || l.dataEntradaEtapa
      return { ...l, dataEntradaEtapa: desde, diasEmAberto: diasDesde(desde) }
    })

    const valorTotal = linhas.reduce((acc, l) => acc + (l.valorOrcado ?? 0), 0)
    return { linhas: linhasComDias, quantidade: linhas.length, valorTotal }
  }),

  motivosPerdas: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [
      eq(funilMensal.etapa, 'perdido'),
      between(funilMensal.dataEntradaEtapa, inicio, fim),
      isNull(funilMensal.deletedAt),
      eq(users.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, funilMensal.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const porCategoria = await db
      .select({ categoria: funilMensal.motivoPerdaCategoria, quantidade: count() })
      .from(funilMensal)
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros))
      .groupBy(funilMensal.motivoPerdaCategoria)
      .orderBy(desc(count()))

    const porItem = await db
      .select({ item: funilMensal.motivoPerdaItem, quantidade: count() })
      .from(funilMensal)
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros, sql`${funilMensal.motivoPerdaItem} is not null`))
      .groupBy(funilMensal.motivoPerdaItem)
      .orderBy(desc(count()))

    // Lista individual (cliente + motivo por extenso) — os cards acima só
    // contam quantidade por categoria/item, nunca mostravam o texto que o
    // vendedor escreveu de verdade. Pedido do João: "não está puxando os
    // motivos nos relatórios" — isso aqui é o motivo em si, não só a contagem.
    const detalhes = await db
      .select({
        clienteId: funilMensal.clienteId,
        razaoSocial: clientes.razaoSocial,
        vendedorNome: users.name,
        dataEntradaEtapa: funilMensal.dataEntradaEtapa,
        valorOrcado: funilMensal.valorOrcado,
        motivoPerdaCategoria: funilMensal.motivoPerdaCategoria,
        motivoPerdaOpcao: funilMensal.motivoPerdaOpcao,
        motivoPerdaItem: funilMensal.motivoPerdaItem,
        motivoPerdaObservacao: funilMensal.motivoPerdaObservacao,
      })
      .from(funilMensal)
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros))
      .orderBy(desc(funilMensal.dataEntradaEtapa))

    return { porCategoria, porItem, detalhes }
  }),

  // Clientes completamente esquecidos no mês corrente: zero contato
  // registrado (qtdTentativasContato do funil do mês, já mantido por
  // contatos.ts/goto.ts) E sem nenhum orçamento lançado (valorOrcado nulo).
  // Não é relatório de período (foto do mês corrente, igual
  // `orcamentosAbertos`) — o vendedor pode ter tentado ontem, mas se não
  // tem nem contato nem orçamento neste mês, ainda está "intocado".
  clientesSemOrcamentoEContato: protectedProcedure
    .input(filtroAtualInput)
    .query(async ({ ctx, input }) => {
      const filtros = [eq(funilMensal.mesReferencia, mesReferenciaAtual()), isNull(funilMensal.deletedAt), eq(clientes.empresaId, ctx.empresaId)]
      const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, funilMensal.vendedorId)
      if (filtroVend) filtros.push(filtroVend)
      const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
      if (filtroReg) filtros.push(filtroReg)

      const funis = await db
        .select({
          clienteId: funilMensal.clienteId,
          razaoSocial: clientes.razaoSocial,
          cadastradoEm: clientes.createdAt,
          vendedorId: funilMensal.vendedorId,
          vendedorNome: users.name,
          valorOrcado: funilMensal.valorOrcado,
          qtdTentativasContato: funilMensal.qtdTentativasContato,
          etapa: funilMensal.etapa,
        })
        .from(funilMensal)
        .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
        .innerJoin(users, eq(users.id, funilMensal.vendedorId))
        .where(and(...filtros))

      const intocados = funis.filter((f) => f.valorOrcado === null && f.qtdTentativasContato === 0)
      const desde = await naCarteiraDesde(intocados)
      return intocados.map((f) => ({ clienteId: f.clienteId, razaoSocial: f.razaoSocial, vendedorNome: f.vendedorNome, etapa: f.etapa, naCarteiraDesde: desde.get(f.clienteId) ?? null }))
    }),

  // "Cliente há 30/60 dias sem orçamento" — pedido do João, 2026-09-11.
  // Diferente do `clientesSemOrcamentoEContato` acima (foto só do mês
  // corrente): esse olha a CARTEIRA inteira e, pra cada cliente, procura o
  // orçamento MAIS RECENTE em QUALQUER card dele (mês corrente ou passado)
  // — cliente que orçou em julho e não teve card em agosto/setembro ainda
  // aparece aqui como "62 dias sem orçamento", não some do relatório.
  //
  // Approximação conhecida: `valorOrcado` não tem timestamp próprio no
  // schema (só é gravado dentro de `funil.moverEtapa`, junto de
  // `dataEntradaEtapa`) — usamos `dataEntradaEtapa` do card como "quando",
  // mesma aproximação que `orcamentosAbertos.diasEmAberto` já usa. Na
  // prática funciona bem porque valorOrcado só muda através de uma
  // transição de etapa; o caso raro que engana é mover o card de etapa de
  // novo bem mais tarde reenviando o MESMO valor orçado sem alterar — aí a
  // data "atualiza" mesmo sem ter refeito o orçamento de verdade.
  clientesSemOrcamentoDias: protectedProcedure
    .input(filtroAtualInput.extend({ minimoDias: z.number().min(1).default(30) }))
    .query(async ({ ctx, input }) => {
      // `isNotNull(vendedorAtualId)` é o que faz esse relatório ser "carteira
      // de vendedor" e não "todo cadastro de cliente" — sem isso, o Banco de
      // Clientes (que nem tem vendedor, então nem card de funil) entrava
      // inteiro como "nunca orçou/vendeu/contatou", inflando a contagem pra
      // milhares (achado do João, 2026-09-12: relatório mostrando 17890).
      const filtrosCliente = [
        eq(clientes.empresaId, ctx.empresaId),
        eq(clientes.emProspeccao, false),
        isNull(clientes.deletedAt),
        isNotNull(clientes.vendedorAtualId),
      ]
      const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, clientes.vendedorAtualId)
      if (filtroVend) filtrosCliente.push(filtroVend)
      const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
      if (filtroReg) filtrosCliente.push(filtroReg)

      const carteira = await db.query.clientes.findMany({
        where: and(...filtrosCliente),
        columns: { id: true, razaoSocial: true, codigo: true, vendedorAtualId: true, createdAt: true },
        with: { vendedorAtual: { columns: { name: true } } },
      })
      // `totalCarteira` (o denominador) vai junto na resposta — pedido do
      // João, 2026-09-12: o número grande sozinho ("176") não dizia nada
      // sem saber de quantos clientes no total; o card mostra "176 de
      // 3.248" com o total num tamanho menor, dando o contexto.
      if (!carteira.length) return { totalCarteira: 0, itens: [] }

      const ids = carteira.map((c) => c.id)
      const ultimosOrcamentos = await db
        .select({ clienteId: funilMensal.clienteId, ultimo: sql<string>`max(${funilMensal.dataEntradaEtapa})` })
        .from(funilMensal)
        .where(and(inArray(funilMensal.clienteId, ids), isNotNull(funilMensal.valorOrcado), isNull(funilMensal.deletedAt)))
        .groupBy(funilMensal.clienteId)
      const ultimoPorCliente = new Map(ultimosOrcamentos.map((l) => [l.clienteId, l.ultimo]))
      // Cotações do SAP (lotes ligados) também contam como orçamento — vale
      // a mais recente entre CRM e SAP (pedido do João, 2026-10-20).
      for (let i = 0; i < ids.length; i += 900) {
        const sapRows = await db
          .select({ clienteId: sapCotacoesHistorico.clienteId, ultima: sql<string>`max(${sapCotacoesHistorico.dataCotacao})` })
          .from(sapCotacoesHistorico)
          .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapCotacoesHistorico.importacaoId))
          .where(and(inArray(sapCotacoesHistorico.clienteId, ids.slice(i, i + 900)), eq(sapImportacoes.ativo, true)))
          .groupBy(sapCotacoesHistorico.clienteId)
        for (const r of sapRows) {
          const data = dataSapComoDatetime(r.ultima)
          const atual = ultimoPorCliente.get(r.clienteId)
          if (!atual || data > atual) ultimoPorCliente.set(r.clienteId, data)
        }
      }

      const desde = await naCarteiraDesde(carteira.map((c) => ({ clienteId: c.id, vendedorId: c.vendedorAtualId, cadastradoEm: c.createdAt })))
      const itens = carteira
        .map((c) => {
          const ultimoOrcamentoEm = ultimoPorCliente.get(c.id) ?? null
          return {
            clienteId: c.id,
            razaoSocial: c.razaoSocial,
            codigo: c.codigo,
            vendedorNome: c.vendedorAtual?.name ?? '—',
            ultimoOrcamentoEm,
            // null = nunca teve orçamento nenhum registrado.
            diasSemOrcamento: diasDesde(ultimoOrcamentoEm),
            naCarteiraDesde: desde.get(c.id) ?? null,
          }
        })
        .filter((c) => c.diasSemOrcamento === null || c.diasSemOrcamento >= input.minimoDias)
        .sort((a, b) => (b.diasSemOrcamento ?? Infinity) - (a.diasSemOrcamento ?? Infinity))
      return { totalCarteira: carteira.length, itens }
    }),

  // "Cliente há 30/60 dias sem venda" — mesma ideia de `clientesSemOrcamentoDias`,
  // só que em cima de `clientes.dataUltimaCompra` (gravado direto em
  // funil.ts/vendas.ts toda vez que uma venda fecha) — não precisa varrer
  // funilMensal, é uma data já pronta e precisa por cliente.
  clientesSemVendaDias: protectedProcedure
    .input(filtroAtualInput.extend({ minimoDias: z.number().min(1).default(30) }))
    .query(async ({ ctx, input }) => {
      // `isNotNull(vendedorAtualId)` é o que faz esse relatório ser "carteira
      // de vendedor" e não "todo cadastro de cliente" — sem isso, o Banco de
      // Clientes (que nem tem vendedor, então nem card de funil) entrava
      // inteiro como "nunca orçou/vendeu/contatou", inflando a contagem pra
      // milhares (achado do João, 2026-09-12: relatório mostrando 17890).
      const filtrosCliente = [
        eq(clientes.empresaId, ctx.empresaId),
        eq(clientes.emProspeccao, false),
        isNull(clientes.deletedAt),
        isNotNull(clientes.vendedorAtualId),
      ]
      const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, clientes.vendedorAtualId)
      if (filtroVend) filtrosCliente.push(filtroVend)
      const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
      if (filtroReg) filtrosCliente.push(filtroReg)

      const carteira = await db.query.clientes.findMany({
        where: and(...filtrosCliente),
        columns: { id: true, razaoSocial: true, codigo: true, dataUltimaCompra: true, vendedorAtualId: true, createdAt: true },
        with: { vendedorAtual: { columns: { name: true } } },
      })

      // Último pedido no SAP (lotes ligados) — vale o mais recente entre CRM
      // e SAP.
      const ultimaSap = new Map<number, string>()
      const ultimaPedido = new Map<number, string>()
      const sapRows = await db
        .select({ clienteId: sapVendasHistorico.clienteId, ultima: sql<string>`max(${sapVendasHistorico.dataPedido})` })
        .from(sapVendasHistorico)
        .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapVendasHistorico.importacaoId))
        .where(and(eq(sapVendasHistorico.empresaId, ctx.empresaId), eq(sapImportacoes.ativo, true)))
        .groupBy(sapVendasHistorico.clienteId)
      for (const r of sapRows) ultimaSap.set(r.clienteId, dataSapComoDatetime(r.ultima))
      // Pedidos da Odin entram junto (mesma coluna "SAP/fora da Carteira").
      const idsCarteira = carteira.map((c) => c.id)
      for (let i = 0; i < idsCarteira.length; i += 900) {
        for (const r of await pedidosPorCliente(idsCarteira.slice(i, i + 900))) {
          const data = dataSapComoDatetime(r.data)
          if (!ultimaPedido.has(r.clienteId) || data > ultimaPedido.get(r.clienteId)!) ultimaPedido.set(r.clienteId, data)
        }
      }

      const desde = await naCarteiraDesde(carteira.map((c) => ({ clienteId: c.id, vendedorId: c.vendedorAtualId, cadastradoEm: c.createdAt })))
      const itens = carteira
        .map((c) => {
          const sap = ultimaSap.get(c.id) ?? null
          const pedido = ultimaPedido.get(c.id) ?? null
          const ultima = [c.dataUltimaCompra, sap, pedido].filter((d): d is string => !!d).sort().pop() ?? null
          return {
            clienteId: c.id,
            razaoSocial: c.razaoSocial,
            codigo: c.codigo,
            vendedorNome: c.vendedorAtual?.name ?? '—',
            ultimaCompraEm: ultima,
            origemUltimaCompra: ultima == null ? null : ultima === sap ? ('sap' as const) : ultima === pedido ? ('pedido' as const) : ('crm' as const),
            // null = nunca comprou.
            diasSemVenda: diasDesde(ultima),
            naCarteiraDesde: desde.get(c.id) ?? null,
          }
        })
        .filter((c) => c.diasSemVenda === null || c.diasSemVenda >= input.minimoDias)
        .sort((a, b) => (b.diasSemVenda ?? Infinity) - (a.diasSemVenda ?? Infinity))
      return { totalCarteira: carteira.length, itens }
    }),

  // Atividade da carteira — pedido do João, 2026-10-20 (referência: tela de
  // "carteira categorizada pela data da última venda"). Cada cliente da
  // carteira de vendedor cai em UMA categoria, olhando a posição no fim do
  // período (dataFim):
  //   novo        → primeira compra da vida dentro do período
  //   recuperado  → comprou no período depois de mais de 180 dias parado
  //   ativo       → última compra até 90 dias antes do fim do período
  //   quase_inativo → última compra entre 91 e 180 dias
  //   inativo     → última compra há mais de 180 dias
  //   nunca       → nunca comprou
  // Compras = vendas do CRM + histórico do SAP (lotes ligados) + Pedidos da
  // Odin (ver pedidosOdin) + clientes.dataUltimaCompra (pode vir de importação, sem venda lançada).
  // Por CNPJ (não junta clientes vinculados, ao contrário da positivação).
  atividadeCarteira: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtrosCliente = [
      eq(clientes.empresaId, ctx.empresaId),
      eq(clientes.emProspeccao, false),
      isNull(clientes.deletedAt),
      isNotNull(clientes.vendedorAtualId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, clientes.vendedorAtualId)
    if (filtroVend) filtrosCliente.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtrosCliente.push(filtroReg)

    // Só carteira de vendedor ATIVO (igual positivacaoCarteira).
    const ativos = new Map((await vendedoresPermitidos(ctx, input.vendedorId)).map((v) => [v.id, v.name]))
    const carteira = (
      await db.query.clientes.findMany({
        where: and(...filtrosCliente),
        columns: { id: true, razaoSocial: true, codigo: true, cidade: true, estado: true, vendedorAtualId: true, dataUltimaCompra: true },
      })
    ).filter((c) => c.vendedorAtualId && ativos.has(c.vendedorAtualId))
    if (!carteira.length) return { dataPosicao: input.dataFim, clientes: [] }

    const ids = carteira.map((c) => c.id)
    const compras = new Map<number, { data: string; valor: number }[]>()
    const add = (id: number, data: string, valor: number) => {
      const l = compras.get(id) ?? []
      l.push({ data, valor })
      compras.set(id, l)
    }
    // Lotes de 900 ids — limite de variáveis do SQLite.
    for (let i = 0; i < ids.length; i += 900) {
      const lote = ids.slice(i, i + 900)
      const crm = await db
        .select({ clienteId: vendasTable.clienteId, data: vendasTable.dataFechamento, valor: vendasTable.valorFechado })
        .from(vendasTable)
        .where(and(inArray(vendasTable.clienteId, lote), isNull(vendasTable.deletedAt)))
      for (const v of crm) if (v.data) add(v.clienteId, v.data, v.valor ?? 0)
      const sap = await db
        .select({ clienteId: sapVendasHistorico.clienteId, data: sapVendasHistorico.dataPedido, valor: sapVendasHistorico.valor })
        .from(sapVendasHistorico)
        .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapVendasHistorico.importacaoId))
        .where(and(inArray(sapVendasHistorico.clienteId, lote), eq(sapImportacoes.ativo, true)))
      for (const v of sap) add(v.clienteId, dataSapComoDatetime(v.data), v.valor ?? 0)
      for (const v of await pedidosPorCliente(lote)) add(v.clienteId, dataSapComoDatetime(v.data), v.valor)
    }

    const DIA = 86400000
    const fimMs = new Date(`${input.dataFim}T23:59:59Z`).getTime()
    const diasAte = (data: string) => Math.max(0, Math.floor((fimMs - new Date(data.replace(' ', 'T') + 'Z').getTime()) / DIA))

    const linhas = carteira.map((c) => {
      // Só o que aconteceu até o fim do período conta pra "posição".
      const lista = (compras.get(c.id) ?? []).filter((x) => x.data <= fim).sort((a, b) => (a.data < b.data ? -1 : 1))
      const datas = lista.map((x) => x.data)
      if (c.dataUltimaCompra && c.dataUltimaCompra <= fim && !datas.includes(c.dataUltimaCompra)) {
        datas.push(c.dataUltimaCompra)
        datas.sort()
      }
      const noPeriodo = lista.filter((x) => x.data >= inicio)
      const ultima = datas[datas.length - 1] ?? null
      const primeira = datas[0] ?? null
      const comprouNoPeriodo = datas.some((d) => d >= inicio)
      // Compra anterior à primeira do período — define "recuperado".
      const anteriorAoPeriodo = [...datas].reverse().find((d) => d < inicio) ?? null
      const primeiraNoPeriodo = datas.find((d) => d >= inicio) ?? null
      let categoria: 'novo' | 'recuperado' | 'ativo' | 'quase_inativo' | 'inativo' | 'nunca'
      if (!ultima) categoria = 'nunca'
      else if (comprouNoPeriodo && primeira && primeira >= inicio) categoria = 'novo'
      else if (comprouNoPeriodo && anteriorAoPeriodo && primeiraNoPeriodo && diasEntre(anteriorAoPeriodo, primeiraNoPeriodo) > 180) categoria = 'recuperado'
      else {
        const d = diasAte(ultima)
        categoria = d <= 90 ? 'ativo' : d <= 180 ? 'quase_inativo' : 'inativo'
      }
      return {
        clienteId: c.id,
        razaoSocial: c.razaoSocial,
        codigo: c.codigo,
        cidade: c.cidade,
        estado: c.estado,
        vendedorId: c.vendedorAtualId!,
        vendedorNome: ativos.get(c.vendedorAtualId!) ?? '—',
        categoria,
        primeiraCompra: primeira,
        ultimaCompra: ultima,
        diasSemComprar: ultima ? diasAte(ultima) : null,
        comprasNoPeriodo: noPeriodo.length,
        valorNoPeriodo: noPeriodo.reduce((s, x) => s + x.valor, 0),
        comprasTotal: lista.length,
        valorTotal: lista.reduce((s, x) => s + x.valor, 0),
      }
    })
    return { dataPosicao: input.dataFim, clientes: linhas }

    function diasEntre(a: string, b: string) {
      return Math.floor((new Date(b.replace(' ', 'T') + 'Z').getTime() - new Date(a.replace(' ', 'T') + 'Z').getTime()) / DIA)
    }
  }),

  // "Quantos orçamentos cada vendedor faz, por dia/semana/mês" — usa
  // log_auditoria (não funilMensal.dataEntradaEtapa, que é sobrescrita toda
  // vez que a etapa do card é resalva, mesmo sem mudar) porque só o log de
  // auditoria registra um EVENTO por vez que um card entrou de fato em
  // "negociação" (registrarAuditoria só grava quando etapa muda de verdade,
  // ver funil.ts). Bucket de dia/mês/semana calculado aqui (não em SQL) pra
  // não depender de função de data específica do SQLite pra "segunda-feira
  // da semana", que não existe pronta.
  // Lista de orçamentos FEITOS no período (pedido do João, 2026-10-20: a
  // tabela "Em aberto" é foto de hoje e não segue as datas). Mesma régua de
  // `orcamentosPorVendedor`: cada vez que um card entrou em Negociação no
  // período (log_auditoria) + cotações do SAP (lotes ligados, vendedor atual
  // do cliente). Situação = etapa ATUAL do card / status do SAP.
  orcamentosNoPeriodo: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const vendedores = await vendedoresPermitidos(ctx, input.vendedorId)
    const idsPermitidos = vendedores.map((v) => v.id)
    if (!idsPermitidos.length) return []
    const nomePorVendedor = new Map(vendedores.map((v) => [v.id, v.name]))
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)

    const filtrosEventos = [
      eq(logAuditoria.tabela, 'funil_mensal'),
      eq(logAuditoria.acao, 'mudar_etapa'),
      eq(logAuditoria.campo, 'etapa'),
      eq(logAuditoria.valorNovo, 'negociacao'),
      between(logAuditoria.alteradoEm, inicio, fim),
      inArray(logAuditoria.alteradoPor, idsPermitidos),
    ]
    if (filtroReg) filtrosEventos.push(filtroReg)
    const eventos = await db
      .select({
        id: logAuditoria.id,
        vendedorId: logAuditoria.alteradoPor,
        alteradoEm: logAuditoria.alteradoEm,
        clienteId: clientes.id,
        razaoSocial: clientes.razaoSocial,
        valor: funilMensal.valorOrcado,
        etapa: funilMensal.etapa,
      })
      .from(logAuditoria)
      .innerJoin(funilMensal, eq(funilMensal.id, logAuditoria.registroId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtrosEventos))

    type Situacao = 'aberto' | 'fechado' | 'perdido' | 'outro'
    type Linha = { chave: string; origem: 'crm' | 'sap'; data: string; numero: string | null; clienteId: number; razaoSocial: string; vendedorNome: string; valor: number; situacao: Situacao }
    const situacaoCrm = (etapa: string): Situacao =>
      etapa === 'negociacao' ? 'aberto' : etapa === 'fechado' || etapa === 'faturamento' ? 'fechado' : etapa === 'perdido' ? 'perdido' : 'outro'
    const linhas: Linha[] = eventos.map((e) => ({
      chave: `crm-${e.id}`,
      origem: 'crm',
      data: toLocalDateKey(toUtcISO(e.alteradoEm)),
      numero: null,
      clienteId: e.clienteId,
      razaoSocial: e.razaoSocial,
      vendedorNome: (e.vendedorId && nomePorVendedor.get(e.vendedorId)) || '—',
      valor: e.valor ?? 0,
      situacao: situacaoCrm(e.etapa),
    }))

    const filtrosSap = [
      eq(sapImportacoes.ativo, true),
      eq(sapCotacoesHistorico.empresaId, ctx.empresaId),
      between(sapCotacoesHistorico.dataCotacao, input.dataInicio.slice(0, 10), input.dataFim.slice(0, 10)),
      isNull(clientes.deletedAt),
      inArray(clientes.vendedorAtualId, idsPermitidos),
    ]
    if (filtroReg) filtrosSap.push(filtroReg)
    const sap = await db
      .select({
        id: sapCotacoesHistorico.id,
        data: sapCotacoesHistorico.dataCotacao,
        numero: sapCotacoesHistorico.numeroCotacao,
        valor: sapCotacoesHistorico.valor,
        status: sapCotacoesHistorico.status,
        clienteId: clientes.id,
        razaoSocial: clientes.razaoSocial,
        vendedorId: clientes.vendedorAtualId,
      })
      .from(sapCotacoesHistorico)
      .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapCotacoesHistorico.importacaoId))
      .innerJoin(clientes, eq(clientes.id, sapCotacoesHistorico.clienteId))
      .where(and(...filtrosSap))
    for (const c of sap) {
      linhas.push({
        chave: `sap-${c.id}`,
        origem: 'sap',
        data: c.data,
        numero: c.numero,
        clienteId: c.clienteId,
        razaoSocial: c.razaoSocial,
        vendedorNome: (c.vendedorId && nomePorVendedor.get(c.vendedorId)) || '—',
        valor: c.valor,
        situacao: c.status === 'cancelado' ? 'perdido' : c.status,
      })
    }
    return linhas.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
  }),

  orcamentosPorVendedor: protectedProcedure
    .input(periodoInput.extend({ granularidade: z.enum(['dia', 'semana', 'mes']).default('dia') }))
    .query(async ({ ctx, input }) => {
      const { inicio, fim } = limitesDia(input)
      const vendedores = await vendedoresPermitidos(ctx, input.vendedorId)
      const idsPermitidos = vendedores.map((v) => v.id)
      if (!idsPermitidos.length) return []

      const filtrosEventos = [
        eq(logAuditoria.tabela, 'funil_mensal'),
        eq(logAuditoria.acao, 'mudar_etapa'),
        eq(logAuditoria.campo, 'etapa'),
        eq(logAuditoria.valorNovo, 'negociacao'),
        between(logAuditoria.alteradoEm, inicio, fim),
        inArray(logAuditoria.alteradoPor, idsPermitidos),
      ]
      const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
      if (filtroReg) filtrosEventos.push(filtroReg)

      // Join com funilMensal/clientes só serve pro filtro de região opcional
      // (logAuditoria.registroId aponta pro funilMensal.id quando tabela =
      // 'funil_mensal', filtrado acima).
      const eventos = await db
        .select({ vendedorId: logAuditoria.alteradoPor, alteradoEm: logAuditoria.alteradoEm })
        .from(logAuditoria)
        .innerJoin(funilMensal, eq(funilMensal.id, logAuditoria.registroId))
        .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
        .where(and(...filtrosEventos))

      const nomePorVendedor = new Map(vendedores.map((v) => [v.id, v.name]))

      // `alteradoEm` é gravado em UTC sem sufixo de fuso — cortar a string
      // direto (`.slice`) jogava orçamento lançado entre 21h e meia-noite
      // (horário de Brasília) pro dia seguinte (00h-02h59 em UTC), e perto
      // da virada do mês, pro mês seguinte também. Corrigido em 2026-09-29
      // (achado via auditoria) convertendo pra data local de Brasília
      // primeiro (mesmo helper usado no resto do sistema pra isso), só
      // depois cortando em dia/mês/semana.
      function bucketDe(dataHora: string): string {
        const dataLocal = toLocalDateKey(toUtcISO(dataHora)) // "YYYY-MM-DD" já em horário de Brasília
        if (input.granularidade === 'mes') return dataLocal.slice(0, 7)
        if (input.granularidade === 'dia') return dataLocal
        const [ano, mes, dia] = dataLocal.split('-').map(Number)
        const d = new Date(Date.UTC(ano, mes - 1, dia))
        const diaSemana = (d.getUTCDay() + 6) % 7 // 0 = segunda
        d.setUTCDate(d.getUTCDate() - diaSemana)
        return d.toISOString().slice(0, 10)
      }

      const contagem = new Map<string, number>()
      for (const ev of eventos) {
        if (!ev.vendedorId) continue
        const chave = `${ev.vendedorId}|${bucketDe(ev.alteradoEm)}`
        contagem.set(chave, (contagem.get(chave) ?? 0) + 1)
      }

      // Cotações do SAP (lotes ligados) no período — contam pro vendedor
      // ATUAL do cliente, igual às vendas do SAP. Data já vem em dia "puro".
      const filtrosSap = [
        eq(sapImportacoes.ativo, true),
        eq(sapCotacoesHistorico.empresaId, ctx.empresaId),
        between(sapCotacoesHistorico.dataCotacao, input.dataInicio.slice(0, 10), input.dataFim.slice(0, 10)),
        isNull(clientes.deletedAt),
        inArray(clientes.vendedorAtualId, idsPermitidos),
      ]
      if (filtroReg) filtrosSap.push(filtroReg)
      const cotacoesSap = await db
        .select({ vendedorId: clientes.vendedorAtualId, data: sapCotacoesHistorico.dataCotacao })
        .from(sapCotacoesHistorico)
        .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapCotacoesHistorico.importacaoId))
        .innerJoin(clientes, eq(clientes.id, sapCotacoesHistorico.clienteId))
        .where(and(...filtrosSap))
      for (const c of cotacoesSap) {
        if (!c.vendedorId) continue
        const chave = `${c.vendedorId}|${bucketDe(dataSapComoDatetime(c.data))}`
        contagem.set(chave, (contagem.get(chave) ?? 0) + 1)
      }

      return [...contagem.entries()]
        .map(([chave, quantidade]) => {
          const [vendedorIdStr, periodo] = chave.split('|')
          const vendedorId = Number(vendedorIdStr)
          return { vendedorId, nome: nomePorVendedor.get(vendedorId) ?? '—', periodo, quantidade }
        })
        .sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : a.nome.localeCompare(b.nome, 'pt-BR')))
    }),
})
