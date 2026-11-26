// Tela "Clientes duplicados" (João, 2026-11-26 — casos DIRECIONAL BAURU e
// DOUGLAS). O gestor vê, na empresa ativa:
//   - duplicados: o mesmo cliente em mais de um cadastro (mesmo nome ou
//     telefone, sem CNPJ que prove ser outra empresa) — mesma regra da
//     lib/clienteDuplicado.ts e da limpeza do lote 2;
//   - CNPJ suspeito: o mesmo CNPJ gravado em clientes com nomes diferentes
//     (foi o CNPJ da CHIPCOM na DIRECIONAL) + "Conferir na Receita".
// Acesso: super admin ou admin com Aprovações/Carteira (o gerente).
import { z } from 'zod'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure, temFeature } from './_base.js'
import { db } from '../db/client.js'
import { clienteTelefones, clientes, empresas, funilMensal, registroContato, users, vendas } from '../db/schema.js'
import { chaveTelefone, normNomeCliente, soDigitos } from '../lib/clienteDuplicado.js'
import { codigoSap } from '../lib/codigoSap.js'
import { buscarCnpj } from '../lib/brasilApi.js'

type Ctx = { user: { id: number; role: string; superAdmin: boolean }; empresaId: number }

async function podeVer(ctx: Ctx) {
  if (ctx.user.superAdmin) return true
  if (ctx.user.role !== 'admin') return false
  return (await temFeature(ctx.user.id, 'aprovacoes')) || (await temFeature(ctx.user.id, 'carteira'))
}
async function exigir(ctx: Ctx) {
  if (!(await podeVer(ctx))) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só o gestor vê os clientes duplicados.' })
}

interface Cad {
  id: number
  codigo: string
  razaoSocial: string
  cnpj: string
  telefone: string | null
  vendedor: string | null
  vendedorId: number | null
  criadoEm: string
  vendas: number
  ultimaVenda: string | null
  contatos: number
  codigoSap: boolean
}

