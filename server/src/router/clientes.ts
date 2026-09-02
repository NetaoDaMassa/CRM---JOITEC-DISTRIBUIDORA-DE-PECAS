import { z } from 'zod'
import { and, asc, count, desc, eq, inArray, isNull, isNotNull, like, or, sql } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, carteiraHistorico, funilMensal, registroContato, itensPedido, vendas, users, bancoClientesLiberacoes } from '../db/schema.js'
import { cnpjValido, limparCnpj, formatarCnpj } from '../lib/cnpj.js'
import { cpfValido, limparCpf } from '../lib/cpf.js'
import { buscarCnpj } from '../lib/brasilApi.js'
import { regiaoPorUf, REGIAO_VALUES } from '../lib/regiao.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { mesReferenciaAtual, agoraSqlite } from '../lib/dataBr.js'
import { transferirCliente } from './carteira.js'

const PAGE_SIZE = 20
// Rótulo pra cliente sem vendedor que não veio de nenhuma importação com
// origemBanco preenchido (ex: cadastro manual sem vendedor escolhido).
const SEM_ORIGEM = 'Sem origem definida'

export const clientesRouter = router({
  cnpjLookup: protectedProcedure.input(z.object({ cnpj: z.string() })).query(async ({ input }) => {
    if (!cnpjValido(input.cnpj)) throw new Error('CNPJ inválido')
    const dados = await buscarCnpj(input.cnpj)
    if (!dados) return null
    return {
      razaoSocial: dados.razaoSocial,
      cidade: dados.municipio,
      estado: dados.uf,
      regiao: dados.uf ? regiaoPorUf(dados.uf) : null,
      situacao: dados.situacao,
      telefone: dados.telefone,
    }
  }),

  list: protectedProcedure
    .input(
      z.object({
        q: z.string().optional(),
        pagina: z.number().min(1).default(1),
        vendedorId: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = and(...listFiltros(ctx, input))
      const [{ total }] = await db.select({ total: count() }).from(clientes).where(where)

      const items = await db.query.clientes.findMany({
        where,
        orderBy: [asc(clientes.razaoSocial)],
        limit: PAGE_SIZE,
        offset: (input.pagina - 1) * PAGE_SIZE,
        with: {
          vendedorAtual: { columns: { id: true, name: true } },
          telefonesExtras: { orderBy: (t, { asc }) => [asc(t.id)] },
          emailsExtras: { orderBy: (e, { asc }) => [asc(e.id)] },
        },
      })

      return { items, total, totalPaginas: Math.max(1, Math.ceil(total / PAGE_SIZE)) }
    }),

  // Mesmos filtros de `list`, sem paginação — alimenta o botão "Exportar
  // planilha" da tela de Clientes (a lista lá é paginada de 20 em 20, não
  // dá pra exportar reaproveitando ela).
  exportar: protectedProcedure
    .input(
      z.object({
        q: z.string().optional(),
        vendedorId: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = and(...listFiltros(ctx, input))
      const items = await db.query.clientes.findMany({
        where,
        orderBy: [asc(clientes.razaoSocial)],
        with: { vendedorAtual: { columns: { name: true } } },
      })
      return items.map((c) => ({
        codigo: c.codigo,
        razaoSocial: c.razaoSocial,
        cnpj: c.cnpj,
        cpf: c.cpf,
        cidade: c.cidade,
        estado: c.estado,
        regiao: c.regiao,
        telefoneWhatsapp: c.telefoneWhatsapp,
        email: c.email,
        nomeContato: c.nomeContato,
        vendedor: c.vendedorAtual?.name ?? '',
      }))
    }),

  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const cliente = await db.query.clientes.findFirst({
      where: and(eq(clientes.id, input.id), isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)),
      with: {
        vendedorAtual: { columns: { id: true, name: true } },
        telefonesExtras: { orderBy: (t, { asc }) => [asc(t.id)] },
        emailsExtras: { orderBy: (e, { asc }) => [asc(e.id)] },
      },
    })
    if (!cliente) throw new Error('Cliente não encontrado')
    if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) {
      throw new Error('Acesso negado')
    }

    const funis = await db.query.funilMensal.findMany({
      where: and(eq(funilMensal.clienteId, cliente.id), isNull(funilMensal.deletedAt)),
      columns: { id: true },
    })
    const funilIds = funis.map((f) => f.id)

    const [{ qtdContatos }] = funilIds.length
      ? await db
          .select({ qtdContatos: count() })
          .from(registroContato)
          .where(and(or(...funilIds.map((id) => eq(registroContato.funilMensalId, id))), isNull(registroContato.deletedAt)))
      : [{ qtdContatos: 0 }]

    const [{ qtdPedidos }] = await db
      .select({ qtdPedidos: count() })
      .from(itensPedido)
      .where(and(eq(itensPedido.clienteId, cliente.id), isNull(itensPedido.deletedAt)))

    return { ...cliente, qtdContatos, qtdPedidos }
  }),

  // Histórico completo do cliente atravessando todos os meses — o Kanban só
  // mostra o funil do mês corrente (reset mensal cria uma linha nova por
  // mês), então sem isso uma venda de 3 meses atrás "desaparece" de vista
  // pro vendedor/gestor assim que o mês vira.
  historico: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const cliente = await db.query.clientes.findFirst({
      where: and(eq(clientes.id, input.id), isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)),
    })
    if (!cliente) throw new Error('Cliente não encontrado')
    if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) {
      throw new Error('Acesso negado')
    }

    const funis = await db.query.funilMensal.findMany({
      where: and(eq(funilMensal.clienteId, cliente.id), isNull(funilMensal.deletedAt)),
      orderBy: (f, { desc }) => [desc(f.mesReferencia)],
      with: {
        vendedor: { columns: { id: true, name: true } },
        vendas: { where: isNull(vendas.deletedAt), orderBy: (v, { desc }) => [desc(v.dataFechamento)] },
      },
    })
    const funilIds = funis.map((f) => f.id)

    const contatos = funilIds.length
      ? await db.query.registroContato.findMany({
          where: and(or(...funilIds.map((id) => eq(registroContato.funilMensalId, id))), isNull(registroContato.deletedAt)),
          orderBy: (c, { desc }) => [desc(c.dataHora)],
        })
      : []

    const itens = await db.query.itensPedido.findMany({
      where: and(eq(itensPedido.clienteId, cliente.id), isNull(itensPedido.deletedAt)),
      orderBy: (i, { desc }) => [desc(i.createdAt)],
    })

    return {
      funis: funis.map((f) => ({
        id: f.id,
        mesReferencia: f.mesReferencia,
        etapa: f.etapa,
        vendedorNome: f.vendedor.name,
        valorOrcado: f.valorOrcado,
        vendas: f.vendas.map((v) => ({
          id: v.id,
          valorFechado: v.valorFechado,
          condicaoPagamento: v.condicaoPagamento,
          pdfPedidoPath: v.pdfPedidoPath,
          dataFechamento: v.dataFechamento,
        })),
        dataEntradaEtapa: f.dataEntradaEtapa,
        motivoPerdaCategoria: f.motivoPerdaCategoria,
        motivoPerdaObservacao: f.motivoPerdaObservacao,
        empresaRepasse: f.empresaRepasse,
        motivoRepasseObservacao: f.motivoRepasseObservacao,
      })),
      contatos: contatos.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        resultado: c.resultado,
        observacao: c.observacao,
        dataHora: c.dataHora,
      })),
      itens: itens.map((i) => ({
        id: i.id,
        descricao: i.descricao,
        quantidade: i.quantidade,
        valorUnitario: i.valorUnitario,
        valorTotal: i.valorTotal,
        createdAt: i.createdAt,
      })),
      // "Qual item ele mais compra" — agrupa por descrição normalizada
      // (maiúsculas + espaços colapsados, pra "Filtro de óleo" e "FILTRO DE
      // ÓLEO " contarem como o mesmo item) e ordena por nº de pedidos em que
      // apareceu, não só quantidade total (1 pedido de 50un não deveria
      // parecer "mais comprado" que o item que ele compra toda vez que fecha
      // um pedido). Pedido do João, 2026-09-01.
      itensMaisComprados: (() => {
        const grupos = new Map<
          string,
          { descricao: string; qtdPedidos: number; quantidadeTotal: number; valorTotal: number; ultimaCompra: string }
        >()
        for (const i of itens) {
          const chave = i.descricao.trim().toUpperCase().replace(/\s+/g, ' ')
          const atual = grupos.get(chave)
          if (atual) {
            atual.qtdPedidos += 1
            atual.quantidadeTotal += i.quantidade ?? 0
            atual.valorTotal += i.valorTotal ?? 0
            if (i.createdAt > atual.ultimaCompra) atual.ultimaCompra = i.createdAt
          } else {
            grupos.set(chave, {
              descricao: i.descricao.trim(),
              qtdPedidos: 1,
              quantidadeTotal: i.quantidade ?? 0,
              valorTotal: i.valorTotal ?? 0,
              ultimaCompra: i.createdAt,
            })
          }
        }
        return Array.from(grupos.values()).sort((a, b) => b.qtdPedidos - a.qtdPedidos || b.quantidadeTotal - a.quantidadeTotal)
      })(),
    }
  }),

  create: protectedProcedure
    .input(
      z.object({
        razaoSocial: z.string().min(2),
        cnpj: z.string().optional(),
        cpf: z.string().optional(),
        codigo: z.string().optional(),
        inscricaoEstadual: z.string().optional(),
        regiao: z.enum(REGIAO_VALUES),
        estado: z.string().optional(),
        cidade: z.string().optional(),
        telefoneWhatsapp: z.string().optional(),
        email: z.string().optional(),
        nomeContato: z.string().optional(),
        statusFiscal: z.enum(['isento', 'normal', 'consumidor_final']).optional(),
        ticketMedioHistorico: z.number().optional(),
        vendedorAtualId: z.number().optional(),
        origemMarketing: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let cnpjLimpo: string | undefined
      if (input.cnpj) {
        if (!cnpjValido(input.cnpj)) throw new Error('CNPJ inválido')
        cnpjLimpo = limparCnpj(input.cnpj)
        const existente = await db.query.clientes.findFirst({
          where: and(eq(clientes.cnpj, cnpjLimpo), eq(clientes.empresaId, ctx.empresaId)),
        })
        if (existente && !existente.deletedAt) throw new Error('Já existe um cliente com este CNPJ')
      }

      let cpfLimpo: string | undefined
      if (input.cpf) {
        if (!cpfValido(input.cpf)) throw new Error('CPF inválido')
        cpfLimpo = limparCpf(input.cpf)
        const existente = await db.query.clientes.findFirst({
          where: and(eq(clientes.cpf, cpfLimpo), eq(clientes.empresaId, ctx.empresaId)),
        })
        if (existente && !existente.deletedAt) throw new Error('Já existe um cliente com este CPF')
      }

      // Cadastro manual não vem com o "Código" do sistema legado (só a
      // importação em massa traz) — gera um código próprio, prefixado "M"
      // pra nunca colidir com os códigos "C0xxxxx" importados.
      const codigo = input.codigo || `M${Date.now()}`

      const vendedorAtualId = ctx.user.role === 'admin' ? (input.vendedorAtualId ?? null) : ctx.user.id
      if (vendedorAtualId) {
        const vendedor = await db.query.users.findFirst({ where: eq(users.id, vendedorAtualId) })
        if (!vendedor || vendedor.empresaId !== ctx.empresaId) throw new Error('Vendedor inválido')
      }

      const result = await db.insert(clientes).values({
        empresaId: ctx.empresaId,
        razaoSocial: input.razaoSocial,
        cnpj: cnpjLimpo,
        cpf: cpfLimpo,
        codigo,
        inscricaoEstadual: input.inscricaoEstadual,
        regiao: input.regiao,
        estado: input.estado,
        cidade: input.cidade,
        telefoneWhatsapp: input.telefoneWhatsapp,
        email: input.email,
        nomeContato: input.nomeContato,
        statusFiscal: input.statusFiscal,
        ticketMedioHistorico: input.ticketMedioHistorico,
        cadastradoPor: ctx.user.id,
        vendedorAtualId,
        origemMarketing: input.origemMarketing ?? false,
      })
      const clienteId = Number(result.lastInsertRowid)

      if (vendedorAtualId) {
        await db.insert(carteiraHistorico).values({ clienteId, vendedorId: vendedorAtualId })
        await db.insert(funilMensal).values({
          clienteId,
          vendedorId: vendedorAtualId,
          mesReferencia: mesReferenciaAtual(),
        })
      }

      await registrarAuditoria({ tabela: 'clientes', registroId: clienteId, acao: 'criar', alteradoPor: ctx.user.id })
      return { id: clienteId }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        versao: z.number(),
        razaoSocial: z.string().min(2).optional(),
        cnpj: z.string().optional(),
        cpf: z.string().optional(),
        codigo: z.string().optional(),
        inscricaoEstadual: z.string().optional(),
        estado: z.string().optional(),
        cidade: z.string().optional(),
        endereco: z.string().optional(),
        telefoneWhatsapp: z.string().optional(),
        email: z.string().optional(),
        nomeContato: z.string().optional(),
        statusFiscal: z.enum(['isento', 'normal', 'consumidor_final']).optional(),
        observacoes: z.string().optional(),
        ticketMedioHistorico: z.number().optional(),
        origemMarketing: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, versao, cnpj, cpf, codigo, ...rest } = input
      const cliente = await db.query.clientes.findFirst({
        where: and(eq(clientes.id, id), isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)),
      })
      if (!cliente) throw new Error('Cliente não encontrado')
      if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')

      const updates: Record<string, unknown> = { ...rest, updatedAt: new Date().toISOString(), versao: versao + 1 }
      if (cnpj) {
        if (!cnpjValido(cnpj)) throw new Error('CNPJ inválido')
        const cnpjLimpo = limparCnpj(cnpj)
        if (cnpjLimpo !== cliente.cnpj) {
          const existente = await db.query.clientes.findFirst({
            where: and(eq(clientes.cnpj, cnpjLimpo), eq(clientes.empresaId, ctx.empresaId)),
          })
          if (existente && !existente.deletedAt && existente.id !== id) throw new Error('Já existe um cliente com este CNPJ')
        }
        updates.cnpj = cnpjLimpo
      }
      if (cpf) {
        if (!cpfValido(cpf)) throw new Error('CPF inválido')
        const cpfLimpo = limparCpf(cpf)
        if (cpfLimpo !== cliente.cpf) {
          const existente = await db.query.clientes.findFirst({
            where: and(eq(clientes.cpf, cpfLimpo), eq(clientes.empresaId, ctx.empresaId)),
          })
          if (existente && !existente.deletedAt && existente.id !== id) throw new Error('Já existe um cliente com este CPF')
        }
        updates.cpf = cpfLimpo
      }
      // Código é sempre o código do SAP — único por empresa (ver comentário
      // no schema), então troca de código passa pela mesma checagem de
      // colisão que o CNPJ, senão o erro que sobe é o UNIQUE cru do SQLite.
      if (codigo && codigo !== cliente.codigo) {
        const existente = await db.query.clientes.findFirst({
          where: and(eq(clientes.codigo, codigo), eq(clientes.empresaId, ctx.empresaId)),
        })
        if (existente && !existente.deletedAt && existente.id !== id) throw new Error('Já existe um cliente com este código')
        updates.codigo = codigo
      }

      const updated = await db
        .update(clientes)
        .set(updates)
        .where(and(eq(clientes.id, id), eq(clientes.versao, versao)))
      if (updated.rowsAffected === 0) {
        throw new Error('Este cliente foi alterado por outra pessoa. Recarregue a página e tente de novo.')
      }

      await registrarAuditoria({ tabela: 'clientes', registroId: id, acao: 'editar', alteradoPor: ctx.user.id })
      return { success: true }
    }),

  softDelete: adminProcedure
    .input(
      z.object({
        id: z.number(),
        motivo: z.string().min(1, 'Informe o motivo da exclusão'),
        comprovantePath: z.string().min(1, 'Anexe o print/imagem comprovando o motivo'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const cliente = await db.query.clientes.findFirst({
        where: and(eq(clientes.id, input.id), eq(clientes.empresaId, ctx.empresaId)),
      })
      if (!cliente) throw new Error('Cliente não encontrado')

      await db
        .update(clientes)
        .set({
          deletedAt: agoraSqlite(),
          motivoExclusao: input.motivo,
          comprovanteExclusaoPath: input.comprovantePath,
        })
        .where(eq(clientes.id, input.id))
      await registrarAuditoria({
        tabela: 'clientes',
        registroId: input.id,
        acao: 'excluir',
        campo: 'motivo_exclusao',
        valorNovo: input.motivo,
        alteradoPor: ctx.user.id,
      })
      return { success: true }
    }),

  restore: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const cliente = await db.query.clientes.findFirst({
      where: and(eq(clientes.id, input.id), eq(clientes.empresaId, ctx.empresaId)),
    })
    if (!cliente) throw new Error('Cliente não encontrado')

    await db.update(clientes).set({ deletedAt: null }).where(eq(clientes.id, input.id))
    await registrarAuditoria({ tabela: 'clientes', registroId: input.id, acao: 'restaurar', alteradoPor: ctx.user.id })
    return { success: true }
  }),

  lixeira: adminProcedure.query(async ({ ctx }) => {
    return db.query.clientes.findMany({
      where: and(isNotNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)),
      orderBy: [desc(clientes.deletedAt)],
    })
  }),

  // Qualquer cliente ativo sem vendedor — não só os importados com rótulo de
  // origem (esses ganham o rótulo real; os demais caem em "Sem origem
  // definida", ex: cadastro manual sem vendedor). O admin distribui pra
  // carteira de alguém usando `carteira.transferirIndividual`, que já existe.
  bancoResumo: adminOrFeatureProcedure('banco_clientes').query(async ({ ctx }) => {
    const origensLiberadas = await origensLiberadasPara(ctx)
    const filtros = [eq(clientes.empresaId, ctx.empresaId), isNull(clientes.vendedorAtualId), isNull(clientes.deletedAt)]
    aplicarFiltroLiberacao(filtros, origensLiberadas)
    const linhas = await db
      .select({ origemBanco: sql<string>`coalesce(${clientes.origemBanco}, ${SEM_ORIGEM})`, quantidade: count() })
      .from(clientes)
      .where(and(...filtros))
      .groupBy(sql`coalesce(${clientes.origemBanco}, ${SEM_ORIGEM})`)
      .orderBy(desc(count()))
    return linhas
  }),

  // Estados com pelo menos 1 cliente no banco (sem vendedor) — alimenta o
  // filtro de estado na tela, só com opções que realmente existem no banco
  // agora (não a lista fixa de 27 UFs, a maioria ficaria vazia).
  bancoEstados: adminOrFeatureProcedure('banco_clientes').query(async ({ ctx }) => {
    const origensLiberadas = await origensLiberadasPara(ctx)
    const filtros = [
      eq(clientes.empresaId, ctx.empresaId),
      isNull(clientes.vendedorAtualId),
      isNull(clientes.deletedAt),
      isNotNull(clientes.estado),
    ]
    aplicarFiltroLiberacao(filtros, origensLiberadas)
    const linhas = await db.selectDistinct({ estado: clientes.estado }).from(clientes).where(and(...filtros)).orderBy(asc(clientes.estado))
    return linhas.map((l) => l.estado).filter((e): e is string => !!e)
  }),

  banco: adminOrFeatureProcedure('banco_clientes')
    .input(
      z.object({
        q: z.string().optional(),
        origemBanco: z.string().optional(),
        estado: z.string().optional(),
        pagina: z.number().min(1).default(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const origensLiberadas = await origensLiberadasPara(ctx)
      const filtros = bancoFiltros(ctx.empresaId, input)
      aplicarFiltroLiberacao(filtros, origensLiberadas)
      const where = and(...filtros)
      const [{ total }] = await db.select({ total: count() }).from(clientes).where(where)
      const items = await db.query.clientes.findMany({
        where,
        orderBy: [asc(clientes.razaoSocial)],
        limit: PAGE_SIZE,
        offset: (input.pagina - 1) * PAGE_SIZE,
      })

      return { items, total, totalPaginas: Math.max(1, Math.ceil(total / PAGE_SIZE)) }
    }),

  // Mesmos filtros de `banco`, sem paginação — alimenta o botão "Exportar
  // planilha" (a lista na tela é paginada de 20 em 20, não dá pra exportar
  // reaproveitando ela).
  bancoExportar: adminOrFeatureProcedure('banco_clientes')
    .input(
      z.object({
        q: z.string().optional(),
        origemBanco: z.string().optional(),
        estado: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const origensLiberadas = await origensLiberadasPara(ctx)
      const filtros = bancoFiltros(ctx.empresaId, input)
      aplicarFiltroLiberacao(filtros, origensLiberadas)
      return db.query.clientes.findMany({
        where: and(...filtros),
        orderBy: [asc(clientes.razaoSocial)],
        columns: {
          codigo: true,
          razaoSocial: true,
          cnpj: true,
          cidade: true,
          estado: true,
          telefoneWhatsapp: true,
          email: true,
          nomeContato: true,
          origemBanco: true,
        },
      })
    }),

  // Auto-atribuição do Banco de Clientes — só existe pra quem NÃO é admin
  // (o admin continua usando `carteira.transferirIndividual`, que deixa
  // escolher qualquer vendedor). Sempre atribui pro próprio usuário logado,
  // nunca aceita um vendedorId vindo do client — é assim que um vendedor
  // com a feature 'banco_clientes' consegue "pegar" um cliente do banco pra
  // própria carteira sem ganhar o poder de mexer na carteira de outro.
  // Confere de novo se o banco desse cliente está liberado pra ele — a tela
  // já filtra, mas essa é a trava de verdade (não dá pra "pegar" um cliente
  // de um banco que não apareceu na lista chamando o id na mão).
  bancoAutoAtribuir: adminOrFeatureProcedure('banco_clientes').input(z.object({ clienteId: z.number() })).mutation(async ({ ctx, input }) => {
    const cliente = await db.query.clientes.findFirst({
      where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId), isNull(clientes.vendedorAtualId)),
    })
    if (!cliente) throw new Error('Cliente não encontrado no banco')

    const origensLiberadas = await origensLiberadasPara(ctx)
    if (origensLiberadas !== null && !origensLiberadas.includes(cliente.origemBanco ?? SEM_ORIGEM)) {
      throw new Error('Esse banco de clientes não está liberado pra você')
    }

    // `seAindaSemVendedor: true` fecha a corrida entre vendedores clicando
    // em "pegar" o mesmo cliente ao mesmo tempo — ver comentário completo em
    // carteira.ts (transferirCliente). Achado do João, 2026-09-02.
    const resultado = await transferirCliente(input.clienteId, ctx.user.id, ctx.user.id, { seAindaSemVendedor: true })
    if (!resultado.ok) {
      throw new Error('Esse cliente acabou de ser pego por outro vendedor — escolha outro cliente do banco.')
    }
    return { success: true }
  }),

  // ── Gerenciar liberação de bancos (só admin) ────────────────────────────

  // Cada banco que existe hoje (mesmo agrupamento de bancoResumo) + quais
  // vendedores já têm acesso liberado a ele.
  bancoLiberacoesListar: adminProcedure.query(async ({ ctx }) => {
    const bancos = await db
      .select({ origemBanco: sql<string>`coalesce(${clientes.origemBanco}, ${SEM_ORIGEM})`, quantidade: count() })
      .from(clientes)
      .where(and(eq(clientes.empresaId, ctx.empresaId), isNull(clientes.vendedorAtualId), isNull(clientes.deletedAt)))
      .groupBy(sql`coalesce(${clientes.origemBanco}, ${SEM_ORIGEM})`)
      .orderBy(desc(count()))

    const liberacoes = await db.query.bancoClientesLiberacoes.findMany({
      where: eq(bancoClientesLiberacoes.empresaId, ctx.empresaId),
      columns: { origemBanco: true, vendedorId: true },
    })
    const vendedoresPorBanco = new Map<string, number[]>()
    for (const l of liberacoes) {
      const lista = vendedoresPorBanco.get(l.origemBanco) ?? []
      lista.push(l.vendedorId)
      vendedoresPorBanco.set(l.origemBanco, lista)
    }

    return bancos.map((b) => ({ ...b, vendedorIds: vendedoresPorBanco.get(b.origemBanco) ?? [] }))
  }),

  // Substitui (não soma) a lista de vendedores liberados pra um banco.
  bancoDefinirLiberacao: adminProcedure
    .input(z.object({ origemBanco: z.string().min(1), vendedorIds: z.array(z.number()) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(bancoClientesLiberacoes)
        .where(and(eq(bancoClientesLiberacoes.empresaId, ctx.empresaId), eq(bancoClientesLiberacoes.origemBanco, input.origemBanco)))
      if (input.vendedorIds.length) {
        await db.insert(bancoClientesLiberacoes).values(
          input.vendedorIds.map((vendedorId) => ({ empresaId: ctx.empresaId, origemBanco: input.origemBanco, vendedorId }))
        )
      }
      return { success: true }
    }),
})

