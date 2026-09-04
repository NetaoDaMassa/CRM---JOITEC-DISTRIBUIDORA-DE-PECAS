// Marketing: Arquivos/Mídia — biblioteca de pastas/arquivos por empresa.
// Ver quem baixa (marketingArquivoDownloads) e listar é liberado pra
// qualquer um com a feature 'arquivos' (admin sempre passa, vendedor
// precisa da feature concedida em Permissões — mesmo padrão de
// adminOrFeatureProcedure usado no resto do CRM). Criar pasta/subir
// arquivo/excluir é admin-only de verdade (pedido do João, 2026-09-04).
import { z } from 'zod'
import { and, eq, isNull, inArray } from 'drizzle-orm'
import { router, adminProcedure, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { marketingPastas, marketingArquivos, marketingArquivoDownloads } from '../db/schema.js'

export const marketingRouter = router({
  // pastaId ausente = raiz da empresa.
  listarPastas: adminOrFeatureProcedure('arquivos')
    .input(z.object({ pastaId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      return db.query.marketingPastas.findMany({
        where: input.pastaId
          ? and(eq(marketingPastas.empresaId, ctx.empresaId), eq(marketingPastas.pastaPaiId, input.pastaId))
          : and(eq(marketingPastas.empresaId, ctx.empresaId), isNull(marketingPastas.pastaPaiId)),
        orderBy: (p, { asc }) => [asc(p.nome)],
      })
    }),

  // Trilha (breadcrumb) até a raiz — pra mostrar "Marketing > Campanha 2026 > Fotos".
  caminhoPasta: adminOrFeatureProcedure('arquivos').input(z.object({ pastaId: z.number() })).query(async ({ ctx, input }) => {
    const trilha: { id: number; nome: string }[] = []
    let atualId: number | null = input.pastaId
    while (atualId) {
      const linhas: { id: number; nome: string; pastaPaiId: number | null }[] = await db
        .select({ id: marketingPastas.id, nome: marketingPastas.nome, pastaPaiId: marketingPastas.pastaPaiId })
        .from(marketingPastas)
        .where(and(eq(marketingPastas.id, atualId), eq(marketingPastas.empresaId, ctx.empresaId)))
        .limit(1)
      const pasta: { id: number; nome: string; pastaPaiId: number | null } | undefined = linhas[0]
      if (!pasta) break
      trilha.unshift({ id: pasta.id, nome: pasta.nome })
      atualId = pasta.pastaPaiId
    }
    return trilha
  }),

  criarPasta: adminProcedure
    .input(z.object({ nome: z.string().min(1), pastaPaiId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(marketingPastas).values({
        empresaId: ctx.empresaId,
        nome: input.nome,
        pastaPaiId: input.pastaPaiId ?? null,
        criadoPor: ctx.user.id,
      })
      return db.query.marketingPastas.findFirst({ where: eq(marketingPastas.id, Number(result.lastInsertRowid)) })
    }),

  renomearPasta: adminProcedure.input(z.object({ id: z.number(), nome: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await db.update(marketingPastas).set({ nome: input.nome }).where(and(eq(marketingPastas.id, input.id), eq(marketingPastas.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  // Exclui a pasta, subpastas e arquivos dentro (cascade no banco) — aviso
  // "isso vai apagar N arquivos" fica por conta do front antes de confirmar.
  excluirPasta: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await db.delete(marketingPastas).where(and(eq(marketingPastas.id, input.id), eq(marketingPastas.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  // pastaId ausente = arquivos soltos na raiz da empresa.
  listarArquivos: adminOrFeatureProcedure('arquivos')
    .input(z.object({ pastaId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const arquivos = await db.query.marketingArquivos.findMany({
        where: input.pastaId
          ? and(eq(marketingArquivos.empresaId, ctx.empresaId), eq(marketingArquivos.pastaId, input.pastaId))
          : and(eq(marketingArquivos.empresaId, ctx.empresaId), isNull(marketingArquivos.pastaId)),
        with: { enviadoPorUser: { columns: { id: true, name: true } } },
        orderBy: (a, { desc }) => [desc(a.createdAt)],
      })
      if (arquivos.length === 0) return []
      const contagens = await db
        .select({ arquivoId: marketingArquivoDownloads.arquivoId })
        .from(marketingArquivoDownloads)
        .where(inArray(marketingArquivoDownloads.arquivoId, arquivos.map((a) => a.id)))
      const contagemPorArquivo = new Map<number, number>()
      for (const c of contagens) contagemPorArquivo.set(c.arquivoId, (contagemPorArquivo.get(c.arquivoId) ?? 0) + 1)
      const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
      return arquivos.map((a) => ({
        ...a,
        // Quem não é admin nunca recebe o nome real em disco de um arquivo
        // "somente visualização" — sem isso, dava pra montar a URL de
        // /uploads na mão e baixar mesmo sem o botão (ver preview.tsx, que
        // busca o conteúdo pela rota autenticada /marketing-arquivo/:id/conteudo).
        nomeArmazenado: !souAdmin && a.somenteVisualizacao ? null : a.nomeArmazenado,
        totalDownloads: contagemPorArquivo.get(a.id) ?? 0,
      }))
    }),

  // Chamado logo depois do upload cru em POST /upload/marketing-arquivo
  // (que só grava o arquivo em disco e devolve nome/tipo/tamanho) — mesmo
  // padrão de ordens.anexos.registrar.
  registrarArquivo: adminProcedure
    .input(
      z.object({
        pastaId: z.number().optional(),
        nomeOriginal: z.string(),
        nomeArmazenado: z.string(),
        tipoArquivo: z.string().optional(),
        tamanhoBytes: z.number().optional(),
        somenteVisualizacao: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(marketingArquivos).values({
        empresaId: ctx.empresaId,
        pastaId: input.pastaId ?? null,
        nomeOriginal: input.nomeOriginal,
        nomeArmazenado: input.nomeArmazenado,
        tipoArquivo: input.tipoArquivo,
        tamanhoBytes: input.tamanhoBytes,
        somenteVisualizacao: input.somenteVisualizacao ?? false,
        enviadoPor: ctx.user.id,
      })
      return db.query.marketingArquivos.findFirst({ where: eq(marketingArquivos.id, Number(result.lastInsertRowid)) })
    }),

  // Liga/desliga "somente visualização" num arquivo já existente.
  alternarVisualizacao: adminProcedure
    .input(z.object({ id: z.number(), somenteVisualizacao: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(marketingArquivos)
        .set({ somenteVisualizacao: input.somenteVisualizacao })
        .where(and(eq(marketingArquivos.id, input.id), eq(marketingArquivos.empresaId, ctx.empresaId)))
      return { ok: true }
    }),

  excluirArquivo: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await db.delete(marketingArquivos).where(and(eq(marketingArquivos.id, input.id), eq(marketingArquivos.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  // Chamado pelo front no clique do botão/link de download — registro do
  // clique, não é uma trava de acesso em si (o arquivo baixável continua
  // servido por /uploads). Recusa se o arquivo é "somente visualização" e
  // quem chamou não é admin — defesa a mais, o front nem deveria oferecer
  // o botão de baixar nesse caso.
  registrarDownload: adminOrFeatureProcedure('arquivos').input(z.object({ arquivoId: z.number() })).mutation(async ({ ctx, input }) => {
    const arquivo = await db.query.marketingArquivos.findFirst({ where: and(eq(marketingArquivos.id, input.arquivoId), eq(marketingArquivos.empresaId, ctx.empresaId)) })
    if (!arquivo) return { ok: false }
    const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
    if (arquivo.somenteVisualizacao && !souAdmin) return { ok: false }
    await db.insert(marketingArquivoDownloads).values({ arquivoId: input.arquivoId, userId: ctx.user.id })
    return { ok: true }
  }),

  // "Quem baixou" — admin-only (vendedor não precisa ver quem mais baixou).
  listarDownloads: adminProcedure.input(z.object({ arquivoId: z.number() })).query(async ({ ctx, input }) => {
    const arquivo = await db.query.marketingArquivos.findFirst({ where: and(eq(marketingArquivos.id, input.arquivoId), eq(marketingArquivos.empresaId, ctx.empresaId)) })
    if (!arquivo) return []
    return db.query.marketingArquivoDownloads.findMany({
      where: eq(marketingArquivoDownloads.arquivoId, input.arquivoId),
      with: { user: { columns: { id: true, name: true } } },
      orderBy: (d, { desc }) => [desc(d.baixadoEm)],
    })
  }),
})
