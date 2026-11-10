// Catálogo de venda copiado do SAP para as Cotações do CRM (pedido do João,
// 2026-11-10 — trocar o Portal One, que é lento e trava). A tela de cotação
// lê só daqui, nunca espera o SAP: itens de venda ativos, preço em cada lista,
// listas de preço, prazos de pagamento e a lista/prazo padrão de cada cliente.
// Refeito a cada 3 horas (~2.600 itens + ~12 mil clientes, poucos segundos).
// Só leitura no SAP.
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sapCatalogoItens, sapCatalogoPrecos, sapClientesComercial, sapListasPreco, sapPrazosPagamento } from '../db/schema.js'
import { getConfigTexto, setConfig } from './configuracoes.js'
import { agoraSqlite } from './dataBr.js'
import { comSessaoSap } from './sapServiceLayer.js'

const CHAVE = 'sap_catalogo_atualizado_em'
const INTERVALO_MS = 3 * 60 * 60_000
const CHAVE_FILIAIS = 'sap_filiais_dados'

export interface EmitenteFilial {
  nome: string
  cnpj: string | null
  endereco: string
  bairro: string | null
  cep: string | null
  cidade: string | null
  uf: string | null
}

// Razão social, CNPJ e endereço da filial no SAP (BusinessPlaces).
export async function emitenteDaFilial(filial: number): Promise<EmitenteFilial | null> {
  const bruto = await getConfigTexto(CHAVE_FILIAIS)
  if (!bruto) return null
  const f = (JSON.parse(bruto) as Record<string, Record<string, string | null>>)[String(filial)]
  if (!f) return null
  const rua = [f.AddressType, f.Street].filter(Boolean).join(' ')
  return {
    nome: String(f.BPLName ?? ''),
    cnpj: f.FederalTaxID ?? null,
    endereco: [rua, f.StreetNo, f.Building].filter(Boolean).join(', '),
    bairro: f.Block ?? null,
    cep: f.ZipCode ?? null,
    cidade: f.City ?? null,
    uf: f.State ?? null,
  }
}

interface ItemSap {
  ItemCode: string
  ItemName: string | null
  ItemsGroupCode: number | null
  SalesUnit: string | null
  SalesUnitWeight: number | null
  NCMCode?: number | null
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
    const ncms = await sap.getTodos<{ AbsEntry: number; NCMCode: string }>('/NCMCodesSetup?$select=AbsEntry,NCMCode', 1000)
    const filiais = await sap.getTodos<Record<string, string | number | null>>(
      '/BusinessPlaces?$select=BPLID,BPLName,FederalTaxID,AddressType,Street,StreetNo,Building,Block,ZipCode,City,State,Disabled'
    )
    const itens = await sap.getTodos<ItemSap>(
      "/Items?$filter=SalesItem eq 'tYES' and Valid eq 'tYES' and Frozen eq 'tNO'&$select=ItemCode,ItemName,ItemsGroupCode,SalesUnit,SalesUnitWeight,NCMCode,U_CodigoAntigo,ItemPrices",
      200
    )
    const listas = await sap.getTodos<{ PriceListNo: number; PriceListName: string; Active: string }>('/PriceLists?$select=PriceListNo,PriceListName,Active')
    const prazos = await sap.getTodos<{ GroupNumber: number; PaymentTermsGroupName: string }>('/PaymentTermsTypes?$select=GroupNumber,PaymentTermsGroupName')
    const clientes = await sap.getTodos<{ CardCode: string; PriceListNum: number | null; PayTermsGrpCode: number | null; Frozen: string; Valid: string }>(
      "/BusinessPartners?$filter=CardType eq 'cCustomer'&$select=CardCode,PriceListNum,PayTermsGrpCode,Frozen,Valid",
      1000
    )
    return { grupos, ncms, filiais, itens, listas, prazos, clientes }
  })

  const agora = agoraSqlite()
  const nomeGrupo = new Map(dados.grupos.map((g) => [g.Number, g.GroupName]))
  const codigoNcm = new Map(dados.ncms.map((n) => [n.AbsEntry, n.NCMCode]))
  const itens = dados.itens.map((i) => ({
    itemCodigo: i.ItemCode,
    nome: limparNome(i.ItemName ?? i.ItemCode),
    codigoAntigo: i.U_CodigoAntigo?.trim() || null,
    grupo: i.ItemsGroupCode != null ? (nomeGrupo.get(i.ItemsGroupCode) ?? null) : null,
    unidade: i.SalesUnit || null,
    pesoKg: i.SalesUnitWeight || null,
    ncm: i.NCMCode != null && i.NCMCode > 0 ? (codigoNcm.get(i.NCMCode) ?? null) : null,
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
    // Upsert (não apaga): preserva os dados de endereço já buscados por cotação.
    for (let i = 0; i < clientes.length; i += 400) {
      await tx
        .insert(sapClientesComercial)
        .values(clientes.slice(i, i + 400))
        .onConflictDoUpdate({
          target: sapClientesComercial.cardCode,
          set: { listaPreco: sql`excluded.lista_preco`, prazoCodigo: sql`excluded.prazo_codigo`, bloqueado: sql`excluded.bloqueado`, atualizadoEm: sql`excluded.atualizado_em` },
        })
    }
  })
  // Emitente de cada filial (cabeçalho da cotação impressa).
  await setConfig(CHAVE_FILIAIS, JSON.stringify(Object.fromEntries(dados.filiais.filter((f) => f.Disabled !== 'tYES').map((f) => [String(f.BPLID), f]))))
  await setConfig(CHAVE, agora)
  return { itens: itens.length, precos: precos.length, clientes: clientes.length }
}

