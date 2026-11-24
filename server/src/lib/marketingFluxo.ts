// Módulo Marketing, parte 2 (João, 2026-11-22): peças da semana criadas
// sozinhas (meta 3 vídeos + 2 posts por marca), checklist padrão e regras do
// link de aprovação. Usado pelo router `marketingFluxo` e pelo agendador.
import crypto from 'crypto'
import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { mktPlanos, mktPecas, mktPecaEtapas } from '../db/schema.js'
import { MARCAS } from './marketingIa.js'
import { getConfigNumero, getConfigTexto } from './configuracoes.js'

const TZ = 'America/Sao_Paulo'

export const PILARES_PADRAO = [['Produto', 'azul', 'Produto em destaque para vender'], ['Resolver', 'laranja', 'Dor do cliente → produto'], ['Provar', 'verde', 'Mostrar que funciona de verdade'], ['Conectar', 'roxo', 'Pessoas e cultura do grupo'], ['Leveza', 'amarelo', 'Humor de chão de fábrica']]
  .map(([nome, cor, desc], i) => ({ id: `p${i + 1}`, nome, cor, desc, estrategias: [], formatos: [], canais: [], metricas: [] }))

export const CHECK_VIDEO = ['Roteiro escrito', 'Gravado', 'Editado', 'Legenda pronta', 'Vídeo anexado']
export const CHECK_POST = ['Texto da arte', 'Arte pronta', 'Legenda pronta', 'Arte anexada']
export function checklistPadrao(tipo: string) {
  return (tipo === 'Post' ? CHECK_POST : CHECK_VIDEO).map((t) => ({ t, ok: false }))
}

function agoraSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}
export function hojeBR() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}
function somarDias(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}
function diaSemana(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
// Segunda-feira da semana de `iso`.
export function segundaDe(iso: string) {
  const dw = diaSemana(iso)
  return somarDias(iso, dw === 0 ? -6 : 1 - dw)
}

// Garante o plano da marca naquele mês (copiando os pilares do último plano).
export async function garantirPlano(empresaId: number, mes: string, userId: number | null) {
  const id = `${empresaId}-${mes}`
  const ja = await db.query.mktPlanos.findFirst({ where: eq(mktPlanos.id, id) })
  if (ja) return ja
  const ant = await db.query.mktPlanos.findFirst({ where: and(eq(mktPlanos.empresaId, empresaId), lt(mktPlanos.mes, mes)), orderBy: desc(mktPlanos.mes) })
  let pilares: any = PILARES_PADRAO
  try { if (ant) pilares = JSON.parse(ant.dados).pilares || PILARES_PADRAO } catch { /* padrão */ }
  const dados = { objetivo: '', mensagem: '', pilares, semanas: [], metas: [], funcionou: [], travou: [], diagnostico: [], recomendacoes: [] }
  await db.insert(mktPlanos).values({ id, empresaId, mes, dados: JSON.stringify(dados), atualizadoPor: userId }).onConflictDoNothing()
  return (await db.query.mktPlanos.findFirst({ where: eq(mktPlanos.id, id) }))!
}

// Vídeos seg/qua/sex, posts ter/qui (índice a partir da segunda).
const DIAS_VIDEO = [0, 2, 4, 1, 3]
const DIAS_POST = [1, 3, 0, 2, 4]

// Cria só o que falta para cada marca bater a meta da semana. Nunca apaga nem
// mexe em peça existente.
export async function gerarPecasDaSemana(opts: { segunda?: string; userId?: number | null; empresas?: number[] } = {}) {
  const seg = segundaDe(opts.segunda || hojeBR())
  const dom = somarDias(seg, 6)
  const metaV = await getConfigNumero('mkt_meta_videos_semana', 3)
  const metaP = await getConfigNumero('mkt_meta_posts_semana', 2)
  const out: { empresaId: number; nome: string; videos: number; posts: number }[] = []
  for (const m of MARCAS) {
    if (opts.empresas && !opts.empresas.includes(m.empresaId)) continue
    // Demanda complementar não conta para a meta da semana.
    const ja = (await db.select({ tipo: mktPecas.tipo, data: mktPecas.data, pilar: mktPecas.pilar, origem: mktPecas.origem }).from(mktPecas)
      .where(and(eq(mktPecas.empresaId, m.empresaId), gte(mktPecas.data, seg), lte(mktPecas.data, dom)))).filter((p) => p.origem !== 'complementar')
    const temV = ja.filter((p) => p.tipo !== 'Post')
    const temP = ja.filter((p) => p.tipo === 'Post')
    const criar: { tipo: 'Vídeo' | 'Post'; data: string }[] = []
    const escolherDias = (dias: number[], ocupados: string[], qtd: number) => {
      const livres = dias.map((i) => somarDias(seg, i)).filter((d) => !ocupados.includes(d))
      const res: string[] = []
      for (let i = 0; i < qtd; i++) res.push(livres[i] ?? somarDias(seg, dias[i % dias.length]))
      return res
    }
    escolherDias(DIAS_VIDEO, temV.map((p) => p.data || ''), Math.max(0, metaV - temV.length)).forEach((data) => criar.push({ tipo: 'Vídeo', data }))
    escolherDias(DIAS_POST, temP.map((p) => p.data || ''), Math.max(0, metaP - temP.length)).forEach((data) => criar.push({ tipo: 'Post', data }))
    let nV = temV.length, nP = temP.length
    for (const c of criar) {
      const plano = await garantirPlano(m.empresaId, c.data.slice(0, 7), opts.userId ?? null)
      // Pilar com menos peças no mês, para equilibrar.
      let pilares: { id: string }[] = []
      try { pilares = JSON.parse(plano.dados).pilares || [] } catch { /* sem pilar */ }
      let pilar: string | null = null
      if (pilares.length) {
        const cont = await db.select({ pilar: mktPecas.pilar, n: sql<number>`count(*)` }).from(mktPecas).where(eq(mktPecas.planoId, plano.id)).groupBy(mktPecas.pilar)
        pilar = [...pilares].sort((a, b) => (cont.find((x) => x.pilar === a.id)?.n || 0) - (cont.find((x) => x.pilar === b.id)?.n || 0))[0].id
      }
      const n = c.tipo === 'Post' ? ++nP : ++nV
      await db.insert(mktPecas).values({
        id: crypto.randomUUID(), empresaId: m.empresaId, planoId: plano.id, data: c.data, hora: '11:00', tipo: c.tipo, pilar,
        titulo: `${c.tipo} ${n} da semana · pauta a definir`, status: 'Ideia', origem: 'auto',
        canais: JSON.stringify(c.tipo === 'Post' ? ['Instagram', 'Facebook'] : ['Reels Instagram', 'Reels Facebook', 'TikTok', 'YouTube Shorts']),
        checklist: JSON.stringify(checklistPadrao(c.tipo)), updatedAt: agoraSql(),
      })
    }
    out.push({ empresaId: m.empresaId, nome: m.nome, videos: criar.filter((c) => c.tipo === 'Vídeo').length, posts: criar.filter((c) => c.tipo === 'Post').length })
  }
  return { segunda: seg, domingo: dom, marcas: out, total: out.reduce((s, x) => s + x.videos + x.posts, 0) }
}

// Agendador (segunda 6h10): só roda se o módulo já está em uso (tem plano) e
// se não foi desligado na aba Metas.
export async function gerarSemanaAgendado() {
  if ((await getConfigTexto('mkt_auto_semana')) === '0') return null
  const algum = await db.query.mktPlanos.findFirst()
  if (!algum) return null
  const r = await gerarPecasDaSemana()
  return r.total ? `${r.total} peças criadas para a semana de ${r.segunda}` : null
}

// Link de aprovação antigo (tirado da tela em 2026-11-23, links já mandados
// ainda abrem): segue as etapas novas.
export function statusAoAprovar(status: string) {
  if (['Ideia', 'Roteiro', 'Aprovação do roteiro'].includes(status)) return 'Produção'
  return status
}
export function statusAoPedirAjuste(status: string) {
  if (['Ideia', 'Roteiro', 'Aprovação do roteiro'].includes(status)) return 'Roteiro'
  if (['Produção', 'Aprovação final'].includes(status)) return 'Produção'
  return status
}

// Histórico de etapas (0183): as datas são gravadas pelos gatilhos do banco;
// aqui só se anota quem fez a mudança na etapa que acabou de abrir.
export async function marcarQuemEtapa(pecaId: string, nome: string) {
  await db.update(mktPecaEtapas).set({ porNome: nome.slice(0, 80) }).where(and(eq(mktPecaEtapas.pecaId, pecaId), sql`${mktPecaEtapas.saiuEm} IS NULL`, eq(mktPecaEtapas.porNome, '')))
}
export async function etapaAtualDesde(pecaIds: string[]) {
  const out = new Map<string, { desde: string; estimado: boolean }>()
  for (let i = 0; i < pecaIds.length; i += 500) {
    const lote = pecaIds.slice(i, i + 500)
    const rows = await db.select().from(mktPecaEtapas).where(and(inArray(mktPecaEtapas.pecaId, lote), sql`${mktPecaEtapas.saiuEm} IS NULL`))
    for (const r of rows) {
      const a = out.get(r.pecaId)
      if (!a || r.entrouEm > a.desde) out.set(r.pecaId, { desde: r.entrouEm, estimado: r.estimado })
    }
  }
  return out
}
