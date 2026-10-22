// Importa o histórico de vendas do SAP direto no servidor, sem tela (pedido
// do João, 2026-10-20: ele manda a planilha e a gente roda aqui). Compilado
// junto com o resto (dist/scripts/importarSap.js), roda dentro do container:
//
//   node dist/scripts/importarSap.js <arquivo> <slug-empresa>              → só prévia
//   node dist/scripts/importarSap.js <arquivo> <slug-empresa> --confirmar  → grava o lote
//   ... --de 2026-04-01 --ate 2026-07-31                                  → só esse período
//   node dist/scripts/importarSap.js --lotes <slug-empresa>                → lista lotes
//   node dist/scripts/importarSap.js --desligar <id> | --religar <id> | --excluir <id>
//   (vale também pros lotes de cotações e de itens — ver importarCotacoesSap.ts / importarItensSap.ts /
//   importarCotacoesItensSap.ts)
//
// Mesma lógica da tela Histórico SAP (lib/importSapHistorico.ts).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, sapCotacoesHistorico, sapImportacoes, sapVendasHistorico, users } from '../db/schema.js'
import { processarHistoricoSap } from '../lib/importSapHistorico.js'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')

async function empresaPorSlug(slug: string) {
  const e = await db.query.empresas.findFirst({ where: eq(empresas.slug, slug) })
  if (!e) throw new Error(`Empresa "${slug}" não existe`)
  return e
}

async function main() {
  const args = process.argv.slice(2)

  if (args[0] === '--lotes') {
    const e = await empresaPorSlug(args[1])
    const lotes = await db.query.sapImportacoes.findMany({ where: eq(sapImportacoes.empresaId, e.id) })
    console.log(`Lotes de ${e.nome}:`)
    for (const l of lotes) {
      console.log(`  #${l.id} ${l.ativo ? 'LIGADO   ' : 'DESLIGADO'} ${l.tipo === 'cotacoes' ? 'COTAÇÕES' : l.tipo === 'itens' ? 'ITENS   ' : l.tipo === 'cotacoes_itens' ? 'ITENS-COT' : 'VENDAS  '} ${l.nomeArquivo} · ${l.importadas} ${l.tipo === 'cotacoes' ? 'cotações' : l.tipo === 'itens' || l.tipo === 'cotacoes_itens' ? 'linhas de item' : 'pedidos'} · ${brl(l.valorTotal)} · ${dataBr(l.dataInicio)} a ${dataBr(l.dataFim)} · ${l.createdAt}`)
    }
    if (!lotes.length) console.log('  (nenhum)')
    return
  }

  if (['--desligar', '--religar', '--excluir'].includes(args[0])) {
    const id = Number(args[1])
    const lote = await db.query.sapImportacoes.findFirst({ where: eq(sapImportacoes.id, id) })
    if (!lote) throw new Error(`Lote #${id} não existe`)
    if (args[0] === '--excluir') {
      await db.transaction(async (tx) => {
        await tx.delete(sapVendasHistorico).where(eq(sapVendasHistorico.importacaoId, id))
        await tx.delete(sapCotacoesHistorico).where(eq(sapCotacoesHistorico.importacaoId, id))
        await tx.delete(sapImportacoes).where(eq(sapImportacoes.id, id))
      })
      console.log(`Lote #${id} (${lote.nomeArquivo}) EXCLUÍDO com ${lote.importadas} pedidos.`)
    } else {
      const ativo = args[0] === '--religar'
      await db.update(sapImportacoes).set({ ativo }).where(eq(sapImportacoes.id, id))
      console.log(`Lote #${id} (${lote.nomeArquivo}) ${ativo ? 'RELIGADO' : 'DESLIGADO'}.`)
    }
    return
  }

  const [arquivo, slug] = args
  const confirmar = args.includes('--confirmar')
  const valorDe = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
  const de = valorDe('--de')
  const ate = valorDe('--ate')
  if ((de && !/^\d{4}-\d{2}-\d{2}$/.test(de)) || (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate))) throw new Error('--de/--ate no formato AAAA-MM-DD')
  const periodo = de || ate ? { de: de ?? '0000-01-01', ate: ate ?? '9999-12-31' } : undefined
  if (!arquivo || !slug) throw new Error('Uso: importarSap.js <arquivo> <slug-empresa> [--confirmar]')
  const e = await empresaPorSlug(slug)
  // Lote fica no nome do superAdmin (é quem decide desfazer).
  const autor = await db.query.users.findFirst({ where: and(eq(users.superAdmin, true), eq(users.empresaId, e.id)) })
    ?? (await db.query.users.findFirst({ where: eq(users.superAdmin, true) }))
  if (!autor) throw new Error('Nenhum superAdmin encontrado')

  const r = await processarHistoricoSap(readFileSync(arquivo), path.basename(arquivo), e.id, { confirmar, usuarioId: autor.id, periodo })

  console.log(`\n=== ${confirmar ? 'IMPORTAÇÃO' : 'PRÉVIA (nada gravado)'} — ${e.nome} ===`)
  console.log(`Linhas na planilha:        ${r.totalLinhas}`)
  console.log(`Pedidos que ${confirmar ? 'entraram' : 'vão entrar'}:  ${r.importaveis}  (${r.clientesDistintos} clientes)`)
  console.log(`  achados pelo código:     ${r.porCodigo}`)
  console.log(`  achados pelo CNPJ:       ${r.porCnpj}`)
  console.log(`Valor total:               ${brl(r.valorTotal)}`)
  console.log(`Período:                   ${dataBr(r.dataInicio)} a ${dataBr(r.dataFim)}`)
  if (periodo) console.log(`Fora do período pedido:    ${r.foraPeriodo} (ignorados — filtro ${dataBr(periodo.de)} a ${dataBr(periodo.ate)})`)
  console.log(`Já importados antes:       ${r.jaImportadas} (pulados)`)
  console.log(`Cliente não encontrado:    ${r.naoEncontradas.length} linhas`)
  console.log(`Linhas inválidas:          ${r.invalidas.length}`)
  if (r.importacaoId) console.log(`\nLote criado: #${r.importacaoId}`)

  if (r.naoEncontradas.length) {
    const porCliente = new Map<string, { nome: string; cnpj: string; qtd: number; valor: number }>()
    for (const l of r.naoEncontradas) {
      const k = l.codigo || l.cnpj
      const atual = porCliente.get(k) ?? { nome: l.nome, cnpj: l.cnpj, qtd: 0, valor: 0 }
      atual.qtd++
      atual.valor += l.valor ?? 0
      porCliente.set(k, atual)
    }
    const lista = [...porCliente.entries()].sort((a, b) => b[1].valor - a[1].valor)
    console.log(`\n--- ${lista.length} clientes da planilha que NÃO existem no CRM (maiores primeiro) ---`)
    for (const [cod, c] of lista) console.log(`${cod};${c.nome};${c.cnpj};${c.qtd} pedidos;${brl(c.valor)}`)
  }
  if (r.invalidas.length) {
    console.log('\n--- Linhas inválidas ---')
    for (const l of r.invalidas.slice(0, 50)) console.log(`linha ${l.linha}: ${l.motivo}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERRO:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