export interface DadosClienteSap {
  endereco: string | null
  complemento: string | null
  bairro: string | null
  cep: string | null
  cidade: string | null
  uf: string | null
  cnpj: string | null
  cpf: string | null
  ie: string | null
  telefone: string | null
  email: string | null
  contato: string | null
}

// Endereço de entrega (o padrão do cliente), CNPJ/IE, telefone, e-mail e
// contato de UM cliente no SAP — chamado depois de salvar a cotação. Só GET.
export async function atualizarDadosClienteSap(cardCode: string): Promise<DadosClienteSap | null> {
  type End = { AddressType: string; AddressName: string; TypeOfAddress: string | null; Street: string | null; StreetNo: string | null; BuildingFloorRoom: string | null; Block: string | null; ZipCode: string | null; City: string | null; State: string | null }
  type Fiscal = { Address: string | null; TaxId0: string | null; TaxId1: string | null; TaxId4: string | null }
  const bp = await comSessaoSap((sap) =>
    sap.get<{ Phone1: string | null; Cellular: string | null; EmailAddress: string | null; ContactPerson: string | null; ShipToDefault: string | null; BPAddresses?: End[]; BPFiscalTaxIDCollection?: Fiscal[] }>(
      `/BusinessPartners('${encodeURIComponent(cardCode.replace(/'/g, "''"))}')?$select=Phone1,Cellular,EmailAddress,ContactPerson,ShipToDefault,BPAddresses,BPFiscalTaxIDCollection`
    )
  )
  const ends = bp.BPAddresses ?? []
  const e = ends.find((a) => a.AddressType === 'bo_ShipTo' && a.AddressName === bp.ShipToDefault) ?? ends.find((a) => a.AddressType === 'bo_ShipTo') ?? ends[0]
  const fiscais = bp.BPFiscalTaxIDCollection ?? []
  const f = fiscais.find((x) => x.Address === e?.AddressName && (x.TaxId0 || x.TaxId4)) ?? fiscais.find((x) => x.TaxId0 || x.TaxId4)
  const vazio = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null)
  const dados: DadosClienteSap = {
    endereco: vazio([e?.TypeOfAddress, e?.Street].filter(Boolean).join(' ') + (e?.StreetNo ? `, ${e.StreetNo}` : '')),
    complemento: vazio(e?.BuildingFloorRoom),
    bairro: vazio(e?.Block),
    cep: vazio(e?.ZipCode),
    cidade: vazio(e?.City),
    uf: vazio(e?.State),
    cnpj: vazio(f?.TaxId0),
    cpf: vazio(f?.TaxId4),
    ie: vazio(f?.TaxId1),
    telefone: vazio(bp.Phone1) ?? vazio(bp.Cellular),
    email: vazio(bp.EmailAddress),
    contato: vazio(bp.ContactPerson),
  }
  const agora = agoraSqlite()
  await db
    .insert(sapClientesComercial)
    .values({ cardCode, atualizadoEm: agora, dados: JSON.stringify(dados), dadosEm: agora })
    .onConflictDoUpdate({ target: sapClientesComercial.cardCode, set: { dados: JSON.stringify(dados), dadosEm: agora } })
  return dados
}

export async function dadosClienteSap(cardCode: string): Promise<DadosClienteSap | null> {
  const r = await db.query.sapClientesComercial.findFirst({ where: eq(sapClientesComercial.cardCode, cardCode), columns: { dados: true } })
  return r?.dados ? (JSON.parse(r.dados) as DadosClienteSap) : null
}
