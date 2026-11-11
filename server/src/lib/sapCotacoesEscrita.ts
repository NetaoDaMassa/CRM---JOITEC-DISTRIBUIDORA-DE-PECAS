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
  // Portal One (João, 2026-11-11): forma de pagamento, embalagens/peso,
  // despesas além do frete (código da despesa no SAP → valor) e anexo.
  formaPagamento: string | null
  qtdEmbalagens: number | null
  descEmbalagem: string | null
  marca: string | null
  pesoLiquido: number | null
  pesoBruto: number | null
  despesasExtras: Record<string, number>
  anexoEntry: number | null
  itens: { itemCodigo: string; quantidade: number; precoTabela: number; descontoPct: number; precoUnitario: number; precoManual: boolean; utilizacao: number | null }[]
}

// Utilizações de venda (NotaFiscalUsage do SAP), escolhidas item a item.
// Era só Odin Tubos; liberado pra todas as empresas por questões fiscais
// (João, 2026-11-11). Venda pra consumo (cliente não revende) muda o imposto.
export const UTILIZACOES_VENDA = [
  { codigo: 10, nome: 'V - Ven Comercial' },
  { codigo: 9, nome: 'V - Ven Prod Própria' },
  { codigo: 21, nome: 'V - Ven Consumo' },
] as const
export const UTILIZACAO_PADRAO = 10
// Despesas adicionais do SAP (1 = frete fica no campo próprio da cotação).
export const DESPESAS_SAP = [
  { codigo: 2, nome: 'Seguro' },
  { codigo: 3, nome: 'Outros' },
  { codigo: 4, nome: 'Custo importação' },
  { codigo: 5, nome: 'Armazenagem' },
] as const

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
      // Aba "Imposto" do Portal One: Qtde. Embalagens, Desc. Embalagem, Marca, pesos.
      ...(c.qtdEmbalagens ? { PackQuantity: c.qtdEmbalagens } : {}),
      ...(c.descEmbalagem ? { PackDescription: c.descEmbalagem } : {}),
      ...(c.marca ? { Brand: c.marca } : {}),
      ...(c.pesoLiquido ? { NetWeight: c.pesoLiquido } : {}),
      ...(c.pesoBruto ? { GrossWeight: c.pesoBruto } : {}),
    },
    ...(c.formaPagamento ? { PaymentMethod: c.formaPagamento } : {}),
    ...(c.anexoEntry ? { AttachmentEntry: c.anexoEntry } : {}),
    ...(despesas(c).length ? { DocumentAdditionalExpenses: despesas(c) } : {}),
  }
}

function despesas(c: CotacaoParaSap): { ExpenseCode: number; LineTotal: number }[] {
  const lista = c.valorFrete > 0 ? [{ ExpenseCode: 1, LineTotal: c.valorFrete }] : []
  for (const [codigo, valor] of Object.entries(c.despesasExtras ?? {})) if (valor > 0) lista.push({ ExpenseCode: Number(codigo), LineTotal: valor })
  return lista
}

// Anexos da cotação → Attachments2 do SAP (pasta de anexos do SAP). Devolve o
// AbsoluteEntry pra ir no documento. Arquivo lido do disco do CRM (uploads).
export async function subirAnexosSap(arquivos: { nome: string; dados: Buffer; tipo: string }[]): Promise<number | null> {
  if (!arquivos.length) return null
  return comSessaoSap(async (sap) => {
    const form = new FormData()
    for (const a of arquivos) form.append('files', new Blob([new Uint8Array(a.dados)], { type: a.tipo }), a.nome)
    const r = await sap.enviarArquivos<{ AbsoluteEntry: number }>('/Attachments2', form)
    return r?.AbsoluteEntry ?? null
  })
}

// ── Impostos (João, 2026-11-11: "mostrar ICMS e IPI separados na cotação").
// O SAP calcula por linha (LineTaxJurisdictions; JurisdictionType: 10 ICMS,
// 13/14/15 ICMS-ST, 35 FCP-ST, 16/17/18 IPI). ICMS vem embutido no preço
// (não soma); IPI e ST somam por fora — o DocTotal do SAP já é o total final.
export interface ImpostosSap {
  documento: 'cotacao' | 'pedido'
  docNum: number
  total: number
  icms: number
  ipi: number
  st: number
  linhas: { itemCodigo: string; icmsPct: number; icms: number; ipiPct: number; ipi: number; st: number }[]
  lidoEm: string
}
const TIPOS_ICMS = new Set([10])
const TIPOS_ST = new Set([13, 14, 15, 35])
const TIPOS_IPI = new Set([16, 17, 18])
type LinhaSap = { ItemCode: string; LineTaxJurisdictions?: { JurisdictionType: number; TaxRate: number; TaxAmount: number }[] }
const r2 = (n: number) => Math.round(n * 100) / 100
export async function lerImpostosSap(
  sap: { get<T = unknown>(c: string): Promise<T> },
  documento: 'cotacao' | 'pedido',
  docEntry: number
): Promise<ImpostosSap> {
  const d = await sap.get<{ DocNum: number; DocTotal: number; DocumentLines: LinhaSap[] }>(
    `/${documento === 'cotacao' ? 'Quotations' : 'Orders'}(${docEntry})?$select=DocNum,DocTotal,DocumentLines`
  )
  const linhas = (d.DocumentLines ?? []).map((l) => {
    const j = l.LineTaxJurisdictions ?? []
    const de = (tipos: Set<number>) => j.filter((x) => tipos.has(x.JurisdictionType))
    const soma = (tipos: Set<number>) => r2(de(tipos).reduce((s, x) => s + (x.TaxAmount ?? 0), 0))
    const pct = (tipos: Set<number>) => de(tipos).reduce((m, x) => Math.max(m, x.TaxRate ?? 0), 0)
    return { itemCodigo: l.ItemCode, icmsPct: pct(TIPOS_ICMS), icms: soma(TIPOS_ICMS), ipiPct: pct(TIPOS_IPI), ipi: soma(TIPOS_IPI), st: soma(TIPOS_ST) }
  })
  const tot = (k: 'icms' | 'ipi' | 'st') => r2(linhas.reduce((s, l) => s + l[k], 0))
  return { documento, docNum: d.DocNum, total: d.DocTotal, icms: tot('icms'), ipi: tot('ipi'), st: tot('st'), linhas, lidoEm: new Date().toISOString() }
}

