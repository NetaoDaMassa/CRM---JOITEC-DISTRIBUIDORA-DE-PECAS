// Cotações do SAP ao vivo (lib/sapCotacoesAuto.ts) — roda uma vez na mão.
//
//   node dist/scripts/sincronizarCotacoesSap.js                     → roda agora (o que mudou desde a última)
//   node dist/scripts/sincronizarCotacoesSap.js --desde 2026-10-22  → carga avulsa de um período
//   node dist/scripts/sincronizarCotacoesSap.js --desligar | --ligar
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { setConfig } from '../lib/configuracoes.js'
import { sincronizarCotacoesSap } from '../lib/sapCotacoesAuto.js'

async function main() {
  await db.run(sql`PRAGMA busy_timeout = 30000`)
  if (process.argv.includes('--desligar')) {
    await setConfig('sap_cotacoes_auto', '0')
    return console.log('Cotações do SAP ao vivo DESLIGADAS.')
  }
  if (process.argv.includes('--ligar')) await setConfig('sap_cotacoes_auto', '1')
  const i = process.argv.indexOf('--desde')
  const desde = i > 0 ? process.argv[i + 1] : undefined
  if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw new Error('--desde no formato AAAA-MM-DD')
  const r = await sincronizarCotacoesSap({ desde })
  if (!r) return console.log('Cotações do SAP ao vivo estão desligadas (use --ligar).')
  console.log(`\n=== COTAÇÕES DO SAP → CRM (alteradas desde ${r.desde.split('-').reverse().join('/')}) ===`)
  console.log(`Cotações no SAP:           ${r.noSap}`)
  console.log(`Novas no CRM:              ${r.novas}`)
  console.log(`Alteradas:                 ${r.alteradas}`)
  console.log(`Sem mudança:               ${r.semMudanca}`)
  console.log(`Situação atualizada (planilha): ${r.deOutroLote}`)
  console.log(`Cliente fora do CRM / da carteira: ${r.semCliente}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERRO:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
