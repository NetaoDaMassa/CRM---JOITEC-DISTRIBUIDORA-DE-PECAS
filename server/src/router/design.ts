import { z } from 'zod'
import { and, asc, desc, eq } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { solicitacoesDesign, users, empresas, marketingPastas } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { sincronizarDesignAprovadoNoNotion } from '../lib/notion.js'
import { assertPodeVerPasta } from './marketing.js'

// Pedidos do vendedor pra equipe de marketing criar uma arte (comunicado,
// oferta ou banner) — ficam pendentes até o admin aprovar (libera pra
// marketing) ou recusar. Mesmo fluxo de `aprovacoes.ts`, só que sem nenhuma
// ação automática de sistema no aprovar (quem cria a arte é a marketing,
// fora daqui).
export const designRouter = router({
  solicitar: protectedProcedure
    .input(
      z.object({
        tipo: z.enum(['comunicado', 'oferta', 'banner', 'video']),
        descricao: z.string().min(1, 'Explique o que a arte precisa transmitir'),
        preco: z.string().optional(),
        produto: z.string().optional(),
        quantidade: z.string().optional(),
        dataLimiteEntrega: z.string().optional(),
        dataLimiteValidade: z.string().optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db.insert(solicitacoesDesign).values({
        vendedorSolicitanteId: ctx.user.id,
        tipo: input.tipo,
        descricao: input.descricao,
        preco: input.preco || null,
        produto: input.produto || null,
        quantidade: input.quantidade || null,
        dataLimiteEntrega: input.dataLimiteEntrega || null,
        dataLimiteValidade: input.dataLimiteValidade || null,
        observacoes: input.observacoes || null,
      })
      return { success: true }
    }),

  // Próprios pedidos do vendedor logado, mais recentes primeiro — pra ele
  // acompanhar o status sem precisar perguntar pro admin. Traz também o
  // nome da pasta final em Arquivos/Mídia (se o admin já vinculou uma) —
  // leftJoin porque arquivoPastaId é opcional e pode nem existir ainda.
  minhas: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: solicitacoesDesign.id,
        tipo: solicitacoesDesign.tipo,
        descricao: solicitacoesDesign.descricao,
        preco: solicitacoesDesign.preco,
        produto: solicitacoesDesign.produto,
        quantidade: solicitacoesDesign.quantidade,
        dataLimiteEntrega: solicitacoesDesign.dataLimiteEntrega,
        dataLimiteValidade: solicitacoesDesign.dataLimiteValidade,
        observacoes: solicitacoesDesign.observacoes,
        status: solicitacoesDesign.status,
        respostaObservacao: solicitacoesDesign.respostaObservacao,
        notionStatus: solicitacoesDesign.notionStatus,
        arquivoPastaId: solicitacoesDesign.arquivoPastaId,
        arquivoPastaNome: marketingPastas.nome,
        createdAt: solicitacoesDesign.createdAt,
      })
      .from(solicitacoesDesign)
      .leftJoin(marketingPastas, eq(marketingPastas.id, solicitacoesDesign.arquivoPastaId))
      .where(eq(solicitacoesDesign.vendedorSolicitanteId, ctx.user.id))
      .orderBy(desc(solicitacoesDesign.createdAt))
  }),

  listarPendentes: adminProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: solicitacoesDesign.id,
        tipo: solicitacoesDesign.tipo,
        descricao: solicitacoesDesign.descricao,
        preco: solicitacoesDesign.preco,
        produto: solicitacoesDesign.produto,
        quantidade: solicitacoesDesign.quantidade,
        dataLimiteEntrega: solicitacoesDesign.dataLimiteEntrega,
        dataLimiteValidade: solicitacoesDesign.dataLimiteValidade,
        observacoes: solicitacoesDesign.observacoes,
        createdAt: solicitacoesDesign.createdAt,
        vendedorSolicitanteId: users.id,
        vendedorSolicitanteNome: users.name,
      })
      .from(solicitacoesDesign)
      .innerJoin(users, eq(solicitacoesDesign.vendedorSolicitanteId, users.id))
      .where(and(eq(solicitacoesDesign.status, 'pendente'), eq(users.empresaId, ctx.empresaId)))
      .orderBy(asc(solicitacoesDesign.createdAt))
  }),

  // Pedidos já aprovados (mais recentes primeiro) com o status do Notion —
  // pedido do João, 2026-09-14: admin também precisa acompanhar em que pé
  // está, não só o vendedor que pediu. Limitado aos últimos 30 pra não virar
  // uma lista infinita (recusado/histórico antigo não entra aqui).
  listarAprovados: adminProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: solicitacoesDesign.id,
        tipo: solicitacoesDesign.tipo,
        descricao: solicitacoesDesign.descricao,
        produto: solicitacoesDesign.produto,
        decididoEm: solicitacoesDesign.decididoEm,
        notionStatus: solicitacoesDesign.notionStatus,
        arquivoPastaId: solicitacoesDesign.arquivoPastaId,
        arquivoPastaNome: marketingPastas.nome,
        vendedorSolicitanteNome: users.name,
        // Pra montar o link wa.me do botão "Avisar no WhatsApp" (ver
        // designWhatsapp.ts no client) — o role decide se o link da pasta
        // vai pra rota /admin/arquivos ou /vendedor/arquivos.
        vendedorSolicitanteWhatsapp: users.whatsapp,
        vendedorSolicitanteRole: users.role,
      })
      .from(solicitacoesDesign)
      .innerJoin(users, eq(solicitacoesDesign.vendedorSolicitanteId, users.id))
      .leftJoin(marketingPastas, eq(marketingPastas.id, solicitacoesDesign.arquivoPastaId))
      .where(and(eq(solicitacoesDesign.status, 'aprovado'), eq(users.empresaId, ctx.empresaId)))
      .orderBy(desc(solicitacoesDesign.decididoEm))
      .limit(30)
  }),

  // Vincula (ou desvincula, pastaId null) a pasta de Arquivos/Mídia onde o
  // arquivo final ficou — feito manualmente pelo admin depois que a
  // marketing termina o trabalho, sem depender do status do Notion (que
  // pode nem estar configurado). Pedido do João, 2026-09-15: "o card da
  // solicitação mostrar pra qual pasta foi o arquivo, e a pessoa poder
  // clicar e ir direto pra ela".
  definirPastaFinal: adminProcedure
    .input(z.object({ id: z.number(), pastaId: z.number().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const solicitacao = await db.query.solicitacoesDesign.findFirst({
        where: eq(solicitacoesDesign.id, input.id),
        with: { vendedorSolicitante: { columns: { empresaId: true } } },
      })
      if (!solicitacao) throw new Error('Pedido não encontrado')
      if (solicitacao.vendedorSolicitante.empresaId !== ctx.empresaId) throw new Error('Acesso negado')

      if (input.pastaId !== null) {
        const pasta = await db.query.marketingPastas.findFirst({ where: eq(marketingPastas.id, input.pastaId) })
        if (!pasta || pasta.empresaId !== ctx.empresaId) throw new Error('Pasta não encontrada')
        await assertPodeVerPasta(ctx.user.id, ctx.user.superAdmin, input.pastaId)
      }

      await db.update(solicitacoesDesign).set({ arquivoPastaId: input.pastaId }).where(eq(solicitacoesDesign.id, input.id))
      return { success: true }
    }),

  aprovar: adminProcedure
    .input(z.object({ id: z.number(), respostaObservacao: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const solicitacao = await db.query.solicitacoesDesign.findFirst({
        where: eq(solicitacoesDesign.id, input.id),
        with: { vendedorSolicitante: { columns: { name: true } } },
      })
      if (!solicitacao) throw new Error('Pedido não encontrado')
      if (solicitacao.status !== 'pendente') throw new Error('Este pedido já foi decidido.')

      const decididoEm = agoraSqlite()
      await db
        .update(solicitacoesDesign)
        .set({
          status: 'aprovado',
          respostaObservacao: input.respostaObservacao,
          decididoPor: ctx.user.id,
          decididoEm,
        })
        .where(eq(solicitacoesDesign.id, input.id))

      // Best-effort — pedido do João, 2026-09-14: pedido aprovado cai
      // sozinho no Notion do marketing. Não bloqueia nem falha a aprovação
      // se o Notion estiver fora do ar (ver notion.ts).
      // Empresa vem de ctx.empresaId (quem aprova) — CRM é multi-empresa e
      // todas caem na mesma base do Notion, então precisa dizer de qual é.
      const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { nome: true, slug: true } })
      const notionPageId = await sincronizarDesignAprovadoNoNotion({
        tipo: solicitacao.tipo,
        descricao: solicitacao.descricao,
        preco: solicitacao.preco,
        produto: solicitacao.produto,
        quantidade: solicitacao.quantidade,
        dataLimiteEntrega: solicitacao.dataLimiteEntrega,
        dataLimiteValidade: solicitacao.dataLimiteValidade,
        observacoes: solicitacao.observacoes,
        vendedorNome: solicitacao.vendedorSolicitante.name,
        empresaNome: empresa?.nome ?? 'Desconhecida',
        empresaSlug: empresa?.slug ?? '',
        decididoEm,
      })
      // Guarda o id da página pra dar pra consultar o status de volta
      // depois (ver lib/pollNotionStatus.ts) — "Não iniciada" é o valor
      // inicial que a própria criação da página já usa, então já entra
      // certo aqui, sem esperar a primeira rodada do polling.
      if (notionPageId) {
        await db
          .update(solicitacoesDesign)
          .set({ notionPageId, notionStatus: 'Não iniciada', notionStatusAtualizadoEm: decididoEm })
          .where(eq(solicitacoesDesign.id, input.id))
      }

      return { success: true }
    }),

  // Exclusão de verdade (não é recusar) — pedido do João, 2026-09-15: dar
  // pra apagar um pedido de arte/vídeo (teste, duplicado, engano) direto
  // no CRM. Não mexe na página já criada no Notion (se tiver) — só some
  // daqui; o time de marketing continua vendo lá se já tinha ido.
  excluir: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const solicitacao = await db.query.solicitacoesDesign.findFirst({
        where: eq(solicitacoesDesign.id, input.id),
        with: { vendedorSolicitante: { columns: { empresaId: true } } },
      })
      if (!solicitacao) throw new Error('Pedido não encontrado')
      if (solicitacao.vendedorSolicitante.empresaId !== ctx.empresaId) throw new Error('Acesso negado')

      await db.delete(solicitacoesDesign).where(eq(solicitacoesDesign.id, input.id))
      return { success: true }
    }),

  recusar: adminProcedure
    .input(z.object({ id: z.number(), respostaObservacao: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const solicitacao = await db.query.solicitacoesDesign.findFirst({ where: eq(solicitacoesDesign.id, input.id) })
      if (!solicitacao) throw new Error('Pedido não encontrado')
      if (solicitacao.status !== 'pendente') throw new Error('Este pedido já foi decidido.')

      await db
        .update(solicitacoesDesign)
        .set({
          status: 'recusado',
          respostaObservacao: input.respostaObservacao,
          decididoPor: ctx.user.id,
          decididoEm: agoraSqlite(),
        })
        .where(eq(solicitacoesDesign.id, input.id))
      return { success: true }
    }),
})
