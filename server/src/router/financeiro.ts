import { z } from 'zod'
import { and, between, count, eq, inArray, isNull, sql, sum } from 'drizzle-orm'
import { router, superAdminProcedure, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { users, funilMensal, vendas, inadimplenciaEmpresas } from '../db/schema.js'
import { getConfigNumero, getConfigTexto, setConfig } from '../lib/configuracoes.js'
import { agoraSqlite, diasUteisDecorridos, diasUteisNoMes, hojeBrString, mesReferenciaAtual } from '../lib/dataBr.js'
import { buscarVendasAtonComCache } from '../lib/atonErp.js'
import { buscarFaturamentoOdinCrmComCache } from '../lib/odinCrmApi.js'

// Cards do Painel Financeiro. Cada card soma 1+ empresaId — a maioria é uma
// empresa só, mas Odin Compressores e Comprefer aparecem como um único card
// (pedido do João: são duas empresas reais, mas ele quer ver como uma linha
// só). IDs conferidos direto na tabela `empresas`. `cardKey` é a chave usada
// pra guardar a inadimplência manual (`inadimplenciaEmpresas.cardKey`) —
// nunca reaproveitar/mudar depois de criado, senão perde o valor já
// lançado pro card antigo.
// `origemExterna: 'aton'` marca os cards que não têm vendedor/funil no CRM
// (venda acontece 100% no ERP Aton) — pra esses, vendas/faturamento vêm da
// API da Aton em vez de somar `vendas`/`funil_mensal` local.
const CARDS_PAINEL: { cardKey: string; nome: string; slugLogo: string; empresaIds: number[]; origemExterna?: 'aton'; somaOdinCrm?: boolean }[] = [
  { cardKey: 'joitec-distribuidora', nome: 'Joitec Distribuidora de Peças', slugLogo: 'joitec', empresaIds: [1] },
  { cardKey: 'joitec-automacao', nome: 'Joitec Automação', slugLogo: 'joitec-automacao', empresaIds: [3] },
  { cardKey: 'odin-tubos', nome: 'Odin Tubos e Conexões', slugLogo: 'odin-tubos', empresaIds: [2] },
  { cardKey: 'odin-compressores-comprefer', nome: 'Odin Compressores / Comprefer', slugLogo: 'odin-compressores', empresaIds: [4, 5], somaOdinCrm: true },
  { cardKey: 'compretec-ecommerce', nome: 'Compretec E-commerce', slugLogo: 'compretec', empresaIds: [6], origemExterna: 'aton' },
  // Loja Física passou a usar venda rápida/Kanban dentro do próprio CRM
  // (pedido do João 2026-08-19) — desligado do Aton, agora soma vendas/
  // funil_mensal local igual Joitec/Odin Tubos. E-commerce continua Aton
  // (venda 100% no marketplace, sem vendedor/funil no CRM).
  { cardKey: 'compretec-loja-fisica', nome: 'Compretec Loja Física', slugLogo: 'compretec', empresaIds: [7] },
]

const CARDS_ATON = CARDS_PAINEL.filter((c) => c.origemExterna === 'aton')

function chaveTokenAton(cardKey: string): string {
  return `aton_token_${cardKey}`
}

// Credenciais do CRM próprio da Odin Compressores (odincrm.duckdns.org) —
// só existe 1 conta/config pro grupo inteiro, diferente da Aton que tem 1
// token por loja. Somado só em "vendas do mês" (ver odinCrmApi.ts — a API
// de lá só tem relatório mensal, sem filtro de dia).
const CHAVE_ODIN_CRM_EMAIL = 'odincrm_email'
const CHAVE_ODIN_CRM_SENHA = 'odincrm_senha'

// A API da Aton só devolve o valor bruto do pedido (igual à nota fiscal) —
// não expõe comissão/frete/taxa de marketplace em lugar nenhum (nem
// Pedidos de Venda, nem Financeiro). O gerente do ecommerce confirmou o
// valor líquido real batendo com a tela de "Conciliação de Pedidos" do
// Aton (só existe no sistema desktop, não na API pública) — sem um
// endpoint pra isso, a aproximação é descontar um % médio configurável.
function chaveDescontoAton(cardKey: string): string {
  return `aton_desconto_pct_${cardKey}`
}

export const financeiroRouter = router({
  // Leitura liberada pra admin com a feature 'painel_financeiro' (ex: conta
  // dedicada "PainelTv" numa TV da loja) — cadastro de inadimplência
  // (abaixo) segue a mesma regra agora; tokens Aton e credenciais OdinCrm
  // continuam exclusivos de superAdmin de verdade.
  painelResumo: featureProcedure('painel_financeiro').query(async () => {
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
        let vendasHojeQtd = 0
        let vendasHojeValor = 0
        let vendasMesQtd = 0
        let vendasMesValor = 0
        let tokenConfigurado: boolean | undefined
        // Só a Odin Compressores/Comprefer tem "valor a faturar" (vem do
        // relatório do odincrm.duckdns.org, pedido já entrou no processo
        // mas ainda não chegou em Faturamento). As demais empresas (que
        // usam o funil local) mostram "valor em negociação" no lugar —
        // pedido do João 2026-08-28: "pontuar o que podemos fechar ainda".
        let valorAFaturar: number | null = null
        let qtdAFaturar: number | null = null
        let valorEmNegociacao: number | null = null

        let descontoPct = 0

        if (card.origemExterna === 'aton') {
          const token = await getConfigTexto(chaveTokenAton(card.cardKey))
          tokenConfigurado = !!token
          descontoPct = await getConfigNumero(chaveDescontoAton(card.cardKey), 0)
          if (token) {
            const [hojeAton, mesAton] = await Promise.all([
              buscarVendasAtonComCache(token, hoje, hoje),
              buscarVendasAtonComCache(token, mesAtual, hoje),
            ])
            const fatorLiquido = 1 - descontoPct / 100
            vendasHojeQtd = hojeAton?.quantidade ?? 0
            vendasHojeValor = (hojeAton?.valor ?? 0) * fatorLiquido
            vendasMesQtd = mesAton?.quantidade ?? 0
            vendasMesValor = (mesAton?.valor ?? 0) * fatorLiquido
          }
        } else {
          const vendedores = await db.query.users.findMany({
            where: inArray(users.empresaId, card.empresaIds),
            columns: { id: true },
          })
          const vendedorIds = vendedores.map((v) => v.id)
          // Mesmo motivo do painel.ts: funil_mensal.vendedorId (não
          // vendas.vendedorId) é quem reflete transferência de carteira.
          const filtroVendedor = vendedorIds.length ? inArray(funilMensal.vendedorId, vendedorIds) : sql`0`

          const [{ vendasHojeQtd: qtdHoje, vendasHojeValor: valHoje }] = await db
            .select({ vendasHojeQtd: count(), vendasHojeValor: sum(vendas.valorFechado).mapWith(Number) })
            .from(vendas)
            .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
            .where(and(between(vendas.dataFechamento, inicioHoje, fimHoje), isNull(vendas.deletedAt), filtroVendedor))
          vendasHojeQtd = qtdHoje
          vendasHojeValor = valHoje ?? 0

          const [{ vendasMesQtd: qtdMes, vendasMesValor: valMes }] = await db
            .select({ vendasMesQtd: count(), vendasMesValor: sum(vendas.valorFechado).mapWith(Number) })
            .from(vendas)
            .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
            .where(and(eq(vendas.mesReferencia, mesAtual), isNull(vendas.deletedAt), filtroVendedor))
          vendasMesQtd = qtdMes
          vendasMesValor = valMes ?? 0

          if (card.somaOdinCrm) {
            const [email, senha] = await Promise.all([getConfigTexto(CHAVE_ODIN_CRM_EMAIL), getConfigTexto(CHAVE_ODIN_CRM_SENHA)])
            if (email && senha) {
              const externo = await buscarFaturamentoOdinCrmComCache(email, senha, mesAtual.slice(0, 7))
              if (externo) {
                vendasMesQtd += externo.quantidade
                vendasMesValor += externo.valor
                valorAFaturar = externo.valorAFaturar
                qtdAFaturar = externo.qtdAFaturar
              }
            }
          } else {
            const [{ valor: valorNegociacao }] = await db
              .select({ valor: sum(funilMensal.valorOrcado).mapWith(Number) })
              .from(funilMensal)
              .where(and(eq(funilMensal.etapa, 'negociacao'), isNull(funilMensal.deletedAt), filtroVendedor))
            valorEmNegociacao = valorNegociacao ?? 0
          }
        }

        // Soma a meta configurada de cada empresa que entra no card (0 se
        // nenhuma empresa do grupo ainda cadastrou meta).
        const metaFaturamento = (
          await Promise.all(card.empresaIds.map((empresaId) => getConfigNumero(`meta_faturamento_empresa_${empresaId}`, 0)))
        ).reduce((s, v) => s + v, 0)

        const valorMes = vendasMesValor
        // % simples da meta do mês inteiro (não o ritmo acumulado até hoje
        // que o resto do sistema usa) — pedido direto do João: aqui no
        // Painel Financeiro ele quer "quanto já vendeu do total da meta",
        // sem prorratear pelos dias úteis já passados.
        const inad = inadPorCard.get(card.cardKey)

        return {
          cardKey: card.cardKey,
          nome: card.nome,
          slugLogo: card.slugLogo,
          origemExterna: card.origemExterna ?? null,
          tokenConfigurado: tokenConfigurado ?? null,
          descontoPct: card.origemExterna === 'aton' ? descontoPct : null,
          vendasHoje: { quantidade: vendasHojeQtd, valor: vendasHojeValor },
          vendasMes: { quantidade: vendasMesQtd, valor: valorMes },
          ticketMedioMes: vendasMesQtd > 0 ? valorMes / vendasMesQtd : 0,
          metaFaturamento,
          percentualMeta: metaFaturamento ? Math.round((valorMes / metaFaturamento) * 1000) / 10 : 0,
          bateuMeta: metaFaturamento ? valorMes >= metaFaturamento : false,
          valorAFaturar,
          qtdAFaturar,
          valorEmNegociacao,
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

    return {
      cards,
      consolidado: {
        valorMes: valorMesConsolidado,
        vendasMesQtd: cards.reduce((s, c) => s + c.vendasMes.quantidade, 0),
        vendasHojeQtd: cards.reduce((s, c) => s + c.vendasHoje.quantidade, 0),
        metaFaturamento: metaFaturamentoConsolidada,
        percentualMeta: metaFaturamentoConsolidada ? Math.round((valorMesConsolidado / metaFaturamentoConsolidada) * 1000) / 10 : 0,
        // Quanto da meta já deveria ter sido batido a essa altura do mês —
        // dias úteis já passados ÷ dias úteis do mês. Pedido do João: mostrar
        // ao lado do % real ("no dia 21/08 já era pra estar em 40%, tá em
        // 30%"), não só o % simples do total.
        percentualIdealHoje: diasUteisMes > 0 ? Math.round((diasUteisAteHoje / diasUteisMes) * 1000) / 10 : 0,
        inadimplenciaTotal: cards.reduce((s, c) => s + c.inadimplencia.valorTotal, 0),
        diasUteisMes,
        diasUteisAteHoje,
      },
    }
  }),

  atualizarInadimplencia: featureProcedure('painel_financeiro')
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

  // Status dos tokens da integração Aton ERP (Compretec E-commerce/Loja
  // Física) — nunca devolve o token em si pro client, só se já foi
  // configurado, igual ao padrão do goto.status.
  statusTokensAton: superAdminProcedure.query(async () => {
    return Promise.all(
      CARDS_ATON.map(async (card) => ({
        cardKey: card.cardKey,
        nome: card.nome,
        configurado: !!(await getConfigTexto(chaveTokenAton(card.cardKey))),
        descontoPct: await getConfigNumero(chaveDescontoAton(card.cardKey), 0),
      }))
    )
  }),

  salvarTokenAton: superAdminProcedure
    .input(z.object({ cardKey: z.string(), token: z.string().min(1) }))
    .mutation(async ({ input }) => {
      if (!CARDS_ATON.some((c) => c.cardKey === input.cardKey)) throw new Error('Card inválido pra integração Aton ERP')
      await setConfig(chaveTokenAton(input.cardKey), input.token.trim())
      return { success: true }
    }),

  salvarDescontoAton: superAdminProcedure
    .input(z.object({ cardKey: z.string(), descontoPct: z.number().min(0).max(100) }))
    .mutation(async ({ input }) => {
      if (!CARDS_ATON.some((c) => c.cardKey === input.cardKey)) throw new Error('Card inválido pra integração Aton ERP')
      await setConfig(chaveDescontoAton(input.cardKey), input.descontoPct)
      return { success: true }
    }),

  // Status da credencial do CRM da Odin Compressores — nunca devolve a
  // senha pro client, só se já foi configurada.
  statusOdinCrm: superAdminProcedure.query(async () => {
    return { configurado: !!(await getConfigTexto(CHAVE_ODIN_CRM_EMAIL)) }
  }),

  salvarCredenciaisOdinCrm: superAdminProcedure
    .input(z.object({ email: z.string().email(), senha: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await setConfig(CHAVE_ODIN_CRM_EMAIL, input.email.trim())
      await setConfig(CHAVE_ODIN_CRM_SENHA, input.senha)
      return { success: true }
    }),
})
