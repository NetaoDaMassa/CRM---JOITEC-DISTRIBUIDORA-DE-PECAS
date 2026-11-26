// Venda registrada na mão que não acha o pedido do SAP porque o cadastro do
// cliente no CRM não tem o código do SAP (João, 2026-11-26 — casos REAL
// INSPECOES, ~Oseias Rocha, VERA LUCIA e M P I). Lead do Marketing vira
// cliente "M…"; depois o cliente é cadastrado direto no SAP (ou já estava lá)
// e o pedido/NF nunca caem no card, nem contam como venda do SAP.
//
// De hora em hora: pega as vendas manuais recentes nesses cadastros e procura
// o cliente no SAP — pelo CNPJ/CPF do cadastro, pelo CNPJ que foi retirado e
// ficou nas anotações, ou (sem documento) por UM único pedido de mesmo valor
// na mesma semana com o mesmo nome. Achou com segurança:
//   - ninguém mais tem esse código → liga o código (ligarCodigoSap), completa
//     o CNPJ e puxa o pedido (a venda manual é ligada, não duplica);
//   - o outro cadastro com o código está na LIXEIRA → ele fica com
//     "<código>-ANTIGO" e o código passa pra este (mesma coisa);
//   - o outro cadastro está ATIVO → duplicado de verdade: não mexe; vai pra
//     lista do gestor (tela Vendas sem pedido do SAP) e avisa no sininho.
import { and, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, users, vendas } from '../db/schema.js'
import { comSessaoSap, sapConfigurado, type SapSessao } from './sapServiceLayer.js'
import { codigoSap } from './codigoSap.js'
import { ligarCodigoSap } from './sapClientes.js'
import { sincronizarVendasSap } from './sapVendasAuto.js'
import { getConfigBool, getConfigTexto, setConfig } from './configuracoes.js'
import { registrarAuditoria } from './auditoria.js'
import { agoraSqlite, hojeBrString } from './dataBr.js'
import { notificarGestores } from './propostasGates.js'

const SLUGS_SAP = ['joitec', 'odin-tubos', 'joitec-automacao', 'odin-compressores']
const CHAVE_PENDENTES = 'vendas_sem_sap_duplicados'
const CHAVE_AVISADOS = 'vendas_sem_sap_avisados'
const DIAS = 40

export interface DuplicadoPendente {
  clienteId: number // cadastro com a venda (sem código do SAP)
  antigoId: number // cadastro que já tem o código do SAP
  empresaId: number
  codigoSap: string
  nomeSap: string
  razaoSocial: string
  razaoSocialAntigo: string
  vendedor: string | null
  vendedorAntigo: string | null
  valor: number
  dataVenda: string
  pedidos: number[]
  achadoPor: string
}

const dig = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')
const nomeNorm = (s: string | null | undefined) =>
  String(s ?? '').toUpperCase().normalize('NFD').replace(/[^A-Z]/g, '')
const addDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const fmtCnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
const fmtCpf = (d: string) => d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

type Bp = { CardCode: string; CardName: string; FederalTaxID: string | null }
type Ped = { DocEntry: number; DocNum: number; DocDate: string; CardCode: string; CardName: string; DocTotal: number }

