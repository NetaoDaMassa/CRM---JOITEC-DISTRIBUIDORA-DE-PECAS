import { z } from 'zod'
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, featureProcedure, temFeature } from './_base.js'
import { db } from '../db/client.js'
import { contabilidadeArquivos, contabilidadePastas, empresas, users } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'

// Arquivos para contabilidade (Suy, contas a pagar, 2026-11-13) — "cópia" do
// Arquivos/Mídia só pro financeiro, com travas:
//  • só quem tem 'arquivos_contabilidade' vê (nem com link direto abre — o
//    arquivo fica em uploads/privado-contabilidade, servido pela rota
//    /contabilidade-arquivo/:id que checa a permissão);
//  • excluir arquivo = lixeira (quem enviou ou quem gerencia); só quem tem
//    'arquivos_contabilidade_gerenciar' renomeia/apaga pasta, vê a lixeira e
//    restaura;
//  • pasta só é apagada vazia.
// Cross-empresa: escolhe a empresa no topo da tela.
const FEATURE = 'arquivos_contabilidade'
const GERENCIAR = 'arquivos_contabilidade_gerenciar'

async function podeGerenciar(user: { id: number; superAdmin: boolean }) {
  return user.superAdmin || (await temFeature(user.id, GERENCIAR))
}

async function exigirGerenciar(user: { id: number; superAdmin: boolean }) {
  if (!(await podeGerenciar(user))) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só quem gerencia os arquivos da contabilidade pode fazer isso.' })
}

async function acharPasta(id: number) {
  const p = await db.query.contabilidadePastas.findFirst({ where: eq(contabilidadePastas.id, id) })
  if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pasta não encontrada' })
  return p
}

