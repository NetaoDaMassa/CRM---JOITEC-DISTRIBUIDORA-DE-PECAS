import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { carteiraHistorico, clientes, empresas, funilMensal, users } from '../db/schema.js'
import { getConfigTexto, setConfig } from './configuracoes.js'
import { limparCodigo, semZerosEsquerda } from './importSapHistorico.js'
import { hojeBrString, mesReferenciaAtual } from './dataBr.js'
import { registrarAuditoria } from './auditoria.js'
import { regiaoPorUf } from './regiao.js'
import { comSessaoSap, dataSap } from './sapServiceLayer.js'
import type { SapSessao } from './sapServiceLayer.js'
import { sincronizarItensSap, vendedoresAutomacaoSap } from './sapSyncItens.js'
import { sincronizarVendasSap } from './sapVendasAuto.js'

// Clientes do SAP → CRM — pedido do João, 2026-11-01:
//   1. "têm venda no SAP e não estão no CRM": cliente com nota de venda
//      (desde abril/26, quando começam os itens) que não está cadastrado na
//      empresa — o relatório de itens e as vendas ficam sem ele. O gestor de
//      cada empresa revisa, escolhe o vendedor e cadastra com os dados do
//      SAP (sem digitar); as notas dele entram na hora.
//   2. cadastro NOVO no SAP (criado a partir de `sap_clientes_auto_desde`)
//      entra sozinho, na carteira do vendedor do CRM ligado ao vendedor do
//      SAP (`sap_vendedores_crm`, JSON {códigoSAP: userId}). Vendedor sem
//      ligação = não entra sozinho, fica na lista pro gestor. Os ~11 mil
//      cadastros antigos não entram (decisão do João).
// Cliente que já está no CRM (pelo código ou CNPJ/CPF) nunca é mexido — o
// vendedor no cadastro do SAP muitas vezes está errado (Odin Tubos), o CRM
// é que manda.

const CHAVE_AUTO_DESDE = 'sap_clientes_auto_desde'
const CHAVE_VENDEDORES = 'sap_vendedores_crm'
const chaveIgnorados = (empresaId: number) => `sap_clientes_ignorados_${empresaId}`
const GRUPO_PADRAO = 'C003770,C002707,C001284,C001270'
// Os itens das notas no CRM começam em abril/26.
const NOTAS_DESDE = '2026-04-01'
const SLUGS = ['joitec', 'odin-tubos', 'joitec-automacao'] as const

export interface CadastroSap {
  codigo: string
  nome: string
  fantasia: string | null
  cnpj: string | null
  cpf: string | null
  inscricaoEstadual: string | null
  telefone: string | null
  email: string | null
  contato: string | null
  vendedorSap: number | null
  uf: string | null
  cidade: string | null
  endereco: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cep: string | null
  criadoEm: string | null
  // "YYYY-MM-DD HH:MM" (Brasília) — quando foi cadastrado no SAP
  criadoEmHora: string | null
  ativo: boolean
}

interface BpSap {
  CardCode: string
  CardName: string
  CardForeignName: string | null
  Phone1: string | null
  Phone2: string | null
  Cellular: string | null
  EmailAddress: string | null
  ContactPerson: string | null
  SalesPersonCode: number | null
  FederalTaxID: string | null
  CreateDate: string | null
  CreateTime: string | null
  Valid: string
  Frozen: string
  BPAddresses?: { AddressType: string; Street: string | null; StreetNo: string | null; Block: string | null; BuildingFloorRoom: string | null; ZipCode: string | null; City: string | null; State: string | null }[]
  BPFiscalTaxIDCollection?: { TaxId0: string | null; TaxId1: string | null; TaxId4: string | null }[]
}

const CAMPOS_BP = 'CardCode,CardName,CardForeignName,Phone1,Phone2,Cellular,EmailAddress,ContactPerson,SalesPersonCode,FederalTaxID,CreateDate,CreateTime,Valid,Frozen,BPAddresses,BPFiscalTaxIDCollection'
const soDigitos = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '')
const texto = (t: string | null | undefined) => (t ?? '').trim() || null

