// Script avulso, roda uma vez só (npx tsx scripts/criar-joitec-automacao.ts) —
// cria a empresa Joitec Automação com os 2 usuários reais: Pamela (admin,
// só enxerga essa empresa — não é superAdmin) e Fernanda (vendedora, meta de
// faturamento do mês corrente em R$ 30.000). Carteira fixa, sem round-robin,
// mesmo padrão já usado nas outras duas empresas.
import { eq, and } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '../src/db/client.js'
import { empresas, users, metasMensais } from '../src/db/schema.js'
import { mesReferenciaAtual } from '../src/lib/dataBr.js'

const SENHA_TEMPORARIA = 'JoitecAutomacao@2026'

async function run() {
  let empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'joitec-automacao') })
  if (!empresa) {
    const result = await db.insert(empresas).values({ nome: 'Joitec Automação', slug: 'joitec-automacao' })
    empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, Number(result.lastInsertRowid)) })
    console.log(`✅ Empresa "Joitec Automação" criada — id ${empresa!.id}`)
  } else {
    console.log(`⏭️  Empresa "Joitec Automação" já existe (id ${empresa.id})`)
  }

  const hash = await bcrypt.hash(SENHA_TEMPORARIA, 12)

  const pamelaExistente = await db.query.users.findFirst({ where: eq(users.username, 'pamela') })
  if (!pamelaExistente) {
    const result = await db.insert(users).values({
      empresaId: empresa!.id,
      name: 'Pamela',
      username: 'pamela',
      passwordHash: hash,
      role: 'admin',
      senhaTrocarNoLogin: true,
    })
    console.log(`✅ Pamela (admin) criada — id ${Number(result.lastInsertRowid)}`)
  } else {
    console.log(`⏭️  pamela já existe (id ${pamelaExistente.id}), pulando criação`)
  }

  let fernanda = await db.query.users.findFirst({ where: eq(users.username, 'fernanda') })
  if (!fernanda) {
    const result = await db.insert(users).values({
      empresaId: empresa!.id,
      name: 'Fernanda',
      username: 'fernanda',
      passwordHash: hash,
      role: 'vendor',
      senhaTrocarNoLogin: true,
    })
    fernanda = await db.query.users.findFirst({ where: eq(users.id, Number(result.lastInsertRowid)) })
    console.log(`✅ Fernanda (vendedora) criada — id ${fernanda!.id}`)
  } else {
    console.log(`⏭️  fernanda já existe (id ${fernanda.id}), pulando criação`)
  }

  const mesAtual = mesReferenciaAtual()
  const metaFaturamento = 30_000
  const metaExistente = await db.query.metasMensais.findFirst({
    where: and(eq(metasMensais.vendedorId, fernanda!.id), eq(metasMensais.mesReferencia, mesAtual)),
  })
  if (metaExistente) {
    await db.update(metasMensais).set({ metaFaturamento }).where(eq(metasMensais.id, metaExistente.id))
    console.log(`🔄 Meta de Fernanda atualizada pra R$ ${metaFaturamento.toLocaleString('pt-BR')}`)
  } else {
    await db.insert(metasMensais).values({ vendedorId: fernanda!.id, mesReferencia: mesAtual, metaFaturamento, metaLigacoesDia: 25 })
    console.log(`✅ Meta de Fernanda lançada: R$ ${metaFaturamento.toLocaleString('pt-BR')}`)
  }

  console.log(`\n🌱 Concluído. Senha temporária (troca obrigatória no 1º login): ${SENHA_TEMPORARIA}`)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
