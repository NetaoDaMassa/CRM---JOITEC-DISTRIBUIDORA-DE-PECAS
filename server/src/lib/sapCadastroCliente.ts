import { comSessaoSap } from './sapServiceLayer.js'
import type { SapSessao } from './sapServiceLayer.js'

// Cadastro de cliente do CRM → SAP (João, 2026-11-11). Os campos e códigos
// abaixo saíram do cadastro que o Portal One gravou (C012566) e do vídeo da
// Izabelly aprovando o C012563 (conferido com ~/Documents/sap-cadastro-cliente.sh):
//  - cliente nasce cCustomer INATIVO (Valid tNO + Frozen tYES), série 73;
//  - aprovar = Ativo (Valid tYES + Frozen tNO) e marcar TODAS as formas de
//    pagamento (os 6 boletos) — é o que ela faz no SAP;
//  - Phone2 = DDD, Phone1 = número; CNPJ/IE/CPF em BPFiscalTaxIDCollection
//    (TaxId0/TaxId1/TaxId4); Município (County) = código interno do SAP.

export const GRUPOS_TRIBUTARIOS = [
  { v: '1', l: 'CONTRIBUINTE - REGIME NORMAL' },
  { v: '2', l: 'CONTRIBUINTE - SIMPLES NACIONAL' },
  { v: '3', l: 'PRODUTOR RURAL - REGIME NORMAL' },
  { v: '4', l: 'PRODUTOR RURAL - SIMPLES NACIONAL' },
  { v: '5', l: 'PRODUTOR RURAL - PESSOA FISICA' },
  { v: '6', l: 'NÃO CONTRIBUINTE - REGIME NORMAL' },
  { v: '7', l: 'NÃO CONTRIBUINTE - SIMPLES NACIONAL' },
  { v: '8', l: 'NÃO CONTRIBUINTE - PESSOA FISICA' },
  { v: '9', l: 'OUTROS' },
] as const
export const INDICADORES_IE = [
  { v: '1', l: 'Contribuinte ICMS (informar a IE)' },
  { v: '2', l: 'Contribuinte isento de inscrição' },
  { v: '9', l: 'Não contribuinte' },
  { v: '0', l: 'Padrão definido pelo sistema' },
] as const
export const INDICADORES_CONSUMIDOR = [
  { v: '0', l: 'Normal' },
  { v: '1', l: 'Consumidor final' },
] as const
export const REGIOES_SUFRAMA = [
  { v: '0', l: 'Nenhuma' },
  { v: '1', l: 'ZFM - Zona Franca de Manaus' },
  { v: '2', l: 'ALC - Área de Livre Comércio' },
  { v: '3', l: 'AO - Amazônia Ocidental' },
] as const
// Grupos de cliente do SAP (BusinessPartnerGroups tipo cliente).
export const GRUPOS_CLIENTE = [
  { v: 100, l: 'CLIENTES' },
  { v: 117, l: 'CONTRIBUINTE' },
  { v: 118, l: 'ISENTO' },
] as const
export const INDICADORES = [
  { v: '', l: '—' },
  { v: '1', l: 'Prospecção' },
  { v: '2', l: 'Marketing' },
  { v: '3', l: 'Indicação' },
] as const
const SERIE_CLIENTE = 73
// Filiais do SAP (Atribuição de filial — a Izabelly marcava na mão no SAP).
export const FILIAIS_SAP = [
  { v: 1, l: 'Odin Compressores' },
  { v: 3, l: 'Joitec Distribuidora' },
  { v: 4, l: 'Odin Tubos' },
] as const
// Uso principal (NotaFiscalUsage) — o mesmo da cotação.
export const USOS_PRINCIPAIS = [
  { v: 10, l: 'V - Ven Comercial' },
  { v: 9, l: 'V - Ven Prod Própria' },
  { v: 21, l: 'V - Ven Consumo' },
] as const

export interface ContatoCadastro {
  nome: string
  cargo: string
  telefone: string
  celular: string
  email: string
}

export interface EnderecoCadastro {
  cep: string
  tipoLogradouro: string
  rua: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
}

