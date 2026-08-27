// Aviso amigável de leads novos no WhatsApp.
//
// 2x por dia (dias úteis) cada vendedor da Joitec recebe quantos leads ele
// tem parados na etapa "Novo" do funil, com a lista. NÃO é cobrança de
// atraso: não olha há quantos dias o lead está lá, não tem corte de tempo.
// É só um lembrete de "tem gente esperando seu contato".
//
// SOMENTE LEITURA na tabela de leads — não move, não marca, não altera nada
// no funil. A única escrita que este módulo faz é em `notifications` (sino do
// CRM), e só no caso de a sessão do WhatsApp estar fora do ar.
//
// Modos (por variável de ambiente ou parâmetro):
//  - dryRun   : monta tudo e escreve no log, NÃO envia.
//  - testMode : manda TODAS as mensagens pro AVISO_LEADS_TEST_NUMERO (um só
//               número), em vez de mandar pra cada vendedor.

import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, users, notifications } from '../db/schema.js'
import { ensureStarted, aguardarConexao, enviarTexto, precisaPareamento } from './whatsapp/session.js'

export type Periodo = 'manha' | 'tarde'

export interface OpcoesAviso {
  periodo: Periodo
  dryRun: boolean
  testMode: boolean
  empresaId?: number
}

export interface ResultadoAviso {
  periodo: Periodo
  dryRun: boolean
  testMode: boolean
  vendedoresNotificados: number
  leadsNoTotal: number
  leadsSemVendedor: number
  vendedoresSemNumero: string[]
  falhas: { vendedor: string; motivo: string }[]
  abortadoPorConexao: boolean
}

const MOSTRAR_NA_LISTA = 10

interface LeadResumo {
  name: string
  company: string | null
}

interface VendedorComLeads {
  vendedorId: number
  nome: string
  whatsapp: string | null
  leads: LeadResumo[]
}

function cfg() {
  return {
    empresaId: Number(process.env.AVISO_LEADS_EMPRESA_ID ?? 1),
    minMs: Number(process.env.AVISO_LEADS_MIN_INTERVALO_MS ?? 3000),
    maxMs: Number(process.env.AVISO_LEADS_MAX_INTERVALO_MS ?? 5000),
    testNumero: (process.env.AVISO_LEADS_TEST_NUMERO ?? '').trim(),
    adminNumero: (process.env.AVISO_LEADS_ADMIN_NUMERO || process.env.AVISO_LEADS_TEST_NUMERO || '').trim(),
  }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))
const aleatorio = (min: number, max: number) => Math.floor(min + Math.random() * Math.max(0, max - min))

function primeiroNome(nome: string): string {
  return (nome ?? '').trim().split(/\s+/)[0] || nome
}

// Rótulo de cada lead na lista da mensagem. Usa o `name` (coluna NOT NULL e,
// na prática, o campo legível deste CRM — nome da pessoa ou da empresa). O
// `company` aqui vem quase sempre com CNPJ cru ou lixo ("Sim", "Contato"),
// então não entra na mensagem; só serve de reserva se o `name` vier vazio.
function rotuloLead(l: LeadResumo): string {
  return (l.name ?? '').trim() || (l.company ?? '').trim() || 'Lead sem nome'
}

// ── Coleta ──────────────────────────────────────────────────────────────────

async function coletar(empresaId: number): Promise<{
  vendedores: VendedorComLeads[]
  semNumero: { nome: string; total: number }[]
  leadsSemVendedor: number
}> {
  const linhas = await db.query.leads.findMany({
    where: and(
      eq(leads.empresaId, empresaId),
      eq(leads.status, 'novo'),
      isNull(leads.deletedAt),
      isNotNull(leads.vendorId),
    ),
    columns: { id: true, name: true, company: true, vendorId: true },
    with: {
      vendor: { columns: { id: true, name: true, whatsapp: true, isActive: true } },
    },
  })

  const porVendedor = new Map<number, VendedorComLeads>()
  for (const lead of linhas) {
    const v = lead.vendor
    if (!v || !v.isActive) continue // vendedor inativo/removido: ignora
    let entrada = porVendedor.get(v.id)
    if (!entrada) {
      entrada = { vendedorId: v.id, nome: v.name, whatsapp: v.whatsapp?.trim() || null, leads: [] }
      porVendedor.set(v.id, entrada)
    }
    entrada.leads.push({ name: lead.name, company: lead.company })
  }

  const vendedores: VendedorComLeads[] = []
  const semNumero: { nome: string; total: number }[] = []
  for (const entrada of porVendedor.values()) {
    if (entrada.whatsapp) vendedores.push(entrada)
    else semNumero.push({ nome: entrada.nome, total: entrada.leads.length })
  }

  // ordena por volume (quem tem mais lead esperando primeiro) só pra deixar
  // o log legível — a ordem de envio não muda nada pro vendedor.
  vendedores.sort((a, b) => b.leads.length - a.leads.length)

  const semVendedor = await db.query.leads.findMany({
    where: and(
      eq(leads.empresaId, empresaId),
      eq(leads.status, 'novo'),
      isNull(leads.deletedAt),
      isNull(leads.vendorId),
    ),
    columns: { id: true },
  })

  return { vendedores, semNumero, leadsSemVendedor: semVendedor.length }
}

