import fs from 'fs/promises'
import path from 'path'
import { and, asc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { db } from '../db/client.js'
import { cartaoGastos, cartaoGastoAnexos, users, empresas } from '../db/schema.js'

// Relatório do Cartão de Crédito — pedido do João, 2026-11-24: separar por
// vendedor, separar por datas, imprimir todos os PDFs/anexos por vendedor e
// gerar relatório. Usado pela tela (tRPC cartao.relatorio) e pelo PDF com
// os anexos (/api/cartao-credito-pdf), pra os dois mostrarem a mesma coisa.

export const CATEGORIAS_CARTAO = ['combustivel', 'alimentacao', 'hospedagem', 'pedagio', 'estacionamento', 'manutencao', 'outro'] as const
export type CategoriaCartao = (typeof CATEGORIAS_CARTAO)[number]

export const CATEGORIA_LABEL: Record<string, string> = {
  combustivel: 'Combustível',
  alimentacao: 'Alimentação',
  hospedagem: 'Hospedagem',
  pedagio: 'Pedágio',
  estacionamento: 'Estacionamento',
  manutencao: 'Manutenção',
  outro: 'Outro',
}

export const FORMAS_CARTAO = ['cartao', 'dinheiro'] as const
export const FORMA_LABEL: Record<string, string> = { cartao: 'Cartão de crédito', dinheiro: 'Dinheiro' }

export type FiltroCartao = { de: string; ate: string; vendedorId?: number }
export type EscopoCartao = { superAdmin: boolean; empresaId: number | null }

export async function buscarGastosCartao(escopo: EscopoCartao, filtro: FiltroCartao) {
  const condicoes: SQL[] = [gte(cartaoGastos.data, filtro.de), lte(cartaoGastos.data, filtro.ate)]
  // Quem tem a permissão vê todas as empresas desde 2026-11-25 (o financeiro
  // cuida do grupo inteiro e vendedor como o Sergio lança de várias contas) —
  // as rotas passam superAdmin: true. Escopo por empresa fica pra quem chamar.
  if (!escopo.superAdmin) condicoes.push(eq(users.empresaId, escopo.empresaId ?? -1))
  if (filtro.vendedorId) condicoes.push(eq(cartaoGastos.vendedorId, filtro.vendedorId))

  const lancamentos = await db
    .select({
      id: cartaoGastos.id,
      data: cartaoGastos.data,
      valor: cartaoGastos.valor,
      categoria: cartaoGastos.categoria,
      descricao: cartaoGastos.descricao,
      formaPagamento: cartaoGastos.formaPagamento,
      vendedorId: cartaoGastos.vendedorId,
      vendedorNome: users.name,
      empresaNome: empresas.nome,
    })
    .from(cartaoGastos)
    .innerJoin(users, eq(users.id, cartaoGastos.vendedorId))
    .innerJoin(empresas, eq(empresas.id, users.empresaId))
    .where(and(...condicoes))
    .orderBy(asc(users.name), asc(cartaoGastos.data), asc(cartaoGastos.id))

  const anexos = lancamentos.length
    ? await db.query.cartaoGastoAnexos.findMany({ where: inArray(cartaoGastoAnexos.gastoId, lancamentos.map((l) => l.id)) })
    : []
  const comAnexos = lancamentos.map((l) => ({ ...l, anexos: anexos.filter((a) => a.gastoId === l.id) }))

  // Agrupado por vendedor (já vem ordenado por nome), com total por categoria.
  const porVendedor: {
    vendedorId: number
    vendedorNome: string
    empresaNome: string
    total: number
    qtd: number
    semAnexo: number
    totalCartao: number
    totalDinheiro: number
    porCategoria: { categoria: string; total: number; qtd: number }[]
    lancamentos: typeof comAnexos
  }[] = []
  for (const l of comAnexos) {
    let g = porVendedor.find((v) => v.vendedorId === l.vendedorId)
    if (!g) {
      g = { vendedorId: l.vendedorId, vendedorNome: l.vendedorNome, empresaNome: l.empresaNome, total: 0, qtd: 0, semAnexo: 0, totalCartao: 0, totalDinheiro: 0, porCategoria: [], lancamentos: [] }
      porVendedor.push(g)
    }
    g.total += l.valor
    g.qtd++
    if (l.formaPagamento === 'dinheiro') g.totalDinheiro += l.valor
    else g.totalCartao += l.valor
    if (!l.anexos.length) g.semAnexo++
    g.lancamentos.push(l)
    const cat = l.categoria ?? 'sem_categoria'
    const c = g.porCategoria.find((x) => x.categoria === cat)
    if (c) {
      c.total += l.valor
      c.qtd++
    } else g.porCategoria.push({ categoria: cat, total: l.valor, qtd: 1 })
  }
  for (const g of porVendedor) g.porCategoria.sort((a, b) => b.total - a.total)

  return {
    totalGeral: comAnexos.reduce((s, l) => s + l.valor, 0),
    quantidadeGeral: comAnexos.length,
    totalCartao: comAnexos.filter((l) => l.formaPagamento !== 'dinheiro').reduce((s, l) => s + l.valor, 0),
    totalDinheiro: comAnexos.filter((l) => l.formaPagamento === 'dinheiro').reduce((s, l) => s + l.valor, 0),
    porVendedor,
  }
}

// Quem já lançou gasto (pro filtro de vendedor da tela), dentro do escopo.
export async function vendedoresComGasto(escopo: EscopoCartao) {
  const rows = await db
    .selectDistinct({ id: users.id, nome: users.name, empresaNome: empresas.nome })
    .from(cartaoGastos)
    .innerJoin(users, eq(users.id, cartaoGastos.vendedorId))
    .innerJoin(empresas, eq(empresas.id, users.empresaId))
    .where(escopo.superAdmin ? undefined : eq(users.empresaId, escopo.empresaId ?? -1))
    .orderBy(asc(users.name))
  return rows
}

// ── PDF ──────────────────────────────────────────────────────────────────────
// Um PDF só: para cada vendedor, uma folha de resumo (lista dos gastos +
// total por categoria) e depois todos os comprovantes, cada um com uma faixa
// em cima dizendo de qual gasto é. Foto JPG/PNG vira página; PDF tem as
// páginas copiadas. Formato que não dá pra embutir (HEIC, WEBP...) ganha uma
// página avisando, pra não sumir em silêncio.

const A4: [number, number] = [595.28, 841.89]
const MARGEM = 40

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function dataBr(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}
// Helvetica padrão só tem os caracteres WinAnsi (acentos do português ok).
function limpar(t: string) {
  return t
    .normalize('NFC')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E -ÿ]/g, '')
}
function cortar(t: string, font: PDFFont, tam: number, largura: number) {
  let s = limpar(t)
  if (font.widthOfTextAtSize(s, tam) <= largura) return s
  while (s.length > 1 && font.widthOfTextAtSize(s + '...', tam) > largura) s = s.slice(0, -1)
  return s + '...'
}

