import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, funilMensal, itensPedido, users, vendas } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from './dataBr.js'
import { getConfigTexto } from './configuracoes.js'
import { registrarAuditoria } from './auditoria.js'
import { comSessaoSap, dataSap } from './sapServiceLayer.js'
import { vendedoresAutomacaoSap } from './sapSyncItens.js'
import { limparCodigo, semZerosEsquerda } from './importSapHistorico.js'

// Venda automática a partir do pedido do SAP (pedido do João, 2026-10-30).
// O comparativo de 29/10 mostrou SAP R$ 173 mil × CRM R$ 85 mil na Joitec:
// os vendedores fazem o pedido no SAP e não registram no Kanban. Regras
// combinadas com o João:
//   - só pedidos a partir de `sap_vendas_auto_desde` ("daqui pra frente");
//   - Joitec, Odin Tubos e Odin Automação (Odin Compressores tem Pedidos);
//   - a venda conta pro vendedor DONO DO CLIENTE no CRM (o do card do mês);
//   - venda pra empresa do grupo (Comprefer etc.) não entra.
// Contra duplicidade:
//   1. vendas.pedidoSapEntry guarda o pedido — nunca cria duas vezes;
//   2. venda registrada na mão (mesmo cliente, ±3 dias, valor ±5% ou mesmo
//      nº de pedido) é LIGADA ao pedido em vez de criar outra;
//   3. registro manual depois é bloqueado (ver vendaJaVeioDoSap);
//   4. pedido cancelado no SAP: a venda criada por aqui sai; valor alterado:
//      atualiza (venda ligada a registro manual nunca é apagada).

const SLUG_POR_FILIAL: Record<number, string> = { 3: 'joitec', 4: 'odin-tubos' }
const GRUPO_PADRAO = 'C003770,C002707,C001284,C001270'
const DIAS_PARA_TRAS = 7

interface PedidoSap {
  DocEntry: number
  DocNum: number
  DocDate: string
  DocTime: string | null
  CardCode: string
  CardName: string
  DocTotal: number
  SalesPersonCode: number
  BPL_IDAssignedToInvoice: number
  PaymentGroupCode: number | null
  Cancelled: string
  DocumentLines: { ItemCode: string | null; ItemDescription: string | null; Quantity: number; Price: number; LineTotal: number }[]
}

export interface SyncVendasResultado {
  desde: string
  pedidosNoSap: number
  criadas: number
  ligadas: number
  jaExistiam: number
  atualizadas: number
  canceladas: number
  faturadas: number
  semCliente: { pedido: number; codigo: string; nome: string; empresa: string }[]
  semVendedor: { pedido: number; cliente: string }[]
}

function brParaUtc(data: string, hora: string | null): string {
  return new Date(`${data}T${(hora ?? '12:00:00').slice(0, 8)}-03:00`).toISOString().replace('T', ' ').slice(0, 19)
}

// Usado pelo registro manual (funil.moverEtapa / vendas.registrar): já existe
// venda vinda do SAP pra esse cliente nesses dias com valor parecido?
export async function vendaJaVeioDoSap(clienteId: number, valor: number): Promise<{ numeroPedido: string | null } | null> {
  const de = new Date(Date.now() - 5 * 86400_000).toISOString().replace('T', ' ').slice(0, 19)
  const lista = await db
    .select({ numeroPedido: vendas.numeroPedido, valor: vendas.valorFechado })
    .from(vendas)
    .where(and(eq(vendas.clienteId, clienteId), eq(vendas.criadaPeloSap, true), isNull(vendas.deletedAt), gte(vendas.dataFechamento, de)))
  const igual = lista.find((v) => Math.abs(v.valor - valor) <= Math.max(1, valor * 0.05))
  return igual ? { numeroPedido: igual.numeroPedido } : null
}

