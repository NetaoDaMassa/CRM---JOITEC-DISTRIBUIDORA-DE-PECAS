import { and, eq, inArray, isNotNull, isNull, lte, notInArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, expedicaoErros, expedicaoItens, expedicaoPausas, expedicaoPedidos, notifications, permissoesAdmin, sapPedidosPendentes, users } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from './dataBr.js'
import { getConfigTexto } from './configuracoes.js'
import { comSessaoSap, dataSap } from './sapServiceLayer.js'
import { vendedoresAutomacaoSap } from './sapSyncItens.js'
import { aprenderLocalizacoes } from './sapLocalizacoes.js'
import { atualizarKits, dadosDaLinha } from './sapKits.js'
import { prazoLimiteExpedicao } from './expedicaoPrazo.js'

// Fila do Controle do Estoque a partir do SAP (pedido do João, 2026-10-29).
// Jornada no SAP: cotação → financeiro libera → pedido → estoque gera o
// picking (lista "Liberado") → conferência (lista "Separado" = liberado pra
// faturar) → nota fiscal (lista "Fechado"). Aqui:
//   - toda lista de picking nova vira um registro em expedicao_pedidos, com
//     os itens (quantidade liberada de cada linha do pedido);
//   - o status da lista no SAP é atualizado a cada rodada;
//   - a NF-e (nota baseada no pedido) entra sozinha: nº (SequenceSerial) e
//     emissão. A NF sai enquanto embalam, então não muda a etapa — só
//     aparece no card (expedição sem NF = "aguardando NF").
// Empresa: filial 3 = Joitec (ou Odin Automação, pelo vendedor da nota),
// filial 4 = Odin Tubos. Odin Compressores (filial 1) tem o próprio
// controle (Ordens) e fica de fora.

const SLUG_POR_FILIAL: Record<number, string> = { 3: 'joitec', 4: 'odin-tubos' }
// Rodada normal olha os pickings dos últimos dias (lista nova é sempre de
// hoje; a margem pega quem ficou pra trás). `expedicao_sap_desde` força uma
// data inicial (carga de teste).
const DIAS_PARA_TRAS = 5

interface PickListSap {
  Absoluteentry: number
  Name: string | null
  PickDate: string
  Remarks: string | null
  Status: string
  PickListsLines: { OrderEntry: number; OrderRowID: number; BaseObjectType: number; ReleasedQuantity: number; PickedQuantity: number; PreviouslyReleasedQuantity: number }[]
}

interface PedidoSap {
  DocEntry: number
  DocNum: number
  DocDate: string
  DocTime: string | null
  CardCode: string
  CardName: string
  SalesPersonCode: number
  BPL_IDAssignedToInvoice: number
  Comments: string | null
  Address2: string | null
  DocumentLines: { LineNum: number; ItemCode: string | null; ItemDescription: string | null; WarehouseCode: string | null; TreeType?: string | null; UoMCode?: string | null; UnitsOfMeasurment?: number | null }[]
}

export interface SyncExpedicaoResultado {
  listasNoSap: number
  novas: number
  historicas: number
  nfs: number
  freteSap: number
  foraDoEscopo: number
  atrasados: number
  localizacoes: number
  descartadosSap: number
  retomados: number
}

