// Limpeza única — remove os cards de funil que "vazaram" pra carteira por
// causa do bug do resetMensal (que criava funil_mensal pra prospect).
//
// Um prospect que vazou = cliente com em_prospeccao = true QUE JÁ TEM
// funil_mensal. O certo é ele não ter card nenhum até o vendedor clicar
// "enviar pra carteira".
//
// Este script:
//   - cards vazados SEM nenhuma atividade (sem venda, sem contato) → soft-delete
//   - cards vazados COM atividade (o vendedor chegou a trabalhar) → só LISTA,
//     não mexe (decisão manual: ou o prospect vira carteira de verdade, ou
//     você apaga o card na mão)
//
// Rodar:
//   Local:  npm run limpar-prospects-vazados -- --dry-run
//           npm run limpar-prospects-vazados
//   VPS:    docker compose exec backend node dist/scripts/limparProspectsVazados.js --dry-run
//           docker compose exec backend node dist/scripts/limparProspectsVazados.js

import { config } from 'dotenv'
config()

import { and, eq, isNull, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, funilMensal, vendas, registroContato } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'

const dryRun = process.argv.includes('--dry-run')

async function run() {
  console.log(`[limpar-prospects] ${dryRun ? 'DRY RUN — nada será alterado' : 'aplicando'}\n`)

  const prospects = await db.query.clientes.findMany({
    where: and(eq(clientes.emProspeccao, true), isNull(clientes.deletedAt)),
    columns: { id: true, razaoSocial: true, empresaId: true, vendedorAtualId: true },
  })

  let limpos = 0
  let cardsRemovidos = 0
  const comAtividade: { cliente: string; cardId: number; vendas: number; contatos: number }[] = []

  for (const p of prospects) {
    const cards = await db.query.funilMensal.findMany({
      where: and(eq(funilMensal.clienteId, p.id), isNull(funilMensal.deletedAt)),
      columns: { id: true, mesReferencia: true, etapa: true },
    })
    if (cards.length === 0) continue // prospect são, nunca vazou

    const cardIds = cards.map((c) => c.id)
    const [vs, cs] = await Promise.all([
      db.query.vendas.findMany({ where: and(inArray(vendas.funilMensalId, cardIds), isNull(vendas.deletedAt)), columns: { id: true, funilMensalId: true } }),
      db.query.registroContato.findMany({ where: and(inArray(registroContato.funilMensalId, cardIds), isNull(registroContato.deletedAt)), columns: { id: true, funilMensalId: true } }),
    ])
    const vendasPorCard = new Map<number, number>()
    for (const v of vs) vendasPorCard.set(v.funilMensalId, (vendasPorCard.get(v.funilMensalId) ?? 0) + 1)
    const contatosPorCard = new Map<number, number>()
    for (const c of cs) contatosPorCard.set(c.funilMensalId, (contatosPorCard.get(c.funilMensalId) ?? 0) + 1)

    const cardsLimpos = cards.filter((c) => !vendasPorCard.get(c.id) && !contatosPorCard.get(c.id))
    const cardsSujos = cards.filter((c) => vendasPorCard.get(c.id) || contatosPorCard.get(c.id))

    if (cardsLimpos.length > 0) {
      console.log(`  ${p.razaoSocial} (cliente ${p.id}, empresa ${p.empresaId}) → apaga ${cardsLimpos.length} card(s): ${cardsLimpos.map((c) => `${c.mesReferencia}/${c.etapa}`).join(', ')}`)
      if (!dryRun) {
        await db.update(funilMensal).set({ deletedAt: agoraSqlite() }).where(inArray(funilMensal.id, cardsLimpos.map((c) => c.id)))
      }
      limpos++
      cardsRemovidos += cardsLimpos.length
    }
    for (const c of cardsSujos) {
      comAtividade.push({ cliente: `${p.razaoSocial} (${p.id})`, cardId: c.id, vendas: vendasPorCard.get(c.id) ?? 0, contatos: contatosPorCard.get(c.id) ?? 0 })
    }
  }

  console.log(`\n[limpar-prospects] ${dryRun ? 'apagaria' : 'apagou'} ${cardsRemovidos} card(s) vazado(s) de ${limpos} prospect(s).`)
  if (comAtividade.length) {
    console.log(`\n⚠️  ${comAtividade.length} card(s) vazado(s) COM atividade — NÃO mexidos, revise na mão:`)
    for (const a of comAtividade) console.log(`   card ${a.cardId} · ${a.cliente} · ${a.vendas} venda(s), ${a.contatos} contato(s)`)
  }
  process.exit(0)
}

run().catch((err) => {
  console.error('[limpar-prospects] erro:', err)
  process.exit(1)
})
