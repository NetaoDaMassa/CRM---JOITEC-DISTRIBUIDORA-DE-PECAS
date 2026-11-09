// Funções e permissões (funções vivas, 2026-11-09) — tela única do
// superAdmin: Funções (o que cada função libera), Pessoas (função +
// exceções) e Usuários do grupo inteiro (senha, ativo, TV).
// Regras de cálculo: lib/acessos.ts e lib/acessosCatalogo.ts.
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { asc, eq } from 'drizzle-orm'
import { router, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, funcaoItens, funcoes, permissoesAdmin, usuarioExcecoes, users } from '../db/schema.js'
import { AREAS, CATALOGO, ITEM_POR_ID, NIVEL_LABEL, chavesAteNivel, chavesDaFuncao, itemVale, niveisDoItem, nivelPorChaves } from '../lib/acessosCatalogo.js'
import { definirFuncaoDaPessoa, definirNivelDaPessoa, itensDaFuncao, limparCacheGrupo, recalcularFuncao, recalcularPessoa } from '../lib/acessos.js'
import { criarUsuario, gerarSenhaTemporaria, REGIAO_VALUES } from '../lib/criarUsuario.js'
import { registrarAuditoria } from '../lib/auditoria.js'

const itensSchema = z.record(z.string(), z.number().int().min(0).max(3))

function limparItens(itens: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, nivel] of Object.entries(itens)) {
    const item = ITEM_POR_ID.get(id)
    if (!item || nivel <= 0) continue
    const possiveis = niveisDoItem(item)
    // Nível que o item não tem (ex: Gerencia num item só de Vê) vira o
    // maior que ele tem abaixo disso.
    const n = [...possiveis].reverse().find((p) => p <= nivel)
    if (n) out[id] = n
  }
  return out
}