export async function sincronizarVendasSap(): Promise<SyncVendasResultado | null> {
  const desdeConfig = await getConfigTexto('sap_vendas_auto_desde')
  if (!desdeConfig) return null
  const hoje = hojeBrString()
  const janela = new Date(`${hoje}T12:00:00Z`)
  janela.setUTCDate(janela.getUTCDate() - DIAS_PARA_TRAS)
  const desde = desdeConfig > janela.toISOString().slice(0, 10) ? desdeConfig : janela.toISOString().slice(0, 10)

  const grupo = new Set(((await getConfigTexto('sap_receber_ignorar_clientes')) ?? GRUPO_PADRAO).split(',').map((s) => s.trim().toUpperCase()))
  const automacao = await vendedoresAutomacaoSap()
  const lista = await db.query.empresas.findMany({ where: inArray(empresas.slug, ['joitec', 'odin-tubos', 'joitec-automacao']) })
  const empresaPorSlug = new Map(lista.map((e) => [e.slug, e]))
  const autor = await db.query.users.findFirst({ where: eq(users.superAdmin, true), columns: { id: true } })

  const { pedidos, condicoes, notas } = await comSessaoSap(async (sap) => ({
    pedidos: await sap.getTodos<PedidoSap>(
      `/Orders?$filter=DocDate ge '${desde}' and (BPL_IDAssignedToInvoice eq 3 or BPL_IDAssignedToInvoice eq 4)` +
        '&$select=DocEntry,DocNum,DocDate,DocTime,CardCode,CardName,DocTotal,SalesPersonCode,BPL_IDAssignedToInvoice,PaymentGroupCode,Cancelled,DocumentLines',
      100
    ),
    condicoes: new Map(
      (await sap.getTodos<{ GroupNumber: number; PaymentTermsGroupName: string }>('/PaymentTermsTypes?$select=GroupNumber,PaymentTermsGroupName')).map((c) => [
        c.GroupNumber,
        c.PaymentTermsGroupName,
      ])
    ),
    // Notas dos últimos dias pra marcar a venda como faturada (nº da NF-e).
    notas: await sap.getTodos<{ SequenceSerial: number | null; DocNum: number; Cancelled: string; CancelStatus: string; DocumentLines: { BaseType: number; BaseEntry: number | null }[] }>(
      `/Invoices?$filter=DocDate ge '${desde}' and Cancelled eq 'tNO'&$select=SequenceSerial,DocNum,Cancelled,CancelStatus,DocumentLines`,
      100
    ),
  }))

  const r: SyncVendasResultado = { desde, pedidosNoSap: pedidos.length, criadas: 0, ligadas: 0, jaExistiam: 0, atualizadas: 0, canceladas: 0, faturadas: 0, semCliente: [], semVendedor: [] }

  const entries = pedidos.map((p) => p.DocEntry)
  const existentes = entries.length
    ? await db.select().from(vendas).where(and(inArray(vendas.pedidoSapEntry, entries), isNull(vendas.deletedAt)))
    : []
  const porEntry = new Map(existentes.map((v) => [v.pedidoSapEntry!, v]))

  type Cli = { id: number; codigo: string; codigoAntigo: string | null; razaoSocial: string; vendedorAtualId: number | null }
  const cacheClientes = new Map<number, { exato: Map<string, Cli>; semZero: Map<string, Cli> }>()
  const acharCliente = async (empresaId: number, codigo: string): Promise<Cli | undefined> => {
    let m = cacheClientes.get(empresaId)
    if (!m) {
      const lista = await db.query.clientes.findMany({
        where: and(eq(clientes.empresaId, empresaId), isNull(clientes.deletedAt)),
        columns: { id: true, codigo: true, codigoAntigo: true, razaoSocial: true, vendedorAtualId: true },
      })
      m = { exato: new Map(), semZero: new Map() }
      for (const c of lista) {
        for (const cod of [c.codigo, c.codigoAntigo]) {
          if (!cod) continue
          const l = limparCodigo(cod)
          if (!m.exato.has(l)) m.exato.set(l, c)
          if (!m.semZero.has(semZerosEsquerda(l))) m.semZero.set(semZerosEsquerda(l), c)
        }
      }
      cacheClientes.set(empresaId, m)
    }
    return m.exato.get(codigo) ?? m.semZero.get(semZerosEsquerda(codigo))
  }

  for (const p of pedidos) {
    if (grupo.has(p.CardCode.toUpperCase())) continue
    const ja = porEntry.get(p.DocEntry)

    // Pedido cancelado no SAP: some a venda que o CRM criou sozinho.
    if (p.Cancelled === 'tYES') {
      if (ja?.criadaPeloSap) {
        await db.update(vendas).set({ deletedAt: agoraSqlite() }).where(eq(vendas.id, ja.id))
        await registrarAuditoria({ tabela: 'vendas', registroId: ja.id, acao: 'excluir', valorNovo: `pedido ${p.DocNum} cancelado no SAP`, alteradoPor: autor?.id ?? null })
        r.canceladas++
      }
      continue
    }
    if (ja) {
      if (ja.criadaPeloSap && Math.abs(ja.valorFechado - p.DocTotal) > 0.009) {
        await db.update(vendas).set({ valorFechado: p.DocTotal }).where(eq(vendas.id, ja.id))
        r.atualizadas++
      } else r.jaExistiam++
      continue
    }

    const filial = SLUG_POR_FILIAL[p.BPL_IDAssignedToInvoice]
    const slug = filial === 'joitec' && automacao.has(p.SalesPersonCode) ? 'joitec-automacao' : filial
    const empresa = slug ? empresaPorSlug.get(slug) : undefined
    if (!empresa) continue

    const codigo = limparCodigo(p.CardCode)
    const cliente = await acharCliente(empresa.id, codigo)
    if (!cliente) {
      r.semCliente.push({ pedido: p.DocNum, codigo, nome: p.CardName, empresa: empresa.nome })
      continue
    }

    const dia = dataSap(p.DocDate)
    const dataFechamento = brParaUtc(dia, p.DocTime)
    const mesReferencia = `${dia.slice(0, 7)}-01`

    // Venda já registrada na mão? Liga em vez de criar outra.
    const de = brParaUtc(addDias(dia, -3), '00:00:00')
    const ate = brParaUtc(addDias(dia, 3), '23:59:59')
    const manuais = await db
      .select()
      .from(vendas)
      .where(and(eq(vendas.clienteId, cliente.id), isNull(vendas.deletedAt), isNull(vendas.pedidoSapEntry), gte(vendas.dataFechamento, de), lte(vendas.dataFechamento, ate)))
    // Mesmo pedido: nº do pedido igual; senão valor até 15% diferente; senão,
    // se o cliente tem UMA venda manual e UM pedido do SAP nesses dias, é a
    // mesma venda com valor digitado diferente (ex.: Retema 2.789 × 2.637).
    const pedidosDoClienteNaJanela = pedidos.filter(
      (o) => o.Cancelled !== 'tYES' && o.CardCode === p.CardCode && dataSap(o.DocDate) >= addDias(dia, -3) && dataSap(o.DocDate) <= addDias(dia, 3)
    ).length
    const manual =
      manuais.find((v) => v.numeroPedido && v.numeroPedido.replace(/\D/g, '') === String(p.DocNum)) ??
      [...manuais].sort((a, b) => Math.abs(a.valorFechado - p.DocTotal) - Math.abs(b.valorFechado - p.DocTotal)).find((v) => Math.abs(v.valorFechado - p.DocTotal) <= p.DocTotal * 0.15) ??
      (manuais.length === 1 && pedidosDoClienteNaJanela === 1 ? manuais[0] : undefined)
    if (manual) {
      // O valor oficial é o do pedido do SAP — corrige o digitado (fica na auditoria).
      if (Math.abs(manual.valorFechado - p.DocTotal) > 0.009) {
        await registrarAuditoria({
          tabela: 'vendas',
          registroId: manual.id,
          acao: 'editar',
          campo: 'valor_fechado',
          valorAnterior: String(manual.valorFechado),
          valorNovo: `${p.DocTotal} (pedido ${p.DocNum} do SAP)`,
          alteradoPor: autor?.id ?? null,
        })
      }
      await db
        .update(vendas)
        .set({ pedidoSapEntry: p.DocEntry, numeroPedido: manual.numeroPedido ?? String(p.DocNum), valorFechado: p.DocTotal })
        .where(eq(vendas.id, manual.id))
      const temItens = await db.select({ id: itensPedido.id }).from(itensPedido).where(and(eq(itensPedido.vendaId, manual.id), isNull(itensPedido.deletedAt))).limit(1)
      if (!temItens.length) await gravarItens(manual.id, cliente.id, p)
      r.ligadas++
      continue
    }

    // Card do cliente no mês: o que já está Fechado; senão o mais recente.
    const cards = await db
      .select()
      .from(funilMensal)
      .where(and(eq(funilMensal.clienteId, cliente.id), eq(funilMensal.mesReferencia, mesReferencia), isNull(funilMensal.deletedAt)))
      .orderBy(desc(funilMensal.id))
    let card = cards.find((c) => c.etapa === 'fechado') ?? cards[0]
    if (!card) {
      if (!cliente.vendedorAtualId) {
        r.semVendedor.push({ pedido: p.DocNum, cliente: cliente.razaoSocial })
        continue
      }
      const novo = await db.insert(funilMensal).values({ clienteId: cliente.id, vendedorId: cliente.vendedorAtualId, mesReferencia, etapa: 'fechado', dataEntradaEtapa: agoraSqlite() })
      card = (await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, Number(novo.lastInsertRowid)) }))!
    } else if (card.etapa !== 'fechado') {
      await db
        .update(funilMensal)
        .set({ etapa: 'fechado', dataEntradaEtapa: agoraSqlite(), updatedAt: agoraSqlite(), versao: sql`${funilMensal.versao} + 1` })
        .where(eq(funilMensal.id, card.id))
      await registrarAuditoria({
        tabela: 'funil_mensal',
        registroId: card.id,
        acao: 'mudar_etapa',
        campo: 'etapa',
        valorAnterior: card.etapa,
        valorNovo: `fechado (pedido ${p.DocNum} do SAP)`,
        alteradoPor: autor?.id ?? null,
      })
    }

    const res = await db.insert(vendas).values({
      funilMensalId: card.id,
      clienteId: cliente.id,
      vendedorId: card.vendedorId,
      mesReferencia,
      valorFechado: p.DocTotal,
      condicaoPagamento: (p.PaymentGroupCode != null ? condicoes.get(p.PaymentGroupCode) : null) ?? null,
      numeroPedido: String(p.DocNum),
      dataFechamento,
      pedidoSapEntry: p.DocEntry,
      criadaPeloSap: true,
    })
    const vendaId = Number(res.lastInsertRowid)
    await gravarItens(vendaId, cliente.id, p)
    await db
      .update(clientes)
      .set({ dataUltimaCompra: sql`max(coalesce(${clientes.dataUltimaCompra}, ''), ${dataFechamento})` })
      .where(eq(clientes.id, cliente.id))
    await registrarAuditoria({ tabela: 'vendas', registroId: vendaId, acao: 'criar', valorNovo: `pedido ${p.DocNum} do SAP`, alteradoPor: autor?.id ?? null })
    r.criadas++
  }
  // Pedido que já virou nota: a venda fica faturada com o nº da NF-e.
  const nfPorPedido = new Map<number, string>()
  for (const n of notas) {
    if (n.CancelStatus === 'csCancellation') continue
    for (const l of n.DocumentLines) if (l.BaseType === 17 && l.BaseEntry != null && !nfPorPedido.has(l.BaseEntry)) nfPorPedido.set(l.BaseEntry, String(n.SequenceSerial || n.DocNum))
  }
  if (nfPorPedido.size) {
    const semNf = await db
      .select({ id: vendas.id, entry: vendas.pedidoSapEntry })
      .from(vendas)
      .where(and(inArray(vendas.pedidoSapEntry, [...nfPorPedido.keys()]), isNull(vendas.numeroNotaFiscal), isNull(vendas.deletedAt)))
    for (const v of semNf) {
      await db.update(vendas).set({ numeroNotaFiscal: nfPorPedido.get(v.entry!)!, tipoComprovante: 'nota_fiscal', faturado: true }).where(eq(vendas.id, v.id))
      r.faturadas++
    }
  }
  return r
}

async function gravarItens(vendaId: number, clienteId: number, p: PedidoSap) {
  const linhas = p.DocumentLines.filter((l) => l.Quantity > 0)
  if (!linhas.length) return
  await db.insert(itensPedido).values(
    linhas.map((l) => ({
      vendaId,
      clienteId,
      descricao: (l.ItemDescription ?? '').trim() || l.ItemCode || '(sem descrição)',
      quantidade: l.Quantity,
      valorUnitario: l.Price,
      valorTotal: l.LineTotal,
    }))
  )
}

function addDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