function rotuloGasto(l: { data: string; categoria: string | null; valor: number; descricao: string | null; formaPagamento: string }) {
  return [dataBr(l.data), l.categoria ? CATEGORIA_LABEL[l.categoria] ?? l.categoria : 'Sem categoria', brl(l.valor), FORMA_LABEL[l.formaPagamento] ?? '', l.descricao ?? ''].filter(Boolean).join('  ·  ')
}

function faixa(page: PDFPage, font: PDFFont, bold: PDFFont, titulo: string, sub: string) {
  const { width, height } = page.getSize()
  page.drawRectangle({ x: 0, y: height - 44, width, height: 44, color: rgb(1, 1, 1), opacity: 0.92 })
  page.drawText(cortar(titulo, bold, 11, width - 2 * MARGEM), { x: MARGEM / 2, y: height - 19, size: 11, font: bold, color: rgb(0.1, 0.1, 0.1) })
  page.drawText(cortar(sub, font, 9, width - 2 * MARGEM), { x: MARGEM / 2, y: height - 35, size: 9, font, color: rgb(0.3, 0.3, 0.3) })
  page.drawLine({ start: { x: 0, y: height - 44 }, end: { x: width, y: height - 44 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) })
}

function caminhoDoUpload(uploadsDir: string, url: string) {
  const nome = path.basename(url.split('?')[0])
  return path.resolve(uploadsDir, nome)
}

