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
  tipoEnvio: 'CIF' | 'FOB' | 'SEM_FRETE' | null
  transportadoraCodigo: string | null
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
  if (!c.tipoEnvio) throw new Error('Escolha o tipo de envio (CIF, FOB ou Sem frete) — o SAP exige')
  const hoje = hojeBrString()
  return {
    CardCode: c.cardCode,
    BPL_IDAssignedToInvoice: c.filial,
    DocDate: hoje,
    DocDueDate: c.dataEntrega && c.dataEntrega >= hoje ? c.dataEntrega : hoje,
    NumAtCard: c.numeroReferencia || `CRM ${c.id}`,
    Comments: comentario(c),
    ...(c.prazoCodigo != null ? { PaymentGroupCode: c.prazoCodigo } : {}),
    // Modalidade do frete no SAP: 0 = CIF (emitente), 1 = FOB (destinatário),
    // 9 = sem frete. Transportadora = código do fornecedor (grupo TRANSPORTE).
    TaxExtension: {
      Incoterms: c.tipoEnvio === 'FOB' ? '1' : c.tipoEnvio === 'SEM_FRETE' ? '9' : '0',
      ...(c.transportadoraCodigo && c.tipoEnvio !== 'SEM_FRETE' ? { Carrier: c.transportadoraCodigo } : {}),
    },
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
    // A cotação fica aberta no SAP quando sobra algo dela (item que o cliente
    // não quis, ou o frete — o pedido leva uma despesa própria): fecha, porque
    // a negociação acabou. Testado 2026-11-10: cotação 12277 → pedido 9294.
    const q = await sap.get<{ DocumentStatus: string }>(`/Quotations(${cotacaoEntry})?$select=DocumentStatus`)
    if (q.DocumentStatus === 'bost_Open') await sap.escrever('POST', `/Quotations(${cotacaoEntry})/Close`)
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

// Estoque disponível AGORA no SAP (físico − reservado) no depósito de Revenda
// da filial, só dos itens da cotação. Item sem saldo é proibido (João,
// 2026-11-10) — devolve a lista do que falta.
export async function faltasDeEstoqueSap(filial: number, itens: { itemCodigo: string; nome: string; quantidade: number }[]): Promise<string[]> {
  const deposito = DEPOSITO_DA_FILIAL[filial]
  if (!deposito || !itens.length) return []
  const codigos = [...new Set(itens.map((i) => i.itemCodigo))]
  const disponivel = new Map<string, number>()
  await comSessaoSap(async (sap) => {
    for (let i = 0; i < codigos.length; i += 20) {
      const filtro = codigos.slice(i, i + 20).map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`).join(' or ')
      const lista = await sap.getTodos<{ ItemCode: string; ItemWarehouseInfoCollection?: { WarehouseCode: string; InStock: number; Committed: number }[] }>(
        `/Items?$filter=${filtro}&$select=ItemCode,ItemWarehouseInfoCollection`,
        20
      )
      for (const it of lista) {
        const w = it.ItemWarehouseInfoCollection?.find((x) => x.WarehouseCode === deposito)
        disponivel.set(it.ItemCode, w ? Math.max(0, w.InStock - w.Committed) : 0)
      }
    }
  })
  const pedido = new Map<string, { nome: string; qtd: number }>()
  for (const i of itens) pedido.set(i.itemCodigo, { nome: i.nome, qtd: (pedido.get(i.itemCodigo)?.qtd ?? 0) + i.quantidade })
  return [...pedido]
    .filter(([codigo, p]) => (disponivel.get(codigo) ?? 0) < p.qtd)
    .map(([codigo, p]) => {
      const d = disponivel.get(codigo) ?? 0
      return `${p.nome} (${codigo}): ${d > 0 ? `só ${d} disponível` : 'sem estoque'}, pediu ${p.qtd}`
    })
}
