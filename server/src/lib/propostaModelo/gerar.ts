// Gera a proposta comercial da Odin Compressores (pptx → PDF) a partir da
// biblioteca de páginas (biblioteca.ts) — pedido do João, 2026-11-17: hoje
// quem monta a proposta troca dados cadastrais, valores e condições à mão no
// PowerPoint; aqui o CRM escolhe as páginas certas e preenche.
//
// Ordem das páginas = a dos modelos: capa → (apresentação da linha) ficha →
// … → condições comerciais → garantia. A apresentação de cada linha
// (Linha F, Secadores…) entra uma vez, antes da 1ª ficha que usa ela.
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { lerZip, escreverZip, type ArquivosZip } from './zip.js'
import { lerTexto, lerRels, relsDe, acharElemento, trocar, rPrDoRun, reescreverTexto, linhasTabela, celulas, preencherLinha, textoDe } from './pptx.js'
import { tiposDeConteudo, type CatalogoPropostas } from './biblioteca.js'

const execFileP = promisify(execFile)

export type ItemProposta = { ficha: string | null; descricao: string; qtd: number; valor: number; valor2?: number | null }
export type DadosGeracao = {
  conjunto: string
  numero: string
  data: string // dd/mm/aaaa
  cliente: { razao: string; cnpj: string; ie: string; endereco: string; bairro: string; cidade: string; contato: string; email: string; telefone: string }
  itens: ItemProposta[]
  pagamento: {
    tipo: 'normal' | 'dupla' | 'credito'
    condicao: string
    entrega: string
    frete: string
    validade: string
    credito?: number | null // só no tipo "credito"
  }
  assinatura: string[] // linhas depois de "Atenciosamente,"
}

export const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nd = (s: string | null | undefined) => (s && s.trim() ? s.trim() : '(não informado)')
const dois = (n: number) => String(n).padStart(2, '0')

// ── Biblioteca em disco (cache em memória; recarrega se o arquivo mudar) ──
export function pastaModelos(): string {
  return process.env.PROPOSTA_MODELOS_DIR ?? path.resolve(process.env.UPLOADS_DIR ?? './uploads', 'modelos-proposta')
}
let cache: { mtime: number; arquivos: ArquivosZip; catalogo: CatalogoPropostas } | null = null
export function carregarBiblioteca() {
  const dir = pastaModelos()
  const pptx = path.join(dir, 'biblioteca.pptx')
  const json = path.join(dir, 'catalogo.json')
  if (!fs.existsSync(pptx) || !fs.existsSync(json)) return null
  const mtime = Math.max(fs.statSync(pptx).mtimeMs, fs.statSync(json).mtimeMs)
  if (!cache || cache.mtime !== mtime) {
    cache = { mtime, arquivos: lerZip(fs.readFileSync(pptx)), catalogo: JSON.parse(fs.readFileSync(json, 'utf8')) }
  }
  return cache
}

// ── Preenchimento de cada tipo de página ──────────────────────────────────
function preencherCapa(xml: string, d: DadosGeracao): string {
  const c = d.cliente
  // Bloco do cliente (célula de tabela com "À / Razão Social / CNPJ…").
  const tc = acharElemento(xml, 'a:tc', (t) => /Raz[ãa]o/i.test(t) && /CNPJ/.test(t))
  if (tc) {
    const rA = rPrDoRun(tc.xml, 'À')
    const rRazao = rPrDoRun(tc.xml, /Raz[ãa]o/i)
    const rDados = rPrDoRun(tc.xml, 'CNPJ') || rPrDoRun(tc.xml, 'informado')
    xml = trocar(
      xml,
      tc,
      reescreverTexto(tc.xml, [
        { texto: 'À', rPr: rA },
        { texto: c.razao.trim() || '(não informado)', rPr: rRazao },
        { texto: '', rPr: rDados },
        { texto: `CNPJ: ${nd(c.cnpj)}`, rPr: rDados },
        { texto: `I.E: ${nd(c.ie)}`, rPr: rDados },
        { texto: `Endereço: ${nd(c.endereco)}`, rPr: rDados },
        { texto: `Bairro: ${nd(c.bairro)}`, rPr: rDados },
        { texto: `Cidade: ${nd(c.cidade)}`, rPr: rDados },
      ])
    )
  }
  const aos = acharElemento(xml, 'p:sp', (t) => t.includes('Aos cuidados'))
  if (aos) {
    const r = rPrDoRun(aos.xml, 'Aos cuidados')
    xml = trocar(
      xml,
      aos,
      reescreverTexto(aos.xml, [
        { texto: 'Aos cuidados,', rPr: r },
        { texto: `Sr(a). ${nd(c.contato)}`, rPr: r },
        { texto: `e-mail: ${nd(c.email)}`, rPr: r },
        { texto: `Telefone: ${nd(c.telefone)}`, rPr: r },
      ])
    )
  }
  const data = acharElemento(xml, 'p:sp', (t) => /^\s*\d{2}\/\d{2}\/\d{4}\s*$/.test(t))
  if (data) xml = trocar(xml, data, reescreverTexto(data.xml, [{ texto: d.data, rPr: rPrDoRun(data.xml, /\d/) }]))
  const num = acharElemento(xml, 'p:sp', (t) => t.includes('Proposta Comercial'))
  if (num) xml = trocar(xml, num, reescreverTexto(num.xml, [{ texto: `Proposta Comercial  nº ${d.numero.trim()}`.trimEnd(), rPr: rPrDoRun(num.xml, 'Proposta') }]))
  return xml
}

