// Refaz a foto das contas a receber em aberto puxando do SAP (pedido do
// João, 2026-10-29) — o mesmo que a rodada de hora em hora faz quando
// `sap_sync_ativo` está ligado. Serve pra rodar na mão e conferir.
//
//   node dist/scripts/sincronizarContasReceberSap.js
import { sincronizarContasReceberSap } from '../lib/sapContasReceber.js'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

sincronizarContasReceberSap()
  .then((r) => {
    console.log(`\n=== CONTAS A RECEBER — SAP (${r.segundos}s) ===`)
    console.log(`Títulos em aberto gravados: ${r.titulos}`)
    console.log(`Clientes com saldo:         ${r.clientesComSaldo}`)
    console.log(`Batem com o saldo do SAP:   ${r.conferem}`)
    if (r.naoConferem.length) {
      console.log(`\n--- ${r.naoConferem.length} clientes que NÃO batem (a tela mostra "conferir no SAP") ---`)
      for (const n of r.naoConferem.slice(0, 30)) console.log(`${n.codigo};${n.nome ?? ''};SAP ${brl(n.saldoSap)};calculado ${brl(n.calculado)}`)
    }
    process.exit(0)
  })
  .catch((err) => {
    console.error('ERRO:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
