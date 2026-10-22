import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, sapImportacoes, sapItensHistorico } from '../db/schema.js'
import { lerLinhasPlanilha, getCol, getColCru, cabecalhosDetectados, normalizarTexto } from './importClientes.js'
import { limparCodigo, parseData, parseValor, semZerosEsquerda } from './importSapHistorico.js'
import { FILIAL_POR_SLUG } from './importSapCotacoes.js'
import { registrarAuditoria } from './auditoria.js'

// Importação dos ITENS das notas de venda do SAP (pedido do João,
// 2026-10-21, planilha "RELATORIO DE COTAÇÕES SAP DETALHADO" — apesar do
// nome, são notas faturadas: Tipo Venda/Devolução + Nº da Nota). Mesmo
// fluxo das cotações (importSapCotacoes.ts): prévia e confirmação, cliente
// achado pelo código, cliente desconhecido não é criado, só a filial da
// empresa escolhida. Diferenças:
//   - Só "Venda" entra; devolução é contada na prévia e ignorada.
//   - A nota inteira é a unidade: nº da nota já num lote LIGADO dessa
//     empresa → todas as linhas dela são puladas (reimportar não duplica).
//   - Nada disso soma no faturamento (ver sapItensHistorico no schema).

const COLS_FILIAL = ['Filial', 'Nome Filial', 'Empresa']
const COLS_CODIGO = ['Código do Cliente', 'Codigo do Cliente', 'Código PN', 'Codigo PN', 'CardCode']
const COLS_NOME = ['Nome do Cliente', 'Nome', 'Cliente', 'CardName']
const COLS_TIPO = ['Tipo', 'Tipo de Documento']
const COLS_NOTA = ['Nº da Nota', 'N° da Nota', 'Número da Nota', 'Numero da Nota', 'Nota', 'DocNum']
const COLS_DATA = ['Data', 'Data da Nota', 'DocDate']
const COLS_COD_ITEM = ['Código do Item', 'Codigo do Item', 'ItemCode']
const COLS_DESCRICAO = ['Descrição do Item', 'Descricao do Item', 'Descrição', 'Descricao', 'Dscription']
const COLS_QTD = ['Quantidade', 'Qtd', 'Quantity']
const COLS_UNIT = ['Preço Unitário', 'Preco Unitario', 'Price']
const COLS_TOTAL = ['Total da Linha', 'Total Linha', 'LineTotal']

export interface ItemLinhaProblema {
  linha: number
  codigo: string
  nome: string
  nota: string
  motivo: string
}

export interface ItensResultado {
  arquivo: string
  totalLinhas: number
  outraEmpresa: number
  devolucoes: number
  foraPeriodo: number
  jaImportadas: number
  linhasImportaveis: number
  notas: number
  clientesDistintos: number
  itensDistintos: number
  valorTotal: number
  porMes: Record<string, { notas: number; linhas: number }>
  dataInicio: string | null
  dataFim: string | null
  naoEncontradas: (ItemLinhaProblema & { valor: number })[]
  invalidas: ItemLinhaProblema[]
  importacaoId?: number
}

