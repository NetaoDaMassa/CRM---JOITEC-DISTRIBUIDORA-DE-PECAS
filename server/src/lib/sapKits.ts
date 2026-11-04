import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { expedicaoItens, expedicaoKits, expedicaoPedidos } from '../db/schema.js'
import { agoraSqlite } from './dataBr.js'
import type { SapSessao } from './sapServiceLayer.js'

// Kits na Expedição (pedido do João/André, 2026-11-04).
//
// No SAP o kit é uma estrutura de produção (ProductTrees, ex.: KIT
// AMORTECEDOR C/ 4 PCS → 4 canecos, 4 bases, 4 parafusos…). A entrada no
// estoque é por peça e a saída é por KIT. O picking manda a quantidade em
// unidade de estoque (pedido de 5 "PC4" vem como 20), o que confundia a
// ficha: aqui guardamos também a quantidade/unidade do pedido e a
// estrutura de cada kit, e o estoque escolhe por kit se separa o kit (uma
// linha) ou as peças.

export interface ComponenteKit {
  codigo: string
  descricao: string
  quantidade: number
  deposito: string | null
}

type LinhaPedido = { TreeType?: string | null; UoMCode?: string | null; UnitsOfMeasurment?: number | null }

// Campos do item da Expedição que vêm da linha do pedido. `quantidade` é a
// do picking (unidade de estoque); dividida pelas unidades por embalagem do
// pedido (PC4 = 4) dá a quantidade vendida — certo também em picking parcial.
export function dadosDaLinha(l: LinhaPedido, quantidade: number): { ehKit: boolean; qtdVenda: number; unidadeVenda: string | null } {
  const unidade = l.UoMCode?.trim()
  const porUnidade = l.UnitsOfMeasurment && l.UnitsOfMeasurment > 0 ? l.UnitsOfMeasurment : 1
  return {
    ehKit: l.TreeType === 'iProductionTree',
    qtdVenda: Math.round((quantidade / porUnidade) * 1000) / 1000,
    unidadeVenda: unidade && unidade !== 'Manual' ? unidade : null,
  }
}

const REFAZER_ESTRUTURAS_HORAS = 12

export async function atualizarKits(sap: SapSessao): Promise<{ linhas: number; kits: number }> {
  // 1) Itens dos cards em andamento que entraram antes disso existir (sem a
  //    quantidade do pedido): lê a linha do pedido no SAP.
  const semVenda = await db
    .select({ id: expedicaoItens.id, o: expedicaoItens.orderEntrySap, ln: expedicaoItens.linhaPedidoSap, q: expedicaoItens.quantidade })
    .from(expedicaoItens)
    .innerJoin(expedicaoPedidos, eq(expedicaoPedidos.id, expedicaoItens.expedicaoId))
    .where(
      and(
        isNull(expedicaoItens.qtdVenda),
        isNotNull(expedicaoItens.orderEntrySap),
        eq(expedicaoPedidos.historico, false),
        notInArray(expedicaoPedidos.etapa, ['coletado', 'cancelado', 'descartado'])
      )
    )
  let linhas = 0
  if (semVenda.length) {
    const entries = [...new Set(semVenda.map((i) => i.o!))]
    const porLinha = new Map<string, LinhaPedido>()
    for (let i = 0; i < entries.length; i += 15) {
      const filtro = entries.slice(i, i + 15).map((e) => `DocEntry eq ${e}`).join(' or ')
      for (const p of await sap.getTodos<{ DocEntry: number; DocumentLines: (LinhaPedido & { LineNum: number })[] }>(
        `/Orders?$filter=${filtro}&$select=DocEntry,DocumentLines`,
        50
      ))
        for (const l of p.DocumentLines) porLinha.set(`${p.DocEntry}:${l.LineNum}`, l)
    }
    for (const it of semVenda) {
      const l = porLinha.get(`${it.o}:${it.ln}`)
      if (!l) continue
      await db.update(expedicaoItens).set(dadosDaLinha(l, it.q)).where(eq(expedicaoItens.id, it.id))
      linhas++
    }
  }

  // 2) Estruturas (são poucas — ~34): relê todas a cada 12 h, ou na hora se
  //    apareceu kit que ainda não conhecemos. O modo escolhido fica.
  const conhecidos = await db.select({ codigo: expedicaoKits.itemCodigo, em: expedicaoKits.atualizadoSapEm }).from(expedicaoKits)
  const kitsNaFila = await db
    .selectDistinct({ codigo: expedicaoItens.itemCodigo })
    .from(expedicaoItens)
    .innerJoin(expedicaoPedidos, eq(expedicaoPedidos.id, expedicaoItens.expedicaoId))
    .where(and(eq(expedicaoItens.ehKit, true), eq(expedicaoPedidos.historico, false), notInArray(expedicaoPedidos.etapa, ['coletado', 'cancelado', 'descartado'])))
  const conhecido = new Set(conhecidos.map((k) => k.codigo))
  const limite = new Date(Date.now() - REFAZER_ESTRUTURAS_HORAS * 3600_000).toISOString().replace('T', ' ').slice(0, 19)
  const velho = !conhecidos.length || conhecidos.some((k) => !k.em || k.em < limite)
  const novo = kitsNaFila.some((k) => k.codigo && !conhecido.has(k.codigo))
  if (!velho && !novo) return { linhas, kits: 0 }

  const arvores = await sap.getTodos<{
    TreeCode: string
    Quantity: number | null
    ProductDescription: string | null
    ProductTreeLines: { ItemCode: string; ItemName?: string | null; Quantity: number; Warehouse: string | null; ItemType?: string }[]
  }>(`/ProductTrees?$select=TreeCode,Quantity,ProductDescription,ProductTreeLines`, 100)
  const agora = agoraSqlite()
  for (const a of arvores) {
    const componentes: ComponenteKit[] = (a.ProductTreeLines ?? [])
      .filter((l) => !l.ItemType || l.ItemType === 'pit_Item')
      .map((l) => ({ codigo: l.ItemCode, descricao: (l.ItemName ?? '').trim() || l.ItemCode, quantidade: l.Quantity, deposito: l.Warehouse }))
    const valores = {
      descricao: (a.ProductDescription ?? '').trim() || a.TreeCode,
      quantidadeBase: a.Quantity && a.Quantity > 0 ? a.Quantity : 1,
      componentes: JSON.stringify(componentes),
      atualizadoSapEm: agora,
    }
    await db
      .insert(expedicaoKits)
      .values({ itemCodigo: a.TreeCode, ...valores })
      .onConflictDoUpdate({ target: expedicaoKits.itemCodigo, set: valores })
  }
  return { linhas, kits: arvores.length }
}

