import { db } from '../db/client.js'
import { gotoLogIntegracao, gotoLigacoesProcessadas, clientes, empresas } from '../db/schema.js'
import { desc, isNull, like } from 'drizzle-orm'

async function run() {
  const encontrados = await db.query.clientes.findMany({
    where: (c, { and }) => and(isNull(c.deletedAt), like(c.razaoSocial, '%F R EQUIPAMENTOS%')),
    columns: { id: true, razaoSocial: true, telefoneWhatsapp: true, vendedorAtualId: true, empresaId: true },
    with: { telefonesExtras: { columns: { numero: true } } },
  })
  console.log(`🔎 Cliente(s) "F R EQUIPAMENTOS" (${encontrados.length}):`)
  for (const c of encontrados) console.log(c)

  const todasEmpresas = await db.query.empresas.findMany({ columns: { id: true, nome: true, slug: true } })
  console.log('\n🏢 Empresas:', todasEmpresas)

  const ligacoes = await db.query.gotoLigacoesProcessadas.findMany({
    orderBy: [desc(gotoLigacoesProcessadas.id)],
    limit: 6,
  })
  console.log(`\n📞 Últimas ${ligacoes.length} ligações processadas:\n`)
  for (const c of ligacoes) {
    console.log(
      `[${c.criadoEm}] ${c.conversationSpaceId} — status: ${c.status} — direção: ${c.direcao ?? '-'} — número: ${c.numeroExterno ?? '-'} — duração: ${c.duracaoSegundos ?? '-'}s — cliente: ${c.clienteId ?? '-'} — motivo: ${c.motivoNaoRegistrado ?? '-'}`
    )
  }

  const logs = await db.query.gotoLogIntegracao.findMany({
    orderBy: [desc(gotoLogIntegracao.id)],
    limit: 10,
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
