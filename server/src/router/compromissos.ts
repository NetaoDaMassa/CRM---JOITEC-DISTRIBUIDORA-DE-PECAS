import { z } from 'zod'
import { and, between, count, eq, isNull, sql } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { compromissos, funilMensal, registroContato } from '../db/schema.js'

const TIPO_VALUES = ['ligacao', 'visita', 'reuniao', 'outro'] as const

function filtroVendedorFunil(ctxRole: 'admin' | 'vendor', ctxUserId: number, vendedorId: number | undefined) {
  if (ctxRole === 'admin') return vendedorId ? eq(funilMensal.vendedorId, vendedorId) : undefined
  return eq(funilMensal.vendedorId, ctxUserId)
}

function filtroVendedor(ctxRole: 'admin' | 'vendor', ctxUserId: number, vendedorId: number | undefined) {
  if (ctxRole === 'admin') return vendedorId ? eq(compromissos.vendedorId, vendedorId) : undefined
  return eq(compromissos.vendedorId, ctxUserId)
}

export const compromissosRouter = router({
  // Lista compromissos num intervalo de datas (usado pelo calendário mensal)
  // — vendedor só vê os próprios, admin pode ver de um vendedor específico
  // ou de todos (sem vendedorId).
  listar: protectedProcedure
    .input(z.object({ dataInicio: z.string(), dataFim: z.string(), vendedorId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const filtros = [
        between(compromissos.dataHora, `${input.dataInicio} 00:00:00`, `${input.dataFim} 23:59:59`),
        isNull(compromissos.deletedAt),
      ]
      const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId)
      if (filtroVend) filtros.push(filtroVend)

      return db.query.compromissos.findMany({
        where: and(...filtros),
        orderBy: (c, { asc }) => [asc(c.dataHora)],
        with: {
          cliente: { columns: { id: true, razaoSocial: true } },
          vendedor: { columns: { id: true, name: true } },
        },
      })
    }),

  // Resumo por dia de vendas fechadas + contatos registrados no intervalo —
  // alimenta os indicadores de "histórico" do calendário (o que já
  // aconteceu), junto com os compromissos futuros de `listar`.
  historico: protectedProcedure
    .input(z.object({ dataInicio: z.string(), dataFim: z.string(), vendedorId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const inicio = `${input.dataInicio} 00:00:00`
      const fim = `${input.dataFim} 23:59:59`

      const filtrosVendas = [
        eq(funilMensal.etapa, 'fechado'),
        between(funilMensal.dataEntradaEtapa, inicio, fim),
        isNull(funilMensal.deletedAt),
      ]
      const filtroVendVendas = filtroVendedorFunil(ctx.user.role, ctx.user.id, input.vendedorId)
      if (filtroVendVendas) filtrosVendas.push(filtroVendVendas)

      const vendasPorDia = await db
        .select({ dia: sql<string>`substr(${funilMensal.dataEntradaEtapa}, 1, 10)`, quantidade: count() })
        .from(funilMensal)
        .where(and(...filtrosVendas))
        .groupBy(sql`substr(${funilMensal.dataEntradaEtapa}, 1, 10)`)

      const filtrosContatos = [between(registroContato.dataHora, inicio, fim), isNull(registroContato.deletedAt)]
      if (ctx.user.role === 'admin') {
        if (input.vendedorId) filtrosContatos.push(eq(registroContato.vendedorId, input.vendedorId))
      } else {
        filtrosContatos.push(eq(registroContato.vendedorId, ctx.user.id))
      }

      const contatosPorDia = await db
        .select({ dia: sql<string>`substr(${registroContato.dataHora}, 1, 10)`, quantidade: count() })
        .from(registroContato)
        .where(and(...filtrosContatos))
        .groupBy(sql`substr(${registroContato.dataHora}, 1, 10)`)

      return { vendasPorDia, contatosPorDia }
    }),

  // Compromissos que vencem nos próximos minutos e ainda não notificaram —
  // o front consulta isso periodicamente pra disparar a notificação do
  // navegador (Notification API), já que o horário exato só existe no
  // navegador do próprio vendedor (sem processo de servidor 24h rodando).
  pendentesNotificacao: protectedProcedure.query(async ({ ctx }) => {
    // Janela de -15min a +5min: sem esse recuo pro passado, um compromisso
    // só notifica se o navegador do vendedor estiver aberto no segundo exato
    // em que ele entra na janela futura — qualquer recarregamento de página,
    // aba fechada momentaneamente ou latência de rede faz o aviso se perder
    // pra sempre (já que "notificado" nunca vira true e o item sai da janela
    // assim que o horário passa).
    const ha15Min = new Date(Date.now() - 15 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
    const daquiA5Min = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)

    return db.query.compromissos.findMany({
      where: and(
        eq(compromissos.vendedorId, ctx.user.id),
        eq(compromissos.concluido, false),
        eq(compromissos.notificado, false),
        between(compromissos.dataHora, ha15Min, daquiA5Min),
        isNull(compromissos.deletedAt)
      ),
      with: { cliente: { columns: { id: true, razaoSocial: true } } },
    })
  }),

  marcarNotificado: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await db
      .update(compromissos)
      .set({ notificado: true })
      .where(and(eq(compromissos.id, input.id), eq(compromissos.vendedorId, ctx.user.id)))
    return { success: true }
  }),

  criar: protectedProcedure
    .input(
      z.object({
        clienteId: z.number().optional(),
        tipo: z.enum(TIPO_VALUES),
        titulo: z.string().min(1, 'O título é obrigatório.'),
        descricao: z.string().optional(),
        dataHora: z.string(),
        vendedorId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const vendedorId = ctx.user.role === 'admin' && input.vendedorId ? input.vendedorId : ctx.user.id
      await db.insert(compromissos).values({
        vendedorId,
        clienteId: input.clienteId,
        tipo: input.tipo,
        titulo: input.titulo,
        descricao: input.descricao,
        dataHora: input.dataHora,
      })
      return { success: true }
    }),

  atualizar: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        tipo: z.enum(TIPO_VALUES).optional(),
        titulo: z.string().min(1).optional(),
        descricao: z.string().optional(),
        dataHora: z.string().optional(),
        concluido: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...dados } = input
      const compromisso = await db.query.compromissos.findFirst({ where: eq(compromissos.id, id) })
      if (!compromisso) throw new Error('Compromisso não encontrado')
      if (ctx.user.role !== 'admin' && compromisso.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

      const atualizacoes: Record<string, unknown> = { updatedAt: new Date().toISOString() }
      for (const [chave, valor] of Object.entries(dados)) {
        if (valor !== undefined) atualizacoes[chave] = valor
      }
      // Reagendar (mudar dataHora) reabre a notificação, senão um compromisso
      // adiado nunca mais avisaria (já teria sido marcado como notificado).
      if (dados.dataHora !== undefined) atualizacoes.notificado = false

      await db.update(compromissos).set(atualizacoes).where(eq(compromissos.id, id))
      return { success: true }
    }),

  excluir: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const compromisso = await db.query.compromissos.findFirst({ where: eq(compromissos.id, input.id) })
    if (!compromisso) throw new Error('Compromisso não encontrado')
    if (ctx.user.role !== 'admin' && compromisso.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

    await db.update(compromissos).set({ deletedAt: new Date().toISOString() }).where(eq(compromissos.id, input.id))
    return { success: true }
  }),
})