export async function gerarPdfCartao(dados: Awaited<ReturnType<typeof buscarGastosCartao>>, filtro: FiltroCartao, uploadsDir: string) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const periodo = `${dataBr(filtro.de)} a ${dataBr(filtro.ate)}`

  if (!dados.porVendedor.length) {
    const p = doc.addPage(A4)
    p.drawText('Nenhum gasto no período ' + periodo, { x: MARGEM, y: A4[1] - 80, size: 14, font: bold })
  }

  for (const v of dados.porVendedor) {
    // Folha de resumo do vendedor
    let page = doc.addPage(A4)
    let y = A4[1] - MARGEM
    const linha = (texto: string, opts: { x?: number; size?: number; b?: boolean; cor?: [number, number, number]; largura?: number } = {}) => {
      const size = opts.size ?? 10
      const f = opts.b ? bold : font
      page.drawText(cortar(texto, f, size, opts.largura ?? A4[0] - 2 * MARGEM), { x: opts.x ?? MARGEM, y, size, font: f, color: rgb(...(opts.cor ?? [0.1, 0.1, 0.1])) })
    }
    linha('Cartão de Crédito - Relatório de gastos', { size: 9, cor: [0.4, 0.4, 0.4] })
    y -= 22
    linha(v.vendedorNome, { size: 18, b: true })
    y -= 16
    linha(`${v.empresaNome}  ·  Período: ${periodo}`, { size: 10, cor: [0.3, 0.3, 0.3] })
    y -= 26
    linha(`Total: ${brl(v.total)}   (${v.qtd} gasto${v.qtd === 1 ? '' : 's'}${v.semAnexo ? `, ${v.semAnexo} sem comprovante` : ''})`, { size: 12, b: true })
    y -= 16
    linha(`Cartão de crédito: ${brl(v.totalCartao)}   ·   Dinheiro: ${brl(v.totalDinheiro)}`, { size: 10 })
    y -= 22
    linha('Por tipo de gasto', { size: 9, cor: [0.4, 0.4, 0.4] })
    y -= 14
    for (const c of v.porCategoria) {
      linha(c.categoria === 'sem_categoria' ? 'Sem categoria (lançado antes da regra)' : CATEGORIA_LABEL[c.categoria] ?? c.categoria, { size: 10 })
      const t = `${brl(c.total)} (${c.qtd})`
      page.drawText(t, { x: A4[0] - MARGEM - font.widthOfTextAtSize(t, 10), y, size: 10, font })
      y -= 14
    }
    y -= 14

    const colunas = [MARGEM, MARGEM + 58, MARGEM + 145, A4[0] - MARGEM - 175, A4[0] - MARGEM - 105, A4[0] - MARGEM - 35]
    const cabecalho = () => {
      ;['Data', 'Tipo', 'Descrição', 'Pago com', 'Valor', 'Anexos'].forEach((t, i) => page.drawText(t, { x: colunas[i], y, size: 8, font: bold, color: rgb(0.4, 0.4, 0.4) }))
      y -= 4
      page.drawLine({ start: { x: MARGEM, y }, end: { x: A4[0] - MARGEM, y }, thickness: 0.5, color: rgb(0.75, 0.75, 0.75) })
      y -= 12
    }
    cabecalho()
    for (const l of v.lancamentos) {
      if (y < MARGEM + 20) {
        page = doc.addPage(A4)
        y = A4[1] - MARGEM
        linha(`${v.vendedorNome} (continuação)`, { size: 10, b: true })
        y -= 20
        cabecalho()
      }
      page.drawText(dataBr(l.data), { x: colunas[0], y, size: 9, font })
      page.drawText(cortar(l.categoria ? CATEGORIA_LABEL[l.categoria] ?? l.categoria : 'Sem categoria', font, 9, colunas[2] - colunas[1] - 6), { x: colunas[1], y, size: 9, font, color: l.categoria ? rgb(0.1, 0.1, 0.1) : rgb(0.75, 0.1, 0.1) })
      page.drawText(cortar(l.descricao ?? '', font, 9, colunas[3] - colunas[2] - 8), { x: colunas[2], y, size: 9, font })
      page.drawText(l.formaPagamento === 'dinheiro' ? 'Dinheiro' : 'Cartão', { x: colunas[3], y, size: 9, font })
      page.drawText(brl(l.valor), { x: colunas[4], y, size: 9, font: bold })
      page.drawText(l.anexos.length ? String(l.anexos.length) : 'falta', { x: colunas[5], y, size: 9, font, color: l.anexos.length ? rgb(0.1, 0.1, 0.1) : rgb(0.75, 0.1, 0.1) })
      y -= 14
    }

    // Comprovantes
    for (const l of v.lancamentos) {
      const sub = rotuloGasto(l)
      for (const [i, a] of l.anexos.entries()) {
        const titulo = `${v.vendedorNome}  -  comprovante${l.anexos.length > 1 ? ` ${i + 1}/${l.anexos.length}` : ''}`
        let bytes: Buffer | null = null
        try {
          bytes = await fs.readFile(caminhoDoUpload(uploadsDir, a.urlArquivo))
        } catch {
          bytes = null
        }
        const tipo = (a.tipoArquivo ?? '').toLowerCase()
        const ext = path.extname(a.nomeArquivo || a.urlArquivo).toLowerCase()
        const ehPdf = tipo === 'application/pdf' || ext === '.pdf'
        const ehJpg = tipo === 'image/jpeg' || tipo === 'image/jpg' || ext === '.jpg' || ext === '.jpeg'
        const ehPng = tipo === 'image/png' || ext === '.png'
        let ok = false
        if (bytes) {
          try {
            if (ehPdf) {
              // Cada página do PDF vai encolhida numa folha A4, embaixo da
              // faixa (senão a faixa cobre o topo da nota).
              const origem = await PDFDocument.load(bytes, { ignoreEncryption: true })
              const paginas = await doc.embedPdf(origem, origem.getPageIndices())
              const areaW = A4[0] - 2 * MARGEM
              const areaH = A4[1] - 2 * MARGEM - 50
              for (const emb of paginas) {
                const pg = doc.addPage(A4)
                const esc = Math.min(areaW / emb.width, areaH / emb.height, 1)
                const w = emb.width * esc
                const h = emb.height * esc
                pg.drawPage(emb, { x: (A4[0] - w) / 2, y: MARGEM + (areaH - h), width: w, height: h })
                pg.drawRectangle({ x: (A4[0] - w) / 2, y: MARGEM + (areaH - h), width: w, height: h, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 })
                faixa(pg, font, bold, titulo, sub)
              }
              ok = paginas.length > 0
            } else if (ehJpg || ehPng) {
              const img = ehPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
              const pg = doc.addPage(A4)
              const areaW = A4[0] - 2 * MARGEM
              const areaH = A4[1] - 2 * MARGEM - 50
              const esc = Math.min(areaW / img.width, areaH / img.height, 1)
              const w = img.width * esc
              const h = img.height * esc
              pg.drawImage(img, { x: (A4[0] - w) / 2, y: MARGEM + (areaH - h) / 2, width: w, height: h })
              faixa(pg, font, bold, titulo, sub)
              ok = true
            }
          } catch {
            ok = false
          }
        }
        if (!ok) {
          const pg = doc.addPage(A4)
          faixa(pg, font, bold, titulo, sub)
          pg.drawText(cortar(bytes ? `Não deu pra incluir o arquivo "${a.nomeArquivo}" (formato não suportado).` : `Arquivo "${a.nomeArquivo}" não encontrado no servidor.`, font, 11, A4[0] - 2 * MARGEM), { x: MARGEM, y: A4[1] - 100, size: 11, font })
          pg.drawText('Abra pelo link na tela do relatório.', { x: MARGEM, y: A4[1] - 118, size: 10, font, color: rgb(0.4, 0.4, 0.4) })
        }
      }
    }
  }

  return Buffer.from(await doc.save())
}