// ── Mensagem ────────────────────────────────────────────────────────────────

export function montarMensagem(periodo: Periodo, nomeVendedor: string, listaLeads: LeadResumo[]): string {
  const nome = primeiroNome(nomeVendedor)
  const total = listaLeads.length
  const plural = total === 1 ? 'lead novo' : 'leads novos'

  const saudacao = periodo === 'manha' ? `Bom dia, ${nome}!` : `Boa tarde, ${nome}!`
  const abertura =
    periodo === 'manha'
      ? `Pra organizar o dia: você tem *${total} ${plural}* esperando o primeiro contato.`
      : `Fechando o dia: ainda tem *${total} ${plural}* esperando o primeiro contato. Dá tempo de falar com alguns antes de sair.`

  const visiveis = listaLeads.slice(0, MOSTRAR_NA_LISTA)
  const linhas = visiveis.map((l) => `• ${rotuloLead(l)}`).join('\n')
  const restantes = total - visiveis.length
  const rodapeLista =
    restantes > 0 ? `\n\n...e mais ${restantes} ${restantes === 1 ? 'lead' : 'leads'} no CRM.` : ''

  const fecho =
    periodo === 'manha'
      ? '\n\nÉ só um lembrete pra ninguém ficar esperando. Bom trabalho! 🙂'
      : '\n\nUm contato rápido agora já ajuda. 🙂'

  return `${saudacao}\n${abertura}\n\n${linhas}${rodapeLista}${fecho}`
}

function montarResumoAdmin(
  periodo: Periodo,
  dados: { notificados: number; semNumero: { nome: string; total: number }[]; leadsSemVendedor: number; falhas: { vendedor: string; motivo: string }[] },
): string {
  const partes: string[] = [
    `📋 *Aviso de leads novos* — rodada da ${periodo === 'manha' ? 'manhã' : 'tarde'}`,
    `${dados.notificados} vendedor(es) notificado(s).`,
  ]
  if (dados.leadsSemVendedor > 0) {
    partes.push(`\n⚠️ ${dados.leadsSemVendedor} lead(s) na etapa "Novo" estão *sem vendedor definido* no CRM — ninguém foi avisado deles.`)
  }
  if (dados.semNumero.length > 0) {
    const lista = dados.semNumero.map((s) => `${s.nome} (${s.total})`).join(', ')
    partes.push(`\n⚠️ Vendedor(es) com leads mas *sem WhatsApp cadastrado*: ${lista}.`)
  }
  if (dados.falhas.length > 0) {
    const lista = dados.falhas.map((f) => `${f.vendedor} — ${f.motivo}`).join('; ')
    partes.push(`\n❌ Falha no envio para: ${lista}.`)
  }
  return partes.join('\n')
}

// ── Escrita de fallback (sino do CRM) quando o WhatsApp está fora ────────────

async function avisarAdminsNoSino(empresaId: number, periodo: Periodo, motivo: string): Promise<void> {
  const admins = await db.query.users.findMany({
    where: and(eq(users.empresaId, empresaId), eq(users.role, 'admin'), eq(users.isActive, true)),
    columns: { id: true },
  })
  if (admins.length === 0) return
  await db.insert(notifications).values(
    admins.map((a) => ({
      vendedorId: a.id,
      type: 'aviso_leads_whatsapp_offline',
      title: 'WhatsApp desconectado',
      message: `A automação de aviso de leads novos (${periodo === 'manha' ? 'manhã' : 'tarde'}) não rodou: ${motivo}. Os vendedores não receberam o lembrete desta rodada.`,
    })),
  )
}

// ── Orquestração ────────────────────────────────────────────────────────────

