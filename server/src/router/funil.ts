import { z } from 'zod'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { funilMensal, clientes, registroContato, itensPedido, vendas, solicitacoesCarteira } from '../db/schema.js'
import { mesReferenciaAtual, diasDesde, agoraSqlite } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { executarResetMensal } from '../lib/resetMensal.js'

const ETAPA_VALUES = ['novo', 'abordagem', 'interessado', 'negociacao', 'fechado', 'perdido', 'sem_contato', 'consumidor_final'] as const

// Compartilhado entre `meuFunil` (vendedor vendo o próprio funil) e
// `funilPorVendedor` (admin vendo o funil de qualquer vendedor específico) —
// mesmo formato de card pros dois casos, só muda de quem é o funil.
async function buscarFunilDoVendedor(vendedorId: number, ctxUserId: number, ctxIsAdmin: boolean, mesReferencia?: string) {
  const mes = mesReferencia ?? mesReferenciaAtual()

  const funis = await db.query.funilMensal.findMany({
    where: and(eq(funilMensal.vendedorId, vendedorId), eq(funilMensal.mesReferencia, mes), isNull(funilMensal.deletedAt)),
    with: {
      cliente: {
        columns: {
          id: true,
          razaoSocial: true,
          telefoneWhatsapp: true,
          email: true,
          cnpj: true,
          codigo: true,
          inscricaoEstadual: true,
          estado: true,
          cidade: true,
          versao: true,
        },
        with: {
          telefonesExtras: { orderBy: (t, { asc }) => [asc(t.id)] },
        },
      },
      vendas: {
        where: isNull(vendas.deletedAt),
        orderBy: (v, { desc }) => [desc(v.dataFechamento)],
      },
    },
  })

  const funilIds = funis.map((f) => f.id)
  const contatos = funilIds.length
    ? await db.query.registroContato.findMany({
        where: and(inArray(registroContato.funilMensalId, funilIds), isNull(registroContato.deletedAt)),
        orderBy: (c, { desc }) => [desc(c.dataHora)],
      })
    : []
  const contatosPorFunil = new Map<number, typeof contatos>()
  for (const c of contatos) {
    const lista = contatosPorFunil.get(c.funilMensalId) ?? []
    lista.push(c)
    contatosPorFunil.set(c.funilMensalId, lista)
  }

  // Pedidos de descarte/transferência pendentes de aprovação — vira uma
  // etiqueta no card pra não esquecer que tem algo em aberto naquele cliente.
  const clienteIds = funis.map((f) => f.cliente.id)
  const pedidosPendentes = clienteIds.length
    ? await db.query.solicitacoesCarteira.findMany({
        where: and(inArray(solicitacoesCarteira.clienteId, clienteIds), eq(solicitacoesCarteira.status, 'pendente')),
      })
    : []
  const pedidoPorCliente = new Map(pedidosPendentes.map((p) => [p.clienteId, p.tipo]))

  return funis.map((f) => ({
    funilMensalId: f.id,
    versao: f.versao,
    etapa: f.etapa,
    vendedorId: f.vendedorId,
    clienteId: f.cliente.id,
    razaoSocial: f.cliente.razaoSocial,
    telefoneWhatsapp: f.cliente.telefoneWhatsapp,
    telefonesExtras: f.cliente.telefonesExtras,
    email: f.cliente.email,
    cnpj: f.cliente.cnpj,
    codigo: f.cliente.codigo,
    inscricaoEstadual: f.cliente.inscricaoEstadual,
    estado: f.cliente.estado,
    cidade: f.cliente.cidade,
    clienteVersao: f.cliente.versao,
    pedidoPendente: pedidoPorCliente.get(f.cliente.id) ?? null,
    diasSemContato: diasDesde(f.dataUltimoContato),
    qtdTentativasContato: f.qtdTentativasContato,
    dataEntradaEtapa: f.dataEntradaEtapa,
    valorOrcado: f.valorOrcado,
    vendas: f.vendas.map((v) => ({
      id: v.id,
      valorFechado: v.valorFechado,
      condicaoPagamento: v.condicaoPagamento,
      pdfPedidoPath: v.pdfPedidoPath,
      dataFechamento: v.dataFechamento,
    })),
    valorFechadoTotal: f.vendas.reduce((soma, v) => soma + v.valorFechado, 0),
    carregadoMesAnterior: f.carregadoMesAnterior,
    contatos: (contatosPorFunil.get(f.id) ?? []).map((c) => ({
      id: c.id,
      tipo: c.tipo,
      resultado: c.resultado,
      observacao: c.observacao,
      dataHora: c.dataHora,
      editavel: ctxIsAdmin || c.vendedorId === ctxUserId,
    })),
  }))
}

