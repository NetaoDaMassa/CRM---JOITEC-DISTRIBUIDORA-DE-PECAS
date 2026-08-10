// Script avulso — finaliza a movimentação de clientes pro Sergio (Odin
// Tubos). O script original (configurar-metas-e-sergio-odin-tubos.ts) só
// move o Banco de Clientes pra carteira dele na MESMA execução em que cria
// o usuário — uma tentativa anterior caiu no meio (timeout de SSH) depois
// de criar o Sergio e mover só 84 de ~180 clientes, deixando o resto preso
// no banco. Este script termina o resto, idempotente (só mexe em quem
// ainda está sem vendedor).
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, users } from '../db/schema.js'
import { transferirCliente } from '../router/carteira.js'

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-tubos') })
  if (!empresa) throw new Error('Empresa Odin Tubos e Conexões não encontrada')

  const admin = await db.query.users.findFirst({ where: and(eq(users.empresaId, empresa.id), eq(users.role, 'admin')) })
  if (!admin) throw new Error('Admin não encontrado')

  const sergio = await db.query.users.findFirst({ where: eq(users.username, 'sergio.tubos') })
  if (!sergio) throw new Error('Sergio (username sergio.tubos) não encontrado — rode o script de criação primeiro')

  const restantes = await db.query.clientes.findMany({
    where: and(eq(clientes.empresaId, empresa.id), isNull(clientes.vendedorAtualId), isNull(clientes.deletedAt), eq(clientes.origemBanco, 'Sergio Leandro Gratao')),
    columns: { id: true },
  })

  let movidos = 0
  for (const c of restantes) {
    await transferirCliente(c.id, sergio.id, admin.id)
    movidos++
  }

  const totalNaCarteira = await db.query.clientes.findMany({
    where: eq(clientes.vendedorAtualId, sergio.id),
    columns: { id: true },
  })

  console.log(`✅ Movidos agora: ${movidos}`)
  console.log(`   Total na carteira do Sergio: ${totalNaCarteira.length}`)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
