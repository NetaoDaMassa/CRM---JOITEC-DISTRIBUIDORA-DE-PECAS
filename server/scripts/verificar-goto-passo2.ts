// Script avulso — verificação pós-deploy do PASSO 2 da integração GoTo
// Connect (10/08/2026): confirma que o boot do container conseguiu recriar
// canal + assinatura via Call Events Report API (não fica só no "container
// subiu", já que iniciarListener() engole erro de assinatura em catch e não
// derruba o processo).
import { db } from '../src/db/client.js'
import { gotoLogIntegracao, gotoLigacoesProcessadas } from '../src/db/schema.js'
import { desc } from 'drizzle-orm'

async function run() {
  const logs = await db.query.gotoLogIntegracao.findMany({
    orderBy: [desc(gotoLogIntegracao.id)],
    limit: 15,
  })
  console.log(`📋 Últimos ${logs.length} registros de goto_log_integracao:\n`)
  for (const l of logs) {
    console.log(`[${l.criadoEm}] ${l.sucesso ? '✅' : '❌'} ${l.operacao} — ${l.metodo ?? ''} ${l.url ?? ''} — status ${l.statusCode ?? '-'}`)
    if (!l.sucesso) console.log(`   erro: ${l.erro ?? '-'} | resposta: ${(l.responseBody ?? '').slice(0, 300)}`)
  }

  const ligacoes = await db.query.gotoLigacoesProcessadas.findMany({
    orderBy: [desc(gotoLigacoesProcessadas.id)],
    limit: 5,
  })
  console.log(`\n📞 Últimas ${ligacoes.length} ligações processadas (goto_ligacoes_processadas):\n`)
  for (const c of ligacoes) {
    console.log(`[${c.criadoEm}] ${c.conversationSpaceId} — status: ${c.status} — cliente: ${c.clienteId ?? '-'} — motivo: ${c.motivoNaoRegistrado ?? '-'}`)
  }

  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
