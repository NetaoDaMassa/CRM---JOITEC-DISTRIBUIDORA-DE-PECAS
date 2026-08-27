import cron from 'node-cron'
import { executarResetMensal } from './resetMensal.js'
import { checarClientesSemContato } from './notificacoes.js'
import { executarBackupSeNecessario } from './backup.js'
import { executarResumoDiario } from './resumoDiario.js'
import { getConfigTexto, getConfigNumero } from './configuracoes.js'
import { registrarLigacoesAutomaticasPabxone360 } from './pabxone360.js'
import { executarAvisoLeadsNovos, type Periodo } from './avisoLeadsNovos.js'
import { ensureStarted as iniciarSessaoWhatsapp } from './whatsapp/session.js'

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

// Aviso amigável de leads novos no WhatsApp (ver avisoLeadsNovos.ts). 2x por
// dia, só dias úteis, fuso America/Sao_Paulo. Só liga com AVISO_LEADS_ENABLED
// =true — sem isso não agenda nada nem sobe a sessão do WhatsApp (a máquina
// de dev não deve brigar pela mesma sessão da VPS).
function agendarAvisoLeadsNovos() {
  if (process.env.AVISO_LEADS_ENABLED !== 'true') {
    console.log('[aviso-leads] desativado (defina AVISO_LEADS_ENABLED=true para ligar)')
    return
  }

  const bruto = process.env.AVISO_LEADS_HORARIOS ?? '08:00,17:30'
  let horarios = bruto.split(',').map((s) => s.trim()).filter(Boolean)
  if (horarios.length < 2) {
    console.warn(`[aviso-leads] AVISO_LEADS_HORARIOS precisa de 2 horários "HH:MM,HH:MM" (recebido: "${bruto}"). Usando 08:00,17:30`)
    horarios = ['08:00', '17:30']
  }

  const periodos: Periodo[] = ['manha', 'tarde']
  horarios.slice(0, 2).forEach((hhmm, idx) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
    if (!m) {
      console.error(`[aviso-leads] horário inválido ignorado: "${hhmm}"`)
      return
    }
    const hora = Number(m[1])
    const minuto = Number(m[2])
    const periodo = periodos[idx]
    // seg–sex (1-5)
    cron.schedule(
      `${minuto} ${hora} * * 1-5`,
      () => {
        executarAvisoLeadsNovos({
          periodo,
          dryRun: process.env.AVISO_LEADS_DRY_RUN === 'true',
          testMode: process.env.AVISO_LEADS_TEST_MODE === 'true',
        }).catch((err) => console.error('[aviso-leads] erro na rodada agendada:', err))
      },
      { timezone: 'America/Sao_Paulo' },
    )
    console.log(
      `[aviso-leads] agendado (${periodo}) ${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')} seg–sex, America/Sao_Paulo`,
    )
  })

  // Sobe a sessão do WhatsApp já, pra estar conectada quando a 1ª rodada
  // disparar. Dry run puro não precisa de WhatsApp.
  if (process.env.AVISO_LEADS_DRY_RUN !== 'true') {
    iniciarSessaoWhatsapp().catch((err) => console.error('[aviso-leads] falha ao iniciar sessão do WhatsApp:', err))
  }
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

  agendarAvisoLeadsNovos()
}
