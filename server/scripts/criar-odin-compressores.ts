// Script avulso — cria a empresa Odin Compressores com os 2 usuários reais:
// Roberto (admin, só enxerga essa empresa) e Bruna (vendedora, carteira
// fixa, recebe todos os clientes importados).
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '../src/db/client.js'
import { empresas, users } from '../src/db/schema.js'

const SENHA_TEMPORARIA = 'OdinCompressores@2026'

async function run() {
  let empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-compressores') })
  if (!empresa) {
    const result = await db.insert(empresas).values({ nome: 'Odin Compressores', slug: 'odin-compressores' })
    empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, Number(result.lastInsertRowid)) })
    console.log(`✅ Empresa "Odin Compressores" criada — id ${empresa!.id}`)
  } else {
    console.log(`⏭️  Empresa "Odin Compressores" já existe (id ${empresa.id})`)
  }

  const hash = await bcrypt.hash(SENHA_TEMPORARIA, 12)

  const robertoExistente = await db.query.users.findFirst({ where: eq(users.username, 'roberto') })
  if (!robertoExistente) {
    const result = await db.insert(users).values({
      empresaId: empresa!.id,
      name: 'Roberto',
      username: 'roberto',
      passwordHash: hash,
      role: 'admin',
      senhaTrocarNoLogin: true,
    })
    console.log(`✅ Roberto (admin) criado — id ${Number(result.lastInsertRowid)}`)
  } else {
    console.log(`⏭️  roberto já existe (id ${robertoExistente.id}), pulando criação`)
  }

  const brunaExistente = await db.query.users.findFirst({ where: eq(users.username, 'bruna') })
  if (!brunaExistente) {
    const result = await db.insert(users).values({
      empresaId: empresa!.id,
      name: 'Bruna',
      username: 'bruna',
      passwordHash: hash,
      role: 'vendor',
      senhaTrocarNoLogin: true,
    })
    console.log(`✅ Bruna (vendedora) criada — id ${Number(result.lastInsertRowid)}`)
  } else {
    console.log(`⏭️  bruna já existe (id ${brunaExistente.id}), pulando criação`)
  }

  console.log(`\n🌱 Concluído. Senha temporária (troca obrigatória no 1º login): ${SENHA_TEMPORARIA}`)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
