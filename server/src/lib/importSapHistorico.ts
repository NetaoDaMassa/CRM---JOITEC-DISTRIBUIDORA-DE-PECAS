import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, sapImportacoes, sapVendasHistorico } from '../db/schema.js'
import { lerLinhasPlanilha, getCol, getColCru, cabecalhosDetectados } from './importClientes.js'
import { registrarAuditoria } from './auditoria.js'

// Importação do histórico de vendas do SAP (pedido do João, 2026-10-20).
// Planilha com: código do cliente, nome, CNPJ, data, nº do pedido e valor.
// Roda em 2 passos com o MESMO arquivo: prévia (não grava nada, mostra o que
// casou/não casou) e confirmação (grava tudo num lote novo). Cliente é achado
// pelo código; não achando, pelo CNPJ/CPF; não achando nenhum, a linha fica
// de fora e volta na lista de "não encontrados" (cliente NÃO é criado).

export interface SapLinhaProblema {
  linha: number
  codigo: string
  nome: string
  cnpj: string
  data: string
  numeroPedido: string
  valor: number | null
  motivo: string
}

export interface SapResultado {
  arquivo: string
  totalLinhas: number
  importaveis: number
  porCodigo: number
  porCnpj: number
  jaImportadas: number
  valorTotal: number
  clientesDistintos: number
  dataInicio: string | null
  dataFim: string | null
  naoEncontradas: SapLinhaProblema[]
  invalidas: SapLinhaProblema[]
  // Só no passo de confirmação.
  importacaoId?: number
}

const COLS_CODIGO = ['Código', 'Codigo', 'Cod', 'Cód', 'Código do Cliente', 'Codigo do Cliente', 'Cód Cliente', 'Cod Cliente', 'Cód. Cliente', 'Cod. Cliente', 'Código Cliente', 'Codigo Cliente', 'CardCode', 'Código PN', 'Codigo PN', 'Cod PN']
const COLS_NOME = ['Nome', 'Nome do Cliente', 'Nome Cliente', 'Razão Social', 'Razao Social', 'Cliente', 'CardName', 'Nome PN']
const COLS_CNPJ = ['CNPJ', 'CPF/CNPJ', 'CNPJ/CPF', 'CPF', 'Documento', 'LicTradNum']
const COLS_DATA = ['Data', 'Data do Pedido', 'Data Pedido', 'Data Emissão', 'Data Emissao', 'Data de Emissão', 'Data de Emissao', 'Data Documento', 'Data do Documento', 'DocDate', 'Dt Pedido', 'Dt. Pedido']
const COLS_PEDIDO = ['Número do Pedido', 'Numero do Pedido', 'Nº do Pedido', 'N° do Pedido', 'Nº Pedido', 'N° Pedido', 'No Pedido', 'Num Pedido', 'Nr Pedido', 'Número Pedido', 'Numero Pedido', 'Pedido', 'DocNum', 'Documento SAP']
const COLS_VALOR = ['Valor', 'Valor Total', 'Total', 'Valor do Pedido', 'Valor Pedido', 'Vlr Total', 'Vlr. Total', 'DocTotal']

