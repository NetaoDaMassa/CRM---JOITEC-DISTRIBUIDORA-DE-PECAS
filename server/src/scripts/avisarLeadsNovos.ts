// Execução MANUAL do aviso de leads novos (o agendamento automático fica no
// scheduler.ts). Serve pra testar antes de soltar pro time.
//
// Local (workspace server):
//   npm run avisar-leads -- --dry-run          # monta e mostra no log, NÃO envia
//   npm run avisar-leads -- --teste            # manda tudo pro AVISO_LEADS_TEST_NUMERO
//   npm run avisar-leads -- --dry-run --tarde  # força o texto de fim de tarde
//
// Na VPS (dentro do container, já compilado em dist/):
//   docker compose exec backend node dist/scripts/avisarLeadsNovos.js --dry-run
//   docker compose exec backend node dist/scripts/avisarLeadsNovos.js --teste
//
// Flags:
//   --empresa <id>  qual empresa (padrão: 1 = Joitec Distribuidora)
//   --dry-run   não envia nada, só loga
//   --teste     envia tudo pro número de teste da empresa
//   --manha / --tarde   força o tom da mensagem (padrão: decide pelo horário)

import { config } from 'dotenv'
config()

import { executarAvisoLeadsNovos, type Periodo } from '../lib/avisoLeadsNovos.js'
import { pararSessao } from '../lib/whatsapp/session.js'
import { hojeBr } from '../lib/dataBr.js'

const argv = process.argv.slice(2)
const flags = new Set(argv)

const idxEmpresa = argv.indexOf('--empresa')
const empresaId = idxEmpresa >= 0 ? Number(argv[idxEmpresa + 1]) || 1 : 1

const dryRun = flags.has('--dry-run') || process.env.AVISO_LEADS_DRY_RUN === 'true'
const testMode = flags.has('--teste') || flags.has('--test') || process.env.AVISO_LEADS_TEST_MODE === 'true'

let periodo: Periodo
if (flags.has('--tarde')) periodo = 'tarde'
else if (flags.has('--manha')) periodo = 'manha'
else periodo = hojeBr().getUTCHours() < 12 ? 'manha' : 'tarde'

console.log(`[aviso-leads] execução manual | empresa=${empresaId} | período=${periodo} | dryRun=${dryRun} | testMode=${testMode}`)

executarAvisoLeadsNovos({ empresaId, periodo, dryRun, testMode })
  .then(async (r) => {
    console.log('[aviso-leads] resultado:', JSON.stringify(r))
    await pararSessao().catch(() => {})
    process.exit(r.abortadoPorConexao ? 1 : 0)
  })
  .catch(async (err) => {
    console.error('[aviso-leads] erro fatal:', err)
    await pararSessao().catch(() => {})
    process.exit(1)
  })