function paraCadastro(b: BpSap): CadastroSap {
  const end = b.BPAddresses?.find((a) => a.AddressType === 'bo_BillTo') ?? b.BPAddresses?.[0]
  const fiscal = b.BPFiscalTaxIDCollection?.find((f) => f.TaxId0 || f.TaxId4) ?? b.BPFiscalTaxIDCollection?.[0]
  const federal = soDigitos(b.FederalTaxID)
  const cnpj = soDigitos(fiscal?.TaxId0) || (federal.length === 14 ? federal : '')
  const cpf = soDigitos(fiscal?.TaxId4) || (federal.length === 11 ? federal : '')
  // No SAP o DDD vem em Phone2 e o número em Phone1.
  const ddd = soDigitos(b.Phone2)
  const fone = soDigitos(b.Cellular) || soDigitos(b.Phone1)
  const telefone = fone ? (ddd.length === 2 && fone.length <= 9 ? ddd + fone : fone) : null
  const ie = texto(fiscal?.TaxId1)
  return {
    codigo: limparCodigo(b.CardCode),
    nome: b.CardName.trim(),
    fantasia: texto(b.CardForeignName),
    cnpj: cnpj.length === 14 ? cnpj : null,
    cpf: !cnpj && cpf.length === 11 ? cpf : null,
    inscricaoEstadual: ie,
    telefone,
    email: texto(b.EmailAddress?.split(/[;,]/)[0]),
    contato: texto(b.ContactPerson),
    vendedorSap: b.SalesPersonCode != null && b.SalesPersonCode > 0 ? b.SalesPersonCode : null,
    uf: texto(end?.State)?.toUpperCase() ?? null,
    cidade: texto(end?.City),
    endereco: texto(end?.Street),
    numero: texto(end?.StreetNo),
    complemento: texto(end?.BuildingFloorRoom),
    bairro: texto(end?.Block),
    cep: soDigitos(end?.ZipCode) || null,
    criadoEm: b.CreateDate ? dataSap(b.CreateDate) : null,
    criadoEmHora: b.CreateDate ? `${dataSap(b.CreateDate)}${b.CreateTime ? ` ${b.CreateTime.slice(0, 5)}` : ''}` : null,
    ativo: b.Valid !== 'tNO' && b.Frozen !== 'tYES',
  }
}

async function lerCadastros(sap: SapSessao, codigos: string[]): Promise<Map<string, CadastroSap>> {
  const r = new Map<string, CadastroSap>()
  for (let i = 0; i < codigos.length; i += 20) {
    const lote = codigos.slice(i, i + 20)
    const filtro = lote.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(' or ')
    for (const b of await sap.getTodos<BpSap>(`/BusinessPartners?$filter=${filtro}&$select=${CAMPOS_BP}`, 20)) r.set(limparCodigo(b.CardCode), paraCadastro(b))
  }
  return r
}

// Clientes da empresa (inclusive excluídos, pra não recriar quem foi apagado
// de propósito) por código e por CNPJ/CPF.
async function indiceClientes(empresaId: number) {
  const lista = await db.query.clientes.findMany({
    where: eq(clientes.empresaId, empresaId),
    columns: { id: true, codigo: true, codigoAntigo: true, cnpj: true, cpf: true, razaoSocial: true, deletedAt: true },
  })
  const porCodigo = new Map<string, (typeof lista)[number]>()
  const porDoc = new Map<string, (typeof lista)[number]>()
  for (const c of lista) {
    for (const cod of [c.codigo, c.codigoAntigo]) {
      if (!cod) continue
      const l = limparCodigo(cod)
      if (!porCodigo.has(l)) porCodigo.set(l, c)
      const sz = semZerosEsquerda(l)
      if (!porCodigo.has(sz)) porCodigo.set(sz, c)
    }
    for (const d of [c.cnpj, c.cpf]) {
      const dd = soDigitos(d)
      if (dd && !porDoc.has(dd)) porDoc.set(dd, c)
    }
  }
  return {
    porCodigo: (codigo: string) => porCodigo.get(limparCodigo(codigo)) ?? porCodigo.get(semZerosEsquerda(limparCodigo(codigo))),
    porDoc: (cad: { cnpj: string | null; cpf: string | null }) => (cad.cnpj ? porDoc.get(cad.cnpj) : undefined) ?? (cad.cpf ? porDoc.get(cad.cpf) : undefined),
  }
}

