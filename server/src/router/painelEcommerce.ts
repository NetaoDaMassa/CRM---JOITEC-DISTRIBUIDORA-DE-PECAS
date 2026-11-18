import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, adminOrFeatureProcedure, featureProcedure } from './_base.js'
import { hojeBrString } from '../lib/dataBr.js'
import { lerConfigEcommerce, pedidosDoMes, salvarConfigEcommerce, type PedidoEcommerce } from '../lib/painelEcommerce.js'

// Painel E-commerce — telão (painel_ecommerce) + configuração da gestora
// (painel_ecommerce_config). Ver lib/painelEcommerce.ts.
const FEATURE_TV = 'painel_ecommerce'
const FEATURE_CONFIG = 'painel_ecommerce_config'

type Soma = { qtd: number; valor: number; hojeQtd: number; hojeValor: number; cancQtd: number; cancValor: number; aguardQtd: number; aguardValor: number }
const vazio = (): Soma => ({ qtd: 0, valor: 0, hojeQtd: 0, hojeValor: 0, cancQtd: 0, cancValor: 0, aguardQtd: 0, aguardValor: 0 })
function somar(s: Soma, p: PedidoEcommerce, valor: number, hoje: string) {
  if (p.situacao === 'venda') {
    s.qtd++
    s.valor += valor
    if (p.dia === hoje) (s.hojeQtd++, (s.hojeValor += valor))
  } else if (p.situacao === 'cancelado') (s.cancQtd++, (s.cancValor += valor))
  else (s.aguardQtd++, (s.aguardValor += valor))
}
// Valor que conta no painel: bruto, ou bruto − % de desconto da conta.
const fatorDe = (config: { base: string; descontos: Record<string, number> }, conta: string) =>
  config.base === 'liquido' ? 1 - Math.min(Math.max(config.descontos[conta] ?? 0, 0), 100) / 100 : 1
const r2 = (n: number) => Math.round(n * 100) / 100
const arred = (s: Soma): Soma => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, r2(v)])) as Soma

export const painelEcommerceRouter = router({
  resumo: adminOrFeatureProcedure(FEATURE_TV).query(async () => {
    const hoje = hojeBrString()
    const de = `${hoje.slice(0, 8)}01`
    const [config, leitura] = await Promise.all([lerConfigEcommerce(), pedidosDoMes(de, hoje)])
    if (!leitura) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Token da Aton do e-commerce não configurado.' })

    const porConta = new Map<string, Soma>()
    const dias = new Map<string, number>()
    const horas = Array(24).fill(0) as number[]
    // Contas configuradas sempre aparecem (ex.: Magalu sem pedido no mês).
    for (const conta of Object.keys(config.contas)) porConta.set(conta, vazio())
    for (const p of leitura.pedidos) {
      const valor = p.valor * fatorDe(config, p.conta)
      const s = porConta.get(p.conta) ?? vazio()
      somar(s, p, valor, hoje)
      porConta.set(p.conta, s)
      const dona = config.contas[p.conta] ?? ''
      if (p.situacao === 'venda' && dona !== 'fora') {
        dias.set(p.dia, (dias.get(p.dia) ?? 0) + valor)
        if (p.hora != null) horas[p.hora]++
      }
    }
    const contas = [...porConta.entries()].map(([conta, s]) => ({
      conta,
      dona: config.contas[conta] ?? '', // conta nova da Aton que ninguém configurou = só soma no total
      configurada: conta in config.contas,
      ...arred(s),
    }))
    const noPainel = contas.filter((c) => c.dona !== 'fora')
    const total = vazio()
    for (const c of noPainel) for (const k of Object.keys(total) as (keyof Soma)[]) total[k] += c[k]

    const vendedoras = config.vendedoras
      .map((v) => {
        const cs = noPainel.filter((c) => c.dona === v.id)
        const s = vazio()
        for (const c of cs) for (const k of Object.keys(s) as (keyof Soma)[]) s[k] += c[k]
        return { ...v, contas: cs.map((c) => ({ conta: c.conta, valor: c.valor, qtd: c.qtd })), ...arred(s) }
      })
      // Ranking pelo % da Meta 1 de cada uma (metas muito diferentes entre elas).
      .sort((a, b) => b.valor / (b.metas[0] || 1) - a.valor / (a.metas[0] || 1))

    const [ano, mes] = hoje.split('-').map(Number)
    const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
    const diaHoje = Number(hoje.slice(8, 10))
    return {
      hoje,
      lidoEm: new Date(leitura.lidoEm).toISOString(),
      diaHoje,
      diasNoMes, // marketplace vende todo dia — ritmo/falta por dia corrido
      metaGeral: config.metaGeral,
      base: config.base,
      total: arred(total),
      vendedoras,
      contas: contas.sort((a, b) => b.valor - a.valor),
      dias: [...dias.entries()].sort().map(([dia, valor]) => ({ dia, valor: r2(valor) })),
      horas,
    }
  }),

  config: featureProcedure(FEATURE_CONFIG).query(async () => {
    const hoje = hojeBrString()
    const [config, leitura] = await Promise.all([lerConfigEcommerce(), pedidosDoMes(`${hoje.slice(0, 8)}01`, hoje).catch(() => null)])
    // Toda conta que apareceu na Aton no mês entra na lista pra gestora escolher
    // a dona. Bruto do mês por conta = pra conferir o % com a tela de
    // Conciliação de Pedidos do Aton (mesmo período).
    const qtd = new Map<string, number>()
    const bruto = new Map<string, number>()
    for (const p of leitura?.pedidos ?? [])
      if (p.situacao === 'venda') (qtd.set(p.conta, (qtd.get(p.conta) ?? 0) + 1), bruto.set(p.conta, (bruto.get(p.conta) ?? 0) + p.valor))
    const nomes = [...new Set([...Object.keys(config.contas), ...qtd.keys()])].sort()
    return {
      ...config,
      contasAton: nomes.map((conta) => ({ conta, pedidosMes: qtd.get(conta) ?? 0, brutoMes: r2(bruto.get(conta) ?? 0), dona: config.contas[conta] ?? '' })),
    }
  }),

  salvarConfig: featureProcedure(FEATURE_CONFIG)
    .input(
      z.object({
        metaGeral: z.number().min(0),
        vendedoras: z
          .array(
            z.object({
              id: z.string().min(1).max(40),
              nome: z.string().min(1).max(60),
              metas: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)]),
              fotoPath: z.string().max(500).nullable(),
            })
          )
          .max(20),
        contas: z.record(z.string().max(80), z.string().max(40)),
        descontos: z.record(z.string().max(80), z.number().min(0).max(100)),
        base: z.enum(['bruto', 'liquido']),
      })
    )
    .mutation(async ({ input }) => {
      await salvarConfigEcommerce(input)
      return { ok: true }
    }),
})
