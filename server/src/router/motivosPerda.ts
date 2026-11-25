// Tela "Motivos de perda" + reclassificação dos perdidos (João, 2026-11-25).
//
// Quem vê o quê (sem permissão nova — usa as que já existem):
//   - Gerente da empresa (admin com Aprovações ou Carteira) e superAdmin:
//     todos os perdidos da empresa aberta;
//   - Financeiro (Negociações, Boletos, Liberação de crédito ou Cobrança):
//     perdas por Restrição/Crédito de todas as empresas;
//   - Compras (Quadro de compras ou Importações): Falta de peça e Prazo de
//     entrega de todas as empresas.
// O setor marca "visto" (some do alerta) e pode comentar; cada comentário
// vira notificação pro vendedor do card.
import { z } from 'zod'
import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { router, protectedProcedure, temFeature } from './_base.js'
import { db } from '../db/client.js'
import { clientes, empresas, funilMensal, funilPerdaComentarios, notifications, users } from '../db/schema.js'
import { CATEGORIAS_PERDA, categoriasDoSetor, erroMotivoPerda, SETOR_DA_CATEGORIA } from '../lib/motivosPerda.js'
import { idsDaPessoa } from '../lib/metaLigacoes.js'
import { agoraSqlite } from '../lib/dataBr.js'

type Ctx = { user: { id: number; role: string; superAdmin: boolean }; empresaId: number }

async function temAlguma(userId: number, features: string[]) {
  for (const f of features) if (await temFeature(userId, f)) return true
  return false
}

export async function acessoMotivosPerda(ctx: Ctx) {
  const u = ctx.user
  if (u.superAdmin) return { tudo: true, financeiro: true, compras: true }
  if (u.role !== 'admin') return { tudo: false, financeiro: false, compras: false }
  return {
    tudo: await temAlguma(u.id, ['aprovacoes', 'carteira']),
    financeiro: await temAlguma(u.id, ['negociacoes', 'boletos', 'liberacao_credito', 'cobranca_sap']),
    compras: await temAlguma(u.id, ['compras_gestao', 'compras']),
  }
}

// Filtro de quais perdidos a pessoa enxerga.
function filtroEscopo(ctx: Ctx, a: { tudo: boolean; financeiro: boolean; compras: boolean }): SQL | null {
  const partes: SQL[] = []
  if (a.tudo) partes.push(eq(users.empresaId, ctx.empresaId))
  const cats = [...(a.financeiro ? categoriasDoSetor('financeiro') : []), ...(a.compras ? categoriasDoSetor('compras') : [])]
  if (cats.length) partes.push(inArray(funilMensal.motivoPerdaCategoria, cats as any))
  if (!partes.length) return null
  return partes.length === 1 ? partes[0] : (or(...partes) as SQL)
}

// Quem pode marcar "visto": o setor da categoria; se a categoria não é de
// setor (preço, sem retorno, cliente final...), o gerente.
function podeMarcarVisto(categoria: string | null, a: { tudo: boolean; financeiro: boolean; compras: boolean }, superAdmin: boolean) {
  if (superAdmin) return true
  const setor = categoria ? SETOR_DA_CATEGORIA[categoria] : null
  if (setor === 'financeiro') return a.financeiro
  if (setor === 'compras') return a.compras
  return a.tudo
}

