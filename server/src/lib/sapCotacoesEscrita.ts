// Cotações do CRM → SAP (João, 2026-11-10). Só por clique de alguém na tela.
// Testado no SAP de produção (cotação 12261 → pedido 9285, cancelados):
//   - o usuário do CRM precisa estar nas filiais (Joitec e Odin Tubos);
//   - a validação da empresa (TS_TransactionCotacaoVenda) exige o tipo de
//     frete no cabeçalho (TaxExtension.Incoterms: 0 = CIF, 1 = FOB) e saldo
//     do item no depósito da linha;
//   - imposto (TaxCode/CFOP) o SAP determina sozinho — não mandamos;
//   - pedido "baseado em" = linhas com BaseType 23 + BaseEntry + BaseLine.
// Vendedor (SalesPersonCode) e lista ficam os do cadastro do cliente no SAP.
import { comSessaoSap } from './sapServiceLayer.js'
import { hojeBrString } from './dataBr.js'

// Depósito de Revenda de cada filial.
export const DEPOSITO_DA_FILIAL: Record<number, string> = { 3: '2-REV', 4: '3-REV' }

export interface CotacaoParaSap {
  id: number
  cardCode: string
  filial: number
  prazoCodigo: number | null
  dataEntrega: string | null
  numeroReferencia: string | null
  observacao: string | null
  transportadora: string | null
  contato: string | null
  tipoEnvio: 'CIF' | 'FOB' | null
  valorFrete: number
  vendedorNome: string
  itens: { itemCodigo: string; quantidade: number; precoTabela: number; descontoPct: number; precoUnitario: number; precoManual: boolean }[]
}

function comentario(c: CotacaoParaSap): string {
  return [
    `Cotação CRM nº ${c.id} — ${c.vendedorNome}`,
    c.transportadora ? `Transportadora: ${c.transportadora}` : null,
    c.contato ? `Contato: ${c.contato}` : null,
    c.observacao,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 250)
}

function cabecalho(c: CotacaoParaSap) {
  if (!c.tipoEnvio) throw new Error('Escolha o tipo de envio (CIF ou FOB) — o SAP exige')
  const hoje = hojeBrString()
  return {
    CardCode: c.cardCode,
    BPL_IDAssignedToInvoice: c.filial,
    DocDate: hoje,
    DocDueDate: c.dataEntrega && c.dataEntrega >= hoje ? c.dataEntrega : hoje,
    NumAtCard: c.numeroReferencia || `CRM ${c.id}`,
    Comments: comentario(c),
    ...(c.prazoCodigo != null ? { PaymentGroupCode: c.prazoCodigo } : {}),
    TaxExtension: { Incoterms: c.tipoEnvio === 'FOB' ? '1' : '0' },
    ...(c.valorFrete > 0 ? { DocumentAdditionalExpenses: [{ ExpenseCode: 1, LineTotal: c.valorFrete }] } : {}),
  }
}

// Cria a Cotação de Venda no SAP. Linhas na mesma ordem dos itens (LineNum
// 0..n-1) — o pedido usa essa ordem pra apontar cada linha.
export async function enviarCotacaoSap(c: CotacaoParaSap): Promise<{ docEntry: number; docNum: number; total: number }> {
  const deposito = DEPOSITO_DA_FILIAL[c.filial]
  if (!deposito) throw new Error('Filial sem depósito de Revenda configurado')
  return comSessaoSap(async (sap) => {
    const r = await sap.escrever<{ DocEntry: number; DocNum: number; DocTotal: number }>('POST', '/Quotations', {
      ...cabecalho(c),
      DocumentLines: c.itens.map((i) =>
        i.precoManual || i.descontoPct < 0
          ? { ItemCode: i.itemCodigo, Quantity: i.quantidade, UnitPrice: i.precoUnitario, DiscountPercent: 0, WarehouseCode: deposito, Usage: 10 }
          : { ItemCode: i.itemCodigo, Quantity: i.quantidade, UnitPrice: i.precoTabela, DiscountPercent: i.descontoPct, WarehouseCode: deposito, Usage: 10 }
      ),
    })
    if (!r?.DocEntry) throw new Error('O SAP não devolveu o número da cotação')
    return { docEntry: r.DocEntry, docNum: r.DocNum, total: r.DocTotal }
  })
}

// Pedido de venda baseado na cotação do SAP, só com as linhas aceitas.
export async function gerarPedidoSap(c: CotacaoParaSap, cotacaoEntry: number, linhasAceitas: number[]): Promise<{ docEntry: number; docNum: number; total: number }> {
  if (!linhasAceitas.length) throw new Error('Nenhum item aprovado pelo cliente')
  return comSessaoSap(async (sap) => {
    const r = await sap.escrever<{ DocEntry: number; DocNum: number; DocTotal: number }>('POST', '/Orders', {
      ...cabecalho(c),
      DocumentLines: linhasAceitas.map((linha) => ({ BaseType: 23, BaseEntry: cotacaoEntry, BaseLine: linha })),
    })
    if (!r?.DocEntry) throw new Error('O SAP não devolveu o número do pedido')
    return { docEntry: r.DocEntry, docNum: r.DocNum, total: r.DocTotal }
  })
}

// Fecha a cotação no SAP (reaberta pra negociar ou perdida no CRM).
export async function fecharCotacaoSap(cotacaoEntry: number): Promise<void> {
  await comSessaoSap(async (sap) => {
    const q = await sap.get<{ DocumentStatus: string }>(`/Quotations(${cotacaoEntry})?$select=DocumentStatus`)
    if (q.DocumentStatus === 'bost_Open') await sap.escrever('POST', `/Quotations(${cotacaoEntry})/Close`)
  })
}