export interface DadosCadastro {
  pessoa: 'juridica' | 'fisica'
  nome: string
  fantasia: string
  cnpj: string
  cpf: string
  ie: string
  ieIsento: boolean
  suframa: string
  regiaoSuframa: string
  grupoTributario: string
  indicadorIE: string
  indicadorConsumidor: string
  grupoCliente: number
  ultimaConsultaSerasa: string // YYYY-MM-DD
  ddd: string
  telefone: string
  dddCelular: string
  celular: string
  email: string
  site: string
  indicador: string
  observacoes: string
  contatoNome: string
  contatoTelefone: string
  contatoEmail: string
  // Igual ao Portal One (João, 2026-11-12): vários contatos, resp. comercial,
  // uso principal, limite de crédito, segmento, território, formas de
  // pagamento escolhidas (Execução do pagamento) e atribuição de filial.
  contatos?: ContatoCadastro[]
  respComercial?: number | null
  usoPrincipal?: number
  limiteCredito?: number
  segmento?: number | null
  territorio?: number | null
  formasPagamento?: string[] | null
  filiais?: number[]
  cobranca: EnderecoCadastro
  entregaIgual: boolean
  entrega: EnderecoCadastro
  prazoCodigo: number
  listaPreco: number
}

const so = (s: string) => (s ?? '').replace(/\D/g, '')
const t = (s: string | null | undefined) => (s ?? '').trim()

export function formatarCnpj(c: string) {
  const d = so(c)
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : c
}
export function formatarCpf(c: string) {
  const d = so(c)
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : c
}
function formatarCep(c: string) {
  const d = so(c)
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : c
}

// O que falta pra mandar ao SAP (vazio = pode enviar).
export function faltando(d: DadosCadastro): string[] {
  const f: string[] = []
  if (t(d.nome).length < 3) f.push('Nome / razão social')
  if (d.pessoa === 'juridica') {
    if (so(d.cnpj).length !== 14) f.push('CNPJ')
    if (!d.ieIsento && !t(d.ie)) f.push('Inscrição estadual (ou marque Isento)')
  } else if (so(d.cpf).length !== 11) f.push('CPF')
  if (!d.grupoTributario) f.push('Grupo tributário')
  if (!d.indicadorIE) f.push('Indicador da IE')
  if (!d.indicadorConsumidor) f.push('Indicador de op. consumidor')
  if (!so(d.telefone) && !so(d.celular)) f.push('Telefone ou celular')
  if (!/^\S+@\S+\.\S+$/.test(t(d.email))) f.push('E-mail')
  const end = (e: EnderecoCadastro, nome: string) => {
    if (so(e.cep).length !== 8) f.push(`CEP (${nome})`)
    if (!t(e.rua)) f.push(`Rua (${nome})`)
    if (!t(e.numero)) f.push(`Número (${nome}) — use SN se não tiver`)
    if (!t(e.bairro)) f.push(`Bairro (${nome})`)
    if (!t(e.cidade)) f.push(`Cidade (${nome})`)
    if (!/^[A-Z]{2}$/.test(t(e.uf).toUpperCase())) f.push(`UF (${nome})`)
  }
  end(d.cobranca, 'cobrança')
  if (!d.entregaIgual) end(d.entrega, 'entrega')
  if (d.prazoCodigo == null || Number.isNaN(d.prazoCodigo)) f.push('Condição de pagamento')
  if (!d.listaPreco) f.push('Lista de preço')
  return f
}

