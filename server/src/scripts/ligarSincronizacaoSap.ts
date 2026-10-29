// Liga (ou desliga) a rodada automática do SAP — itens das notas + contas a
// receber, de hora em hora (lib/sapAgendado.ts). Pedido do João, 2026-10-29.
//
//   node dist/scripts/ligarSincronizacaoSap.js           → liga
//   node dist/scripts/ligarSincronizacaoSap.js --desligar
import { setConfig, getConfigTexto } from '../lib/configuracoes.js'
import { sapConfigurado } from '../lib/sapServiceLayer.js'

async function main() {
  const desligar = process.argv.includes('--desligar')
  await setConfig('sap_sync_ativo', desligar ? '0' : '1')
  console.log(`sap_sync_ativo = ${await getConfigTexto('sap_sync_ativo')}`)
  console.log(`SAP configurado no .env: ${sapConfigurado() ? 'sim' : 'NÃO (faltam SAP_SL_*)'}`)
  console.log(`Inadimplência nas empresas: ${(await getConfigTexto('sap_inadimplencia_empresas')) ?? 'joitec,odin-tubos (padrão)'}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERRO:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
