import cron from 'node-cron'
import { executarResetMensal } from './resetMensal.js'
import { checarClientesSemContato } from './notificacoes.js'
import { executarBackupSeNecessario } from './backup.js'
import { executarResumoDiario } from './resumoDiario.js'
import { getConfigTexto, getConfigNumero } from './configuracoes.js'
import { registrarLigacoesAutomaticasPabxone360 } from './pabxone360.js'

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
}
