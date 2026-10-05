import { z } from 'zod'
import { and, desc, eq, gte, inArray, isNull, like, lte, or } from 'drizzle-orm'
import { router, adminOrFeatureProcedure, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { solicitacoesCredito, solicitacaoCreditoAnexos, liberacoesCredito, clientes, empresas, users } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { buildHistoricoCliente } from './clientes.js'

const anexoInput = z.object({
  urlArquivo: z.string(),
  nomeArquivo: z.string(),
  tipoArquivo: z.string().optional(),
})

// Fluxo completo de solicitação de crédito: o vendedor abre o pedido (com
// tudo que tem sobre o cliente, inclusive anexos — print, áudio, vídeo) e
// quem cuida do Financeiro (feature 'solicitacao_credito') responde com a
// decisão. Mesma chave de feature controla os dois lados — `solicitar` e
// `meusPedidos` usam `adminOrFeatureProcedure` (vendedor passa só com a
// permissão concedida em Permissões, admin sempre passa); o resto exige
// `featureProcedure` (financeiro, admin-only). Cross-empresa igual
// liberacaoCredito.ts: quem responde vê/decide pras 4 empresas numa tela
// só. Pedido do João, 2026-10-01.
export const solicitacaoCreditoRouter = router({
  solicitar: adminOrFeatureProcedure('solicitacao_credito')
    .input(
      z.object({
        clienteId: z.number(),
        tipo: z.enum(['consulta', 'limite']),
        // Só faz sentido (e é obrigatório) quando tipo='consulta' —
        // 'limite' não tem sub-tipo, é sempre "quanto de limite pra esse
        // cliente". Checado abaixo, não dá pra exigir isso no próprio
        // schema zod porque depende do valor de outro campo.
        tipoConsulta: z.enum(['geral', 'limpo']).optional(),
        valorSolicitado: z.number().positive().optional(),
        informacoesFiscais: z.string().trim().optional(),
        observacoes: z.string().trim().optional(),
        anexos: z.array(anexoInput).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.tipo === 'consulta' && !input.tipoConsulta) {
        throw new Error('Escolha se é consulta geral ou só verificar se está limpo.')
      }

      const cliente = await db.query.clientes.findFirst({
        where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId), isNull(clientes.deletedAt)),
      })
      if (!cliente) throw new Error('Cliente não encontrado')
      // Vendedor só pode pedir crédito pra cliente que já é dele — mesma
      // regra de qualquer outra ação de carteira. Admin pode pra qualquer um.
      if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) {
        throw new Error('Esse cliente não está na sua carteira')
      }

      // Mesmo padrão de aprovacoes.solicitar — evita o vendedor abrir vários
      // pedidos em paralelo pro mesmo cliente (o financeiro teria que
      // decidir qual vale, e o segundo pedido ficaria com dados
      // desatualizados assim que o primeiro for respondido). Escopado por
      // `tipo` — pode ter uma "consulta" E uma "limite" pendentes ao mesmo
      // tempo pro mesmo cliente, são filas separadas agora.
      const pendente = await db.query.solicitacoesCredito.findFirst({
        where: and(
          eq(solicitacoesCredito.clienteId, input.clienteId),
          eq(solicitacoesCredito.status, 'pendente'),
          eq(solicitacoesCredito.tipo, input.tipo)
        ),
      })
      if (pendente) throw new Error('Já existe uma solicitação desse tipo pendente pra este cliente.')

      const result = await db.insert(solicitacoesCredito).values({
        empresaId: cliente.empresaId,
        clienteId: cliente.id,
        vendedorSolicitanteId: ctx.user.id,
        tipo: input.tipo,
        tipoConsulta: input.tipo === 'consulta' ? input.tipoConsulta : undefined,
        valorSolicitado: input.valorSolicitado,
        informacoesFiscais: input.informacoesFiscais,
        observacoes: input.observacoes,
      })
      const solicitacaoId = Number(result.lastInsertRowid)

      if (input.anexos?.length) {
        await db.insert(solicitacaoCreditoAnexos).values(
          input.anexos.map((a) => ({
            solicitacaoId,
            origem: 'vendedor' as const,
            urlArquivo: a.urlArquivo,
            nomeArquivo: a.nomeArquivo,
            tipoArquivo: a.tipoArquivo,
          }))
        )
      }

      return { id: solicitacaoId }
    }),

  // Histórico do próprio vendedor — status de cada pedido que ele fez,
  // inclusive já respondidos (pra ver a decisão e usar o botão "Contestar
  // no WhatsApp").
  meusPedidos: adminOrFeatureProcedure('solicitacao_credito').query(async ({ ctx }) => {
    const linhas = await db
      .select({
        id: solicitacoesCredito.id,
        clienteId: solicitacoesCredito.clienteId,
        clienteNome: clientes.razaoSocial,
        clienteCodigo: clientes.codigo,
        tipo: solicitacoesCredito.tipo,
        tipoConsulta: solicitacoesCredito.tipoConsulta,
        status: solicitacoesCredito.status,
        valorSolicitado: solicitacoesCredito.valorSolicitado,
        informacoesFiscais: solicitacoesCredito.informacoesFiscais,
        observacoes: solicitacoesCredito.observacoes,
        valorLiberado: solicitacoesCredito.valorLiberado,
        quemLiberou: solicitacoesCredito.quemLiberou,
        motivoResposta: solicitacoesCredito.motivoResposta,
        serasaObservacao: solicitacoesCredito.serasaObservacao,
        decididoPor: solicitacoesCredito.decididoPor,
        decididoEm: solicitacoesCredito.decididoEm,
        createdAt: solicitacoesCredito.createdAt,
      })
      .from(solicitacoesCredito)
      .innerJoin(clientes, eq(clientes.id, solicitacoesCredito.clienteId))
      .where(eq(solicitacoesCredito.vendedorSolicitanteId, ctx.user.id))
      .orderBy(desc(solicitacoesCredito.createdAt))
      .limit(200)

      const ids = linhas.map((l) => l.id)
      const anexos = ids.length
        ? await db.query.solicitacaoCreditoAnexos.findMany({ where: inArray(solicitacaoCreditoAnexos.solicitacaoId, ids) })
        : []
      const anexosPorSolicitacao = new Map<number, typeof anexos>()
      for (const a of anexos) {
        const lista = anexosPorSolicitacao.get(a.solicitacaoId) ?? []
        lista.push(a)
        anexosPorSolicitacao.set(a.solicitacaoId, lista)
      }

      const decisorIds = [...new Set(linhas.map((l) => l.decididoPor).filter((id): id is number => id !== null))]
      const decisores = decisorIds.length
        ? await db.query.users.findMany({ where: inArray(users.id, decisorIds), columns: { id: true, name: true, whatsapp: true } })
        : []
      const decisorPorId = new Map(decisores.map((d) => [d.id, d]))

      return linhas.map((l) => ({
        ...l,
        anexos: anexosPorSolicitacao.get(l.id) ?? [],
        decisorNome: l.decididoPor ? decisorPorId.get(l.decididoPor)?.name ?? null : null,
        decisorWhatsapp: l.decididoPor ? decisorPorId.get(l.decididoPor)?.whatsapp ?? null : null,
      }))
  }),

  // Nomes dos vendedores que já têm alguma solicitação — alimenta o filtro
  // de vendedor na fila do Financeiro. Cross-empresa também (não dá pra
  // reaproveitar `users.vendors`, que só traz os da empresa ativa da
  // sessão).
  vendedoresOpcoes: featureProcedure('solicitacao_credito').query(async () => {
    return db
      .selectDistinct({ id: users.id, name: users.name })
      .from(solicitacoesCredito)
      .innerJoin(users, eq(users.id, solicitacoesCredito.vendedorSolicitanteId))
      .orderBy(users.name)
  }),

  // Fila do Financeiro — cross-empresa, sem filtro de ctx.empresaId de
  // propósito (mesmo padrão de liberacaoCredito.listar).
  listar: featureProcedure('solicitacao_credito')
    .input(
      z
        .object({
          status: z.enum(['pendente', 'liberado', 'negado']).optional(),
          // Sem isso = traz os dois tipos juntos (não usado hoje — as duas
          // telas, Consulta/Solicitação de Crédito e a aba "Limites" de
          // Liberação de Crédito, sempre passam um tipo fixo).
          tipo: z.enum(['consulta', 'limite']).optional(),
          dataDe: z.string().optional(),
          dataAte: z.string().optional(),
          vendedorId: z.number().optional(),
          q: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const filtros = []
      if (input?.status) filtros.push(eq(solicitacoesCredito.status, input.status))
      if (input?.tipo) filtros.push(eq(solicitacoesCredito.tipo, input.tipo))
      if (input?.dataDe) filtros.push(gte(solicitacoesCredito.createdAt, input.dataDe))
      if (input?.dataAte) filtros.push(lte(solicitacoesCredito.createdAt, `${input.dataAte} 23:59:59`))
      if (input?.vendedorId) filtros.push(eq(solicitacoesCredito.vendedorSolicitanteId, input.vendedorId))
      if (input?.q) {
        const termo = `%${input.q.trim()}%`
        filtros.push(or(like(clientes.razaoSocial, termo), like(clientes.codigo, termo))!)
      }

      const linhas = await db
        .select({
          id: solicitacoesCredito.id,
          clienteId: solicitacoesCredito.clienteId,
          clienteNome: clientes.razaoSocial,
          clienteCodigo: clientes.codigo,
          empresaId: solicitacoesCredito.empresaId,
          empresaNome: empresas.nome,
          vendedorSolicitanteId: solicitacoesCredito.vendedorSolicitanteId,
          vendedorNome: users.name,
          tipo: solicitacoesCredito.tipo,
          tipoConsulta: solicitacoesCredito.tipoConsulta,
          status: solicitacoesCredito.status,
          valorSolicitado: solicitacoesCredito.valorSolicitado,
          createdAt: solicitacoesCredito.createdAt,
        })
        .from(solicitacoesCredito)
        .innerJoin(clientes, eq(clientes.id, solicitacoesCredito.clienteId))
        .innerJoin(empresas, eq(empresas.id, solicitacoesCredito.empresaId))
        .innerJoin(users, eq(users.id, solicitacoesCredito.vendedorSolicitanteId))
        .where(filtros.length ? and(...filtros) : undefined)
        .orderBy(desc(solicitacoesCredito.createdAt))
        .limit(500)

      return linhas
    }),

  detalhe: featureProcedure('solicitacao_credito').input(z.object({ id: z.number() })).query(async ({ input }) => {
    const solicitacao = await db.query.solicitacoesCredito.findFirst({ where: eq(solicitacoesCredito.id, input.id) })
    if (!solicitacao) throw new Error('Solicitação não encontrada')

    const [cliente, vendedor, anexos] = await Promise.all([
      db.query.clientes.findFirst({ where: eq(clientes.id, solicitacao.clienteId) }),
      db.query.users.findFirst({ where: eq(users.id, solicitacao.vendedorSolicitanteId), columns: { id: true, name: true, whatsapp: true } }),
      db.query.solicitacaoCreditoAnexos.findMany({
        where: eq(solicitacaoCreditoAnexos.solicitacaoId, solicitacao.id),
        orderBy: (a, { asc }) => [asc(a.createdAt)],
      }),
    ])
    const empresa = cliente ? await db.query.empresas.findFirst({ where: eq(empresas.id, cliente.empresaId) }) : null

    return {
      ...solicitacao,
      clienteNome: cliente?.razaoSocial ?? '—',
      clienteCodigo: cliente?.codigo ?? '—',
      empresaNome: empresa?.nome ?? '—',
      vendedorNome: vendedor?.name ?? '—',
      vendedorWhatsapp: vendedor?.whatsapp ?? null,
      anexos,
    }
  }),

  // Histórico completo do cliente pra quem vai decidir — cross-empresa igual
  // o resto desta tela, por isso NÃO reaproveita `clientes.historico`
  // diretamente (aquele é travado na empresa ativa da sessão e em quem é
  // dono do cliente; aqui a permissão de verdade já é a feature acima).
  historicoCliente: featureProcedure('solicitacao_credito')
    .input(z.object({ clienteId: z.number() }))
    .query(async ({ input }) => buildHistoricoCliente(input.clienteId)),

  responder: featureProcedure('solicitacao_credito')
    .input(
      z.object({
        id: z.number(),
        decisao: z.enum(['liberado', 'negado']),
        valorLiberado: z.number().positive().optional(),
        quemLiberou: z.string().trim().min(1, 'Informe quem decidiu'),
        motivoResposta: z.string().trim().min(1, 'Informe o motivo'),
        serasaObservacao: z.string().trim().optional(),
        anexos: z.array(anexoInput).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const solicitacao = await db.query.solicitacoesCredito.findFirst({ where: eq(solicitacoesCredito.id, input.id) })
      if (!solicitacao) throw new Error('Solicitação não encontrada')
      if (solicitacao.status !== 'pendente') throw new Error('Essa solicitação já foi respondida.')
      // tipo='consulta'+'limpo' é só "está limpo ou não", sem valor nenhum
      // — pedido do João, 2026-10-05. Pros outros dois casos (consulta
      // geral e limite), valor continua obrigatório pra liberar.
      const exigeValor = !(solicitacao.tipo === 'consulta' && solicitacao.tipoConsulta === 'limpo')
      if (input.decisao === 'liberado' && exigeValor && !input.valorLiberado) {
        throw new Error('Informe o valor liberado.')
      }

      const updates: Record<string, unknown> = {
        status: input.decisao,
        quemLiberou: input.quemLiberou.trim(),
        motivoResposta: input.motivoResposta.trim(),
        decididoPor: ctx.user.id,
        decididoEm: agoraSqlite(),
        updatedAt: agoraSqlite(),
      }
      if (input.decisao === 'liberado') updates.valorLiberado = input.valorLiberado
      if (input.serasaObservacao) updates.serasaObservacao = input.serasaObservacao

      await db.update(solicitacoesCredito).set(updates).where(eq(solicitacoesCredito.id, input.id))

      if (input.anexos?.length) {
        await db.insert(solicitacaoCreditoAnexos).values(
          input.anexos.map((a) => ({
            solicitacaoId: input.id,
            origem: 'financeiro' as const,
            urlArquivo: a.urlArquivo,
            nomeArquivo: a.nomeArquivo,
            tipoArquivo: a.tipoArquivo,
          }))
        )
      }

      // Pedido do João, 2026-10-01: toda resposta de CONSULTA (liberado OU
      // negado) também entra no histórico de Liberação de Crédito > Lançamentos
      // — registro único de "o que já foi decidido" pra esse cliente, cross-
      // empresa. Mudou em 2026-10-05: 'limite' não entra mais aqui — fica só
      // na própria fila (aba "Limites"), pra não misturar as duas listas.
      if (solicitacao.tipo === 'consulta') {
        const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, solicitacao.clienteId) })
        await db.insert(liberacoesCredito).values({
          clienteId: solicitacao.clienteId,
          empresaId: solicitacao.empresaId,
          vendedorId: cliente?.vendedorAtualId ?? solicitacao.vendedorSolicitanteId,
          quemLiberou: input.quemLiberou.trim(),
          motivo: input.motivoResposta.trim(),
          status: input.decisao,
          valorLiberado: input.decisao === 'liberado' ? input.valorLiberado : undefined,
          origemSolicitacaoId: input.id,
          criadoPor: ctx.user.id,
        })
      }

      return { success: true }
    }),
})
