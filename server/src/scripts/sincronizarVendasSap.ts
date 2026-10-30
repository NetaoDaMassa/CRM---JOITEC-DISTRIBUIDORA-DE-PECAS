// Venda automática a partir do pedido do SAP (pedido do João, 2026-10-30).
//
//   node dist/scripts/sincronizarVendasSap.js --ligar      → começa a partir de HOJE ("daqui pra frente")
//   node dist/scripts/sincronizarVendasSap.js             → roda agora e mostra o resultado
//   node dist/scripts/sincronizarVendasSap.js --desligar  → para de criar vendas
//   node dist/scripts/sincronizarVendasSap.js --desde 2026-10-01 → carga avulsa de um período passado
//   ... --desde 2026-10-01 --so-compressores → só os pedidos da Bruna (Odin Compressores, lib/sapCompressores.ts)
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { apagarConfig, setConfig, getConfigTexto } from '../lib/configuracoes.js'
import { hojeBrString } from '../lib/dataBr.js'
import { sincronizarVendasSap } from '../lib/sapVendasAuto.js'
import { FILIAL_COMPRESSORES } from '../lib/sapCompressores.js'


async function main() {
  // Roda fora do processo do servidor: espera até 30 s se o banco estiver
  // ocupado (o servidor gravando), em vez de falhar com SQLITE_BUSY.
  await db.run(sql`PRAGMA busy_timeout = 30000`)
  if (process.argv.includes('--desligar')) {
    await apagarConfig('sap_vendas_auto_desde')
    console.log('Venda automática DESLIGADA.')
    return
  }
  if (process.argv.includes('--ligar')) {
    await setConfig('sap_vendas_auto_desde', hojeBrString())
    console.log(`Venda automática LIGADA a partir de ${hojeBrString()}.`)
  }
  const i = process.argv.indexOf('--desde')
  const desdeAvulso = i > 0 ? process.argv[i + 1] : undefined
  if (desdeAvulso && !/^\d{4}-\d{2}-\d{2}$/.test(desdeAvulso)) throw new Error('--desde no formato AAAA-MM-DD')
  const desde = await getConfigTexto('sap_vendas_auto_desde')
  if (!desde && !desdeAvulso) return console.log('Venda automática desligada (use --ligar).')
  const r = await sincronizarVendasSap({ desde: desdeAvulso, soFilial: process.argv.includes('--so-compressores') ? FILIAL_COMPRESSORES : undefined })
  if (!r) return
  console.log(`\n=== VENDAS DO SAP → CRM (pedidos desde ${r.desde.split('-').reverse().join('/')}) ===`)
  console.log(`Pedidos no SAP:            ${r.pedidosNoSap}`)
  console.log(`Vendas criadas:            ${r.criadas}`)
  console.log(`Ligadas a registro manual: ${r.ligadas}`)
  console.log(`Já estavam no CRM:         ${r.jaExistiam}`)
  console.log(`Valor atualizado:          ${r.atualizadas}`)
  console.log(`Canceladas no SAP:         ${r.canceladas}`)
  console.log(`Marcadas como faturadas:   ${r.faturadas}`)
  if (r.semCliente.length) console.log(`\nCliente não está no CRM (${r.semCliente.length}): ${r.semCliente.map((s) => `${s.pedido} ${s.codigo} ${s.nome.slice(0, 25)}`).join(' | ')}`)
  if (r.semVendedor.length) console.log(`Cliente sem vendedor na carteira (${r.semVendedor.length}): ${r.semVendedor.map((s) => `${s.pedido} ${s.cliente.slice(0, 25)}`).join(' | ')}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERRO:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