// Excel salva número inteiro como "123.0" às vezes — e o SAP às vezes manda
// código com zeros à esquerda que o CRM não tem (ou o contrário). Compara
// sem isso tudo.
function limparCodigo(c: string): string {
  return c.trim().replace(/\.0+$/, '').toUpperCase()
}
function semZerosEsquerda(c: string): string {
  return c.replace(/^0+(?=.)/, '')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Excel manda data como número de série (dias desde 1899-12-30); CSV manda
// texto "dd/mm/aaaa" (ou "aaaa-mm-dd"). Devolve YYYY-MM-DD ou null.
function parseData(cru: unknown): string | null {
  if (typeof cru === 'number' && cru > 20000 && cru < 80000) {
    const d = new Date(Math.round((cru - 25569) * 86400000))
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  }
  if (cru instanceof Date && !Number.isNaN(cru.getTime())) {
    return `${cru.getFullYear()}-${pad2(cru.getMonth() + 1)}-${pad2(cru.getDate())}`
  }
  const t = String(cru ?? '').trim()
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return valida(Number(m[1]), Number(m[2]), Number(m[3]))
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return valida(ano, Number(m[2]), Number(m[1]))
  }
  return null
}
function valida(ano: number, mes: number, dia: number): string | null {
  if (ano < 1990 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  return `${ano}-${pad2(mes)}-${pad2(dia)}`
}

// Mesmas regras do parseValorBr do client (client/src/lib/valorBr.ts):
// "1.234,56", "1234,56", "1,234.56", "R$ 1.500" — o que vier por último
// entre vírgula e ponto é o decimal; só ponto com 3 dígitos depois = milhar.
function parseValor(cru: unknown): number | null {
  if (typeof cru === 'number') return Number.isFinite(cru) ? cru : null
  let limpo = String(cru ?? '').replace(/[^\d,.-]/g, '')
  if (!limpo || !/\d/.test(limpo)) return null
  const temVirgula = limpo.includes(',')
  const temPonto = limpo.includes('.')
  if (temVirgula && temPonto) {
    limpo = limpo.lastIndexOf(',') > limpo.lastIndexOf('.') ? limpo.replace(/\./g, '').replace(',', '.') : limpo.replace(/,/g, '')
  } else if (temVirgula) {
    limpo = limpo.replace(/\./g, '').replace(',', '.')
  } else if (temPonto) {
    const partes = limpo.split('.')
    if (partes.length > 2 || partes[partes.length - 1].length === 3) limpo = limpo.replace(/\./g, '')
  }
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

export async function processarHistoricoSap(
  buffer: Buffer,
  nomeArquivo: string,
  empresaId: number,
  opts: { confirmar: boolean; usuarioId: number }
): Promise<SapResultado> {
  const rows = lerLinhasPlanilha(buffer, nomeArquivo, { csvTextoPuro: true })

  // Todos os clientes da empresa de uma vez (milhares de linhas no SAP —
  // 1 query por linha ficaria lento demais).
  const lista = await db.query.clientes.findMany({
    where: and(eq(clientes.empresaId, empresaId), isNull(clientes.deletedAt)),
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

  // Reimportar o mesmo arquivo (ou um período que se sobrepõe) não pode
  // duplicar — pula linha idêntica (cliente+pedido+data+valor) que já está
  // num lote ATIVO. Lote desligado não conta: dá pra desligar o errado e
  // importar o corrigido por cima.
  const existentes = await db
    .select({
      clienteId: sapVendasHistorico.clienteId,
      numeroPedido: sapVendasHistorico.numeroPedido,
      dataPedido: sapVendasHistorico.dataPedido,
      valor: sapVendasHistorico.valor,
    })
    .from(sapVendasHistorico)
    .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapVendasHistorico.importacaoId))
    .where(and(eq(sapVendasHistorico.empresaId, empresaId), eq(sapImportacoes.ativo, true)))
  const chave = (clienteId: number, pedido: string | null, data: string, valor: number) => `${clienteId}|${pedido ?? ''}|${data}|${valor.toFixed(2)}`
  const jaExiste = new Set(existentes.map((e) => chave(e.clienteId, e.numeroPedido, e.dataPedido, e.valor)))

  const naoEncontradas: SapLinhaProblema[] = []
  const invalidas: SapLinhaProblema[] = []
  const paraGravar: (typeof sapVendasHistorico.$inferInsert)[] = []
  let porCodigo = 0
  let porCnpj = 0
  let jaImportadas = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const linha = i + 2
    const codigo = limparCodigo(getCol(row, ...COLS_CODIGO))
    const nome = getCol(row, ...COLS_NOME)
    const cnpjCru = getCol(row, ...COLS_CNPJ)
    const documento = cnpjCru.replace(/\D/g, '')
    const numeroPedido = getCol(row, ...COLS_PEDIDO).replace(/\.0+$/, '')
    const data = parseData(getColCru(row, ...COLS_DATA))
    const valor = parseValor(getColCru(row, ...COLS_VALOR))
    const base = { linha, codigo, nome, cnpj: cnpjCru, data: data ?? String(getColCru(row, ...COLS_DATA) ?? ''), numeroPedido, valor }

    // Linha totalmente vazia (rodapé, linha em branco no meio) — ignora calado.
    if (!codigo && !nome && !documento && !numeroPedido && valor == null) continue

    if (!codigo && !documento) {
      invalidas.push({ ...base, motivo: `Sem código e sem CNPJ (colunas encontradas: ${cabecalhosDetectados(row)})` })
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

    const k = chave(clienteId, numeroPedido || null, data, valor)
    if (jaExiste.has(k)) {
      jaImportadas++
      continue
    }

    if (casadoPor === 'codigo') porCodigo++
    else porCnpj++
    paraGravar.push({
      empresaId,
      importacaoId: 0,
      clienteId,
      codigoCliente: codigo || null,
      nomeCliente: nome || null,
      cnpj: documento || null,
      dataPedido: data,
      numeroPedido: numeroPedido || null,
      valor,
      casadoPor,
    })
  }

  const datas = paraGravar.map((l) => l.dataPedido).sort()
  const resultado: SapResultado = {
    arquivo: nomeArquivo,
    totalLinhas: paraGravar.length + naoEncontradas.length + invalidas.length + jaImportadas,
    importaveis: paraGravar.length,
    porCodigo,
    porCnpj,
    jaImportadas,
    valorTotal: paraGravar.reduce((s, l) => s + l.valor, 0),
    clientesDistintos: new Set(paraGravar.map((l) => l.clienteId)).size,
    dataInicio: datas[0] ?? null,
    dataFim: datas[datas.length - 1] ?? null,
    naoEncontradas,
    invalidas,
  }

  if (!opts.confirmar || paraGravar.length === 0) return resultado

  // Tudo ou nada — se cair no meio, não sobra lote pela metade.
  const importacaoId = await db.transaction(async (tx) => {
    const r = await tx.insert(sapImportacoes).values({
      empresaId,
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
      await tx.insert(sapVendasHistorico).values(paraGravar.slice(i, i + 500).map((l) => ({ ...l, importacaoId: id })))
    }
    return id
  })
  await registrarAuditoria({
    tabela: 'sap_importacoes',
    registroId: importacaoId,
    acao: 'criar',
    valorNovo: `${nomeArquivo} · ${paraGravar.length} linhas`,
    alteradoPor: opts.usuarioId,
  })
  return { ...resultado, importacaoId }
}
