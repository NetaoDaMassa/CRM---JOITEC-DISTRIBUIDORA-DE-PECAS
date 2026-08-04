import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { registroContato, funilMensal } from '../db/schema.js'
import { mesReferenciaAtual, agoraSqlite } from '../lib/dataBr.js'

export const contatosRouter = router({
  // Chamado automaticamente quando o botão de WhatsApp é clicado (abre o
  // wa.me em paralelo) — registra a tentativa com resultado pendente, pra
  // depois o vendedor/admin confirmar no histórico do card (Kanban) se o
  // contato foi respondido ou não. Resolve o funil do mês corrente a partir
  // do cliente, já que o botão só tem o clienteId disponível.
  registrarWhatsapp: protectedProcedure
    .input(z.object({ clienteId: z.number(), funilMensalId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Cliente com mais de um orçamento aberto no mês tem mais de um card —
      // quando o clique veio de dentro de um card específico (Kanban), usa o
      // funilMensalId dele em vez de adivinhar por clienteId, senão o contato
      // pode ser registrado no orçamento errado.
      const funil = input.funilMensalId
        ? await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, input.funilMensalId) })
        : await db.query.funilMensal.findFirst({
            where: and(eq(funilMensal.clienteId, input.clienteId), eq(funilMensal.mesReferencia, mesReferenciaAtual())),
            orderBy: (f, { desc }) => [desc(f.dataUltimoContato)],
          })
      if (!funil) throw new Error('Cliente sem funil aberto neste mês — não foi possível registrar o contato.')
      if (ctx.user.role !== 'admin' && funil.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

      await db.insert(registroContato).values({
        funilMensalId: funil.id,
        vendedorId: ctx.user.id,
        tipo: 'whatsapp',
        observacao: 'WhatsApp aberto pelo sistema — aguardando confirmação se o contato foi realizado.',
      })

      await db
        .update(funilMensal)
        .set({ qtdTentativasContato: funil.qtdTentativasContato + 1, dataUltimoContato: agoraSqlite() })
        .where(eq(funilMensal.id, funil.id))

      return { success: true }
    }),

  registrar: protectedProcedure
    .input(
      z.object({
        funilMensalId: z.number(),
        tipo: z.enum(['ligacao', 'whatsapp', 'email', 'visita']),
        resultado: z.enum(['respondeu', 'nao_respondeu', 'numero_errado']).optional(),
        observacao: z.string().min(1, 'A observação é obrigatória.'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const funil = await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, input.funilMensalId) })
      if (!funil) throw new Error('Card não encontrado')
      if (ctx.user.role !== 'admin' && funil.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

      await db.insert(registroContato).values({
        funilMensalId: input.funilMensalId,
        vendedorId: ctx.user.id,
        tipo: input.tipo,
        resultado: input.resultado,
        // Registro manual não tem cronômetro — "efetiva" aqui vem de o
        // vendedor ter marcado que a pessoa atendeu/respondeu.
        efetiva: input.tipo === 'ligacao' ? input.resultado === 'respondeu' : null,
        observacao: input.observacao,
      })

      await db
        .update(funilMensal)
        .set({
          qtdTentativasContato: funil.qtdTentativasContato + 1,
          dataUltimoContato: agoraSqlite(),
        })
        .where(eq(funilMensal.id, input.funilMensalId))

      return { success: true }
    }),

  editar: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        resultado: z.enum(['respondeu', 'nao_respondeu', 'numero_errado']).optional(),
        observacao: z.string().min(1, 'A observação é obrigatória.'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const contato = await db.query.registroContato.findFirst({ where: eq(registroContato.id, input.id) })
      if (!contato) throw new Error('Contato não encontrado')

      const podeEditar =
        ctx.user.role === 'admin' ||
        (contato.vendedorId === ctx.user.id &&
          (await ehMesCorrente(contato.funilMensalId)))
      if (!podeEditar) throw new Error('Não é mais possível editar este contato (mês fechado ou não é seu).')

      await db
        .update(registroContato)
        .set({
          observacao: input.observacao,
          resultado: input.resultado,
          efetiva: contato.tipo === 'ligacao' ? input.resultado === 'respondeu' : contato.efetiva,
        })
        .where(eq(registroContato.id, input.id))
      return { success: true }
    }),

  excluir: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const contato = await db.query.registroContato.findFirst({ where: eq(registroContato.id, input.id) })
    if (!contato) throw new Error('Contato não encontrado')

    const podeExcluir =
      ctx.user.role === 'admin' ||
      (contato.vendedorId === ctx.user.id && (await ehMesCorrente(contato.funilMensalId)))
    if (!podeExcluir) throw new Error('Não é mais possível excluir este contato (mês fechado ou não é seu).')

    await db.update(registroContato).set({ deletedAt: new Date().toISOString() }).where(eq(registroContato.id, input.id))
    return { success: true }
  }),
})

async function ehMesCorrente(funilMensalId: number): Promise<boolean> {
  const funil = await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, funilMensalId) })
  return funil?.mesReferencia === mesReferenciaAtual()
}
