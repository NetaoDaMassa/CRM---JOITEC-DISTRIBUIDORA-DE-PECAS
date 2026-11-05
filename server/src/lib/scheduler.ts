import cron from 'node-cron'
import { executarResetMensal } from './resetMensal.js'
import { checarClientesSemContato } from './notificacoes.js'
import { executarBackupSeNecessario } from './backup.js'
import { executarResumoDiario } from './resumoDiario.js'
import { setConfig } from './configuracoes.js'
import { agoraSqlite } from './dataBr.js'
import { completarResumosPabxone360, duracaoMinimaPabx, lerCredenciaisPabx, pabxLigada, registrarLigacoesAutomaticasPabxone360 } from './pabxone360.js'
import { executarAvisoLeadsNovos, type Periodo } from './avisoLeadsNovos.js'
import { ensureStarted as iniciarSessaoWhatsapp } from './whatsapp/session.js'
import { getAvisoLeadsConfig, seedAvisoLeadsConfigFromEnv, getAvisoLeadsEmpresasAtivas } from './avisoLeadsConfig.js'
import { runLeadsSlaChecks } from './leadsSlaScheduler.js'
import { sincronizarStatusNotion } from './pollNotionStatus.js'
import { reprocessarErrosGoto } from './goto.js'
import { sincronizarCarrinhosAbandonadosCompretec } from './woocommerceCarrinhoAbandonadoPoller.js'
import { sincronizarGoogleDrive } from './googleDriveSync.js'
import { rodarRoteiroAgendado } from './roteiro.js'
import { enviarVencidasAoCartorio } from './reguaCobranca.js'
import { rodarClientesSap, rodarCotacoesSap, rodarExpedicaoSap, rodarSincronizacaoSap, rodarVendasSap } from './sapAgendado.js'
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

// PABXONE360 — telefonia das 3 empresas Odin (ver pabxone360.ts). A API
// não tem webhook (só REST + polling): a cada 1 minuto busca as ligações
// das últimas 2 HORAS. Era 5 minutos, mas se a API data a chamada pelo
// horário em que ela COMEÇOU (e só a mostra depois que termina), uma
// conversa de mais de ~5min nascia fora da janela e nunca era registrada
// (João, 2026-11-01). Ligação nova continua caindo em 1-2min; as já vistas
// são puladas (pabx_ligacoes_processadas evita duplicar). Liga/desliga em
// Telefonia → Configuração (config `pabxone360_ligada`) — desligada sai
// calada. Erro (ex: token recusado) fica gravado pra aparecer na tela, e só
// vai pro log quando muda, pra não encher o log a cada minuto (foi isso que
// fez desligarem em 2026-10-21: 401 a cada minuto).
const JANELA_SYNC_PABX_MS = 2 * 60 * 60 * 1000
let ultimoErroPabx = ''

async function registrarErroPabx(err: unknown) {
  const msg = (err as Error)?.message ?? String(err)
  if (msg !== ultimoErroPabx) console.error('[pabxone360] erro ao sincronizar ligações:', msg)
  ultimoErroPabx = msg
  await setConfig('pabxone360_ultimo_erro', `${agoraSqlite()} — ${msg}`).catch(() => {})
}

async function sincronizarPabxone360() {
  if (!(await pabxLigada())) return
  const cred = await lerCredenciaisPabx()
  if (!cred) return
  const fim = new Date()
  const inicio = new Date(fim.getTime() - JANELA_SYNC_PABX_MS)
  const resultados = await registrarLigacoesAutomaticasPabxone360(cred, inicio, fim, await duracaoMinimaPabx())
  await setConfig('pabxone360_ultima_sync', agoraSqlite())
  if (ultimoErroPabx) {
    ultimoErroPabx = ''
    await setConfig('pabxone360_ultimo_erro', '')
  }
  const registradas = resultados.filter((r) => r.registroContatoId || r.leadId).length
  if (registradas > 0) console.log(`[pabxone360] ${registradas} ligação(ões) registrada(s) automaticamente`)
}

