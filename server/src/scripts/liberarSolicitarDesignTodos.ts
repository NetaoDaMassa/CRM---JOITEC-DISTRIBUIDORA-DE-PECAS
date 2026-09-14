// Carga ÚNICA — libera a feature 'solicitar_design' ("Solicitar Arte") pra
// TODOS os admins e vendedores ativos, de todas as empresas. Pedido do
// João, 2026-09-14: antes só 4 das 7 empresas tinham algum vendedor com
// essa permissão (nenhum admin tinha) — ele pediu pra liberar geral.
//
// Idempotente: só insere quem ainda não tem a linha (não duplica, não erra
// rodando de novo). superAdmin não precisa (já vê tudo, ver
// permissoes.ts/minhasPermissoes).
//
// Rodar:
//   Local:  npm run permissoes:liberar-solicitar-design -- --dry-run
//           npm run permissoes:liberar-solicitar-design
//   VPS:    docker compose exec backend node dist/scripts/liberarSolicitarDesignTodos.js --dry-run
//           docker compose exec backend node dist/scripts/liberarSolicitarDesignTodos.js
import { config } from 'dotenv'
config()

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users, permissoesAdmin, empresas } from '../db/schema.js'

const FEATURE = 'solicitar_design'
const dryRun = process.argv.includes('--dry-run')

async function run() {
  console.log(`[liberar-solicitar-design] ${dryRun ? 'DRY RUN — nada será gravado' : 'gravando'}\n`)

  const alvos = await db.query.users.findMany({
    where: and(inArray(users.role, ['admin', 'vendor']), eq(users.superAdmin, false), eq(users.isActive, true)),
    columns: { id: true, name: true, role: true, empresaId: true },
  })

  const jaTem = await db.query.permissoesAdmin.findMany({
    where: eq(permissoesAdmin.feature, FEATURE),
    columns: { userId: true },
  })
  const idsComFeature = new Set(jaTem.map((p) => p.userId))

  const empresasTodas = await db.query.empresas.findMany({ columns: { id: true, nome: true } })
  const nomeEmpresa = new Map(empresasTodas.map((e) => [e.id, e.nome]))

  let concedidos = 0
  for (const u of alvos) {
    if (idsComFeature.has(u.id)) continue
    console.log(`  + ${u.name.padEnd(32)} ${u.role.padEnd(6)} ${nomeEmpresa.get(u.empresaId) ?? '?'}`)
    if (!dryRun) {
      await db.insert(permissoesAdmin).values({ userId: u.id, feature: FEATURE })
    }
    concedidos++
  }

  console.log(
    `\n[liberar-solicitar-design] ${dryRun ? 'conferido' : 'concedido'}: ${concedidos} usuário(s) novo(s) (${alvos.length - concedidos} já tinham).`
  )
  process.exit(0)
}

run().catch((err) => {
  console.error('[liberar-solicitar-design] erro:', err)
  process.exit(1)
})
