// Marketing: Arquivos/Mídia — biblioteca de pastas/arquivos por empresa.
// Ver/listar/baixar é liberado pra QUALQUER usuário autenticado (admin ou
// vendedor), sem precisar de permissão concedida em Permissões — pedido do
// João, 2026-09-05: "disponibilizar pra todos os usuários, de acordo com a
// empresa". O "de acordo com a empresa" já é automático: todo endpoint aqui
// filtra por ctx.empresaId, então cada usuário só vê o que é da própria
// empresa, nunca de outra. Criar pasta/subir arquivo/excluir continua
// admin-only de verdade (pedido do João, 2026-09-04) — isso não mudou.
//
// Controle de acesso por pasta (2026-09-11, pedido do João: "quero
// controlar pra quem de fato vai ter acesso a esse conteúdo, com todos os
// usuários") — cada pasta pode ter uma lista de usuários específicos que
// podem vê-la (e o que tem dentro); sem lista = aberta pra todo mundo da
// empresa, igual sempre foi. Ver assertPodeVerPasta abaixo.
import { z } from 'zod'
import { and, eq, isNull, inArray } from 'drizzle-orm'
import { router, adminProcedure, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { marketingPastas, marketingArquivos, marketingArquivoDownloads, marketingPastaAcessos, solicitacoesDesign } from '../db/schema.js'

// Sem nenhuma linha em marketingPastaAcessos pra essa pasta = aberta pra
// todo mundo da empresa (comportamento de sempre — pastas já existentes
// não mudam quando esse controle foi criado, 2026-09-11). Com 1+ linha, só
// quem está listado enxerga; superAdmin sempre passa, igual no resto do
// sistema. Usado tanto pra listar (pasta/arquivos) quanto pra gerenciar
// (renomear/excluir/editar acesso) — se você não pode ver, também não
// pode mexer.
// Exportada — reaproveitada por design.ts (ver `definirPastaFinal`) pra
// checar se o admin que está vinculando um pedido de arte a uma pasta
// também pode enxergar essa pasta (mesma regra de sempre: pasta restrita
// só deixa quem está na lista, superAdmin sempre passa).
export async function assertPodeVerPasta(userId: number, superAdmin: boolean, pastaId: number) {
  if (superAdmin) return
  const acessos = await db.query.marketingPastaAcessos.findMany({ where: eq(marketingPastaAcessos.pastaId, pastaId) })
  if (acessos.length === 0) return
  if (!acessos.some((a) => a.userId === userId)) {
    throw new Error('Você não tem acesso a essa pasta')
  }
}

export const marketingRouter = router({
  // pastaId ausente = raiz da empresa (a raiz nunca é restrita — só
  // subpastas podem ter controle de acesso).
  listarPastas: protectedProcedure
    .input(z.object({ pastaId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.pastaId) await assertPodeVerPasta(ctx.user.id, ctx.user.superAdmin, input.pastaId)

      const pastas = await db.query.marketingPastas.findMany({
        where: input.pastaId
          ? and(eq(marketingPastas.empresaId, ctx.empresaId), eq(marketingPastas.pastaPaiId, input.pastaId))
          : and(eq(marketingPastas.empresaId, ctx.empresaId), isNull(marketingPastas.pastaPaiId)),
        orderBy: (p, { asc }) => [asc(p.nome)],
      })
      if (pastas.length === 0) return []

      const acessos = await db.query.marketingPastaAcessos.findMany({
        where: inArray(marketingPastaAcessos.pastaId, pastas.map((p) => p.id)),
      })
      const usuariosPorPasta = new Map<number, number[]>()
      for (const a of acessos) usuariosPorPasta.set(a.pastaId, [...(usuariosPorPasta.get(a.pastaId) ?? []), a.userId])

      return pastas
        .map((p) => ({ ...p, restrita: (usuariosPorPasta.get(p.id)?.length ?? 0) > 0 }))
        .filter((p) => ctx.user.superAdmin || !p.restrita || usuariosPorPasta.get(p.id)!.includes(ctx.user.id))
    }),

  // Trilha (breadcrumb) até a raiz — pra mostrar "Marketing > Campanha 2026 > Fotos".
  caminhoPasta: protectedProcedure.input(z.object({ pastaId: z.number() })).query(async ({ ctx, input }) => {
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

  // Todas as pastas da empresa, achatadas (não em árvore) com o caminho
  // completo já montado ("Campanhas 2026 / Setembro") — alimenta o
  // seletor de pasta usado em Solicitar Arte → Aprovações ("em qual pasta
  // ficou o arquivo pronto", ver design.ts `definirPastaFinal`). Respeita
  // o mesmo controle de acesso por pasta de `listarPastas` — o admin não
  // vê (e não consegue escolher) uma pasta restrita que ele mesmo não tem
  // acesso. adminProcedure porque só quem aprova pedido de arte usa isso.
  listarTodasPastas: adminProcedure.query(async ({ ctx }) => {
    const todas = await db.query.marketingPastas.findMany({
      where: eq(marketingPastas.empresaId, ctx.empresaId),
      orderBy: (p, { asc }) => [asc(p.nome)],
    })
    if (todas.length === 0) return []

    const acessos = await db.query.marketingPastaAcessos.findMany({
      where: inArray(marketingPastaAcessos.pastaId, todas.map((p) => p.id)),
    })
    const usuariosPorPasta = new Map<number, number[]>()
    for (const a of acessos) usuariosPorPasta.set(a.pastaId, [...(usuariosPorPasta.get(a.pastaId) ?? []), a.userId])

    const porId = new Map(todas.map((p) => [p.id, p]))
    function caminhoDe(p: (typeof todas)[number]): string {
      const partes = [p.nome]
      let atual = p.pastaPaiId
      while (atual) {
        const pai = porId.get(atual)
        if (!pai) break
        partes.unshift(pai.nome)
        atual = pai.pastaPaiId
      }
      return partes.join(' / ')
    }

    return todas
      .filter((p) => {
        const lista = usuariosPorPasta.get(p.id)
        return ctx.user.superAdmin || !lista?.length || lista.includes(ctx.user.id)
      })
      .map((p) => ({ id: p.id, nome: p.nome, caminho: caminhoDe(p) }))
      .sort((a, b) => a.caminho.localeCompare(b.caminho, 'pt-BR'))
  }),

  criarPasta: adminProcedure
    .input(z.object({ nome: z.string().min(1), pastaPaiId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (input.pastaPaiId) await assertPodeVerPasta(ctx.user.id, ctx.user.superAdmin, input.pastaPaiId)
      const result = await db.insert(marketingPastas).values({
        empresaId: ctx.empresaId,
        nome: input.nome,
        pastaPaiId: input.pastaPaiId ?? null,
        criadoPor: ctx.user.id,
      })
      return db.query.marketingPastas.findFirst({ where: eq(marketingPastas.id, Number(result.lastInsertRowid)) })
    }),

  // Encontra (ou cria) a sequência de pastas de um caminho, nível por nível
  // — usada pelo upload de PASTA inteira (o front manda o
  // webkitRelativePath de cada arquivo quebrado em segmentos, uma vez por
  // subpasta única). Reaproveita a pasta já existente com o mesmo nome no
  // mesmo nível em vez de duplicar — subir a mesma pasta de novo cai dentro
  // do que já tinha, não cria "Fotos (2)". Pedido do João, 2026-09-04.
  garantirCaminhoPasta: adminProcedure
    .input(z.object({ caminho: z.array(z.string().min(1)).min(1).max(20), pastaPaiId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      let paiId: number | null = input.pastaPaiId ?? null
      for (const nome of input.caminho) {
        const existente = await db.query.marketingPastas.findFirst({
          where: paiId
            ? and(eq(marketingPastas.empresaId, ctx.empresaId), eq(marketingPastas.pastaPaiId, paiId), eq(marketingPastas.nome, nome))
            : and(eq(marketingPastas.empresaId, ctx.empresaId), isNull(marketingPastas.pastaPaiId), eq(marketingPastas.nome, nome)),
        })
        if (existente) {
          paiId = existente.id
        } else {
          const result = await db.insert(marketingPastas).values({ empresaId: ctx.empresaId, nome, pastaPaiId: paiId, criadoPor: ctx.user.id })
          paiId = Number(result.lastInsertRowid)
        }
      }
      return { pastaId: paiId as number }
    }),

  renomearPasta: adminProcedure.input(z.object({ id: z.number(), nome: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await assertPodeVerPasta(ctx.user.id, ctx.user.superAdmin, input.id)
    await db.update(marketingPastas).set({ nome: input.nome }).where(and(eq(marketingPastas.id, input.id), eq(marketingPastas.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  // Exclui a pasta, subpastas e arquivos dentro (cascade no banco) — aviso
  // "isso vai apagar N arquivos" fica por conta do front antes de confirmar.
  excluirPasta: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertPodeVerPasta(ctx.user.id, ctx.user.superAdmin, input.id)

    // Um pedido de Solicitar Arte pode estar vinculado a essa pasta OU a
    // uma subpasta dela (solicitacoesDesign.arquivoPastaId) — precisa
    // desvincular na mão ANTES de apagar. O cascade de pastaPaiId (ON
    // DELETE cascade de verdade, criado junto da tabela) ia tentar apagar
    // as subpastas também, mas arquivoPastaId foi acrescentado depois via
    // ALTER TABLE (schema.ts) — o SQLite não aceita ON DELETE nesse tipo
    // de ALTER, então sem essa limpeza manual a constraint trava a
    // exclusão inteira com um erro cru, mesmo pra quem nunca ouviu falar
    // de FOREIGN KEY. Achado testando esta função, 2026-09-15.
    const todasDaEmpresa = await db.query.marketingPastas.findMany({
      where: eq(marketingPastas.empresaId, ctx.empresaId),
      columns: { id: true, pastaPaiId: true },
    })
    const idsParaApagar = new Set<number>([input.id])
    let cresceu = true
    while (cresceu) {
      cresceu = false
      for (const p of todasDaEmpresa) {
        if (p.pastaPaiId !== null && idsParaApagar.has(p.pastaPaiId) && !idsParaApagar.has(p.id)) {
          idsParaApagar.add(p.id)
          cresceu = true
        }
      }
    }
    await db
      .update(solicitacoesDesign)
      .set({ arquivoPastaId: null })
      .where(inArray(solicitacoesDesign.arquivoPastaId, [...idsParaApagar]))

    await db.delete(marketingPastas).where(and(eq(marketingPastas.id, input.id), eq(marketingPastas.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  // Quem pode ver a pasta hoje — preenche o modal de "Gerenciar acesso"
  // com a seleção atual.
  obterAcessoPasta: adminProcedure.input(z.object({ pastaId: z.number() })).query(async ({ ctx, input }) => {
    await assertPodeVerPasta(ctx.user.id, ctx.user.superAdmin, input.pastaId)
    const acessos = await db.query.marketingPastaAcessos.findMany({ where: eq(marketingPastaAcessos.pastaId, input.pastaId) })
    return { userIds: acessos.map((a) => a.userId) }
  }),

  // Substitui a lista de quem pode ver a pasta (e o que tem dentro dela).
  // Lista vazia = pasta volta a ficar aberta pra todo mundo da empresa.
  definirAcessoPasta: adminProcedure
    .input(z.object({ pastaId: z.number(), userIds: z.array(z.number()) }))
    .mutation(async ({ ctx, input }) => {
      await assertPodeVerPasta(ctx.user.id, ctx.user.superAdmin, input.pastaId)
      const pasta = await db.query.marketingPastas.findFirst({
        where: and(eq(marketingPastas.id, input.pastaId), eq(marketingPastas.empresaId, ctx.empresaId)),
      })
      if (!pasta) throw new Error('Pasta não encontrada')

      await db.delete(marketingPastaAcessos).where(eq(marketingPastaAcessos.pastaId, input.pastaId))
      if (input.userIds.length > 0) {
        await db.insert(marketingPastaAcessos).values(input.userIds.map((userId) => ({ pastaId: input.pastaId, userId })))
      }
      return { ok: true }
    }),

  // pastaId ausente = arquivos soltos na raiz da empresa.
  listarArquivos: protectedProcedure
    .input(z.object({ pastaId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.pastaId) await assertPodeVerPasta(ctx.user.id, ctx.user.superAdmin, input.pastaId)

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
      if (input.pastaId) await assertPodeVerPasta(ctx.user.id, ctx.user.superAdmin, input.pastaId)
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

  // Renomeia o arquivo — só o nome de exibição (nomeOriginal). O arquivo em
  // disco (nomeArmazenado) e as URLs de /uploads não mudam. adminProcedure,
  // igual renomearPasta.
  renomearArquivo: adminProcedure.input(z.object({ id: z.number(), nome: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await db
      .update(marketingArquivos)
      .set({ nomeOriginal: input.nome.trim() })
      .where(and(eq(marketingArquivos.id, input.id), eq(marketingArquivos.empresaId, ctx.empresaId)))
    return { ok: true }
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
  registrarDownload: protectedProcedure.input(z.object({ arquivoId: z.number() })).mutation(async ({ ctx, input }) => {
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
