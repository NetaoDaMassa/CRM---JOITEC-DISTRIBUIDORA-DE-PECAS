import { and, eq, gt, inArray, notInArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { cobrancaTitulos, sapTitulosAbertos } from '../db/schema.js'
import { agoraSqlite, ehDiaNaoUtil, hojeBrString } from './dataBr.js'
import { getConfigNumero, getConfigTexto } from './configuracoes.js'
import { diaUtilApos } from './reguaCobranca.js'

// Cobrança automática a partir das contas a receber do SAP (financeiro,
// 2026-11-13). Ver comentário de cobrancaTitulos no schema.
export const EMPRESAS_COBRANCA = ['joitec', 'odin-tubos', 'joitec-automacao']
export const DIAS_COBRAR = 5 // dias úteis 1..5 cobrando
export const DIA_UTIL_CARTORIO = 6 // no 6º dia útil sem pagar → cartório

export async function regrasCobranca() {
  return {
    diasRetorno: await getConfigNumero('cobranca_dias_retorno_cartorio', 10),
    diasRc: await getConfigNumero('cobranca_dias_rc', 60),
  }
}

// Quantos dias úteis passaram depois do vencimento até `hoje` (o dia do
// vencimento não conta). 0 = ainda não começou a cobrar.
export function diasUteisAposVencimento(vencimento: string, hoje: string): number {
  const d = new Date(`${vencimento.slice(0, 10)}T00:00:00Z`)
  const fim = new Date(`${hoje}T00:00:00Z`)
  let n = 0
  while (true) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (d > fim) break
    if (!ehDiaNaoUtil(d)) n++
    if (n > 400) break
  }
  return n
}

