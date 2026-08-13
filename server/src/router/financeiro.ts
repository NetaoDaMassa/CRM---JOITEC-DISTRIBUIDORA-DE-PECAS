import { z } from 'zod'
import { and, between, count, eq, inArray, isNull, sql, sum } from 'drizzle-orm'
import { router, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { users, funilMensal, vendas, inadimplenciaEmpresas } from '../db/schema.js'
import { getConfigNumero } from '../lib/configuracoes.js'
import { agoraSqlite, diasUteisDecorridos, diasUteisNoMes, hojeBrString, mesReferenciaAtual } from '../lib/dataBr.js'

// Cards do Painel Financeiro. Cada card soma 1+ empresaId — a maioria é uma
// empresa só, mas Odin Compressores e Comprefer aparecem como um único card
// (pedido do João: são duas empresas reais, mas ele quer ver como uma linha
// só). IDs conferidos direto na tabela `empresas`. `cardKey` é a chave usada
// pra guardar a inadimplência manual (`inadimplenciaEmpresas.cardKey`) —
// nunca reaproveitar/mudar depois de criado, senão perde o valor já
// lançado pro card antigo.
const CARDS_PAINEL: { cardKey: string; nome: string; slugLogo: string; empresaIds: number[] }[] = [
  { cardKey: 'joitec-distribuidora', nome: 'Joitec Distribuidora de Peças', slugLogo: 'joitec', empresaIds: [1] },
  { cardKey: 'joitec-automacao', nome: 'Joitec Automação', slugLogo: 'joitec-automacao', empresaIds: [3] },
  { cardKey: 'odin-tubos', nome: 'Odin Tubos e Conexões', slugLogo: 'odin-tubos', empresaIds: [2] },
  { cardKey: 'odin-compressores-comprefer', nome: 'Odin Compressores / Comprefer', slugLogo: 'odin-compressores', empresaIds: [4, 5] },
  { cardKey: 'compretec-ecommerce', nome: 'Compretec E-commerce', slugLogo: 'compretec', empresaIds: [6] },
  { cardKey: 'compretec-loja-fisica', nome: 'Compretec Loja Física', slugLogo: 'compretec', empresaIds: [7] },
]

export const financeiroRouter = router({
  painelResumo: superAdminProcedure.query(async () => {
    const hoje = hojeBrString()
    const inicioHoje = `${hoje} 00:00:00`
    const fimHoje = `${hoje} 23:59:59`
    const mesAtual = mesReferenciaAtual()
    const diasUteisMes = diasUteisNoMes(mesAtual)
    const diasUteisAteHoje = diasUteisDecorridos(mesAtual)

    const inadimplenciaRows = await db.query.inadimplenciaEmpresas.findMany({
      where: inArray(
        inadimplenciaEmpresas.cardKey,
        CARDS_PAINEL.map((c) => c.cardKey)
      ),
    })
    const inadPorCard = new Map(inadimplenciaRows.map((r) => [r.cardKey, r]))

    const cards = await Promise.all(
      CARDS_PAINEL.map(async (card) => {
        const vendedores = await db.query.users.findMany({
          where: inArray(users.empresaId, card.empresaIds),
          columns: { id: true },
        })
        const vendedorIds = vendedores.map((v) => v.id)
        // Mesmo motivo do painel.ts: funil_mensal.vendedorId (não
        // vendas.vendedorId) é quem reflete transferência de carteira.
        const filtroVendedor = vendedorIds.length ? inArray(funilMensal.vendedorId, vendedorIds) : sql`0`

        const [{ vendasHojeQtd, vendasHojeValor }] = await db
          .select({ vendasHojeQtd: count(), vendasHojeValor: sum(vendas.valorFechado).mapWith(Number) })
          .from(vendas)
          .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
          .where(and(between(vendas.dataFechamento, inicioHoje, fimHoje), isNull(vendas.deletedAt), filtroVendedor))

        const [{ vendasMesQtd, vendasMesValor }] = await db
          .select({ vendasMesQtd: count(), vendasMesValor: sum(vendas.valorFechado).mapWith(Number) })
          .from(vendas)
          .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
          .where(and(eq(vendas.mesReferencia, mesAtual), isNull(vendas.deletedAt), filtroVendedor))

        // Soma a meta configurada de cada empresa que entra no card (0 se
        // nenhuma empresa do grupo ainda cadastrou meta).
        const metaFaturamento = (
          await Promise.all(card.empresaIds.map((empresaId) => getConfigNumero(`meta_faturamento_empresa_${empresaId}`, 0)))
        ).reduce((s, v) => s + v, 0)

        const valorMes = vendasMesValor ?? 0
        const metaFaturamentoDia = metaFaturamento ? metaFaturamento / diasUteisMes : null
        const metaAcumuladaAteHoje = metaFaturamentoDia ? metaFaturamentoDia * diasUteisAteHoje : null

        const inad = inadPorCard.get(card.cardKey)

        return {
          cardKey: card.cardKey,
          nome: card.nome,
          slugLogo: card.slugLogo,
          vendasHoje: { quantidade: vendasHojeQtd, valor: vendasHojeValor ?? 0 },
          vendasMes: { quantidade: vendasMesQtd, valor: valorMes },
          ticketMedioMes: vendasMesQtd > 0 ? valorMes / vendasMesQtd : 0,
          metaFaturamento,
          percentualMeta: metaAcumuladaAteHoje ? Math.round((valorMes / metaAcumuladaAteHoje) * 1000) / 10 : 0,
          bateuMeta: metaAcumuladaAteHoje ? valorMes >= metaAcumuladaAteHoje : false,
          inadimplencia: {
            valorTotal: inad?.valorTotal ?? 0,
            quantidadeClientes: inad?.quantidadeClientes ?? 0,
            atualizadoEm: inad?.atualizadoEm ?? null,
          },
        }
      })
    )

    const valorMesConsolidado = cards.reduce((s, c) => s + c.vendasMes.valor, 0)
    const metaFaturamentoConsolidada = cards.reduce((s, c) => s + c.metaFaturamento, 0)
    const metaFaturamentoDiaConsolidada = metaFaturamentoConsolidada ? metaFaturamentoConsolidada / diasUteisMes : null
    const metaAcumuladaConsolidada = metaFaturamentoDiaConsolidada ? metaFaturamentoDiaConsolidada * diasUteisAteHoje : null

    return {
      cards,
      consolidado: {
        valorMes: valorMesConsolidado,
        vendasMesQtd: cards.reduce((s, c) => s + c.vendasMes.quantidade, 0),
        vendasHojeQtd: cards.reduce((s, c) => s + c.vendasHoje.quantidade, 0),
        metaFaturamento: metaFaturamentoConsolidada,
        percentualMeta: metaAcumuladaConsolidada ? Math.round((valorMesConsolidado / metaAcumuladaConsolidada) * 1000) / 10 : 0,
        inadimplenciaTotal: cards.reduce((s, c) => s + c.inadimplencia.valorTotal, 0),
        diasUteisMes,
        diasUteisAteHoje,
      },
    }
  }),

  atualizarInadimplencia: superAdminProcedure
    .input(
      z.object({
        cardKey: z.string(),
        valorTotal: z.number().min(0),
        quantidadeClientes: z.number().int().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!CARDS_PAINEL.some((c) => c.cardKey === input.cardKey)) throw new Error('Card inválido pro Painel Financeiro')

      const existente = await db.query.inadimplenciaEmpresas.findFirst({
        where: eq(inadimplenciaEmpresas.cardKey, input.cardKey),
      })

      if (existente) {
        await db
          .update(inadimplenciaEmpresas)
          .set({
            valorTotal: input.valorTotal,
            quantidadeClientes: input.quantidadeClientes,
            atualizadoPor: ctx.user.id,
            atualizadoEm: agoraSqlite(),
          })
          .where(eq(inadimplenciaEmpresas.cardKey, input.cardKey))
      } else {
        await db.insert(inadimplenciaEmpresas).values({
          cardKey: input.cardKey,
          valorTotal: input.valorTotal,
          quantidadeClientes: input.quantidadeClientes,
          atualizadoPor: ctx.user.id,
          atualizadoEm: agoraSqlite(),
        })
      }

      return { success: true }
    }),
})
