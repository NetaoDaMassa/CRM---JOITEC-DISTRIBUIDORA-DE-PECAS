import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, sapCotacoesHistorico, sapCotacoesItens, sapImportacoes } from '../db/schema.js'
import { lerLinhasPlanilha, getCol, getColCru, cabecalhosDetectados, normalizarTexto } from './importClientes.js'
import { limparCodigo, parseData, parseValor, semZerosEsquerda } from './importSapHistorico.js'
import { FILIAL_POR_SLUG } from './importSapCotacoes.js'
import { registrarAuditoria } from './auditoria.js'

// Importação dos ITENS das cotações do SAP (pedido do João, 2026-10-22,
// planilha "RELATORIO DE COTAÇÕES/ORCAMENTO - SAP DETALHADO": uma linha por
// item, com Nº da Cotação, Status e Valor Total da Cotação repetidos). Mesmo
// fluxo dos itens de venda (importSapItens.ts): prévia e confirmação, cliente
// achado pelo código, cliente desconhecido não é criado. Diferenças:
//   - Regra do PPR: cotação da filial Joitec com QUALQUER item PPR é da Odin
//     Tubos (antes da separação a Joitec cotava PPR). Vale pra cotação
//     inteira, mesmo com itens que não são PPR.
//   - Na importação da Odin Tubos, os cabeçalhos dessas cotações que já
//     estavam na Joitec (sap_cotacoes_historico, abr–jul) MUDAM de empresa:
//     saem do lote da Joitec e entram num lote novo da Odin Tubos, com o
//     cliente achado de novo na carteira da Odin Tubos. Se o cliente não
//     existir lá, a cotação fica onde está (e aparece na prévia).
//   - Status dos cabeçalhos já importados é atualizado com o da planilha
//     (cotação que estava aberta e fechou depois).
//   - A cotação inteira é a unidade: nº já num lote de itens LIGADO dessa
//     empresa → todas as linhas dela são puladas (reimportar não duplica).

const COLS_FILIAL = ['Filial', 'Nome Filial', 'Empresa']
const COLS_CODIGO = ['Código do Cliente', 'Codigo do Cliente', 'Código PN', 'Codigo PN', 'CardCode']
const COLS_NOME = ['Nome do Cliente', 'Nome', 'Cliente', 'CardName']
const COLS_NUMERO = ['Nº da Cotação', 'N° da Cotação', 'Número da Cotação', 'Numero da Cotacao', 'Nº Cotação', 'DocNum']
const COLS_DATA = ['Data da Cotação', 'Data Cotação', 'Data', 'DocDate']
const COLS_LINHA = ['Linha', 'LineNum']
const COLS_COD_ITEM = ['Código do Item', 'Codigo do Item', 'ItemCode']
const COLS_DESCRICAO = ['Descrição do Item', 'Descricao do Item', 'Descrição', 'Descricao', 'Dscription']
const COLS_QTD = ['Quantidade', 'Qtd', 'Quantity']
const COLS_UNIT = ['Preço Unitário', 'Preco Unitario', 'Price']
const COLS_TOTAL = ['Total da Linha', 'Total Linha', 'LineTotal']
const COLS_VALOR_COTACAO = ['Valor Total da Cotação', 'Valor Total da Cotacao', 'Valor da Cotação', 'DocTotal']
const COLS_STATUS = ['Status', 'Situação', 'Situacao']

const ehPpr = (descricao: string) => /\bPPR/i.test(descricao)

function statusDe(cru: string): 'aberto' | 'fechado' | 'cancelado' | 'outro' {
  const s = normalizarTexto(cru)
  if (s.startsWith('abert')) return 'aberto'
  if (s.startsWith('fechad')) return 'fechado'
  if (s.startsWith('cancel')) return 'cancelado'
  return 'outro'
}

export interface CotacaoItemProblema {
  linha: number
  codigo: string
  nome: string
  numero: string
  motivo: string
}

