// Config do aviso de leads novos no WhatsApp — fonte da verdade é a tabela
// `configuracoes` (editável pela tela Automações). O `.env` só SEMEIA os
// valores na 1ª subida (seedAvisoLeadsConfigFromEnv); depois disso é ignorado.
//
// Chaves na tabela (prefixo `aviso_leads_`) ↔ variáveis de ambiente antigas:
//   enabled        ↔ AVISO_LEADS_ENABLED
//   dry_run        ↔ AVISO_LEADS_DRY_RUN
//   test_mode      ↔ AVISO_LEADS_TEST_MODE
//   test_numero    ↔ AVISO_LEADS_TEST_NUMERO
//   admin_numero   ↔ AVISO_LEADS_ADMIN_NUMERO
//   horarios       ↔ AVISO_LEADS_HORARIOS       ("HH:MM,HH:MM")
//   empresa_id     ↔ AVISO_LEADS_EMPRESA_ID
//   min_intervalo_ms ↔ AVISO_LEADS_MIN_INTERVALO_MS
//   max_intervalo_ms ↔ AVISO_LEADS_MAX_INTERVALO_MS

import { getConfigTexto, getConfigNumero, getConfigBool, setConfig, configExiste } from './configuracoes.js'

export interface AvisoLeadsConfig {
  enabled: boolean
  dryRun: boolean
  testMode: boolean
  testNumero: string
  adminNumero: string
  horarios: string // "HH:MM,HH:MM"
  empresaId: number
  minIntervaloMs: number
  maxIntervaloMs: number
}

export const AVISO_LEADS_DEFAULTS: AvisoLeadsConfig = {
  enabled: false,
  dryRun: false,
  testMode: false,
  testNumero: '',
  adminNumero: '',
  horarios: '08:00,17:30',
  empresaId: 1,
  minIntervaloMs: 3000,
  maxIntervaloMs: 5000,
}

const K = {
  enabled: 'aviso_leads_enabled',
  dryRun: 'aviso_leads_dry_run',
  testMode: 'aviso_leads_test_mode',
  testNumero: 'aviso_leads_test_numero',
  adminNumero: 'aviso_leads_admin_numero',
  horarios: 'aviso_leads_horarios',
  empresaId: 'aviso_leads_empresa_id',
  minIntervaloMs: 'aviso_leads_min_intervalo_ms',
  maxIntervaloMs: 'aviso_leads_max_intervalo_ms',
} as const

const K_ULTIMA_EXEC = 'aviso_leads_ultima_execucao'

export async function getAvisoLeadsConfig(): Promise<AvisoLeadsConfig> {
  const [enabled, dryRun, testMode, testNumero, adminNumero, horarios, empresaId, minIntervaloMs, maxIntervaloMs] =
    await Promise.all([
      getConfigBool(K.enabled, AVISO_LEADS_DEFAULTS.enabled),
      getConfigBool(K.dryRun, AVISO_LEADS_DEFAULTS.dryRun),
      getConfigBool(K.testMode, AVISO_LEADS_DEFAULTS.testMode),
      getConfigTexto(K.testNumero),
      getConfigTexto(K.adminNumero),
      getConfigTexto(K.horarios),
      getConfigNumero(K.empresaId, AVISO_LEADS_DEFAULTS.empresaId),
      getConfigNumero(K.minIntervaloMs, AVISO_LEADS_DEFAULTS.minIntervaloMs),
      getConfigNumero(K.maxIntervaloMs, AVISO_LEADS_DEFAULTS.maxIntervaloMs),
    ])
  return {
    enabled,
    dryRun,
    testMode,
    testNumero: (testNumero ?? AVISO_LEADS_DEFAULTS.testNumero).trim(),
    adminNumero: (adminNumero ?? AVISO_LEADS_DEFAULTS.adminNumero).trim(),
    horarios: (horarios ?? AVISO_LEADS_DEFAULTS.horarios).trim(),
    empresaId,
    minIntervaloMs,
    maxIntervaloMs,
  }
}

type AvisoLeadsConfigPatch = Partial<AvisoLeadsConfig>

