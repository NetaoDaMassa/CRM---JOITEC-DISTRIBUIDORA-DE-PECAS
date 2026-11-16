import { z } from 'zod'
import { and, desc, eq, gte, inArray, isNull, like, lte, or } from 'drizzle-orm'
import { router, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { liberacoesCredito, clientes, empresas, users } from '../db/schema.js'
import { toLocalDateKey, toUtcISO } from '../lib/businessHours.js'

// Liberação de Crédito — cross-empresa por design, mesmo padrão de
// requisicaoPosto/grupo_odin: quem tem a permissão 'liberacao_credito'
// concedida em Permissões vê/lança pra TODAS as empresas do grupo numa tela
// só (é assim que a Rubia, do Financeiro, acompanha as 4 empresas sem ficar
// trocando de empresa ativa). Nenhuma query aqui filtra por ctx.empresaId de
// propósito.
//
// Era `adminProcedure` puro (só checava "é admin", a permissão só escondia
// o link no menu) — trocado pra `featureProcedure('liberacao_credito')` em
// 2026-09-29 (achado via auditoria + pedido do João): sem isso, QUALQUER
// admin de QUALQUER empresa, mesmo sem a permissão concedida, conseguia
// chamar essas rotas direto e ver dado financeiro sigiloso das outras 4
// empresas. superAdmin continua passando sempre (featureProcedure já
// bypassa).
// Quem pode liberar (financeiro, 2026-11-13).
export const QUEM_LIBERA = ['Jessica (financeiro)', 'Rubia (financeiro)', 'Guilherme (diretor)'] as const

export const liberacaoCreditoRouter = router({
  // Busca cliente cross-empresa pra "anexar" na liberação — mínimo 2
  // caracteres, procura em razão social/código/CNPJ. Mostra a empresa e o
  // vendedor atual de cada resultado (a linha da liberação depois guarda um
  // snapshot dos dois, ver `criar`).
  clientesBuscar: featureProcedure('liberacao_credito')
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
  listar: featureProcedure('liberacao_credito')
    .input(
      z
        .object({
          q: z.string().optional(),
          dataDe: z.string().optional(),
          dataAte: z.string().optional(),
          mesReferencia: z.string().optional(),
          quemLiberou: z.string().optional(),
          vendedorId: z.number().optional(),
          empresaId: z.number().optional(),
          clienteId: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const filtros = []
      if (input?.vendedorId) filtros.push(eq(liberacoesCredito.vendedorId, input.vendedorId))
      if (input?.empresaId) filtros.push(eq(liberacoesCredito.empresaId, input.empresaId))
      if (input?.clienteId) filtros.push(eq(liberacoesCredito.clienteId, input.clienteId))
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
          status: liberacoesCredito.status,
          valorLiberado: liberacoesCredito.valorLiberado,
          celular: liberacoesCredito.celular,
          editadoEm: liberacoesCredito.editadoEm,
          origemSolicitacaoId: liberacoesCredito.origemSolicitacaoId,
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
  quemLiberouOpcoes: featureProcedure('liberacao_credito').query(async () => {
    const linhas = await db
      .selectDistinct({ quemLiberou: liberacoesCredito.quemLiberou })
      .from(liberacoesCredito)
      .orderBy(liberacoesCredito.quemLiberou)
    return [...new Set([...QUEM_LIBERA, ...linhas.map((l) => l.quemLiberou)])]
  }),

  criar: featureProcedure('liberacao_credito')
    .input(
      z.object({
        clienteId: z.number(),
        quemLiberou: z.enum(QUEM_LIBERA),
        motivo: z.string().trim().min(1),
        valorLiberado: z.number().positive('Informe o valor liberado a mais'),
        celular: z.string().trim().max(30).optional(),
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
        valorLiberado: input.valorLiberado,
        celular: input.celular?.trim() || null,
        urlArquivo: input.urlArquivo,
        nomeArquivo: input.nomeArquivo,
        tipoArquivo: input.tipoArquivo,
        criadoPor: ctx.user.id,
      })
      return { success: true }
    }),

  // Edição do registro (2026-11-13: "liberar edição também").
  editar: featureProcedure('liberacao_credito')
    .input(
      z.object({
        id: z.number(),
        quemLiberou: z.enum(QUEM_LIBERA),
        motivo: z.string().trim().min(1),
        valorLiberado: z.number().positive('Informe o valor liberado a mais'),
        celular: z.string().trim().max(30).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .update(liberacoesCredito)
        .set({ quemLiberou: input.quemLiberou, motivo: input.motivo, valorLiberado: input.valorLiberado, celular: input.celular?.trim() || null, editadoEm: agoraSqlite(), editadoPor: ctx.user.id })
        .where(eq(liberacoesCredito.id, input.id))
      return { success: true }
    }),

  excluir: featureProcedure('liberacao_credito').input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await db.delete(liberacoesCredito).where(eq(liberacoesCredito.id, input.id))
    return { success: true }
  }),

  // Vendedores/empresas que já aparecem em algum registro — filtros.
  filtrosOpcoes: featureProcedure('liberacao_credito').query(async () => {
    const [vendedores, empresasLista] = await Promise.all([
      db
        .selectDistinct({ id: users.id, name: users.name })
        .from(liberacoesCredito)
        .innerJoin(users, eq(users.id, liberacoesCredito.vendedorId))
        .orderBy(users.name),
      db
        .selectDistinct({ id: empresas.id, nome: empresas.nome })
        .from(liberacoesCredito)
        .innerJoin(empresas, eq(empresas.id, liberacoesCredito.empresaId))
        .orderBy(empresas.nome),
    ])
    return { vendedores, empresas: empresasLista }
  }),

  // Ranking de "quem está liberando fora do esquema" (João, 2026-11-16).
  // Só conta registros 'liberado' — os 'negado' são cópias antigas de
  // respostas da Consulta (antes de 2026-11-13), não liberação a mais.
  relatorio: featureProcedure('liberacao_credito')
    .input(
      z
        .object({
          dataDe: z.string().optional(),
          dataAte: z.string().optional(),
          quemLiberou: z.string().optional(),
          vendedorId: z.number().optional(),
          empresaId: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const filtros = [eq(liberacoesCredito.status, 'liberado')]
      if (input?.dataDe) filtros.push(gte(liberacoesCredito.createdAt, input.dataDe))
      if (input?.dataAte) filtros.push(lte(liberacoesCredito.createdAt, `${input.dataAte} 23:59:59`))
      if (input?.quemLiberou) filtros.push(eq(liberacoesCredito.quemLiberou, input.quemLiberou))
      if (input?.vendedorId) filtros.push(eq(liberacoesCredito.vendedorId, input.vendedorId))
      if (input?.empresaId) filtros.push(eq(liberacoesCredito.empresaId, input.empresaId))

      const linhas = await db
        .select({
          clienteId: liberacoesCredito.clienteId,
          clienteNome: clientes.razaoSocial,
          clienteCodigo: clientes.codigo,
          empresaId: liberacoesCredito.empresaId,
          empresaNome: empresas.nome,
          vendedorId: liberacoesCredito.vendedorId,
          vendedorNome: users.name,
          quemLiberou: liberacoesCredito.quemLiberou,
          valor: liberacoesCredito.valorLiberado,
          createdAt: liberacoesCredito.createdAt,
        })
        .from(liberacoesCredito)
        .innerJoin(clientes, eq(clientes.id, liberacoesCredito.clienteId))
        .innerJoin(empresas, eq(empresas.id, liberacoesCredito.empresaId))
        .leftJoin(users, eq(users.id, liberacoesCredito.vendedorId))
        .where(and(...filtros))

      type Grupo = { qtd: number; soma: number; maior: number; ultimo: string }
      const novo = (): Grupo => ({ qtd: 0, soma: 0, maior: 0, ultimo: '' })
      const somar = (g: Grupo, l: (typeof linhas)[number]) => {
        g.qtd++
        g.soma += l.valor ?? 0
        g.maior = Math.max(g.maior, l.valor ?? 0)
        if (l.createdAt > g.ultimo) g.ultimo = l.createdAt
      }
      const total = novo()
      const porQuem = new Map<string, Grupo & { quemLiberou: string }>()
      const porVendedor = new Map<number, Grupo & { vendedorId: number | null; vendedorNome: string }>()
      const porCliente = new Map<number, Grupo & { clienteId: number; clienteNome: string; clienteCodigo: string; empresaNome: string }>()
      const porMes = new Map<string, Grupo & { mes: string }>()
      const porEmpresa = new Map<number, Grupo & { empresaId: number; empresaNome: string }>()
      for (const l of linhas) {
        somar(total, l)
        const q = porQuem.get(l.quemLiberou) ?? { ...novo(), quemLiberou: l.quemLiberou }
        somar(q, l)
        porQuem.set(l.quemLiberou, q)
        const vk = l.vendedorId ?? 0
        const v = porVendedor.get(vk) ?? { ...novo(), vendedorId: l.vendedorId, vendedorNome: l.vendedorNome ?? 'Sem vendedor' }
        somar(v, l)
        porVendedor.set(vk, v)
        const c = porCliente.get(l.clienteId) ?? { ...novo(), clienteId: l.clienteId, clienteNome: l.clienteNome, clienteCodigo: l.clienteCodigo, empresaNome: l.empresaNome }
        somar(c, l)
        porCliente.set(l.clienteId, c)
        const mes = toLocalDateKey(toUtcISO(l.createdAt)).slice(0, 7)
        const m = porMes.get(mes) ?? { ...novo(), mes }
        somar(m, l)
        porMes.set(mes, m)
        const e = porEmpresa.get(l.empresaId) ?? { ...novo(), empresaId: l.empresaId, empresaNome: l.empresaNome }
        somar(e, l)
        porEmpresa.set(l.empresaId, e)
      }
      const comMedia = <T extends Grupo>(g: T) => ({
        ...g,
        media: g.qtd ? Math.round((g.soma / g.qtd) * 100) / 100 : 0,
        pctDoTotal: total.soma ? Math.round((g.soma / total.soma) * 1000) / 10 : total.qtd ? Math.round((g.qtd / total.qtd) * 1000) / 10 : 0,
      })
      const porSoma = (a: Grupo, b: Grupo) => b.soma - a.soma || b.qtd - a.qtd

      return {
        totais: { ...comMedia(total), clientes: porCliente.size, quemLiberouDistintos: porQuem.size },
        porQuemLiberou: [...porQuem.values()].map(comMedia).sort(porSoma),
        porVendedor: [...porVendedor.values()].map(comMedia).sort(porSoma),
        porCliente: [...porCliente.values()].map(comMedia).sort(porSoma),
        porMes: [...porMes.values()].map(comMedia).sort((a, b) => b.mes.localeCompare(a.mes)),
        porEmpresa: [...porEmpresa.values()].map(comMedia).sort(porSoma),
      }
    }),
})
