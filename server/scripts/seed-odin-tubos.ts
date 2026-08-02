// Script avulso, roda uma vez só (npx tsx scripts/seed-odin-tubos.ts) — cria
// os 5 vendedores reais da Odin Tubos e Conexões (empresaId=2, já inserida na
// migração multi-empresa). Não faz parte do `npm run seed` porque esse não é
// idempotente e já rodou contra o banco real; este script também não é —
// rodar duas vezes vai bater no unique de username.
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '../src/db/client.js'
import { empresas, users } from '../src/db/schema.js'

interface VendedorSeed {
  username: string
  name: string
  regiao: 'norte' | 'nordeste' | 'centro_oeste' | 'sudeste' | 'sul'
}

// Extraídos (só leitura) do banco real do projeto odin-tubos-crm--master
// (odin_crm.db, company_id=1) — carteira fixa aqui, não rodízio, então
// "regiao" é só informativo. Luana cobre Norte+Nordeste+Centro-Oeste no
// sistema original; ficou com Norte como região principal.
const VENDEDORES: VendedorSeed[] = [
  { username: 'luana', name: 'Luana Aparecida', regiao: 'norte' },
  { username: 'daiani', name: 'Daiani', regiao: 'sudeste' },
  { username: 'yasmin.ramos', name: 'Yasmin Ramos', regiao: 'sudeste' },
  { username: 'karinna', name: 'Karinna', regiao: 'sul' },
  { username: 'yasmin', name: 'Yasmin', regiao: 'sul' },
]

const SENHA_TEMPORARIA = 'OdinTubos@2026'

async function seedOdinTubos() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-tubos') })
  if (!empresa) throw new Error('Empresa "odin-tubos" não encontrada — rode a migração multi-empresa primeiro.')

  const hash = await bcrypt.hash(SENHA_TEMPORARIA, 12)
  let criados = 0

  for (const v of VENDEDORES) {
    const existente = await db.query.users.findFirst({ where: eq(users.username, v.username) })
    if (existente) {
      console.log(`⏭️  ${v.username} já existe (id ${existente.id}), pulando`)
      continue
    }
    const result = await db.insert(users).values({
      empresaId: empresa.id,
      name: v.name,
      username: v.username,
      passwordHash: hash,
      role: 'vendor',
      regiao: v.regiao,
      senhaTrocarNoLogin: true,
    })
    console.log(`✅ ${v.name} (${v.username}) criado — id ${Number(result.lastInsertRowid)}`)
    criados++
  }

  console.log(`\n🌱 Concluído: ${criados} vendedor(es) novo(s) na Odin Tubos e Conexões (empresaId=${empresa.id})`)
  console.log(`Senha temporária (troca obrigatória no 1º login): ${SENHA_TEMPORARIA}`)
  process.exit(0)
}

seedOdinTubos().catch((err) => {
  console.error('❌ Erro no seed da Odin Tubos:', err)
  process.exit(1)
})
