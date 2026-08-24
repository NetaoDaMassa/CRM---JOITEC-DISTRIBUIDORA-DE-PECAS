import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { router, adminProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { funcaoTemplates, funcaoTemplateFeatures, users } from '../db/schema.js'
import { FEATURES_ADMIN, FEATURES_VENDEDOR, FEATURES_RELATORIOS } from './permissoes.js'

const featureSchema = z.enum([...FEATURES_ADMIN, ...FEATURES_VENDEDOR, ...FEATURES_RELATORIOS])

export const funcaoTemplatesRouter = router({
  // Qualquer admin lê (precisa pro dropdown "Função" na criação de usuário)
  // — só o superAdmin cria/edita/exclui os modelos em si (mesma regra da
  // tela de Permissões).
  listar: adminProcedure.query(async ({ ctx }) => {
    const templates = await db.query.funcaoTemplates.findMany({
      where: eq(funcaoTemplates.empresaId, ctx.empresaId),
      with: { features: true },
      orderBy: (t, { asc }) => [asc(t.nome)],
    })
    return templates.map((t) => ({ id: t.id, nome: t.nome, role: t.role, features: t.features.map((f) => f.feature) }))
  }),

  criar: superAdminProcedure
    .input(
      z.object({
        nome: z.string().min(2),
        role: z.enum(['admin', 'vendor']),
        features: z.array(featureSchema),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(funcaoTemplates).values({ empresaId: ctx.empresaId, nome: input.nome, role: input.role })
      const id = Number(result.lastInsertRowid)
      if (input.features.length > 0) {
        await db.insert(funcaoTemplateFeatures).values(input.features.map((feature) => ({ templateId: id, feature })))
      }
      return { id }
    }),

  // Editar o template NÃO reaplica nada em quem já foi criado com ele —
  // só vale pros próximos usuários criados com essa função (ver comentário
  // em users.ts `create`). Evita apagar um ajuste manual que o superAdmin já
  // tenha feito pra alguém específico em Permissões.
  atualizar: superAdminProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().min(2).optional(),
        role: z.enum(['admin', 'vendor']).optional(),
        features: z.array(featureSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const template = await db.query.funcaoTemplates.findFirst({
        where: and(eq(funcaoTemplates.id, input.id), eq(funcaoTemplates.empresaId, ctx.empresaId)),
      })
      if (!template) throw new Error('Função não encontrada')

      if (input.nome !== undefined || input.role !== undefined) {
        await db
          .update(funcaoTemplates)
          .set({ ...(input.nome !== undefined ? { nome: input.nome } : {}), ...(input.role !== undefined ? { role: input.role } : {}) })
          .where(eq(funcaoTemplates.id, input.id))
      }

      if (input.features !== undefined) {
        await db.delete(funcaoTemplateFeatures).where(eq(funcaoTemplateFeatures.templateId, input.id))
        if (input.features.length > 0) {
          await db.insert(funcaoTemplateFeatures).values(input.features.map((feature) => ({ templateId: input.id, feature })))
        }
      }

      return { success: true }
    }),

  excluir: superAdminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const template = await db.query.funcaoTemplates.findFirst({
      where: and(eq(funcaoTemplates.id, input.id), eq(funcaoTemplates.empresaId, ctx.empresaId)),
    })
    if (!template) throw new Error('Função não encontrada')

    const emUso = await db.query.users.findFirst({ where: eq(users.funcaoTemplateId, input.id), columns: { id: true } })
    if (emUso) throw new Error('Existe usuário usando essa função — troque a função dele(s) em Usuários antes de excluir.')

    await db.delete(funcaoTemplates).where(eq(funcaoTemplates.id, input.id))
    return { success: true }
  }),
})
