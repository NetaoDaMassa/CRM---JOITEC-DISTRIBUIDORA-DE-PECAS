import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, sapImportacoes, sapItensHistorico } from '../db/schema.js'
import { limparCodigo, semZerosEsquerda } from './importSapHistorico.js'
import { getConfigTexto, setConfig } from './configuracoes.js'
import { hojeBrString } from './dataBr.js'
import { registrarAuditoria } from './auditoria.js'
import { comSessaoSap, dataSap } from './sapServiceLayer.js'

// Itens das notas de venda puxados DIRETO do SAP (Service Layer) — passo 2
// da integração, pedido do João, 2026-10-29. Faz o mesmo papel da planilha
// "RELATORIO DE COTAÇÕES SAP DETALHADO" (importSapItens.ts), sem planilha:
//   - grava em sap_itens_historico, então ficha do cliente e relatórios de
//     itens já usam (lib/sapItens.ts). NUNCA soma no faturamento;
//   - nº da nota = DocNum do SAP (é o mesmo nº que vinha na planilha —
//     conferido nota a nota), e o DocNum é uma sequência só pras 3 filiais,
//     então uma nota que já está em QUALQUER lote ligado é pulada;
//   - nota cancelada (e o documento de cancelamento) não entra; se uma nota
//     que já entrou por aqui for cancelada depois, os itens dela saem;
//   - nota com DocTotal 0 entra normal: é venda paga por adiantamento (o
//     valor está nas linhas);
//   - cada empresa tem UM lote fixo "SAP automático" que vai crescendo —
//     desligar esse lote (importarSap.js --desligar) desliga a sincronização
//     daquela empresa;
//   - devolução (nota de crédito) fica de fora, igual na planilha.

export const NOME_LOTE_AUTOMATICO = 'SAP automático (Service Layer)'
const CHAVE_ULTIMA_DATA = 'sap_itens_sync_ate'
const CHAVE_VENDEDORES_AUTOMACAO = 'sap_vendedores_automacao'
// Margem pra trás a cada rodada: nota lançada com data de dias anteriores
// ainda é pega (o que já entrou é pulado pelo nº).
const DIAS_SOBREPOSICAO = 3

// Filial do SAP (BPL_IDAssignedToInvoice) → empresa do CRM. Odin
// Compressores (filial 1) fica de fora por enquanto: os códigos de cliente
// do CRM dela vieram do sistema antigo e não batem com o SAP (precisa casar
// por CNPJ — próximo passo). Compretec (filial 5) está desativada no SAP.
const SLUG_POR_FILIAL: Record<number, string> = { 3: 'joitec', 4: 'odin-tubos' }
// A Odin Automação vende pelo CNPJ da Joitec (filial 3): o que separa é o
// vendedor da nota. Códigos do SAP: 86 PAMELA CRISTINA - AUTOMAÇÃO,
// 111 FERNANDA - AUTOMAÇÃO, 142 PEDRO PAULO (o 143 PEDRO JOSE DOS SANTOS é
// da Odin Compressores). Configurável em `sap_vendedores_automacao`.
const SLUG_AUTOMACAO = 'joitec-automacao'
const VENDEDORES_AUTOMACAO_PADRAO = '86,111,142'

export async function vendedoresAutomacaoSap(): Promise<Set<number>> {
  return new Set(
    ((await getConfigTexto(CHAVE_VENDEDORES_AUTOMACAO)) ?? VENDEDORES_AUTOMACAO_PADRAO)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n))
  )
}

interface NotaSap {
  DocEntry: number
  DocNum: number
  DocDate: string
  CardCode: string
  CardName: string
  SalesPersonCode: number
  BPL_IDAssignedToInvoice: number
  Cancelled?: string
  CancelStatus?: string
  DocumentLines: { ItemCode: string | null; ItemDescription: string | null; Quantity: number; Price: number; LineTotal: number }[]
}

export interface SyncItensResultado {
  periodo: { de: string; ate: string }
  notasNoSap: number
  canceladas: number
  outraFilial: number
  jaImportadas: number
  empresaDesligada: number
  porEmpresa: Record<string, { notas: number; linhas: number; valor: number; clientes: number }>
  naoEncontradas: { empresa: string; codigo: string; nome: string; nota: string; valor: number }[]
  canceladasRemovidas: { nota: string; linhas: number }[]
  gravado: boolean
}