export const acessosRouter = router({
  catalogo: superAdminProcedure.query(() => ({
    areas: AREAS,
    niveis: NIVEL_LABEL,
    itens: CATALOGO.map((i) => ({ id: i.id, area: i.area, nome: i.nome, dica: i.dica ?? null, empresas: i.empresas ?? [], niveis: niveisDoItem(i) })),
  })),

  funcoes: superAdminProcedure.query(async () => {
    const lista = await db.query.funcoes.findMany({ orderBy: [asc(funcoes.ordem), asc(funcoes.nome)] })
    const itens = await db.query.funcaoItens.findMany()
    const membros = await db.query.users.findMany({ columns: { id: true, funcaoId: true, isActive: true } })
    return lista.map((f) => ({
      ...f,
      itens: Object.fromEntries(itens.filter((i) => i.funcaoId === f.id).map((i) => [i.item, i.nivel])),
      pessoas: membros.filter((m) => m.funcaoId === f.id && m.isActive).length,
    }))
  }),

  salvarFuncao: superAdminProcedure
    .input(
      z.object({
        id: z.number().optional(),
        nome: z.string().trim().min(2),
        descricao: z.string().trim().optional(),
        camada: z.enum(['grupo', 'empresa']),
        tipoConta: z.enum(['admin', 'vendor', 'gestor']),
        itens: itensSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const itens = limparItens(input.itens)
      const outra = await db.query.funcoes.findFirst({ where: eq(funcoes.nome, input.nome) })
      if (outra && outra.id !== input.id) throw new Error('Já existe uma função com esse nome')

      let id = input.id
      const antes = id ? await itensDaFuncao(id) : {}
      if (id) {
        await db.update(funcoes).set({ nome: input.nome, descricao: input.descricao || null, camada: input.camada, tipoConta: input.tipoConta, updatedAt: new Date().toISOString() }).where(eq(funcoes.id, id))
        await db.delete(funcaoItens).where(eq(funcaoItens.funcaoId, id))
      } else {
        const ultima = await db.query.funcoes.findFirst({ orderBy: (f, { desc }) => [desc(f.ordem)] })
        const r = await db.insert(funcoes).values({ nome: input.nome, descricao: input.descricao || null, camada: input.camada, tipoConta: input.tipoConta, ordem: (ultima?.ordem ?? 0) + 1 })
        id = Number(r.lastInsertRowid)
      }
      const linhas = Object.entries(itens).map(([item, nivel]) => ({ funcaoId: id!, item, nivel }))
      if (linhas.length) await db.insert(funcaoItens).values(linhas)
      const afetadas = await recalcularFuncao(id)
      limparCacheGrupo()

      await registrarAuditoria({
        tabela: 'funcoes',
        registroId: id,
        acao: input.id ? 'editar' : 'criar',
        valorAnterior: input.id ? JSON.stringify(antes) : null,
        valorNovo: JSON.stringify({ nome: input.nome, itens }),
        alteradoPor: ctx.user.id,
      })
      return { id, afetadas }
    }),

  excluirFuncao: superAdminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const membros = await db.query.users.findMany({ where: eq(users.funcaoId, input.id), columns: { id: true } })
    if (membros.length) throw new Error(`Ainda tem ${membros.length} pessoa(s) nesta função. Mude elas de função antes.`)
    await db.delete(funcoes).where(eq(funcoes.id, input.id))
    await registrarAuditoria({ tabela: 'funcoes', registroId: input.id, acao: 'excluir', alteradoPor: ctx.user.id })
    return { ok: true }
  }),

  // Lista do grupo inteiro (todas as empresas).
  pessoas: superAdminProcedure.query(async () => {
    const lista = await db.query.users.findMany({
      columns: { id: true, name: true, username: true, role: true, empresaId: true, superAdmin: true, isActive: true, ocultoPainelTv: true, funcaoId: true, whatsapp: true, lastLoginAt: true },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    const emps = await db.query.empresas.findMany({ columns: { id: true, nome: true, slug: true } })
    const exc = await db.query.usuarioExcecoes.findMany({ columns: { userId: true, feature: true } })
    const nomeEmp = new Map(emps.map((e) => [e.id, e.nome]))
    // Exceções contadas por item (uma tela com 2 chaves diferentes conta 1).
    const itemDaChave = new Map<string, string>()
    for (const i of CATALOGO) for (const c of chavesAteNivel(i, 3)) itemDaChave.set(c, i.id)
    const porUser = new Map<number, Set<string>>()
    for (const e of exc) {
      const s = porUser.get(e.userId) ?? new Set<string>()
      s.add(itemDaChave.get(e.feature) ?? e.feature)
      porUser.set(e.userId, s)
    }
    return lista.map((u) => ({ ...u, empresaNome: nomeEmp.get(u.empresaId) ?? '', excecoes: porUser.get(u.id)?.size ?? 0 }))
  }),

  pessoa: superAdminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const u = await db.query.users.findFirst({
      where: eq(users.id, input.id),
      columns: { id: true, name: true, username: true, role: true, empresaId: true, superAdmin: true, isActive: true, funcaoId: true, whatsapp: true },
    })
    if (!u) throw new Error('Pessoa não encontrada')
    const emp = await db.query.empresas.findFirst({ where: eq(empresas.id, u.empresaId), columns: { nome: true, slug: true } })
    const atuais = new Set((await db.query.permissoesAdmin.findMany({ where: eq(permissoesAdmin.userId, u.id), columns: { feature: true } })).map((p) => p.feature))
    const funcaoItensMap = u.funcaoId ? await itensDaFuncao(u.funcaoId) : {}
    const daFuncao = chavesDaFuncao(funcaoItensMap, emp?.slug)
    const excecoes = await db.query.usuarioExcecoes.findMany({ where: eq(usuarioExcecoes.userId, u.id) })
    const chavesComExcecao = new Set(excecoes.map((e) => e.feature))

    const itens = CATALOGO.filter((i) => itemVale(i, emp?.slug)).map((i) => {
      const atual = nivelPorChaves(i, atuais)
      const f = nivelPorChaves(i, daFuncao)
      const excecao = chavesAteNivel(i, 3).some((c) => chavesComExcecao.has(c))
      return { id: i.id, area: i.area, nome: i.nome, dica: i.dica ?? null, niveis: niveisDoItem(i), nivel: atual.nivel, exato: atual.exato, nivelFuncao: f.nivel, excecao }
    })
    return { ...u, empresaNome: emp?.nome ?? '', itens }
  }),

  definirFuncao: superAdminProcedure
    .input(z.object({ userId: z.number(), funcaoId: z.number().nullable(), manterAcesso: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await definirFuncaoDaPessoa(input.userId, input.funcaoId, input.manterAcesso, ctx.user.id)
      await registrarAuditoria({ tabela: 'users', registroId: input.userId, acao: 'editar', campo: 'funcao_id', valorNovo: `${input.funcaoId ?? 'nenhuma'}${input.manterAcesso ? ' (mantendo acesso)' : ''}`, alteradoPor: ctx.user.id })
      return { ok: true }
    }),

  definirNivel: superAdminProcedure
    .input(z.object({ userId: z.number(), item: z.string(), nivel: z.number().int().min(0).max(3).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await definirNivelDaPessoa(input.userId, input.item, input.nivel, ctx.user.id)
      await registrarAuditoria({ tabela: 'usuario_excecoes', registroId: input.userId, acao: 'editar', campo: input.item, valorNovo: input.nivel === null ? 'segue a função' : String(input.nivel), alteradoPor: ctx.user.id })
      return { ok: true }
    }),

  // Tira todas as exceções: a pessoa fica igual à função.
  igualarAFuncao: superAdminProcedure.input(z.object({ userId: z.number() })).mutation(async ({ ctx, input }) => {
    await db.delete(usuarioExcecoes).where(eq(usuarioExcecoes.userId, input.userId))
    await recalcularPessoa(input.userId)
    await registrarAuditoria({ tabela: 'usuario_excecoes', registroId: input.userId, acao: 'excluir', campo: 'todas', alteradoPor: ctx.user.id })
    return { ok: true }
  }),

  criarPessoa: superAdminProcedure
    .input(
      z.object({
        empresaId: z.number(),
        name: z.string().trim().min(2),
        username: z.string().trim().toLowerCase().min(3),
        funcaoId: z.number(),
        whatsapp: z.string().trim().optional(),
        regiao: z.enum(REGIAO_VALUES).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const r = await criarUsuario(input)
      await registrarAuditoria({ tabela: 'users', registroId: r.id, acao: 'criar', valorNovo: `${input.username} (função ${input.funcaoId})`, alteradoPor: ctx.user.id })
      return r
    }),

  // Senha temporária de uso único; a pessoa cria a dela no primeiro login.
  redefinirSenha: superAdminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const alvo = await db.query.users.findFirst({ where: eq(users.id, input.id), columns: { id: true, name: true, whatsapp: true, username: true } })
    if (!alvo) throw new Error('Pessoa não encontrada')
    const senhaTemporaria = gerarSenhaTemporaria()
    await db.update(users).set({ passwordHash: await bcrypt.hash(senhaTemporaria, 12), senhaTrocarNoLogin: true, tentativasLoginFalhas: 0, bloqueadoAte: null }).where(eq(users.id, input.id))
    await registrarAuditoria({ tabela: 'users', registroId: input.id, acao: 'editar', campo: 'senha', valorNovo: 'redefinida', alteradoPor: ctx.user.id })
    return { senhaTemporaria, nome: alvo.name, username: alvo.username, whatsapp: alvo.whatsapp }
  }),

  atualizarPessoa: superAdminProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean().optional(), ocultoPainelTv: z.boolean().optional(), whatsapp: z.string().trim().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...mudancas } = input
      const alvo = await db.query.users.findFirst({ where: eq(users.id, id), columns: { id: true, superAdmin: true } })
      if (!alvo) throw new Error('Pessoa não encontrada')
      if (alvo.superAdmin && mudancas.isActive === false) throw new Error('Não dá pra desativar o admin principal')
      await db.update(users).set({ ...mudancas, updatedAt: new Date().toISOString() }).where(eq(users.id, id))
      limparCacheGrupo()
      for (const [campo, valor] of Object.entries(mudancas)) {
        await registrarAuditoria({ tabela: 'users', registroId: id, acao: 'editar', campo, valorNovo: String(valor), alteradoPor: ctx.user.id })
      }
      return { ok: true }
    }),

  empresas: superAdminProcedure.query(() => db.query.empresas.findMany({ columns: { id: true, nome: true, slug: true }, orderBy: (e, { asc }) => [asc(e.id)] })),
})

