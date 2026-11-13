import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas } from '../db/schema.js'

// Odin Tubos (João, 2026-11-13): "conferência dos tubos na hora da NF" e
// "conferir de novo o pedido não pode acontecer". Na conferência normal o
// conferente conta só as conexões; os TUBOS são conferidos (às cegas, uma vez
// só) quando o pedido está na etapa da NF, antes de liberar a coleta.
export const EMPRESAS_TUBO_NA_NF = ['odin-tubos']
export const ETAPAS_CONFERE_TUBO = ['nf', 'agendamento', 'coleta'] as const

// "TUBO DE PPR - MEDIDAS: 32 MM X 3 METROS ..." — igual ao SQL `ltrim(descricao) like 'TUBO %'`.
export const ehTubo = (descricao: string | null | undefined) => /^TUBO\s/i.test((descricao ?? '').trimStart())
export const SQL_EH_TUBO = `ltrim(descricao) like 'TUBO %'`

export async function tuboNaNf(empresaId: number): Promise<boolean> {
  const e = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId), columns: { slug: true } })
  return EMPRESAS_TUBO_NA_NF.includes(e?.slug ?? '')
}

// Leitor de código de barras na coleta (João, 2026-11-13). Aceita:
//  - etiqueta de volume do CRM: "V<pedido>-<volume>" (ex.: V9441-2)
//  - código de barras da DANFE: chave de acesso de 44 dígitos (nº da NF nas posições 26–34)
//  - número do pedido ou da NF digitado
export type LeituraColeta = { tipo: 'volume'; pedido: string; volume: number } | { tipo: 'nf'; nf: string } | { tipo: 'numero'; numero: string }
export function lerCodigoColeta(bruto: string): LeituraColeta | null {
  const c = bruto.trim().toUpperCase().replace(/\s+/g, '')
  const vol = /^V(\d+)-(\d+)$/.exec(c)
  if (vol) return { tipo: 'volume', pedido: vol[1], volume: Number(vol[2]) }
  const digitos = c.replace(/\D/g, '')
  if (digitos.length === 44) return { tipo: 'nf', nf: String(Number(digitos.slice(25, 34))) }
  if (/^\d{1,9}$/.test(c)) return { tipo: 'numero', numero: String(Number(c)) }
  return null
}