async function acharNoSap(
  sap: SapSessao,
  v: { valor: number; dia: string; razaoSocial: string; cnpj: string | null; cpf: string | null; observacoes: string | null }
): Promise<{ bp: Bp; como: string } | null> {
  const docs = [
    ...new Set(
      [dig(v.cnpj), dig(v.cpf), ...[...String(v.observacoes ?? '').matchAll(/CNPJ\D{0,3}(\d{14})/g)].map((m) => m[1])].filter(
        (d) => d.length === 14 || d.length === 11
      )
    ),
  ]
  for (const d of docs) {
    const f = d.length === 14 ? fmtCnpj(d) : fmtCpf(d)
    const r = await sap.get<{ value: (Bp & { CardType: string })[] }>(
      `/BusinessPartners?$filter=FederalTaxID eq '${f}' or FederalTaxID eq '${d}'&$select=CardCode,CardName,FederalTaxID,CardType`
    )
    const clientesSap = (r.value ?? []).filter((b) => b.CardType === 'cCustomer' && codigoSap(b.CardCode))
    if (clientesSap.length === 1) return { bp: clientesSap[0], como: d.length === 14 ? `CNPJ ${d}` : `CPF ${d}` }
    if (clientesSap.length > 1) return null // CNPJ repetido no próprio SAP: não chuta
  }
  // Sem documento que bata: um único pedido de mesmo valor, mesma semana, mesmo nome.
  const ped = await sap.get<{ value: Ped[] }>(
    `/Orders?$filter=DocDate ge '${addDias(v.dia, -5)}' and DocDate le '${addDias(v.dia, 7)}' and DocTotal ge ${(v.valor - 0.02).toFixed(2)} and DocTotal le ${(v.valor + 0.02).toFixed(2)} and Cancelled eq 'tNO'&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal`
  )
  const lista = ped.value ?? []
  const nome = nomeNorm(v.razaoSocial)
  if (lista.length === 1 && nome.length >= 6 && nomeNorm(lista[0].CardName) === nome && codigoSap(lista[0].CardCode)) {
    return { bp: { CardCode: lista[0].CardCode, CardName: lista[0].CardName, FederalTaxID: null }, como: `nome + pedido ${lista[0].DocNum} de mesmo valor` }
  }
  return null
}

async function pedidosDoCliente(sap: SapSessao, codigo: string, desde: string): Promise<Ped[]> {
  const r = await sap.get<{ value: Ped[] }>(
    `/Orders?$filter=CardCode eq '${codigo.replace(/'/g, "''")}' and DocDate ge '${desde}' and Cancelled eq 'tNO'&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal`
  )
  return r.value ?? []
}

async function autorSistema(): Promise<number> {
  const a = await db.query.users.findFirst({ where: eq(users.superAdmin, true), columns: { id: true } })
  if (!a) throw new Error('sem super admin')
  return a.id
}

// Passa o código do SAP do cadastro `antigoId` (que vai pra lixeira como
// "<código>-ANTIGO") pro cadastro `clienteId`, e completa o CNPJ.
async function transferirCodigo(clienteId: number, antigoId: number | null, empresaId: number, bp: Bp, autorId: number) {
  const cod = codigoSap(bp.CardCode)!
  if (antigoId) {
    const antigo = await db.query.clientes.findFirst({ where: eq(clientes.id, antigoId) })
    if (antigo && codigoSap(antigo.codigo) === cod) {
      await db
        .update(clientes)
        .set({
          codigo: `${cod}-ANTIGO`,
          deletedAt: antigo.deletedAt ?? agoraSqlite(),
          motivoExclusao: antigo.motivoExclusao ?? `Duplicado: o cliente continua no cadastro ${clienteId}`,
          updatedAt: agoraSqlite(),
        })
        .where(eq(clientes.id, antigoId))
      await registrarAuditoria({
        tabela: 'clientes',
        registroId: antigoId,
        acao: 'editar',
        campo: 'codigo',
        valorAnterior: antigo.codigo,
        valorNovo: `${cod}-ANTIGO (duplicado; o código passou pro cadastro ${clienteId})`,
        alteradoPor: autorId,
      })
    }
  }
  await ligarCodigoSap(clienteId, cod, empresaId, autorId)
  const doc = dig(bp.FederalTaxID)
  if (doc.length === 14 || doc.length === 11) {
    const c = await db.query.clientes.findFirst({ where: eq(clientes.id, clienteId), columns: { cnpj: true, cpf: true } })
    if (c && !c.cnpj && !c.cpf) {
      const campo = doc.length === 14 ? clientes.cnpj : clientes.cpf
      const outro = await db.query.clientes.findFirst({
        where: and(eq(clientes.empresaId, empresaId), ne(clientes.id, clienteId), isNull(clientes.deletedAt), eq(campo, doc)),
        columns: { id: true },
      })
      if (!outro) await db.update(clientes).set(doc.length === 14 ? { cnpj: doc } : { cpf: doc }).where(eq(clientes.id, clienteId))
    }
  }
}

