// Script avulso, roda uma vez só (npx tsx scripts/criar-admins-por-empresa.ts) —
// cria os admins dedicados de cada empresa (só enxergam/mudam a própria
// empresa, sem superAdmin): Jaciel (Odin Tubos), Marcio e Victor (Joitec
// Distribuidora de Peças). Pamela (Joitec Automação) e o admin master
// (superAdmin=1, conta "admin" do João) já existem, não mexe neles.
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '../src/db/client.js'
import { empresas, users } from '../src/db/schema.js'

interface AdminSeed {
  username: string
  name: string
  slugEmpresa: string
  senha: string
}

const ADMINS: AdminSeed[] = [
  { username: 'jaciel', name: 'Jaciel', slugEmpresa: 'odin-tubos', senha: 'OdinTubos@2026' },
  { username: 'marcio', name: 'Marcio', slugEmpresa: 'joitec', senha: 'Joitec@2026' },
  { username: 'victor', name: 'Victor', slugEmpresa: 'joitec', senha: 'Joitec@2026' },
]

async function run() {
  for (const a of ADMINS) {
    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, a.slugEmpresa) })
    if (!empresa) {
      console.log(`❌ Empresa "${a.slugEmpresa}" não encontrada, pulando ${a.username}`)
      continue
    }
    const existente = await db.query.users.findFirst({ where: eq(users.username, a.username) })
    if (existente) {
      console.log(`⏭️  ${a.username} já existe (id ${existente.id}), pulando`)
      continue
    }
    const hash = await bcrypt.hash(a.senha, 12)
    const result = await db.insert(users).values({
      empresaId: empresa.id,
      name: a.name,
      username: a.username,
      passwordHash: hash,
      role: 'admin',
      senhaTrocarNoLogin: true,
    })
    console.log(`✅ ${a.name} (admin de ${empresa.nome}) criado — id ${Number(result.lastInsertRowid)} — senha temporária: ${a.senha}`)
  }
  console.log('\n🌱 Concluído.')
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
