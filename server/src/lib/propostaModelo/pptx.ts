// Utilitários de XML de PowerPoint usados pela biblioteca e pelo gerador de
// propostas da Odin Compressores. Trabalha direto no texto do XML (regex),
// do mesmo jeito que o resto do projeto evita dependência nova.
import type { ArquivosZip } from './zip.js'

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const desesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

export function textoDe(xml: string): string {
  return [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => desesc(m[1])).join('')
}

// Texto de cada parágrafo (<a:p>), na ordem do arquivo.
export function paragrafos(xml: string): string[] {
  return [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((m) => textoDe(m[0]))
}

export function lerTexto(arq: ArquivosZip, nome: string): string {
  const b = arq.get(nome)
  if (!b) throw new Error(`Parte ${nome} não existe no pptx`)
  return b.toString('utf8')
}

export function relsDe(slide: string): string {
  const i = slide.lastIndexOf('/')
  return `${slide.slice(0, i)}/_rels/${slide.slice(i + 1)}.rels`
}

export type Rel = { id: string; type: string; target: string; external: boolean; xml: string }
export function lerRels(xml: string): Rel[] {
  return [...xml.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => {
    const a = (n: string) => m[0].match(new RegExp(`${n}="([^"]*)"`))?.[1] ?? ''
    return { id: a('Id'), type: a('Type').split('/').pop() ?? '', target: a('Target'), external: a('TargetMode') === 'External', xml: m[0] }
  })
}

// Slides na ordem da apresentação (sldIdLst), como caminhos "ppt/slides/slideN.xml".
export function ordemSlides(arq: ArquivosZip): string[] {
  const pres = lerTexto(arq, 'ppt/presentation.xml')
  const rels = lerRels(lerTexto(arq, 'ppt/_rels/presentation.xml.rels'))
  const porId = new Map(rels.map((r) => [r.id, r.target]))
  return [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => 'ppt/' + porId.get(m[1])!)
}

// Elementos de nível alto que contêm um trecho de texto — usado pra achar
// "a caixa de texto do Aos cuidados", "a célula do Razão Social" etc. sem
// depender da posição (cada um dos 40 modelos quebra o texto de um jeito).
export function acharElemento(xml: string, tag: 'p:sp' | 'a:tc' | 'a:tbl' | 'a:tr', teste: (texto: string) => boolean): { ini: number; fim: number; xml: string } | null {
  const re = tag === 'a:tc' || tag === 'a:tr' ? new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g') : new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g')
  for (const m of xml.matchAll(re)) {
    if (teste(textoDe(m[0]))) return { ini: m.index!, fim: m.index! + m[0].length, xml: m[0] }
  }
  return null
}

export function trocar(xml: string, el: { ini: number; fim: number }, novo: string): string {
  return xml.slice(0, el.ini) + novo + xml.slice(el.fim)
}

// Formatação (<a:rPr>) do primeiro run cujo texto contém `trecho`.
export function rPrDoRun(xml: string, trecho: string | RegExp): string {
  for (const m of xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
    const t = textoDe(m[0])
    if (typeof trecho === 'string' ? t.includes(trecho) : trecho.test(t)) {
      return m[1].match(/<a:rPr\b[^>]*\/>|<a:rPr\b[\s\S]*?<\/a:rPr>/)?.[0] ?? ''
    }
  }
  return ''
}

const brCom = (rPr: string) => (rPr ? `<a:br>${rPr}</a:br>` : '<a:br/>')
const runCom = (rPr: string, t: string) => `<a:r>${rPr}<a:t>${esc(t)}</a:t></a:r>`

// Reescreve o corpo de texto (txBody) de uma caixa/célula como UM parágrafo
// com quebras de linha, reaproveitando o pPr do primeiro parágrafo original.
// Cada linha leva a formatação que veio junto (rPr).
export function reescreverTexto(el: string, linhas: { texto: string; rPr: string }[]): string {
  const corpo = el.match(/<(?:p|a):txBody>[\s\S]*<\/(?:p|a):txBody>/)
  if (!corpo) return el
  const abre = corpo[0].match(/^<(?:p|a):txBody>[\s\S]*?(?=<a:p>)/)?.[0] ?? ''
  const fecha = corpo[0].match(/<\/(?:p|a):txBody>$/)![0]
  const p1 = corpo[0].match(/<a:p>[\s\S]*?<\/a:p>/)?.[0] ?? '<a:p></a:p>'
  const pPr = p1.match(/<a:pPr\b[^>]*\/>|<a:pPr\b[\s\S]*?<\/a:pPr>/)?.[0] ?? ''
  const partes: string[] = []
  linhas.forEach((l, i) => {
    if (i > 0) partes.push(brCom(linhas[i - 1].rPr || l.rPr))
    if (l.texto) partes.push(runCom(l.rPr, l.texto))
  })
  const novo = `${abre}<a:p>${pPr}${partes.join('')}</a:p>${fecha}`
  return el.replace(corpo[0], novo)
}

// Troca o texto de uma célula de tabela mantendo a formatação: o primeiro
// <a:t> recebe o valor e os demais ficam vazios. Célula sem nenhum run
// (modelo deixou vazia) ganha um, com a formatação do endParaRPr.
export function textoCelula(tc: string, valor: string): string {
  let primeiro = true
  if (/<a:t>/.test(tc)) {
    return tc.replace(/<a:t>[^<]*<\/a:t>/g, () => {
      const v = primeiro ? `<a:t>${esc(valor)}</a:t>` : '<a:t></a:t>'
      primeiro = false
      return v
    })
  }
  if (!valor) return tc
  return tc.replace(/<a:p>([\s\S]*?)(<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>|<\/a:p>)/, (_m, antes: string, fim: string) => {
    const rPr = fim.startsWith('<a:endParaRPr') ? fim.replace(/^<a:endParaRPr/, '<a:rPr').replace(/<\/a:endParaRPr>$/, '</a:rPr>') : ''
    const fimFinal = fim.startsWith('<a:endParaRPr') ? fim : '</a:p>'
    return `<a:p>${antes}${runCom(rPr, valor)}${fimFinal}`
  })
}

export function celulas(tr: string): string[] {
  return [...tr.matchAll(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g)].map((m) => m[0])
}

export function preencherLinha(tr: string, valores: (string | null)[]): string {
  let i = 0
  return tr.replace(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g, (tc) => {
    const v = valores[i++]
    return v == null ? tc : textoCelula(tc, v)
  })
}

export function linhasTabela(tbl: string): string[] {
  return [...tbl.matchAll(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g)].map((m) => m[0])
}

// Caixas de texto "giradas 180° + espelhadas" (visualmente = sem giro): o
// PowerPoint desenha normal, o LibreOffice some com o texto (achado no teste
// de 2026-11-17: títulos "Linha F", "Características do Secador" e
// "GARANTIA ODIN" sumiam no PDF). Tirar a marca não muda nada no PowerPoint.
export function corrigirGiro(xml: string): string {
  return xml.replace(/ rot="10800000" flipV="1"/g, '')
}
