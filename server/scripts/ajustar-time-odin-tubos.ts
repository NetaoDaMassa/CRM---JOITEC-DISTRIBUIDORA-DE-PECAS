// Script avulso, roda uma vez só — cria os vendedores que faltavam na Odin
// Tubos e Conexões (Yasmin Salles, Ricardo, Iris) e lança a meta de
// faturamento do mês corrente pros 6 vendedores reais do time.
import { eq, and } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '../src/db/client.js'
import { empresas, users, metasMensais } from '../src/db/schema.js'
import { mesReferenciaAtual } from '../src/lib/dataBr.js'

const SENHA_TEMPORARIA = 'OdinTubos@2026'

const NOVOS_VENDEDORES = [
  { username: 'yasmin.salles', name: 'Yasmin Salles', regiao: 'sudeste' as const },
  { username: 'ricardo', name: 'Ricardo', regiao: 'sul' as const },
  { username: 'iris', name: 'Iris', regiao: 'sul' as const },
]

const METAS: Record<string, number> = {
  luana: 170_000,
  'yasmin.ramos': 170_000,
  'yasmin.salles': 170_000,
  karinna: 140_000,
  ricardo: 50_000,
  iris: 50_000,
}

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-tubos') })
  if (!empresa) throw new Error('Empresa "odin-tubos" não encontrada.')

  const hash = await bcrypt.hash(SENHA_TEMPORARIA, 12)
  for (const v of NOVOS_VENDEDORES) {
    const existente = await db.query.users.findFirst({ where: eq(users.username, v.username) })
    if (existente) {
      console.log(`⏭️  ${v.username} já existe (id ${existente.id}), pulando criação`)
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
  }

  const mesAtual = mesReferenciaAtual()
  const vendedores = await db.query.users.findMany({ where: and(eq(users.empresaId, empresa.id), eq(users.role, 'vendor')) })

  for (const v of vendedores) {
    const metaFaturamento = METAS[v.username]
    if (metaFaturamento === undefined) {
      console.log(`⏭️  ${v.username} sem meta nesta lista, não mexi`)
      continue
    }
    const existente = await db.query.metasMensais.findFirst({
      where: and(eq(metasMensais.vendedorId, v.id), eq(metasMensais.mesReferencia, mesAtual)),
    })
    if (existente) {
      await db.update(metasMensais).set({ metaFaturamento }).where(eq(metasMensais.id, existente.id))
      console.log(`🔄 Meta de ${v.name} atualizada pra R$ ${metaFaturamento.toLocaleString('pt-BR')}`)
    } else {
      await db.insert(metasMensais).values({ vendedorId: v.id, mesReferencia: mesAtual, metaFaturamento, metaLigacoesDia: 25 })
      console.log(`✅ Meta de ${v.name} lançada: R$ ${metaFaturamento.toLocaleString('pt-BR')}`)
    }
  }

  console.log('\n🌱 Concluído.')
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
