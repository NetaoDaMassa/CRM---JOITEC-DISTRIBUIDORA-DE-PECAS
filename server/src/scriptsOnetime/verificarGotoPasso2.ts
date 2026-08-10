import { db } from '../db/client.js'
import { gotoLogIntegracao, gotoLigacoesProcessadas } from '../db/schema.js'
import { desc } from 'drizzle-orm'

async function run() {
  const logs = await db.query.gotoLogIntegracao.findMany({
    orderBy: [desc(gotoLogIntegracao.id)],
    limit: 20,
  })
  console.log(`📋 Últimos ${logs.length} registros de goto_log_integracao:\n`)
  for (const l of logs) {
    console.log(`[${l.criadoEm}] ${l.sucesso ? '✅' : '❌'} ${l.operacao} — ${l.metodo ?? ''} ${l.url ?? ''} — status ${l.statusCode ?? '-'}`)
    if (l.operacao === 'notificacao_recebida' || l.operacao === 'buscar_relatorio_chamada' || !l.sucesso) {
      console.log(`   corpo: ${(l.responseBody ?? '').slice(0, 1500)}`)
    }
  }

  const ligacoes = await db.query.gotoLigacoesProcessadas.findMany({
    orderBy: [desc(gotoLigacoesProcessadas.id)],
    limit: 5,
  })
  console.log(`\n📞 Últimas ${ligacoes.length} ligações processadas (goto_ligacoes_processadas):\n`)
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
