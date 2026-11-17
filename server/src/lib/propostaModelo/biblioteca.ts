// Monta a "biblioteca" de páginas das propostas da Odin Compressores a partir
// dos PowerPoints modelo que o comercial usa (pedido do João, 2026-11-17):
//   - 40 "Proposta Comercial Modelo - Conjunto X.pptx" (capa + linha + fichas
//     + condições + garantia de cada conjunto),
//   - 8 "Modelo de Ficha dos …" (fichas avulsas por família),
//   - "Pagina Modelo pagamento 1+5 e 1+9" / "… com crédito" (variações da
//     página de condições).
// Junta TODAS as páginas diferentes num pptx só + um catálogo (JSON) que diz
// o que é cada página. O gerador (gerar.ts) só escolhe páginas daqui.
//
// Dá pra juntar páginas de arquivos diferentes porque todos os 52 usam o
// mesmo tamanho de página, o mesmo tema (cores/fontes) e só o layout "Em
// branco" — tudo que aparece na página está dentro do próprio slide.
import crypto from 'crypto'
import type { ArquivosZip } from './zip.js'
import { lerTexto, lerRels, ordemSlides, relsDe, textoDe, paragrafos, corrigirGiro, linhasTabela, celulas } from './pptx.js'

export type FichaCatalogo = {
  id: string
  familia: 'compressor' | 'secador' | 'separador' | 'filtro' | 'outro'
  modelo: string
  codigo: string
  titulo: string
  descricao: string // como aparece na tabela de Condições Comerciais
  slide: string
  intro: string | null // id da página de apresentação da linha (vai antes da 1ª ficha da família)
}
export type ConjuntoCatalogo = { id: string; nome: string; capa: string; itens: { ficha: string; qtd: number; descricao: string }[] }
export type CatalogoPropostas = {
  geradoEm: string
  fontes: string[]
  conjuntos: ConjuntoCatalogo[]
  fichas: FichaCatalogo[]
  intros: Record<string, string>
  condicoes: { normal: string; dupla: string | null; credito: string | null }
  garantia: string
  // Inconsistências achadas nos próprios modelos (pra equipe conferir).
  avisos: string[]
}

export type ArquivoModelo = { nome: string; data: string; arquivos: ArquivosZip }

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const limpa = (s: string) => s.replace(/\s+/g, ' ').trim()

type Tipo = 'capa' | 'condicoes' | 'garantia' | 'ficha' | 'intro'
function tipoDoSlide(xml: string): Tipo {
  const t = textoDe(xml)
  if (t.includes('Proposta Comercial')) return 'capa'
  if (t.includes('CONDIÇÕES COMERCIAIS')) return 'condicoes'
  if (t.includes('GARANTIA ODIN')) return 'garantia'
  if (/ITEM\s*\d+/.test(t) && /Modelo:/.test(t)) return 'ficha'
  return 'intro'
}

function dadosFicha(xml: string) {
  const ps = paragrafos(xml).map(limpa).filter(Boolean)
  const depois = (rot: string) => {
    const i = ps.findIndex((p) => p.startsWith(rot))
    if (i < 0) return ''
    const resto = ps[i].slice(rot.length).trim()
    return resto || ps[i + 1] || ''
  }
  const modelo = depois('Modelo:')
  const codigo = depois('Código Odin:')
  // Título = texto fora das tabelas, sem cabeçalho/rodapé/"ITEM nn".
  const semTabela = xml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, '')
  const titulo = limpa(
    paragrafos(semTabela)
      .map(limpa)
      .filter((p) => p && !/^ITEM\s*\d+/.test(p) && !/ODIN COMPRESSORES/.test(p) && !/odincompressores/.test(p) && !/Imagem Ilustrativa/i.test(p) && p !== ':')
      .join(' ')
  )
  const base = `${titulo} ${modelo}`
  const familia: FichaCatalogo['familia'] = /Compressor/i.test(base) ? 'compressor' : /Secador/i.test(base) ? 'secador' : /Separador/i.test(base) ? 'separador' : /Filtro/i.test(base) ? 'filtro' : 'outro'
  return { modelo, codigo, titulo, familia }
}

