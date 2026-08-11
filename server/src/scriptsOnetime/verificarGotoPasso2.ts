import { db } from '../db/client.js'
import { gotoLigacoesProcessadas } from '../db/schema.js'
import { desc } from 'drizzle-orm'

async function run() {
  const ligacoes = await db.query.gotoLigacoesProcessadas.findMany({
    orderBy: [desc(gotoLigacoesProcessadas.id)],
    limit: 15,
  })
  console.log(`📞 Últimas ${ligacoes.length} ligações processadas:\n`)
  for (const c of ligacoes) {
    console.log(
      `[${c.criadoEm}] ${c.conversationSpaceId} — status: ${c.status} — direção: ${c.direcao ?? '-'} — número: ${c.numeroExterno ?? '-'} — duração: ${c.duracaoSegundos ?? '-'}s — cliente: ${c.clienteId ?? '-'} — motivo: ${c.motivoNaoRegistrado ?? '-'}`
    )
  }
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
