// Catálogo de venda copiado do SAP para as Cotações do CRM (pedido do João,
// 2026-11-10 — trocar o Portal One, que é lento e trava). A tela de cotação
// lê só daqui, nunca espera o SAP: itens de venda ativos, preço em cada lista,
// listas de preço, prazos de pagamento e a lista/prazo padrão de cada cliente.
// Refeito a cada 3 horas (~2.600 itens + ~12 mil clientes, poucos segundos).
// Só leitura no SAP.
import { db } from '../db/client.js'
import { sapCatalogoItens, sapCatalogoPrecos, sapClientesComercial, sapListasPreco, sapPrazosPagamento } from '../db/schema.js'
import { getConfigTexto, setConfig } from './configuracoes.js'
import { agoraSqlite } from './dataBr.js'
import { comSessaoSap } from './sapServiceLayer.js'

const CHAVE = 'sap_catalogo_atualizado_em'
const INTERVALO_MS = 3 * 60 * 60_000

interface ItemSap {
  ItemCode: string
  ItemName: string | null
  ItemsGroupCode: number | null
  SalesUnit: string | null
  SalesUnitWeight: number | null
  U_CodigoAntigo?: string | null
  ItemPrices?: { PriceList: number; Price: number | null }[]
}

// Alguns nomes vêm do SAP no formato de CSV: entre aspas e com aspas
// dobradas ("BOIA PARA FCO 2"" E 2.1/2") — volta pro texto normal.
function limparNome(nome: string): string {
  let n = nome.trim()
  if (n.length > 1 && n.startsWith('"') && n.endsWith('"')) n = n.slice(1, -1)
  return n.replace(/""/g, '"').trim()
}

export async function catalogoAtualizadoEm(): Promise<string | null> {
  return getConfigTexto(CHAVE)
}

// `forcar` ignora o intervalo (botão "Atualizar catálogo" / script).
export async function sincronizarCatalogoSap(forcar = false): Promise<{ itens: number; precos: number; clientes: number } | null> {
  const ultima = await getConfigTexto(CHAVE)
  if (!forcar && ultima && Date.now() - Date.parse(`${ultima.replace(' ', 'T')}Z`) < INTERVALO_MS - 5 * 60_000) return null

  const dados = await comSessaoSap(async (sap) => {
    const grupos = await sap.getTodos<{ Number: number; GroupName: string }>('/ItemGroups?$select=Number,GroupName')
    const itens = await sap.getTodos<ItemSap>(
      "/Items?$filter=SalesItem eq 'tYES' and Valid eq 'tYES' and Frozen eq 'tNO'&$select=ItemCode,ItemName,ItemsGroupCode,SalesUnit,SalesUnitWeight,U_CodigoAntigo,ItemPrices",
      200
    )
    const listas = await sap.getTodos<{ PriceListNo: number; PriceListName: string; Active: string }>('/PriceLists?$select=PriceListNo,PriceListName,Active')
    const prazos = await sap.getTodos<{ GroupNumber: number; PaymentTermsGroupName: string }>('/PaymentTermsTypes?$select=GroupNumber,PaymentTermsGroupName')
    const clientes = await sap.getTodos<{ CardCode: string; PriceListNum: number | null; PayTermsGrpCode: number | null; Frozen: string; Valid: string }>(
      "/BusinessPartners?$filter=CardType eq 'cCustomer'&$select=CardCode,PriceListNum,PayTermsGrpCode,Frozen,Valid",
      1000
    )
    return { grupos, itens, listas, prazos, clientes }
  })

  const agora = agoraSqlite()
  const nomeGrupo = new Map(dados.grupos.map((g) => [g.Number, g.GroupName]))
  const itens = dados.itens.map((i) => ({
    itemCodigo: i.ItemCode,
    nome: limparNome(i.ItemName ?? i.ItemCode),
    codigoAntigo: i.U_CodigoAntigo?.trim() || null,
    grupo: i.ItemsGroupCode != null ? (nomeGrupo.get(i.ItemsGroupCode) ?? null) : null,
    unidade: i.SalesUnit || null,
    pesoKg: i.SalesUnitWeight || null,
    ativo: true,
    atualizadoEm: agora,
  }))
  const precos = dados.itens.flatMap((i) =>
    (i.ItemPrices ?? []).filter((p) => p.Price != null && p.Price > 0).map((p) => ({ itemCodigo: i.ItemCode, lista: p.PriceList, preco: Math.round(p.Price! * 10000) / 10000 }))
  )
  const clientes = dados.clientes.map((c) => ({
    cardCode: c.CardCode,
    listaPreco: c.PriceListNum ?? null,
    prazoCodigo: c.PayTermsGrpCode ?? null,
    bloqueado: c.Frozen === 'tYES' || c.Valid === 'tNO',
    atualizadoEm: agora,
  }))
  // Sem itens = resposta estranha do SAP; não apaga o catálogo que já existe.
  if (itens.length === 0) throw new Error('SAP devolveu o catálogo vazio — mantive o anterior')

  await db.transaction(async (tx) => {
    const lote = async <T>(tabela: Parameters<typeof tx.insert>[0], linhas: T[], tamanho = 400) => {
      for (let i = 0; i < linhas.length; i += tamanho) await tx.insert(tabela).values(linhas.slice(i, i + tamanho) as never)
    }
    await tx.delete(sapCatalogoItens)
    await lote(sapCatalogoItens, itens, 200)
    await tx.delete(sapCatalogoPrecos)
    await lote(sapCatalogoPrecos, precos)
    await tx.delete(sapListasPreco)
    await lote(
      sapListasPreco,
      dados.listas.filter((l) => l.Active !== 'tNO').map((l) => ({ numero: l.PriceListNo, nome: l.PriceListName.replace(/^Lista de preços\s*-?\s*/i, '').trim() || l.PriceListName }))
    )
    await tx.delete(sapPrazosPagamento)
    await lote(sapPrazosPagamento, dados.prazos.map((p) => ({ codigo: p.GroupNumber, nome: p.PaymentTermsGroupName.trim() })))
    await tx.delete(sapClientesComercial)
    await lote(sapClientesComercial, clientes)
  })
  await setConfig(CHAVE, agora)
  return { itens: itens.length, precos: precos.length, clientes: clientes.length }
}