export const arquivosContabilidadeRouter = router({
  inicio: featureProcedure(FEATURE).query(async ({ ctx }) => ({
    empresas: await db.select({ id: empresas.id, nome: empresas.nome }).from(empresas).orderBy(asc(empresas.id)),
    podeGerenciar: await podeGerenciar(ctx.user),
  })),

  listar: featureProcedure(FEATURE)
    .input(z.object({ empresaId: z.number(), pastaId: z.number().nullable() }))
    .query(async ({ input }) => {
      const pastas = await db
        .select()
        .from(contabilidadePastas)
        .where(and(eq(contabilidadePastas.empresaId, input.empresaId), input.pastaId ? eq(contabilidadePastas.pastaPaiId, input.pastaId) : isNull(contabilidadePastas.pastaPaiId)))
        .orderBy(asc(contabilidadePastas.nome))
      const arquivos = await db
        .select({
          id: contabilidadeArquivos.id,
          nome: contabilidadeArquivos.nomeOriginal,
          tipo: contabilidadeArquivos.tipoArquivo,
          tamanho: contabilidadeArquivos.tamanhoBytes,
          createdAt: contabilidadeArquivos.createdAt,
          enviadoPorId: contabilidadeArquivos.enviadoPor,
          enviadoPor: users.name,
        })
        .from(contabilidadeArquivos)
        .leftJoin(users, eq(users.id, contabilidadeArquivos.enviadoPor))
        .where(
          and(
            eq(contabilidadeArquivos.empresaId, input.empresaId),
            input.pastaId ? eq(contabilidadeArquivos.pastaId, input.pastaId) : isNull(contabilidadeArquivos.pastaId),
            isNull(contabilidadeArquivos.excluidoEm)
          )
        )
        .orderBy(desc(contabilidadeArquivos.createdAt))
      // Trilha até a raiz.
      const trilha: { id: number; nome: string }[] = []
      let atual = input.pastaId
      while (atual) {
        const p = await db.query.contabilidadePastas.findFirst({ where: eq(contabilidadePastas.id, atual) })
        if (!p) break
        trilha.unshift({ id: p.id, nome: p.nome })
        atual = p.pastaPaiId
      }
      return { pastas, arquivos, trilha }
    }),

  criarPasta: featureProcedure(FEATURE)
    .input(z.object({ empresaId: z.number(), pastaPaiId: z.number().nullable(), nome: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      if (input.pastaPaiId) {
        const pai = await acharPasta(input.pastaPaiId)
        if (pai.empresaId !== input.empresaId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pasta de outra empresa' })
      }
      await db.insert(contabilidadePastas).values({ empresaId: input.empresaId, pastaPaiId: input.pastaPaiId, nome: input.nome, criadoPor: ctx.user.id })
      return { ok: true }
    }),

  renomearPasta: featureProcedure(FEATURE)
    .input(z.object({ id: z.number(), nome: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      await exigirGerenciar(ctx.user)
      await acharPasta(input.id)
      await db.update(contabilidadePastas).set({ nome: input.nome }).where(eq(contabilidadePastas.id, input.id))
      return { ok: true }
    }),

  excluirPasta: featureProcedure(FEATURE)
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await exigirGerenciar(ctx.user)
      await acharPasta(input.id)
      const sub = await db.query.contabilidadePastas.findFirst({ where: eq(contabilidadePastas.pastaPaiId, input.id), columns: { id: true } })
      const arq = await db.query.contabilidadeArquivos.findFirst({ where: eq(contabilidadeArquivos.pastaId, input.id), columns: { id: true } })
      if (sub || arq) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A pasta não está vazia (tem subpasta ou arquivo, inclusive na lixeira).' })
      await db.delete(contabilidadePastas).where(eq(contabilidadePastas.id, input.id))
      return { ok: true }
    }),

  registrarArquivo: featureProcedure(FEATURE)
    .input(
      z.object({
        empresaId: z.number(),
        pastaId: z.number().nullable(),
        nomeArmazenado: z.string().regex(/^contab-[\w-]+(\.[\w]+)?$/),
        nome: z.string().min(1).max(255),
        tipo: z.string().max(120).nullable().optional(),
        tamanho: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.pastaId) {
        const p = await acharPasta(input.pastaId)
        if (p.empresaId !== input.empresaId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pasta de outra empresa' })
      }
      await db.insert(contabilidadeArquivos).values({
        empresaId: input.empresaId,
        pastaId: input.pastaId,
        nomeOriginal: input.nome,
        nomeArmazenado: input.nomeArmazenado,
        tipoArquivo: input.tipo ?? null,
        tamanhoBytes: input.tamanho ?? null,
        enviadoPor: ctx.user.id,
      })
      return { ok: true }
    }),

  excluirArquivo: featureProcedure(FEATURE)
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const a = await db.query.contabilidadeArquivos.findFirst({ where: eq(contabilidadeArquivos.id, input.id) })
      if (!a) throw new TRPCError({ code: 'NOT_FOUND', message: 'Arquivo não encontrado' })
      if (a.enviadoPor !== ctx.user.id) await exigirGerenciar(ctx.user)
      await db.update(contabilidadeArquivos).set({ excluidoEm: agoraSqlite(), excluidoPor: ctx.user.id }).where(eq(contabilidadeArquivos.id, a.id))
      return { ok: true }
    }),

  lixeira: featureProcedure(FEATURE)
    .input(z.object({ empresaId: z.number() }))
    .query(async ({ ctx, input }) => {
      await exigirGerenciar(ctx.user)
      return db
        .select({ id: contabilidadeArquivos.id, nome: contabilidadeArquivos.nomeOriginal, excluidoEm: contabilidadeArquivos.excluidoEm, excluidoPor: users.name, pasta: contabilidadePastas.nome })
        .from(contabilidadeArquivos)
        .leftJoin(users, eq(users.id, contabilidadeArquivos.excluidoPor))
        .leftJoin(contabilidadePastas, eq(contabilidadePastas.id, contabilidadeArquivos.pastaId))
        .where(and(eq(contabilidadeArquivos.empresaId, input.empresaId), isNotNull(contabilidadeArquivos.excluidoEm)))
        .orderBy(desc(contabilidadeArquivos.excluidoEm))
        .limit(300)
    }),

  restaurar: featureProcedure(FEATURE)
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await exigirGerenciar(ctx.user)
      await db.update(contabilidadeArquivos).set({ excluidoEm: null, excluidoPor: null }).where(eq(contabilidadeArquivos.id, input.id))
      return { ok: true }
    }),
})