export async function sincronizarItensSap(opts: {
  confirmar: boolean
  usuarioId: number
  de?: string
  ate?: string
}): Promise<SyncItensResultado> {
  const slugs = [...Object.values(SLUG_POR_FILIAL), SLUG_AUTOMACAO]
  const listaEmpresas = await db.query.empresas.findMany({ where: inArray(empresas.slug, slugs) })
  const empresaPorSlug = new Map(listaEmpresas.map((e) => [e.slug, e]))

  const codigosAutomacao = await vendedoresAutomacaoSap()

  const ate = opts.ate ?? hojeBrString()
  const de = opts.de ?? (await dataInicialPadrao(listaEmpresas.map((e) => e.id)))

  // Lote fixo de cada empresa (null = ainda não existe; criado só ao gravar).
  const lotes = new Map<string, { id: number | null; ativo: boolean }>()
  for (const e of listaEmpresas) {
    const l = await db.query.sapImportacoes.findFirst({
      where: and(eq(sapImportacoes.empresaId, e.id), eq(sapImportacoes.tipo, 'itens'), eq(sapImportacoes.nomeArquivo, NOME_LOTE_AUTOMATICO)),
    })
    lotes.set(e.slug, { id: l?.id ?? null, ativo: l?.ativo ?? true })
  }

  // Nº de nota já presente em qualquer lote de itens LIGADO (planilha ou automático).
  const existentes = await db
    .selectDistinct({ nota: sapItensHistorico.numeroNota })
    .from(sapItensHistorico)
    .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapItensHistorico.importacaoId))
    .where(and(eq(sapImportacoes.tipo, 'itens'), eq(sapImportacoes.ativo, true)))
  const jaExiste = new Set(existentes.map((e) => e.nota))

  const clientesPorSlug = new Map<string, { exato: Map<string, number>; semZero: Map<string, number> }>()
  for (const e of listaEmpresas) {
    const lista = await db.query.clientes.findMany({
      where: and(eq(clientes.empresaId, e.id), isNull(clientes.deletedAt)),
      columns: { id: true, codigo: true, codigoAntigo: true },
    })
    const exato = new Map<string, number>()
    const semZero = new Map<string, number>()
    for (const c of lista) {
      for (const cod of [c.codigo, c.codigoAntigo]) {
        if (!cod) continue
        const limpo = limparCodigo(cod)
        if (!exato.has(limpo)) exato.set(limpo, c.id)
        const sz = semZerosEsquerda(limpo)
        if (!semZero.has(sz)) semZero.set(sz, c.id)
      }
    }
    clientesPorSlug.set(e.slug, { exato, semZero })
  }

  const notas = await comSessaoSap((sap) =>
    sap.getTodos<NotaSap>(
      `/Invoices?$select=DocEntry,DocNum,DocDate,CardCode,CardName,SalesPersonCode,BPL_IDAssignedToInvoice,Cancelled,CancelStatus,DocumentLines` +
        `&$filter=DocDate ge '${de}' and DocDate le '${ate}'&$orderby=DocEntry`,
      200
    )
  )

  const resultado: SyncItensResultado = {
    periodo: { de, ate },
    notasNoSap: notas.length,
    canceladas: 0,
    outraFilial: 0,
    jaImportadas: 0,
    empresaDesligada: 0,
    porEmpresa: {},
    naoEncontradas: [],
    canceladasRemovidas: [],
    gravado: false,
  }
  const paraGravar = new Map<string, (typeof sapItensHistorico.$inferInsert)[]>()
  const notasCanceladas: string[] = []

  for (const n of notas) {
    const nota = String(n.DocNum)
    if (n.Cancelled === 'tYES' || n.CancelStatus === 'csCancellation') {
      resultado.canceladas++
      if (n.Cancelled === 'tYES') notasCanceladas.push(nota)
      continue
    }
    const slugFilial = SLUG_POR_FILIAL[n.BPL_IDAssignedToInvoice]
    if (!slugFilial) {
      resultado.outraFilial++
      continue
    }
    const slug = slugFilial === 'joitec' && codigosAutomacao.has(n.SalesPersonCode) ? SLUG_AUTOMACAO : slugFilial
    const empresa = empresaPorSlug.get(slug)
    if (!empresa) {
      resultado.outraFilial++
      continue
    }
    if (jaExiste.has(nota)) {
      resultado.jaImportadas++
      continue
    }
    if (!lotes.get(slug)!.ativo) {
      resultado.empresaDesligada++
      continue
    }
    const valorNota = n.DocumentLines.reduce((s, l) => s + (l.LineTotal ?? 0), 0)
    const codigo = limparCodigo(n.CardCode ?? '')
    const mapa = clientesPorSlug.get(slug)!
    const clienteId = mapa.exato.get(codigo) ?? mapa.semZero.get(semZerosEsquerda(codigo))
    if (!clienteId) {
      resultado.naoEncontradas.push({ empresa: empresa.nome, codigo, nome: n.CardName, nota, valor: valorNota })
      continue
    }
    const linhas = paraGravar.get(slug) ?? []
    for (const l of n.DocumentLines) {
      linhas.push({
        empresaId: empresa.id,
        importacaoId: 0,
        clienteId,
        codigoCliente: codigo,
        numeroNota: nota,
        dataNota: dataSap(n.DocDate),
        codigoItem: l.ItemCode || null,
        descricao: (l.ItemDescription ?? '').trim() || l.ItemCode || '(sem descrição)',
        quantidade: l.Quantity,
        valorUnitario: l.Price,
        valorTotal: l.LineTotal,
      })
    }
    paraGravar.set(slug, linhas)
    jaExiste.add(nota)
  }

  for (const [slug, linhas] of paraGravar) {
    resultado.porEmpresa[empresaPorSlug.get(slug)!.nome] = {
      notas: new Set(linhas.map((l) => l.numeroNota)).size,
      linhas: linhas.length,
      valor: linhas.reduce((s, l) => s + (l.valorTotal ?? 0), 0),
      clientes: new Set(linhas.map((l) => l.clienteId)).size,
    }
  }

  // Nota que entrou por aqui e depois foi cancelada no SAP: sai. (Lotes de
  // planilha não são mexidos — só listados se tiver.)
  const idsLotesAuto = [...lotes.values()].map((l) => l.id).filter((id): id is number => id !== null)
  if (notasCanceladas.length && idsLotesAuto.length) {
    const achadas = await db
      .select({ nota: sapItensHistorico.numeroNota, linhas: sql<number>`count(*)` })
      .from(sapItensHistorico)
      .where(and(inArray(sapItensHistorico.importacaoId, idsLotesAuto), inArray(sapItensHistorico.numeroNota, notasCanceladas)))
      .groupBy(sapItensHistorico.numeroNota)
    resultado.canceladasRemovidas = achadas.map((a) => ({ nota: a.nota, linhas: Number(a.linhas) }))
  }

  if (!opts.confirmar) return resultado

  for (const [slug, linhas] of paraGravar) {
    const empresa = empresaPorSlug.get(slug)!
    const lote = lotes.get(slug)!
    const id = await db.transaction(async (tx) => {
      let loteId = lote.id
      if (loteId === null) {
        const r = await tx.insert(sapImportacoes).values({ empresaId: empresa.id, tipo: 'itens', nomeArquivo: NOME_LOTE_AUTOMATICO, importadoPor: opts.usuarioId })
        loteId = Number(r.lastInsertRowid)
      }
      for (let i = 0; i < linhas.length; i += 500) {
        await tx.insert(sapItensHistorico).values(linhas.slice(i, i + 500).map((l) => ({ ...l, importacaoId: loteId! })))
      }
      return loteId
    })
    lote.id = id
    await registrarAuditoria({
      tabela: 'sap_importacoes',
      registroId: id,
      acao: 'editar',
      valorNovo: `${NOME_LOTE_AUTOMATICO} · +${resultado.porEmpresa[empresa.nome].notas} notas / ${linhas.length} itens (${de} a ${ate})`,
      alteradoPor: opts.usuarioId,
    })
  }

  const idsAgora = [...lotes.values()].map((l) => l.id).filter((id): id is number => id !== null)
  if (resultado.canceladasRemovidas.length) {
    await db
      .delete(sapItensHistorico)
      .where(and(inArray(sapItensHistorico.importacaoId, idsAgora), inArray(sapItensHistorico.numeroNota, resultado.canceladasRemovidas.map((c) => c.nota))))
  }
  // Totais do lote recalculados do que ficou nele (período = cobertura usada
  // em lib/sapItens.ts).
  for (const loteId of idsAgora) {
    const [t] = await db
      .select({
        linhas: sql<number>`count(*)`,
        valor: sql<number>`coalesce(sum(${sapItensHistorico.valorTotal}), 0)`,
        de: sql<string | null>`min(${sapItensHistorico.dataNota})`,
        ate: sql<string | null>`max(${sapItensHistorico.dataNota})`,
      })
      .from(sapItensHistorico)
      .where(eq(sapItensHistorico.importacaoId, loteId))
    await db
      .update(sapImportacoes)
      .set({ totalLinhas: Number(t.linhas), importadas: Number(t.linhas), valorTotal: Number(t.valor), dataInicio: t.de, dataFim: t.ate })
      .where(eq(sapImportacoes.id, loteId))
  }
  await setConfig(CHAVE_ULTIMA_DATA, ate)
  resultado.gravado = true
  return resultado
}

// Primeira rodada: a partir da última nota que já está nos lotes de itens
// (planilhas), com margem. Depois: a partir da última sincronização.
async function dataInicialPadrao(empresaIds: number[]): Promise<string> {
  const ultima = await getConfigTexto(CHAVE_ULTIMA_DATA)
  let base = ultima
  if (!base) {
    const [r] = await db
      .select({ ate: sql<string | null>`max(${sapImportacoes.dataFim})` })
      .from(sapImportacoes)
      .where(and(inArray(sapImportacoes.empresaId, empresaIds), eq(sapImportacoes.tipo, 'itens'), eq(sapImportacoes.ativo, true)))
    base = r?.ate ?? '2026-04-01'
  }
  const d = new Date(`${base}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - DIAS_SOBREPOSICAO)
  return d.toISOString().slice(0, 10)
}
