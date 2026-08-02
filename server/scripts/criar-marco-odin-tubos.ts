// Script avulso — cria Marco Aurelio Girardi como vendedor real da Odin
// Tubos e Conexões (36 clientes dele já existem na planilha "CLIENTES ODIN
// TC" e serão atribuídos a ele na importação seguinte).
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '../src/db/client.js'
import { empresas, users } from '../src/db/schema.js'

const SENHA_TEMPORARIA = 'OdinTubos@2026'

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-tubos') })
  if (!empresa) throw new Error('Empresa "odin-tubos" não encontrada.')

  const existente = await db.query.users.findFirst({ where: eq(users.username, 'marco') })
  if (existente) {
    console.log(`⏭️  marco já existe (id ${existente.id}), pulando criação`)
    process.exit(0)
  }

  const hash = await bcrypt.hash(SENHA_TEMPORARIA, 12)
  const result = await db.insert(users).values({
    empresaId: empresa.id,
    name: 'Marco Aurelio Girardi',
    username: 'marco',
    passwordHash: hash,
    role: 'vendor',
    senhaTrocarNoLogin: true,
  })
  console.log(`✅ Marco Aurelio Girardi (vendedor) criado — id ${Number(result.lastInsertRowid)}`)
  console.log(`Senha temporária (troca obrigatória no 1º login): ${SENHA_TEMPORARIA}`)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