// Valida e grava só o que veio no patch. Lança em valor inválido.
export async function setAvisoLeadsConfig(patch: AvisoLeadsConfigPatch): Promise<void> {
  const ops: Promise<void>[] = []

  if (patch.enabled !== undefined) ops.push(setConfig(K.enabled, patch.enabled ? '1' : '0'))
  if (patch.dryRun !== undefined) ops.push(setConfig(K.dryRun, patch.dryRun ? '1' : '0'))
  if (patch.testMode !== undefined) ops.push(setConfig(K.testMode, patch.testMode ? '1' : '0'))
  if (patch.testNumero !== undefined) ops.push(setConfig(K.testNumero, patch.testNumero.trim()))
  if (patch.adminNumero !== undefined) ops.push(setConfig(K.adminNumero, patch.adminNumero.trim()))

  if (patch.horarios !== undefined) {
    const h = patch.horarios.trim()
    const partes = h.split(',').map((s) => s.trim()).filter(Boolean)
    if (partes.length !== 2 || partes.some((p) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(p))) {
      throw new Error('Horários inválidos — informe dois horários no formato "HH:MM,HH:MM"')
    }
    ops.push(setConfig(K.horarios, partes.join(',')))
  }

  if (patch.empresaId !== undefined) {
    if (!Number.isInteger(patch.empresaId) || patch.empresaId < 1) throw new Error('empresaId inválido')
    ops.push(setConfig(K.empresaId, patch.empresaId))
  }

  if (patch.minIntervaloMs !== undefined) {
    if (patch.minIntervaloMs < 0) throw new Error('Intervalo mínimo inválido')
    ops.push(setConfig(K.minIntervaloMs, patch.minIntervaloMs))
  }
  if (patch.maxIntervaloMs !== undefined) {
    if (patch.maxIntervaloMs < 0) throw new Error('Intervalo máximo inválido')
    ops.push(setConfig(K.maxIntervaloMs, patch.maxIntervaloMs))
  }

  await Promise.all(ops)
}

// Roda uma vez na subida do servidor: pra cada chave que ainda NÃO existe na
// tabela, grava o valor da variável de ambiente correspondente (se definida)
// ou o padrão. Nunca sobrescreve o que já está na tabela.
export async function seedAvisoLeadsConfigFromEnv(): Promise<void> {
  const env = process.env
  const semear: [chave: string, valor: string][] = []

  const add = async (chave: string, valor: string) => {
    if (!(await configExiste(chave))) semear.push([chave, valor])
  }

  await Promise.all([
    add(K.enabled, boolFromEnv(env.AVISO_LEADS_ENABLED, AVISO_LEADS_DEFAULTS.enabled)),
    add(K.dryRun, boolFromEnv(env.AVISO_LEADS_DRY_RUN, AVISO_LEADS_DEFAULTS.dryRun)),
    add(K.testMode, boolFromEnv(env.AVISO_LEADS_TEST_MODE, AVISO_LEADS_DEFAULTS.testMode)),
    add(K.testNumero, (env.AVISO_LEADS_TEST_NUMERO ?? AVISO_LEADS_DEFAULTS.testNumero).trim()),
    add(K.adminNumero, (env.AVISO_LEADS_ADMIN_NUMERO ?? AVISO_LEADS_DEFAULTS.adminNumero).trim()),
    add(K.horarios, (env.AVISO_LEADS_HORARIOS ?? AVISO_LEADS_DEFAULTS.horarios).trim()),
    add(K.empresaId, String(Number(env.AVISO_LEADS_EMPRESA_ID ?? AVISO_LEADS_DEFAULTS.empresaId))),
    add(K.minIntervaloMs, String(Number(env.AVISO_LEADS_MIN_INTERVALO_MS ?? AVISO_LEADS_DEFAULTS.minIntervaloMs))),
    add(K.maxIntervaloMs, String(Number(env.AVISO_LEADS_MAX_INTERVALO_MS ?? AVISO_LEADS_DEFAULTS.maxIntervaloMs))),
  ])

  for (const [chave, valor] of semear) await setConfig(chave, valor)
  if (semear.length) console.log(`[aviso-leads] config semeada na tabela (${semear.length} chave(s))`)
}

function boolFromEnv(v: string | undefined, padrao: boolean): string {
  if (v === undefined) return padrao ? '1' : '0'
  return v === 'true' || v === '1' ? '1' : '0'
}

// ── Última execução (pra mostrar na tela) ───────────────────────────────────

export interface UltimaExecucao {
  em: string // ISO
  periodo: 'manha' | 'tarde'
  modo: 'real' | 'teste' | 'dry-run'
  vendedoresNotificados: number
  leadsNoTotal: number
  leadsSemVendedor: number
  falhas: { vendedor: string; motivo: string }[]
  abortadoPorConexao: boolean
}

export async function registrarUltimaExecucao(dados: UltimaExecucao): Promise<void> {
  await setConfig(K_ULTIMA_EXEC, JSON.stringify(dados))
}

export async function getUltimaExecucao(): Promise<UltimaExecucao | null> {
  const raw = await getConfigTexto(K_ULTIMA_EXEC)
  if (!raw) return null
  try {
    return JSON.parse(raw) as UltimaExecucao
  } catch {
    return null
  }
}