export async function lerDuplicadosPendentes(): Promise<DuplicadoPendente[]> {
  try {
    return JSON.parse((await getConfigTexto(CHAVE_PENDENTES)) ?? '[]') as DuplicadoPendente[]
  } catch {
    return []
  }
}

export async function conferirVendasSemSap(): Promise<{ ligados: number; duplicados: number; semAchar: number }> {
  const desde = addDias(hojeBrString(), -DIAS)
  const empresasSap = await db.query.empresas.findMany({ where: inArray(empresas.slug, SLUGS_SAP), columns: { id: true } })
  if (!empresasSap.length) return { ligados: 0, duplicados: 0, semAchar: 0 }
  const linhas = await db
    .select({
      vendaId: vendas.id,
      valor: vendas.valorFechado,
      dataFechamento: vendas.dataFechamento,
      clienteId: clientes.id,
      empresaId: clientes.empresaId,
      codigo: clientes.codigo,
      codigoAntigo: clientes.codigoAntigo,
      razaoSocial: clientes.razaoSocial,
      cnpj: clientes.cnpj,
      cpf: clientes.cpf,
      observacoes: clientes.observacoes,
      vendedor: users.name,
    })
    .from(vendas)
    .innerJoin(clientes, eq(clientes.id, vendas.clienteId))
    .leftJoin(users, eq(users.id, vendas.vendedorId))
    .where(
      and(
        isNull(vendas.deletedAt),
        isNull(vendas.pedidoSapEntry),
        isNull(clientes.deletedAt),
        gte(vendas.dataFechamento, desde),
        sql`${vendas.valorFechado} >= 1`,
        inArray(
          clientes.empresaId,
          empresasSap.map((e) => e.id)
        )
      )
    )
  // Só cadastro "M…" (criado no CRM: lead do Marketing / cliente novo) — os
  // códigos de planilha antiga ficam com a regra de sempre (sapClientes.ts).
  const candidatas = linhas.filter((l) => /^M\d+$/i.test(l.codigo.trim()) && !codigoSap(l.codigoAntigo))
  const resultado = { ligados: 0, duplicados: 0, semAchar: 0 }
  const pendentes: DuplicadoPendente[] = []
  if (!candidatas.length) {
    await setConfig(CHAVE_PENDENTES, '[]')
    return resultado
  }
  const autorId = await autorSistema()
  const feitos = new Set<number>()
  const docEntries: number[] = []
  await comSessaoSap(async (sap) => {
    for (const v of candidatas) {
      if (feitos.has(v.clienteId)) continue
      feitos.add(v.clienteId)
      const dia = String(v.dataFechamento).slice(0, 10)
      let achado: Awaited<ReturnType<typeof acharNoSap>>
      try {
        achado = await acharNoSap(sap, { valor: v.valor, dia, razaoSocial: v.razaoSocial, cnpj: v.cnpj, cpf: v.cpf, observacoes: v.observacoes })
      } catch (err) {
        console.error('[vendas-sem-sap] erro procurando', v.razaoSocial, err instanceof Error ? err.message : err)
        continue
      }
      if (!achado) {
        resultado.semAchar++
        continue
      }
      const cod = codigoSap(achado.bp.CardCode)!
      const outro = await db.query.clientes.findFirst({
        where: and(eq(clientes.empresaId, v.empresaId), ne(clientes.id, v.clienteId), sql`upper(trim(${clientes.codigo})) = ${cod}`),
        with: { vendedorAtual: { columns: { name: true } } },
      })
      const peds = await pedidosDoCliente(sap, cod, addDias(desde, -5)).catch(() => [] as Ped[])
      if (outro && !outro.deletedAt) {
        pendentes.push({
          clienteId: v.clienteId,
          antigoId: outro.id,
          empresaId: v.empresaId,
          codigoSap: cod,
          nomeSap: achado.bp.CardName,
          razaoSocial: v.razaoSocial,
          razaoSocialAntigo: outro.razaoSocial,
          vendedor: v.vendedor,
          vendedorAntigo: (outro as { vendedorAtual?: { name: string } | null }).vendedorAtual?.name ?? null,
          valor: v.valor,
          dataVenda: dia,
          pedidos: peds.map((p) => p.DocNum),
          achadoPor: achado.como,
        })
        continue
      }
      try {
        await transferirCodigo(v.clienteId, outro?.id ?? null, v.empresaId, achado.bp, autorId)
        docEntries.push(...peds.map((p) => p.DocEntry))
        resultado.ligados++
        console.log(`[vendas-sem-sap] ${v.razaoSocial} (${v.codigo}) ligado ao ${cod} do SAP pelo ${achado.como}`)
      } catch (err) {
        console.error('[vendas-sem-sap] não ligou', v.razaoSocial, cod, err instanceof Error ? err.message : err)
      }
    }
  })
  if (docEntries.length) await sincronizarVendasSap({ docEntries: [...new Set(docEntries)] })

  resultado.duplicados = pendentes.length
  await setConfig(CHAVE_PENDENTES, JSON.stringify(pendentes))
  // Sininho dos gestores da empresa — 1 vez por cadastro.
  let avisados: number[] = []
  try {
    avisados = JSON.parse((await getConfigTexto(CHAVE_AVISADOS)) ?? '[]')
  } catch {
    avisados = []
  }
  for (const p of pendentes) {
    if (avisados.includes(p.clienteId)) continue
    await notificarGestores(
      p.empresaId,
      'Venda sem pedido do SAP: cadastro duplicado',
      `${p.razaoSocial} (${p.vendedor ?? 'sem vendedor'}): a venda de R$ ${p.valor.toFixed(2).replace('.', ',')} está num cadastro sem código do SAP, mas o cliente já existe como ${p.razaoSocialAntigo} (${p.codigoSap}). Abra "Vendas sem pedido do SAP" para corrigir.`,
      'warning'
    )
    avisados.push(p.clienteId)
  }
  await setConfig(CHAVE_AVISADOS, JSON.stringify(avisados.slice(-500)))
  return resultado
}

