import { z } from 'zod'
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { demandaEstagios, demandas, demandaAnexos, demandaComentarios, users, empresas, adminEmpresasExtras, notifications } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'

const FASES_PADRAO = ['A Fazer', 'Em Andamento', 'Aguardando', 'Concluído']

// Toda empresa ganha essas 4 fases na primeira vez que alguém abre o board
// dela — evita depender de migração/seed pra empresa nova (ex: quando o
// grupo abrir uma 8ª empresa daqui a 1 ano, o board já nasce funcionando).
async function garantirEstagiosPadrao(empresaId: number) {
  const existentes = await db.query.demandaEstagios.findMany({
    where: eq(demandaEstagios.empresaId, empresaId),
    orderBy: (e, { asc }) => [asc(e.ordem)],
  })
  if (existentes.length > 0) return existentes

  await db.insert(demandaEstagios).values(
    FASES_PADRAO.map((nome, i) => ({ empresaId, nome, ordem: i, concluido: nome === 'Concluído' }))
  )
  return db.query.demandaEstagios.findMany({
    where: eq(demandaEstagios.empresaId, empresaId),
    orderBy: (e, { asc }) => [asc(e.ordem)],
  })
}

// Empresas que o usuário logado pode escolher como alvo de uma demanda —
// mesma regra de `empresas.list` (superAdmin: todas; admin: a própria +
// empresas extras concedidas; vendedor: só a própria).
async function empresasAlvoPermitidas(user: { id: number; role: string; empresaId: number; superAdmin: boolean }): Promise<number[]> {
  if (user.superAdmin) {
    const todas = await db.query.empresas.findMany({ columns: { id: true } })
    return todas.map((e) => e.id)
  }
  if (user.role !== 'admin') return [user.empresaId]
  const extras = await db.query.adminEmpresasExtras.findMany({ where: eq(adminEmpresasExtras.userId, user.id) })
  return [user.empresaId, ...extras.map((e) => e.empresaId)]
}

