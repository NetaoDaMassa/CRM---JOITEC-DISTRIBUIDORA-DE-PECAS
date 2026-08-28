// Config do aviso de leads novos no WhatsApp — POR EMPRESA. Fonte da verdade
// é a tabela `configuracoes` (editável pela tela Automações). Cada empresa
// tem seu próprio conjunto de chaves: `aviso_leads_<empresaId>_<nome>`.
//
// O WhatsApp que envia é o MESMO pra todas as empresas (uma sessão só,
// server/src/lib/whatsapp/session.ts) — o que muda por empresa é o funil
// lido, os horários, o texto, o número de teste e os modos.
//
// O `.env` (AVISO_LEADS_*) só semeia a empresa 1 (Joitec) na 1ª subida.
// Chaves antigas sem `<empresaId>` (do 1º deploy) são migradas pra empresa 1.

import { getConfigTexto, getConfigNumero, getConfigBool, setConfig, configExiste, listarConfigPrefixo } from './configuracoes.js'

export interface AvisoLeadsConfig {
  enabled: boolean
  dryRun: boolean
  testMode: boolean
  testNumero: string
  adminNumero: string
  horarios: string // "HH:MM,HH:MM"
  minIntervaloMs: number
  maxIntervaloMs: number
  msgManha: string
  msgTarde: string
}

// Texto padrão das mensagens — igual ao que era fixo no código. Editável pela
// tela. Atalhos: {nome} (1º nome do vendedor), {qtd} (só o número),
// {qtd_leads} ("1 lead novo" / "N leads novos"), {leads} (lista com
// marcadores, 10 primeiros + "...e mais X leads no CRM").
export const MSG_MANHA_PADRAO =
  'Bom dia, {nome}!\n' +
  'Pra organizar o dia: você tem *{qtd_leads}* esperando o primeiro contato.\n\n' +
  '{leads}\n\n' +
  'É só um lembrete pra ninguém ficar esperando. Bom trabalho! 🙂'

export const MSG_TARDE_PADRAO =
  'Boa tarde, {nome}!\n' +
  'Fechando o dia: ainda tem *{qtd_leads}* esperando o primeiro contato. Dá tempo de falar com alguns antes de sair.\n\n' +
  '{leads}\n\n' +
  'Um contato rápido agora já ajuda. 🙂'

export const AVISO_LEADS_DEFAULTS: AvisoLeadsConfig = {
  enabled: false,
  dryRun: false,
  testMode: false,
  testNumero: '',
  adminNumero: '',
  horarios: '08:00,17:30',
  minIntervaloMs: 3000,
  maxIntervaloMs: 5000,
  msgManha: MSG_MANHA_PADRAO,
  msgTarde: MSG_TARDE_PADRAO,
}

const PREFIXO = 'aviso_leads_'

// nomes curtos das chaves (o prefixo `aviso_leads_<empresaId>_` é montado por k())
const N = {
  enabled: 'enabled',
  dryRun: 'dry_run',
  testMode: 'test_mode',
  testNumero: 'test_numero',
  adminNumero: 'admin_numero',
  horarios: 'horarios',
  minIntervaloMs: 'min_intervalo_ms',
  maxIntervaloMs: 'max_intervalo_ms',
  msgManha: 'msg_manha',
  msgTarde: 'msg_tarde',
  ultimaExec: 'ultima_execucao',
} as const

function k(empresaId: number, nome: string): string {
  return `${PREFIXO}${empresaId}_${nome}`
}

