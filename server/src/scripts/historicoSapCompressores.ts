// Histórico do SAP da carteira da Bruna (Odin Compressores) — pedido do João,
// 2026-10-30 (lib/sapCompressoresHistorico.ts). Sem argumento = só prévia.
//
//   node dist/scripts/historicoSapCompressores.js               → prévia (nada gravado)
//   node dist/scripts/historicoSapCompressores.js --confirmar   → grava pedidos, cotações e itens das notas
//   ... --de 2026-04-01                                         → desde quando (padrão 01/04)
//
// Voltar atrás: importarSap.js --lotes odin-compressores e --desligar <id>
// nos lotes "SAP Service Layer — carteira da Bruna" e "SAP automático".
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { carregarHistoricoCompressores } from '../lib/sapCompressoresHistorico.js'
import { sincronizarItensSap } from '../lib/sapSyncItens.js'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')

async function main() {
  const args = process.argv.slice(2)
  const confirmar = args.includes('--confirmar')
  const de = args.includes('--de') ? args[args.indexOf('--de') + 1] : undefined
  if (de && !/^\d{4}-\d{2}-\d{2}$/.test(de)) throw new Error('--de no formato AAAA-MM-DD')
  const autor = await db.query.users.findFirst({ where: eq(users.superAdmin, true) })
  if (!autor) throw new Error('Nenhum superAdmin encontrado')

  const r = await carregarHistoricoCompressores({ confirmar, usuarioId: autor.id, de })
  console.log(`\n=== HISTÓRICO SAP — CARTEIRA DA BRUNA (Odin Compressores) ${r.gravado ? 'GRAVADO' : 'PRÉVIA (nada gravado)'} ===`)
  console.log(`Período:                     ${dataBr(r.de)} a ${dataBr(r.ate)}`)
  console.log(`Clientes na carteira:        ${r.clientesCarteira} (${r.clientesNoSap} com documento no SAP no período)`)
  console.log(`Documentos de outros clientes da Odin Compressores (ignorados): ${r.foraDaCarteira}`)
  console.log(`\nPEDIDOS (entram nos relatórios de venda, como a planilha das outras empresas)`)
  console.log(`  pedidos da Bruna até ${dataBr(r.cortePedidosBruna)}, dos outros vendedores até ${dataBr(r.cortePedidosOutros)}`)
  console.log(`  lidos ${r.pedidos.lidos} · novos ${r.pedidos.gravar} (${brl(r.pedidos.valor)}) · já estavam ${r.pedidos.jaExistiam} · depois do corte (já no CRM) ${r.pedidos.depoisDoCorte}`)
  console.log(`\nCOTAÇÕES`)
  console.log(`  lidas ${r.cotacoes.lidas} · cabeçalhos novos (até 31/07) ${r.cotacoes.cabecalhos} (${brl(r.cotacoes.valor)}) · com itens ${r.cotacoes.comItens} (${r.cotacoes.linhas} linhas) · já estavam ${r.cotacoes.jaExistiam}`)

  const itens = await sincronizarItensSap({ confirmar, usuarioId: autor.id, de: r.de, ate: r.ate, soEmpresa: 'odin-compressores' })
  const e = Object.values(itens.porEmpresa)[0]
  console.log(`\nITENS DAS NOTAS (itens mais comprados; NÃO soma no faturamento)`)
  console.log(`  ${e ? `${e.notas} notas novas, ${e.linhas} itens, ${e.clientes} clientes — ${brl(e.valor)}` : 'nenhuma nota nova'} · já estavam ${itens.jaImportadas}`)
  if (!confirmar) console.log('\nPra gravar: rode de novo com --confirmar')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERRO:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