function renumerarFicha(xml: string, n: number): string {
  return xml.replace(/<a:t>(\s*ITEM\s*)\d+/, (_m, p: string) => `<a:t>${p}${dois(n)}`)
}

function preencherCondicoes(xml: string, d: DadosGeracao): string {
  const tblIt = acharElemento(xml, 'a:tbl', (t) => t.includes('Descri'))
  if (tblIt) {
    const linhas = linhasTabela(tblIt.xml)
    const ehItem = (tr: string) => /^\s*\d+\s*$/.test(textoDe(celulas(tr)[0] ?? ''))
    const iPrim = linhas.findIndex(ehItem)
    const iUlt = linhas.length - 1 - [...linhas].reverse().findIndex(ehItem)
    if (iPrim >= 0) {
      const modelo = linhas[iPrim]
      const nCols = celulas(modelo).length
      const novas = d.itens.map((it, i) => {
        const vals = [dois(i + 1), dois(it.qtd), it.descricao, brl(it.valor)]
        if (nCols >= 5) vals.push(it.valor2 != null ? brl(it.valor2) : '')
        return preencherLinha(modelo, vals)
      })
      const total = d.itens.reduce((s, it) => s + it.valor, 0)
      const total2 = d.itens.reduce((s, it) => s + (it.valor2 ?? 0), 0)
      const credito = d.pagamento.credito ?? 0
      // Linhas depois dos itens: TOTAL (e, no modelo de crédito, "Crédito
      // ref. Compressor" e "TOTAL FINAL"). Preenche a(s) última(s) célula(s).
      const rodape = linhas.slice(iUlt + 1).map((tr) => {
        const t = textoDe(tr)
        const cs = celulas(tr)
        const vazias = cs.map(() => null as string | null)
        const ultimo = (v: string) => {
          vazias[cs.length - 1] = v
          return preencherLinha(tr, vazias)
        }
        if (/TOTAL FINAL/i.test(t)) return ultimo(`R$ ${brl(total - credito)}`)
        if (/Crédito/i.test(t)) return ultimo(credito ? `- R$ ${brl(credito)}` : '')
        if (/TOTAL/i.test(t)) {
          if (d.pagamento.tipo === 'dupla' && cs.length >= 3) {
            vazias[cs.length - 2] = `R$ ${brl(total)}`
            vazias[cs.length - 1] = `R$ ${brl(total2)}`
            return preencherLinha(tr, vazias)
          }
          return ultimo(`R$ ${brl(total)}`)
        }
        return tr
      })
      const novoTbl = tblIt.xml.replace(linhas.slice(iPrim).join(''), [...novas, ...rodape].join(''))
      xml = trocar(xml, tblIt, novoTbl)
    }
  }
  const tblPg = acharElemento(xml, 'a:tbl', (t) => t.includes('Previsão de Entrega'))
  if (tblPg) {
    const linhas = linhasTabela(tblPg.xml)
    const iCab = linhas.findIndex((tr) => textoDe(tr).includes('Previsão'))
    const alvo = linhas[iCab + 1]
    if (alvo) {
      const p = d.pagamento
      const novo = tblPg.xml.replace(alvo, preencherLinha(alvo, [p.condicao, p.entrega, p.frete, p.validade]))
      xml = trocar(xml, tblPg, novo)
    }
  }
  return xml
}

function preencherGarantia(xml: string, d: DadosGeracao): string {
  const el = acharElemento(xml, 'p:sp', (t) => t.includes('Atenciosamente'))
  if (!el) return xml
  const r = rPrDoRun(el.xml, 'Atenciosamente')
  return trocar(xml, el, reescreverTexto(el.xml, [{ texto: 'Atenciosamente,', rPr: r }, ...d.assinatura.filter(Boolean).map((l) => ({ texto: l, rPr: r }))]))
}

