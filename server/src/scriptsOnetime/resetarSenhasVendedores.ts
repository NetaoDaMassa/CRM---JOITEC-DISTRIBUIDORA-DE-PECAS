// ⚠️ TEMPORÁRIO — cópia de server/scripts/resetar-senhas-vendedores-odin-tubos.ts
// só pra existir dentro de src/ (compilado pro dist/) e rodar em produção.
// Excluir depois de confirmar. Registro permanente em server/scripts/.
//
// Script avulso — Odin Tubos e Conexões, pedido do João (10/08/2026): reseta
// a senha de TODOS os vendedores (não mexe em admin/superAdmin) pra uma
// senha padrão única (mais fácil de repassar pro time) — todos obrigados a
// trocar no próximo login (senhaTrocarNoLogin: true, mesma trava usada em
// users.resetPassword).
import { and, eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '../db/client.js'
import { empresas, users } from '../db/schema.js'

const SENHA_PADRAO = 'Odin@2026'

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-tubos') })
  if (!empresa) throw new Error('Empresa Odin Tubos e Conexões não encontrada')

  const vendedores = await db.query.users.findMany({
    where: and(eq(users.empresaId, empresa.id), eq(users.role, 'vendor'), eq(users.isActive, true)),
    orderBy: (u, { asc }) => [asc(u.name)],
  })

  const hash = await bcrypt.hash(SENHA_PADRAO, 12)
  console.log(`📊 Resetando senha de ${vendedores.length} vendedor(es) para "${SENHA_PADRAO}":\n`)
  for (const v of vendedores) {
    await db.update(users).set({ passwordHash: hash, senhaTrocarNoLogin: true }).where(eq(users.id, v.id))
    console.log(`  ${v.name} — usuário: ${v.username}`)
  }
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