function listFiltros(
  ctx: { empresaId: number; user: { role: string; id: number } },
  input: { q?: string; vendedorId?: number }
) {
  // Prospects (cadastrados via aba de Prospecção, ainda sem funil aberto)
  // ficam fora da lista normal de clientes até serem enviados pra carteira.
  const filtros = [isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId), eq(clientes.emProspeccao, false)]

  if (ctx.user.role === 'admin') {
    if (input.vendedorId) filtros.push(eq(clientes.vendedorAtualId, input.vendedorId))
  } else {
    filtros.push(eq(clientes.vendedorAtualId, ctx.user.id))
  }

  const termo = input.q?.trim()
  if (termo) {
    const like_ = `%${termo}%`
    const condicoes = [
      like(clientes.razaoSocial, like_),
      like(clientes.codigo, like_),
      like(clientes.estado, like_),
      like(clientes.cidade, like_),
      like(clientes.email, like_),
      like(clientes.inscricaoEstadual, like_),
      like(clientes.nomeContato, like_),
      sql`exists (select 1 from cliente_emails where cliente_emails.cliente_id = clientes.id and cliente_emails.email like ${like_})`,
    ]

    // Telefone salvo tem de tudo (hífen, espaço, parênteses — "2669-9663"),
    // mas o vendedor digita só números. Comparando dígito-a-dígito dos dois
    // lados (removendo pontuação da coluna na hora da query) o telefone bate
    // independente de como foi salvo — antes, batia só se a formatação
    // digitada fosse idêntica à salva, então quase nunca achava nada.
    const termoDigitos = termo.replace(/\D/g, '')
    // Só entra nesse ramo (CNPJ/CPF/telefone por dígito) se o termo for só
    // números/pontuação de telefone — um código como "C000001" tem letra e
    // fica de fora, senão os dígitos batiam em qualquer CNPJ que contivesse
    // aquela sequência em algum lugar, poluindo a busca por código.
    const pareceNumeroOuCnpj = /^[\d.\-/() ]+$/.test(termo)
    if (pareceNumeroOuCnpj && termoDigitos) {
      const digitosLike = `%${termoDigitos}%`
      condicoes.push(
        sql`replace(replace(replace(replace(${clientes.telefoneWhatsapp},'-',''),' ',''),'(',''),')','') like ${digitosLike}`
      )
      condicoes.push(
        sql`exists (select 1 from cliente_telefones where cliente_telefones.cliente_id = clientes.id and replace(replace(replace(replace(cliente_telefones.numero,'-',''),' ',''),'(',''),')','') like ${digitosLike})`
      )
      condicoes.push(like(clientes.cnpj, digitosLike))
      // CPF (cliente pessoa física, ex: Compretec Loja Física) ficou de
      // fora quando o campo foi criado — sem isso a busca nunca achava
      // ninguém cadastrado só com CPF, mesmo digitando o número certo.
      condicoes.push(like(clientes.cpf, digitosLike))
    }
    filtros.push(or(...condicoes)!)
  }
  return filtros
}

