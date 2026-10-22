// Importa os ITENS das cotações do SAP direto no servidor, sem tela (pedido
// do João, 2026-10-22). A planilha traz as 3 filiais juntas; roda uma vez
// por empresa, cada uma vira um lote. Cotação da filial Joitec com item PPR
// vai pra Odin Tubos — e na Odin Tubos os cabeçalhos dessas cotações que
// estavam na Joitec mudam de empresa (ver lib/importSapCotacoesItens.ts).
//
//   node dist/scripts/importarCotacoesItensSap.js <arquivo> <slug-empresa>        → só prévia
//   ... --de 2026-04-01 --ate 2026-10-31                                          → só esse período
//   ... --confirmar                                                               → grava
//
// Listar/desligar/religar/excluir lotes: importarSap.js (--lotes, --desligar...).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, users } from '../db/schema.js'
import { processarCotacoesItensSap } from '../lib/importSapCotacoesItens.js'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')

async function main() {
  const args = process.argv.slice(2)
  const [arquivo, slug] = args
  if (!arquivo || !slug) throw new Error('Uso: importarCotacoesItensSap.js <arquivo> <slug-empresa> [--de AAAA-MM-DD] [--ate AAAA-MM-DD] [--confirmar]')
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

  const r = await processarCotacoesItensSap(readFileSync(arquivo), path.basename(arquivo), { id: e.id, slug: e.slug }, { confirmar, usuarioId: autor.id, periodo })

  console.log(`\n=== ITENS DAS COTAÇÕES SAP ${confirmar ? 'IMPORTAÇÃO' : 'PRÉVIA (nada gravado)'} — ${e.nome} ===`)
  console.log(`Linhas na planilha:          ${r.totalLinhas}`)
  console.log(`  de outra empresa:          ${r.outraEmpresa} (ignoradas)`)
  if (periodo) console.log(`  fora do período:           ${r.foraPeriodo} (filtro ${dataBr(periodo.de)} a ${dataBr(periodo.ate)})`)
  console.log(`  cotações já importadas:    ${r.jaImportadas} linhas (puladas)`)
  console.log(`Itens que ${confirmar ? 'entraram' : 'vão entrar'}:      ${r.linhasImportaveis} linhas em ${r.cotacoes} cotações (${r.clientesDistintos} clientes, ${r.itensDistintos} produtos diferentes)`)
  if (r.cotacoesPprDaJoitec) console.log(`  dessas, vindas da filial Joitec por terem PPR: ${r.cotacoesPprDaJoitec} cotações`)
  console.log(`Valor das cotações:          ${brl(r.valorCotacoes)}  (só conferência)`)
  console.log(`Por status:                  ${Object.entries(r.porStatus).map(([s, q]) => `${s}=${q}`).join('  ')}`)
  console.log(`Período:                     ${dataBr(r.dataInicio)} a ${dataBr(r.dataFim)}`)
  console.log(`Por mês: ${Object.entries(r.porMes).sort().map(([m, v]) => `${m}=${v.cotacoes}`).join('  ')}`)
  const semClientePpr = r.naoEncontradas.filter((l) => l.pprDaJoitec).length
  console.log(`Cliente não encontrado:      ${r.naoEncontradas.length} cotações${semClientePpr ? ` (${semClientePpr} delas são PPR da filial Joitec de cliente que não está na carteira da Odin Tubos)` : ''}`)
  console.log(`Linhas inválidas:            ${r.invalidas.length}`)
  console.log(`\nCotações já importadas antes (abr–jul):`)
  console.log(`  status ${confirmar ? 'atualizado' : 'a atualizar'} pelo da planilha: ${r.cabecalhos.statusAtualizados}`)
  if (slug === 'odin-tubos') {
    console.log(`  cotações PPR que ${confirmar ? 'saíram' : 'vão sair'} da Joitec e ${confirmar ? 'entraram' : 'entrar'} na Odin Tubos: ${r.cabecalhos.mover.qtd} (${brl(r.cabecalhos.mover.valor)})`)
    if (r.cabecalhos.moverSemCliente.length) {
      const v = r.cabecalhos.moverSemCliente.reduce((s, c) => s + c.valor, 0)
      console.log(`  ficam na Joitec porque o cliente não existe na Odin Tubos: ${r.cabecalhos.moverSemCliente.length} (${brl(v)})`)
      for (const c of r.cabecalhos.moverSemCliente.slice(0, 30)) console.log(`    cotação ${c.numero};cliente ${c.codigo};${brl(c.valor)}`)
    }
  }
  if (r.importacaoId) console.log(`\nLote de itens criado: #${r.importacaoId}`)
  if (r.importacaoCabecalhosId) console.log(`Lote das cotações PPR movidas: #${r.importacaoCabecalhosId}`)

  if (r.naoEncontradas.length) {
    const porCliente = new Map<string, { nome: string; cotacoes: number; valor: number }>()
    for (const l of r.naoEncontradas) {
      const atual = porCliente.get(l.codigo) ?? { nome: l.nome, cotacoes: 0, valor: 0 }
      atual.cotacoes++
      atual.valor += l.valor
      porCliente.set(l.codigo, atual)
    }
    const lista = [...porCliente.entries()].sort((a, b) => b[1].valor - a[1].valor)
    console.log(`\n--- ${lista.length} clientes da planilha que NÃO existem no CRM (maiores primeiro) ---`)
    for (const [cod, c] of lista.slice(0, 40)) console.log(`${cod};${c.nome};${c.cotacoes} cotações;${brl(c.valor)}`)
    if (lista.length > 40) console.log(`... e mais ${lista.length - 40}`)
  }
  if (r.invalidas.length) {
    console.log('\n--- Linhas inválidas ---')
    for (const l of r.invalidas.slice(0, 30)) console.log(`linha ${l.linha} (cotação ${l.numero || '?'}): ${l.motivo}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERRO:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
