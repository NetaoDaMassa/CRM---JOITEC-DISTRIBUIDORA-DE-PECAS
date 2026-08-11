import { db } from '../db/client.js'
import { empresas } from '../db/schema.js'

async function run() {
  const todas = await db.query.empresas.findMany({ columns: { id: true, nome: true, slug: true } })
  console.log('🏢 Empresas cadastradas:')
  for (const e of todas) console.log(e)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
