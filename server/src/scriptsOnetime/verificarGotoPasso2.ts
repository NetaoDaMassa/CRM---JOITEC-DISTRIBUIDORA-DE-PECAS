import { db } from '../db/client.js'
import { gotoLogIntegracao, gotoLigacoesProcessadas, registroContato, funilMensal, clientes } from '../db/schema.js'
import { desc, eq } from 'drizzle-orm'

async function run() {
  const ligacoes = await db.query.gotoLigacoesProcessadas.findMany({
    orderBy: [desc(gotoLigacoesProcessadas.id)],
    limit: 5,
  })
  console.log(`📞 Últimas ${ligacoes.length} ligações processadas (goto_ligacoes_processadas):\n`)
  for (const c of ligacoes) {
    console.log(
      `[${c.criadoEm}] ${c.conversationSpaceId} — status: ${c.status} — direção: ${c.direcao ?? '-'} — número: ${c.numeroExterno ?? '-'} — duração: ${c.duracaoSegundos ?? '-'}s — cliente: ${c.clienteId ?? '-'} — registroContatoId: ${c.registroContatoId ?? '-'} — motivo: ${c.motivoNaoRegistrado ?? '-'}`
    )
  }

  const cliente = await db.query.clientes.findFirst({
    where: eq(clientes.id, 14001),
    columns: { id: true, razaoSocial: true, empresaId: true },
  })
  console.log('\n📌 Cliente 14001 (neto teste geral):', cliente)

  if (cliente) {
    const funil = await db.query.funilMensal.findFirst({
      where: eq(funilMensal.clienteId, cliente.id),
      orderBy: [desc(funilMensal.id)],
    })
    console.log('   funil mensal mais recente:', funil ? { id: funil.id, mesReferencia: funil.mesReferencia, qtdTentativasContato: funil.qtdTentativasContato } : null)

    if (funil) {
      const contatos = await db.query.registroContato.findMany({
        where: eq(registroContato.funilMensalId, funil.id),
        orderBy: [desc(registroContato.id)],
        limit: 5,
      })
      console.log(`   últimos ${contatos.length} registros de contato:`)
      for (const r of contatos) console.log('    ', r)
    }
  }

  const logs = await db.query.gotoLogIntegracao.findMany({
    orderBy: [desc(gotoLogIntegracao.id)],
    limit: 6,
  })
  console.log(`\n📋 Últimos ${logs.length} registros de goto_log_integracao:\n`)
  for (const l of logs) {
    console.log(`[${l.criadoEm}] ${l.sucesso ? '✅' : '❌'} ${l.operacao} — status ${l.statusCode ?? '-'}`)
  }

  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