export const clientesDuplicadosRouter = router({
  meuAcesso: protectedProcedure.query(async ({ ctx }) => ({ visivel: await podeVer(ctx) })),

  duplicados: protectedProcedure.query(async ({ ctx }) => {
    await exigir(ctx)
    const lista = await db
      .select({
        id: clientes.id,
        codigo: clientes.codigo,
        razaoSocial: clientes.razaoSocial,
        cnpj: clientes.cnpj,
        cpf: clientes.cpf,
        telefone: clientes.telefoneWhatsapp,
        vendedorId: clientes.vendedorAtualId,
        vendedor: users.name,
        criadoEm: clientes.createdAt,
      })
      .from(clientes)
      .leftJoin(users, eq(users.id, clientes.vendedorAtualId))
      .where(and(eq(clientes.empresaId, ctx.empresaId), isNull(clientes.deletedAt)))
    const extras = await db
      .select({ clienteId: clienteTelefones.clienteId, numero: clienteTelefones.numero })
      .from(clienteTelefones)
      .innerJoin(clientes, eq(clientes.id, clienteTelefones.clienteId))
      .where(and(eq(clientes.empresaId, ctx.empresaId), isNull(clientes.deletedAt)))

    // Grupos por nome e por telefone (união dos dois — union-find simples).
    const pai = new Map<number, number>()
    const raiz = (x: number): number => {
      let r = x
      while (pai.get(r) !== undefined && pai.get(r) !== r) r = pai.get(r)!
      pai.set(x, r)
      return r
    }
    const unir = (a: number, b: number) => pai.set(raiz(a), raiz(b))
    const doc = new Map(lista.map((c) => [c.id, soDigitos(c.cnpj) || soDigitos(c.cpf)]))
    // Dois cadastros são "o mesmo" se não há CNPJs diferentes provando o contrário
    // e não são dois códigos do SAP diferentes (dois cadastros do SAP = outro cliente).
    const podeSerOMesmo = (a: (typeof lista)[number], b: (typeof lista)[number]) => {
      const da = doc.get(a.id)!, dbb = doc.get(b.id)!
      if (da && dbb) return da === dbb
      const sa = codigoSap(a.codigo), sb = codigoSap(b.codigo)
      return !(sa && sb && sa !== sb)
    }
    const indexar = (chave: (c: (typeof lista)[number]) => string[]) => {
      const m = new Map<string, (typeof lista)[number][]>()
      for (const c of lista) for (const k of chave(c)) m.set(k, [...(m.get(k) ?? []), c])
      return m
    }
    const telsDe = new Map<number, string[]>()
    for (const c of lista) telsDe.set(c.id, [c.telefone].map(chaveTelefone).filter((x): x is string => !!x))
    for (const e of extras) {
      const k = chaveTelefone(e.numero)
      if (k) telsDe.set(e.clienteId, [...(telsDe.get(e.clienteId) ?? []), k])
    }
    const porNome = indexar((c) => {
      const n = normNomeCliente(c.razaoSocial)
      return n.replace(/ /g, '').length >= 6 ? [n] : []
    })
    const porTel = indexar((c) => [...new Set(telsDe.get(c.id) ?? [])])
    for (const [mapa, max] of [
      [porNome, 50],
      [porTel, 3],
    ] as const)
      for (const g of mapa.values()) {
        if (g.length < 2 || g.length > max) continue
        for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (podeSerOMesmo(g[i], g[j])) unir(g[i].id, g[j].id)
      }
    const grupos = new Map<number, (typeof lista)[number][]>()
    for (const c of lista) if (pai.has(c.id)) grupos.set(raiz(c.id), [...(grupos.get(raiz(c.id)) ?? []), c])
    const comDup = [...grupos.values()].filter((g) => g.length > 1)
    const ids = comDup.flat().map((c) => c.id)
    if (!ids.length) return { grupos: [] }

    const nVendas = new Map<number, { n: number; ultima: string | null }>()
    const nContatos = new Map<number, number>()
    for (let i = 0; i < ids.length; i += 500) {
      const lote = ids.slice(i, i + 500)
      for (const r of await db
        .select({ id: vendas.clienteId, n: sql<number>`count(*)`, ultima: sql<string | null>`max(${vendas.createdAt})` })
        .from(vendas)
        .where(and(inArray(vendas.clienteId, lote), isNull(vendas.deletedAt)))
        .groupBy(vendas.clienteId))
        nVendas.set(r.id, { n: Number(r.n), ultima: r.ultima })
      for (const r of await db
        .select({ id: funilMensal.clienteId, n: sql<number>`count(*)` })
        .from(registroContato)
        .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
        .where(and(inArray(funilMensal.clienteId, lote), isNull(registroContato.deletedAt)))
        .groupBy(funilMensal.clienteId))
        nContatos.set(r.id, Number(r.n))
    }
    const resultado = comDup.map((g) => {
      const cads: Cad[] = g.map((c) => ({
        id: c.id,
        codigo: c.codigo,
        razaoSocial: c.razaoSocial,
        cnpj: doc.get(c.id) ?? '',
        telefone: c.telefone,
        vendedor: c.vendedor,
        vendedorId: c.vendedorId,
        criadoEm: c.criadoEm,
        vendas: nVendas.get(c.id)?.n ?? 0,
        ultimaVenda: nVendas.get(c.id)?.ultima ?? null,
        contatos: nContatos.get(c.id) ?? 0,
        codigoSap: !!codigoSap(c.codigo),
      }))
      // Quem fica: tem venda > código SAP > CNPJ > mais contatos > mais antigo.
      const nota = (c: Cad) => (c.vendas > 0 ? 1000 : 0) + (c.codigoSap ? 100 : 0) + (c.cnpj ? 10 : 0) + Math.min(c.contatos, 9)
      cads.sort((a, b) => nota(b) - nota(a) || a.criadoEm.localeCompare(b.criadoEm))
      const donos = new Set(cads.map((c) => c.vendedorId).filter(Boolean))
      const comAtividade = new Set(cads.filter((c) => c.vendas || c.contatos).map((c) => c.vendedorId).filter(Boolean))
      return { cadastros: cads, vendedoresDiferentes: donos.size > 1, decisaoGerente: comAtividade.size > 1 }
    })
    resultado.sort((a, b) => Number(b.decisaoGerente) - Number(a.decisaoGerente) || Number(b.vendedoresDiferentes) - Number(a.vendedoresDiferentes))
    return { grupos: resultado }
  }),

  // O mesmo CNPJ em clientes com nomes diferentes (em qualquer empresa do
  // grupo), mostrando só os que tocam a empresa ativa.
  cnpjSuspeitos: protectedProcedure.query(async ({ ctx }) => {
    await exigir(ctx)
    const linhas = await db
      .select({ id: clientes.id, empresaId: clientes.empresaId, empresa: empresas.nome, codigo: clientes.codigo, razaoSocial: clientes.razaoSocial, cnpj: clientes.cnpj, vendedor: users.name })
      .from(clientes)
      .innerJoin(empresas, eq(empresas.id, clientes.empresaId))
      .leftJoin(users, eq(users.id, clientes.vendedorAtualId))
      .where(and(isNull(clientes.deletedAt), sql`length(replace(replace(replace(coalesce(${clientes.cnpj}, ''), '.', ''), '/', ''), '-', '')) = 14`))
    const porCnpj = new Map<string, typeof linhas>()
    for (const l of linhas) {
      const k = soDigitos(l.cnpj)
      porCnpj.set(k, [...(porCnpj.get(k) ?? []), l])
    }
    // Nomes "iguais o bastante": a 1ª palavra relevante bate (LTDA/ME/EIRELI fora).
    const LIXO = new Set(['LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'S', 'A', 'DE', 'DA', 'DO', 'E', 'COMERCIO', 'COM', 'IND', 'INDUSTRIA'])
    const chaveNome = (n: string) => normNomeCliente(n).split(' ').filter((w) => w.length > 1 && !LIXO.has(w))[0] ?? ''
    const suspeitos = [...porCnpj.entries()]
      .filter(([, g]) => g.some((c) => c.empresaId === ctx.empresaId) && new Set(g.map((c) => chaveNome(c.razaoSocial))).size > 1)
      .map(([cnpj, g]) => ({ cnpj, cadastros: g.map((c) => ({ id: c.id, empresa: c.empresa, codigo: c.codigo, razaoSocial: c.razaoSocial, vendedor: c.vendedor, aqui: c.empresaId === ctx.empresaId })) }))
    return { suspeitos }
  }),

  conferirReceita: protectedProcedure.input(z.object({ cnpj: z.string() })).mutation(async ({ ctx, input }) => {
    await exigir(ctx)
    const r = await buscarCnpj(soDigitos(input.cnpj)).catch(() => null)
    if (!r) throw new Error('A Receita não respondeu agora — tente de novo em 1 minuto.')
    return { razaoSocial: r.razaoSocial, nomeFantasia: (r as { nomeFantasia?: string | null }).nomeFantasia ?? null, cidade: (r as { cidade?: string | null }).cidade ?? null }
  }),
})
