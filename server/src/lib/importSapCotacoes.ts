import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, sapCotacoesHistorico, sapImportacoes } from '../db/schema.js'
import { lerLinhasPlanilha, getCol, getColCru, cabecalhosDetectados, normalizarTexto } from './importClientes.js'
import { limparCodigo, parseData, parseValor, semZerosEsquerda } from './importSapHistorico.js'
import { registrarAuditoria } from './auditoria.js'

// Importação das cotações/orçamentos do SAP (pedido do João, 2026-10-20) —
// mesma lógica do histórico de vendas (importSapHistorico.ts): prévia e
// confirmação com o mesmo arquivo, cliente achado pelo código (ou CNPJ),
// cliente desconhecido não é criado. Diferenças:
//   - A planilha do SAP traz as 3 empresas juntas (coluna "Filial") — só
//     entra a linha da filial da empresa escolhida.
//   - Nº da cotação é único por empresa: reimportar pula o que já está num
//     lote LIGADO (desligar o lote errado e importar de novo funciona).

// Nome da filial no SAP de cada empresa do CRM (slug).
export const FILIAL_POR_SLUG: Record<string, string> = {
  joitec: 'joitec distribuidora',
  'odin-tubos': 'odin tubos',
  'odin-compressores': 'odin compressores',
}

const COLS_FILIAL = ['Filial', 'Nome Filial', 'Empresa']
const COLS_CODIGO = ['Código do Cliente', 'Codigo do Cliente', 'Código', 'Codigo', 'Cód. Cliente', 'Cod Cliente', 'CardCode', 'Código PN', 'Codigo PN']
const COLS_NOME = ['Nome do Cliente', 'Nome', 'Cliente', 'Razão Social', 'Razao Social', 'CardName']
const COLS_CNPJ = ['CNPJ', 'CPF/CNPJ', 'CNPJ/CPF', 'CPF', 'LicTradNum']
const COLS_NUMERO = ['Nº da Cotação', 'N° da Cotação', 'Número da Cotação', 'Numero da Cotacao', 'Nº Cotação', 'Cotação', 'Nº do Orçamento', 'Número do Orçamento', 'Orçamento', 'DocNum']
const COLS_DATA = ['Data da Cotação', 'Data Cotação', 'Data do Orçamento', 'Data', 'DocDate']
const COLS_VALOR = ['Valor da Cotação', 'Valor Cotação', 'Valor do Orçamento', 'Valor', 'Valor Total', 'DocTotal']
const COLS_STATUS = ['Status', 'Situação', 'Situacao']

function statusDe(cru: string): 'aberto' | 'fechado' | 'cancelado' | 'outro' {
  const s = normalizarTexto(cru)
  if (s.startsWith('abert')) return 'aberto'
  if (s.startsWith('fechad')) return 'fechado'
  if (s.startsWith('cancel')) return 'cancelado'
  return 'outro'
}

export interface CotacaoLinhaProblema {
  linha: number
  codigo: string
  nome: string
  numero: string
  data: string
  valor: number | null
  motivo: string
}

export interface CotacoesResultado {
  arquivo: string
  totalLinhas: number
  outraEmpresa: number
  foraPeriodo: number
  jaImportadas: number
  importaveis: number
  porCodigo: number
  porCnpj: number
  valorTotal: number
  porStatus: Record<string, { qtd: number; valor: number }>
  porMes: Record<string, number>
  clientesDistintos: number
  dataInicio: string | null
  dataFim: string | null
  naoEncontradas: CotacaoLinhaProblema[]
  invalidas: CotacaoLinhaProblema[]
  importacaoId?: number
}

