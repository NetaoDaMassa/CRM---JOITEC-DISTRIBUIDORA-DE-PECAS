import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sapItemLocalizacao, sapLocalizacaoPicksLidos } from '../db/schema.js'
import { getConfigTexto } from './configuracoes.js'
import type { SapSessao } from './sapServiceLayer.js'

// Endereço dos itens no depósito, aprendido dos pickings do SAP (pedido do
// João, 2026-11-04: "ficha de separação não puxa a localização").
//
// No SAP os endereços existem (2-REV-PP02-14-01, 2-REV-A01-27…), mas o item
// não tem endereço padrão no cadastro. A posição só fica gravada quando o
// picking é separado/fechado: PickListsLines[].DocumentLinesBinAllocations —
// e isso só vem no GET de UM picking (a lista com $filter não traz). Então:
//   - cada rodada lê alguns pickings já separados/fechados que ainda não leu
//     (do mais novo pro mais antigo, até `expedicao_loc_desde`);
//   - guarda, por depósito + item, o endereço real do picking mais novo
//     (SYSTEM-BIN = "sem endereço", é ignorado);
//   - os itens dos cards em andamento recebem esse endereço.
// O SAP imprime a lista de picking com o endereço atual do estoque; aqui é
// "de onde saiu da última vez" — bate enquanto o item não mudar de lugar.

const DESDE_PADRAO = '2026-07-01'
const POR_RODADA = 60

interface PickCompleto {
  Absoluteentry: number
  Status: string
  PickListsLines: { OrderEntry: number; OrderRowID: number; BaseObjectType: number; DocumentLinesBinAllocations?: { BinAbsEntry: number; Quantity: number }[] }[]
}

export interface AprenderLocalizacoesResultado {
  lidos: number
  pendentes: number
  enderecos: number
  itensAtualizados: number
}