// "2026-10-20" + "09:17:00" (horário de Brasília) → UTC no formato do SQLite.
function brParaUtc(data: string, hora: string | null): string {
  const d = new Date(`${data}T${(hora ?? '08:00:00').slice(0, 8)}-03:00`)
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

// Uma rodada por vez (2026-11-06): a lista de cards existentes é lida antes de
// entrar na fila do SAP. Rodada automática + botão "Sincronizar" ao mesmo tempo
// liam a lista sem o card e as duas criavam: pedido 9104 / picking 12180 ficou
// duplicado (cards #134 e #136, 17 s de diferença). Quem chega durante uma
// rodada recebe o resultado dela.
let rodadaEmAndamento: Promise<SyncExpedicaoResultado> | null = null

export function sincronizarExpedicaoSap(): Promise<SyncExpedicaoResultado> {
  rodadaEmAndamento ??= rodarSincronizacaoExpedicao().finally(() => {
    rodadaEmAndamento = null
  })
  return rodadaEmAndamento
}

async function rodarSincronizacaoExpedicao(): Promise<SyncExpedicaoResultado> {
  const hoje = hojeBrString()
  const desdeConfig = await getConfigTexto('expedicao_sap_desde')
  const limite = new Date(`${hoje}T12:00:00Z`)
  limite.setUTCDate(limite.getUTCDate() - DIAS_PARA_TRAS)
  const desdeBase = desdeConfig && desdeConfig < limite.toISOString().slice(0, 10) ? desdeConfig : limite.toISOString().slice(0, 10)
  // `expedicao_sap_inicio`: data a partir da qual a fila começa de verdade —
  // picking anterior nunca entra (João, 2026-11-02: "só vamos começar com os
  // pedidos de novembro").
  const inicio = await getConfigTexto('expedicao_sap_inicio')
  const desde = inicio && inicio > desdeBase ? inicio : desdeBase

  const lista = await db.query.empresas.findMany({ where: inArray(empresas.slug, ['joitec', 'odin-tubos', 'joitec-automacao']) })
  const empresaPorSlug = new Map(lista.map((e) => [e.slug, e.id]))
  const automacao = await vendedoresAutomacaoSap()

  // Card descartado não conta: se o picking dele ainda está no SAP, vira um
  // card novo (é o "descartar e recriar" do admin).
  const existentes = await db
    .select({
      id: expedicaoPedidos.id,
      pickListSap: expedicaoPedidos.pickListSap,
      orderEntriesSap: expedicaoPedidos.orderEntriesSap,
      etapa: expedicaoPedidos.etapa,
      historico: expedicaoPedidos.historico,
      inicioPrazo: expedicaoPedidos.inicioPrazo,
      alteracaoSap: expedicaoPedidos.alteracaoSap,
    })
    .from(expedicaoPedidos)
  const ativos = existentes.filter((e) => e.etapa !== 'descartado')
  const porLista = new Map(ativos.map((e) => [e.pickListSap, e]))
  // Todos os cards (inclusive descartados) por pedido do SAP — prazo do
  // primeiro picking e aviso de "picking novo pro mesmo pedido".
  const porPedido = new Map<number, typeof existentes>()
  for (const e of existentes) {
    if (e.historico) continue
    for (const o of e.orderEntriesSap.split(',').map(Number)) porPedido.set(o, [...(porPedido.get(o) ?? []), e])
  }

  const resultado: SyncExpedicaoResultado = { listasNoSap: 0, novas: 0, historicas: 0, nfs: 0, freteSap: 0, foraDoEscopo: 0, atrasados: 0, localizacoes: 0, descartadosSap: 0, retomados: 0 }

  await comSessaoSap(async (sap) => {
    const listas = await sap.getTodos<PickListSap>(
      `/PickLists?$filter=PickDate ge '${desde}'&$select=Absoluteentry,Name,PickDate,Remarks,Status,PickListsLines`,
      200
    )
    resultado.listasNoSap = listas.length

    const qtdLinha = (x: PickListSap['PickListsLines'][number]) => Math.max(x.ReleasedQuantity ?? 0, x.PickedQuantity ?? 0, x.PreviouslyReleasedQuantity ?? 0)
    // Picking descartado no SAP = fechado sem nada separado (o estoque refaz
    // e o SAP gera outro número pro mesmo pedido). Visto em 2026-11-04:
    // 12027 → 12045, 12084 → 12090… — o fechado normal tem PickedQuantity.
    const canceladoNoSap = (l: PickListSap) => l.Status === 'ps_Closed' && l.PickListsLines.every((x) => !x.PickedQuantity)
    const pickingNovoDoPedido = (l: PickListSap, ordens: Set<number>) =>
      listas
        .filter((x) => x.Absoluteentry > l.Absoluteentry && x.PickListsLines.some((y) => y.BaseObjectType === 17 && ordens.has(y.OrderEntry)))
        .reduce<number | null>((m, x) => (m == null || x.Absoluteentry > m ? x.Absoluteentry : m), null)

    // Quem já está na fila: status no SAP + o SAP mudou os itens do picking?
    const alterados: { id: number; resumo: string }[] = []
    for (const l of listas) {
      const e = porLista.get(l.Absoluteentry)
      if (!e) continue
      await db.update(expedicaoPedidos).set({ statusPickingSap: l.Status }).where(eq(expedicaoPedidos.id, e.id))
      // Descartado no SAP: o card sai do quadro sozinho quando o picking
      // novo do pedido já existe (ele entra abaixo, marcado como alterado).
      if (!e.historico && !['coletado', 'descartado', 'cancelado'].includes(e.etapa) && canceladoNoSap(l)) {
        const novo = pickingNovoDoPedido(l, new Set(e.orderEntriesSap.split(',').map(Number)))
        if (novo) {
          await db
            .update(expedicaoPedidos)
            .set({ etapa: 'descartado', etapaAntesCancelar: e.etapa, descartadoEm: agoraSqlite(), descartadoPor: null, motivoDescarte: `Picking ${l.Absoluteentry} descartado no SAP — refeito no picking ${novo}`, updatedAt: agoraSqlite() })
            .where(eq(expedicaoPedidos.id, e.id))
          e.etapa = 'descartado'
          resultado.descartadosSap++
        } else {
          alterados.push({ id: e.id, resumo: `Picking ${l.Absoluteentry} foi fechado no SAP sem nada separado (descartado?) e ainda não há picking novo pro pedido — confira no SAP.` })
        }
        continue
      }
      if (e.historico || ['coletado', 'descartado', 'cancelado'].includes(e.etapa) || l.Status === 'ps_Closed') continue
      const guardados = await db
        .select({ o: expedicaoItens.orderEntrySap, linha: expedicaoItens.linhaPedidoSap, q: expedicaoItens.quantidade, d: expedicaoItens.descricao })
        .from(expedicaoItens)
        .where(eq(expedicaoItens.expedicaoId, e.id))
      if (guardados.some((g) => g.o == null)) continue // card antigo, sem a linha do pedido guardada
      const chave = (o: number, ln: number) => `${o}:${ln}`
      const antes = new Map(guardados.map((g) => [chave(g.o!, g.linha!), g]))
      const agora = new Map(l.PickListsLines.filter((x) => x.BaseObjectType === 17 && qtdLinha(x) > 0).map((x) => [chave(x.OrderEntry, x.OrderRowID), qtdLinha(x)]))
      const novos = [...agora.keys()].filter((k) => !antes.has(k)).length
      const removidos = [...antes.values()].filter((g) => !agora.has(chave(g.o!, g.linha!)))
      const mudouQtd = [...antes.entries()].filter(([k, g]) => agora.has(k) && Math.abs(agora.get(k)! - g.q) > 0.0001)
      if (!novos && !removidos.length && !mudouQtd.length) continue
      const partes = [
        novos ? `+${novos} item(ns) novo(s)` : '',
        removidos.length ? `${removidos.length} item(ns) retirado(s) (${removidos.map((g) => g.d).join(', ').slice(0, 80)})` : '',
        mudouQtd.length ? `quantidade alterada: ${mudouQtd.map(([k, g]) => `${g.d.slice(0, 30)} ${g.q} → ${agora.get(k)}`).join('; ').slice(0, 160)}` : '',
      ].filter(Boolean)
      alterados.push({ id: e.id, resumo: `Picking ${l.Absoluteentry} alterado no SAP: ${partes.join(' · ')}` })
    }
    for (const a of alterados) {
      const e = ativos.find((x) => x.id === a.id)!
      if (e.alteracaoSap === a.resumo) continue
      await db.update(expedicaoPedidos).set({ alteradoSapEm: agoraSqlite(), alteracaoSap: a.resumo }).where(eq(expedicaoPedidos.id, a.id))
    }

    // Picking descartado no SAP nunca vira card; e card que o admin
    // descartou só é recriado se o picking dele ainda está aberto no SAP
    // (antes um fechado voltava pro quadro depois de descartado).
    const jaDescartados = new Set(existentes.filter((e) => ['descartado', 'cancelado'].includes(e.etapa)).map((e) => e.pickListSap))
    const novas = listas.filter(
      (l) =>
        !porLista.has(l.Absoluteentry) &&
        l.PickListsLines.some((x) => x.BaseObjectType === 17) &&
        !canceladoNoSap(l) &&
        !(l.Status === 'ps_Closed' && jaDescartados.has(l.Absoluteentry))
    )
    const entries = [...new Set(novas.flatMap((l) => l.PickListsLines.filter((x) => x.BaseObjectType === 17).map((x) => x.OrderEntry)))]
    const pedidos = new Map<number, PedidoSap>()
    for (let i = 0; i < entries.length; i += 15) {
      const filtro = entries.slice(i, i + 15).map((e) => `DocEntry eq ${e}`).join(' or ')
      const lote = await sap.getTodos<PedidoSap>(
        `/Orders?$filter=${filtro}&$select=DocEntry,DocNum,DocDate,DocTime,CardCode,CardName,SalesPersonCode,BPL_IDAssignedToInvoice,Comments,Address2,DocumentLines`,
        50
      )
      for (const p of lote) pedidos.set(p.DocEntry, p)
    }
    const vendedores = new Map(
      (await sap.getTodos<{ SalesEmployeeCode: number; SalesEmployeeName: string }>('/SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName')).map((v) => [
        v.SalesEmployeeCode,
        v.SalesEmployeeName,
      ])
    )

    for (const l of novas) {
      const linhas = l.PickListsLines.filter((x) => x.BaseObjectType === 17)
      const doPedido = [...new Set(linhas.map((x) => x.OrderEntry))].map((e) => pedidos.get(e)).filter((p): p is PedidoSap => !!p)
      const principal = doPedido[0]
      if (!principal) continue
      const filialSlug = SLUG_POR_FILIAL[principal.BPL_IDAssignedToInvoice]
      const slug = filialSlug === 'joitec' && automacao.has(principal.SalesPersonCode) ? 'joitec-automacao' : filialSlug
      const empresaId = slug ? empresaPorSlug.get(slug) : undefined
      if (!empresaId) {
        resultado.foraDoEscopo++
        continue
      }
      const itens = linhas.flatMap((x) => {
        const p = pedidos.get(x.OrderEntry)
        const linha = p?.DocumentLines.find((d) => d.LineNum === x.OrderRowID)
        const quantidade = qtdLinha(x)
        if (!linha || quantidade <= 0) return []
        return [{ pedidoSap: p!.DocNum, orderEntrySap: x.OrderEntry, linhaPedidoSap: x.OrderRowID, itemCodigo: linha.ItemCode, descricao: (linha.ItemDescription ?? '').trim() || linha.ItemCode || '(sem descrição)', deposito: linha.WarehouseCode, quantidade, ...dadosDaLinha(linha, quantidade) }]
      })
      const dataPicking = dataSap(l.PickDate)
      // Já fechado no SAP quando apareceu aqui (faturado antes da fila
      // existir): guarda, mas fora da fila e das métricas.
      // Cards anteriores do mesmo pedido (descartado ou ainda ativo com
      // picking antigo): o novo herda o início do prazo do primeiro.
      const anteriores = [...new Set(doPedido.flatMap((p) => porPedido.get(p.DocEntry) ?? []))]
      const historico = l.Status === 'ps_Closed' && anteriores.length === 0
      // Início do prazo: picking de hoje = agora (a rodada é de 5 em 5 min);
      // de dia anterior (carga inicial), o horário do pedido se for do mesmo
      // dia, senão 08:00.
      const inicioPrazoProprio =
        dataPicking === hoje ? agoraSqlite() : brParaUtc(dataPicking, dataSap(principal.DocDate) === dataPicking ? principal.DocTime : null)
      const inicioPrazo = anteriores.reduce((m, a) => (a.inicioPrazo < m ? a.inicioPrazo : m), inicioPrazoProprio)
      const substituiId = anteriores.length ? Math.max(...anteriores.map((a) => a.id)) : null
      const { marcas, mudancas } = await compararComAnterior(anteriores, new Set(doPedido.map((p) => p.DocEntry)), itens)
      const marcados = itens.map((i, n) => ({ ...i, ...marcas[n] }))
      const cotacao = /Cota[cç][õo]es de vendas ([\d, ]+)/i.exec(principal.Comments ?? '')?.[1]?.trim() ?? null

      await db.transaction(async (tx) => {
        const r = await tx.insert(expedicaoPedidos).values({
          empresaId,
          pickListSap: l.Absoluteentry,
          pedidosSap: doPedido.map((p) => p.DocNum).join(', '),
          orderEntriesSap: doPedido.map((p) => p.DocEntry).join(','),
          cotacaoSap: cotacao,
          clienteCodigo: principal.CardCode,
          clienteNome: principal.CardName,
          vendedorSap: vendedores.get(principal.SalesPersonCode) ?? null,
          observacaoSap: l.Remarks?.replace(/\r+/g, ' · ').trim() || null,
          enderecoEntrega: principal.Address2?.replace(/\r+/g, ' · ').replace(/ · BRASIL$/i, '').trim() || null,
          pickingGeradoPor: l.Name,
          dataPicking,
          statusPickingSap: l.Status,
          inicioPrazo,
          itens: itens.length,
          pecas: itens.reduce((s, i) => s + i.quantidade, 0),
          etapa: historico ? 'coletado' : 'separacao',
          historico,
          substituiId,
          mudancasSap: mudancas,
        })
        const id = Number(r.lastInsertRowid)
        // Card antigo do mesmo pedido ainda na fila: avisa pro admin descartar.
        for (const a of anteriores.filter((x) => !['descartado', 'coletado', 'cancelado'].includes(x.etapa))) {
          await tx
            .update(expedicaoPedidos)
            .set({ alteradoSapEm: agoraSqlite(), alteracaoSap: `O SAP gerou um picking novo (${l.Absoluteentry}) para este pedido — descarte este card; o novo já está na fila.` })
            .where(eq(expedicaoPedidos.id, a.id))
        }
        if (marcados.length) await tx.insert(expedicaoItens).values(marcados.map((i) => ({ ...i, expedicaoId: id })))
      })
      resultado.novas++
      if (historico) resultado.historicas++
    }

    // Card novo de picking refeito volta de onde o descartado parou: quem
    // separou/conferiu/embalou, horários, erros, volumes (João, 2026-11-04:
    // "manter os dados do que foi feito naquele pedido… na hora que gerar o
    // picking de novo, voltar").
    const intocados = await db
      .select({ id: expedicaoPedidos.id, orderEntriesSap: expedicaoPedidos.orderEntriesSap })
      .from(expedicaoPedidos)
      .where(
        and(
          isNotNull(expedicaoPedidos.substituiId),
          isNull(expedicaoPedidos.separacaoInicio),
          eq(expedicaoPedidos.etapa, 'separacao'),
          eq(expedicaoPedidos.historico, false)
        )
      )
    for (const c of intocados) {
      const ordens = c.orderEntriesSap.split(',').map(Number)
      const anterior = ordens
        .flatMap((o) => porPedido.get(o) ?? [])
        .filter((a) => a.id < c.id && a.etapa === 'descartado')
        .reduce<{ id: number } | null>((m, a) => (!m || a.id > m.id ? a : m), null)
      if (anterior && (await herdarTrabalho(anterior.id, c.id))) resultado.retomados++
    }

    // Cards que entraram antes disso existir (ou cujo anterior só foi
    // descartado depois): marca o que mudou em relação ao anterior.
    const semMarca = await db
      .select({ id: expedicaoPedidos.id, orderEntriesSap: expedicaoPedidos.orderEntriesSap })
      .from(expedicaoPedidos)
      .where(
        and(
          isNull(expedicaoPedidos.mudancasSap),
          isNotNull(expedicaoPedidos.substituiId),
          eq(expedicaoPedidos.historico, false),
          notInArray(expedicaoPedidos.etapa, ['coletado', 'cancelado', 'descartado'])
        )
      )
    for (const c of semMarca) {
      const ordens = new Set(c.orderEntriesSap.split(',').map(Number))
      const anteriores = [...ordens].flatMap((o) => (porPedido.get(o) ?? []).filter((a) => a.id < c.id))
      const itensCard = await db
        .select({ id: expedicaoItens.id, orderEntrySap: expedicaoItens.orderEntrySap, linhaPedidoSap: expedicaoItens.linhaPedidoSap, quantidade: expedicaoItens.quantidade })
        .from(expedicaoItens)
        .where(eq(expedicaoItens.expedicaoId, c.id))
      if (itensCard.some((i) => i.orderEntrySap == null)) continue
      const { marcas, mudancas } = await compararComAnterior(anteriores, ordens, itensCard as { id: number; orderEntrySap: number; linhaPedidoSap: number; quantidade: number }[])
      if (!mudancas) continue
      await db.transaction(async (tx) => {
        await tx.update(expedicaoPedidos).set({ mudancasSap: mudancas }).where(eq(expedicaoPedidos.id, c.id))
        for (const [n, i] of itensCard.entries()) if (marcas[n].mudancaSap) await tx.update(expedicaoItens).set(marcas[n]).where(eq(expedicaoItens.id, i.id))
      })
    }

    // NF-e de quem ainda não tem (nota de venda baseada no pedido da lista).
    const semNf = await db
      .select({ id: expedicaoPedidos.id, orderEntriesSap: expedicaoPedidos.orderEntriesSap, dataPicking: expedicaoPedidos.dataPicking })
      .from(expedicaoPedidos)
      .where(and(isNull(expedicaoPedidos.nfNumero), eq(expedicaoPedidos.historico, false), notInArray(expedicaoPedidos.etapa, ['cancelado', 'descartado'])))
    if (semNf.length) {
      // Nota sai no máximo alguns dias depois do picking; não volta mais que
      // 15 dias (pedido parado há semanas não pode puxar o mês inteiro).
      const limiteNf = new Date(`${hoje}T12:00:00Z`)
      limiteNf.setUTCDate(limiteNf.getUTCDate() - 15)
      const deData = semNf.reduce((m, p) => (p.dataPicking < m ? p.dataPicking : m), hoje)
      const deDataLimitada = deData < limiteNf.toISOString().slice(0, 10) ? limiteNf.toISOString().slice(0, 10) : deData
      const notas = await sap.getTodos<{
        SequenceSerial: number
        DocDate: string
        DocTime: string | null
        Cancelled: string
        CancelStatus: string
        DocumentLines: { BaseType: number; BaseEntry: number | null }[]
      }>(`/Invoices?$filter=DocDate ge '${deDataLimitada}' and Cancelled eq 'tNO'&$select=SequenceSerial,DocDate,DocTime,Cancelled,CancelStatus,DocumentLines`, 100)
      const nfPorPedido = new Map<number, { numero: string; emissao: string }>()
      for (const n of notas) {
        if (n.CancelStatus === 'csCancellation') continue
        for (const ln of n.DocumentLines) {
          if (ln.BaseType === 17 && ln.BaseEntry != null && !nfPorPedido.has(ln.BaseEntry)) {
            nfPorPedido.set(ln.BaseEntry, { numero: String(n.SequenceSerial), emissao: brParaUtc(dataSap(n.DocDate), n.DocTime) })
          }
        }
      }
      for (const p of semNf) {
        const nf = p.orderEntriesSap.split(',').map((e) => nfPorPedido.get(Number(e))).find(Boolean)
        if (!nf) continue
        await db
          .update(expedicaoPedidos)
          .set({ nfNumero: nf.numero, nfEmissao: nf.emissao, updatedAt: agoraSqlite() })
          .where(eq(expedicaoPedidos.id, p.id))
        resultado.nfs++
      }
    }

    // Volumes e transportadora lançados no pedido do SAP (aba Imposto →
    // Transporte: TaxExtension.PackQuantity/PackDescription/Carrier). A
    // embalagem já abre com isso (João, 2026-11-04). Relido a cada rodada
    // enquanto o card não foi coletado, porque o pedido pode mudar no SAP.
    const naFila = await db
      .select({
        id: expedicaoPedidos.id,
        orderEntriesSap: expedicaoPedidos.orderEntriesSap,
        volumesSap: expedicaoPedidos.volumesSap,
        especieSap: expedicaoPedidos.especieSap,
        transportadoraSap: expedicaoPedidos.transportadoraSap,
        transportadoraSapCodigo: expedicaoPedidos.transportadoraSapCodigo,
      })
      .from(expedicaoPedidos)
      .where(and(eq(expedicaoPedidos.historico, false), notInArray(expedicaoPedidos.etapa, ['coletado', 'cancelado', 'descartado'])))
    if (naFila.length) {
      type Frete = { DocEntry: number; TaxExtension: { Carrier: string | null; PackQuantity: number | null; PackDescription: string | null } | null }
      const entradas = [...new Set(naFila.flatMap((p) => p.orderEntriesSap.split(',').map(Number)))]
      const fretePorPedido = new Map<number, Frete['TaxExtension']>()
      for (let i = 0; i < entradas.length; i += 15) {
        const filtro = entradas.slice(i, i + 15).map((e) => `DocEntry eq ${e}`).join(' or ')
        for (const o of await sap.getTodos<Frete>(`/Orders?$filter=${filtro}&$select=DocEntry,TaxExtension`, 50)) fretePorPedido.set(o.DocEntry, o.TaxExtension)
      }
      const codigos = [...new Set([...fretePorPedido.values()].map((t) => t?.Carrier?.trim()).filter((c): c is string => !!c))]
      const nomeTransp = new Map<string, string>()
      for (let i = 0; i < codigos.length; i += 15) {
        const filtro = codigos.slice(i, i + 15).map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(' or ')
        for (const bp of await sap.getTodos<{ CardCode: string; CardName: string; CardForeignName: string | null }>(
          `/BusinessPartners?$filter=${filtro}&$select=CardCode,CardName,CardForeignName`,
          50
        ))
          nomeTransp.set(bp.CardCode, (bp.CardForeignName?.trim() || bp.CardName?.trim() || bp.CardCode).replace(/\s+/g, ' '))
      }
      for (const p of naFila) {
        // Card com mais de um pedido: soma os volumes; transportadora/espécie do primeiro que tiver.
        const fretes = p.orderEntriesSap.split(',').map((e) => fretePorPedido.get(Number(e))).filter((t): t is NonNullable<Frete['TaxExtension']> => !!t)
        if (!fretes.length) continue
        const vols = fretes.map((t) => t.PackQuantity).filter((v): v is number => v != null && v > 0)
        const codigo = fretes.map((t) => t.Carrier?.trim()).find(Boolean) ?? null
        const novo = {
          volumesSap: vols.length ? Math.round(vols.reduce((a, b) => a + b, 0)) : null,
          especieSap: fretes.map((t) => t.PackDescription?.trim()).find(Boolean) ?? null,
          transportadoraSapCodigo: codigo,
          transportadoraSap: codigo ? nomeTransp.get(codigo) ?? codigo : null,
        }
        if (
          novo.volumesSap === p.volumesSap &&
          novo.especieSap === p.especieSap &&
          novo.transportadoraSap === p.transportadoraSap &&
          novo.transportadoraSapCodigo === p.transportadoraSapCodigo
        )
          continue
        await db.update(expedicaoPedidos).set(novo).where(eq(expedicaoPedidos.id, p.id))
        resultado.freteSap++
      }
    }

    // Pedidos antes do picking (jornada do vendedor): aguardando o
    // financeiro (esboço com aprovação pendente) e pedido fechado sem
    // picking ainda. Foto inteira a cada rodada.
    type DocCab = { DocEntry: number; DocNum: number; DocDate: string; DocTime: string | null; CardCode: string; DocTotal: number; SalesPersonCode: number; BPL_IDAssignedToInvoice: number }
    const campos = '$select=DocEntry,DocNum,DocDate,DocTime,CardCode,DocTotal,SalesPersonCode,BPL_IDAssignedToInvoice'
    // Só os últimos 15 dias: no SAP há esboços e pedidos abertos parados há
    // meses (esquecidos), que não são "em andamento" pro vendedor.
    const recente = new Date(`${hoje}T12:00:00Z`)
    recente.setUTCDate(recente.getUTCDate() - 15)
    const desdePendente = recente.toISOString().slice(0, 10)
    const aprovacao = await sap.getTodos<DocCab>(
      `/Drafts?$filter=DocObjectCode eq 'oOrders' and DocumentStatus eq 'bost_Open' and AuthorizationStatus eq 'dasPending' and DocDate ge '${desdePendente}'&${campos}`
    )
    const abertos = await sap.getTodos<DocCab>(`/Orders?$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO' and DocDate ge '${desdePendente}'&${campos}`)
    const comPicking = new Set([
      ...listas.flatMap((l) => l.PickListsLines.map((x) => x.OrderEntry)),
      ...existentes.flatMap((x) => x.orderEntriesSap.split(',').map(Number)),
    ])
    const slugDe = (d: DocCab) => {
      const f = d.BPL_IDAssignedToInvoice === 1 ? 'odin-compressores' : SLUG_POR_FILIAL[d.BPL_IDAssignedToInvoice] ?? null
      return f === 'joitec' && automacao.has(d.SalesPersonCode) ? 'joitec-automacao' : f
    }
    const linha = (d: DocCab, tipo: 'aprovacao' | 'pedido') => ({
      codigoCliente: d.CardCode,
      tipo,
      numero: String(d.DocNum),
      data: brParaUtc(dataSap(d.DocDate), d.DocTime),
      valor: d.DocTotal,
      vendedorSap: vendedores.get(d.SalesPersonCode) ?? null,
      empresaSlug: slugDe(d),
    })
    const pendentes = [...aprovacao.map((d) => linha(d, 'aprovacao')), ...abertos.filter((d) => !comPicking.has(d.DocEntry)).map((d) => linha(d, 'pedido'))]
    await db.transaction(async (tx) => {
      await tx.delete(sapPedidosPendentes)
      for (let i = 0; i < pendentes.length; i += 200) await tx.insert(sapPedidosPendentes).values(pendentes.slice(i, i + 200))
    })

    // Kits: estrutura do SAP + linhas antigas sem quantidade do pedido.
    try {
      await atualizarKits(sap)
    } catch (err) {
      console.error('[sap-expedicao] kits:', err instanceof Error ? err.message : err)
    }

    // Endereço dos itens (ficha de separação): aprende com alguns pickings
    // já separados/fechados por rodada. Erro aqui não derruba a fila.
    try {
      const loc = await aprenderLocalizacoes(sap)
      resultado.localizacoes = loc.itensAtualizados
    } catch (err) {
      console.error('[sap-expedicao] localização dos itens:', err instanceof Error ? err.message : err)
    }
  })

  resultado.atrasados = await avisarAtrasados()
  return resultado
}

const ETAPAS_FILA = ['separacao', 'conferencia', 'embalagem', 'nf', 'agendamento', 'coleta'] as const
type EtapaFila = (typeof ETAPAS_FILA)[number]

// Copia pro card novo o trabalho feito no card descartado do mesmo pedido.
// Etapa = a que ele estava ao ser descartado (etapaAntesCancelar; card
// descartado antes disso: deduzida pelos horários). Conferência item a item
// só vale pra linha igual (mesma linha do pedido e mesma quantidade).
async function herdarTrabalho(anteriorId: number, novoId: number): Promise<boolean> {
  const [a] = await db.select().from(expedicaoPedidos).where(eq(expedicaoPedidos.id, anteriorId))
  if (!a || !a.separacaoInicio) return false
  const etapa: EtapaFila = ETAPAS_FILA.includes(a.etapaAntesCancelar as EtapaFila)
    ? (a.etapaAntesCancelar as EtapaFila)
    : a.agendadoEm
      ? 'coleta'
      : a.embalagemFim
        ? 'nf'
        : a.conferenciaFim
          ? 'embalagem'
          : a.separacaoFim
            ? 'conferencia'
            : 'separacao'
  const [velhos, novos] = await Promise.all([
    db.select().from(expedicaoItens).where(eq(expedicaoItens.expedicaoId, anteriorId)),
    db.select().from(expedicaoItens).where(eq(expedicaoItens.expedicaoId, novoId)),
  ])
  const antes = new Map(velhos.map((v) => [`${v.orderEntrySap}:${v.linhaPedidoSap}`, v]))
  await db.transaction(async (tx) => {
    await tx
      .update(expedicaoPedidos)
      .set({
        etapa,
        separacaoColaboradorId: a.separacaoColaboradorId,
        separacaoInicio: a.separacaoInicio,
        separacaoFim: a.separacaoFim,
        conferenciaColaboradorId: a.conferenciaColaboradorId,
        conferenciaInicio: a.conferenciaInicio,
        conferenciaFim: a.conferenciaFim,
        embalagemColaboradorId: a.embalagemColaboradorId,
        embalagemInicio: a.embalagemInicio,
        embalagemFim: a.embalagemFim,
        volumes: a.volumes,
        cabecotes: a.cabecotes,
        paletes: a.paletes,
        transportadora: a.transportadora,
        coletaAgendada: a.coletaAgendada,
        agendadoEm: a.agendadoEm,
        observacao: a.observacao,
        pausadoEm: a.pausadoEm,
        pausadoPor: a.pausadoPor,
        pausaMotivo: a.pausaMotivo,
        alertaAtrasoEm: a.alertaAtrasoEm,
        updatedAt: agoraSqlite(),
      })
      .where(eq(expedicaoPedidos.id, novoId))
    for (const n of novos) {
      const v = antes.get(`${n.orderEntrySap}:${n.linhaPedidoSap}`)
      if (!v || Math.abs(v.quantidade - n.quantidade) > 0.0001 || (!v.conferidoEm && !v.tentativasConferencia)) continue
      await tx
        .update(expedicaoItens)
        .set({ qtdConferida: v.qtdConferida, conferidoEm: v.conferidoEm, tentativasConferencia: v.tentativasConferencia })
        .where(eq(expedicaoItens.id, n.id))
    }
    // Erros registrados vão junto (contam uma vez só no desempenho).
    await tx.update(expedicaoErros).set({ expedicaoId: novoId }).where(eq(expedicaoErros.expedicaoId, anteriorId))
    await tx.update(expedicaoPausas).set({ expedicaoId: novoId }).where(eq(expedicaoPausas.expedicaoId, anteriorId))
  })
  return true
}

// Compara os itens de um picking novo com o card anterior do mesmo pedido
// (o mais novo que foi descartado ou ainda está na fila; coletado = outra
// entrega, não é alteração). Chave = linha do pedido no SAP.
async function compararComAnterior(
  anteriores: { id: number; etapa: string; pickListSap: number }[],
  ordens: Set<number>,
  itens: { orderEntrySap: number; linhaPedidoSap: number; quantidade: number }[]
): Promise<{ marcas: { mudancaSap: 'novo' | 'qtd' | null; qtdAnterior: number | null }[]; mudancas: string | null }> {
  const marcas = itens.map(() => ({ mudancaSap: null as 'novo' | 'qtd' | null, qtdAnterior: null as number | null }))
  const validos = anteriores.filter((a) => !['coletado', 'cancelado'].includes(a.etapa))
  if (!validos.length) return { marcas, mudancas: null }
  const ultimo = validos.reduce((m, a) => (a.id > m.id ? a : m))
  const velhos = (
    await db
      .select({ o: expedicaoItens.orderEntrySap, linha: expedicaoItens.linhaPedidoSap, q: expedicaoItens.quantidade, d: expedicaoItens.descricao })
      .from(expedicaoItens)
      .where(eq(expedicaoItens.expedicaoId, ultimo.id))
  ).filter((v) => v.o == null || ordens.has(v.o))
  if (!velhos.length || velhos.some((v) => v.o == null)) return { marcas, mudancas: null }
  const antes = new Map(velhos.map((v) => [`${v.o}:${v.linha}`, v]))
  itens.forEach((i, n) => {
    const v = antes.get(`${i.orderEntrySap}:${i.linhaPedidoSap}`)
    if (!v) marcas[n].mudancaSap = 'novo'
    else if (Math.abs(v.q - i.quantidade) > 0.0001) marcas[n] = { mudancaSap: 'qtd', qtdAnterior: v.q }
  })
  const agora = new Set(itens.map((i) => `${i.orderEntrySap}:${i.linhaPedidoSap}`))
  const mudancas = JSON.stringify({
    pickingAnterior: ultimo.pickListSap,
    novos: marcas.filter((m) => m.mudancaSap === 'novo').length,
    alterados: marcas.filter((m) => m.mudancaSap === 'qtd').length,
    removidos: [...antes.entries()].filter(([k]) => !agora.has(k)).map(([, v]) => ({ descricao: v.d, quantidade: v.q })),
  })
  return { marcas, mudancas }
}

// Passou das 48h ÚTEIS do picking sem coleta (fim de semana/feriado não contam): avisa (uma vez por pedido) quem tem
// o Controle do Estoque naquela empresa e o vendedor do cliente.
async function avisarAtrasados(): Promise<number> {
  const limite = new Date(Date.now() - 48 * 3600_000).toISOString().replace('T', ' ').slice(0, 19)
  const atrasados = await db
    .select()
    .from(expedicaoPedidos)
    .where(
      and(
        eq(expedicaoPedidos.historico, false),
        notInArray(expedicaoPedidos.etapa, ['coletado', 'cancelado', 'descartado']),
        isNull(expedicaoPedidos.alertaAtrasoEm),
        // 48h corridas é o mínimo; o prazo de verdade (só dia útil) é conferido abaixo.
        lte(expedicaoPedidos.inicioPrazo, limite)
      )
    )
    .then((l) => l.filter((p) => prazoLimiteExpedicao(p.inicioPrazo) <= Date.now()))
  for (const p of atrasados) {
    const estoque = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(permissoesAdmin, eq(permissoesAdmin.userId, users.id))
      .where(and(eq(users.empresaId, p.empresaId), eq(users.isActive, true), eq(permissoesAdmin.feature, 'controle_estoque')))
    const cliente = p.clienteCodigo
      ? await db.query.clientes.findFirst({
          where: and(eq(clientes.empresaId, p.empresaId), eq(clientes.codigo, p.clienteCodigo), isNull(clientes.deletedAt)),
          columns: { id: true, vendedorAtualId: true },
        })
      : undefined
    const destinatarios = new Set([...estoque.map((u) => u.id), ...(cliente?.vendedorAtualId ? [cliente.vendedorAtualId] : [])])
    for (const userId of destinatarios) {
      await db.insert(notifications).values({
        vendedorId: userId,
        clienteId: cliente?.id ?? null,
        type: 'expedicao_atraso',
        title: 'Pedido atrasado na expedição',
        message: `Pedido ${p.pedidosSap} (${p.clienteNome ?? ''}) passou das 48h úteis desde o picking e ainda não foi coletado.`,
      })
    }
    await db.update(expedicaoPedidos).set({ alertaAtrasoEm: agoraSqlite() }).where(eq(expedicaoPedidos.id, p.id))
  }
  return atrasados.length
}