export interface CotacoesItensResultado {
  arquivo: string
  totalLinhas: number
  outraEmpresa: number
  foraPeriodo: number
  jaImportadas: number
  linhasImportaveis: number
  cotacoes: number
  // Cotações da filial Joitec que vieram pra cá (Odin Tubos) por terem PPR.
  cotacoesPprDaJoitec: number
  clientesDistintos: number
  itensDistintos: number
  valorCotacoes: number
  porStatus: Record<string, number>
  porMes: Record<string, { cotacoes: number; linhas: number }>
  dataInicio: string | null
  dataFim: string | null
  naoEncontradas: (CotacaoItemProblema & { valor: number; pprDaJoitec: boolean })[]
  invalidas: CotacaoItemProblema[]
  // Cabeçalhos já importados (sap_cotacoes_historico) que mudam.
  cabecalhos: {
    statusAtualizados: number
    // Só na Odin Tubos: cabeçalhos da Joitec que passam pra cá.
    mover: { qtd: number; valor: number }
    moverSemCliente: { numero: string; codigo: string | null; valor: number }[]
  }
  importacaoId?: number
  importacaoCabecalhosId?: number
}

type Linha = {
  linha: number
  codigo: string
  nome: string
  numero: string
  filial: string
  data: string | null
  status: 'aberto' | 'fechado' | 'cancelado' | 'outro'
  valorCotacao: number | null
  numLinha: number | null
  codigoItem: string | null
  descricao: string
  quantidade: number | null
  valorUnitario: number | null
  valorTotal: number | null
}

async function mapaClientes(empresaId: number) {
  const lista = await db.query.clientes.findMany({
    where: and(eq(clientes.empresaId, empresaId), isNull(clientes.deletedAt)),
    columns: { id: true, codigo: true, codigoAntigo: true },
  })
  const porCodigoExato = new Map<string, number>()
  const porCodigoSemZero = new Map<string, number>()
  for (const c of lista) {
    for (const cod of [c.codigo, c.codigoAntigo]) {
      if (!cod) continue
      const limpo = limparCodigo(cod)
      if (!porCodigoExato.has(limpo)) porCodigoExato.set(limpo, c.id)
      const sz = semZerosEsquerda(limpo)
      if (!porCodigoSemZero.has(sz)) porCodigoSemZero.set(sz, c.id)
    }
  }
  return (codigo: string | null | undefined) => (codigo ? porCodigoExato.get(codigo) ?? porCodigoSemZero.get(semZerosEsquerda(codigo)) : undefined)
}

