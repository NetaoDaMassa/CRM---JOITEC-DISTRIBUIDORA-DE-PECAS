import { and, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, ordemDetalhes, ordemFaturamento, ordemHistorico, ordens, vendas } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from './dataBr.js'
import { getConfigTexto, listarConfigPrefixo, setConfig } from './configuracoes.js'
import { comSessaoSap, dataSap, type SapSessao } from './sapServiceLayer.js'

// NF do SAP na aba Faturamento dos Pedidos da Odin Compressores (máquinas e
// peças) — pedido do João, 2026-11-19. Antes a NF era digitada à mão.
//
// Como o Pedido (ordens) se liga ao pedido de venda do SAP (filial 1):
//  - peça da Bruna que nasceu da venda automática: vendas.convertidoParaOrdemId
//    → vendas.pedidoSapEntry (DocEntry);
//  - qualquer outro (máquina principalmente): o "Número do pedido"
//    (ordem_detalhes.numeroPedido, digitado tipo "PEDIDO 9471") = DocNum do
//    pedido no SAP. Diagnóstico de 19/11: 186 de 198 máquinas ligam assim.
// Cliente + valor parecido NÃO liga (28 peças só casavam assim — pode errar).
//
// O que faz: só preenche o nº da NF onde está vazio (e a data do faturamento
// das peças ativas, que é o campo que a aba de peça mostra). NÃO mexe na
// etapa, no "Confirmar Pagamento" nem em ordens.updatedAt ("Nesta etapa
// desde"). As NFs do SAP de cada pedido ficam guardadas em configuracoes
// (`ordem_nf_sap_<id>`, sem migração) pra aba mostrar os botões DANFE/XML e
// avisar quando a NF digitada não bate com a do SAP.

export const FILIAL_ODIN_COMPRESSORES = 1
export const PREFIXO_NF_SAP_ORDEM = 'ordem_nf_sap_'

export type NfSapOrdem = { nf: string; data: string }
export type NfSapOrdemGuardada = { pedido: number; nfs: NfSapOrdem[] }

export async function lerNfSapOrdem(ordemId: number): Promise<NfSapOrdemGuardada | null> {
  const v = await getConfigTexto(PREFIXO_NF_SAP_ORDEM + ordemId)
  if (!v) return null
  try {
    return JSON.parse(v) as NfSapOrdemGuardada
  } catch {
    return null
  }
}

// "PEDIDO 9471", "pedido 9485", "9497" → 9471. Vazio ou sem número → null.
export function docNumDoNumeroPedido(numero: string | null | undefined): number | null {
  const m = /\d{3,}/.exec(String(numero ?? ''))
  if (!m) return null
  const n = Number(m[0])
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

const soDigitos = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '')

// NF(s) digitada(s) no campo: "20924-20988" → [20924, 20988]; "020.584" → [20584].
export function nfsDigitadas(s: string | null | undefined): string[] {
  return String(s ?? '')
    .split(/[^\d.]+/)
    .map(soDigitos)
    .filter(Boolean)
}

// DocNum → DocEntry dos pedidos da filial 1 (não muda: cache do processo).
const entryPorDocNum = new Map<number, number | null>()

async function resolverDocNums(sap: SapSessao, docNums: number[]): Promise<void> {
  const faltam = [...new Set(docNums)].filter((n) => !entryPorDocNum.has(n))
  for (let i = 0; i < faltam.length; i += 20) {
    const lote = faltam.slice(i, i + 20)
    const filtro = lote.map((n) => `DocNum eq ${n}`).join(' or ')
    const achados = await sap.getTodos<{ DocEntry: number; DocNum: number }>(
      `/Orders?$filter=BPL_IDAssignedToInvoice eq ${FILIAL_ODIN_COMPRESSORES} and (${filtro})&$select=DocEntry,DocNum`,
      100
    )
    for (const n of lote) entryPorDocNum.set(n, null)
    for (const a of achados) entryPorDocNum.set(a.DocNum, a.DocEntry)
  }
}