export async function vendedoresLigados(): Promise<Record<string, number>> {
  try {
    const j = JSON.parse((await getConfigTexto(CHAVE_VENDEDORES)) ?? '{}')
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

export async function salvarVendedoresLigados(mapa: Record<string, number>): Promise<void> {
  await setConfig(CHAVE_VENDEDORES, JSON.stringify(mapa))
}

async function ignorados(empresaId: number): Promise<Set<string>> {
  return new Set(((await getConfigTexto(chaveIgnorados(empresaId))) ?? '').split(',').map((s) => s.trim()).filter(Boolean))
}

export async function ignorarCodigo(empresaId: number, codigo: string, ignorar: boolean): Promise<void> {
  const atual = await ignorados(empresaId)
  if (ignorar) atual.add(limparCodigo(codigo))
  else atual.delete(limparCodigo(codigo))
  await setConfig(chaveIgnorados(empresaId), [...atual].join(','))
}

// ── Nomes dos vendedores do SAP (cache de 1h) ───────────────────────────
let cacheVendedores: { em: number; lista: { codigo: number; nome: string; ativo: boolean }[] } | null = null
export async function vendedoresSap(sap?: SapSessao): Promise<{ codigo: number; nome: string; ativo: boolean }[]> {
  if (cacheVendedores && Date.now() - cacheVendedores.em < 3600_000) return cacheVendedores.lista
  const ler = (s: SapSessao) => s.getTodos<{ SalesEmployeeCode: number; SalesEmployeeName: string; Active: string }>('/SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName,Active', 200)
  const brutos = sap ? await ler(sap) : await comSessaoSap(ler)
  const lista = brutos.filter((v) => v.SalesEmployeeCode > 0).map((v) => ({ codigo: v.SalesEmployeeCode, nome: v.SalesEmployeeName.trim(), ativo: v.Active !== 'tNO' }))
  cacheVendedores = { em: Date.now(), lista }
  return lista
}

// ── 1. Têm venda no SAP e não estão no CRM ──────────────────────────────
interface NotaCab {
  DocNum: number
  DocDate: string
  CardCode: string
  CardName: string
  DocTotal: number
  SalesPersonCode: number
  BPL_IDAssignedToInvoice: number
}
let cacheNotas: { em: number; notas: NotaCab[] } | null = null

// Mesma regra de empresa dos itens das notas (lib/sapSyncItens.ts): a
// filial decide; na filial Joitec, vendedor da Automação vai pra Automação.
function slugDaNota(n: NotaCab, automacao: Set<number>): string | undefined {
  if (n.BPL_IDAssignedToInvoice === 4) return 'odin-tubos'
  if (n.BPL_IDAssignedToInvoice === 3) return automacao.has(n.SalesPersonCode) ? 'joitec-automacao' : 'joitec'
  return undefined
}

export async function clientesComVendaFora(empresaId: number, atualizar = false) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (!empresa || !(SLUGS as readonly string[]).includes(empresa.slug)) return { suportada: false as const, lista: [] }

  const { notas, vendedores } = await comSessaoSap(async (sap) => {
    if (atualizar || !cacheNotas || Date.now() - cacheNotas.em > 10 * 60_000) {
      const notas = await sap.getTodos<NotaCab>(
        `/Invoices?$filter=DocDate ge '${NOTAS_DESDE}' and Cancelled eq 'tNO' and (BPL_IDAssignedToInvoice eq 3 or BPL_IDAssignedToInvoice eq 4)&$select=DocNum,DocDate,CardCode,CardName,DocTotal,SalesPersonCode,BPL_IDAssignedToInvoice`,
        500
      )
      cacheNotas = { em: Date.now(), notas }
    }
    return { notas: cacheNotas.notas, vendedores: await vendedoresSap(sap) }
  })

  const automacao = await vendedoresAutomacaoSap()
  const grupo = new Set(((await getConfigTexto('sap_receber_ignorar_clientes')) ?? GRUPO_PADRAO).split(',').map((s) => limparCodigo(s)))
  const fora = await ignorados(empresaId)
  const indice = await indiceClientes(empresaId)
  const porCliente = new Map<string, { codigo: string; nome: string; notas: number; valor: number; ultima: string; vendedorUltima: number }>()
  for (const n of notas) {
    if (slugDaNota(n, automacao) !== empresa.slug) continue
    const codigo = limparCodigo(n.CardCode)
    if (grupo.has(codigo) || indice.porCodigo(codigo)) continue
    const data = dataSap(n.DocDate)
    const c = porCliente.get(codigo) ?? { codigo, nome: n.CardName.trim(), notas: 0, valor: 0, ultima: '', vendedorUltima: n.SalesPersonCode }
    c.notas++
    c.valor += n.DocTotal ?? 0
    if (data >= c.ultima) {
      c.ultima = data
      c.vendedorUltima = n.SalesPersonCode
    }
    porCliente.set(codigo, c)
  }

  const codigos = [...porCliente.keys()]
  const cadastros = codigos.length ? await comSessaoSap((sap) => lerCadastros(sap, codigos)) : new Map<string, CadastroSap>()
  const ligados = await vendedoresLigados()
  const nomeSap = new Map(vendedores.map((v) => [v.codigo, v.nome]))
  const usuarios = await db.query.users.findMany({ where: eq(users.empresaId, empresaId), columns: { id: true, name: true } })
  const daEmpresa = new Map(usuarios.map((u) => [u.id, u.name]))

  const lista = [...porCliente.values()].map((c) => {
    const cad = cadastros.get(c.codigo) ?? null
    const parecido = cad ? indice.porDoc(cad) : undefined
    // Sugestão: quem tirou a última nota (se estiver ligado a alguém desta empresa).
    const sugerido = ligados[String(c.vendedorUltima)]
    return {
      ...c,
      ignorado: fora.has(c.codigo),
      vendedorSapNome: nomeSap.get(c.vendedorUltima) ?? `Código ${c.vendedorUltima}`,
      vendedorSugeridoId: sugerido && daEmpresa.has(sugerido) ? sugerido : null,
      cnpj: cad?.cnpj ?? cad?.cpf ?? null,
      cidade: cad ? [cad.cidade, cad.uf].filter(Boolean).join(' / ') || null : null,
      pareceSer: parecido ? { id: parecido.id, razaoSocial: parecido.razaoSocial, codigo: parecido.codigo, excluido: !!parecido.deletedAt } : null,
    }
  })
  lista.sort((a, b) => b.valor - a.valor)
  return { suportada: true as const, lista }
}

// ── 2. Cadastros novos do SAP ───────────────────────────────────────────
export async function autoDesde(): Promise<string | null> {
  return getConfigTexto(CHAVE_AUTO_DESDE)
}

export async function ligarAutomatico(ligado: boolean): Promise<void> {
  await setConfig(CHAVE_AUTO_DESDE, ligado ? hojeBrString() : '')
}

async function cadastrosNovos(sap: SapSessao, desde: string): Promise<CadastroSap[]> {
  const brutos = await sap.getTodos<BpSap>(`/BusinessPartners?$filter=CardType eq 'cCustomer' and CreateDate ge '${desde}'&$select=${CAMPOS_BP}`, 100)
  return brutos.map(paraCadastro)
}

// Onde o cadastro novo vai: empresa e carteira do vendedor do CRM ligado ao
// vendedor do SAP. Sem ligação (ou usuário de empresa fora da integração) = null.
async function destinos() {
  const ligados = await vendedoresLigados()
  const ids = [...new Set(Object.values(ligados))]
  const lista = ids.length
    ? await db
        .select({ id: users.id, name: users.name, empresaId: users.empresaId, slug: empresas.slug, ativo: users.isActive })
        .from(users)
        .innerJoin(empresas, eq(empresas.id, users.empresaId))
        .where(inArray(users.id, ids))
    : []
  const porId = new Map(lista.filter((u) => u.ativo && (SLUGS as readonly string[]).includes(u.slug)).map((u) => [u.id, u]))
  return (vendedorSap: number | null) => {
    const id = vendedorSap != null ? ligados[String(vendedorSap)] : undefined
    return id ? porId.get(id) ?? null : null
  }
}

// Lista do gestor: cadastros novos que não entraram sozinhos (vendedor do
// SAP sem ligação) e ainda não estão nesta empresa.
export async function cadastrosNovosPendentes(empresaId: number) {
  const desde = await autoDesde()
  if (!desde) return { ligado: false as const, desde: null, lista: [] }
  const { novos, vendedores } = await comSessaoSap(async (sap) => ({ novos: await cadastrosNovos(sap, desde), vendedores: await vendedoresSap(sap) }))
  const destino = await destinos()
  const indice = await indiceClientes(empresaId)
  const fora = await ignorados(empresaId)
  const nomeSap = new Map(vendedores.map((v) => [v.codigo, v.nome]))
  const lista = novos
    .filter((c) => c.ativo && !destino(c.vendedorSap) && !indice.porCodigo(c.codigo))
    .map((c) => {
      const parecido = indice.porDoc(c)
      return {
        codigo: c.codigo,
        nome: c.nome,
        cnpj: c.cnpj ?? c.cpf,
        cidade: [c.cidade, c.uf].filter(Boolean).join(' / ') || null,
        criadoEm: c.criadoEm,
        vendedorSapNome: c.vendedorSap != null ? nomeSap.get(c.vendedorSap) ?? `Código ${c.vendedorSap}` : 'Sem vendedor no SAP',
        ignorado: fora.has(c.codigo),
        pareceSer: parecido ? { id: parecido.id, razaoSocial: parecido.razaoSocial, codigo: parecido.codigo, excluido: !!parecido.deletedAt } : null,
      }
    })
  return { ligado: true as const, desde, lista }
}

// ── Cadastrar ───────────────────────────────────────────────────────────
async function inserirCliente(cad: CadastroSap, empresaId: number, vendedorId: number | null, autorId: number): Promise<number> {
  const result = await db.insert(clientes).values({
    empresaId,
    razaoSocial: cad.nome,
    cnpj: cad.cnpj,
    cpf: cad.cpf,
    codigo: cad.codigo,
    inscricaoEstadual: cad.inscricaoEstadual,
    regiao: cad.uf ? regiaoPorUf(cad.uf) : null,
    estado: cad.uf,
    cidade: cad.cidade,
    endereco: cad.endereco,
    numero: cad.numero,
    complemento: cad.complemento,
    bairro: cad.bairro,
    cep: cad.cep,
    telefoneWhatsapp: cad.telefone,
    email: cad.email,
    nomeContato: cad.contato,
    cadastradoPor: autorId,
    vendedorAtualId: vendedorId,
    origemBanco: vendedorId ? null : 'Cadastro do SAP',
    observacoes: cad.fantasia ? `Nome fantasia (SAP): ${cad.fantasia}` : null,
    novoDoSapEm: cad.criadoEmHora,
  })
  const clienteId = Number(result.lastInsertRowid)
  if (vendedorId) {
    await db.insert(carteiraHistorico).values({ clienteId, vendedorId })
    await db.insert(funilMensal).values({ clienteId, vendedorId, mesReferencia: mesReferenciaAtual() })
  }
  await registrarAuditoria({ tabela: 'clientes', registroId: clienteId, acao: 'criar', alteradoPor: autorId, campo: 'origem', valorNovo: 'Cadastro puxado do SAP' })
  return clienteId
}

// Depois de cadastrar: itens das notas desde abril e a venda automática dos
// pedidos (a partir de `sap_vendas_auto_desde`) desse cliente. Em segundo
// plano — a tela não espera.
function trazerHistorico(codigo: string, autorId: number) {
  ;(async () => {
    await sincronizarItensSap({ confirmar: true, usuarioId: autorId, de: NOTAS_DESDE, cardCodes: [codigo] })
    const desde = await getConfigTexto('sap_vendas_auto_desde')
    if (!desde) return
    const pedidos = await comSessaoSap((sap) =>
      sap.getTodos<{ DocEntry: number }>(`/Orders?$filter=CardCode eq '${codigo.replace(/'/g, "''")}' and DocDate ge '${desde}' and Cancelled eq 'tNO'&$select=DocEntry`, 100)
    )
    if (pedidos.length) await sincronizarVendasSap({ desde, docEntries: pedidos.map((p) => p.DocEntry) })
  })().catch((err) => console.error('[sap-clientes] erro ao trazer o histórico de', codigo, err instanceof Error ? err.message : err))
}

export async function cadastrarClienteSap(codigo: string, empresaId: number, vendedorId: number | null, autorId: number) {
  const cad = (await comSessaoSap((sap) => lerCadastros(sap, [codigo]))).get(limparCodigo(codigo))
  if (!cad) throw new Error(`O cliente ${codigo} não foi encontrado no SAP.`)
  const indice = await indiceClientes(empresaId)
  const jaTem = indice.porCodigo(cad.codigo) ?? indice.porDoc(cad)
  if (jaTem) throw new Error(`Já existe no CRM: ${jaTem.razaoSocial} (${jaTem.codigo})${jaTem.deletedAt ? ' — está excluído' : ''}.`)
  if (vendedorId) {
    const v = await db.query.users.findFirst({ where: eq(users.id, vendedorId) })
    if (!v || v.empresaId !== empresaId) throw new Error('Vendedor inválido')
  }
  const id = await inserirCliente(cad, empresaId, vendedorId, autorId)
  trazerHistorico(cad.codigo, autorId)
  return { id, codigo: cad.codigo }
}

// "É o mesmo cliente" — o cliente já está no CRM com outro código (ex.:
// cadastro manual "M…" ou código do sistema antigo): grava o código do SAP
// nele, e as notas passam a cair nele.
export async function ligarCodigoSap(clienteId: number, codigo: string, empresaId: number, autorId: number) {
  const c = await db.query.clientes.findFirst({ where: and(eq(clientes.id, clienteId), eq(clientes.empresaId, empresaId)) })
  if (!c) throw new Error('Cliente não encontrado')
  const cod = limparCodigo(codigo)
  const outro = (await indiceClientes(empresaId)).porCodigo(cod)
  if (outro && outro.id !== c.id) throw new Error(`O código ${cod} já é de ${outro.razaoSocial}.`)
  const campo = c.codigo.startsWith('M') ? { codigo: cod } : !c.codigoAntigo ? { codigoAntigo: c.codigo, codigo: cod } : null
  if (!campo) throw new Error('Esse cliente já tem dois códigos — ajuste o cadastro na mão.')
  await db.update(clientes).set(campo).where(eq(clientes.id, c.id))
  await registrarAuditoria({ tabela: 'clientes', registroId: c.id, acao: 'editar', alteradoPor: autorId, campo: 'codigo', valorAnterior: c.codigo, valorNovo: cod })
  trazerHistorico(cod, autorId)
  return { ok: true }
}

// ── Rodada automática ───────────────────────────────────────────────────
export async function sincronizarClientesNovosSap(): Promise<{ criados: number; pendentes: number } | null> {
  const desde = await autoDesde()
  if (!desde) return null
  const autor = await db.query.users.findFirst({ where: eq(users.superAdmin, true), columns: { id: true } })
  if (!autor) return null
  const novos = await comSessaoSap((sap) => cadastrosNovos(sap, desde))
  const destino = await destinos()
  const indices = new Map<number, Awaited<ReturnType<typeof indiceClientes>>>()
  let criados = 0
  let pendentes = 0
  for (const cad of novos) {
    if (!cad.ativo) continue
    const d = destino(cad.vendedorSap)
    if (!d) {
      pendentes++
      continue
    }
    if (!indices.has(d.empresaId)) indices.set(d.empresaId, await indiceClientes(d.empresaId))
    const indice = indices.get(d.empresaId)!
    if (indice.porCodigo(cad.codigo) || indice.porDoc(cad)) continue
    await inserirCliente(cad, d.empresaId, d.id, autor.id)
    indices.set(d.empresaId, await indiceClientes(d.empresaId))
    trazerHistorico(cad.codigo, autor.id)
    criados++
  }
  return { criados, pendentes }
}