// Bancos (grupos `clientes.origemBanco`) liberados pro usuário logado —
// null = sem restrição (admin, sempre vê tudo). Array (pode ser []) = só
// esses bancos, já usando SEM_ORIGEM pro grupo dos clientes sem rótulo.
async function origensLiberadasPara(ctx: { empresaId: number; user: { role: string; id: number } }): Promise<string[] | null> {
  if (ctx.user.role === 'admin') return null
  const linhas = await db.query.bancoClientesLiberacoes.findMany({
    where: and(eq(bancoClientesLiberacoes.empresaId, ctx.empresaId), eq(bancoClientesLiberacoes.vendedorId, ctx.user.id)),
    columns: { origemBanco: true },
  })
  return linhas.map((l) => l.origemBanco)
}

// Acrescenta o filtro de liberação a uma lista de filtros já montada (in
// place). `[] ` liberado vira um filtro que não bate com nada — não usar
// inArray com array vazio direto (comportamento inconsistente entre bancos).
function aplicarFiltroLiberacao(filtros: unknown[], origensLiberadas: string[] | null): void {
  if (origensLiberadas === null) return
  const alvo = origensLiberadas.length ? origensLiberadas : ['__nenhum_banco_liberado__']
  filtros.push(inArray(sql`coalesce(${clientes.origemBanco}, ${SEM_ORIGEM})`, alvo))
}

function bancoFiltros(
  empresaId: number,
  input: { q?: string; origemBanco?: string; estado?: string }
) {
  const filtros = [eq(clientes.empresaId, empresaId), isNull(clientes.vendedorAtualId), isNull(clientes.deletedAt)]
  if (input.origemBanco === SEM_ORIGEM) filtros.push(isNull(clientes.origemBanco))
  else if (input.origemBanco) filtros.push(eq(clientes.origemBanco, input.origemBanco))
  if (input.estado) filtros.push(eq(clientes.estado, input.estado))

  const termo = input.q?.trim()
  if (termo) {
    const like_ = `%${termo}%`
    filtros.push(or(like(clientes.razaoSocial, like_), like(clientes.codigo, like_), like(clientes.cidade, like_))!)
  }
  return filtros
}
