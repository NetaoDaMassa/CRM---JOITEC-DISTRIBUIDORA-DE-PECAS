import { db } from '../db/client.js'
import { clientes, users } from '../db/schema.js'
import { eq, like } from 'drizzle-orm'

async function run() {
  const encontrados = await db.query.clientes.findMany({
    where: like(clientes.razaoSocial, '%neto teste geral%'),
    columns: { id: true, razaoSocial: true, telefoneWhatsapp: true, vendedorAtualId: true, empresaId: true, deletedAt: true },
    with: { telefonesExtras: { columns: { numero: true } } },
  })
  console.log(`🔎 Cliente(s) "neto teste geral" (${encontrados.length}):`)
  for (const c of encontrados) {
    console.log(c)
    if (c.vendedorAtualId) {
      const vendedor = await db.query.users.findFirst({ where: eq(users.id, c.vendedorAtualId), columns: { name: true, username: true } })
      console.log('  vendedor:', vendedor)
    } else {
      console.log('  ⚠️ SEM vendedor atual atribuído — auto-registro não vai funcionar até atribuir um vendedor')
    }
  }

  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