export const motivosPerdaRouter = router({
  meuAcesso: protectedProcedure.query(async ({ ctx }) => {
    const a = await acessoMotivosPerda(ctx)
    const escopo = filtroEscopo(ctx, a)
    let naoVistos = 0
    if (escopo) {
      // Alerta: perdidos dos últimos 60 dias que quem responde ainda não viu
      // (sem contar os que o vendedor ainda precisa reclassificar).
      const desde = new Date(Date.now() - 60 * 86400e3).toISOString().slice(0, 10)
      const linhas = await db
        .select({ categoria: funilMensal.motivoPerdaCategoria })
        .from(funilMensal)
        .innerJoin(users, eq(users.id, funilMensal.vendedorId))
        .where(
          and(
            eq(funilMensal.etapa, 'perdido'),
            isNull(funilMensal.deletedAt),
            gte(funilMensal.dataEntradaEtapa, desde),
            eq(funilMensal.motivoPerdaReclassificar, false),
            isNull(funilMensal.motivoPerdaVistoEm),
            sql`coalesce(${funilMensal.motivoPerdaCategoria}, '') <> 'cadastro_errado'`,
            escopo
          )
        )
      naoVistos = linhas.filter((l) => podeMarcarVisto(l.categoria, a, ctx.user.superAdmin)).length
    }
    return { ...a, visivel: a.tudo || a.financeiro || a.compras, naoVistos }
  }),

  listar: protectedProcedure
    .input(z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      const a = await acessoMotivosPerda(ctx)
      const escopo = filtroEscopo(ctx, a)
      if (!escopo) throw new Error('Acesso negado')
      const [ano, mes] = input.mes.split('-').map(Number)
      const inicio = `${input.mes}-01`
      const fim = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, '0')}-01`
      const linhas = await db
        .select({
          id: funilMensal.id,
          clienteId: funilMensal.clienteId,
          razaoSocial: clientes.razaoSocial,
          vendedorId: funilMensal.vendedorId,
          vendedorNome: users.name,
          empresaNome: empresas.nome,
          empresaId: users.empresaId,
          data: funilMensal.dataEntradaEtapa,
          valorOrcado: funilMensal.valorOrcado,
          categoria: funilMensal.motivoPerdaCategoria,
          observacao: funilMensal.motivoPerdaObservacao,
          item: funilMensal.motivoPerdaItem,
          concorrente: funilMensal.motivoPerdaConcorrente,
          reclassificar: funilMensal.motivoPerdaReclassificar,
          categoriaAntiga: funilMensal.motivoPerdaCategoriaAntiga,
          textoAntigo: funilMensal.motivoPerdaTextoAntigo,
          vistoEm: funilMensal.motivoPerdaVistoEm,
          vistoPor: funilMensal.motivoPerdaVistoPor,
        })
        .from(funilMensal)
        .innerJoin(users, eq(users.id, funilMensal.vendedorId))
        .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
        .leftJoin(empresas, eq(empresas.id, users.empresaId))
        .where(and(eq(funilMensal.etapa, 'perdido'), isNull(funilMensal.deletedAt), gte(funilMensal.dataEntradaEtapa, inicio), lt(funilMensal.dataEntradaEtapa, fim), escopo))
        .orderBy(desc(funilMensal.dataEntradaEtapa))

      const ids = linhas.map((l) => l.id)
      const comentarios = ids.length
        ? await db
            .select({ id: funilPerdaComentarios.id, funilMensalId: funilPerdaComentarios.funilMensalId, texto: funilPerdaComentarios.texto, createdAt: funilPerdaComentarios.createdAt, autor: users.name })
            .from(funilPerdaComentarios)
            .innerJoin(users, eq(users.id, funilPerdaComentarios.userId))
            .where(inArray(funilPerdaComentarios.funilMensalId, ids))
            .orderBy(funilPerdaComentarios.createdAt)
        : []
      const vistoIds = [...new Set(linhas.map((l) => l.vistoPor).filter((x): x is number => !!x))]
      const nomes = vistoIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, vistoIds)) : []
      const nomePorId = new Map(nomes.map((n) => [n.id, n.name]))

      return {
        acesso: a,
        perdas: linhas.map((l) => ({
          ...l,
          vistoPorNome: l.vistoPor ? nomePorId.get(l.vistoPor) ?? null : null,
          podeMarcarVisto: podeMarcarVisto(l.categoria, a, ctx.user.superAdmin),
          comentarios: comentarios.filter((c) => c.funilMensalId === l.id),
        })),
      }
    }),

  marcarVisto: protectedProcedure.input(z.object({ id: z.number(), visto: z.boolean() })).mutation(async ({ ctx, input }) => {
    const a = await acessoMotivosPerda(ctx)
    const f = await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, input.id), columns: { motivoPerdaCategoria: true, vendedorId: true } })
    if (!f) throw new Error('Card não encontrado')
    if (!podeMarcarVisto(f.motivoPerdaCategoria, a, ctx.user.superAdmin)) throw new Error('Quem marca como visto é o setor responsável por essa categoria.')
    await db
      .update(funilMensal)
      .set({ motivoPerdaVistoPor: input.visto ? ctx.user.id : null, motivoPerdaVistoEm: input.visto ? agoraSqlite() : null })
      .where(eq(funilMensal.id, input.id))
    return { ok: true }
  }),

  comentar: protectedProcedure.input(z.object({ id: z.number(), texto: z.string().trim().min(3) })).mutation(async ({ ctx, input }) => {
    const a = await acessoMotivosPerda(ctx)
    const escopo = filtroEscopo(ctx, a)
    if (!escopo) throw new Error('Acesso negado')
    const [f] = await db
      .select({ id: funilMensal.id, vendedorId: funilMensal.vendedorId, clienteId: funilMensal.clienteId, razaoSocial: clientes.razaoSocial })
      .from(funilMensal)
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(eq(funilMensal.id, input.id), escopo))
    if (!f) throw new Error('Card não encontrado')
    await db.insert(funilPerdaComentarios).values({ funilMensalId: f.id, userId: ctx.user.id, texto: input.texto })
    if (f.vendedorId !== ctx.user.id) {
      const autor = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id), columns: { name: true } })
      await db.insert(notifications).values({
        vendedorId: f.vendedorId,
        clienteId: f.clienteId,
        type: 'motivo_perda_comentario',
        title: `Sobre o perdido de ${f.razaoSocial}`,
        message: `${autor?.name ?? 'Gestão'} comentou: ${input.texto.slice(0, 300)}`,
      })
    }
    return { ok: true }
  }),

  // Vendedor: perdidos dele que precisam da categoria nova + texto detalhado.
  pendentesReclassificar: protectedProcedure.query(async ({ ctx }) => {
    const ids = await idsDaPessoa(ctx.user.id)
    return db
      .select({
        id: funilMensal.id,
        razaoSocial: clientes.razaoSocial,
        data: funilMensal.dataEntradaEtapa,
        categoriaAntiga: funilMensal.motivoPerdaCategoriaAntiga,
        textoAntigo: funilMensal.motivoPerdaTextoAntigo,
        item: funilMensal.motivoPerdaItem,
      })
      .from(funilMensal)
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(inArray(funilMensal.vendedorId, ids), eq(funilMensal.motivoPerdaReclassificar, true), isNull(funilMensal.deletedAt), eq(funilMensal.etapa, 'perdido')))
      .orderBy(desc(funilMensal.dataEntradaEtapa))
  }),

  reclassificar: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        categoria: z.enum(CATEGORIAS_PERDA),
        observacao: z.string(),
        concorrente: z.string().optional(),
        item: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ids = await idsDaPessoa(ctx.user.id)
      const f = await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, input.id), columns: { vendedorId: true, motivoPerdaReclassificar: true } })
      if (!f || !f.motivoPerdaReclassificar) throw new Error('Esse perdido não está pendente.')
      if (!ids.includes(f.vendedorId) && !ctx.user.superAdmin) throw new Error('Só o vendedor do card reclassifica.')
      const erro = erroMotivoPerda(input.categoria, input.observacao, input.concorrente, input.item)
      if (erro) throw new Error(erro)
      await db
        .update(funilMensal)
        .set({
          motivoPerdaCategoria: input.categoria,
          motivoPerdaObservacao: input.observacao.trim(),
          motivoPerdaConcorrente: input.categoria === 'preco_concorrente' ? input.concorrente!.trim() : null,
          motivoPerdaItem: input.item?.trim() || null,
          motivoPerdaReclassificar: false,
          motivoPerdaVistoPor: null,
          motivoPerdaVistoEm: null,
        })
        .where(eq(funilMensal.id, input.id))
      return { ok: true }
    }),
})