export async function processarItensSap(
  buffer: Buffer,
  nomeArquivo: string,
  empresa: { id: number; slug: string },
  opts: { confirmar: boolean; usuarioId: number; periodo?: { de: string; ate: string } }
): Promise<ItensResultado> {
  const filial = FILIAL_POR_SLUG[empresa.slug]
  if (!filial) throw new Error(`Não sei qual é a filial do SAP da empresa "${empresa.slug}"`)
  const rows = lerLinhasPlanilha(buffer, nomeArquivo, { csvTextoPuro: true })

  const lista = await db.query.clientes.findMany({
    where: and(eq(clientes.empresaId, empresa.id), isNull(clientes.deletedAt)),
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

  const existentes = await db
    .selectDistinct({ nota: sapItensHistorico.numeroNota })
    .from(sapItensHistorico)
    .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapItensHistorico.importacaoId))
    .where(and(eq(sapItensHistorico.empresaId, empresa.id), eq(sapImportacoes.ativo, true)))
  const jaExiste = new Set(existentes.map((e) => e.nota))

  const naoEncontradas: ItensResultado['naoEncontradas'] = []
  const invalidas: ItemLinhaProblema[] = []
  const paraGravar: (typeof sapItensHistorico.$inferInsert)[] = []
  let totalLinhas = 0
  let outraEmpresa = 0
  let devolucoes = 0
  let foraPeriodo = 0
  let jaImportadas = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const linha = i + 2
    const codigo = limparCodigo(getCol(row, ...COLS_CODIGO))
    const nome = getCol(row, ...COLS_NOME)
    const nota = getCol(row, ...COLS_NOTA).replace(/\.0+$/, '')
    const descricao = getCol(row, ...COLS_DESCRICAO)
    const base = { linha, codigo, nome, nota }

    if (!codigo && !nota && !descricao) continue
    totalLinhas++

    if (!normalizarTexto(getCol(row, ...COLS_FILIAL)).includes(filial)) {
      outraEmpresa++
      continue
    }
    if (!normalizarTexto(getCol(row, ...COLS_TIPO)).startsWith('venda')) {
      devolucoes++
      continue
    }
    const data = parseData(getColCru(row, ...COLS_DATA))
    if (!codigo) {
      invalidas.push({ ...base, motivo: `Sem código do cliente (colunas encontradas: ${cabecalhosDetectados(row)})` })
      continue
    }
    if (!nota) {
      invalidas.push({ ...base, motivo: 'Sem número da nota' })
      continue
    }
    if (!data) {
      invalidas.push({ ...base, motivo: 'Data vazia ou em formato que não reconheci' })
      continue
    }
    if (!descricao) {
      invalidas.push({ ...base, motivo: 'Linha sem descrição do item' })
      continue
    }
    if (opts.periodo && (data < opts.periodo.de || data > opts.periodo.ate)) {
      foraPeriodo++
      continue
    }
    if (jaExiste.has(nota)) {
      jaImportadas++
      continue
    }
    const valorTotal = parseValor(getColCru(row, ...COLS_TOTAL))
    const clienteId = porCodigoExato.get(codigo) ?? porCodigoSemZero.get(semZerosEsquerda(codigo))
    if (!clienteId) {
      naoEncontradas.push({ ...base, valor: valorTotal ?? 0, motivo: 'Cliente não encontrado no CRM pelo código' })
      continue
    }

    paraGravar.push({
      empresaId: empresa.id,
      importacaoId: 0,
      clienteId,
      codigoCliente: codigo,
      numeroNota: nota,
      dataNota: data,
      codigoItem: getCol(row, ...COLS_COD_ITEM) || null,
      descricao,
      quantidade: parseValor(getColCru(row, ...COLS_QTD)),
      valorUnitario: parseValor(getColCru(row, ...COLS_UNIT)),
      valorTotal,
    })
  }

  const porMes: ItensResultado['porMes'] = {}
  const notasPorMes = new Map<string, Set<string>>()
  for (const l of paraGravar) {
    const mes = l.dataNota.slice(0, 7)
    const m = (porMes[mes] ??= { notas: 0, linhas: 0 })
    m.linhas++
    const s = notasPorMes.get(mes) ?? new Set<string>()
    s.add(l.numeroNota)
    notasPorMes.set(mes, s)
  }
  for (const [mes, s] of notasPorMes) porMes[mes].notas = s.size
  const datas = paraGravar.map((l) => l.dataNota).sort()
  const resultado: ItensResultado = {
    arquivo: nomeArquivo,
    totalLinhas,
    outraEmpresa,
    devolucoes,
    foraPeriodo,
    jaImportadas,
    linhasImportaveis: paraGravar.length,
    notas: new Set(paraGravar.map((l) => l.numeroNota)).size,
    clientesDistintos: new Set(paraGravar.map((l) => l.clienteId)).size,
    itensDistintos: new Set(paraGravar.map((l) => l.codigoItem ?? l.descricao)).size,
    valorTotal: paraGravar.reduce((s, l) => s + (l.valorTotal ?? 0), 0),
    porMes,
    dataInicio: datas[0] ?? null,
    dataFim: datas[datas.length - 1] ?? null,
    naoEncontradas,
    invalidas,
  }

  if (!opts.confirmar || paraGravar.length === 0) return resultado

  const importacaoId = await db.transaction(async (tx) => {
    const r = await tx.insert(sapImportacoes).values({
      empresaId: empresa.id,
      tipo: 'itens',
      nomeArquivo,
      importadoPor: opts.usuarioId,
      totalLinhas: resultado.totalLinhas,
      importadas: paraGravar.length,
      naoEncontradas: naoEncontradas.length,
      valorTotal: resultado.valorTotal,
      dataInicio: resultado.dataInicio,
      dataFim: resultado.dataFim,
    })
    const id = Number(r.lastInsertRowid)
    for (let i = 0; i < paraGravar.length; i += 500) {
      await tx.insert(sapItensHistorico).values(paraGravar.slice(i, i + 500).map((l) => ({ ...l, importacaoId: id })))
    }
    return id
  })
  await registrarAuditoria({
    tabela: 'sap_importacoes',
    registroId: importacaoId,
    acao: 'criar',
    valorNovo: `${nomeArquivo} · ${resultado.notas} notas / ${paraGravar.length} itens`,
    alteradoPor: opts.usuarioId,
  })
  return { ...resultado, importacaoId }
}
