import { eq, sql } from 'drizzle-orm'
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

// Pedido SÓ de tubos (João, 2026-11-16: "pedidos que forem somente tubos não
// precisam da conferência"): não tem conexão pra contar na conferência — os
// tubos já são conferidos na etapa da NF —, então da separação vai direto pra
// embalagem. Vale só onde o tubo é conferido na NF (Odin Tubos).
export const SQL_PEDIDO_SO_TUBOS = (alias: string) =>
  `exists (select 1 from expedicao_itens i where i.expedicao_id = ${alias}.id) and not exists (select 1 from expedicao_itens i where i.expedicao_id = ${alias}.id and not (ltrim(i.descricao) like 'TUBO %'))`

export async function pedidoSoTubos(expedicaoId: number, empresaId: number): Promise<boolean> {
  if (!(await tuboNaNf(empresaId))) return false
  const r = await db.all<{ n: number }>(
    sql.raw(`select count(*) as n from expedicao_pedidos p where p.id = ${Number(expedicaoId)} and ${SQL_PEDIDO_SO_TUBOS('p')}`)
  )
  return Number(r[0]?.n ?? 0) > 0
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

