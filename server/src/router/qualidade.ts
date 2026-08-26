// Controle de Qualidade (Odin Compressores) — portado de
// app/routers/quality_control.py do odincrm. Não é um módulo de dados
// próprio: é um resumo consolidado (gestor-only) de todos os Pedidos —
// anexos de todas as etapas + histórico completo, sem precisar abrir
// pedido por pedido. Consulta direto as tabelas do módulo de Ordens (Fase 1).
import { z } from 'zod'
import { and, eq, gte, lte, ne } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, ordens, ordemAnexos, ordemHistorico, ordemQualidade } from '../db/schema.js'

const SLUG_QUALIDADE = 'odin-compressores'

export const qualidadeRouter = router({
  resumo: adminProcedure
    .input(z.object({ dataDe: z.string().optional(), dataAte: z.string().optional(), vendedorId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId) })
      if (empresa?.slug !== SLUG_QUALIDADE) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })

      const condicoes = [eq(ordens.empresaId, ctx.empresaId), ne(ordens.status, 'cancelado')]
      if (input?.dataDe) condicoes.push(gte(ordens.createdAt, input.dataDe))
      if (input?.dataAte) condicoes.push(lte(ordens.createdAt, `${input.dataAte} 23:59:59`))
      if (input?.vendedorId) condicoes.push(eq(ordens.vendedorId, input.vendedorId))

      const pedidos = await db.query.ordens.findMany({
        where: and(...condicoes),
        with: { cliente: { columns: { id: true, razaoSocial: true } }, vendedor: { columns: { id: true, name: true } } },
        orderBy: (o, { desc }) => [desc(o.updatedAt)],
      })

      const resultado = []
      for (const p of pedidos) {
        const [arquivos, historico, qualidade] = await Promise.all([
          db.query.ordemAnexos.findMany({ where: eq(ordemAnexos.ordemId, p.id), orderBy: (a, { desc }) => [desc(a.createdAt)] }),
          db.query.ordemHistorico.findMany({ where: eq(ordemHistorico.ordemId, p.id), with: { user: { columns: { id: true, name: true } } }, orderBy: (h, { desc }) => [desc(h.createdAt)] }),
          db.query.ordemQualidade.findFirst({ where: eq(ordemQualidade.ordemId, p.id) }),
        ])
        resultado.push({
          ordemId: p.id,
          clienteNome: p.cliente?.razaoSocial ?? '—',
          vendedorNome: p.vendedor?.name ?? '—',
          stage: p.stage,
          status: p.status,
          createdAt: p.createdAt,
          observacoesQualidade: qualidade?.observacoes ?? null,
          arquivos,
          historico,
        })
      }
      return resultado
    }),
})