export async function aprenderLocalizacoes(sap: SapSessao, porRodada = POR_RODADA): Promise<AprenderLocalizacoesResultado> {
  const desde = (await getConfigTexto('expedicao_loc_desde')) || DESDE_PADRAO
  const candidatos = await sap.getTodos<{ Absoluteentry: number }>(
    `/PickLists?$filter=PickDate ge '${desde}' and Status ne 'ps_Released'&$select=Absoluteentry&$orderby=Absoluteentry desc`,
    500
  )
  const lidos = new Set(
    (await db.select({ id: sapLocalizacaoPicksLidos.pickListSap }).from(sapLocalizacaoPicksLidos)).map((r) => r.id)
  )
  const fila = candidatos.map((c) => c.Absoluteentry).filter((id) => !lidos.has(id))
  const agora = fila.slice(0, porRodada)
  const resultado: AprenderLocalizacoesResultado = { lidos: 0, pendentes: fila.length - agora.length, enderecos: 0, itensAtualizados: 0 }
  if (!agora.length) {
    resultado.itensAtualizados = await aplicarNosItens()
    return resultado
  }

  const picks: PickCompleto[] = []
  for (const id of agora) picks.push(await sap.get<PickCompleto>(`/PickLists(${id})`))

  // Linha do pedido → item + depósito.
  const entries = [...new Set(picks.flatMap((p) => p.PickListsLines.filter((l) => l.BaseObjectType === 17 && l.DocumentLinesBinAllocations?.length).map((l) => l.OrderEntry)))]
  const linhaPedido = new Map<string, { item: string; deposito: string }>()
  for (let i = 0; i < entries.length; i += 15) {
    const filtro = entries.slice(i, i + 15).map((e) => `DocEntry eq ${e}`).join(' or ')
    const pedidos = await sap.getTodos<{ DocEntry: number; DocumentLines: { LineNum: number; ItemCode: string | null; WarehouseCode: string | null }[] }>(
      `/Orders?$filter=${filtro}&$select=DocEntry,DocumentLines`,
      50
    )
    for (const p of pedidos)
      for (const l of p.DocumentLines) if (l.ItemCode && l.WarehouseCode) linhaPedido.set(`${p.DocEntry}:${l.LineNum}`, { item: l.ItemCode, deposito: l.WarehouseCode })
  }

  // Código dos endereços (AbsEntry → BinCode).
  const binIds = [...new Set(picks.flatMap((p) => p.PickListsLines.flatMap((l) => (l.DocumentLinesBinAllocations ?? []).map((b) => b.BinAbsEntry))))]
  const bins = new Map<number, { code: string; deposito: string; sistema: boolean }>()
  for (let i = 0; i < binIds.length; i += 20) {
    const filtro = binIds.slice(i, i + 20).map((b) => `AbsEntry eq ${b}`).join(' or ')
    for (const b of await sap.getTodos<{ AbsEntry: number; BinCode: string; Warehouse: string; IsSystemBin: string }>(
      `/BinLocations?$filter=${filtro}&$select=AbsEntry,BinCode,Warehouse,IsSystemBin`,
      50
    ))
      bins.set(b.AbsEntry, { code: b.BinCode, deposito: b.Warehouse, sistema: b.IsSystemBin === 'tYES' || /SYSTEM-BIN/i.test(b.BinCode) })
  }

  // Por depósito + item: endereço do picking mais novo (o de maior
  // quantidade, se o item saiu de mais de um lugar no mesmo picking).
  const melhor = new Map<string, { deposito: string; item: string; bin: string; pick: number; qtd: number }>()
  for (const p of picks) {
    for (const l of p.PickListsLines) {
      const ln = linhaPedido.get(`${l.OrderEntry}:${l.OrderRowID}`)
      if (!ln) continue
      for (const a of l.DocumentLinesBinAllocations ?? []) {
        const b = bins.get(a.BinAbsEntry)
        if (!b || b.sistema || b.deposito !== ln.deposito) continue
        const k = `${ln.deposito}|${ln.item}`
        const atual = melhor.get(k)
        if (!atual || p.Absoluteentry > atual.pick || (p.Absoluteentry === atual.pick && a.Quantity > atual.qtd))
          melhor.set(k, { deposito: ln.deposito, item: ln.item, bin: b.code, pick: p.Absoluteentry, qtd: a.Quantity })
      }
    }
  }

  await db.transaction(async (tx) => {
    for (const m of melhor.values()) {
      const localizacao = m.bin.startsWith(`${m.deposito}-`) ? m.bin.slice(m.deposito.length + 1) : m.bin
      await tx
        .insert(sapItemLocalizacao)
        .values({ deposito: m.deposito, itemCodigo: m.item, localizacao, binCode: m.bin, pickListSap: m.pick })
        .onConflictDoUpdate({
          target: [sapItemLocalizacao.deposito, sapItemLocalizacao.itemCodigo],
          set: { localizacao, binCode: m.bin, pickListSap: m.pick, atualizadoEm: sql`datetime('now')` },
          // Picking mais antigo (carga do histórico) não passa por cima.
          setWhere: sql`${sapItemLocalizacao.pickListSap} < ${m.pick}`,
        })
    }
    await tx.insert(sapLocalizacaoPicksLidos).values(agora.map((id) => ({ pickListSap: id }))).onConflictDoNothing()
  })
  resultado.lidos = agora.length
  resultado.enderecos = melhor.size
  resultado.itensAtualizados = await aplicarNosItens()
  return resultado
}

// Itens dos cards em andamento (fora histórico/coletado/cancelado/descartado)
// recebem o endereço conhecido do item naquele depósito.
export async function aplicarNosItens(): Promise<number> {
  const r = await db.run(sql`
    UPDATE expedicao_itens
    SET localizacao = (
      SELECT l.localizacao FROM sap_item_localizacao l
      WHERE l.deposito = expedicao_itens.deposito AND l.item_codigo = expedicao_itens.item_codigo
    )
    WHERE expedicao_id IN (
      SELECT id FROM expedicao_pedidos
      WHERE historico = 0 AND etapa NOT IN ('coletado', 'cancelado', 'descartado')
    )
    AND EXISTS (
      SELECT 1 FROM sap_item_localizacao l
      WHERE l.deposito = expedicao_itens.deposito AND l.item_codigo = expedicao_itens.item_codigo
        AND (expedicao_itens.localizacao IS NULL OR expedicao_itens.localizacao <> l.localizacao)
    )
  `)
  return r.rowsAffected
}