const esc = (s: string) => s.replace(/'/g, "''")

// Contatos do cadastro (os antigos tinham um só, em contatoNome/…).
export function contatosDe(d: DadosCadastro): ContatoCadastro[] {
  const l = (d.contatos ?? []).filter((c) => t(c.nome))
  if (l.length) return l
  return t(d.contatoNome) ? [{ nome: d.contatoNome, cargo: '', telefone: d.contatoTelefone, celular: '', email: d.contatoEmail }] : []
}

// Código do município no SAP: o mesmo que outros clientes da cidade já usam.
const cacheMunicipio = new Map<string, string | null>()
async function municipioSap(sap: SapSessao, cidade: string, uf: string): Promise<string | null> {
  const chave = `${cidade.trim().toUpperCase()}|${uf.toUpperCase()}`
  if (cacheMunicipio.has(chave)) return cacheMunicipio.get(chave)!
  let cod: string | null = null
  try {
    const l = await sap.getTodos<{ County: string | null; City: string | null }>(
      `/BusinessPartners?$filter=City eq '${esc(cidade.trim())}' and BillToState eq '${esc(uf.toUpperCase())}' and County ne null&$select=County,City&$top=20`,
      20
    )
    const cont = new Map<string, number>()
    for (const b of l) if (b.County) cont.set(b.County, (cont.get(b.County) ?? 0) + 1)
    cod = [...cont].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  } catch (e) {
    console.error('[sap-cadastro] município:', e instanceof Error ? e.message : e)
  }
  cacheMunicipio.set(chave, cod)
  return cod
}

async function enderecoSap(sap: SapSessao, e: EnderecoCadastro, nome: 'COBRANCA' | 'ENTREGA') {
  const uf = t(e.uf).toUpperCase()
  const county = await municipioSap(sap, t(e.cidade), uf)
  return {
    AddressName: nome,
    AddressType: nome === 'COBRANCA' ? 'bo_BillTo' : 'bo_ShipTo',
    TypeOfAddress: t(e.tipoLogradouro) || 'Rua',
    Street: t(e.rua),
    StreetNo: t(e.numero),
    BuildingFloorRoom: t(e.complemento) || null,
    Block: t(e.bairro),
    ZipCode: formatarCep(e.cep),
    City: t(e.cidade),
    ...(county ? { County: county } : {}),
    State: uf,
    Country: 'BR',
  }
}

// Corpo do BusinessPartner (criação ou correção — o status fica de fora).
async function corpoSap(sap: SapSessao, d: DadosCadastro, vendedorSap: number | null, formasPadrao: string[]) {
  const formas = d.formasPagamento?.length ? d.formasPagamento : formasPadrao
  const contatos = contatosDe(d)
  const filiais = [...new Set(d.filiais ?? [])]
  const cnpj = d.pessoa === 'juridica' ? formatarCnpj(d.cnpj) : null
  const cpf = d.pessoa === 'fisica' ? formatarCpf(d.cpf) : null
  const ie = d.pessoa === 'juridica' ? (d.ieIsento ? 'Isento' : t(d.ie)) : null
  const fiscal = { TaxId0: cnpj, TaxId1: ie, TaxId4: cpf }
  const entrega = d.entregaIgual ? d.cobranca : d.entrega
  const obs = [t(d.observacoes), t(d.suframa) ? `SUFRAMA: ${t(d.suframa)}` : ''].filter(Boolean).join(' · ')
  return {
    CardName: t(d.nome).toUpperCase(),
    CardForeignName: t(d.fantasia) || t(d.nome).toUpperCase(),
    GroupCode: d.grupoCliente || 100,
    Currency: 'R$',
    CompanyPrivate: d.pessoa === 'juridica' ? 'cCompany' : 'cPrivate',
    FederalTaxID: cnpj ?? cpf,
    Phone1: so(d.telefone) || so(d.celular),
    Phone2: so(d.telefone) ? so(d.ddd) : so(d.dddCelular),
    Cellular: so(d.celular) ? `${so(d.dddCelular)}${so(d.celular)}` : null,
    EmailAddress: t(d.email),
    Website: t(d.site) || null,
    Notes: obs || null,
    PayTermsGrpCode: d.prazoCodigo,
    PriceListNum: d.listaPreco,
    SalesPersonCode: d.respComercial ?? vendedorSap ?? -1,
    MainUsage: d.usoPrincipal || 10,
    ...(d.limiteCredito && d.limiteCredito > 0 ? { CreditLimit: d.limiteCredito } : {}),
    ...(d.segmento ? { Industry: d.segmento } : {}),
    ...(d.territorio ? { Territory: d.territorio } : {}),
    ...(filiais.length ? { BPBranchAssignment: filiais.map((f) => ({ BPLID: f, DisabledForBP: 'tNO' })) } : {}),
    ...(d.indicador ? { Indicator: d.indicador } : {}),
    BilltoDefault: 'COBRANCA',
    ShipToDefault: 'ENTREGA',
    BPAddresses: [await enderecoSap(sap, d.cobranca, 'COBRANCA'), await enderecoSap(sap, entrega, 'ENTREGA')],
    BPFiscalTaxIDCollection: [
      { Address: '', AddrType: 'bo_ShipTo', ...fiscal },
      { Address: 'ENTREGA', AddrType: 'bo_ShipTo', ...fiscal },
      { Address: 'COBRANCA', AddrType: 'bo_BillTo' },
    ],
    ...(formas.length ? { BPPaymentMethods: formas.map((c) => ({ PaymentMethodCode: c })) } : {}),
    ...(contatos.length
      ? {
          ContactPerson: t(contatos[0].nome).slice(0, 50),
          ContactEmployees: contatos.map((c) => ({
            Name: t(c.nome).slice(0, 50),
            Position: t(c.cargo) || null,
            Phone1: so(c.telefone) || null,
            MobilePhone: so(c.celular) || null,
            E_Mail: t(c.email) || null,
          })),
        }
      : {}),
    U_TS_GrupoTributario: d.grupoTributario,
    U_TX_IndIEDest: d.indicadorIE,
    U_TX_IndFinal: d.indicadorConsumidor,
    U_TS_Suframa: d.regiaoSuframa || '0',
    ...(d.ultimaConsultaSerasa ? { U_TS_UltConsSerasa: d.ultimaConsultaSerasa } : {}),
    U_IB_BoletoGeradoPor: '0',
    U_ImprimirBoleto: 1,
    U_IB_EhCom: 'N',
    U_IB_COM_PREMIUM: 'N',
    U_TX_TpEnteGov: '-1',
    U_TX_indDest: '0',
    U_TX_RegraImTomRibPreto: '0',
    U_TX_cNaoNIF: '-1',
    U_TU_INT_ORIGEM: 'CRM',
  }
}

// Já existe no SAP com esse CNPJ/CPF? (cliente ou lead)
export async function procurarNoSap(d: DadosCadastro): Promise<{ codigo: string; nome: string; tipo: string; ativo: boolean } | null> {
  const doc = d.pessoa === 'juridica' ? so(d.cnpj) : so(d.cpf)
  if (!doc) return null
  const formatos = [...new Set([doc, d.pessoa === 'juridica' ? formatarCnpj(doc) : formatarCpf(doc)])]
  return comSessaoSap(async (sap) => {
    for (const f of formatos) {
      const l = await sap.getTodos<{ CardCode: string; CardName: string; CardType: string; Valid: string; Frozen: string }>(
        `/BusinessPartners?$filter=FederalTaxID eq '${esc(f)}' and CardType ne 'cSupplier'&$select=CardCode,CardName,CardType,Valid,Frozen&$top=5`,
        5
      )
      if (l[0]) return { codigo: l[0].CardCode, nome: l[0].CardName, tipo: l[0].CardType === 'cLid' ? 'lead' : 'cliente', ativo: l[0].Valid === 'tYES' && l[0].Frozen !== 'tYES' }
    }
    return null
  })
}

// Cria o cliente INATIVO no SAP. Devolve o código (C0xxxxx).
export async function criarClienteSap(d: DadosCadastro, vendedorSap: number | null, formas: string[]): Promise<string> {
  return comSessaoSap(async (sap) => {
    const corpo = { ...(await corpoSap(sap, d, vendedorSap, formas)), CardType: 'cCustomer', Series: SERIE_CLIENTE, Valid: 'tNO', Frozen: 'tYES' }
    const r = await sap.escrever<{ CardCode: string }>('POST', '/BusinessPartners', corpo)
    if (!r?.CardCode) throw new Error('O SAP não devolveu o código do cliente')
    return r.CardCode
  })
}

// Reenvio depois de devolvido: corrige o cadastro no SAP (continua inativo).
// Endereços e identificações fiscais são as mesmas linhas (COBRANCA/ENTREGA),
// o SAP atualiza pelo nome. Formas de pagamento ficam como estão.
export async function corrigirClienteSap(cardCode: string, d: DadosCadastro, vendedorSap: number | null): Promise<void> {
  await comSessaoSap(async (sap) => {
    const corpo = await corpoSap(sap, d, vendedorSap, [])
    delete (corpo as { ContactEmployees?: unknown }).ContactEmployees
    delete (corpo as { ContactPerson?: unknown }).ContactPerson
    delete (corpo as { BPPaymentMethods?: unknown }).BPPaymentMethods
    // Filial já atribuída no SAP: mandar de novo dá "entry already exists"
    // (ODBC -2035, visto em 2026-11-12 no C012571).
    delete (corpo as { BPBranchAssignment?: unknown }).BPBranchAssignment
    await sap.escrever('PATCH', `/BusinessPartners('${esc(cardCode)}')`, { ...corpo, Valid: 'tNO', Frozen: 'tYES' })
  })
}

export interface AjustesAprovacao {
  grupoTributario?: string
  indicadorIE?: string
  indicadorConsumidor?: string
  grupoCliente?: number
  prazoCodigo?: number
  listaPreco?: number
  limiteCredito?: number
  filiais?: number[]
}

// Todas as formas de pagamento de recebimento ativas (a Izabelly marca todas).
export async function todasFormasPagamento(sap: SapSessao): Promise<string[]> {
  const l = await sap.getTodos<{ PaymentMethodCode: string; Active: string }>(`/WizardPaymentMethods?$filter=Type eq 'boptIncoming'&$select=PaymentMethodCode,Active`)
  return l.filter((m) => m.Active !== 'tNO').map((m) => m.PaymentMethodCode)
}

// Aprovar: ajustes da Izabelly + todas as formas de pagamento + Ativo.
export async function aprovarClienteSap(cardCode: string, a: AjustesAprovacao): Promise<void> {
  await comSessaoSap(async (sap) => {
    const formas = await todasFormasPagamento(sap)
    const atual = await sap.get<{ BPPaymentMethods?: { PaymentMethodCode: string }[] }>(`/BusinessPartners('${esc(cardCode)}')?$select=BPPaymentMethods`)
    const jaTem = new Set((atual.BPPaymentMethods ?? []).map((f) => f.PaymentMethodCode))
    const novas = formas.filter((f) => !jaTem.has(f))
    await sap.escrever('PATCH', `/BusinessPartners('${esc(cardCode)}')`, {
      ...(a.grupoTributario ? { U_TS_GrupoTributario: a.grupoTributario } : {}),
      ...(a.indicadorIE ? { U_TX_IndIEDest: a.indicadorIE } : {}),
      ...(a.indicadorConsumidor ? { U_TX_IndFinal: a.indicadorConsumidor } : {}),
      ...(a.grupoCliente ? { GroupCode: a.grupoCliente } : {}),
      ...(a.prazoCodigo != null ? { PayTermsGrpCode: a.prazoCodigo } : {}),
      ...(a.listaPreco ? { PriceListNum: a.listaPreco } : {}),
      ...(a.limiteCredito != null ? { CreditLimit: a.limiteCredito } : {}),
      ...(a.filiais?.length ? { BPBranchAssignment: a.filiais.map((f) => ({ BPLID: f, DisabledForBP: 'tNO' })) } : {}),
      ...(novas.length ? { BPPaymentMethods: novas.map((c) => ({ PaymentMethodCode: c })) } : {}),
      Valid: 'tYES',
      Frozen: 'tNO',
    })
  })
}

// Situação no SAP (pra ver se a Izabelly já ativou direto no SAP).
export async function situacaoNoSap(sap: SapSessao, cardCodes: string[]): Promise<Map<string, boolean>> {
  const r = new Map<string, boolean>()
  for (let i = 0; i < cardCodes.length; i += 20) {
    const lote = cardCodes.slice(i, i + 20)
    const filtro = lote.map((c) => `CardCode eq '${esc(c)}'`).join(' or ')
    const l = await sap.getTodos<{ CardCode: string; Valid: string; Frozen: string }>(`/BusinessPartners?$filter=${filtro}&$select=CardCode,Valid,Frozen`, 20)
    for (const b of l) r.set(b.CardCode, b.Valid === 'tYES' && b.Frozen !== 'tYES')
  }
  return r
}

// Segmentos (Industries) e territórios do SAP — cache de 6h; se o SAP não
// responder, a lista fica vazia e o campo some da tela. Em 2026-11-12 o SAP
// só tinha o '-Nenhum-' (código -1/-2), que fica de fora: os campos somem até
// alguém cadastrar segmentos/territórios no SAP.
let cacheListas: { em: number; segmentos: { v: number; l: string }[]; territorios: { v: number; l: string }[] } | null = null
export async function listasCadastroSap(): Promise<{ segmentos: { v: number; l: string }[]; territorios: { v: number; l: string }[] }> {
  if (cacheListas && Date.now() - cacheListas.em < 6 * 3600_000) return cacheListas
  const vazio = { segmentos: [] as { v: number; l: string }[], territorios: [] as { v: number; l: string }[] }
  try {
    const r = await comSessaoSap(async (sap) => {
      const seg = await sap.getTodos<{ IndustryCode: number; IndustryName: string }>('/Industries?$select=IndustryCode,IndustryName').catch(() => [])
      const ter = await sap.getTodos<{ TerritoryID: number; Description: string; Inactive?: string }>('/Territories?$select=TerritoryID,Description,Inactive').catch(() => [])
      return {
        segmentos: seg.filter((x) => x.IndustryCode > 0).map((x) => ({ v: x.IndustryCode, l: x.IndustryName })).sort((a, b) => a.l.localeCompare(b.l, 'pt-BR')),
        territorios: ter.filter((x) => x.Inactive !== 'tYES' && x.TerritoryID > 0).map((x) => ({ v: x.TerritoryID, l: x.Description })).sort((a, b) => a.l.localeCompare(b.l, 'pt-BR')),
      }
    })
    cacheListas = { em: Date.now(), ...r }
    return r
  } catch (e) {
    console.error('[sap-cadastro] listas:', e instanceof Error ? e.message : e)
    cacheListas = { em: Date.now() - 5.5 * 3600_000, ...(cacheListas ?? vazio) }
    return cacheListas
  }
}