export const demandasRouter = router({
  // Fases do board da empresa ativa — cria as 4 padrão na primeira vez.
  estagiosListar: protectedProcedure.query(async ({ ctx }) => {
    return garantirEstagiosPadrao(ctx.empresaId)
  }),

  estagioCriar: adminProcedure
    .input(z.object({ nome: z.string().min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      const estagios = await garantirEstagiosPadrao(ctx.empresaId)
      // Nova fase sempre entra antes da fase final ("Concluído") — não faz
      // sentido nascer depois do fim do board.
      const ultimaOrdem = estagios[estagios.length - 1]?.ordem ?? 0
      await db.insert(demandaEstagios).values({ empresaId: ctx.empresaId, nome: input.nome.trim(), ordem: ultimaOrdem })
      // Reordena a fase final pro fim de novo.
      const final = estagios.find((e) => e.concluido)
      if (final) await db.update(demandaEstagios).set({ ordem: ultimaOrdem + 1 }).where(eq(demandaEstagios.id, final.id))
      return { success: true }
    }),

  estagioRenomear: adminProcedure
    .input(z.object({ id: z.number(), nome: z.string().min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      const estagio = await db.query.demandaEstagios.findFirst({ where: eq(demandaEstagios.id, input.id) })
      if (!estagio || estagio.empresaId !== ctx.empresaId) throw new Error('Fase não encontrada')
      await db.update(demandaEstagios).set({ nome: input.nome.trim() }).where(eq(demandaEstagios.id, input.id))
      return { success: true }
    }),

  estagioExcluir: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const estagio = await db.query.demandaEstagios.findFirst({ where: eq(demandaEstagios.id, input.id) })
    if (!estagio || estagio.empresaId !== ctx.empresaId) throw new Error('Fase não encontrada')
    const emUso = await db.query.demandas.findFirst({ where: eq(demandas.estagioId, input.id) })
    if (emUso) throw new Error('Só dá pra excluir uma fase sem nenhuma demanda dentro. Mova ou exclua as demandas primeiro.')
    await db.delete(demandaEstagios).where(eq(demandaEstagios.id, input.id))
    return { success: true }
  }),

  // Empresas que o admin logado pode escolher como alvo, pra montar o
  // seletor do formulário de criação.
  empresasAlvo: adminProcedure.query(async ({ ctx }) => {
    const ids = await empresasAlvoPermitidas(ctx.user)
    return db.query.empresas.findMany({ where: inArray(empresas.id, ids), orderBy: (e, { asc }) => [asc(e.nome)] })
  }),

  // Pessoas ativas de uma empresa alvo, pro seletor "atribuir para" —
  // separado de `users.list` porque esse é sempre escopado na empresa ATIVA
  // da sessão, e aqui o admin pode estar escolhendo uma empresa diferente.
  usuariosDaEmpresa: adminProcedure.input(z.object({ empresaId: z.number() })).query(async ({ ctx, input }) => {
    const permitidas = await empresasAlvoPermitidas(ctx.user)
    if (!permitidas.includes(input.empresaId)) throw new Error('Empresa não permitida')
    const lista = await db.query.users.findMany({
      where: eq(users.empresaId, input.empresaId),
      columns: { id: true, name: true, role: true, isActive: true },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    return lista.filter((u) => u.isActive)
  }),

  // Board da empresa ativa — todo mundo dela vê (admin e vendedor), inclusive
  // demandas sem pessoa atribuída (são da empresa/setor como um todo).
  listar: protectedProcedure.query(async ({ ctx }) => {
    await garantirEstagiosPadrao(ctx.empresaId)
    return db.query.demandas.findMany({
      where: eq(demandas.empresaId, ctx.empresaId),
      with: {
        atribuidoPara: { columns: { id: true, name: true } },
        criadoPor: { columns: { id: true, name: true } },
        anexos: { columns: { id: true } },
        comentarios: { columns: { id: true } },
      },
      orderBy: [asc(demandas.ordem), desc(demandas.createdAt)],
    })
  }),

  detalhe: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const demanda = await db.query.demandas.findFirst({
      where: eq(demandas.id, input.id),
      with: {
        atribuidoPara: { columns: { id: true, name: true } },
        criadoPor: { columns: { id: true, name: true } },
        empresa: { columns: { id: true, nome: true } },
        anexos: { with: { enviadoPor: { columns: { id: true, name: true } } }, orderBy: (a, { desc }) => [desc(a.createdAt)] },
        comentarios: { with: { user: { columns: { id: true, name: true } } }, orderBy: (c, { asc }) => [asc(c.createdAt)] },
      },
    })
    if (!demanda || demanda.empresaId !== ctx.empresaId) throw new Error('Demanda não encontrada')
    return demanda
  }),

  criar: adminProcedure
    .input(
      z.object({
        empresaId: z.number(),
        titulo: z.string().min(1, 'Dê um título pra demanda'),
        descricao: z.string().optional(),
        atribuidoParaId: z.number().optional(),
        dataLimite: z.string().optional(),
        lembreteEm: z.string().optional(),
        mostrarPainelFinanceiro: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const permitidas = await empresasAlvoPermitidas(ctx.user)
      if (!permitidas.includes(input.empresaId)) throw new Error('Empresa não permitida')

      const estagios = await garantirEstagiosPadrao(input.empresaId)
      const primeiraFase = estagios[0]

      if (input.atribuidoParaId) {
        const alvo = await db.query.users.findFirst({ where: eq(users.id, input.atribuidoParaId) })
        if (!alvo || alvo.empresaId !== input.empresaId) throw new Error('Pessoa não pertence à empresa escolhida')
      }

      const [{ maiorOrdem }] = await db
        .select({ maiorOrdem: max(demandas.ordem) })
        .from(demandas)
        .where(eq(demandas.estagioId, primeiraFase.id))

      const result = await db.insert(demandas).values({
        empresaId: input.empresaId,
        estagioId: primeiraFase.id,
        titulo: input.titulo.trim(),
        descricao: input.descricao?.trim() || null,
        criadoPorId: ctx.user.id,
        atribuidoParaId: input.atribuidoParaId ?? null,
        dataLimite: input.dataLimite || null,
        lembreteEm: input.lembreteEm || null,
        mostrarPainelFinanceiro: input.mostrarPainelFinanceiro ?? false,
        ordem: (maiorOrdem ?? -1) + 1,
      })
      const demandaId = Number(result.lastInsertRowid)

      if (input.atribuidoParaId) {
        await db.insert(notifications).values({
          vendedorId: input.atribuidoParaId,
          type: 'demanda_atribuida',
          title: 'Nova demanda pra você',
          message: input.titulo.trim(),
        })
      }

      await registrarAuditoria({ tabela: 'demandas', registroId: demandaId, acao: 'criar', alteradoPor: ctx.user.id })
      return { success: true, id: demandaId }
    }),

  editar: adminProcedure
    .input(
      z.object({
        id: z.number(),
        titulo: z.string().min(1).optional(),
        descricao: z.string().optional(),
        atribuidoParaId: z.number().nullable().optional(),
        dataLimite: z.string().nullable().optional(),
        lembreteEm: z.string().nullable().optional(),
        mostrarPainelFinanceiro: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const demanda = await db.query.demandas.findFirst({ where: eq(demandas.id, input.id) })
      if (!demanda || demanda.empresaId !== ctx.empresaId) throw new Error('Demanda não encontrada')

      if (input.atribuidoParaId) {
        const alvo = await db.query.users.findFirst({ where: eq(users.id, input.atribuidoParaId) })
        if (!alvo || alvo.empresaId !== demanda.empresaId) throw new Error('Pessoa não pertence à empresa da demanda')
      }

      const houveReatribuicao = input.atribuidoParaId !== undefined && input.atribuidoParaId !== demanda.atribuidoParaId

      await db
        .update(demandas)
        .set({
          ...(input.titulo !== undefined && { titulo: input.titulo.trim() }),
          ...(input.descricao !== undefined && { descricao: input.descricao.trim() || null }),
          ...(input.atribuidoParaId !== undefined && { atribuidoParaId: input.atribuidoParaId }),
          ...(input.dataLimite !== undefined && { dataLimite: input.dataLimite }),
          ...(input.lembreteEm !== undefined && { lembreteEm: input.lembreteEm }),
          ...(input.mostrarPainelFinanceiro !== undefined && { mostrarPainelFinanceiro: input.mostrarPainelFinanceiro }),
          updatedAt: agoraSqlite(),
        })
        .where(eq(demandas.id, input.id))

      if (houveReatribuicao && input.atribuidoParaId) {
        await db.insert(notifications).values({
          vendedorId: input.atribuidoParaId,
          type: 'demanda_atribuida',
          title: 'Nova demanda pra você',
          message: input.titulo?.trim() ?? demanda.titulo,
        })
      }

      await registrarAuditoria({ tabela: 'demandas', registroId: input.id, acao: 'editar', alteradoPor: ctx.user.id })
      return { success: true }
    }),

  // Mover de fase — liberado pra QUALQUER um da empresa (admin ou
  // vendedor), é a ação do dia a dia de arrastar o card no board.
  mover: protectedProcedure
    .input(z.object({ id: z.number(), estagioId: z.number(), ordem: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const demanda = await db.query.demandas.findFirst({ where: eq(demandas.id, input.id) })
      if (!demanda || demanda.empresaId !== ctx.empresaId) throw new Error('Demanda não encontrada')

      const novaFase = await db.query.demandaEstagios.findFirst({ where: eq(demandaEstagios.id, input.estagioId) })
      if (!novaFase || novaFase.empresaId !== ctx.empresaId) throw new Error('Fase não encontrada')

      await db
        .update(demandas)
        .set({
          estagioId: input.estagioId,
          ordem: input.ordem,
          concluidoEm: novaFase.concluido ? demanda.concluidoEm ?? agoraSqlite() : null,
          updatedAt: agoraSqlite(),
        })
        .where(eq(demandas.id, input.id))

      if (novaFase.id !== demanda.estagioId) {
        await registrarAuditoria({
          tabela: 'demandas',
          registroId: input.id,
          acao: 'mudar_etapa',
          alteradoPor: ctx.user.id,
        })
      }
      return { success: true }
    }),

  excluir: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const demanda = await db.query.demandas.findFirst({ where: eq(demandas.id, input.id) })
    if (!demanda || demanda.empresaId !== ctx.empresaId) throw new Error('Demanda não encontrada')
    await db.delete(demandas).where(eq(demandas.id, input.id))
    await registrarAuditoria({ tabela: 'demandas', registroId: input.id, acao: 'excluir', alteradoPor: ctx.user.id })
    return { success: true }
  }),

  comentar: protectedProcedure
    .input(z.object({ demandaId: z.number(), texto: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const demanda = await db.query.demandas.findFirst({ where: eq(demandas.id, input.demandaId) })
      if (!demanda || demanda.empresaId !== ctx.empresaId) throw new Error('Demanda não encontrada')
      await db.insert(demandaComentarios).values({ demandaId: input.demandaId, userId: ctx.user.id, texto: input.texto.trim() })
      return { success: true }
    }),

  anexar: protectedProcedure
    .input(z.object({ demandaId: z.number(), nomeArquivo: z.string(), path: z.string(), tamanho: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const demanda = await db.query.demandas.findFirst({ where: eq(demandas.id, input.demandaId) })
      if (!demanda || demanda.empresaId !== ctx.empresaId) throw new Error('Demanda não encontrada')
      await db.insert(demandaAnexos).values({
        demandaId: input.demandaId,
        nomeArquivo: input.nomeArquivo,
        path: input.path,
        tamanho: input.tamanho ?? null,
        enviadoPorId: ctx.user.id,
      })
      return { success: true }
    }),

  excluirAnexo: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const anexo = await db.query.demandaAnexos.findFirst({ where: eq(demandaAnexos.id, input.id), with: { demanda: true } })
    if (!anexo || anexo.demanda.empresaId !== ctx.empresaId) throw new Error('Anexo não encontrado')
    await db.delete(demandaAnexos).where(eq(demandaAnexos.id, input.id))
    return { success: true }
  }),

  // Demandas marcadas "mostrar no Painel Financeiro", de todas as empresas
  // que entram no painel — widget dentro de PainelFinanceiro.tsx.
  painelFinanceiro: featureProcedure('painel_financeiro').query(async () => {
    const abertas = await db.query.demandaEstagios.findMany({ where: eq(demandaEstagios.concluido, false), columns: { id: true } })
    const idsAbertos = abertas.map((e) => e.id)
    if (idsAbertos.length === 0) return []
    return db.query.demandas.findMany({
      where: and(eq(demandas.mostrarPainelFinanceiro, true), inArray(demandas.estagioId, idsAbertos)),
      with: {
        empresa: { columns: { id: true, nome: true } },
        atribuidoPara: { columns: { id: true, name: true } },
        estagio: { columns: { id: true, nome: true } },
      },
      orderBy: (d, { asc }) => [asc(d.dataLimite)],
    })
  }),
})
