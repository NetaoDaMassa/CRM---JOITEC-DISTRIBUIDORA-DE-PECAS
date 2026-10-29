import { db } from '../db/client.js'
import { sapSaldosClientes, sapTitulosAbertos } from '../db/schema.js'
import { getConfigTexto } from './configuracoes.js'
import { comSessaoSap, dataSap } from './sapServiceLayer.js'
import { vendedoresAutomacaoSap } from './sapSyncItens.js'

// Contas a receber em aberto, direto do SAP — pedido do João, 2026-10-29:
// mostrar ao vendedor (card do Kanban e ficha) que o cliente está devendo.
// Cada rodada refaz a foto inteira (sap_titulos_abertos / sap_saldos_clientes).
//
// O saldo do cliente no SAP NÃO é só nota fiscal (conferido na Connectar
// C001311: o SAP mostrava R$ 23.844,31 e as notas davam R$ 20.937,36):
//   + parcelas em aberto das notas de venda (DocumentInstallments);
//   + títulos do sistema antigo, lançados no SAP como lançamento manual em
//     31/03 ("EFETIV. PEDIDO VENDA"), menos o que já foi pago por
//     recebimento (IncomingPayments → it_JournalEntry, por linha);
//     lançamento manual a crédito só abate quando é o estorno de um a débito
//     do mesmo cliente (mesmo valor e vencimento) — o resto é crédito já
//     conciliado com nota e entraria em dobro;
//   − notas de devolução em aberto (crédito do cliente).
// A soma bate com o CurrentAccountBalance do SAP em ~99% dos clientes
// (1.476 de 1.492 no teste); a diferença fica registrada em
// sap_saldos_clientes pra tela avisar "conferir no SAP".

const CHAVE_IGNORAR = 'sap_receber_ignorar_clientes'
// Empresas do próprio grupo cadastradas como cliente no SAP (vendas entre
// filiais) — não são inadimplência de cliente: C003770 Odin Tubos,
// C002707 Joitec, C001284 Compretec, C001270 Comprefer.
const IGNORAR_PADRAO = 'C003770,C002707,C001284,C001270'
const SLUG_POR_FILIAL: Record<number, string> = { 1: 'odin-compressores', 3: 'joitec', 4: 'odin-tubos' }

interface Titulo {
  codigoCliente: string
  nomeCliente: string | null
  tipo: 'nota' | 'titulo_antigo' | 'devolucao'
  documento: string
  parcela: string | null
  emissao: string | null
  vencimento: string | null
  valorAberto: number
  filialSap: number | null
  empresaSlug: string | null
  vendedorSap: string | null
}

export interface SyncReceberResultado {
  titulos: number
  clientesComSaldo: number
  conferem: number
  naoConferem: { codigo: string; nome: string | null; saldoSap: number; calculado: number }[]
  segundos: number
}

