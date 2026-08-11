import { z } from 'zod'
import { and, asc, count, desc, eq, isNull, isNotNull, like, or, sql } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, carteiraHistorico, funilMensal, registroContato, itensPedido, vendas, users } from '../db/schema.js'
import { cnpjValido, limparCnpj, formatarCnpj } from '../lib/cnpj.js'
import { buscarCnpj } from '../lib/brasilApi.js'
import { regiaoPorUf, REGIAO_VALUES } from '../lib/regiao.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { mesReferenciaAtual, agoraSqlite } from '../lib/dataBr.js'

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
        // Só entra nesse ramo (CNPJ/telefone por dígito) se o termo for só
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
        }
        filtros.push(or(...condicoes)!)
      }

      const where = and(...filtros)
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
    }
  }),

  create: protectedProcedure
    .input(
      z.object({
        razaoSocial: z.string().min(2),
        cnpj: z.string().optional(),
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
        codigo: z.string().optional(),
        inscricaoEstadual: z.string().optional(),
        estado: z.string().optional(),
        cidade: z.string().optional(),
        telefoneWhatsapp: z.string().optional(),
        email: z.string().optional(),
        nomeContato: z.string().optional(),
        statusFiscal: z.enum(['isento', 'normal', 'consumidor_final']).optional(),
        observacoes: z.string().optional(),
        ticketMedioHistorico: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, versao, cnpj, codigo, ...rest } = input
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
  bancoResumo: adminProcedure.query(async ({ ctx }) => {
    const linhas = await db
      .select({ origemBanco: sql<string>`coalesce(${clientes.origemBanco}, ${SEM_ORIGEM})`, quantidade: count() })
      .from(clientes)
      .where(and(eq(clientes.empresaId, ctx.empresaId), isNull(clientes.vendedorAtualId), isNull(clientes.deletedAt)))
      .groupBy(sql`coalesce(${clientes.origemBanco}, ${SEM_ORIGEM})`)
      .orderBy(desc(count()))
    return linhas
  }),

  banco: adminProcedure
    .input(
      z.object({
        q: z.string().optional(),
        origemBanco: z.string().optional(),
        pagina: z.number().min(1).default(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const filtros = [eq(clientes.empresaId, ctx.empresaId), isNull(clientes.vendedorAtualId), isNull(clientes.deletedAt)]
      if (input.origemBanco === SEM_ORIGEM) filtros.push(isNull(clientes.origemBanco))
      else if (input.origemBanco) filtros.push(eq(clientes.origemBanco, input.origemBanco))

      const termo = input.q?.trim()
      if (termo) {
        const like_ = `%${termo}%`
        filtros.push(or(like(clientes.razaoSocial, like_), like(clientes.codigo, like_), like(clientes.cidade, like_))!)
      }

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
})
