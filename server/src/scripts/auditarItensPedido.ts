// Auditoria READ-ONLY da extração de itens por IA (server/src/lib/pdfExtraction.ts,
// server/src/router/pedidos.ts extrairItens). Não escreve nada no banco — só
// imprime um relatório pra conferir se os itens extraídos batem com a
// realidade, antes de confiar no relatório "Itens mais comprados"
// (client/src/pages/admin/Reports.tsx). Pedido do João, 2026-09-11.
//
// Rodar em produção:
//   docker compose exec backend node dist/scripts/auditarItensPedido.js
//   docker compose exec backend node dist/scripts/auditarItensPedido.js --empresa=odin-compressores
import { isNull, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { itensPedido, vendas, empresas } from '../db/schema.js'

async function main() {
  const empresaSlug = process.argv.find((a) => a.startsWith('--empresa='))?.split('=')[1]
  let empresaId: number | undefined
  if (empresaSlug) {
    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, empresaSlug) })
    if (!empresa) {
      console.error(`Empresa "${empresaSlug}" não encontrada. Slugs válidos: ${(await db.query.empresas.findMany()).map((e) => e.slug).join(', ')}`)
      process.exit(1)
    }
    empresaId = empresa.id
    console.log(`Filtrando só ${empresa.nome} (empresaId ${empresaId})\n`)
  }

  const itens = await db.query.itensPedido.findMany({
    where: isNull(itensPedido.deletedAt),
    with: { cliente: { columns: { razaoSocial: true, empresaId: true } } },
  })
  const itensDaEmpresa = empresaId ? itens.filter((i) => i.cliente?.empresaId === empresaId) : itens
  console.log(`Total de itens extraídos${empresaSlug ? ' (nessa empresa)' : ''}: ${itensDaEmpresa.length} (de ${itens.length} no total)`)

  const porVenda = new Map<number, typeof itensDaEmpresa>()
  for (const it of itensDaEmpresa) {
    const lista = porVenda.get(it.vendaId) ?? []
    lista.push(it)
    porVenda.set(it.vendaId, lista)
  }

  // 1) Mesma descrição repetida dentro da MESMA venda — o prompt manda a IA
  // não duplicar o mesmo produto (resumo + detalhamento no PDF, por
  // exemplo), então cada ocorrência aqui é um caso em que isso falhou.
  console.log('\n=== 1) Descrição repetida na mesma venda (possível duplicata da IA) ===')
  let duplicatas = 0
  for (const [vendaId, lista] of porVenda) {
    const contagem = new Map<string, number>()
    for (const it of lista) contagem.set(it.descricao, (contagem.get(it.descricao) ?? 0) + 1)
    for (const [descricao, n] of contagem) {
      if (n > 1) {
        duplicatas++
        console.log(`  venda #${vendaId} — "${descricao}" aparece ${n}x`)
      }
    }
  }
  if (!duplicatas) console.log('  Nenhuma encontrada.')

  // 2) Item sem quantidade ou valor unitário — a IA não conseguiu ler esse
  // campo no PDF (não é erro, ela devolve null de propósito quando não tem
  // certeza), mas é bom saber o tamanho do problema.
  const semDado = itensDaEmpresa.filter((i) => i.quantidade == null || i.valorUnitario == null)
  console.log(`\n=== 2) Itens sem quantidade ou valor unitário ===\n  ${semDado.length} de ${itensDaEmpresa.length} itens.`)

  // 3) Valores fora de qualquer escala plausível — normalmente sinal de a IA
  // ter lido um código/CNPJ/telefone como se fosse quantidade ou preço.
  console.log('\n=== 3) Itens com valores fora do normal (conferir manualmente) ===')
  let fora = 0
  for (const it of itensDaEmpresa) {
    if ((it.quantidade ?? 0) > 100000 || (it.valorUnitario ?? 0) > 1_000_000) {
      fora++
      console.log(`  item #${it.id} (venda #${it.vendaId}) — "${it.descricao}": qtd=${it.quantidade}, unit=${it.valorUnitario}`)
    }
  }
  if (!fora) console.log('  Nenhum encontrado.')

  // 4) Soma dos itens de uma venda vs o valor que o vendedor fechou —
  // divergência grande é o sinal mais forte de item perdido/duplicado/errado.
  // A soma NUNCA precisa bater 100% (frete, desconto, arredondamento), mas
  // >15% de diferença merece abrir o PDF e conferir na mão.
  console.log('\n=== 4) Vendas onde soma dos itens diverge do valor fechado em mais de 15% ===')
  const vendaIds = [...porVenda.keys()]
  const vendasRows = vendaIds.length
    ? await db.query.vendas.findMany({ with: { cliente: { columns: { razaoSocial: true } } } })
    : []
  const vendasPorId = new Map(vendasRows.map((v) => [v.id, v]))
  let divergentes = 0
  for (const [vendaId, lista] of porVenda) {
    const venda = vendasPorId.get(vendaId)
    if (!venda || venda.valorFechado <= 0) continue
    const somaItens = lista.reduce((s, i) => s + (i.valorTotal ?? 0), 0)
    const diffPct = Math.abs(somaItens - venda.valorFechado) / venda.valorFechado
    if (diffPct > 0.15) {
      divergentes++
      console.log(
        `  venda #${vendaId} (${venda.cliente?.razaoSocial ?? '—'}) — fechado: R$ ${venda.valorFechado.toFixed(2)}, ` +
          `soma dos itens: R$ ${somaItens.toFixed(2)} (${(diffPct * 100).toFixed(0)}% de diferença) — PDF: ${venda.pdfPedidoPath ?? '(nenhum anexado)'}`
      )
    }
  }
  if (!divergentes) console.log('  Nenhuma encontrada.')

  // 5) As N linhas de item com maior valor total, não importa se batem em
  // algum limite fixo — no relatório "Itens mais comprados" (soma por
  // descrição, todas as vendas do período), UMA linha errada já basta pra
  // inflar o total daquele produto na tela toda (achado do João, 2026-09-11
  // — item aparecendo com R$ 781 mil quando o esperado era R$ 700-800).
  // Olhando as maiores linhas isoladas, o erro pula aos olhos sem precisar
  // adivinhar um limite certo.
  console.log('\n=== 5) As 15 linhas de item (não agrupadas) com maior valor — confira se fazem sentido ===')
  const maioresLinhas = [...itensDaEmpresa].sort((a, b) => (b.valorTotal ?? 0) - (a.valorTotal ?? 0)).slice(0, 15)
  for (const it of maioresLinhas) {
    const venda = vendasPorId.get(it.vendaId)
    console.log(
      `  item #${it.id} (venda #${it.vendaId}, ${venda?.cliente?.razaoSocial ?? '—'}) — "${it.descricao}": ` +
        `${it.quantidade ?? '?'} un. × R$ ${it.valorUnitario?.toFixed(2) ?? '?'} = R$ ${(it.valorTotal ?? 0).toFixed(2)} ` +
        `| venda fechada em R$ ${venda?.valorFechado.toFixed(2) ?? '?'} | PDF: ${venda?.pdfPedidoPath ?? '(nenhum anexado)'}`
    )
  }

  console.log('\nPronto — sem achados chamativos nos itens 1-4, olha ainda assim a lista do item 5: é a forma mais direta de achar um valor implausível, já que uma linha só pode inflar o total de um produto no relatório inteiro. Compare os 2-3 primeiros da lista contra o PDF de verdade (coluna PDF) antes de confiar no número.')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
