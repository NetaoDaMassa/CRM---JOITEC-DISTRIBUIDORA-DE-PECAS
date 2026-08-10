// ⚠️ TEMPORÁRIO — só leitura. Confirma se o Sergio e a carteira dele
// ficaram completos depois das tentativas com timeout/SQLITE_BUSY.
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, users } from '../db/schema.js'

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-tubos') })
  if (!empresa) throw new Error('Empresa não encontrada')

  const sergio = await db.query.users.findFirst({ where: eq(users.username, 'sergio.tubos') })
  console.log('Sergio:', sergio ? `id ${sergio.id}, ativo=${sergio.isActive}` : 'NÃO EXISTE')

  if (sergio) {
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(clientes)
      .where(eq(clientes.vendedorAtualId, sergio.id))
    console.log('Clientes na carteira do Sergio:', total)
  }

  const aindaNoBanco = await db.query.clientes.findMany({
    where: and(eq(clientes.empresaId, empresa.id), isNull(clientes.vendedorAtualId), isNull(clientes.deletedAt), eq(clientes.origemBanco, 'Sergio Leandro Gratao')),
    columns: { id: true },
  })
  console.log('Ainda no Banco de Clientes sob o rótulo Sergio (deveria ser 0):', aindaNoBanco.length)

  console.log('\n===== Usuários da Odin Tubos e Conexões =====')
  const todos = await db.query.users.findMany({
    where: eq(users.empresaId, empresa.id),
    columns: { id: true, name: true, username: true, role: true, isActive: true },
    orderBy: (u, { desc, asc }) => [desc(u.role), asc(u.name)],
  })
  for (const u of todos) {
    console.log(`  ${u.name} — usuário: ${u.username} — ${u.role}${u.isActive ? '' : ' (INATIVO)'}`)
  }
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
