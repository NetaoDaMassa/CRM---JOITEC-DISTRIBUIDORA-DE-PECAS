// Fotos dos produtos (tabela item_fotos), uma por código de item do SAP —
// usada na cotação, no documento impresso e na conferência da Expedição.
// De onde vem cada foto (origem), da que mais vale pra que menos vale:
//   - 'upload' — trocada/escolhida à mão por alguém (vale sempre);
//   - 'midia'  — arquivo do Arquivos/Mídia numa pasta de produtos com o
//                código do item no nome da subpasta ou do arquivo (ex.:
//                "Catálogo / Válvulas / I001568 - VALVULA ..."). João,
//                2026-11-11;
//   - 'catalogo' — recorte do catálogo em PDF da Joitec (semente em
//                data/fotosProdutos.ts, trabalho de 2026-11-06);
//   - 'tipo'   — foto do TIPO de peça da Odin Tubos ("JOELHO 90°.png" vale
//                pra todas as medidas de joelho 90°): ilustrativa, a tela
//                avisa. João aceitou ligar sozinho (2026-11-11).
import { inArray, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { itemFotos } from '../db/schema.js'
import { FOTOS_CATALOGO_JOITEC } from '../data/fotosProdutos.js'

export type OrigemFoto = 'upload' | 'midia' | 'catalogo' | 'tipo'
export interface FotoItem {
  url: string
  // Foto do tipo de peça, não do item exato.
  ilustrativa: boolean
}

export async function semearFotosCatalogo(): Promise<void> {
  const linhas = Object.entries(FOTOS_CATALOGO_JOITEC).map(([itemCodigo, url]) => ({ itemCodigo, url, origem: 'catalogo' as const }))
  for (let i = 0; i < linhas.length; i += 200) await db.insert(itemFotos).values(linhas.slice(i, i + 200)).onConflictDoNothing()
}

// Fotos de alguns itens, com o aviso de ilustrativa.
export async function fotosDosItens(codigos: (string | null | undefined)[]): Promise<Map<string, FotoItem>> {
  const lista = [...new Set(codigos.filter((c): c is string => !!c))]
  const r = new Map<string, FotoItem>()
  for (let i = 0; i < lista.length; i += 400) {
    const linhas = await db.select().from(itemFotos).where(inArray(itemFotos.itemCodigo, lista.slice(i, i + 400)))
    for (const l of linhas) r.set(l.itemCodigo, { url: l.url, ilustrativa: l.origem === 'tipo' })
  }
  return r
}

export const contarFotos = async () => (await db.select({ n: sql<number>`count(*)` }).from(itemFotos))[0]?.n ?? 0

// ── Pastas de produtos do Arquivos/Mídia ────────────────────────────────
// Pasta raiz (nome, sem diferenciar acento/maiúscula) de cada empresa. A
// 'tipo' liga pelo nome da peça; as outras só pelo código no nome.
const PASTAS: { slug: string; nome: string; porTipo: boolean }[] = [
  { slug: 'joitec', nome: 'CATALOGO', porTipo: false },
  { slug: 'odin-tubos', nome: 'PRODUTOS', porTipo: true },
  { slug: 'joitec-automacao', nome: 'PECAS AUTOMACAO PNEUMATICA', porTipo: false },
]

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')
const normal = (t: string) => semAcento(t).toUpperCase().replace(/\s+/g, ' ').trim()
const EH_IMAGEM = /\.(jpe?g|png|webp|gif)$/i

export interface ArquivoProduto {
  arquivoId: number
  empresa: string
  empresaSlug: string
  // "Catálogo / Válvulas / I001568 - VALVULA ..." (sem o nome do arquivo)
  caminho: string
  nome: string
  url: string
  porTipo: boolean
}

// Todas as imagens das pastas de produtos (com subpastas). Arquivo marcado
// "somente visualização" fica de fora: o caminho dele em /uploads não pode
// ir pro navegador (ver marketingArquivos.somenteVisualizacao).
export async function arquivosDasPastasDeProdutos(): Promise<ArquivoProduto[]> {
  const raizes = await db.all<{ id: number; nome: string; slug: string }>(
    sql`SELECT p.id, p.nome, e.slug FROM marketing_pastas p JOIN empresas e ON e.id = p.empresa_id WHERE p.pasta_pai_id IS NULL`
  )
  const r: ArquivoProduto[] = []
  for (const cfg of PASTAS) {
    const raiz = raizes.find((p) => p.slug === cfg.slug && normal(p.nome) === cfg.nome)
    if (!raiz) continue
    const linhas = await db.all<{ id: number; caminho: string; nome_original: string; nome_armazenado: string; tipo_arquivo: string | null; empresa: string }>(sql`
      WITH RECURSIVE t(id, caminho) AS (
        SELECT id, nome FROM marketing_pastas WHERE id = ${raiz.id}
        UNION ALL
        SELECT p.id, t.caminho || ' / ' || p.nome FROM marketing_pastas p JOIN t ON p.pasta_pai_id = t.id
      )
      SELECT a.id, t.caminho, a.nome_original, a.nome_armazenado, a.tipo_arquivo, e.nome AS empresa
      FROM t JOIN marketing_arquivos a ON a.pasta_id = t.id JOIN empresas e ON e.id = a.empresa_id
      WHERE a.somente_visualizacao = 0
      ORDER BY t.caminho, a.nome_original, a.id`)
    for (const l of linhas) {
      if (!(l.tipo_arquivo ?? '').startsWith('image/') && !EH_IMAGEM.test(l.nome_original)) continue
      if (/\.(psd|heic|dng|tiff?)$/i.test(l.nome_original)) continue
      r.push({ arquivoId: l.id, empresa: l.empresa, empresaSlug: cfg.slug, caminho: l.caminho, nome: l.nome_original, url: `/uploads/${l.nome_armazenado}`, porTipo: cfg.porTipo })
    }
  }
  return r
}

// Código do item (I000123) no nome do arquivo ou da subpasta mais funda.
const CODIGO = /\b(I\d{6})\b/i
export function codigoNoCaminho(a: { caminho: string; nome: string }): string | null {
  for (const parte of [a.nome, ...a.caminho.split(' / ').reverse()]) {
    const m = CODIGO.exec(semAcento(parte))
    if (m) return m[1].toUpperCase()
  }
  return null
}

// "JOELHO 90° - MEDIDAS: 25 MM - PPR" e "JOELHO 90°.png" → {JOELHO, 90GRAUS}.
// Ângulo conta (45° ≠ 90°); medida (25 MM, 1/2, 3 METROS) não; "C/" = "COM".
const IGNORAR = new Set(['DE', 'DA', 'DO', 'E', 'PARA', 'P', 'PPR', 'AZUL', 'VERDE', 'MM', 'M', 'X', 'METRO', 'METROS', 'POLEGADA', 'POLEGADAS', 'MEDIDAS', 'MODELO', 'PN', 'PNG', 'JPG', 'JPEG', 'WEBP'])
export function palavrasDoTipo(texto: string): string[] {
  const t = normal(texto)
    .replace(/\.(PNG|JPE?G|WEBP|GIF)$/, '')
    .replace(/\(\d+\)$/, '')
    .replace(/C\//g, 'COM ')
    .replace(/(\d+)\s*(°|º|GRAUS?\b)/g, ' $1GRAUS ')
    .replace(/[^A-Z0-9 ]/g, ' ')
  return [...new Set(t.split(' ').filter((p) => p && !IGNORAR.has(p) && !/^\d+(MM)?$/.test(p)))]
}

// Tipo da peça = o nome antes de " - MEDIDAS"/" - MODELO"; o modelo (PN20,
// PN25) também pode aparecer no nome da foto ("TUBO PN20.png").
function tipoDoItem(nome: string): { tipo: string[]; extras: Set<string> } {
  const [tipo, ...resto] = nome.split(/\s+-\s+/)
  return { tipo: palavrasDoTipo(tipo), extras: new Set(palavrasDoTipo(resto.join(' '))) }
}

// Foto do tipo: as palavras do tipo do item estão todas no nome da foto, e
// o nome da foto não tem palavra que o item não tem ("JOELHO MACHO 90°" não
// serve pra "JOELHO 90°"). PPR VERDE só pra item verde e vice-versa; foto
// de subpasta PPR só pra item PPR (um TEE galvanizado não pega a do TEE PPR).
export function fotoDoTipo(nomeItem: string, arquivos: ArquivoProduto[]): ArquivoProduto | null {
  const { tipo, extras } = tipoDoItem(nomeItem)
  if (!tipo.length) return null
  const itemVerde = /\bVERDE\b/.test(normal(nomeItem))
  const itemPpr = /\b(PPR|VERDE)\b/.test(normal(nomeItem))
  const doItem = new Set([...tipo, ...extras])
  let melhor: ArquivoProduto | null = null
  for (const a of arquivos) {
    if (!a.porTipo || codigoNoCaminho(a)) continue
    if (/\bVERDE\b/.test(normal(`${a.caminho} ${a.nome}`)) !== itemVerde) continue
    if (/\bPPR\b/.test(normal(a.caminho)) && !itemPpr) continue
    const daFoto = palavrasDoTipo(a.nome)
    if (!daFoto.length) continue
    if (!tipo.every((p) => daFoto.includes(p))) continue
    if (!daFoto.every((p) => doItem.has(p))) continue
    // Duas fotos servem: fica a de nome mais parecido (menos palavras a mais).
    if (!melhor || daFoto.length < palavrasDoTipo(melhor.nome).length) melhor = a
  }
  return melhor
}

// Liga as fotos das pastas aos itens. Roda de 15 em 15 min e na subida do
// servidor; barato (algumas centenas de arquivos e ~2.600 itens).
export async function sincronizarFotosMidia(): Promise<{ porCodigo: number; porTipo: number; removidas: number }> {
  const arquivos = await arquivosDasPastasDeProdutos()
  const atuais = new Map((await db.select().from(itemFotos)).map((l) => [l.itemCodigo, l]))

  const porCodigo = new Map<string, string>()
  for (const a of arquivos) {
    const codigo = codigoNoCaminho(a)
    if (codigo && !porCodigo.has(codigo)) porCodigo.set(codigo, a.url)
  }

  const porTipo = new Map<string, string>()
  if (arquivos.some((a) => a.porTipo)) {
    const itens = await db.all<{ item_codigo: string; nome: string }>(sql`SELECT item_codigo, nome FROM sap_catalogo_itens WHERE ativo = 1`)
    for (const i of itens) {
      if (porCodigo.has(i.item_codigo)) continue
      const a = fotoDoTipo(i.nome, arquivos)
      if (a) porTipo.set(i.item_codigo, a.url)
    }
  }

  let removidas = 0
  const gravar = async (itemCodigo: string, url: string, origem: OrigemFoto) =>
    db
      .insert(itemFotos)
      .values({ itemCodigo, url, origem })
      .onConflictDoUpdate({ target: itemFotos.itemCodigo, set: { url, origem, atualizadoPorId: null, atualizadoEm: sql`(datetime('now'))` } })

  for (const [codigo, url] of porCodigo) {
    const atual = atuais.get(codigo)
    if (atual?.origem === 'upload') continue
    if (atual?.origem === 'midia' && atual.url === url) continue
    await gravar(codigo, url, 'midia')
  }
  for (const [codigo, url] of porTipo) {
    const atual = atuais.get(codigo)
    if (atual && atual.origem !== 'tipo') continue
    if (atual?.url === url) continue
    await gravar(codigo, url, 'tipo')
  }
  // Foto que saiu da pasta (apagada, movida ou renomeada sem o código): some
  // daqui e o recorte do catálogo volta, se tiver.
  for (const [codigo, atual] of atuais) {
    if (atual.origem === 'midia' && !porCodigo.has(codigo)) {
      await db.delete(itemFotos).where(sql`${itemFotos.itemCodigo} = ${codigo} AND ${itemFotos.origem} = 'midia'`)
      removidas++
    } else if (atual.origem === 'tipo' && !porTipo.has(codigo) && !porCodigo.has(codigo)) {
      await db.delete(itemFotos).where(sql`${itemFotos.itemCodigo} = ${codigo} AND ${itemFotos.origem} = 'tipo'`)
      removidas++
    }
  }
  if (removidas) await semearFotosCatalogo()
  return { porCodigo: porCodigo.size, porTipo: porTipo.size, removidas }
}
