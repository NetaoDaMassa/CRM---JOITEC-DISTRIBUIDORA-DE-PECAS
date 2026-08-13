import { z } from 'zod'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { maquinasCliente, clientes, catalogoCompressores, itensManutencao, maquinaManutencaoStatus } from '../db/schema.js'
import { agoraSqlite, diasDesde, hojeBrString } from '../lib/dataBr.js'

type ItemManutencao = typeof itensManutencao.$inferSelect
type StatusManutencao = typeof maquinaManutencaoStatus.$inferSelect

// Sem telemetria de horímetro real — o acompanhamento é por estimativa
// (horas de uso por dia informadas no cadastro da máquina), projetando a
// data da próxima troca a partir de uma leitura de referência (a "primeira
// preventiva", ou a última troca registrada). `horasNaReferencia` não
// precisa ser 0 — uma máquina que já estava em uso antes de entrar no
// sistema começa com a leitura real de horas daquele momento.
function projetarTroca(horasNaReferencia: number, dataReferencia: string, horasUsoDia: number, intervaloHoras: number) {
  const dias = diasDesde(dataReferencia) ?? 0
  const horasAcumuladas = horasNaReferencia + dias * horasUsoDia
  const horasRestantes = intervaloHoras - horasAcumuladas
  if (horasUsoDia <= 0) return { diasRestantes: null, dataProjetada: null, vencido: false }
  const diasRestantes = Math.ceil(horasRestantes / horasUsoDia)
  const dataProjetada = new Date(`${hojeBrString()}T00:00:00Z`)
  dataProjetada.setUTCDate(dataProjetada.getUTCDate() + diasRestantes)
  return {
    diasRestantes,
    dataProjetada: dataProjetada.toISOString().slice(0, 10),
    vencido: diasRestantes <= 0,
  }
}

// Junta os itens de manutenção configurados da empresa com o status
// (se existir) de cada um numa máquina específica, e projeta a troca de
// cada item. Item sem status ainda (nunca teve "primeira preventiva"
// registrada) entra com `semLeitura: true` — não dá pra projetar nada até
// alguém informar a leitura inicial de horas.
function enriquecerMaquina(
  maquina: typeof maquinasCliente.$inferSelect,
  itens: ItemManutencao[],
  statusPorItem: Map<number, StatusManutencao>
) {
  const itensStatus = itens.map((item) => {
    const status = statusPorItem.get(item.id)
    if (!status) {
      return { itemId: item.id, nome: item.nome, intervaloHoras: item.intervaloHoras, semLeitura: true as const }
    }
    const projecao = projetarTroca(status.horasNaReferencia, status.dataReferencia, maquina.horasUsoDia, item.intervaloHoras)
    return {
      itemId: item.id,
      nome: item.nome,
      intervaloHoras: item.intervaloHoras,
      semLeitura: false as const,
      horasNaReferencia: status.horasNaReferencia,
      dataReferencia: status.dataReferencia,
      ...projecao,
    }
  })
  return { ...maquina, itensStatus }
}

async function validarAcessoCliente(clienteId: number, ctxUserId: number, ctxIsAdmin: boolean, empresaId: number) {
  const cliente = await db.query.clientes.findFirst({
    where: and(eq(clientes.id, clienteId), isNull(clientes.deletedAt), eq(clientes.empresaId, empresaId)),
  })
  if (!cliente) throw new Error('Cliente não encontrado')
  if (!ctxIsAdmin && cliente.vendedorAtualId !== ctxUserId) throw new Error('Acesso negado')
  return cliente
}

