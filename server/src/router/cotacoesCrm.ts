// Cotações no CRM — etapa 1 do "Portal One dentro do CRM" (pedido do João,
// 2026-11-10). Catálogo/preço/prazo vêm das cópias do SAP (lib/sapCatalogo.ts),
// estoque da foto de Revenda (lib/sapEstoque.ts). A cotação fica salva no CRM;
// enviar ao SAP é a etapa 2 (precisa de usuário próprio + base de teste).
// Acesso: permissão 'cotacoes' (superAdmin sempre). Vendedor vê/edita só as
// próprias cotações e os clientes da própria carteira; admin vê a empresa toda.
import { z } from 'zod'
import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure, temFeature } from './_base.js'
import { db } from '../db/client.js'
import {
  clientes,
  cotacoesCrm,
  cotacoesCrmItens,
  empresas,
  sapCatalogoItens,
  sapCatalogoPrecos,
  sapClientesComercial,
  sapEstoqueItens,
  sapListasPreco,
  sapPrazosPagamento,
  users,
} from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { filialDaEmpresa } from '../lib/sapEstoque.js'
import { catalogoAtualizadoEm, sincronizarCatalogoSap } from '../lib/sapCatalogo.js'

const FEATURE = 'cotacoes'
// Lista 01.BASE — usada quando o cliente não tem lista no SAP.
const LISTA_BASE = 1

const cotacoesProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user.superAdmin && !(await temFeature(ctx.user.id, FEATURE))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Cotações não liberadas pra você' })
  }
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { slug: true } })
  const filial = empresa ? filialDaEmpresa(empresa.slug) : null
  if (!filial || filial === 5) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cotações só para empresas que vendem pelo SAP' })
  const veTudo = ctx.user.superAdmin || ctx.user.role === 'admin'
  return next({ ctx: { ...ctx, filial, veTudo } })
})

const arred = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas

async function acharCotacao(ctx: { empresaId: number; user: { id: number }; veTudo: boolean }, id: number) {
  const c = await db.query.cotacoesCrm.findFirst({
    where: and(eq(cotacoesCrm.id, id), eq(cotacoesCrm.empresaId, ctx.empresaId), isNull(cotacoesCrm.deletedAt)),
  })
  if (!c || (!ctx.veTudo && c.vendedorId !== ctx.user.id)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cotação não encontrada' })
  return c
}

export const cotacoesCrmRouter = router({
  // Listas de preço, prazos e quando o catálogo foi copiado do SAP.
  contexto: cotacoesProcedure.query(async ({ ctx }) => {
    const [listas, prazos, atualizadoEm] = await Promise.all([
      db.select().from(sapListasPreco).orderBy(sapListasPreco.numero),
      db.select().from(sapPrazosPagamento).orderBy(sapPrazosPagamento.nome),
      catalogoAtualizadoEm(),
    ])
    return { listas, prazos, atualizadoEm, veTudo: ctx.veTudo, listaBase: LISTA_BASE }
  }),

  // Catálogo inteiro (~2.600 itens) com o preço da lista pedida e o estoque
  // de Revenda da filial — a tela filtra na hora, sem ir ao servidor.
  catalogo: cotacoesProcedure.input(z.object({ lista: z.number().int() })).query(async ({ ctx, input }) => {
    const [itens, precos, base, estoque] = await Promise.all([
      db.select().from(sapCatalogoItens).where(eq(sapCatalogoItens.ativo, true)),
      db.select({ item: sapCatalogoPrecos.itemCodigo, preco: sapCatalogoPrecos.preco }).from(sapCatalogoPrecos).where(eq(sapCatalogoPrecos.lista, input.lista)),
      db.select({ item: sapCatalogoPrecos.itemCodigo, preco: sapCatalogoPrecos.preco }).from(sapCatalogoPrecos).where(eq(sapCatalogoPrecos.lista, LISTA_BASE)),
      db.select({ item: sapEstoqueItens.itemCodigo, qtd: sapEstoqueItens.quantidade }).from(sapEstoqueItens).where(eq(sapEstoqueItens.filial, ctx.filial)),
    ])
    const precoDe = new Map(precos.map((p) => [p.item, p.preco]))
    const precoBase = new Map(base.map((p) => [p.item, p.preco]))
    const estoqueDe = new Map(estoque.map((e) => [e.item, e.qtd]))
    return itens
      .map((i) => ({
        codigo: i.itemCodigo,
        nome: i.nome,
        codigoAntigo: i.codigoAntigo,
        grupo: i.grupo,
        unidade: i.unidade,
        preco: precoDe.get(i.itemCodigo) ?? precoBase.get(i.itemCodigo) ?? null,
        estoque: estoqueDe.get(i.itemCodigo) ?? 0,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }),

  // Clientes pra cotar: vendedor só a própria carteira, admin a empresa toda.
  // Junta a lista de preço e o prazo padrão do cliente no SAP.
  clientes: cotacoesProcedure.input(z.object({ busca: z.string().trim().min(2) })).query(async ({ ctx, input }) => {
    const termo = `%${input.busca}%`
    const linhas = await db
      .select({
        id: clientes.id,
        codigo: clientes.codigo,
        nome: clientes.razaoSocial,
        cidade: clientes.cidade,
        estado: clientes.estado,
        listaPreco: sapClientesComercial.listaPreco,
        prazoCodigo: sapClientesComercial.prazoCodigo,
        bloqueado: sapClientesComercial.bloqueado,
      })
      .from(clientes)
      .leftJoin(sapClientesComercial, eq(sapClientesComercial.cardCode, clientes.codigo))
      .where(
        and(
          eq(clientes.empresaId, ctx.empresaId),
          isNull(clientes.deletedAt),
          ctx.veTudo ? undefined : eq(clientes.vendedorAtualId, ctx.user.id),
          or(like(clientes.razaoSocial, termo), like(clientes.codigo, termo), like(clientes.cnpj, termo), like(clientes.cpf, termo))
        )
      )
      .limit(25)
    return linhas
  }),

  listar: cotacoesProcedure.query(async ({ ctx }) => {
    const linhas = await db
      .select({
        id: cotacoesCrm.id,
        status: cotacoesCrm.status,
        total: cotacoesCrm.total,
        updatedAt: cotacoesCrm.updatedAt,
        sapDocNum: cotacoesCrm.sapDocNum,
        clienteNome: clientes.razaoSocial,
        clienteCodigo: clientes.codigo,
        vendedorNome: users.name,
        itens: sql<number>`(select count(*) from ${cotacoesCrmItens} where ${cotacoesCrmItens.cotacaoId} = ${cotacoesCrm.id})`,
      })
      .from(cotacoesCrm)
      .innerJoin(clientes, eq(clientes.id, cotacoesCrm.clienteId))
      .innerJoin(users, eq(users.id, cotacoesCrm.vendedorId))
      .where(and(eq(cotacoesCrm.empresaId, ctx.empresaId), isNull(cotacoesCrm.deletedAt), ctx.veTudo ? undefined : eq(cotacoesCrm.vendedorId, ctx.user.id)))
      .orderBy(desc(cotacoesCrm.updatedAt))
      .limit(300)
    return linhas
  }),

  obter: cotacoesProcedure.input(z.object({ id: z.number().int() })).query(async ({ ctx, input }) => {
    const c = await acharCotacao(ctx, input.id)
    const [cliente, itens] = await Promise.all([
      db.query.clientes.findFirst({ where: eq(clientes.id, c.clienteId), columns: { id: true, codigo: true, razaoSocial: true, cidade: true, estado: true } }),
      db.select().from(cotacoesCrmItens).where(eq(cotacoesCrmItens.cotacaoId, c.id)).orderBy(cotacoesCrmItens.id),
    ])
    return { ...c, cliente, itens }
  }),

  // Cria ou atualiza o rascunho. O preço de tabela é sempre o do catálogo
  // (lista escolhida, ou a 01.BASE se o item não tiver preço nela); o
  // vendedor só mexe em quantidade e desconto.
  salvar: cotacoesProcedure
    .input(
      z.object({
        id: z.number().int().optional(),
        clienteId: z.number().int(),
        listaPreco: z.number().int(),
        prazoCodigo: z.number().int().nullable(),
        observacao: z.string().max(2000).nullable(),
        itens: z
          .array(z.object({ itemCodigo: z.string().min(1), quantidade: z.number().positive(), descontoPct: z.number().min(0).max(100) }))
          .max(300),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        const atual = await acharCotacao(ctx, input.id)
        if (atual.status !== 'rascunho') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Só dá pra editar cotação em rascunho' })
      }
      const cliente = await db.query.clientes.findFirst({
        where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId), isNull(clientes.deletedAt)),
        columns: { id: true, vendedorAtualId: true },
      })
      if (!cliente || (!ctx.veTudo && cliente.vendedorAtualId !== ctx.user.id)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cliente fora da sua carteira' })

      const codigos = [...new Set(input.itens.map((i) => i.itemCodigo))]
      const [catalogo, precos] = codigos.length
        ? await Promise.all([
            db.select({ codigo: sapCatalogoItens.itemCodigo, nome: sapCatalogoItens.nome }).from(sapCatalogoItens).where(inArray(sapCatalogoItens.itemCodigo, codigos)),
            db
              .select()
              .from(sapCatalogoPrecos)
              .where(and(inArray(sapCatalogoPrecos.itemCodigo, codigos), inArray(sapCatalogoPrecos.lista, [input.listaPreco, LISTA_BASE]))),
          ])
        : [[], []]
      const nomeDe = new Map(catalogo.map((c) => [c.codigo, c.nome]))
      const preco = (item: string) =>
        precos.find((p) => p.itemCodigo === item && p.lista === input.listaPreco)?.preco ?? precos.find((p) => p.itemCodigo === item && p.lista === LISTA_BASE)?.preco
      const linhas = input.itens.map((i) => {
        const nome = nomeDe.get(i.itemCodigo)
        const tabela = preco(i.itemCodigo)
        if (!nome) throw new TRPCError({ code: 'BAD_REQUEST', message: `Item ${i.itemCodigo} não está mais no catálogo do SAP` })
        if (tabela == null) throw new TRPCError({ code: 'BAD_REQUEST', message: `Item ${i.itemCodigo} está sem preço no SAP` })
        return {
          itemCodigo: i.itemCodigo,
          nome,
          quantidade: i.quantidade,
          precoTabela: tabela,
          descontoPct: arred(i.descontoPct, 2),
          precoUnitario: arred(tabela * (1 - i.descontoPct / 100), 4),
        }
      })
      const total = arred(linhas.reduce((s, l) => s + l.precoUnitario * l.quantidade, 0))
      const agora = agoraSqlite()

      return db.transaction(async (tx) => {
        let id = input.id
        const dados = { clienteId: input.clienteId, listaPreco: input.listaPreco, prazoCodigo: input.prazoCodigo, observacao: input.observacao?.trim() || null, total, updatedAt: agora }
        if (id) {
          await tx.update(cotacoesCrm).set(dados).where(eq(cotacoesCrm.id, id))
          await tx.delete(cotacoesCrmItens).where(eq(cotacoesCrmItens.cotacaoId, id))
        } else {
          const [nova] = await tx
            .insert(cotacoesCrm)
            .values({ ...dados, empresaId: ctx.empresaId, vendedorId: ctx.user.id })
            .returning({ id: cotacoesCrm.id })
          id = nova.id
        }
        if (linhas.length) await tx.insert(cotacoesCrmItens).values(linhas.map((l) => ({ ...l, cotacaoId: id! })))
        return { id: id!, total }
      })
    }),

  excluir: cotacoesProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    const c = await acharCotacao(ctx, input.id)
    if (c.status !== 'rascunho') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Só dá pra excluir cotação em rascunho' })
    await db.update(cotacoesCrm).set({ deletedAt: agoraSqlite() }).where(eq(cotacoesCrm.id, c.id))
    return { ok: true }
  }),

  // Recopia o catálogo do SAP agora (admin). Leva alguns segundos.
  atualizarCatalogo: cotacoesProcedure.mutation(async ({ ctx }) => {
    if (!ctx.veTudo) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só admin atualiza o catálogo' })
    return sincronizarCatalogoSap(true)
  }),
})