export function somarDias(dataIso: string, dias: number): string {
  const d = new Date(`${dataIso.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function chaveDe(t: { empresaSlug: string | null; codigoCliente: string; tipo: string; documento: string; parcela: string | null }) {
  return [t.empresaSlug ?? '', t.codigoCliente, t.tipo, t.documento, t.parcela ?? ''].join('|')
}

// Refaz a lista a partir da foto do SAP. Roda ao abrir a tela e depois de
// cada sincronização das contas a receber. Devolve quantos mudaram.
let rodando: Promise<unknown> | null = null
export function atualizarCobrancas() {
  if (!rodando) rodando = atualizar().finally(() => (rodando = null))
  return rodando as Promise<{ novos: number; pagos: number; cartorio: number; rc: number }>
}

async function atualizar() {
  const hoje = hojeBrString()
  const { diasRetorno, diasRc } = await regrasCobranca()
  const ignorar = ((await getConfigTexto('sap_receber_ignorar_clientes')) ?? 'C003770,C002707,C001284,C001270').split(',').map((s) => s.trim())
  const foto = await db
    .select()
    .from(sapTitulosAbertos)
    .where(and(gt(sapTitulosAbertos.valorAberto, 0), inArray(sapTitulosAbertos.tipo, ['nota', 'titulo_antigo']), inArray(sapTitulosAbertos.empresaSlug, EMPRESAS_COBRANCA)))
  const vencidos = foto.filter((t) => t.vencimento && !ignorar.includes(t.codigoCliente) && diasUteisAposVencimento(t.vencimento, hoje) >= 1)
  const existentes = await db.select().from(cobrancaTitulos)
  const porChave = new Map(existentes.map((e) => [e.chave, e]))
  let novos = 0
  let pagos = 0
  let cartorio = 0
  let rc = 0
  const chavesNaFoto = new Set<string>()
  for (const t of vencidos) {
    const chave = chaveDe(t)
    chavesNaFoto.add(chave)
    const e = porChave.get(chave)
    if (!e) {
      await db.insert(cobrancaTitulos).values({
        chave,
        empresaSlug: t.empresaSlug,
        codigoCliente: t.codigoCliente,
        nomeCliente: t.nomeCliente,
        tipo: t.tipo,
        documento: t.documento,
        parcela: t.parcela,
        emissao: t.emissao,
        vencimento: t.vencimento!.slice(0, 10),
        valor: t.valorAberto,
        vendedorSap: t.vendedorSap,
        formaPagamento: t.formaPagamento,
        formaPagamentoDesc: t.formaPagamentoDesc,
        cnpjCliente: t.cnpjCliente,
      })
      novos++
    } else {
      // Voltou a aparecer em aberto depois de "pago automático" = baixa
      // estornada no SAP: volta pra cobrança.
      const reabrir = e.status === 'pago' && e.pagoAuto
      // Banco e CNPJ: atualiza também os títulos que já estavam na cobrança.
      const mudouBanco = (t.formaPagamento ?? null) !== (e.formaPagamento ?? null) || (t.formaPagamentoDesc ?? null) !== (e.formaPagamentoDesc ?? null) || (t.cnpjCliente ?? null) !== (e.cnpjCliente ?? null)
      if (reabrir || mudouBanco || e.valor !== t.valorAberto || e.nomeCliente !== t.nomeCliente)
        await db
          .update(cobrancaTitulos)
          .set({ valor: t.valorAberto, nomeCliente: t.nomeCliente, formaPagamento: t.formaPagamento, formaPagamentoDesc: t.formaPagamentoDesc, cnpjCliente: t.cnpjCliente, atualizadoEm: agoraSqlite(), ...(reabrir ? { status: e.rcEm ? 'rc' : e.cartorioEm ? 'cartorio' : 'cobrar', pagoEm: null, pagoAuto: false } : {}) })
          .where(eq(cobrancaTitulos.id, e.id))
    }
  }
  // Sumiu da foto do SAP = pago. Só com foto de verdade (sincronização que
  // falhou deixa a tabela vazia — aí não marca ninguém).
  if (foto.length > 0) {
    const sumiram = existentes.filter((e) => e.status !== 'pago' && !chavesNaFoto.has(e.chave))
    if (sumiram.length) {
      await db
        .update(cobrancaTitulos)
        .set({ status: 'pago', pagoEm: hoje, pagoAuto: true, atualizadoEm: agoraSqlite() })
        .where(inArray(cobrancaTitulos.id, sumiram.map((e) => e.id)))
      pagos = sumiram.length
    }
  }
  // Régua: cartório no 6º dia útil, RC aos 60 dias do vencimento.
  const abertos = await db.select().from(cobrancaTitulos).where(notInArray(cobrancaTitulos.status, ['pago', 'rc']))
  for (const a of abertos) {
    if (somarDias(a.vencimento, diasRc) <= hoje) {
      await db.update(cobrancaTitulos).set({ status: 'rc', rcEm: hoje, atualizadoEm: agoraSqlite() }).where(eq(cobrancaTitulos.id, a.id))
      rc++
      continue
    }
    if (a.status === 'cobrar' && diaUtilApos(a.vencimento, DIA_UTIL_CARTORIO) <= hoje) {
      await db
        .update(cobrancaTitulos)
        .set({ status: 'cartorio', cartorioEm: hoje, retornoEm: somarDias(hoje, diasRetorno), atualizadoEm: agoraSqlite() })
        .where(eq(cobrancaTitulos.id, a.id))
      cartorio++
    }
  }
  return { novos, pagos, cartorio, rc }
}

// ── Mensagens prontas ──
export const MSG_PADRAO = {
  cobranca:
    'Olá, {cliente}! Tudo bem? Aqui é do financeiro do Grupo Odin / Joitec.\n\nConsta em aberto:\n{titulos}\n\nTotal: {total}\n\nSe já pagou, pode desconsiderar e nos mandar o comprovante. Se precisar da 2ª via do boleto, é só pedir. Obrigado!',
  cartorio:
    'Olá, {cliente}. Aqui é do financeiro do Grupo Odin / Joitec.\n\nComo não identificamos o pagamento, o(s) título(s) abaixo foi(ram) encaminhado(s) ao cartório:\n{titulos}\n\nTotal: {total}\n\nPara regularizar, entre em contato com a gente o quanto antes.',
}

export async function mensagensCobranca(): Promise<{ cobranca: string; cartorio: string }> {
  return {
    cobranca: (await getConfigTexto('cobranca_msg_cobranca')) || MSG_PADRAO.cobranca,
    cartorio: (await getConfigTexto('cobranca_msg_cartorio')) || MSG_PADRAO.cartorio,
  }
}