export const maquinasRouter = router({
  // Alimenta o dropdown de "Modelo" em "Nova máquina" — se a empresa não
  // tiver catálogo cadastrado, o formulário cai pra digitação livre.
  listaCatalogo: protectedProcedure.query(async ({ ctx }) => {
    return db.query.catalogoCompressores.findMany({
      // Só compressor entra aqui — secador/outro item não tem o ciclo de
      // manutenção por horas que "Nova máquina" acompanha.
      where: and(eq(catalogoCompressores.empresaId, ctx.empresaId), eq(catalogoCompressores.tipo, 'compressor')),
      orderBy: (c, { asc }) => [asc(c.modelo)],
    })
  }),

  // Todos os tipos (compressor + secador + outro) — usado no autocomplete de
  // "Itens do pedido" ao fechar uma venda, diferente do listaCatalogo acima
  // (só compressor, usado no dropdown de Nova Máquina).
  listaCatalogoItens: protectedProcedure.query(async ({ ctx }) => {
    return db.query.catalogoCompressores.findMany({
      where: eq(catalogoCompressores.empresaId, ctx.empresaId),
      orderBy: (c, { asc }) => [asc(c.modelo)],
    })
  }),

  // Lista de itens de manutenção configurados pela empresa (admin cadastra
  // em Configurações; qualquer vendedor lê pra ver o status das máquinas).
  listaItensManutencao: protectedProcedure.query(async ({ ctx }) => {
    return db.query.itensManutencao.findMany({
      where: and(eq(itensManutencao.empresaId, ctx.empresaId), isNull(itensManutencao.deletedAt)),
      orderBy: (i, { asc }) => [asc(i.ordem), asc(i.id)],
    })
  }),

  criarItemManutencao: adminProcedure
    .input(z.object({ nome: z.string().min(1), intervaloHoras: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existentes = await db.query.itensManutencao.findMany({ where: eq(itensManutencao.empresaId, ctx.empresaId) })
      const result = await db.insert(itensManutencao).values({
        empresaId: ctx.empresaId,
        nome: input.nome,
        intervaloHoras: input.intervaloHoras,
        ordem: existentes.length,
      })
      return { id: Number(result.lastInsertRowid) }
    }),

  atualizarItemManutencao: adminProcedure
    .input(z.object({ id: z.number(), nome: z.string().min(1), intervaloHoras: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const item = await db.query.itensManutencao.findFirst({ where: eq(itensManutencao.id, input.id) })
      if (!item || item.empresaId !== ctx.empresaId) throw new Error('Item não encontrado')
      await db
        .update(itensManutencao)
        .set({ nome: input.nome, intervaloHoras: input.intervaloHoras })
        .where(eq(itensManutencao.id, input.id))
      return { success: true }
    }),

  removerItemManutencao: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const item = await db.query.itensManutencao.findFirst({ where: eq(itensManutencao.id, input.id) })
    if (!item || item.empresaId !== ctx.empresaId) throw new Error('Item não encontrado')
    await db.update(itensManutencao).set({ deletedAt: agoraSqlite() }).where(eq(itensManutencao.id, input.id))
    return { success: true }
  }),

  listaPorCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    await validarAcessoCliente(input.clienteId, ctx.user.id, ctx.user.role === 'admin', ctx.empresaId)
    const maquinas = await db.query.maquinasCliente.findMany({
      where: and(eq(maquinasCliente.clienteId, input.clienteId), isNull(maquinasCliente.deletedAt)),
      orderBy: (m, { desc }) => [desc(m.createdAt)],
    })
    const itens = await db.query.itensManutencao.findMany({
      where: and(eq(itensManutencao.empresaId, ctx.empresaId), isNull(itensManutencao.deletedAt)),
      orderBy: (i, { asc }) => [asc(i.ordem), asc(i.id)],
    })
    const maquinaIds = maquinas.map((m) => m.id)
    const statusRows = maquinaIds.length
      ? await db.query.maquinaManutencaoStatus.findMany({ where: inArray(maquinaManutencaoStatus.maquinaId, maquinaIds) })
      : []
    const statusPorMaquina = new Map<number, Map<number, StatusManutencao>>()
    for (const s of statusRows) {
      if (!statusPorMaquina.has(s.maquinaId)) statusPorMaquina.set(s.maquinaId, new Map())
      statusPorMaquina.get(s.maquinaId)!.set(s.itemId, s)
    }
    return maquinas.map((m) => enriquecerMaquina(m, itens, statusPorMaquina.get(m.id) ?? new Map()))
  }),

  criar: protectedProcedure
    .input(
      z.object({
        clienteId: z.number(),
        modelo: z.string().min(1),
        quantidade: z.number().int().min(1),
        dataInstalacao: z.string().min(1),
        horasUsoDia: z.number().min(0),
        consumidorFinalNome: z.string().optional(),
        consumidorFinalTelefone: z.string().optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await validarAcessoCliente(input.clienteId, ctx.user.id, ctx.user.role === 'admin', ctx.empresaId)
      const result = await db.insert(maquinasCliente).values({
        clienteId: input.clienteId,
        modelo: input.modelo,
        quantidade: input.quantidade,
        dataInstalacao: input.dataInstalacao,
        horasUsoDia: input.horasUsoDia,
        consumidorFinalNome: input.consumidorFinalNome,
        consumidorFinalTelefone: input.consumidorFinalTelefone,
        observacoes: input.observacoes,
      })
      return { id: Number(result.lastInsertRowid) }
    }),

  atualizar: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        modelo: z.string().min(1),
        quantidade: z.number().int().min(1),
        horasUsoDia: z.number().min(0),
        consumidorFinalNome: z.string().optional(),
        consumidorFinalTelefone: z.string().optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const maquina = await db.query.maquinasCliente.findFirst({ where: eq(maquinasCliente.id, input.id) })
      if (!maquina) throw new Error('Máquina não encontrada')
      await validarAcessoCliente(maquina.clienteId, ctx.user.id, ctx.user.role === 'admin', ctx.empresaId)

      await db
        .update(maquinasCliente)
        .set({
          modelo: input.modelo,
          quantidade: input.quantidade,
          horasUsoDia: input.horasUsoDia,
          consumidorFinalNome: input.consumidorFinalNome,
          consumidorFinalTelefone: input.consumidorFinalTelefone,
          observacoes: input.observacoes,
          updatedAt: agoraSqlite(),
        })
        .where(eq(maquinasCliente.id, input.id))
      return { success: true }
    }),

  // "Primeira preventiva" — registra (ou corrige) a leitura de horas de um
  // item numa máquina numa data específica. Não é necessariamente 0: a
  // máquina pode já estar rodando há tempo quando alguém finalmente
  // cadastra o acompanhamento dela no sistema.
  registrarLeituraInicial: protectedProcedure
    .input(z.object({ maquinaId: z.number(), itemId: z.number(), horasAtuais: z.number().min(0), data: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const maquina = await db.query.maquinasCliente.findFirst({ where: eq(maquinasCliente.id, input.maquinaId) })
      if (!maquina) throw new Error('Máquina não encontrada')
      await validarAcessoCliente(maquina.clienteId, ctx.user.id, ctx.user.role === 'admin', ctx.empresaId)

      const existente = await db.query.maquinaManutencaoStatus.findFirst({
        where: and(eq(maquinaManutencaoStatus.maquinaId, input.maquinaId), eq(maquinaManutencaoStatus.itemId, input.itemId)),
      })
      if (existente) {
        await db
          .update(maquinaManutencaoStatus)
          .set({ horasNaReferencia: input.horasAtuais, dataReferencia: input.data, updatedAt: agoraSqlite() })
          .where(eq(maquinaManutencaoStatus.id, existente.id))
      } else {
        await db.insert(maquinaManutencaoStatus).values({
          maquinaId: input.maquinaId,
          itemId: input.itemId,
          horasNaReferencia: input.horasAtuais,
          dataReferencia: input.data,
        })
      }
      return { success: true }
    }),

  // Troca feita agora — zera a referência (peça nova instalada hoje).
  marcarTrocaItem: protectedProcedure
    .input(z.object({ maquinaId: z.number(), itemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const maquina = await db.query.maquinasCliente.findFirst({ where: eq(maquinasCliente.id, input.maquinaId) })
      if (!maquina) throw new Error('Máquina não encontrada')
      await validarAcessoCliente(maquina.clienteId, ctx.user.id, ctx.user.role === 'admin', ctx.empresaId)

      const hoje = hojeBrString()
      const existente = await db.query.maquinaManutencaoStatus.findFirst({
        where: and(eq(maquinaManutencaoStatus.maquinaId, input.maquinaId), eq(maquinaManutencaoStatus.itemId, input.itemId)),
      })
      if (existente) {
        await db
          .update(maquinaManutencaoStatus)
          .set({ horasNaReferencia: 0, dataReferencia: hoje, updatedAt: agoraSqlite() })
          .where(eq(maquinaManutencaoStatus.id, existente.id))
      } else {
        await db.insert(maquinaManutencaoStatus).values({ maquinaId: input.maquinaId, itemId: input.itemId, horasNaReferencia: 0, dataReferencia: hoje })
      }
      return { success: true }
    }),

  remover: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const maquina = await db.query.maquinasCliente.findFirst({ where: eq(maquinasCliente.id, input.id) })
    if (!maquina) throw new Error('Máquina não encontrada')
    await validarAcessoCliente(maquina.clienteId, ctx.user.id, ctx.user.role === 'admin', ctx.empresaId)

    await db.update(maquinasCliente).set({ deletedAt: agoraSqlite() }).where(eq(maquinasCliente.id, input.id))
    return { success: true }
  }),

  // "Fila de Pós-venda" — mesmo espírito da "Fila de Hoje" do funil de venda
  // nova, só que pra reposição de peça: lista as máquinas do vendedor (ou,
  // se admin, todas da empresa) ordenadas por quem está com o item de
  // manutenção mais perto (ou já passou) da troca, pra saber quem ligar
  // primeiro. Item sem leitura inicial registrada ainda não entra na
  // ordenação (não tem como projetar nada).
  filaPosVenda: protectedProcedure.query(async ({ ctx }) => {
    const filtroCliente =
      ctx.user.role === 'admin' ? eq(clientes.empresaId, ctx.empresaId) : eq(clientes.vendedorAtualId, ctx.user.id)

    const itens = await db.query.itensManutencao.findMany({
      where: and(eq(itensManutencao.empresaId, ctx.empresaId), isNull(itensManutencao.deletedAt)),
    })

    const linhas = await db
      .select({
        maquina: maquinasCliente,
        clienteId: clientes.id,
        clienteRazaoSocial: clientes.razaoSocial,
        clienteTelefone: clientes.telefoneWhatsapp,
      })
      .from(maquinasCliente)
      .innerJoin(clientes, eq(clientes.id, maquinasCliente.clienteId))
      .where(and(filtroCliente, isNull(maquinasCliente.deletedAt), isNull(clientes.deletedAt)))

    const maquinaIds = linhas.map((l) => l.maquina.id)
    const statusRows = maquinaIds.length
      ? await db.query.maquinaManutencaoStatus.findMany({ where: inArray(maquinaManutencaoStatus.maquinaId, maquinaIds) })
      : []
    const statusPorMaquina = new Map<number, Map<number, StatusManutencao>>()
    for (const s of statusRows) {
      if (!statusPorMaquina.has(s.maquinaId)) statusPorMaquina.set(s.maquinaId, new Map())
      statusPorMaquina.get(s.maquinaId)!.set(s.itemId, s)
    }

    const linhasComItem = linhas
      .map((l) => {
        const enriquecida = enriquecerMaquina(l.maquina, itens, statusPorMaquina.get(l.maquina.id) ?? new Map())
        const comLeitura = enriquecida.itensStatus.filter((i) => !i.semLeitura)
        if (!comLeitura.length) return null
        const maisUrgente = comLeitura.reduce((a, b) => ((a.diasRestantes ?? Infinity) <= (b.diasRestantes ?? Infinity) ? a : b))
        return {
          maquinaId: enriquecida.id,
          clienteId: l.clienteId,
          razaoSocial: l.clienteRazaoSocial,
          telefoneWhatsapp: l.clienteTelefone,
          modelo: enriquecida.modelo,
          quantidade: enriquecida.quantidade,
          itemMaisUrgente: maisUrgente.nome,
          itemId: maisUrgente.itemId,
          diasRestantes: maisUrgente.diasRestantes,
          vencido: (maisUrgente.diasRestantes ?? 0) <= 0,
          itensStatus: enriquecida.itensStatus,
        }
      })
      .filter((l): l is NonNullable<typeof l> => l !== null)

    linhasComItem.sort((a, b) => (a.diasRestantes ?? Infinity) - (b.diasRestantes ?? Infinity))
    return linhasComItem
  }),
})
