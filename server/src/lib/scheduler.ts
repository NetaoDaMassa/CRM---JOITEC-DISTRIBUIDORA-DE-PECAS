import cron from 'node-cron'
import { executarResetMensal } from './resetMensal.js'
import { checarClientesSemContato } from './notificacoes.js'
import { executarBackupSeNecessario } from './backup.js'
import { executarResumoDiario } from './resumoDiario.js'
import { getConfigTexto, getConfigNumero } from './configuracoes.js'
import { registrarLigacoesAutomaticasPabxone360 } from './pabxone360.js'
import { executarAvisoLeadsNovos, type Periodo } from './avisoLeadsNovos.js'
import { ensureStarted as iniciarSessaoWhatsapp } from './whatsapp/session.js'
import { getAvisoLeadsConfig, seedAvisoLeadsConfigFromEnv, getAvisoLeadsEmpresasAtivas } from './avisoLeadsConfig.js'
import { runLeadsSlaChecks } from './leadsSlaScheduler.js'
import type { ScheduledTask } from 'node-cron'

// Reescrito parcialmente nos blocos 6 (reset mensal), 8 (notificações), 13
// (backup) e 14 (resumo diário).
export async function runChecks() {
  const { criados } = await executarResetMensal()
  if (criados > 0) console.log(`[reset-mensal] ${criados} funil(is) criado(s) para o mês corrente`)

  const { criadas } = await checarClientesSemContato()
  if (criadas > 0) console.log(`[notificacoes] ${criadas} alerta(s) de cliente sem contato criado(s)`)

  const backup = await executarBackupSeNecessario()
  if (backup) console.log(`[backup] backup diário criado: ${backup.arquivo}`)

  const { criadas: resumosCriados } = await executarResumoDiario()
  if (resumosCriados > 0) console.log(`[resumo-diario] ${resumosCriados} resumo(s) diário(s) enviado(s)`)
}

// Integração de teste PABXONE360 (só Odin Tubos e Conexões, ver
// pabxone360.ts) — a API dela não tem webhook (só REST + polling), então a
// velocidade do registro automático depende só de quão frequente rodamos
// essa busca. Busca as ligações dos últimos 5 minutos a cada 1 minuto
// (sobreposição de 4min de propósito, contra queda momentânea do servidor;
// a tabela pabx_ligacoes_processadas evita duplicar mesmo com a sobreposição
// e com rodadas concorrentes, se uma demorar mais que 1min). Só roda de
// verdade quando as credenciais estão configuradas — sem elas, sai calado,
// não é erro (empresa nenhuma além da Odin Tubos configura isso).
async function sincronizarPabxone360() {
  const [usuario, token] = await Promise.all([getConfigTexto('pabxone360_usuario'), getConfigTexto('pabxone360_token')])
  if (!usuario || !token) return

  const duracaoMinima = await getConfigNumero('pabxone360_duracao_minima_segundos', 15)
  const fim = new Date()
  const inicio = new Date(fim.getTime() - 5 * 60 * 1000)
  const resultados = await registrarLigacoesAutomaticasPabxone360(usuario, token, inicio, fim, duracaoMinima)
  const registradas = resultados.filter((r) => r.registroContatoId).length
  if (registradas > 0) console.log(`[pabxone360] ${registradas} ligação(ões) registrada(s) automaticamente`)
}

// Aviso amigável de leads novos no WhatsApp (ver avisoLeadsNovos.ts) — POR
// EMPRESA. 2x por dia, só dias úteis, fuso America/Sao_Paulo. Config na tabela
// `configuracoes` (tela Automações) — este agendador relê a cada minuto e se
// re-registra sozinho quando o gestor liga/desliga ou muda os horários de
// qualquer empresa. O WhatsApp que envia é um só pra todas.
const tarefasAvisoLeads = new Map<number, ScheduledTask[]>() // empresaId → tarefas
const assinaturaPorEmpresa = new Map<number, string>() // empresaId → "horarios|dryRun"

function pararTarefasEmpresa(empresaId: number) {
  for (const t of tarefasAvisoLeads.get(empresaId) ?? []) {
    try {
      t.stop()
      t.destroy?.()
    } catch {
      // ignora
    }
  }
  tarefasAvisoLeads.delete(empresaId)
}