export async function getAvisoLeadsConfig(empresaId: number): Promise<AvisoLeadsConfig> {
  const [enabled, dryRun, testMode, testNumero, adminNumero, horarios, minIntervaloMs, maxIntervaloMs, msgManha, msgTarde] =
    await Promise.all([
      getConfigBool(k(empresaId, N.enabled), AVISO_LEADS_DEFAULTS.enabled),
      getConfigBool(k(empresaId, N.dryRun), AVISO_LEADS_DEFAULTS.dryRun),
      getConfigBool(k(empresaId, N.testMode), AVISO_LEADS_DEFAULTS.testMode),
      getConfigTexto(k(empresaId, N.testNumero)),
      getConfigTexto(k(empresaId, N.adminNumero)),
      getConfigTexto(k(empresaId, N.horarios)),
      getConfigNumero(k(empresaId, N.minIntervaloMs), AVISO_LEADS_DEFAULTS.minIntervaloMs),
      getConfigNumero(k(empresaId, N.maxIntervaloMs), AVISO_LEADS_DEFAULTS.maxIntervaloMs),
      getConfigTexto(k(empresaId, N.msgManha)),
      getConfigTexto(k(empresaId, N.msgTarde)),
    ])
  return {
    enabled,
    dryRun,
    testMode,
    testNumero: (testNumero ?? AVISO_LEADS_DEFAULTS.testNumero).trim(),
    adminNumero: (adminNumero ?? AVISO_LEADS_DEFAULTS.adminNumero).trim(),
    horarios: (horarios ?? AVISO_LEADS_DEFAULTS.horarios).trim(),
    minIntervaloMs,
    maxIntervaloMs,
    msgManha: msgManha && msgManha.trim() ? msgManha : AVISO_LEADS_DEFAULTS.msgManha,
    msgTarde: msgTarde && msgTarde.trim() ? msgTarde : AVISO_LEADS_DEFAULTS.msgTarde,
  }
}

// empresaIds que já têm a automação LIGADA (pro agendador saber o que rodar).
export async function getAvisoLeadsEmpresasAtivas(): Promise<number[]> {
  const rows = await listarConfigPrefixo(PREFIXO)
  const ativos: number[] = []
  for (const { chave, valor } of rows) {
    const m = /^aviso_leads_(\d+)_enabled$/.exec(chave)
    if (m && (valor === '1' || valor.toLowerCase() === 'true')) ativos.push(Number(m[1]))
  }
  return ativos
}

type AvisoLeadsConfigPatch = Partial<AvisoLeadsConfig>

// Valida e grava só o que veio no patch, pra essa empresa. Lança em valor inválido.
export async function setAvisoLeadsConfig(empresaId: number, patch: AvisoLeadsConfigPatch): Promise<void> {
  const ops: Promise<void>[] = []
  const set = (nome: string, valor: string | number) => ops.push(setConfig(k(empresaId, nome), valor))

  if (patch.enabled !== undefined) set(N.enabled, patch.enabled ? '1' : '0')
  if (patch.dryRun !== undefined) set(N.dryRun, patch.dryRun ? '1' : '0')
  if (patch.testMode !== undefined) set(N.testMode, patch.testMode ? '1' : '0')
  if (patch.testNumero !== undefined) set(N.testNumero, patch.testNumero.trim())
  if (patch.adminNumero !== undefined) set(N.adminNumero, patch.adminNumero.trim())

  if (patch.horarios !== undefined) {
    const partes = patch.horarios.trim().split(',').map((s) => s.trim()).filter(Boolean)
    if (partes.length !== 2 || partes.some((p) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(p))) {
      throw new Error('Horários inválidos — informe dois horários no formato "HH:MM,HH:MM"')
    }
    set(N.horarios, partes.join(','))
  }

  if (patch.minIntervaloMs !== undefined) {
    if (patch.minIntervaloMs < 0) throw new Error('Intervalo mínimo inválido')
    set(N.minIntervaloMs, patch.minIntervaloMs)
  }
  if (patch.maxIntervaloMs !== undefined) {
    if (patch.maxIntervaloMs < 0) throw new Error('Intervalo máximo inválido')
    set(N.maxIntervaloMs, patch.maxIntervaloMs)
  }

  for (const [nome, valor, rotulo] of [
    [N.msgManha, patch.msgManha, 'texto da manhã'],
    [N.msgTarde, patch.msgTarde, 'texto da tarde'],
  ] as const) {
    if (valor === undefined) continue
    const t = valor.trim()
    if (!t) throw new Error(`O ${rotulo} não pode ficar vazio`)
    if (!t.includes('{leads}')) throw new Error(`O ${rotulo} precisa conter o atalho {leads} (a lista de leads)`)
    set(nome, t)
  }

  await Promise.all(ops)
}

