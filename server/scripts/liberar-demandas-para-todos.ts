// Script de rollout único — a feature 'demandas' (aba Demandas na sidebar)
// nasceu pra aparecer pra todo mundo, mas o mecanismo de permissões é
// opt-in por usuário (permissoesAdmin). Sem isso, cada admin/vendedor só
// veria a aba depois do João liberar manualmente em Permissões, um por um.
// superAdmin nunca precisa de linha aqui (sempre vê tudo).
import { eq, and } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { users, permissoesAdmin } from '../src/db/schema.js'

async function main() {
  const todos = await db.query.users.findMany({ where: eq(users.superAdmin, false), columns: { id: true, name: true } })
  let concedidos = 0
  for (const u of todos) {
    const jaTem = await db.query.permissoesAdmin.findFirst({
      where: and(eq(permissoesAdmin.userId, u.id), eq(permissoesAdmin.feature, 'demandas')),
    })
    if (jaTem) continue
    await db.insert(permissoesAdmin).values({ userId: u.id, feature: 'demandas' })
    concedidos++
  }
  console.log(`Feature 'demandas' liberada pra ${concedidos} usuário(s) (de ${todos.length} não-superAdmin).`)
  process.exit(0)
}

main().catch((e) => {
  console.error('ERRO:', e)
  process.exit(1)
})