// Linhas da tabela de itens (Item | Qtde | Descrição | Valor) de uma página de condições.
function itensDaTabela(xml: string): { qtd: number; descricao: string }[] {
  const tbl = [...xml.matchAll(/<a:tbl>[\s\S]*?<\/a:tbl>/g)].map((m) => m[0]).find((t) => textoDe(t).includes('Descri'))
  if (!tbl) return []
  return linhasTabela(tbl)
    .map((tr) => celulas(tr).map((c) => limpa(textoDe(c))))
    .filter((c) => /^\d+$/.test(c[0] ?? '') && c.length >= 3)
    .map((c) => ({ qtd: Number(c[1]) || 1, descricao: c[2] }))
}

export function montarBiblioteca(modelos: ArquivoModelo[], baseNome: string): { pptx: ArquivosZip; catalogo: CatalogoPropostas } {
  // Mais antigo → mais novo: quando a mesma ficha aparece em vários arquivos,
  // fica a versão do arquivo mais recente.
  const ordenados = [...modelos].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.nome.localeCompare(b.nome)))
  const base = modelos.find((m) => m.nome === baseNome)
  if (!base) throw new Error(`Modelo base ${baseNome} não encontrado`)

  type Origem = { arq: ArquivosZip; slide: string }
  const fichas = new Map<string, Omit<FichaCatalogo, 'slide' | 'intro'> & { origem: Origem; intro: string | null }>()
  const intros = new Map<string, Origem>()
  const conjuntos: (Omit<ConjuntoCatalogo, 'capa'> & { origem: Origem })[] = []
  // Objeto (e não `let`) porque é preenchido dentro do forEach — o TS não
  // acompanha atribuição feita em callback.
  const sel: { normal?: Origem; dupla?: Origem; credito?: Origem; garantia?: Origem } = {}

  for (const m of ordenados) {
    const slides = ordemSlides(m.arquivos)
    const xmls = slides.map((s) => lerTexto(m.arquivos, s))
    const tipos = xmls.map(tipoDoSlide)
    const ehConjunto = m.nome.startsWith('Proposta Comercial Modelo')
    const ehFichaAvulsa = m.nome.startsWith('Modelo de Ficha')
    const fichasDoArquivo: string[] = []

    let introAtual: string | null = null
    xmls.forEach((xml, i) => {
      const origem = { arq: m.arquivos, slide: slides[i] }
      const tipo = tipos[i]
      if (tipo === 'intro') {
        const id = 'intro-' + crypto.createHash('md5').update(limpa(textoDe(xml))).digest('hex').slice(0, 8)
        intros.set(id, origem)
        introAtual = id
        return
      }
      if (tipo === 'ficha') {
        const d = dadosFicha(xml)
        const id = slug(`${d.modelo}-${d.codigo}-${d.titulo}`).slice(0, 80)
        // Intro vale só pra ficha logo depois dela (conjuntos) ou pra todas
        // as fichas do arquivo avulso que começa com ela (Ficha Linha F etc.).
        const anteriorEhIntro = i > 0 && tipos[i - 1] === 'intro'
        const intro = anteriorEhIntro || (ehFichaAvulsa && tipos[0] === 'intro') ? introAtual : null
        const antiga = fichas.get(id)
        fichas.set(id, { id, ...d, descricao: antiga?.descricao ?? '', origem, intro: intro ?? antiga?.intro ?? null })
        fichasDoArquivo.push(id)
        return
      }
      if (tipo === 'condicoes') {
        const t = textoDe(xml)
        if (/Valor 1\+5/.test(t)) sel.dupla = origem
        else if (/Crédito ref/.test(t)) sel.credito = origem
        else if (ehConjunto && itensDaTabela(xml).length >= 3) sel.normal = origem
        return
      }
      if (tipo === 'garantia') {
        if (ehConjunto && /Nome do vendedor/.test(textoDe(xml))) sel.garantia = origem
        return
      }
    })

    if (ehConjunto) {
      const capaIdx = tipos.indexOf('capa')
      const condIdx = tipos.indexOf('condicoes')
      if (capaIdx < 0) continue
      const linhas = condIdx >= 0 ? itensDaTabela(xmls[condIdx]) : []
      // Descrição da tabela de condições ↔ ficha, na mesma ordem.
      if (linhas.length === fichasDoArquivo.length) {
        fichasDoArquivo.forEach((f, k) => {
          const ficha = fichas.get(f)!
          ficha.descricao = linhas[k].descricao
        })
      }
      const nome = m.nome.replace(/^Proposta Comercial Modelo - /, '').replace(/\.pptx$/i, '')
      conjuntos.push({
        id: slug(nome),
        nome,
        origem: { arq: m.arquivos, slide: slides[capaIdx] },
        itens: fichasDoArquivo.map((f, k) => ({ ficha: f, qtd: linhas.length === fichasDoArquivo.length ? linhas[k].qtd : 1, descricao: '' })),
      })
    }
  }
  const { normal: condNormal, dupla: condDupla, credito: condCredito, garantia } = sel
  if (!condNormal || !garantia) throw new Error('Não achei a página de Condições Comerciais / Garantia nos modelos')

  // ── Monta o pptx único a partir do modelo base, sem os slides dele ──────
  const out: ArquivosZip = new Map()
  for (const [n, b] of base.arquivos) {
    if (/^ppt\/(slides|notesSlides)\//.test(n) || /^ppt\/media\//.test(n)) continue
    out.set(n, b)
  }
  // Mídia usada por master/layouts (o modelo não tem, mas por garantia).
  for (const [n] of base.arquivos) {
    if (!/^ppt\/(slideMasters|slideLayouts)\/_rels\//.test(n)) continue
    for (const r of lerRels(lerTexto(base.arquivos, n))) {
      if (r.type === 'image') {
        const alvo = 'ppt/' + r.target.replace(/^\.\.\//, '')
        const b = base.arquivos.get(alvo)
        if (b) out.set(alvo, b)
      }
    }
  }
  const layoutBranco = [...base.arquivos.keys()].find((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n) && /<p:cSld name="Em branco"/.test(lerTexto(base.arquivos, n)))
  if (!layoutBranco) throw new Error('Layout "Em branco" não encontrado no modelo base')

  const midiaPorHash = new Map<string, string>()
  let nSlide = 0
  let nMidia = 0
  const novosSlides: string[] = []
  const extensoes = new Set<string>()

  function copiar(o: Origem): string {
    nSlide++
    const destino = `ppt/slides/slide${nSlide}.xml`
    out.set(destino, Buffer.from(corrigirGiro(lerTexto(o.arq, o.slide)), 'utf8'))
    const rels = o.arq.has(relsDe(o.slide)) ? lerRels(lerTexto(o.arq, relsDe(o.slide))) : []
    const novas: string[] = []
    for (const r of rels) {
      if (r.type === 'slideLayout') {
        novas.push(`<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/${layoutBranco!.split('/').pop()}"/>`)
      } else if (r.type === 'image' && !r.external) {
        const origemMidia = 'ppt/' + r.target.replace(/^\.\.\//, '')
        const b = o.arq.get(origemMidia)
        if (!b) continue
        const h = crypto.createHash('sha1').update(b).digest('hex')
        let nome = midiaPorHash.get(h)
        if (!nome) {
          const ext = (origemMidia.split('.').pop() ?? 'png').toLowerCase()
          extensoes.add(ext)
          nome = `ppt/media/bib${++nMidia}.${ext}`
          midiaPorHash.set(h, nome)
          out.set(nome, b)
        }
        novas.push(`<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${nome.split('/').pop()}"/>`)
      } else if (r.external) {
        novas.push(r.xml)
      }
      // notesSlide e afins: fora (anotação do apresentador não vai pra proposta).
    }
    out.set(
      relsDe(destino),
      Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${novas.join('')}</Relationships>`, 'utf8')
    )
    novosSlides.push(destino)
    return destino.split('/').pop()!
  }

  const catalogo: CatalogoPropostas = {
    geradoEm: new Date().toISOString(),
    fontes: modelos.map((m) => m.nome).sort(),
    conjuntos: [],
    fichas: [],
    intros: {},
    condicoes: { normal: copiar(condNormal), dupla: condDupla ? copiar(condDupla) : null, credito: condCredito ? copiar(condCredito) : null },
    garantia: copiar(garantia),
    avisos: [],
  }
  // Mesma ficha (mesmo título, ex.: "Compressor a Parafuso OD20 F – 220V") em
  // vários arquivos: os "Modelo de Ficha…" (set/26) trazem "Código Odin" no
  // formato C#### (parece código de cliente), os conjuntos (out/26) trazem
  // I###### — que bate com o catálogo NOV 26. Se existe versão com código
  // I…, as outras saem. Códigos I diferentes com o mesmo título continuam
  // separados (ex.: OD30 Premium 8 bar × 10 bar).
  const porTitulo = new Map<string, string[]>()
  for (const f of fichas.values()) {
    const k = slug(f.titulo)
    porTitulo.set(k, [...(porTitulo.get(k) ?? []), f.id])
  }
  for (const ids of porTitulo.values()) {
    if (!ids.some((id) => /^I\d/.test(fichas.get(id)!.codigo))) continue
    for (const id of ids) if (!/^I\d/.test(fichas.get(id)!.codigo)) fichas.delete(id)
  }
  // Conjunto apontando pra ficha descartada → troca pela do mesmo título.
  for (const c of conjuntos) {
    c.itens = c.itens.map((it) => {
      if (fichas.has(it.ficha)) return it
      const antigo = [...porTitulo.entries()].find(([, ids]) => ids.includes(it.ficha))
      const novo = antigo?.[1].find((id) => fichas.has(id))
      return novo ? { ...it, ficha: novo } : it
    })
  }

  const introUsada = new Set([...fichas.values()].map((f) => f.intro).filter(Boolean) as string[])
  for (const [id, o] of intros) if (introUsada.has(id)) catalogo.intros[id] = copiar(o)
  for (const f of fichas.values()) {
    const { origem, ...resto } = f
    catalogo.fichas.push({ ...resto, descricao: resto.descricao || resto.titulo, slide: copiar(origem) })
  }
  const compacto = (s: string) => s.replace(/¾/g, '3/4').replace(/½/g, '1/2').replace(/FCO/gi, '').replace(/[\s"”.]+/g, '').toUpperCase()
  for (const f of catalogo.fichas) {
    const nome = f.titulo
    if (!/^I\d/.test(f.codigo)) catalogo.avisos.push(`${nome}: "Código Odin" ${f.codigo ? `= ${f.codigo}` : 'vazio'} (não é código I…)`)
    if (f.modelo && !compacto(nome).includes(compacto(f.modelo).replace(/"$/, ''))) catalogo.avisos.push(`${nome}: campo "Modelo" da ficha diz ${f.modelo}`)
    const pre = /PRÉ/i.test(nome), pos = /PÓS/i.test(nome)
    if ((pre && /PÓS/i.test(f.descricao)) || (pos && /PRÉ/i.test(f.descricao))) catalogo.avisos.push(`${nome}: na tabela de condições aparece "${f.descricao}"`)
  }
  for (const c of conjuntos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))) {
    const { origem, ...resto } = c
    catalogo.conjuntos.push({
      ...resto,
      capa: copiar(origem),
      itens: resto.itens.map((it) => ({ ...it, descricao: fichas.get(it.ficha)?.descricao || fichas.get(it.ficha)?.titulo || '' })),
    })
  }

  // presentation.xml / rels / content types com a lista nova de slides.
  const relsPres = lerTexto(out, 'ppt/_rels/presentation.xml.rels').replace(/<Relationship\b[^>]*relationships\/slide"[^>]*\/>/g, '')
  const novasRels = novosSlides.map((s, i) => `<Relationship Id="rIdBib${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/${s.split('/').pop()}"/>`).join('')
  out.set('ppt/_rels/presentation.xml.rels', Buffer.from(relsPres.replace('</Relationships>', novasRels + '</Relationships>'), 'utf8'))
  const lista = novosSlides.map((_s, i) => `<p:sldId id="${256 + i}" r:id="rIdBib${i + 1}"/>`).join('')
  let pres = lerTexto(out, 'ppt/presentation.xml')
  pres = /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/.test(pres)
    ? pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${lista}</p:sldIdLst>`)
    : pres.replace(/(<p:sldMasterIdLst>[\s\S]*?<\/p:sldMasterIdLst>)/, `$1<p:sldIdLst>${lista}</p:sldIdLst>`)
  out.set('ppt/presentation.xml', Buffer.from(pres, 'utf8'))
  out.set('[Content_Types].xml', Buffer.from(tiposDeConteudo(lerTexto(out, '[Content_Types].xml'), novosSlides, extensoes), 'utf8'))
  return { pptx: out, catalogo }
}

const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif', emf: 'image/x-emf', wmf: 'image/x-wmf', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', wdp: 'image/vnd.ms-photo' }

export function tiposDeConteudo(ct: string, slides: string[], extensoes: Set<string>): string {
  let x = ct.replace(/<Override\b[^>]*PartName="\/ppt\/(slides|notesSlides)\/[^"]*"[^>]*\/>/g, '')
  for (const e of extensoes) {
    if (!new RegExp(`Extension="${e}"`, 'i').test(x) && MIME[e]) x = x.replace('</Types>', `<Default Extension="${e}" ContentType="${MIME[e]}"/></Types>`)
  }
  const ov = slides.map((s) => `<Override PartName="/${s}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
  return x.replace('</Types>', ov + '</Types>')
}