// (Re)registra os crons de cada empresa com a automação ligada. Chamada no
// boot, a cada minuto, e na hora pelo router quando o gestor salva a tela.
export async function reagendarAvisoLeadsNovos(): Promise<void> {
  const ativas = new Set(await getAvisoLeadsEmpresasAtivas())

  // Empresas que estavam agendadas e não estão mais ativas → para.
  for (const empresaId of [...tarefasAvisoLeads.keys()]) {
    if (!ativas.has(empresaId)) {
      pararTarefasEmpresa(empresaId)
      assinaturaPorEmpresa.delete(empresaId)
      console.log(`[aviso-leads] empresa ${empresaId} desativada`)
    }
  }

  let algumaPrecisaSessao = false

  for (const empresaId of ativas) {
    const conf = await getAvisoLeadsConfig(empresaId)
    if (!conf.dryRun) algumaPrecisaSessao = true

    const horarios = conf.horarios.split(',').map((s) => s.trim()).filter(Boolean)
    const valido = horarios.length === 2 && horarios.every((h) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(h))
    const usar = valido ? horarios : ['08:00', '17:30']
    if (!valido) console.warn(`[aviso-leads] empresa ${empresaId}: horários inválidos ("${conf.horarios}"), usando 08:00,17:30`)

    const assinatura = `${usar.join(',')}|${conf.dryRun ? 1 : 0}`
    if (assinaturaPorEmpresa.get(empresaId) === assinatura) continue // nada mudou
    assinaturaPorEmpresa.set(empresaId, assinatura)
    pararTarefasEmpresa(empresaId)

    const periodos: Periodo[] = ['manha', 'tarde']
    const tarefas = usar.map((hhmm, idx) => {
      const [hora, minuto] = hhmm.split(':').map(Number)
      const periodo = periodos[idx]
      const tarefa = cron.schedule(
        `${minuto} ${hora} * * 1-5`, // seg–sex
        () => {
          getAvisoLeadsConfig(empresaId)
            .then((c) => executarAvisoLeadsNovos({ empresaId, periodo, dryRun: c.dryRun, testMode: c.testMode }))
            .catch((err) => console.error(`[aviso-leads] empresa ${empresaId}: erro na rodada agendada:`, err))
        },
        { timezone: 'America/Sao_Paulo' },
      )
      console.log(`[aviso-leads] empresa ${empresaId} agendada (${periodo}) ${hhmm} seg–sex, America/Sao_Paulo`)
      return tarefa
    })
    tarefasAvisoLeads.set(empresaId, tarefas)
  }

  if (ativas.size === 0) console.log('[aviso-leads] nenhuma empresa com a automação ligada')

  // Sobe a sessão do WhatsApp (uma só pra todas) se alguma empresa envia de verdade.
  if (algumaPrecisaSessao) {
    iniciarSessaoWhatsapp().catch((err) => console.error('[aviso-leads] falha ao iniciar sessão do WhatsApp:', err))
  }
}

async function iniciarAvisoLeadsNovos() {
  await seedAvisoLeadsConfigFromEnv().catch((err) => console.error('[aviso-leads] falha ao semear config:', err))
  await reagendarAvisoLeadsNovos().catch((err) => console.error('[aviso-leads] falha ao agendar:', err))
  // Relê a config a cada minuto — pega mudanças feitas pela tela mesmo que o
  // router não tenha chamado reagendar (defesa).
  cron.schedule('* * * * *', () => {
    reagendarAvisoLeadsNovos().catch((err) => console.error('[aviso-leads] falha ao reagendar:', err))
  })
}

export function startScheduler() {
  // Roda a cada hora — idempotente (só cria o que falta), então não tem
  // problema rodar de novo sem nada ter mudado.
  cron.schedule('0 * * * *', () => {
    runChecks().catch((err) => console.error('[scheduler] erro ao processar checagens:', err))
  })
  // Roda uma vez já na subida do servidor também, pra não depender de esperar
  // a próxima hora cheia (importante logo após importar clientes novos).
  runChecks().catch((err) => console.error('[scheduler] erro ao processar checagens iniciais:', err))
  console.log('[scheduler] reset mensal + notificações rodando a cada hora')

  cron.schedule('* * * * *', () => {
    sincronizarPabxone360().catch((err) => console.error('[pabxone360] erro ao sincronizar ligações:', err))
  })
  sincronizarPabxone360().catch((err) => console.error('[pabxone360] erro ao sincronizar ligações iniciais:', err))

  iniciarAvisoLeadsNovos().catch((err) => console.error('[aviso-leads] falha na inicialização:', err))

  // Motor de SLA de Leads (novo parado/rodízio/abordagem sem contato/
  // esfriando) — mesma cadência de 5min do sistema antigo, separado do
  // runChecks horário porque os limites aqui são medidos em horas, não dias.
  cron.schedule('*/5 * * * *', () => {
    runLeadsSlaChecks().catch((err) => console.error('[leads-sla] erro ao processar checagens:', err))
  })
  runLeadsSlaChecks().catch((err) => console.error('[leads-sla] erro ao processar checagens iniciais:', err))
}