// ── Montagem do pptx final ────────────────────────────────────────────────
export function montarPptx(bib: { arquivos: ArquivosZip; catalogo: CatalogoPropostas }, d: DadosGeracao): Buffer {
  const cat = bib.catalogo
  const conjunto = cat.conjuntos.find((c) => c.id === d.conjunto)
  if (!conjunto) throw new Error('Conjunto não encontrado nos modelos')
  if (!d.itens.length) throw new Error('A proposta precisa de pelo menos 1 item')
  const fichas = new Map(cat.fichas.map((f) => [f.id, f]))

  // Lista de páginas: [slide da biblioteca, como preencher]
  const paginas: { slide: string; fazer: (xml: string) => string }[] = [{ slide: conjunto.capa, fazer: (x) => preencherCapa(x, d) }]
  const introsUsadas = new Set<string>()
  const fichasUsadas = new Set<string>()
  let nItem = 0
  for (const it of d.itens) {
    if (!it.ficha || fichasUsadas.has(it.ficha)) continue
    const f = fichas.get(it.ficha)
    if (!f) continue
    fichasUsadas.add(f.id)
    if (f.intro && cat.intros[f.intro] && !introsUsadas.has(f.intro)) {
      introsUsadas.add(f.intro)
      paginas.push({ slide: cat.intros[f.intro], fazer: (x) => x })
    }
    const n = ++nItem
    paginas.push({ slide: f.slide, fazer: (x) => renumerarFicha(x, n) })
  }
  const cond = d.pagamento.tipo === 'dupla' ? cat.condicoes.dupla : d.pagamento.tipo === 'credito' ? cat.condicoes.credito : cat.condicoes.normal
  paginas.push({ slide: cond ?? cat.condicoes.normal, fazer: (x) => preencherCondicoes(x, d) })
  paginas.push({ slide: cat.garantia, fazer: (x) => preencherGarantia(x, d) })

  // Pacote novo: tudo que não é slide/mídia vem da biblioteca; slides
  // escolhidos renumerados 1..n; só a mídia que esses slides usam.
  const src = bib.arquivos
  const out: ArquivosZip = new Map()
  for (const [n, b] of src) if (!/^ppt\/(slides|media)\//.test(n)) out.set(n, b)
  const extensoes = new Set<string>()
  const novos: string[] = []
  paginas.forEach((pg, i) => {
    const origem = `ppt/slides/${pg.slide}`
    const destino = `ppt/slides/slide${i + 1}.xml`
    out.set(destino, Buffer.from(pg.fazer(lerTexto(src, origem)), 'utf8'))
    const relsXml = src.has(relsDe(origem)) ? lerTexto(src, relsDe(origem)) : ''
    if (relsXml) {
      out.set(relsDe(destino), Buffer.from(relsXml, 'utf8'))
      for (const r of lerRels(relsXml)) {
        if (r.type !== 'image' || r.external) continue
        const m = 'ppt/' + r.target.replace(/^\.\.\//, '')
        const b = src.get(m)
        if (b) {
          out.set(m, b)
          extensoes.add(m.split('.').pop()!.toLowerCase())
        }
      }
    }
    novos.push(destino)
  })
  const relsPres = lerTexto(out, 'ppt/_rels/presentation.xml.rels').replace(/<Relationship\b[^>]*relationships\/slide"[^>]*\/>/g, '')
  out.set(
    'ppt/_rels/presentation.xml.rels',
    Buffer.from(relsPres.replace('</Relationships>', novos.map((s, i) => `<Relationship Id="rIdBib${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/${s.split('/').pop()}"/>`).join('') + '</Relationships>'), 'utf8')
  )
  const pres = lerTexto(out, 'ppt/presentation.xml').replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${novos.map((_s, i) => `<p:sldId id="${256 + i}" r:id="rIdBib${i + 1}"/>`).join('')}</p:sldIdLst>`)
  out.set('ppt/presentation.xml', Buffer.from(pres, 'utf8'))
  out.set('[Content_Types].xml', Buffer.from(tiposDeConteudo(lerTexto(out, '[Content_Types].xml'), novos, extensoes), 'utf8'))
  return escreverZip(out)
}

// ── pptx → PDF com o LibreOffice ──────────────────────────────────────────
function binarioSoffice(): string {
  if (process.env.SOFFICE_BIN) return process.env.SOFFICE_BIN
  const mac = '/Applications/LibreOffice.app/Contents/MacOS/soffice'
  return fs.existsSync(mac) ? mac : 'soffice'
}

export async function converterPdf(pptx: Buffer): Promise<Buffer> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proposta-'))
  // Perfil próprio por conversão: deixa rodar duas ao mesmo tempo sem uma
  // travar a outra (o LibreOffice tranca o perfil padrão).
  const perfil = path.join(tmp, 'perfil')
  try {
    const entrada = path.join(tmp, `proposta-${crypto.randomUUID()}.pptx`)
    fs.writeFileSync(entrada, pptx)
    await execFileP(binarioSoffice(), [`-env:UserInstallation=file://${perfil}`, '--headless', '--convert-to', 'pdf', '--outdir', tmp, entrada], { timeout: 120_000 })
    const pdf = entrada.replace(/\.pptx$/, '.pdf')
    if (!fs.existsSync(pdf)) throw new Error('O LibreOffice não gerou o PDF')
    return fs.readFileSync(pdf)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
