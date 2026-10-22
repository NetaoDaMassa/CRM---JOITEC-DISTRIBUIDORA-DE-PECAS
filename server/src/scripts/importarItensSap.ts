// Importa os ITENS das notas de venda do SAP direto no servidor, sem tela
// (pedido do João, 2026-10-21). A planilha traz as 3 empresas juntas; roda
// uma vez por empresa, cada uma vira um lote. Só detalhe do que foi vendido —
// não soma no faturamento.
//
//   node dist/scripts/importarItensSap.js <arquivo> <slug-empresa>                 → só prévia
//   ... --de 2026-04-01 --ate 2026-10-31                                          → só esse período
//   ... --confirmar                                                               → grava o lote
//
// Listar/desligar/religar/excluir lotes: importarSap.js (--lotes, --desligar...).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, users } from '../db/schema.js'
import { processarItensSap } from '../lib/importSapItens.js'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')

async function main() {
  const args = process.argv.slice(2)
  const [arquivo, slug] = args
  if (!arquivo || !slug) throw new Error('Uso: importarItensSap.js <arquivo> <slug-empresa> [--de AAAA-MM-DD] [--ate AAAA-MM-DD] [--confirmar]')
  const confirmar = args.includes('--confirmar')
  const valorDe = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
  const de = valorDe('--de')
  const ate = valorDe('--ate')
  if ((de && !/^\d{4}-\d{2}-\d{2}$/.test(de)) || (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate))) throw new Error('--de/--ate no formato AAAA-MM-DD')
  const periodo = de || ate ? { de: de ?? '0000-01-01', ate: ate ?? '9999-12-31' } : undefined

  const e = await db.query.empresas.findFirst({ where: eq(empresas.slug, slug) })
  if (!e) throw new Error(`Empresa "${slug}" não existe`)
  const autor = (await db.query.users.findFirst({ where: and(eq(users.superAdmin, true), eq(users.empresaId, e.id)) })) ?? (await db.query.users.findFirst({ where: eq(users.superAdmin, true) }))
  if (!autor) throw new Error('Nenhum superAdmin encontrado')

  const r = await processarItensSap(readFileSync(arquivo), path.basename(arquivo), { id: e.id, slug: e.slug }, { confirmar, usuarioId: autor.id, periodo })

  console.log(`\n=== ITENS DE VENDA SAP ${confirmar ? 'IMPORTAÇÃO' : 'PRÉVIA (nada gravado)'} — ${e.nome} ===`)
  console.log(`Linhas na planilha:          ${r.totalLinhas}`)
  console.log(`  de outra empresa:          ${r.outraEmpresa} (ignoradas)`)
  console.log(`  devoluções:                ${r.devolucoes} (ignoradas)`)
  if (periodo) console.log(`  fora do período:           ${r.foraPeriodo} (filtro ${dataBr(periodo.de)} a ${dataBr(periodo.ate)})`)
  console.log(`  notas já importadas:       ${r.jaImportadas} linhas (puladas)`)
  console.log(`Itens que ${confirmar ? 'entraram' : 'vão entrar'}:      ${r.linhasImportaveis} linhas em ${r.notas} notas (${r.clientesDistintos} clientes, ${r.itensDistintos} produtos diferentes)`)
  console.log(`Soma das linhas:             ${brl(r.valorTotal)}  (só conferência — NÃO entra no faturamento)`)
  console.log(`Período:                     ${dataBr(r.dataInicio)} a ${dataBr(r.dataFim)}`)
  console.log(`Por mês: ${Object.entries(r.porMes).sort().map(([m, v]) => `${m}=${v.notas} notas`).join('  ')}`)
  console.log(`Cliente não encontrado:      ${r.naoEncontradas.length} linhas`)
  console.log(`Linhas inválidas:            ${r.invalidas.length}`)
  if (r.importacaoId) console.log(`\nLote criado: #${r.importacaoId}`)

  if (r.naoEncontradas.length) {
    const porCliente = new Map<string, { nome: string; notas: Set<string>; valor: number }>()
    for (const l of r.naoEncontradas) {
      const atual = porCliente.get(l.codigo) ?? { nome: l.nome, notas: new Set<string>(), valor: 0 }
      atual.notas.add(l.nota)
      atual.valor += l.valor
      porCliente.set(l.codigo, atual)
    }
    const lista = [...porCliente.entries()].sort((a, b) => b[1].valor - a[1].valor)
    console.log(`\n--- ${lista.length} clientes da planilha que NÃO existem no CRM (maiores primeiro) ---`)
    for (const [cod, c] of lista.slice(0, 40)) console.log(`${cod};${c.nome};${c.notas.size} notas;${brl(c.valor)}`)
    if (lista.length > 40) console.log(`... e mais ${lista.length - 40}`)
  }
  if (r.invalidas.length) {
    console.log('\n--- Linhas inválidas ---')
    for (const l of r.invalidas.slice(0, 30)) console.log(`linha ${l.linha} (nota ${l.nota || '?'}): ${l.motivo}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERRO:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
