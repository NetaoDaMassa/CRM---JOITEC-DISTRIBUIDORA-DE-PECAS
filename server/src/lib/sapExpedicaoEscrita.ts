// Ações da Expedição que GRAVAM no SAP, disparadas por alguém na tela
// (João, 2026-11-10 — "gerar picking e registrar conferência por dentro do CRM").
//
// 1. Gerar picking: pedido de venda aberto e sem picking → lista de picking
//    (PickLists) com todas as linhas em aberto. A rotina da Expedição vê o
//    picking novo e cria o card.
// 2. Registrar conferência: depois da conferência no CRM, marca o picking
//    como separado no SAP (PickedQuantity). O depósito de Revenda usa
//    posições (bin) e o SAP exige dizer de qual posição saiu; a API não
//    informa saldo por posição, então usa a posição aprendida de cada item
//    (sap_item_localizacao, de pickings já fechados). Item sem posição
//    aprendida, ou posição sem saldo: o SAP recusa e a mensagem volta pra tela.
//    Na prática a equipe quase não usa "separado" no SAP (picking vai de
//    liberado direto pra fechado com a nota), por isso é um botão opcional.
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { expedicaoItens, sapItemLocalizacao } from '../db/schema.js'
import { hojeBrString } from './dataBr.js'
import { comSessaoSap } from './sapServiceLayer.js'

// `filiais` em ordem de preferência; `aceitar` filtra o pedido achado (Odin
// Tubos procura também na filial Joitec, mas só pedido de vendedor da Odin
// Tubos — a nota continua saindo pela Joitec).
export async function gerarPickingSap(
  filiais: number[],
  numeroPedido: number,
  quem: string,
  aceitar: (p: { BPL_IDAssignedToInvoice: number; SalesPersonCode: number }) => boolean = () => true
): Promise<{ pickList: number; linhas: number }> {
  return comSessaoSap(async (sap) => {
    const { value } = await sap.get<{
      value: {
        DocEntry: number
        DocumentStatus: string
        Cancelled: string
        Comments: string | null
        BPL_IDAssignedToInvoice: number
        SalesPersonCode: number
        DocumentLines: { LineNum: number; RemainingOpenQuantity: number; LineStatus: string }[]
      }[]
    }>(
      `/Orders?$filter=DocNum eq ${numeroPedido} and (${filiais.map((f) => `BPL_IDAssignedToInvoice eq ${f}`).join(' or ')})&$select=DocEntry,DocumentStatus,Cancelled,Comments,BPL_IDAssignedToInvoice,SalesPersonCode,DocumentLines`
    )
    const pedido = filiais.flatMap((f) => value.filter((v) => v.BPL_IDAssignedToInvoice === f && aceitar(v)))[0]
    if (!pedido) throw new Error(`Pedido ${numeroPedido} não encontrado no SAP`)
    if (pedido.Cancelled === 'tYES' || pedido.DocumentStatus !== 'bost_Open') throw new Error(`O pedido ${numeroPedido} não está aberto no SAP`)
    const abertas = pedido.DocumentLines.filter((l) => l.LineStatus !== 'bost_Close' && l.RemainingOpenQuantity > 0)
    if (!abertas.length) throw new Error(`O pedido ${numeroPedido} não tem linhas em aberto pra separar`)
    const criado = await sap.escrever<{ Absoluteentry: number }>('POST', '/PickLists', {
      Name: quem.slice(0, 50),
      PickDate: hojeBrString(),
      Remarks: pedido.Comments?.slice(0, 250) || null,
      PickListsLines: abertas.map((l) => ({ BaseObjectType: 17, OrderEntry: pedido.DocEntry, OrderRowID: l.LineNum, ReleasedQuantity: l.RemainingOpenQuantity })),
    })
    if (!criado?.Absoluteentry) throw new Error('O SAP não devolveu o número do picking')
    return { pickList: criado.Absoluteentry, linhas: abertas.length }
  })
}

