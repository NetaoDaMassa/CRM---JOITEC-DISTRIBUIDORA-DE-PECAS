import { z } from 'zod'
import { router, featureProcedure } from './_base.js'
import { FEATURE_PEDIDOS_TROCADOS, gravarIgnorado, lerIgnorados, revisarPedidosTrocados, ultimoResultado } from '../lib/pedidosTrocados.js'

// Pedidos × clientes trocados (SAP × CRM) — ver lib/pedidosTrocados.ts.
// Tela de REVISÃO do grupo todo (Joitec, Odin Tubos, Odin Automação, Odin
// Compressores): só lê; o admin pode marcar "está certo".
const proc = featureProcedure(FEATURE_PEDIDOS_TROCADOS)

export const pedidosTrocadosRouter = router({
  obter: proc.query(async () => {
    const r = (await ultimoResultado()) ?? (await revisarPedidosTrocados())
    const ign = await lerIgnorados()
    return { ...r, itens: r.itens.map((i) => ({ ...i, ignorado: ign[i.chave] ?? null })) }
  }),

  revisarAgora: proc.mutation(async () => {
    const r = await revisarPedidosTrocados()
    return { total: r.itens.length, fonte: r.fonte }
  }),

  marcarCerto: proc.input(z.object({ chave: z.string().min(3), motivo: z.string().trim().min(3, 'Escreva o motivo.') })).mutation(async ({ ctx, input }) => {
    await gravarIgnorado(input.chave, input.motivo, ctx.user.name)
    return { ok: true }
  }),

  desfazerCerto: proc.input(z.object({ chave: z.string().min(3) })).mutation(async ({ ctx, input }) => {
    await gravarIgnorado(input.chave, null, ctx.user.name)
    return { ok: true }
  }),
})
