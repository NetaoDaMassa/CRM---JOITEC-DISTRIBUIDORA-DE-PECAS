import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { funilMensal, clientes, itensPedido, vendas, carteiraHistorico, empresas, users, caixaMovimentacoes } from '../db/schema.js'
import { agoraSqlite, mesReferenciaAtual } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { validarClienteFaturamento } from './vinculos.js'

// Só a Compretec Loja Física usa o botão de venda rápida (venda de balcão,
// consumidor final) — pedido do João depois de criar o Thiago/Marcos/Flavio
// como vendedores dessa empresa.
const SLUG_VENDA_RAPIDA = 'compretec-loja-fisica'

export const vendasRouter = router({
  // Venda de balcão (consumidor final) — cria cliente + funil já em
  // "fechado" + venda numa tacada só, sem passar pelas etapas normais
  // (novo→abordagem→...) do funil — mas exige PDF do pedido e data do
  // pedido, igual ao fechamento normal (pedido direto do João depois de
  // vendas de balcão sem nenhum comprovante registrado).
  registrarVendaRapida: protectedProcedure
    .input(
      z.object({
        nomeCliente: z.string().min(1),
        numeroPedido: z.string().min(1),
        valorFechado: z.number().positive(),
        telefone: z.string().optional(),
        condicaoPagamento: z.string().optional(),
        numeroCupomFiscal: z.string().optional(),
        dataPedido: z.string(),
        pdfPedidoPath: z.string().min(1),
        // Só o admin usa isso, pra registrar em nome de um vendedor
        // específico (o board dele mostra o funil de outra pessoa) — se
        // omitido, ou se quem chama não é admin, o crédito vai sempre pro
        // próprio usuário logado.
        vendedorId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId) })
      if (empresa?.slug !== SLUG_VENDA_RAPIDA) throw new Error('Recurso disponível só pra Compretec Loja Física')

      let vendedorAlvoId = ctx.user.id
      if (input.vendedorId && input.vendedorId !== ctx.user.id) {
        if (ctx.user.role !== 'admin') throw new Error('Só um admin pode registrar venda em nome de outro vendedor')
        const alvo = await db.query.users.findFirst({ where: and(eq(users.id, input.vendedorId), eq(users.empresaId, ctx.empresaId)) })
        if (!alvo) throw new Error('Vendedor não encontrado nessa empresa')
        vendedorAlvoId = alvo.id
      }

      // `dataPedido` chega como "YYYY-MM-DD" (input type="date") — junta com
      // a hora atual pra virar o mesmo formato "YYYY-MM-DD HH:MM:SS" que o
      // resto do app usa em `dataFechamento` (nunca ISO com T/Z, senão
      // quebra os filtros de intervalo de data que comparam como texto).
      const dataFechamento = `${input.dataPedido} ${agoraSqlite().slice(11)}`

      const codigo = `M${Date.now()}`
      const clienteResult = await db.insert(clientes).values({
        empresaId: ctx.empresaId,
        razaoSocial: input.nomeCliente,
        codigo,
        regiao: 'sul',
        telefoneWhatsapp: input.telefone || undefined,
        statusFiscal: 'consumidor_final',
        cadastradoPor: ctx.user.id,
        vendedorAtualId: vendedorAlvoId,
        dataUltimaCompra: agoraSqlite(),
      })
      const clienteId = Number(clienteResult.lastInsertRowid)

      await db.insert(carteiraHistorico).values({ clienteId, vendedorId: vendedorAlvoId })

      const mesReferencia = mesReferenciaAtual()
      const funilResult = await db.insert(funilMensal).values({
        clienteId,
        vendedorId: vendedorAlvoId,
        mesReferencia,
        etapa: 'fechado',
        dataEntradaEtapa: agoraSqlite(),
      })
      const funilMensalId = Number(funilResult.lastInsertRowid)

      const vendaResult = await db.insert(vendas).values({
        funilMensalId,
        clienteId,
        vendedorId: vendedorAlvoId,
        mesReferencia,
        valorFechado: input.valorFechado,
        condicaoPagamento: input.condicaoPagamento || null,
        numeroCupomFiscal: input.numeroCupomFiscal || null,
        numeroPedido: input.numeroPedido,
        pdfPedidoPath: input.pdfPedidoPath,
        dataFechamento,
      })
      const vendaId = Number(vendaResult.lastInsertRowid)

      // Só soma no Caixa quando o pagamento foi em Dinheiro de verdade — Pix
      // e Cartão não passam pelo caixa físico da loja, ficam de fora
      // (pedido direto do João: "Caixa - somente dinheiro").
      if (input.condicaoPagamento === 'Dinheiro') {
        await db.insert(caixaMovimentacoes).values({
          empresaId: ctx.empresaId,
          tipo: 'entrada',
          valor: input.valorFechado,
          data: input.dataPedido,
          descricao: `Venda balcão — ${input.nomeCliente}`,
          origemVendaId: vendaId,
          criadoPor: ctx.user.id,
        })
      }

      await registrarAuditoria({ tabela: 'clientes', registroId: clienteId, acao: 'criar', alteradoPor: ctx.user.id })

      return { clienteId, funilMensalId, vendaId }
    }),

  // Cliente já fechou esse mês e comprou de novo — em vez de reabrir/mudar
  // etapa (o card continua "Fechado", é o mesmo relacionamento), só soma
  // mais uma venda ao mês dele. `moverEtapa` continua sendo o único jeito de
  // registrar a *primeira* venda (é o que efetivamente muda a etapa pra
  // "Fechado" e dispara a validação de "Novo" etc.).
  registrar: protectedProcedure
    .input(
      z.object({
        funilMensalId: z.number(),
        valorFechado: z.number(),
        condicaoPagamento: z.string().optional(),
        pdfPedidoPath: z.string(),
        clienteIdFaturamento: z.number().optional(),
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
      if (funil.etapa !== 'fechado') {
        throw new Error('Só é possível registrar uma venda adicional em um cliente que já fechou esse mês.')
      }

      const clienteFaturamentoId = input.clienteIdFaturamento ?? funil.clienteId
      if (clienteFaturamentoId !== funil.clienteId) {
        await validarClienteFaturamento(funil.clienteId, clienteFaturamentoId, ctx.empresaId)
      }

      const vendaResult = await db.insert(vendas).values({
        funilMensalId: funil.id,
        clienteId: clienteFaturamentoId,
        vendedorId: funil.vendedorId,
        mesReferencia: funil.mesReferencia,
        valorFechado: input.valorFechado,
        condicaoPagamento: input.condicaoPagamento ?? null,
        pdfPedidoPath: input.pdfPedidoPath,
      })
      const vendaId = Number(vendaResult.lastInsertRowid)

      if (input.itens?.length) {
        await db.insert(itensPedido).values(
          input.itens.map((item) => ({
            vendaId,
            clienteId: clienteFaturamentoId,
            descricao: item.descricao,
            quantidade: item.quantidade ?? null,
            valorUnitario: item.valorUnitario ?? null,
            valorTotal: item.quantidade != null && item.valorUnitario != null ? item.quantidade * item.valorUnitario : null,
          }))
        )
      }

      await db.update(clientes).set({ dataUltimaCompra: agoraSqlite() }).where(eq(clientes.id, clienteFaturamentoId))

      return { id: vendaId }
    }),

  // Corrige dados de uma venda já lançada (valor, condição de pagamento) —
  // pedido direto do João, pra não precisar apagar/refazer quando o
  // vendedor erra ou o valor muda depois do fechamento.
  editar: protectedProcedure
    .input(
      z.object({
        vendaId: z.number(),
        valorFechado: z.number().optional(),
        condicaoPagamento: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const venda = await db.query.vendas.findFirst({ where: eq(vendas.id, input.vendaId) })
      if (!venda) throw new Error('Venda não encontrada')
      if (ctx.user.role !== 'admin' && venda.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

      await db
        .update(vendas)
        .set({
          valorFechado: input.valorFechado ?? venda.valorFechado,
          condicaoPagamento: input.condicaoPagamento !== undefined ? input.condicaoPagamento || null : venda.condicaoPagamento,
        })
        .where(eq(vendas.id, input.vendaId))

      return { success: true }
    }),

  // Etapa "Faturamento" (só Compretec Loja Física) — confirma se saiu cupom
  // ou nota fiscal dessa venda, e se já foi faturado de fato. Os dois campos
  // são independentes: dá pra marcar o tipo antes de confirmar que faturou.
  atualizarFaturamento: protectedProcedure
    .input(
      z.object({
        vendaId: z.number(),
        tipoComprovante: z.enum(['cupom_fiscal', 'nota_fiscal']).optional(),
        faturado: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const venda = await db.query.vendas.findFirst({ where: eq(vendas.id, input.vendaId) })
      if (!venda) throw new Error('Venda não encontrada')
      if (ctx.user.role !== 'admin' && venda.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

      const updates: { tipoComprovante?: 'cupom_fiscal' | 'nota_fiscal'; faturado?: boolean } = {}
      if (input.tipoComprovante !== undefined) updates.tipoComprovante = input.tipoComprovante
      if (input.faturado !== undefined) updates.faturado = input.faturado

      await db.update(vendas).set(updates).where(eq(vendas.id, input.vendaId))
      return { success: true }
    }),
})