export async function sincronizarContasReceberSap(): Promise<SyncReceberResultado> {
  const inicio = Date.now()
  const ignorar = new Set(
    ((await getConfigTexto(CHAVE_IGNORAR)) ?? IGNORAR_PADRAO)
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  )
  const automacao = await vendedoresAutomacaoSap()
  const slugDe = (filial: number | null | undefined, vendedor?: number) => {
    const slug = filial != null ? SLUG_POR_FILIAL[filial] ?? null : null
    return slug === 'joitec' && vendedor != null && automacao.has(vendedor) ? 'joitec-automacao' : slug
  }

  const dados = await comSessaoSap(async (sap) => {
    const vendedores = await sap.getTodos<{ SalesEmployeeCode: number; SalesEmployeeName: string }>(
      '/SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName'
    )
    const saldos = await sap.getTodos<{ CardCode: string; CardName: string; CurrentAccountBalance: number }>(
      "/BusinessPartners?$filter=CardType eq 'cCustomer' and CurrentAccountBalance ne 0&$select=CardCode,CardName,CurrentAccountBalance"
    )
    const notas = await sap.getTodos<{
      DocNum: number
      DocDate: string
      CardCode: string
      CardName: string
      SalesPersonCode: number
      BPL_IDAssignedToInvoice: number
      DocumentInstallments: { InstallmentId: number; DueDate: string; Total: number; PaidToDate: number | null }[]
    }>(
      "/Invoices?$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'" +
        '&$select=DocNum,DocDate,CardCode,CardName,SalesPersonCode,BPL_IDAssignedToInvoice,DocumentInstallments'
    )
    const devolucoes = await sap.getTodos<{
      DocNum: number
      DocDate: string
      CardCode: string
      CardName: string
      DocTotal: number
      PaidToDate: number | null
      BPL_IDAssignedToInvoice: number
    }>(
      "/CreditNotes?$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'" +
        '&$select=DocNum,DocDate,CardCode,CardName,DocTotal,PaidToDate,BPL_IDAssignedToInvoice'
    )
    // ~10 mil lançamentos manuais; o filtro por cliente dentro das linhas
    // ($filter com any()) não é aceito pelo Service Layer — filtra aqui.
    const lancamentos = await sap.getTodos<{
      JdtNum: number
      ReferenceDate: string
      JournalEntryLines: { Line_ID: number; ShortName: string | null; Debit: number; Credit: number; DueDate: string | null; BPLID: number | null }[]
    }>("/JournalEntries?$filter=OriginalJournal eq 'ttJournalEntry'&$select=JdtNum,ReferenceDate,JournalEntryLines")
    const recebimentos = await sap.getTodos<{
      PaymentInvoices: { InvoiceType: string; DocEntry: number; DocLine: number; SumApplied: number }[]
    }>("/IncomingPayments?$filter=Cancelled eq 'tNO'&$select=PaymentInvoices")
    return { vendedores, saldos, notas, devolucoes, lancamentos, recebimentos }
  })

  const nomeVendedor = new Map(dados.vendedores.map((v) => [v.SalesEmployeeCode, v.SalesEmployeeName]))
  const nomeCliente = new Map(dados.saldos.map((s) => [s.CardCode, s.CardName]))
  const titulos: Titulo[] = []

  for (const n of dados.notas) {
    for (const p of n.DocumentInstallments) {
      const aberto = round2(p.Total - (p.PaidToDate ?? 0))
      if (aberto <= 0) continue
      titulos.push({
        codigoCliente: n.CardCode,
        nomeCliente: n.CardName,
        tipo: 'nota',
        documento: String(n.DocNum),
        parcela: `${p.InstallmentId}/${n.DocumentInstallments.length}`,
        emissao: dataSap(n.DocDate),
        vencimento: dataSap(p.DueDate),
        valorAberto: aberto,
        filialSap: n.BPL_IDAssignedToInvoice,
        empresaSlug: slugDe(n.BPL_IDAssignedToInvoice, n.SalesPersonCode),
        vendedorSap: nomeVendedor.get(n.SalesPersonCode) ?? null,
      })
    }
  }

  for (const d of dados.devolucoes) {
    const aberto = round2(d.DocTotal - (d.PaidToDate ?? 0))
    if (aberto <= 0) continue
    titulos.push({
      codigoCliente: d.CardCode,
      nomeCliente: d.CardName,
      tipo: 'devolucao',
      documento: String(d.DocNum),
      parcela: null,
      emissao: dataSap(d.DocDate),
      vencimento: null,
      valorAberto: -aberto,
      filialSap: d.BPL_IDAssignedToInvoice,
      empresaSlug: slugDe(d.BPL_IDAssignedToInvoice),
      vendedorSap: null,
    })
  }

  const pagoPorLinha = new Map<string, number>()
  for (const r of dados.recebimentos) {
    for (const i of r.PaymentInvoices) {
      if (i.InvoiceType !== 'it_JournalEntry') continue
      const k = `${i.DocEntry}:${i.DocLine}`
      pagoPorLinha.set(k, (pagoPorLinha.get(k) ?? 0) + i.SumApplied)
    }
  }
  type Debito = Titulo & { chave: string }
  const debitos = new Map<string, Debito[]>()
  const creditos: { cliente: string; valor: number; vencimento: string | null }[] = []
  for (const j of dados.lancamentos) {
    for (const l of j.JournalEntryLines) {
      if (!l.ShortName || !/^C\d/.test(l.ShortName)) continue
      const vencimento = l.DueDate ? dataSap(l.DueDate) : null
      if (l.Debit > 0) {
        const aberto = round2(l.Debit - (pagoPorLinha.get(`${j.JdtNum}:${l.Line_ID}`) ?? 0))
        if (aberto <= 0) continue
        const lista = debitos.get(l.ShortName) ?? []
        lista.push({
          chave: `${j.JdtNum}:${l.Line_ID}`,
          codigoCliente: l.ShortName,
          nomeCliente: nomeCliente.get(l.ShortName) ?? null,
          tipo: 'titulo_antigo',
          documento: String(j.JdtNum),
          parcela: null,
          emissao: dataSap(j.ReferenceDate),
          vencimento,
          valorAberto: aberto,
          filialSap: l.BPLID,
          empresaSlug: slugDe(l.BPLID),
          vendedorSap: null,
        })
        debitos.set(l.ShortName, lista)
      } else if (l.Credit > 0) {
        creditos.push({ cliente: l.ShortName, valor: l.Credit, vencimento })
      }
    }
  }
  for (const c of creditos) {
    const lista = debitos.get(c.cliente)
    const i = lista?.findIndex((d) => Math.abs(d.valorAberto - c.valor) < 0.005 && d.vencimento === c.vencimento) ?? -1
    if (i >= 0) lista!.splice(i, 1)
  }
  for (const lista of debitos.values()) for (const { chave: _chave, ...t } of lista) titulos.push(t)

  const validos = titulos.filter((t) => !ignorar.has(t.codigoCliente.toUpperCase()))
  const calculado = new Map<string, number>()
  for (const t of validos) calculado.set(t.codigoCliente, (calculado.get(t.codigoCliente) ?? 0) + t.valorAberto)
  const saldos = dados.saldos
    .filter((s) => !ignorar.has(s.CardCode.toUpperCase()))
    .map((s) => ({
      codigoCliente: s.CardCode,
      nomeCliente: s.CardName as string | null,
      saldoSap: s.CurrentAccountBalance,
      saldoCalculado: round2(calculado.get(s.CardCode) ?? 0),
    }))
  // Cliente com títulos abertos mas saldo 0 no SAP (não veio na lista acima).
  const comSaldo = new Set(saldos.map((s) => s.codigoCliente))
  for (const [codigo, valor] of calculado) {
    if (!comSaldo.has(codigo) && Math.abs(valor) >= 0.01) saldos.push({ codigoCliente: codigo, nomeCliente: nomeCliente.get(codigo) ?? null, saldoSap: 0, saldoCalculado: round2(valor) })
  }

  await db.transaction(async (tx) => {
    await tx.delete(sapTitulosAbertos)
    await tx.delete(sapSaldosClientes)
    for (let i = 0; i < validos.length; i += 500) await tx.insert(sapTitulosAbertos).values(validos.slice(i, i + 500))
    for (let i = 0; i < saldos.length; i += 500) await tx.insert(sapSaldosClientes).values(saldos.slice(i, i + 500))
  })

  const naoConferem = saldos
    .filter((s) => Math.abs(s.saldoSap - s.saldoCalculado) >= 1)
    .map((s) => ({ codigo: s.codigoCliente, nome: s.nomeCliente, saldoSap: s.saldoSap, calculado: s.saldoCalculado }))
  return {
    titulos: validos.length,
    clientesComSaldo: saldos.length,
    conferem: saldos.length - naoConferem.length,
    naoConferem,
    segundos: Math.round((Date.now() - inicio) / 1000),
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