function diasAtras(hoje: string, dias: number): string {
  const d = new Date(`${hoje}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

export interface NfOrdensResultado {
  notas: number
  ligados: number
  preenchidos: number
  divergentes: number
}

// `dias`: quantos dias de notas ler (1 = ontem e hoje, rodada de minuto em
// minuto; 120 = rede de segurança de meia em meia hora — pega NF antiga
// quando o nº do pedido foi digitado depois).
export async function sincronizarNfOrdensOdin(dias = 1): Promise<NfOrdensResultado> {
  const r: NfOrdensResultado = { notas: 0, ligados: 0, preenchidos: 0, divergentes: 0 }
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-compressores'), columns: { id: true } })
  if (!empresa) return r

  const lista = await db
    .select({
      id: ordens.id,
      tipo: ordens.orderType,
      status: ordens.status,
      stage: ordens.stage,
      numeroPedido: ordemDetalhes.numeroPedido,
      vendaEntry: vendas.pedidoSapEntry,
      nf: ordemFaturamento.numeroNotaFiscal,
      dataFat: ordemFaturamento.dataFaturamento,
      temFat: ordemFaturamento.id,
    })
    .from(ordens)
    .leftJoin(ordemDetalhes, eq(ordemDetalhes.ordemId, ordens.id))
    .leftJoin(ordemFaturamento, eq(ordemFaturamento.ordemId, ordens.id))
    .leftJoin(vendas, and(eq(vendas.convertidoParaOrdemId, ordens.id), isNull(vendas.deletedAt)))
    .where(and(eq(ordens.empresaId, empresa.id), ne(ordens.status, 'cancelado')))
  if (!lista.length) return r

  const hoje = hojeBrString()
  const desde = diasAtras(hoje, dias)

  const nfsPorEntry = new Map<number, NfSapOrdem[]>()
  await comSessaoSap(async (sap) => {
    const notas = await sap.getTodos<{
      SequenceSerial: number | null
      DocNum: number
      DocDate: string
      CancelStatus: string
      DocumentLines: { BaseType: number; BaseEntry: number | null }[]
    }>(
      `/Invoices?$filter=DocDate ge '${desde}' and BPL_IDAssignedToInvoice eq ${FILIAL_ODIN_COMPRESSORES} and Cancelled eq 'tNO'&$select=SequenceSerial,DocNum,DocDate,CancelStatus,DocumentLines`,
      100
    )
    r.notas = notas.length
    for (const n of notas) {
      if (n.CancelStatus === 'csCancellation') continue
      const nota = { nf: String(n.SequenceSerial || n.DocNum), data: dataSap(n.DocDate) }
      const bases = new Set(n.DocumentLines.filter((l) => l.BaseType === 17 && l.BaseEntry != null).map((l) => l.BaseEntry!))
      for (const b of bases) {
        const a = nfsPorEntry.get(b) ?? []
        if (!a.some((x) => x.nf === nota.nf)) a.push(nota)
        nfsPorEntry.set(b, a)
      }
    }
    if (!nfsPorEntry.size) return
    // Só resolve DocNum de quem não tem a venda ligada (o cache guarda).
    const docNums = lista.filter((o) => !o.vendaEntry).map((o) => docNumDoNumeroPedido(o.numeroPedido)).filter((n): n is number => n != null)
    await resolverDocNums(sap, docNums)
  })
  if (!nfsPorEntry.size) return r

  const guardadas = new Map((await listarConfigPrefixo(PREFIXO_NF_SAP_ORDEM)).map((c) => [c.chave, c.valor]))

  for (const o of lista) {
    const docNum = docNumDoNumeroPedido(o.numeroPedido)
    const entry = o.vendaEntry ?? (docNum != null ? entryPorDocNum.get(docNum) ?? null : null)
    if (!entry) continue
    const novas = nfsPorEntry.get(entry)
    if (!novas) continue
    r.ligados++

    // Junta com o que já estava guardado (rodada de 1 dia só vê a nota nova).
    const chave = PREFIXO_NF_SAP_ORDEM + o.id
    let anterior: NfSapOrdemGuardada | null = null
    try {
      anterior = guardadas.has(chave) ? (JSON.parse(guardadas.get(chave)!) as NfSapOrdemGuardada) : null
    } catch {
      anterior = null
    }
    const nfs = anterior && anterior.pedido === entry ? [...anterior.nfs] : []
    for (const n of novas) if (!nfs.some((x) => x.nf === n.nf)) nfs.push(n)
    nfs.sort((a, b) => a.data.localeCompare(b.data) || Number(a.nf) - Number(b.nf))
    const valor = JSON.stringify({ pedido: entry, nfs } satisfies NfSapOrdemGuardada)
    if (guardadas.get(chave) !== valor) await setConfig(chave, valor)

    const digitadas = nfsDigitadas(o.nf)
    if (digitadas.length) {
      if (!nfs.some((n) => digitadas.includes(soDigitos(n.nf)))) r.divergentes++
      continue
    }

    // Vazio: preenche com a primeira NF do pedido.
    const primeira = nfs[0]
    const set: Partial<typeof ordemFaturamento.$inferInsert> = { numeroNotaFiscal: primeira.nf, updatedAt: agoraSqlite() }
    // Data do faturamento: é o campo da aba de PEÇA; só em pedido ativo (no
    // Calendário Odin, data de faturamento sem pagamento confirmado aparece
    // como atrasada — não vale a pena encher os já concluídos).
    if (o.tipo === 'peca' && o.status === 'ativo' && !o.dataFat) set.dataFaturamento = primeira.data
    if (o.temFat) {
      await db
        .update(ordemFaturamento)
        .set(set)
        .where(and(eq(ordemFaturamento.ordemId, o.id), or(isNull(ordemFaturamento.numeroNotaFiscal), eq(sql`trim(${ordemFaturamento.numeroNotaFiscal})`, ''))))
    } else {
      await db.insert(ordemFaturamento).values({ ordemId: o.id, ...set }).onConflictDoNothing()
    }
    await db.insert(ordemHistorico).values({
      ordemId: o.id,
      userId: null,
      action: 'field_update',
      fieldName: 'numero_nota_fiscal',
      newValue: primeira.nf,
      description: `NF ${nfs.map((n) => n.nf).join(', ')} puxada do SAP automaticamente`,
      stage: o.stage,
    })
    r.preenchidos++
  }
  return r
}

// Como o Pedido se liga ao SAP — a aba usa pra explicar por que a NF não veio.
export function vinculoDaOrdem(o: { numeroPedido: string | null | undefined; vendaEntry: number | null | undefined }): 'venda' | 'numero_pedido' | null {
  if (o.vendaEntry) return 'venda'
  if (docNumDoNumeroPedido(o.numeroPedido) != null) return 'numero_pedido'
  return null
}

