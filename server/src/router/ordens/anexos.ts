// Registro dos anexos (o upload físico em si acontece por rota Express com
// multer em server/src/index.ts — tRPC não aceita multipart; ver
// devolucao-anexo pro mesmo padrão já usado no resto do CRM). Aqui só
// grava/lista/apaga a linha no banco depois que o arquivo já está em disco.
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, adminOrFeatureProcedure } from '../_base.js'
import { db } from '../../db/client.js'
import { ordemAnexos } from '../../db/schema.js'
import fs from 'fs'
import path from 'path'
import { registrarHistoricoOrdem } from '../../lib/ordensGates.js'
import { assertEmpresaOrdens, assertOrdemAlcancavel } from './core.js'

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads'

export const ordensAnexosRouter = router({
  listar: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number(), stage: z.string().optional() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    return db.query.ordemAnexos.findMany({
      where: input.stage ? and(eq(ordemAnexos.ordemId, input.ordemId), eq(ordemAnexos.stage, input.stage)) : eq(ordemAnexos.ordemId, input.ordemId),
      orderBy: (a, { desc }) => [desc(a.createdAt)],
    })
  }),

  registrar: adminOrFeatureProcedure('pedidos_odin')
    .input(
      z.object({
        ordemId: z.number(),
        stage: z.string(),
        fileCategory: z.string().optional(),
        nomeOriginal: z.string(),
        nomeArmazenado: z.string(),
        tipoArquivo: z.string().optional(),
        tamanhoBytes: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
      const result = await db.insert(ordemAnexos).values({ ...input, enviadoPor: ctx.user.id })
      await registrarHistoricoOrdem({
        ordemId: input.ordemId,
        userId: ctx.user.id,
        action: 'file_upload',
        description: `Arquivo "${input.nomeOriginal}" anexado${input.fileCategory ? ` (${input.fileCategory})` : ''}`,
        stage: ordem.stage,
      })
      return { id: Number(result.lastInsertRowid) }
    }),

  excluir: adminProcedure.input(z.object({ id: z.number(), ordemId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    const anexo = await db.query.ordemAnexos.findFirst({ where: and(eq(ordemAnexos.id, input.id), eq(ordemAnexos.ordemId, input.ordemId)) })
    if (!anexo) throw new TRPCError({ code: 'NOT_FOUND', message: 'Anexo não encontrado' })

    await db.delete(ordemAnexos).where(eq(ordemAnexos.id, input.id))
    const caminho = path.resolve(UPLOADS_DIR, anexo.nomeArmazenado)
    if (fs.existsSync(caminho)) fs.unlinkSync(caminho)

    await registrarHistoricoOrdem({ ordemId: input.ordemId, userId: ctx.user.id, action: 'file_delete', description: `Arquivo "${anexo.nomeOriginal}" removido`, stage: ordem.stage })
    return { ok: true }
  }),
})