// Roda uma vez na subida do servidor:
//  1) migra as chaves antigas sem <empresaId> (do 1º deploy) pra empresa 1;
//  2) semeia a empresa 1 a partir do .env / padrões, pro que ainda não existe.
// Nunca sobrescreve o que já está na tabela. As outras empresas começam
// sem config (a tela mostra os padrões, desligada).
export async function seedAvisoLeadsConfigFromEnv(): Promise<void> {
  const env = process.env
  const semear: [chave: string, valor: string][] = []
  const add = async (chave: string, valor: string) => {
    if (!(await configExiste(chave))) semear.push([chave, valor])
  }

  // 1) migração das chaves antigas (aviso_leads_enabled -> aviso_leads_1_enabled)
  const antigas: [nomeAntigo: string, nomeNovo: string][] = [
    ['aviso_leads_enabled', N.enabled],
    ['aviso_leads_dry_run', N.dryRun],
    ['aviso_leads_test_mode', N.testMode],
    ['aviso_leads_test_numero', N.testNumero],
    ['aviso_leads_admin_numero', N.adminNumero],
    ['aviso_leads_horarios', N.horarios],
    ['aviso_leads_min_intervalo_ms', N.minIntervaloMs],
    ['aviso_leads_max_intervalo_ms', N.maxIntervaloMs],
    ['aviso_leads_msg_manha', N.msgManha],
    ['aviso_leads_msg_tarde', N.msgTarde],
    ['aviso_leads_ultima_execucao', N.ultimaExec],
  ]
  await Promise.all(
    antigas.map(async ([antigo, novoNome]) => {
      const val = await getConfigTexto(antigo)
      if (val !== null) await add(k(1, novoNome), val)
    }),
  )

  // 2) semente da empresa 1 pelo .env / padrões
  await Promise.all([
    add(k(1, N.enabled), boolFromEnv(env.AVISO_LEADS_ENABLED, AVISO_LEADS_DEFAULTS.enabled)),
    add(k(1, N.dryRun), boolFromEnv(env.AVISO_LEADS_DRY_RUN, AVISO_LEADS_DEFAULTS.dryRun)),
    add(k(1, N.testMode), boolFromEnv(env.AVISO_LEADS_TEST_MODE, AVISO_LEADS_DEFAULTS.testMode)),
    add(k(1, N.testNumero), (env.AVISO_LEADS_TEST_NUMERO ?? AVISO_LEADS_DEFAULTS.testNumero).trim()),
    add(k(1, N.adminNumero), (env.AVISO_LEADS_ADMIN_NUMERO ?? AVISO_LEADS_DEFAULTS.adminNumero).trim()),
    add(k(1, N.horarios), (env.AVISO_LEADS_HORARIOS ?? AVISO_LEADS_DEFAULTS.horarios).trim()),
    add(k(1, N.minIntervaloMs), String(Number(env.AVISO_LEADS_MIN_INTERVALO_MS ?? AVISO_LEADS_DEFAULTS.minIntervaloMs))),
    add(k(1, N.maxIntervaloMs), String(Number(env.AVISO_LEADS_MAX_INTERVALO_MS ?? AVISO_LEADS_DEFAULTS.maxIntervaloMs))),
    add(k(1, N.msgManha), AVISO_LEADS_DEFAULTS.msgManha),
    add(k(1, N.msgTarde), AVISO_LEADS_DEFAULTS.msgTarde),
  ])

  for (const [chave, valor] of semear) await setConfig(chave, valor)
  if (semear.length) console.log(`[aviso-leads] config semeada/migrada (${semear.length} chave(s))`)
}

function boolFromEnv(v: string | undefined, padrao: boolean): string {
  if (v === undefined) return padrao ? '1' : '0'
  return v === 'true' || v === '1' ? '1' : '0'
}

// ── Última execução (por empresa, pra mostrar na tela) ──────────────────────

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

export async function registrarUltimaExecucao(empresaId: number, dados: UltimaExecucao): Promise<void> {
  await setConfig(k(empresaId, N.ultimaExec), JSON.stringify(dados))
}

export async function getUltimaExecucao(empresaId: number): Promise<UltimaExecucao | null> {
  const raw = await getConfigTexto(k(empresaId, N.ultimaExec))
  if (!raw) return null
  try {
    return JSON.parse(raw) as UltimaExecucao
  } catch {
    return null
  }
}