export async function processarCotacoesSap(
  buffer: Buffer,
  nomeArquivo: string,
  empresa: { id: number; slug: string },
  opts: { confirmar: boolean; usuarioId: number; periodo?: { de: string; ate: string } }
): Promise<CotacoesResultado> {
  const filial = FILIAL_POR_SLUG[empresa.slug]
  if (!filial) throw new Error(`Não sei qual é a filial do SAP da empresa "${empresa.slug}"`)
  const rows = lerLinhasPlanilha(buffer, nomeArquivo, { csvTextoPuro: true })

  const lista = await db.query.clientes.findMany({
    where: and(eq(clientes.empresaId, empresa.id), isNull(clientes.deletedAt)),
    columns: { id: true, codigo: true, codigoAntigo: true, cnpj: true, cpf: true },
  })
  const porCodigoExato = new Map<string, number>()
  const porCodigoSemZero = new Map<string, number>()
  const porDocumento = new Map<string, number>()
  for (const c of lista) {
    for (const cod of [c.codigo, c.codigoAntigo]) {
      if (!cod) continue
      const limpo = limparCodigo(cod)
      if (!porCodigoExato.has(limpo)) porCodigoExato.set(limpo, c.id)
      const sz = semZerosEsquerda(limpo)
      if (!porCodigoSemZero.has(sz)) porCodigoSemZero.set(sz, c.id)
    }
    for (const doc of [c.cnpj, c.cpf]) {
      const d = (doc ?? '').replace(/\D/g, '')
      if (d && !porDocumento.has(d)) porDocumento.set(d, c.id)
    }
  }

  const existentes = await db
    .select({ numero: sapCotacoesHistorico.numeroCotacao })
    .from(sapCotacoesHistorico)
    .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapCotacoesHistorico.importacaoId))
    .where(and(eq(sapCotacoesHistorico.empresaId, empresa.id), eq(sapImportacoes.ativo, true)))
  const jaExiste = new Set(existentes.map((e) => e.numero))
  const vistosNoArquivo = new Set<string>()

  const naoEncontradas: CotacaoLinhaProblema[] = []
  const invalidas: CotacaoLinhaProblema[] = []
  const paraGravar: (typeof sapCotacoesHistorico.$inferInsert)[] = []
  let porCodigo = 0
  let porCnpj = 0
  let jaImportadas = 0
  let foraPeriodo = 0
  let outraEmpresa = 0
  let totalLinhas = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const linha = i + 2
    const codigo = limparCodigo(getCol(row, ...COLS_CODIGO))
    const nome = getCol(row, ...COLS_NOME)
    const documento = getCol(row, ...COLS_CNPJ).replace(/\D/g, '')
    const numero = getCol(row, ...COLS_NUMERO).replace(/\.0+$/, '')
    const data = parseData(getColCru(row, ...COLS_DATA))
    const valor = parseValor(getColCru(row, ...COLS_VALOR))
    const base = { linha, codigo, nome, numero, data: data ?? String(getColCru(row, ...COLS_DATA) ?? ''), valor }

    if (!codigo && !nome && !documento && !numero && valor == null) continue
    totalLinhas++

    if (!normalizarTexto(getCol(row, ...COLS_FILIAL)).includes(filial)) {
      outraEmpresa++
      continue
    }
    if (!codigo && !documento) {
      invalidas.push({ ...base, motivo: `Sem código e sem CNPJ (colunas encontradas: ${cabecalhosDetectados(row)})` })
      continue
    }
    if (!numero) {
      invalidas.push({ ...base, motivo: 'Sem número da cotação' })
      continue
    }
    if (!data) {
      invalidas.push({ ...base, motivo: 'Data vazia ou em formato que não reconheci' })
      continue
    }
    if (valor == null) {
      invalidas.push({ ...base, motivo: 'Valor vazio ou inválido' })
      continue
    }
    if (opts.periodo && (data < opts.periodo.de || data > opts.periodo.ate)) {
      foraPeriodo++
      continue
    }
    if (jaExiste.has(numero) || vistosNoArquivo.has(numero)) {
      jaImportadas++
      continue
    }

    let clienteId: number | undefined
    let casadoPor: 'codigo' | 'cnpj' = 'codigo'
    if (codigo) clienteId = porCodigoExato.get(codigo) ?? porCodigoSemZero.get(semZerosEsquerda(codigo))
    if (!clienteId && documento) {
      clienteId = porDocumento.get(documento)
      casadoPor = 'cnpj'
    }
    if (!clienteId) {
      naoEncontradas.push({ ...base, motivo: 'Cliente não encontrado no CRM (nem pelo código, nem pelo CNPJ)' })
      continue
    }

    vistosNoArquivo.add(numero)
    if (casadoPor === 'codigo') porCodigo++
    else porCnpj++
    paraGravar.push({
      empresaId: empresa.id,
      importacaoId: 0,
      clienteId,
      codigoCliente: codigo || null,
      nomeCliente: nome || null,
      dataCotacao: data,
      numeroCotacao: numero,
      valor,
      status: statusDe(getCol(row, ...COLS_STATUS)),
      casadoPor,
    })
  }

  const porStatus: CotacoesResultado['porStatus'] = {}
  const porMes: Record<string, number> = {}
  for (const l of paraGravar) {
    const s = (porStatus[l.status!] ??= { qtd: 0, valor: 0 })
    s.qtd++
    s.valor += l.valor
    porMes[l.dataCotacao.slice(0, 7)] = (porMes[l.dataCotacao.slice(0, 7)] ?? 0) + 1
  }
  const datas = paraGravar.map((l) => l.dataCotacao).sort()
  const resultado: CotacoesResultado = {
    arquivo: nomeArquivo,
    totalLinhas,
    outraEmpresa,
    foraPeriodo,
    jaImportadas,
    importaveis: paraGravar.length,
    porCodigo,
    porCnpj,
    valorTotal: paraGravar.reduce((s, l) => s + l.valor, 0),
    porStatus,
    porMes,
    clientesDistintos: new Set(paraGravar.map((l) => l.clienteId)).size,
    dataInicio: datas[0] ?? null,
    dataFim: datas[datas.length - 1] ?? null,
    naoEncontradas,
    invalidas,
  }

  if (!opts.confirmar || paraGravar.length === 0) return resultado

  const importacaoId = await db.transaction(async (tx) => {
    const r = await tx.insert(sapImportacoes).values({
      empresaId: empresa.id,
      tipo: 'cotacoes',
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
      await tx.insert(sapCotacoesHistorico).values(paraGravar.slice(i, i + 500).map((l) => ({ ...l, importacaoId: id })))
    }
    return id
  })
  await registrarAuditoria({
    tabela: 'sap_importacoes',
    registroId: importacaoId,
    acao: 'criar',
    valorNovo: `${nomeArquivo} · ${paraGravar.length} cotações`,
    alteradoPor: opts.usuarioId,
  })
  return { ...resultado, importacaoId }
}