// Resumo/transcrição/gravação ficam prontos alguns minutos depois da
// ligação — completa as últimas 3h a cada 15min.
async function completarResumosPabx() {
  if (!(await pabxLigada())) return
  const cred = await lerCredenciaisPabx()
  if (!cred) return
  const fim = new Date()
  await completarResumosPabxone360(cred, new Date(fim.getTime() - 3 * 3600e3), fim, await duracaoMinimaPabx())
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

  // GoTo (Joitec): ligação cujo relatório deu erro ao buscar → tenta de novo.
  cron.schedule('*/5 * * * *', () => {
    reprocessarErrosGoto()
      .then((n) => n && console.log(`[goto] ${n} ligação(ões) com erro buscadas de novo`))
      .catch((err) => console.error('[goto] reprocessar erros:', err))
  })
  cron.schedule('* * * * *', () => {
    sincronizarPabxone360().catch(registrarErroPabx)
  })
  cron.schedule('*/15 * * * *', () => {
    completarResumosPabx().catch((err) => console.error('[pabxone360] erro ao completar resumos:', (err as Error)?.message ?? err))
  })

  iniciarAvisoLeadsNovos().catch((err) => console.error('[aviso-leads] falha na inicialização:', err))

  // Roteiro do dia (Odin): aprovação automática de roteiro não analisado e
  // aviso de quem não enviou até o horário limite (ver lib/roteiro.ts).
  cron.schedule('*/5 * * * *', () => {
    rodarRoteiroAgendado().catch((err) => console.error('[roteiro] erro no agendador:', err))
  })

  // Negociações: cobrança pendente no 6º dia útil após o vencimento vai
  // sozinha pro Cartório (lib/reguaCobranca.ts). A tela também roda ao abrir.
  cron.schedule('5 * * * *', () => {
    enviarVencidasAoCartorio()
      .then((n) => n && console.log(`[regua-cobranca] ${n} cobrança(s) enviada(s) ao cartório`))
      .catch((err) => console.error('[regua-cobranca] erro:', err))
  })

  // SAP Business One (sapAgendado.ts): itens das notas + contas a receber,
  // de hora em hora. Só roda com `sap_sync_ativo` ligado.
  cron.schedule('20 * * * *', () => {
    rodarSincronizacaoSap().catch((err) => console.error('[sap] erro no agendador:', err))
  })
  // Horários do SAP desencontrados (2026-11-03) pra não logarem todas no
  // mesmo minuto — e comSessaoSap ainda põe uma atrás da outra.
  // Venda automática a partir do pedido do SAP — de 10 em 10 minutos (:06, :16…).
  cron.schedule('6-59/10 * * * *', () => {
    rodarVendasSap().catch((err) => console.error('[sap-vendas] erro no agendador:', err))
  })
  // Cotações do SAP no card/ficha (Fase 1, só mostrar) — de 2 em 2 minutos.
  // Fila do Controle do Estoque (pickings novos + NF) — de 5 em 5 minutos,
  // só com `expedicao_sap_ativo` ligado.
  cron.schedule('4-59/5 * * * *', () => {
    rodarExpedicaoSap().catch((err) => console.error('[sap-expedicao] erro no agendador:', err))
  })
  cron.schedule('1-59/2 * * * *', () => {
    rodarCotacoesSap().catch((err) => console.error('[sap-cotacoes] erro no agendador:', err))
  })
  // Cadastro novo do SAP vira cliente no CRM — de 10 em 10 minutos.
  cron.schedule('3-59/10 * * * *', () => {
    rodarClientesSap().catch((err) => console.error('[sap-clientes] erro no agendador:', err))
  })

  // Arquivos/Mídia → Google Drive (googleDriveSync.ts). Sem conta conectada
  // em Configurações, sai calado. A rodada tem tempo máximo e não deixa
  // duas rodarem juntas.
  cron.schedule('* * * * *', () => {
    sincronizarGoogleDrive().catch((err) => console.error('[google-drive] erro ao sincronizar:', err))
  })

  // Motor de SLA de Leads (novo parado/rodízio/abordagem sem contato/
  // esfriando) — mesma cadência de 5min do sistema antigo, separado do
  // runChecks horário porque os limites aqui são medidos em horas, não dias.
  cron.schedule('*/5 * * * *', () => {
    runLeadsSlaChecks().catch((err) => console.error('[leads-sla] erro ao processar checagens:', err))
  })
  runLeadsSlaChecks().catch((err) => console.error('[leads-sla] erro ao processar checagens iniciais:', err))

  // Status do pedido de arte/vídeo no Notion (Não iniciada/Em andamento/
  // Concluído) — sem env var configurada, sincronizarStatusNotion não acha
  // nenhum pedido com notionPageId de verdade e não faz chamada nenhuma.
  // A cada minuto (era 5min — João achou lento, mesma cadência do
  // pabxone360.ts, que também só é um punhado de chamadas REST leves).
  cron.schedule('* * * * *', () => {
    sincronizarStatusNotion().catch((err) => console.error('[notion-status] erro ao sincronizar:', err))
  })
  sincronizarStatusNotion().catch((err) => console.error('[notion-status] erro ao sincronizar inicial:', err))

  // Carrinhos abandonados da loja online (Compretec Loja Física) captados
  // pelo plugin Recarto no WordPress — sem credencial configurada, sai
  // calado (ver woocommerceCarrinhoAbandonadoPoller.ts).
  cron.schedule('*/5 * * * *', () => {
    sincronizarCarrinhosAbandonadosCompretec().catch((err) => console.error('[woocommerce-carrinho] erro ao sincronizar:', err))
  })
  // Atraso de 20s na chamada inicial (só essa, não a recorrente acima) —
  // achado do João, 2026-10-01: na subida, várias integrações (WhatsApp,
  // GoTo, Notion, PABXONE360) disputam CPU/IO ao mesmo tempo e a busca
  // nessa janela específica dava timeout mesmo com 30s de espera (ver
  // woocommerceCarrinhoAbandonadoPoller.ts). As tentativas recorrentes de
  // 5 em 5 minutos não têm esse problema, só a que roda bem na largada.
  setTimeout(() => {
    sincronizarCarrinhosAbandonadosCompretec().catch((err) => console.error('[woocommerce-carrinho] erro ao sincronizar inicial:', err))
  }, 20_000)
}
