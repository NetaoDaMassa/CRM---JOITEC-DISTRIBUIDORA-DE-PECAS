import { z } from 'zod'
import { and, eq, isNull, lte } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { registroContato, funilMensal, compromissos } from '../db/schema.js'
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
        origem: 'whatsapp_automatico',
        observacao: 'WhatsApp aberto pelo sistema — aguardando confirmação se o contato foi realizado.',
      })

      // Só conta como tentativa de contato de verdade quando confirmado
      // (ver `confirmar`/`editar` abaixo) — abrir o wa.me sozinho não prova
      // que teve conversa, senão infla a Cobertura de Contatos e destrava
      // sair de "Novo" sem contato nenhum (achado do João, 2026-08-28).
      return { success: true }
    }),

  registrar: protectedProcedure
    .input(
      z.object({
        funilMensalId: z.number(),
        tipo: z.enum(['ligacao', 'whatsapp', 'email', 'visita']),
        resultado: z.enum(['respondeu', 'nao_respondeu', 'numero_errado', 'caixa_postal']).optional(),
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

      // Contato de verdade acabou de ser registrado — se o cliente tinha
      // compromisso pendente já atrasado (badge vermelho no card), considera
      // resolvido: o vendedor fez contato, só não bateu exatamente na hora
      // marcada. Só os JÁ atrasados (dataHora no passado) — um lembrete
      // futuro não deve fechar sozinho só porque teve outro contato hoje.
      await db
        .update(compromissos)
        .set({ concluido: true, updatedAt: agoraSqlite() })
        .where(
          and(
            eq(compromissos.clienteId, funil.clienteId),
            eq(compromissos.concluido, false),
            isNull(compromissos.deletedAt),
            lte(compromissos.dataHora, agoraSqlite())
          )
        )

      return { success: true }
    }),

  // Botão "Confirmar" do card — fecha o estado "aguardando confirmação" sem
  // exigir que o vendedor escreva nada nem diga se a pessoa respondeu.
  // Marca resultado='confirmado' (não conta como `efetiva` — só "respondeu"
  // conta, ver editar) e, se o card ainda estiver em "Novo", já move pra
  // "Abordagem" (regra pedida: confirmar um contato tira o cliente de Novo).
  //
  // É AQUI (e em `editar`, na 1ª vez que o registro ganha um resultado) que
  // um registro automático (whatsapp_automatico/ligacao_automatica) passa a
  // contar em funilMensal.qtdTentativasContato — antes disso ele fica
  // "pendente" e não conta, pra não inflar a Cobertura de Contatos nem
  // destravar sair de "Novo" sozinho (achado do João, 2026-08-28).
  confirmar: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const contato = await db.query.registroContato.findFirst({ where: eq(registroContato.id, input.id) })
    if (!contato) throw new Error('Contato não encontrado')

    const podeConfirmar =
      ctx.user.role === 'admin' || (contato.vendedorId === ctx.user.id && (await ehMesCorrente(contato.funilMensalId)))
    if (!podeConfirmar) throw new Error('Não é mais possível confirmar este contato (mês fechado ou não é seu).')

    if (!contato.resultado) {
      await db.update(registroContato).set({ resultado: 'confirmado' }).where(eq(registroContato.id, input.id))
      if (contato.origem !== 'manual') await contarTentativaSePendente(contato.funilMensalId)
    }
    return { success: true }
  }),

  editar: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        resultado: z.enum(['respondeu', 'nao_respondeu', 'numero_errado', 'caixa_postal', 'confirmado']).optional(),
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

      const eraPendente = !contato.resultado

      await db
        .update(registroContato)
        .set({
          observacao: input.observacao,
          resultado: input.resultado,
          efetiva: contato.tipo === 'ligacao' ? input.resultado === 'respondeu' : contato.efetiva,
        })
        .where(eq(registroContato.id, input.id))

      // Editar um registro automático ainda pendente e dar um resultado a
      // ele conta como a 1ª confirmação, igual clicar em "Confirmar" — ver
      // comentário lá.
      if (eraPendente && input.resultado && contato.origem !== 'manual') {
        await contarTentativaSePendente(contato.funilMensalId)
      }
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

// Só chamada pra registro automático que ainda estava sem resultado (nunca
// tinha sido contado) — resultado não volta pra null depois de definido,
// então isso nunca conta a mesma tentativa 2x.
async function contarTentativaSePendente(funilMensalId: number): Promise<void> {
  const funil = await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, funilMensalId) })
  if (!funil) return
  await db
    .update(funilMensal)
    .set({ qtdTentativasContato: funil.qtdTentativasContato + 1, dataUltimoContato: agoraSqlite() })
    .where(eq(funilMensal.id, funilMensalId))
}