// Item sem posição aprendida (ex.: item novo que nunca saiu num picking):
// tenta a posição padrão do depósito (SYSTEM-BIN — onde cai o que entra sem
// endereço) e, se a pessoa escolher na tela, a posição informada (que passa a
// ser a aprendida). João, 2026-11-18: I001480/I001479 travaram o picking.
export async function registrarConferenciaSap(
  cardId: number,
  pickList: number,
  binsEscolhidos: Record<string, string> = {}
): Promise<{ linhas: number }> {
  const itens = await db.select().from(expedicaoItens).where(eq(expedicaoItens.expedicaoId, cardId))
  const chaves = [...new Set(itens.filter((i) => i.itemCodigo && i.deposito).map((i) => `${i.deposito}|${i.itemCodigo}`))]
  const locais = chaves.length
    ? await db
        .select()
        .from(sapItemLocalizacao)
        .where(
          and(
            inArray(sapItemLocalizacao.deposito, [...new Set(chaves.map((k) => k.split('|')[0]))]),
            inArray(sapItemLocalizacao.itemCodigo, [...new Set(chaves.map((k) => k.split('|')[1]))])
          )
        )
    : []
  const binDe = new Map(locais.map((l) => [`${l.deposito}|${l.itemCodigo}`, l.binCode]))
  const escolhidosUsados: { deposito: string; itemCodigo: string; binCode: string; pick: number }[] = []
  const r = await comSessaoSap(async (sap) => {
    const pick = await sap.get<{ Status: string; PickListsLines: { LineNumber: number; OrderEntry: number; OrderRowID: number; ReleasedQuantity: number; PickedQuantity: number }[] }>(`/PickLists(${pickList})`)
    if (pick.Status === 'ps_Picked') return { linhas: 0 }
    if (pick.Status !== 'ps_Released') throw new Error(`Picking ${pickList} não está liberado no SAP (situação: ${pick.Status})`)
    const semPosicao: string[] = []
    const absPorBin = new Map<string, number>()
    const systemBin = new Map<string, string | null>()
    const binPadraoDoDeposito = async (dep: string) => {
      if (!systemBin.has(dep)) {
        const { value } = await sap.get<{ value: { BinCode: string }[] }>(
          `/BinLocations?$filter=Warehouse eq '${dep.replace(/'/g, "''")}' and IsSystemBin eq 'tYES'&$select=BinCode`
        )
        systemBin.set(dep, value[0]?.BinCode ?? null)
      }
      return systemBin.get(dep) ?? undefined
    }
    const linhas = []
    for (const l of pick.PickListsLines.filter((x) => x.ReleasedQuantity > 0)) {
      const item = itens.find((i) => i.orderEntrySap === l.OrderEntry && i.linhaPedidoSap === l.OrderRowID)
      const escolhido = item?.itemCodigo ? binsEscolhidos[item.itemCodigo]?.trim() : undefined
      const binCode =
        escolhido || (item ? binDe.get(`${item.deposito}|${item.itemCodigo}`) : undefined) || (item?.deposito ? await binPadraoDoDeposito(item.deposito) : undefined)
      if (!item || !binCode) {
        semPosicao.push(item?.itemCodigo ?? `linha ${l.OrderRowID}`)
        continue
      }
      if (!absPorBin.has(binCode)) {
        const { value } = await sap.get<{ value: { AbsEntry: number }[] }>(`/BinLocations?$filter=BinCode eq '${binCode.replace(/'/g, "''")}'&$select=AbsEntry`)
        if (!value[0]) {
          semPosicao.push(`${item.itemCodigo ?? '?'} (posição ${binCode} não existe)`)
          continue
        }
        absPorBin.set(binCode, value[0].AbsEntry)
      }
      if (escolhido && item.itemCodigo && item.deposito) escolhidosUsados.push({ deposito: item.deposito, itemCodigo: item.itemCodigo, binCode, pick: pickList })
      linhas.push({
        LineNumber: l.LineNumber,
        PickedQuantity: l.ReleasedQuantity,
        DocumentLinesBinAllocations: [{ BinAbsEntry: absPorBin.get(binCode)!, Quantity: l.ReleasedQuantity, AllowNegativeQuantity: 'tNO', SerialAndBatchNumbersBaseLine: -1, BaseLineNumber: l.LineNumber }],
      })
    }
    if (semPosicao.length) throw new Error(`Sem posição de estoque conhecida para: ${semPosicao.join(', ')}. Escolha a posição desses itens.`)
    if (!linhas.length) throw new Error('Nenhuma linha liberada pra conferir')
    await sap.escrever('PATCH', `/PickLists(${pickList})`, { PickListsLines: linhas })
    const depois = await sap.get<{ Status: string }>(`/PickLists(${pickList})?$select=Status`)
    if (depois.Status !== 'ps_Picked') throw new Error('O SAP aceitou mas não marcou o picking como separado — registre no SAP')
    return { linhas: linhas.length }
  })
  // Deu certo com a posição escolhida: vira a posição aprendida do item.
  for (const e of escolhidosUsados) {
    const localizacao = e.binCode.startsWith(`${e.deposito}-`) ? e.binCode.slice(e.deposito.length + 1) : e.binCode
    await db
      .insert(sapItemLocalizacao)
      .values({ deposito: e.deposito, itemCodigo: e.itemCodigo, localizacao, binCode: e.binCode, pickListSap: e.pick })
      .onConflictDoUpdate({ target: [sapItemLocalizacao.deposito, sapItemLocalizacao.itemCodigo], set: { localizacao, binCode: e.binCode, pickListSap: e.pick } })
  }
  return r
}

// Pra tela: itens do card, posição que o CRM vai usar e as posições do depósito.
export async function posicoesParaConferenciaSap(cardId: number): Promise<{
  itens: { itemCodigo: string; descricao: string; deposito: string; binAprendido: string | null }[]
  posicoes: Record<string, string[]>
}> {
  const itens = await db.select().from(expedicaoItens).where(eq(expedicaoItens.expedicaoId, cardId))
  const comCodigo = itens.filter((i) => i.itemCodigo && i.deposito)
  const locais = comCodigo.length
    ? await db.select().from(sapItemLocalizacao).where(inArray(sapItemLocalizacao.itemCodigo, [...new Set(comCodigo.map((i) => i.itemCodigo!))]))
    : []
  const binDe = new Map(locais.map((l) => [`${l.deposito}|${l.itemCodigo}`, l.binCode]))
  const unicos = new Map<string, { itemCodigo: string; descricao: string; deposito: string; binAprendido: string | null }>()
  for (const i of comCodigo) unicos.set(i.itemCodigo!, { itemCodigo: i.itemCodigo!, descricao: i.descricao, deposito: i.deposito!, binAprendido: binDe.get(`${i.deposito}|${i.itemCodigo}`) ?? null })
  const depositos = [...new Set([...unicos.values()].map((i) => i.deposito))]
  const posicoes: Record<string, string[]> = {}
  await comSessaoSap(async (sap) => {
    for (const d of depositos) {
      const bins = await sap.getTodos<{ BinCode: string }>(`/BinLocations?$filter=Warehouse eq '${d.replace(/'/g, "''")}'&$select=BinCode&$orderby=BinCode`, 500)
      posicoes[d] = bins.map((b) => b.BinCode)
    }
  })
  return { itens: [...unicos.values()], posicoes }
}
