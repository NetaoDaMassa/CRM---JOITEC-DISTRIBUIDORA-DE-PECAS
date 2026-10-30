// Puxa os itens das notas de venda direto do SAP (Service Layer) — passo 2
// da integração, pedido do João, 2026-10-29. Sem argumento = só prévia.
//
//   node dist/scripts/sincronizarItensSap.js                                  → prévia (nada gravado)
//   ... --de 2026-10-18 --ate 2026-10-29                                     → período manual
//   ... --confirmar                                                          → grava
//   ... --so-compressores --de 2026-04-01                                    → só a carteira da Bruna (Odin Compressores)
//
// Desligar uma empresa / voltar atrás: importarSap.js --lotes e
// --desligar <id> no lote "SAP automático (Service Layer)".
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { sincronizarItensSap } from '../lib/sapSyncItens.js'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (iso: string) => iso.split('-').reverse().join('/')

async function main() {
  const args = process.argv.slice(2)
  const confirmar = args.includes('--confirmar')
  const valorDe = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
  const de = valorDe('--de')
  const ate = valorDe('--ate')
  if ((de && !/^\d{4}-\d{2}-\d{2}$/.test(de)) || (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate))) throw new Error('--de/--ate no formato AAAA-MM-DD')

  const autor = await db.query.users.findFirst({ where: eq(users.superAdmin, true) })
  if (!autor) throw new Error('Nenhum superAdmin encontrado')

  const soEmpresa = args.includes('--so-compressores') ? 'odin-compressores' : undefined
  const r = await sincronizarItensSap({ confirmar, usuarioId: autor.id, de, ate, soEmpresa })

  console.log(`\n=== ITENS DAS NOTAS — SAP AO VIVO ${r.gravado ? 'GRAVADO' : 'PRÉVIA (nada gravado)'} ===`)
  console.log(`Período:                    ${dataBr(r.periodo.de)} a ${dataBr(r.periodo.ate)}`)
  console.log(`Notas no SAP no período:    ${r.notasNoSap}`)
  console.log(`  canceladas:               ${r.canceladas} (ignoradas)`)
  console.log(`  outra filial:             ${r.outraFilial}`)
  console.log(`  Odin Compressores fora da carteira da Bruna: ${r.foraDaCarteira}`)
  console.log(`  já estavam no CRM:        ${r.jaImportadas}`)
  if (r.empresaDesligada) console.log(`  empresa desligada:        ${r.empresaDesligada}`)
  for (const [nome, e] of Object.entries(r.porEmpresa)) {
    console.log(`${nome.padEnd(28)}${e.notas} notas novas, ${e.linhas} itens, ${e.clientes} clientes — ${brl(e.valor)} (só conferência, NÃO entra no faturamento)`)
  }
  if (!Object.keys(r.porEmpresa).length) console.log('Nenhuma nota nova.')
  if (r.canceladasRemovidas.length) console.log(`Canceladas depois de entrar (${r.gravado ? 'removidas' : 'vão sair'}): ${r.canceladasRemovidas.map((c) => c.nota).join(', ')}`)
  if (r.naoEncontradas.length) {
    console.log(`\n--- ${r.naoEncontradas.length} notas de cliente que NÃO existe no CRM (não entraram) ---`)
    for (const n of r.naoEncontradas.slice(0, 40)) console.log(`${n.empresa};${n.codigo};${n.nome};nota ${n.nota};${brl(n.valor)}`)
    if (r.naoEncontradas.length > 40) console.log(`... e mais ${r.naoEncontradas.length - 40}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERRO:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
