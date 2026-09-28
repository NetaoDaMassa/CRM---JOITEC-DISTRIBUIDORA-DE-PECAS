import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { router, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { demonstracoes, demonstracaoItens, demonstracaoItemHistorico, users } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'

const STATUS_ITEM = ['em_demonstracao', 'aguardando_nf', 'vendido', 'retorno_solicitado', 'retornado'] as const

// Controle de Demonstrações (Odin Compressores) — máquinas enviadas pro
// cliente testar. Pedido do João, 2026-09-28. A unidade de controle é o
// ITEM (cada máquina), não a demonstração: vender uma não encerra as
// outras da mesma nota. Ver schema.ts pro resto do contexto.
//
// Escopo: mesma regra do resto do módulo Odin — admin vê a empresa toda,
// vendedor só as demonstrações onde ele é o responsável.
async function carregarItemDoUsuario(itemId: number, ctx: { empresaId: number; user: { id: number; role: string; superAdmin: boolean } }) {
  const item = await db.query.demonstracaoItens.findFirst({
    where: eq(demonstracaoItens.id, itemId),
    with: { demonstracao: true },
  })
  if (!item || item.demonstracao.empresaId !== ctx.empresaId) throw new Error('Máquina não encontrada')
  const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
  if (!souAdmin && item.demonstracao.vendedorId !== ctx.user.id) throw new Error('Acesso negado')
  return item
}

// Toda ação registra uma linha no histórico junto — é o que o João chamava
// de "Conclusão" na planilha, só que sem sobrescrever o que já estava lá.
async function registrarHistorico(itemId: number, texto: string, userId: number) {
  await db.insert(demonstracaoItemHistorico).values({ itemId, texto, userId })
}

export const demonstracoesRouter = router({
  listar: adminOrFeatureProcedure('demonstracoes_odin').query(async ({ ctx }) => {
    const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
    const linhas = await db.query.demonstracoes.findMany({
      where: souAdmin
        ? eq(demonstracoes.empresaId, ctx.empresaId)
        : and(eq(demonstracoes.empresaId, ctx.empresaId), eq(demonstracoes.vendedorId, ctx.user.id)),
      with: {
        vendedor: { columns: { id: true, name: true } },
        itens: { orderBy: (i, { asc }) => [asc(i.id)] },
      },
      orderBy: (d, { desc }) => [desc(d.dataSaida), desc(d.id)],
    })

    // A tela é uma tabela por MÁQUINA (igual a planilha), então achata aqui
    // em vez de deixar o front montar isso — os dados do cabeçalho (nota,
    // cliente, vendedor) se repetem em cada linha de propósito.
    return linhas.flatMap((d) =>
      d.itens.map((item) => ({
        itemId: item.id,
        demonstracaoId: d.id,
        dataSaida: d.dataSaida,
        numeroNotaSaida: d.numeroNotaSaida,
        clienteNome: d.clienteNome,
        clienteCidade: d.clienteCidade,
        clienteEstado: d.clienteEstado,
        vendedorId: d.vendedorId,
        vendedorNome: d.vendedor?.name ?? null,
        observacao: d.observacao,
        produto: item.produto,
        numeroSerie: item.numeroSerie,
        status: item.status,
        retornoPrevistoEm: item.retornoPrevistoEm,
        retornoEfetivoEm: item.retornoEfetivoEm,
        numeroNotaRetorno: item.numeroNotaRetorno,
        dataVenda: item.dataVenda,
        numeroNotaVenda: item.numeroNotaVenda,
        clienteVenda: item.clienteVenda,
      }))
    )
  }),

  historicoItem: adminOrFeatureProcedure('demonstracoes_odin')
    .input(z.object({ itemId: z.number() }))
    .query(async ({ ctx, input }) => {
      await carregarItemDoUsuario(input.itemId, ctx)
      const linhas = await db.query.demonstracaoItemHistorico.findMany({
        where: eq(demonstracaoItemHistorico.itemId, input.itemId),
        with: { user: { columns: { name: true } } },
        orderBy: (h, { desc }) => [desc(h.createdAt), desc(h.id)],
      })
      return linhas.map((h) => ({ id: h.id, texto: h.texto, createdAt: h.createdAt, userNome: h.user?.name ?? 'Sistema' }))
    }),

  // Cadastro em 2 etapas na tela, 1 chamada só aqui: cria o cabeçalho e
  // todas as máquinas de uma vez, cada uma já com o prazo combinado.
  criar: adminOrFeatureProcedure('demonstracoes_odin')
    .input(
      z.object({
        clienteNome: z.string().trim().min(2),
        clienteCidade: z.string().trim().optional(),
        clienteEstado: z.string().trim().optional(),
        vendedorId: z.number().optional(),
        dataSaida: z.string(),
        numeroNotaSaida: z.string().trim().optional(),
        retornoPrevistoEm: z.string().optional(),
        observacao: z.string().trim().optional(),
        itens: z.array(z.object({ produto: z.string().trim().min(1), numeroSerie: z.string().trim().optional() })).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
      const vendedorId = souAdmin && input.vendedorId ? input.vendedorId : ctx.user.id

      const result = await db.insert(demonstracoes).values({
        empresaId: ctx.empresaId,
        clienteNome: input.clienteNome,
        clienteCidade: input.clienteCidade || null,
        clienteEstado: input.clienteEstado ? input.clienteEstado.toUpperCase() : null,
        vendedorId,
        dataSaida: input.dataSaida,
        numeroNotaSaida: input.numeroNotaSaida || null,
        retornoPrevistoEm: input.retornoPrevistoEm || null,
        observacao: input.observacao || null,
        criadoPorUserId: ctx.user.id,
      })
      const demonstracaoId = Number(result.lastInsertRowid)

      for (const item of input.itens) {
        const itemResult = await db.insert(demonstracaoItens).values({
          demonstracaoId,
          produto: item.produto,
          numeroSerie: item.numeroSerie || null,
          retornoPrevistoEm: input.retornoPrevistoEm || null,
        })
        await registrarHistorico(
          Number(itemResult.lastInsertRowid),
          `Máquina enviada${input.numeroNotaSaida ? ` na NF ${input.numeroNotaSaida}` : ''}.`,
          ctx.user.id
        )
      }
      return { id: demonstracaoId }
    }),

  registrarVenda: adminOrFeatureProcedure('demonstracoes_odin')
    .input(
      z.object({
        itemId: z.number(),
        dataVenda: z.string(),
        numeroNotaVenda: z.string().trim().optional(),
        clienteVenda: z.string().trim().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await carregarItemDoUsuario(input.itemId, ctx)
      // Sem nota fiscal ainda = 'aguardando_nf'; com nota = 'vendido'.
      const status = input.numeroNotaVenda ? 'vendido' : 'aguardando_nf'
      await db
        .update(demonstracaoItens)
        .set({
          status,
          dataVenda: input.dataVenda,
          numeroNotaVenda: input.numeroNotaVenda || null,
          clienteVenda: input.clienteVenda || null,
          updatedAt: agoraSqlite(),
        })
        .where(eq(demonstracaoItens.id, input.itemId))

      await registrarHistorico(
        input.itemId,
        input.numeroNotaVenda
          ? `Venda registrada${input.clienteVenda ? ` para ${input.clienteVenda}` : ''} — NF ${input.numeroNotaVenda}.`
          : `Venda informada${input.clienteVenda ? ` para ${input.clienteVenda}` : ''} — aguardando nota fiscal.`,
        ctx.user.id
      )
      return { ok: true }
    }),

  registrarRetorno: adminOrFeatureProcedure('demonstracoes_odin')
    .input(z.object({ itemId: z.number(), retornoEfetivoEm: z.string(), numeroNotaRetorno: z.string().trim().optional() }))
    .mutation(async ({ ctx, input }) => {
      await carregarItemDoUsuario(input.itemId, ctx)
      const status = input.numeroNotaRetorno ? 'retornado' : 'aguardando_nf'
      await db
        .update(demonstracaoItens)
        .set({
          status,
          retornoEfetivoEm: input.retornoEfetivoEm,
          numeroNotaRetorno: input.numeroNotaRetorno || null,
          updatedAt: agoraSqlite(),
        })
        .where(eq(demonstracaoItens.id, input.itemId))

      await registrarHistorico(
        input.itemId,
        input.numeroNotaRetorno
          ? `Máquina retornou — NF de retorno ${input.numeroNotaRetorno}.`
          : 'Retorno informado — aguardando nota fiscal.',
        ctx.user.id
      )
      return { ok: true }
    }),

  alterarPrazo: adminOrFeatureProcedure('demonstracoes_odin')
    .input(z.object({ itemId: z.number(), retornoPrevistoEm: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const item = await carregarItemDoUsuario(input.itemId, ctx)
      await db
        .update(demonstracaoItens)
        .set({ retornoPrevistoEm: input.retornoPrevistoEm, updatedAt: agoraSqlite() })
        .where(eq(demonstracaoItens.id, input.itemId))

      await registrarHistorico(
        input.itemId,
        `Prazo de retorno alterado${item.retornoPrevistoEm ? ` de ${item.retornoPrevistoEm}` : ''} para ${input.retornoPrevistoEm}.`,
        ctx.user.id
      )
      return { ok: true }
    }),

  alterarStatus: adminOrFeatureProcedure('demonstracoes_odin')
    .input(z.object({ itemId: z.number(), status: z.enum(STATUS_ITEM) }))
    .mutation(async ({ ctx, input }) => {
      await carregarItemDoUsuario(input.itemId, ctx)
      await db.update(demonstracaoItens).set({ status: input.status, updatedAt: agoraSqlite() }).where(eq(demonstracaoItens.id, input.itemId))
      const rotulos: Record<(typeof STATUS_ITEM)[number], string> = {
        em_demonstracao: 'Em demonstração',
        aguardando_nf: 'Aguardando NF',
        vendido: 'Vendido',
        retorno_solicitado: 'Retorno solicitado',
        retornado: 'Retornado',
      }
      await registrarHistorico(input.itemId, `Status alterado para "${rotulos[input.status]}".`, ctx.user.id)
      return { ok: true }
    }),

  // "Editar conclusão" da planilha — aqui sempre ACRESCENTA uma entrada, o
  // que já estava escrito antes não some.
  adicionarConclusao: adminOrFeatureProcedure('demonstracoes_odin')
    .input(z.object({ itemId: z.number(), texto: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await carregarItemDoUsuario(input.itemId, ctx)
      await registrarHistorico(input.itemId, input.texto, ctx.user.id)
      return { ok: true }
    }),

  excluirItem: adminOrFeatureProcedure('demonstracoes_odin')
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const item = await carregarItemDoUsuario(input.itemId, ctx)
      await db.delete(demonstracaoItens).where(eq(demonstracaoItens.id, input.itemId))

      // Apagou a última máquina da nota → o cabeçalho não serve mais pra nada.
      const restantes = await db.query.demonstracaoItens.findMany({
        where: eq(demonstracaoItens.demonstracaoId, item.demonstracaoId),
        columns: { id: true },
      })
      if (restantes.length === 0) {
        await db.delete(demonstracoes).where(eq(demonstracoes.id, item.demonstracaoId))
      }
      return { ok: true }
    }),

  vendedores: adminOrFeatureProcedure('demonstracoes_odin').query(async ({ ctx }) => {
    return db.query.users.findMany({
      where: and(eq(users.empresaId, ctx.empresaId), eq(users.isActive, true)),
      columns: { id: true, name: true },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
  }),
})