export async function executarAvisoLeadsNovos(opts: OpcoesAviso): Promise<ResultadoAviso> {
  const { periodo, dryRun, testMode } = opts
  const base = cfg()
  const empresaId = opts.empresaId ?? base.empresaId
  const { minMs, maxMs, testNumero, adminNumero } = base
  const inicio = Date.now()

  const resultado: ResultadoAviso = {
    periodo,
    dryRun,
    testMode,
    vendedoresNotificados: 0,
    leadsNoTotal: 0,
    leadsSemVendedor: 0,
    vendedoresSemNumero: [],
    falhas: [],
    abortadoPorConexao: false,
  }

  if (testMode && !dryRun && !testNumero) {
    console.error('[aviso-leads] testMode ligado mas AVISO_LEADS_TEST_NUMERO está vazio — nada foi enviado.')
    resultado.abortadoPorConexao = true
    return resultado
  }

  const { vendedores, semNumero, leadsSemVendedor } = await coletar(empresaId)
  resultado.leadsSemVendedor = leadsSemVendedor
  resultado.vendedoresSemNumero = semNumero.map((s) => s.nome)
  resultado.leadsNoTotal =
    vendedores.reduce((s, v) => s + v.leads.length, 0) + semNumero.reduce((s, v) => s + v.total, 0)

  const temAlgoPraAvisarAdmin = leadsSemVendedor > 0 || semNumero.length > 0

  if (vendedores.length === 0 && !temAlgoPraAvisarAdmin) {
    console.log(`[aviso-leads] rodada ${periodo}: nenhum lead "Novo" com vendedor — nada a notificar.`)
    return resultado
  }

  // Conexão do WhatsApp (dry run não precisa)
  if (!dryRun && vendedores.length + (adminNumero ? 1 : 0) > 0) {
    await ensureStarted()
    const conectou = await aguardarConexao(60_000)
    if (!conectou) {
      const motivo = precisaPareamento()
        ? 'a sessão foi desconectada no celular e precisa parear o QR de novo'
        : 'a sessão do WhatsApp está desconectada'
      console.error(`[aviso-leads] ${motivo} — NADA foi enviado nesta rodada.`)
      try {
        await avisarAdminsNoSino(empresaId, periodo, motivo)
      } catch (err) {
        console.error('[aviso-leads] também falhou ao registrar o aviso no sino do CRM:', err)
      }
      resultado.abortadoPorConexao = true
      logFinal(resultado, inicio)
      return resultado
    }
  }

  // Envio por vendedor — falha de um NÃO derruba os outros
  for (let i = 0; i < vendedores.length; i++) {
    const v = vendedores[i]
    const texto = montarMensagem(periodo, v.nome, v.leads)
    const corpo = testMode ? `🧪 *TESTE* — esta mensagem iria para ${v.nome}\n\n${texto}` : texto
    const destino = testMode ? testNumero : (v.whatsapp as string)

    if (dryRun) {
      console.log(`\n──────── [DRY RUN] ${v.nome} <${v.whatsapp ?? 'sem número'}> — ${v.leads.length} lead(s) ────────\n${corpo}\n`)
      resultado.vendedoresNotificados++
    } else {
      try {
        await enviarTexto(destino, corpo)
        resultado.vendedoresNotificados++
        console.log(`[aviso-leads] enviado: ${v.nome} (${v.leads.length} lead(s))${testMode ? ' [via número de teste]' : ''}`)
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err)
        resultado.falhas.push({ vendedor: v.nome, motivo })
        console.error(`[aviso-leads] FALHA: ${v.nome} — ${motivo}`)
      }
    }

    if (i < vendedores.length - 1) {
      await dormir(dryRun ? 0 : aleatorio(minMs, maxMs))
    }
  }

  // Resumo pro admin (só se houver o que dizer)
  if (temAlgoPraAvisarAdmin || resultado.falhas.length > 0) {
    const resumo = montarResumoAdmin(periodo, {
      notificados: resultado.vendedoresNotificados,
      semNumero,
      leadsSemVendedor,
      falhas: resultado.falhas,
    })
    if (dryRun) {
      console.log(`\n──────── [DRY RUN] resumo para o admin <${adminNumero || 'sem número'}> ────────\n${resumo}\n`)
    } else if (adminNumero) {
      try {
        await dormir(aleatorio(minMs, maxMs))
        await enviarTexto(adminNumero, resumo)
        console.log('[aviso-leads] resumo enviado para o admin')
      } catch (err) {
        console.error('[aviso-leads] falha ao enviar o resumo para o admin:', err instanceof Error ? err.message : err)
      }
    } else {
      console.warn('[aviso-leads] há avisos para o admin mas AVISO_LEADS_ADMIN_NUMERO/TEST_NUMERO não está definido — resumo só no log:\n' + resumo)
    }
  }

  logFinal(resultado, inicio)
  return resultado
}

function logFinal(r: ResultadoAviso, inicioMs: number): void {
  const seg = ((Date.now() - inicioMs) / 1000).toFixed(1)
  const falhasTxt = r.falhas.length ? ` | falhas: ${r.falhas.map((f) => f.vendedor).join(', ')}` : ''
  console.log(
    `[aviso-leads] rodada ${r.periodo} concluída em ${seg}s | ` +
      `modo=${r.dryRun ? 'DRY RUN' : r.testMode ? 'TESTE' : 'real'} | ` +
      `${r.vendedoresNotificados} vendedor(es) notificado(s) | ` +
      `${r.leadsNoTotal} lead(s) no total | ` +
      `${r.leadsSemVendedor} sem vendedor | ` +
      `${r.falhas.length} falha(s)${falhasTxt}` +
      (r.abortadoPorConexao ? ' | ABORTADO: WhatsApp sem conexão' : ''),
  )
}
