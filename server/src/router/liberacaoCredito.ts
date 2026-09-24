import { z } from 'zod'
import { and, desc, eq, gte, inArray, isNull, like, lte, or, sql } from 'drizzle-orm'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { liberacoesCredito, clientes, empresas, users } from '../db/schema.js'

// Liberação de Crédito — cross-empresa por design, mesmo padrão de
// requisicaoPosto/grupo_odin: quem tem a permissão 'liberacao_credito'
// concedida em Permissões vê/lança pra TODAS as empresas do grupo numa tela
// só (é assim que a Rubia, do Financeiro, acompanha as 4 empresas sem ficar
// trocando de empresa ativa). Nenhuma query aqui filtra por ctx.empresaId de
// propósito.
export const liberacaoCreditoRouter = router({
  // Busca cliente cross-empresa pra "anexar" na liberação — mínimo 2
  // caracteres, procura em razão social/código/CNPJ. Mostra a empresa e o
  // vendedor atual de cada resultado (a linha da liberação depois guarda um
  // snapshot dos dois, ver `criar`).
  clientesBuscar: adminProcedure
    .input(z.object({ q: z.string().min(2) }))
    .query(async ({ input }) => {
      const termo = `%${input.q.trim()}%`
      return db
        .select({
          id: clientes.id,
          razaoSocial: clientes.razaoSocial,
          codigo: clientes.codigo,
          cnpj: clientes.cnpj,
          empresaId: clientes.empresaId,
          empresaNome: empresas.nome,
          vendedorId: clientes.vendedorAtualId,
          vendedorNome: users.name,
        })
        .from(clientes)
        .innerJoin(empresas, eq(empresas.id, clientes.empresaId))
        .leftJoin(users, eq(users.id, clientes.vendedorAtualId))
        .where(
          and(
            isNull(clientes.deletedAt),
            or(like(clientes.razaoSocial, termo), like(clientes.codigo, termo), like(clientes.cnpj, termo))
          )
        )
        .orderBy(clientes.razaoSocial)
        .limit(20)
    }),

  // Sem filtro nenhum, undefined em tudo — traz as últimas 500. `mesReferencia`
  // no formato "YYYY-MM"; `dataDe`/`dataAte` no formato "YYYY-MM-DD".
  listar: adminProcedure
    .input(
      z
        .object({
          q: z.string().optional(),
          dataDe: z.string().optional(),
          dataAte: z.string().optional(),
          mesReferencia: z.string().optional(),
          quemLiberou: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const filtros = []
      if (input?.dataDe) filtros.push(gte(liberacoesCredito.createdAt, input.dataDe))
      if (input?.dataAte) filtros.push(lte(liberacoesCredito.createdAt, `${input.dataAte} 23:59:59`))
      if (input?.mesReferencia) filtros.push(like(liberacoesCredito.createdAt, `${input.mesReferencia}%`))
      if (input?.quemLiberou) filtros.push(eq(liberacoesCredito.quemLiberou, input.quemLiberou))
      if (input?.q) {
        const termo = `%${input.q.trim()}%`
        filtros.push(or(like(clientes.razaoSocial, termo), like(clientes.codigo, termo)))
      }

      const linhas = await db
        .select({
          id: liberacoesCredito.id,
          clienteId: liberacoesCredito.clienteId,
          clienteNome: clientes.razaoSocial,
          clienteCodigo: clientes.codigo,
          empresaId: liberacoesCredito.empresaId,
          empresaNome: empresas.nome,
          vendedorId: liberacoesCredito.vendedorId,
          vendedorNome: users.name,
          quemLiberou: liberacoesCredito.quemLiberou,
          motivo: liberacoesCredito.motivo,
          urlArquivo: liberacoesCredito.urlArquivo,
          nomeArquivo: liberacoesCredito.nomeArquivo,
          criadoPor: liberacoesCredito.criadoPor,
          createdAt: liberacoesCredito.createdAt,
        })
        .from(liberacoesCredito)
        .innerJoin(clientes, eq(clientes.id, liberacoesCredito.clienteId))
        .innerJoin(empresas, eq(empresas.id, liberacoesCredito.empresaId))
        .leftJoin(users, eq(users.id, liberacoesCredito.vendedorId))
        .where(filtros.length ? and(...filtros) : undefined)
        .orderBy(desc(liberacoesCredito.createdAt))
        .limit(500)

      // Nome de quem registrou (criadoPor) — segunda consulta em vez de mais
      // um join na mesma `users`, que exigiria alias (nenhum outro router
      // deste projeto faz self-join duplo em `users`, mantido consistente).
      const criadorIds = [...new Set(linhas.map((l) => l.criadoPor))]
      const criadores = criadorIds.length
        ? await db.query.users.findMany({ where: inArray(users.id, criadorIds), columns: { id: true, name: true } })
        : []
      const nomePorCriadorId = new Map(criadores.map((c) => [c.id, c.name]))

      return linhas.map((l) => ({ ...l, criadoPorNome: nomePorCriadorId.get(l.criadoPor) ?? '—' }))
    }),

  // Nomes já usados em "quem liberou" — alimenta o filtro/autocomplete sem
  // deixar a lista virar um campo 100% livre e cheio de grafia diferente pra
  // mesma pessoa.
  quemLiberouOpcoes: adminProcedure.query(async () => {
    const linhas = await db
      .selectDistinct({ quemLiberou: liberacoesCredito.quemLiberou })
      .from(liberacoesCredito)
      .orderBy(liberacoesCredito.quemLiberou)
    return linhas.map((l) => l.quemLiberou)
  }),

  criar: adminProcedure
    .input(
      z.object({
        clienteId: z.number(),
        quemLiberou: z.string().trim().min(1),
        motivo: z.string().trim().min(1),
        urlArquivo: z.string().optional(),
        nomeArquivo: z.string().optional(),
        tipoArquivo: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, input.clienteId) })
      if (!cliente) throw new Error('Cliente não encontrado')

      await db.insert(liberacoesCredito).values({
        clienteId: input.clienteId,
        empresaId: cliente.empresaId,
        vendedorId: cliente.vendedorAtualId,
        quemLiberou: input.quemLiberou.trim(),
        motivo: input.motivo.trim(),
        urlArquivo: input.urlArquivo,
        nomeArquivo: input.nomeArquivo,
        tipoArquivo: input.tipoArquivo,
        criadoPor: ctx.user.id,
      })
      return { success: true }
    }),

  excluir: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await db.delete(liberacoesCredito).where(eq(liberacoesCredito.id, input.id))
    return { success: true }
  }),

  // Quebras do relatório — por cliente/vendedor/quem-liberou/dia — dentro do
  // período pedido (sem período, considera tudo).
  relatorio: adminProcedure
    .input(z.object({ dataDe: z.string().optional(), dataAte: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const filtros = []
      if (input?.dataDe) filtros.push(gte(liberacoesCredito.createdAt, input.dataDe))
      if (input?.dataAte) filtros.push(lte(liberacoesCredito.createdAt, `${input.dataAte} 23:59:59`))
      const filtroPeriodo = filtros.length ? and(...filtros) : undefined

      const [totalGeral] = await db
        .select({ qtd: sql<number>`count(*)` })
        .from(liberacoesCredito)
        .where(filtroPeriodo)

      const porCliente = await db
        .select({
          clienteId: liberacoesCredito.clienteId,
          clienteNome: clientes.razaoSocial,
          empresaNome: empresas.nome,
          qtd: sql<number>`count(*)`,
        })
        .from(liberacoesCredito)
        .innerJoin(clientes, eq(clientes.id, liberacoesCredito.clienteId))
        .innerJoin(empresas, eq(empresas.id, liberacoesCredito.empresaId))
        .where(filtroPeriodo)
        .groupBy(liberacoesCredito.clienteId, clientes.razaoSocial, empresas.nome)
        .orderBy(desc(sql`count(*)`))

      const porVendedor = await db
        .select({
          vendedorId: liberacoesCredito.vendedorId,
          vendedorNome: users.name,
          qtd: sql<number>`count(*)`,
        })
        .from(liberacoesCredito)
        .leftJoin(users, eq(users.id, liberacoesCredito.vendedorId))
        .where(filtroPeriodo)
        .groupBy(liberacoesCredito.vendedorId, users.name)
        .orderBy(desc(sql`count(*)`))

      const porQuemLiberou = await db
        .select({ quemLiberou: liberacoesCredito.quemLiberou, qtd: sql<number>`count(*)` })
        .from(liberacoesCredito)
        .where(filtroPeriodo)
        .groupBy(liberacoesCredito.quemLiberou)
        .orderBy(desc(sql`count(*)`))

      const porDia = await db
        .select({ dia: sql<string>`substr(${liberacoesCredito.createdAt}, 1, 10)`, qtd: sql<number>`count(*)` })
        .from(liberacoesCredito)
        .where(filtroPeriodo)
        .groupBy(sql`substr(${liberacoesCredito.createdAt}, 1, 10)`)
        .orderBy(desc(sql`substr(${liberacoesCredito.createdAt}, 1, 10)`))

      return {
        quantidadeGeral: totalGeral?.qtd ?? 0,
        porCliente,
        porVendedor: porVendedor.map((v) => ({ ...v, vendedorNome: v.vendedorNome ?? 'Sem vendedor' })),
        porQuemLiberou,
        porDia,
      }
    }),
})
