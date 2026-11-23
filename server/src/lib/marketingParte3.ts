// Módulo Marketing, parte 3 (pedido do João, 2026-11-23):
//  - etapas novas do quadro e as travas de cada uma
//  - revisores: João (vídeo e post), Maria (só vídeo), Gaby (só post) —
//    configurável em Conexões, guardado em configuracoes.mkt_revisores
//  - anexo vira arquivo em Arquivos/Mídia (pasta criada sozinha)
//  - base de conhecimento da empresa, que a IA lê
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { marketingArquivos, marketingPastas, mktConhecimento } from '../db/schema.js'
import { getConfigTexto, setConfig } from './configuracoes.js'

export const ETAPAS = ['Ideia', 'Roteiro', 'Aprovação do roteiro', 'Produção', 'Aprovação final', 'Agendado na mLabs'] as const
export const idxEtapa = (s: string) => Math.max(0, ETAPAS.indexOf(s as (typeof ETAPAS)[number]))

export type Anexo = { arquivoId: number; nome: string; path: string; tipo: string; tamanho: number; em: string; por: string }
export function lerAnexos(s: string | null | undefined): Anexo[] {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}

// Travas ao mudar de etapa. Demanda complementar não passa pela aprovação do roteiro.
export function erroTransicao(p: { status: string; origem: string; anexos: string; roteiroAprovadoEm: string | null; finalAprovadoEm: string | null }, novo: string): string | null {
  if (novo === p.status) return null
  if (!ETAPAS.includes(novo as (typeof ETAPAS)[number])) return 'Etapa inválida.'
  const i = idxEtapa(novo)
  const complementar = p.origem === 'complementar'
  if (i >= idxEtapa('Produção') && !complementar && !p.roteiroAprovadoEm) return 'O roteiro ainda não foi aprovado por um revisor. Mande para "Aprovação do roteiro" e espere a aprovação.'
  if (i >= idxEtapa('Aprovação final') && !lerAnexos(p.anexos).length) return 'Anexe o vídeo ou a arte na peça antes de mandar para a aprovação final.'
  if (novo === 'Agendado na mLabs' && !p.finalAprovadoEm) return 'A peça ainda não teve a aprovação final de um revisor.'
  return null
}

// ---------- revisores ----------
export type Revisor = { userId: number; video: boolean; post: boolean }
export async function lerRevisores(): Promise<Revisor[]> {
  try {
    const a = JSON.parse((await getConfigTexto('mkt_revisores')) || '[]')
    return Array.isArray(a) ? a.filter((r) => Number(r?.userId)).map((r) => ({ userId: Number(r.userId), video: !!r.video, post: !!r.post })) : []
  } catch { return [] }
}
export async function salvarRevisores(lista: Revisor[]) {
  await setConfig('mkt_revisores', JSON.stringify(lista))
}
export async function podeRevisar(userId: number, tipo: string) {
  const r = (await lerRevisores()).find((x) => x.userId === userId)
  if (!r) return false
  return tipo === 'Post' ? r.post : r.video
}

// ---------- Arquivos/Mídia ----------
// Acha (ou cria) a pasta pelo caminho, ex.: ['Marketing', 'Conteúdo 2026-12', '05/12 Vídeo · Título'].
export async function garantirPasta(empresaId: number, caminho: string[], userId: number | null): Promise<number> {
  let pai: number | null = null
  for (const bruto of caminho) {
    const nome = bruto.replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Sem nome'
    const cond = and(eq(marketingPastas.empresaId, empresaId), eq(marketingPastas.nome, nome), pai === null ? isNull(marketingPastas.pastaPaiId) : eq(marketingPastas.pastaPaiId, pai))
    const ja: { id: number } | undefined = await db.query.marketingPastas.findFirst({ where: cond, columns: { id: true } })
    if (ja) { pai = ja.id; continue }
    const r: { id: number }[] = await db.insert(marketingPastas).values({ empresaId, nome, pastaPaiId: pai, criadoPor: userId }).returning({ id: marketingPastas.id })
    pai = r[0].id
  }
  return pai!
}

export async function registrarAnexo(empresaId: number, pastaId: number, f: { path: string; nome: string; tipo?: string; tamanho?: number }, user: { id: number; name: string }): Promise<Anexo> {
  if (!/^\/uploads\/marketing-[\w-]+(\.[\w]+)?$/.test(f.path)) throw new Error('Arquivo inválido.')
  const r = await db.insert(marketingArquivos).values({
    empresaId, pastaId, nomeOriginal: f.nome.slice(0, 250), nomeArmazenado: f.path.replace('/uploads/', ''), tipoArquivo: f.tipo || null, tamanhoBytes: f.tamanho || null, enviadoPor: user.id,
  }).returning({ id: marketingArquivos.id })
  return { arquivoId: r[0].id, nome: f.nome.slice(0, 250), path: f.path, tipo: f.tipo || '', tamanho: f.tamanho || 0, em: new Date().toISOString(), por: user.name }
}

// ---------- base de conhecimento ----------
export const CATEGORIAS = ['Descrição da empresa', 'Produtos e catálogo', 'Playbook / jeito de falar', 'Informações fiscais', 'Informações gerais', 'Outro'] as const

// Texto que vai junto nos pedidos à IA: primeiro o que vale para o grupo
// todo, depois o da marca, na ordem das categorias. Corta em `limite`.
export async function conhecimentoTexto(empresaId: number, limite = 24000): Promise<string> {
  const rows = await db.select().from(mktConhecimento).where(or(isNull(mktConhecimento.empresaId), eq(mktConhecimento.empresaId, empresaId))).orderBy(asc(mktConhecimento.id))
  if (!rows.length) return ''
  const ordem = (c: string) => { const i = CATEGORIAS.indexOf(c as (typeof CATEGORIAS)[number]); return i < 0 ? 99 : i }
  rows.sort((a, b) => (a.empresaId === null ? 0 : 1) - (b.empresaId === null ? 0 : 1) || ordem(a.categoria) - ordem(b.categoria))
  let out = ''
  for (const r of rows) {
    const bloco = `### ${r.categoria}: ${r.titulo}${r.empresaId === null ? ' (vale para todo o grupo)' : ''}\n${r.texto.trim()}\n\n`
    if (out.length + bloco.length > limite) { out += bloco.slice(0, Math.max(0, limite - out.length)) + '\n[... cortado]'; break }
    out += bloco
  }
  return out.trim()
}
export async function blocoConhecimento(empresaId: number, limite?: number) {
  const t = await conhecimentoTexto(empresaId, limite)
  return t ? `\nBASE DE CONHECIMENTO DA EMPRESA (informação oficial: use para acertar produtos, termos e dados; não contradiga):\n${t}\n` : ''
}