// Kits dos itens informados, com o modo e as peças já calculadas pra
// quantidade de kits de cada linha.
export async function kitsDosItens<T extends { itemCodigo: string | null; ehKit: boolean; qtdVenda: number | null; quantidade: number; deposito: string | null }>(
  itens: T[]
): Promise<(T & { kit: null | { modo: 'kit' | 'peca'; kits: number; pecas: (ComponenteKit & { total: number; localizacao: string | null })[] } })[]> {
  const codigos = [...new Set(itens.filter((i) => i.ehKit && i.itemCodigo).map((i) => i.itemCodigo!))]
  if (!codigos.length) return itens.map((i) => ({ ...i, kit: null }))
  const kits = new Map((await db.select().from(expedicaoKits).where(inArray(expedicaoKits.itemCodigo, codigos))).map((k) => [k.itemCodigo, k]))
  const todasPecas = [...kits.values()].flatMap((k) => (JSON.parse(k.componentes) as ComponenteKit[]).map((c) => c.codigo))
  const locs = todasPecas.length
    ? await db.all<{ deposito: string; item_codigo: string; localizacao: string }>(
        sql`SELECT deposito, item_codigo, localizacao FROM sap_item_localizacao WHERE item_codigo IN (${sql.join(
          [...new Set(todasPecas)].map((c) => sql`${c}`),
          sql`, `
        )})`
      )
    : []
  const loc = new Map(locs.map((l) => [`${l.deposito}|${l.item_codigo}`, l.localizacao]))
  return itens.map((i) => {
    const k = i.ehKit && i.itemCodigo ? kits.get(i.itemCodigo) : undefined
    if (!k) return { ...i, kit: null }
    const qtdKits = i.qtdVenda ?? i.quantidade
    const pecas = (JSON.parse(k.componentes) as ComponenteKit[]).map((c) => {
      const dep = c.deposito ?? i.deposito
      return {
        ...c,
        total: Math.round(((c.quantidade / k.quantidadeBase) * qtdKits) * 1000) / 1000,
        localizacao: (dep && loc.get(`${dep}|${c.codigo}`)) || (i.deposito && loc.get(`${i.deposito}|${c.codigo}`)) || null,
      }
    })
    return { ...i, kit: { modo: k.modo, kits: qtdKits, pecas } }
  })
}
