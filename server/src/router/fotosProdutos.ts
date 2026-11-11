// Fotos dos produtos (lib/fotosProdutos.ts): escolher a foto de um item a
// partir das pastas de produtos do Arquivos/Mídia — pra Odin Automação, cujas
// fotos vieram do WhatsApp sem nome, e pra corrigir qualquer foto ligada
// errada. Trocar = superAdmin ou admin com Cotações ou Controle do Estoque.
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { itemFotos } from '../db/schema.js'
import { arquivosDasPastasDeProdutos } from '../lib/fotosProdutos.js'
import { protectedProcedure, router, temFeature } from './_base.js'

export async function podeTrocarFotoProduto(user: { id: number; role: string; superAdmin?: boolean | null }): Promise<boolean> {
  if (user.superAdmin) return true
  if (user.role !== 'admin') return false
  return (await temFeature(user.id, 'cotacoes')) || (await temFeature(user.id, 'controle_estoque'))
}

export const fotosProdutosRouter = router({
  podeTrocar: protectedProcedure.query(({ ctx }) => podeTrocarFotoProduto(ctx.user)),

  // Imagens das 3 pastas de produtos (Joitec, Odin Tubos, Odin Automação).
  opcoes: protectedProcedure.query(async ({ ctx }) => {
    if (!(await podeTrocarFotoProduto(ctx.user))) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão para trocar foto' })
    return (await arquivosDasPastasDeProdutos()).map((a) => ({ arquivoId: a.arquivoId, empresa: a.empresa, caminho: a.caminho, nome: a.nome, url: a.url }))
  }),

  // Escolhida à mão = vale sempre (origem 'upload'), igual foto enviada.
  escolher: protectedProcedure.input(z.object({ itemCodigo: z.string().regex(/^[A-Za-z0-9._-]{1,30}$/), arquivoId: z.number().int() })).mutation(async ({ ctx, input }) => {
    if (!(await podeTrocarFotoProduto(ctx.user))) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão para trocar foto' })
    const a = (await arquivosDasPastasDeProdutos()).find((x) => x.arquivoId === input.arquivoId)
    if (!a) throw new TRPCError({ code: 'NOT_FOUND', message: 'Foto não encontrada nas pastas de produtos' })
    await db
      .insert(itemFotos)
      .values({ itemCodigo: input.itemCodigo, url: a.url, origem: 'upload', atualizadoPorId: ctx.user.id })
      .onConflictDoUpdate({ target: itemFotos.itemCodigo, set: { url: a.url, origem: 'upload', atualizadoPorId: ctx.user.id, atualizadoEm: sql`(datetime('now'))` } })
    return { url: a.url }
  }),
})