// Cria a Cotação de Venda no SAP. Linhas na mesma ordem dos itens (LineNum
// 0..n-1) — o pedido usa essa ordem pra apontar cada linha.
export async function enviarCotacaoSap(c: CotacaoParaSap): Promise<{ docEntry: number; docNum: number; total: number; impostos: ImpostosSap | null }> {
  const deposito = DEPOSITO_DA_FILIAL[c.filial]
  if (!deposito) throw new Error('Filial sem depósito de Revenda configurado')
  return comSessaoSap(async (sap) => {
    const r = await sap.escrever<{ DocEntry: number; DocNum: number; DocTotal: number }>('POST', '/Quotations', {
      ...cabecalho(c),
      DocumentLines: c.itens.map((i) =>
        i.precoManual || i.descontoPct < 0
          ? { ItemCode: i.itemCodigo, Quantity: i.quantidade, UnitPrice: i.precoUnitario, DiscountPercent: 0, WarehouseCode: deposito, Usage: i.utilizacao ?? UTILIZACAO_PADRAO }
          : { ItemCode: i.itemCodigo, Quantity: i.quantidade, UnitPrice: i.precoTabela, DiscountPercent: i.descontoPct, WarehouseCode: deposito, Usage: i.utilizacao ?? UTILIZACAO_PADRAO }
      ),
    })
    if (!r?.DocEntry) throw new Error('O SAP não devolveu o número da cotação')
    const impostos = await lerImpostosSap(sap, 'cotacao', r.DocEntry).catch(() => null)
    return { docEntry: r.DocEntry, docNum: r.DocNum, total: r.DocTotal, impostos }
  })
}

// Pedido de venda baseado na cotação do SAP, só com as linhas aceitas.
export async function gerarPedidoSap(c: CotacaoParaSap, cotacaoEntry: number, linhasAceitas: number[]): Promise<{ docEntry: number; docNum: number; total: number; impostos: ImpostosSap | null }> {
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
    const impostos = await lerImpostosSap(sap, 'pedido', r.DocEntry).catch(() => null)
    return { docEntry: r.DocEntry, docNum: r.DocNum, total: r.DocTotal, impostos }
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

// Formas de pagamento de recebimento do SAP (WizardPaymentMethods), em
// memória por 6 h. Cada empresa tem a sua conta de boleto (o nome termina
// com a empresa); "BOLETO" sem empresa vale pra todas.
type Forma = { codigo: string; nome: string }
let formasCache: { em: number; lista: Forma[] } | null = null
const FORMAS_PADRAO: Forma[] = [
  { codigo: 'BOL_ITAU_99136', nome: 'BOLETO COBRANÇA ITAÚ 99136-8 - ODIN TUBOS' },
  { codigo: 'BOL_ITAU_22915', nome: 'BOLETO COBRANÇA ITAÚ 22915-7 - JOITEC' },
  { codigo: 'BOL_SAF_582532', nome: 'BOLETO COBRANÇA SAFRA 00582532-2 - JOITEC' },
  { codigo: 'BOL_ITAU_22912', nome: 'BOLETO COBRANÇA ITAÚ 22912-4 - ODIN COMPRESSORES' },
  { codigo: 'BOL_SAF_582530', nome: 'BOLETO COBRANÇA SAFRA 00582530-6 - ODIN COMPRESSORES' },
  { codigo: 'BOL_ITAU_22104', nome: 'BOLETO' },
]
const EMPRESA_DA_FILIAL: Record<number, string> = { 3: 'JOITEC', 4: 'ODIN TUBOS' }
export async function formasPagamentoDaFilial(filial: number): Promise<Forma[]> {
  if (!formasCache || Date.now() - formasCache.em > 6 * 3600_000) {
    try {
      const l = await comSessaoSap((sap) =>
        sap.getTodos<{ PaymentMethodCode: string; Description: string; Active: string }>(`/WizardPaymentMethods?$filter=Type eq 'boptIncoming'&$select=PaymentMethodCode,Description,Active`)
      )
      formasCache = { em: Date.now(), lista: l.filter((m) => m.Active !== 'tNO').map((m) => ({ codigo: m.PaymentMethodCode, nome: m.Description })) }
    } catch (e) {
      console.error('[cotacoes] formas de pagamento do SAP:', e instanceof Error ? e.message : e)
      formasCache = { em: Date.now() - 5.5 * 3600_000, lista: formasCache?.lista ?? FORMAS_PADRAO }
    }
  }
  const empresa = EMPRESA_DA_FILIAL[filial]
  const empresas = ['JOITEC', 'ODIN TUBOS', 'ODIN COMPRESSORES']
  return formasCache.lista.filter((f) => {
    const nome = f.nome.toUpperCase()
    const deQual = empresas.find((e) => nome.endsWith(`- ${e}`))
    return !deQual || deQual === empresa
  })
}

// Relê os impostos de um documento que já está no SAP (botão na cotação).
export async function impostosDoDocumentoSap(documento: 'cotacao' | 'pedido', docEntry: number): Promise<ImpostosSap> {
  return comSessaoSap((sap) => lerImpostosSap(sap, documento, docEntry))
}