const ETAPAS_ABERTAS_FILA = ['novo', 'abordagem', 'interessado', 'negociacao', 'sem_contato']
const TAMANHO_FILA_HOJE = 20

export const funilRouter = router({
  meuFunil: protectedProcedure.input(z.object({ mesReferencia: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
    return buscarFunilDoVendedor(ctx.user.id, ctx.user.id, ctx.user.role === 'admin', input?.mesReferencia)
  }),

  // "Fila de hoje" — em vez do vendedor caçar quem precisa de atenção
  // vasculhando as colunas do Kanban, aqui já vem pronto: só etapas em
  // aberto, ordenado por quem está há mais tempo sem contato (nunca
  // contatado vem primeiro — é o caso mais urgente). Cortado num tamanho de
  // fila diária razoável; o resto continua acessível pelo Kanban normal.
  filaHoje: protectedProcedure.query(async ({ ctx }) => {
    const cards = await buscarFunilDoVendedor(ctx.user.id, ctx.user.id, ctx.user.role === 'admin')
    const abertos = cards.filter((c) => ETAPAS_ABERTAS_FILA.includes(c.etapa))

    abertos.sort((a, b) => {
      const pa = a.diasSemContato ?? Infinity
      const pb = b.diasSemContato ?? Infinity
      return pb - pa
    })

    return { total: abertos.length, cards: abertos.slice(0, TAMANHO_FILA_HOJE) }
  }),

  // Admin vendo o funil (tratativa de venda) de um vendedor específico —
  // ele acompanha tudo que cada vendedor está fazendo, não só os números
  // agregados dos relatórios/painel de TV. Pode editar/excluir os contatos
  // de qualquer vendedor (mesma regra que já vale em `contatos.editar`).
  funilPorVendedor: adminProcedure
    .input(z.object({ vendedorId: z.number(), mesReferencia: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      return buscarFunilDoVendedor(input.vendedorId, ctx.user.id, true, input.mesReferencia)
    }),

  moverEtapa: protectedProcedure
    .input(
      z.object({
        funilMensalId: z.number(),
        versao: z.number(),
        etapa: z.enum(ETAPA_VALUES),
        valorOrcado: z.number().optional(),
        valorFechado: z.number().optional(),
        condicaoPagamento: z.string().optional(),
        pdfPedidoPath: z.string().optional(),
        motivoPerdaCategoria: z.enum(['estoque', 'financeiro', 'compras']).optional(),
        motivoPerdaOpcao: z.string().optional(),
        motivoPerdaItem: z.string().optional(),
        motivoPerdaObservacao: z.string().optional(),
        empresaRepasse: z.enum(['tubos_conexoes', 'compressores', 'outra']).optional(),
        motivoRepasseObservacao: z.string().optional(),
        itens: z
          .array(
            z.object({
              descricao: z.string().min(1),
              quantidade: z.number().optional(),
              valorUnitario: z.number().optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const funil = await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, input.funilMensalId) })
      if (!funil) throw new Error('Card não encontrado')
      if (ctx.user.role !== 'admin' && funil.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

      if (funil.etapa === 'novo' && input.etapa !== 'novo' && funil.qtdTentativasContato === 0) {
        throw new Error('Registre ao menos um contato antes de mover este cliente para fora de "Novo".')
      }

      const updates: Record<string, unknown> = {
        etapa: input.etapa,
        dataEntradaEtapa: agoraSqlite(),
        valorOrcado: input.valorOrcado ?? null,
        updatedAt: agoraSqlite(),
        versao: input.versao + 1,
      }

      if (input.etapa === 'fechado') {
        // `moverEtapa` só cobre a *primeira* venda (é o que efetivamente
        // muda a etapa) — reenviar "fechado" com o cliente já fechado
        // duplicaria a venda. Pra comprar de novo no mesmo mês é
        // `vendas.registrar`, sem passar por aqui.
        if (funil.etapa === 'fechado') {
          throw new Error('Este cliente já está fechado esse mês. Use "Registrar nova venda" pra lançar outro pedido.')
        }
        if (input.valorFechado === undefined) throw new Error('Informe o valor fechado.')
        if (!input.pdfPedidoPath) throw new Error('Anexe o PDF do pedido/nota para fechar a venda.')
      }

      if (input.etapa === 'perdido') {
        if (!input.motivoPerdaCategoria || !input.motivoPerdaObservacao) {
          throw new Error('Informe a categoria e a observação do motivo de perda.')
        }
        updates.motivoPerdaCategoria = input.motivoPerdaCategoria
        updates.motivoPerdaOpcao = input.motivoPerdaOpcao ?? null
        updates.motivoPerdaItem = input.motivoPerdaItem ?? null
        updates.motivoPerdaObservacao = input.motivoPerdaObservacao
      }

      if (input.etapa === 'consumidor_final') {
        if (!input.empresaRepasse) {
          throw new Error('Informe para qual empresa este cliente foi repassado.')
        }
        updates.empresaRepasse = input.empresaRepasse
        updates.motivoRepasseObservacao = input.motivoRepasseObservacao ?? null
      }

      const updated = await db
        .update(funilMensal)
        .set(updates)
        .where(and(eq(funilMensal.id, input.funilMensalId), eq(funilMensal.versao, input.versao)))
      if (updated.rowsAffected === 0) {
        throw new Error('Este card foi alterado por outra pessoa enquanto você editava. Recarregue a página e tente de novo.')
      }

      if (input.etapa !== funil.etapa) {
        await registrarAuditoria({
          tabela: 'funil_mensal',
          registroId: input.funilMensalId,
          acao: 'mudar_etapa',
          campo: 'etapa',
          valorAnterior: funil.etapa,
          valorNovo: input.etapa,
          alteradoPor: ctx.user.id,
        })
      }

      if (input.etapa === 'fechado') {
        await db.update(clientes).set({ dataUltimaCompra: agoraSqlite() }).where(eq(clientes.id, funil.clienteId))

        const vendaResult = await db.insert(vendas).values({
          funilMensalId: input.funilMensalId,
          clienteId: funil.clienteId,
          vendedorId: funil.vendedorId,
          mesReferencia: funil.mesReferencia,
          valorFechado: input.valorFechado!,
          condicaoPagamento: input.condicaoPagamento ?? null,
          pdfPedidoPath: input.pdfPedidoPath,
        })
        const vendaId = Number(vendaResult.lastInsertRowid)

        // Itens são opcionais (o vendedor pode fechar só com o valor total e o
        // PDF, sem detalhar item a item) — mas quando informados, alimentam o
        // relatório "itens mais comprados" e o histórico do cliente, que antes
        // só seriam preenchidos pela extração de PDF via IA (bloco 11, ainda
        // bloqueado sem chave da Anthropic).
        if (input.itens?.length) {
          await db.insert(itensPedido).values(
            input.itens.map((item) => ({
              vendaId,
              clienteId: funil.clienteId,
              descricao: item.descricao,
              quantidade: item.quantidade ?? null,
              valorUnitario: item.valorUnitario ?? null,
              valorTotal: item.quantidade != null && item.valorUnitario != null ? item.quantidade * item.valorUnitario : null,
            }))
          )
        }
      }

      return { success: true }
    }),

  // Roda sozinho todo início de mês (scheduler.ts), mas o admin também pode
  // forçar manualmente — útil pra testar sem esperar o mês virar, ou como
  // rede de segurança se o servidor ficou fora do ar na virada.
  rodarResetMensal: adminProcedure.mutation(async () => {
    return executarResetMensal()
  }),
})