// Botão "Corrigir" do gestor: o cadastro com a venda fica com o código do SAP;
// o antigo vai pra lixeira como "<código>-ANTIGO". Não mexe se o antigo tem
// venda nos últimos 40 dias (aí é caso pra olhar com calma).
export async function corrigirDuplicado(clienteId: number, empresaId: number, autorId: number) {
  const p = (await lerDuplicadosPendentes()).find((x) => x.clienteId === clienteId && x.empresaId === empresaId)
  if (!p) throw new Error('Esse caso não está mais na lista — atualize a tela.')
  const vendaRecente = await db.query.vendas.findFirst({
    where: and(eq(vendas.clienteId, p.antigoId), isNull(vendas.deletedAt), gte(vendas.dataFechamento, addDias(hojeBrString(), -DIAS))),
    columns: { id: true },
  })
  if (vendaRecente) throw new Error(`O cadastro ${p.razaoSocialAntigo} também tem venda recente — junte os dois pela tela de clientes duplicados.`)
  const bp: Bp = { CardCode: p.codigoSap, CardName: p.nomeSap, FederalTaxID: null }
  if (sapConfigurado()) {
    const cad = await comSessaoSap((sap) =>
      sap.get<{ FederalTaxID: string | null }>(`/BusinessPartners('${p.codigoSap}')?$select=FederalTaxID`)
    ).catch(() => null)
    bp.FederalTaxID = cad?.FederalTaxID ?? null
  }
  await transferirCodigo(p.clienteId, p.antigoId, p.empresaId, bp, autorId)
  await setConfig(CHAVE_PENDENTES, JSON.stringify((await lerDuplicadosPendentes()).filter((x) => x.clienteId !== clienteId)))
  // Puxa o pedido em segundo plano (o SAP pode levar uns segundos).
  ;(async () => {
    const peds = await comSessaoSap((sap) => pedidosDoCliente(sap, p.codigoSap, addDias(hojeBrString(), -DIAS - 5)))
    if (peds.length) await sincronizarVendasSap({ docEntries: peds.map((x) => x.DocEntry) })
  })().catch((err) => console.error('[vendas-sem-sap] erro puxando pedido', p.codigoSap, err instanceof Error ? err.message : err))
  return { ok: true }
}

export async function vendasSemSapAtivo(): Promise<boolean> {
  return sapConfigurado() && (await getConfigBool('sap_sync_ativo', false))
}