export async function processarCotacoesItensSap(
  buffer: Buffer,
  nomeArquivo: string,
  empresa: { id: number; slug: string },
  opts: { confirmar: boolean; usuarioId: number; periodo?: { de: string; ate: string } }
): Promise<CotacoesItensResultado> {
  const filial = FILIAL_POR_SLUG[empresa.slug]
  if (!filial) throw new Error(`Não sei qual é a filial do SAP da empresa "${empresa.slug}"`)
  const rows = lerLinhasPlanilha(buffer, nomeArquivo, { csvTextoPuro: true })
  const filialJoitec = FILIAL_POR_SLUG.joitec
  const filialOdinTubos = FILIAL_POR_SLUG['odin-tubos']

  // 1ª passada: lê tudo e agrupa por cotação (a regra do PPR olha a
  // cotação inteira antes de decidir a empresa).
  const invalidas: CotacaoItemProblema[] = []
  const porCotacao = new Map<string, Linha[]>()
  let totalLinhas = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const linha = i + 2
    const codigo = limparCodigo(getCol(row, ...COLS_CODIGO))
    const nome = getCol(row, ...COLS_NOME)
    const numero = getCol(row, ...COLS_NUMERO).replace(/\.0+$/, '')
    const descricao = getCol(row, ...COLS_DESCRICAO)
    const base = { linha, codigo, nome, numero }
    if (!codigo && !numero && !descricao) continue
    totalLinhas++

    const filialLinha = normalizarTexto(getCol(row, ...COLS_FILIAL))
    const filialSap = Object.values(FILIAL_POR_SLUG).find((f) => filialLinha.includes(f))
    if (!filialSap) {
      invalidas.push({ ...base, motivo: `Filial que não reconheci: "${getCol(row, ...COLS_FILIAL)}"` })
      continue
    }
    if (!codigo) {
      invalidas.push({ ...base, motivo: `Sem código do cliente (colunas encontradas: ${cabecalhosDetectados(row)})` })
      continue
    }
    if (!numero) {
      invalidas.push({ ...base, motivo: 'Sem número da cotação' })
      continue
    }
    if (!descricao) {
      invalidas.push({ ...base, motivo: 'Linha sem descrição do item' })
      continue
    }
    const chave = `${filialSap}|${numero}`
    const lista = porCotacao.get(chave) ?? []
    lista.push({
      ...base,
      filial: filialSap,
      data: parseData(getColCru(row, ...COLS_DATA)),
      status: statusDe(getCol(row, ...COLS_STATUS)),
      valorCotacao: parseValor(getColCru(row, ...COLS_VALOR_COTACAO)),
      numLinha: parseValor(getColCru(row, ...COLS_LINHA)),
      codigoItem: getCol(row, ...COLS_COD_ITEM) || null,
      descricao,
      quantidade: parseValor(getColCru(row, ...COLS_QTD)),
      valorUnitario: parseValor(getColCru(row, ...COLS_UNIT)),
      valorTotal: parseValor(getColCru(row, ...COLS_TOTAL)),
    })
    porCotacao.set(chave, lista)
  }

  const empresaDaCotacao = (linhas: Linha[]) =>
    linhas[0].filial === filialJoitec && linhas.some((l) => ehPpr(l.descricao)) ? filialOdinTubos : linhas[0].filial
  // Nº das cotações da filial Joitec que são da Odin Tubos por causa do PPR.
  const pprDaJoitec = new Set<string>()
  for (const linhas of porCotacao.values()) if (linhas[0].filial === filialJoitec && empresaDaCotacao(linhas) === filialOdinTubos) pprDaJoitec.add(linhas[0].numero)

  const acharCliente = await mapaClientes(empresa.id)
  const existentes = await db
    .selectDistinct({ numero: sapCotacoesItens.numeroCotacao })
    .from(sapCotacoesItens)
    .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapCotacoesItens.importacaoId))
    .where(and(eq(sapCotacoesItens.empresaId, empresa.id), eq(sapImportacoes.ativo, true)))
  const jaExiste = new Set(existentes.map((e) => e.numero))

  const naoEncontradas: CotacoesItensResultado['naoEncontradas'] = []
  const paraGravar: (typeof sapCotacoesItens.$inferInsert)[] = []
  // nº → status/valor da planilha (pra atualizar os cabeçalhos).
  const statusPlanilha = new Map<string, Linha['status']>()
  let outraEmpresa = 0
  let foraPeriodo = 0
  let jaImportadas = 0
  let cotacoesPprDaJoitec = 0

  for (const linhas of porCotacao.values()) {
    const l0 = linhas[0]
    if (empresaDaCotacao(linhas) !== filial) {
      outraEmpresa += linhas.length
      continue
    }
    statusPlanilha.set(l0.numero, l0.status)
    if (!l0.data) {
      invalidas.push({ linha: l0.linha, codigo: l0.codigo, nome: l0.nome, numero: l0.numero, motivo: 'Data vazia ou em formato que não reconheci' })
      continue
    }
    if (opts.periodo && (l0.data < opts.periodo.de || l0.data > opts.periodo.ate)) {
      foraPeriodo += linhas.length
      continue
    }
    if (jaExiste.has(l0.numero)) {
      jaImportadas += linhas.length
      continue
    }
    const clienteId = acharCliente(l0.codigo)
    if (!clienteId) {
      naoEncontradas.push({ linha: l0.linha, codigo: l0.codigo, nome: l0.nome, numero: l0.numero, valor: l0.valorCotacao ?? 0, pprDaJoitec: l0.filial !== filial, motivo: 'Cliente não encontrado no CRM pelo código' })
      continue
    }
    if (l0.filial !== filial) cotacoesPprDaJoitec++
    for (const l of linhas) {
      paraGravar.push({
        empresaId: empresa.id,
        importacaoId: 0,
        clienteId,
        codigoCliente: l0.codigo,
        numeroCotacao: l0.numero,
        dataCotacao: l0.data,
        status: l0.status,
        valorCotacao: l0.valorCotacao,
        linha: l.numLinha,
        codigoItem: l.codigoItem,
        descricao: l.descricao,
        quantidade: l.quantidade,
        valorUnitario: l.valorUnitario,
        valorTotal: l.valorTotal,
        filialSap: l0.filial,
      })
    }
  }

  // Cabeçalhos já importados desta empresa: status novo da planilha.
  const cabecalhosDaqui = await db
    .select({ id: sapCotacoesHistorico.id, numero: sapCotacoesHistorico.numeroCotacao, status: sapCotacoesHistorico.status })
    .from(sapCotacoesHistorico)
    .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapCotacoesHistorico.importacaoId))
    .where(and(eq(sapCotacoesHistorico.empresaId, empresa.id), eq(sapImportacoes.ativo, true)))
  const atualizarStatus = cabecalhosDaqui.filter((c) => {
    const novo = statusPlanilha.get(c.numero)
    return novo && novo !== c.status
  })

  // Só na Odin Tubos: cabeçalhos de cotação PPR que estão na Joitec.
  type Mover = typeof sapCotacoesHistorico.$inferSelect & { clienteNovo?: number }
  let mover: Mover[] = []
  const moverSemCliente: CotacoesItensResultado['cabecalhos']['moverSemCliente'] = []
  if (empresa.slug === 'odin-tubos' && pprDaJoitec.size) {
    const joitec = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'joitec'), columns: { id: true } })
    if (joitec) {
      const daJoitec = await db
        .select({ c: sapCotacoesHistorico })
        .from(sapCotacoesHistorico)
        .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapCotacoesHistorico.importacaoId))
        .where(and(eq(sapCotacoesHistorico.empresaId, joitec.id), eq(sapImportacoes.ativo, true)))
      for (const { c } of daJoitec) {
        if (!pprDaJoitec.has(c.numeroCotacao)) continue
        const clienteNovo = acharCliente(c.codigoCliente)
        if (clienteNovo) mover.push({ ...c, clienteNovo })
        else moverSemCliente.push({ numero: c.numeroCotacao, codigo: c.codigoCliente, valor: c.valor })
      }
    }
  }

  const porStatus: Record<string, number> = {}
  const porMes: CotacoesItensResultado['porMes'] = {}
  const cotacoesVistas = new Set<string>()
  for (const l of paraGravar) {
    const mes = l.dataCotacao.slice(0, 7)
    const m = (porMes[mes] ??= { cotacoes: 0, linhas: 0 })
    m.linhas++
    if (cotacoesVistas.has(l.numeroCotacao)) continue
    cotacoesVistas.add(l.numeroCotacao)
    m.cotacoes++
    porStatus[l.status!] = (porStatus[l.status!] ?? 0) + 1
  }
  const valorPorCotacao = new Map(paraGravar.map((l) => [l.numeroCotacao, l.valorCotacao ?? 0]))
  const datas = paraGravar.map((l) => l.dataCotacao).sort()
  const resultado: CotacoesItensResultado = {
    arquivo: nomeArquivo,
    totalLinhas,
    outraEmpresa,
    foraPeriodo,
    jaImportadas,
    linhasImportaveis: paraGravar.length,
    cotacoes: cotacoesVistas.size,
    cotacoesPprDaJoitec,
    clientesDistintos: new Set(paraGravar.map((l) => l.clienteId)).size,
    itensDistintos: new Set(paraGravar.map((l) => l.codigoItem ?? l.descricao)).size,
    valorCotacoes: [...valorPorCotacao.values()].reduce((s, v) => s + v, 0),
    porStatus,
    porMes,
    dataInicio: datas[0] ?? null,
    dataFim: datas[datas.length - 1] ?? null,
    naoEncontradas,
    invalidas,
    cabecalhos: {
      statusAtualizados: atualizarStatus.length,
      mover: { qtd: mover.length, valor: mover.reduce((s, c) => s + c.valor, 0) },
      moverSemCliente,
    },
  }

  if (!opts.confirmar) return resultado

  const ids = await db.transaction(async (tx) => {
    let importacaoId: number | undefined
    if (paraGravar.length) {
      const r = await tx.insert(sapImportacoes).values({
        empresaId: empresa.id,
        tipo: 'cotacoes_itens',
        nomeArquivo,
        importadoPor: opts.usuarioId,
        totalLinhas: resultado.totalLinhas,
        importadas: paraGravar.length,
        naoEncontradas: naoEncontradas.length,
        valorTotal: resultado.valorCotacoes,
        dataInicio: resultado.dataInicio,
        dataFim: resultado.dataFim,
      })
      importacaoId = Number(r.lastInsertRowid)
      for (let i = 0; i < paraGravar.length; i += 500) {
        await tx.insert(sapCotacoesItens).values(paraGravar.slice(i, i + 500).map((l) => ({ ...l, importacaoId: importacaoId! })))
      }
    }
    for (const c of atualizarStatus) {
      await tx.update(sapCotacoesHistorico).set({ status: statusPlanilha.get(c.numero)! }).where(eq(sapCotacoesHistorico.id, c.id))
    }
    let importacaoCabecalhosId: number | undefined
    if (mover.length) {
      const datasMover = mover.map((c) => c.dataCotacao).sort()
      const r = await tx.insert(sapImportacoes).values({
        empresaId: empresa.id,
        tipo: 'cotacoes',
        nomeArquivo: `${nomeArquivo} (cotações PPR que estavam na Joitec)`,
        importadoPor: opts.usuarioId,
        totalLinhas: mover.length,
        importadas: mover.length,
        naoEncontradas: 0,
        valorTotal: resultado.cabecalhos.mover.valor,
        dataInicio: datasMover[0],
        dataFim: datasMover[datasMover.length - 1],
      })
      importacaoCabecalhosId = Number(r.lastInsertRowid)
      for (let i = 0; i < mover.length; i += 500) {
        const bloco = mover.slice(i, i + 500)
        await tx.insert(sapCotacoesHistorico).values(
          bloco.map((c) => ({
            empresaId: empresa.id,
            importacaoId: importacaoCabecalhosId!,
            clienteId: c.clienteNovo!,
            codigoCliente: c.codigoCliente,
            nomeCliente: c.nomeCliente,
            dataCotacao: c.dataCotacao,
            numeroCotacao: c.numeroCotacao,
            valor: c.valor,
            status: statusPlanilha.get(c.numeroCotacao) ?? c.status,
            casadoPor: 'codigo' as const,
          }))
        )
        await tx.delete(sapCotacoesHistorico).where(inArray(sapCotacoesHistorico.id, bloco.map((c) => c.id)))
      }
    }
    return { importacaoId, importacaoCabecalhosId }
  })

  if (ids.importacaoId) {
    await registrarAuditoria({
      tabela: 'sap_importacoes',
      registroId: ids.importacaoId,
      acao: 'criar',
      valorNovo: `${nomeArquivo} · ${resultado.cotacoes} cotações / ${paraGravar.length} itens`,
      alteradoPor: opts.usuarioId,
    })
  }
  if (ids.importacaoCabecalhosId) {
    await registrarAuditoria({
      tabela: 'sap_importacoes',
      registroId: ids.importacaoCabecalhosId,
      acao: 'criar',
      valorNovo: `${mover.length} cotações PPR movidas da Joitec: ${mover.map((c) => c.numeroCotacao).join(',')}`,
      alteradoPor: opts.usuarioId,
    })
  }
  return { ...resultado, ...ids }
}
