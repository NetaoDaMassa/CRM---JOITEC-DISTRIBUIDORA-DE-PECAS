import { z } from 'zod'
import { and, between, count, eq, gte, isNull, sql } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { compromissos, funilMensal, registroContato } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'

const TIPO_VALUES = ['ligacao', 'visita', 'reuniao', 'outro'] as const
const RECORRENCIA_VALUES = ['nenhuma', 'diaria', 'semanal', 'quinzenal', 'mensal'] as const

// Limite de segurança pra geração de série recorrente — sem isso um "repetir
// todo dia até 2030" digitado sem querer geraria dezenas de milhares de
// linhas de uma vez.
const MAX_OCORRENCIAS_SERIE = 104

function proximaOcorrencia(dataHoraBase: string, recorrencia: (typeof RECORRENCIA_VALUES)[number], n: number): string {
  const d = new Date(`${dataHoraBase.replace(' ', 'T')}Z`)
  if (recorrencia === 'diaria') d.setUTCDate(d.getUTCDate() + n)
  else if (recorrencia === 'semanal') d.setUTCDate(d.getUTCDate() + n * 7)
  else if (recorrencia === 'quinzenal') d.setUTCDate(d.getUTCDate() + n * 14)
  else if (recorrencia === 'mensal') d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

function filtroVendedorFunil(ctxRole: 'admin' | 'vendor', ctxUserId: number, vendedorId: number | undefined) {
  if (ctxRole === 'admin') return vendedorId ? eq(funilMensal.vendedorId, vendedorId) : undefined
  return eq(funilMensal.vendedorId, ctxUserId)
}

function filtroVendedor(ctxRole: 'admin' | 'vendor', ctxUserId: number, vendedorId: number | undefined) {
  if (ctxRole === 'admin') return vendedorId ? eq(compromissos.vendedorId, vendedorId) : undefined
  return eq(compromissos.vendedorId, ctxUserId)
}

export const compromissosRouter = router({
  // Lista compromissos num intervalo de datas (usado pelo calendário —
  // mês, semana ou dia, o front que decide o intervalo) — vendedor só vê
  // os próprios, admin pode ver de um vendedor específico ou de todos (sem
  // vendedorId).
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
        recorrencia: z.enum(RECORRENCIA_VALUES).optional().default('nenhuma'),
        recorrenciaAte: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const vendedorId = ctx.user.role === 'admin' && input.vendedorId ? input.vendedorId : ctx.user.id
      const base = {
        vendedorId,
        clienteId: input.clienteId,
        tipo: input.tipo,
        titulo: input.titulo,
        descricao: input.descricao,
      }

      const primeiro = await db.insert(compromissos).values({ ...base, dataHora: input.dataHora }).returning({ id: compromissos.id })
      const primeiroId = primeiro[0].id

      if (input.recorrencia !== 'nenhuma' && input.recorrenciaAte) {
        await db.update(compromissos).set({ recorrenciaGrupoId: primeiroId }).where(eq(compromissos.id, primeiroId))

        const ateString = `${input.recorrenciaAte} 23:59:59`
        const linhas: (typeof base & { dataHora: string; recorrencia: (typeof RECORRENCIA_VALUES)[number]; recorrenciaGrupoId: number })[] = []
        for (let n = 1; n <= MAX_OCORRENCIAS_SERIE; n++) {
          const proxima = proximaOcorrencia(input.dataHora, input.recorrencia, n)
          if (proxima > ateString) break
          linhas.push({ ...base, dataHora: proxima, recorrencia: input.recorrencia, recorrenciaGrupoId: primeiroId })
        }
        if (linhas.length) await db.insert(compromissos).values(linhas)
      }

      return { id: primeiroId }
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
        // "futuros" só se aplica a tipo/titulo/descricao — mudar dataHora
        // ou concluido sempre afeta só esta ocorrência (não faz sentido
        // empurrar a mesma nova data pra toda a série de uma vez).
        escopo: z.enum(['somente_este', 'futuros']).optional().default('somente_este'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, escopo, ...dados } = input
      const compromisso = await db.query.compromissos.findFirst({ where: eq(compromissos.id, id) })
      if (!compromisso) throw new Error('Compromisso não encontrado')
      if (ctx.user.role !== 'admin' && compromisso.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

      const atualizacoes: Record<string, unknown> = { updatedAt: agoraSqlite() }
      for (const [chave, valor] of Object.entries(dados)) {
        if (valor !== undefined) atualizacoes[chave] = valor
      }
      // Reagendar (mudar dataHora) reabre a notificação, senão um compromisso
      // adiado nunca mais avisaria (já teria sido marcado como notificado).
      if (dados.dataHora !== undefined) atualizacoes.notificado = false

      if (escopo === 'futuros' && compromisso.recorrenciaGrupoId && dados.dataHora === undefined && dados.concluido === undefined) {
        const { dataHora: _dh, concluido: _c, ...aplicaveis } = atualizacoes
        await db
          .update(compromissos)
          .set(aplicaveis)
          .where(
            and(
              eq(compromissos.recorrenciaGrupoId, compromisso.recorrenciaGrupoId),
              gte(compromissos.dataHora, compromisso.dataHora),
              isNull(compromissos.deletedAt)
            )
          )
      } else {
        await db.update(compromissos).set(atualizacoes).where(eq(compromissos.id, id))
      }
      return { success: true }
    }),

  excluir: protectedProcedure
    .input(z.object({ id: z.number(), escopo: z.enum(['somente_este', 'futuros', 'todos']).optional().default('somente_este') }))
    .mutation(async ({ ctx, input }) => {
      const compromisso = await db.query.compromissos.findFirst({ where: eq(compromissos.id, input.id) })
      if (!compromisso) throw new Error('Compromisso não encontrado')
      if (ctx.user.role !== 'admin' && compromisso.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

      const agora = agoraSqlite()

      if (input.escopo !== 'somente_este' && compromisso.recorrenciaGrupoId) {
        const filtros = [eq(compromissos.recorrenciaGrupoId, compromisso.recorrenciaGrupoId), isNull(compromissos.deletedAt)]
        if (input.escopo === 'futuros') filtros.push(gte(compromissos.dataHora, compromisso.dataHora))
        await db.update(compromissos).set({ deletedAt: agora }).where(and(...filtros))
      } else {
        await db.update(compromissos).set({ deletedAt: agora }).where(eq(compromissos.id, input.id))
      }
      return { success: true }
    }),
})
