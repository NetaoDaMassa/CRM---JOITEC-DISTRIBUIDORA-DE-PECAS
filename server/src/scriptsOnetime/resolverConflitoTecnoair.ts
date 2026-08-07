// ⚠️ TEMPORÁRIO — cópia de server/scripts/resolver-conflito-tecnoair-odin-tubos.ts
// só pra existir dentro de src/ (compilado pro dist/) e rodar em produção
// via `docker compose exec backend node dist/scriptsOnetime/resolverConflitoTecnoair.js`.
// Excluir este arquivo (e este diretório) depois de confirmar. Registro
// permanente em server/scripts/.
//
// Script avulso — resolve o único conflito real encontrado ao importar as
// carteiras de Luana/Yasmin Salles/Ricardo (Odin Tubos, 07/08/2026):
// "TECNOAIR RENTAL AR LTDA" (C004663) apareceu na lista da Yasmin Salles,
// mas já pertencia à Karinna (import anterior, mesmo dia). Por decisão do
// João, fica com a Yasmin Salles — a lista que ele upou por último pra esse
// cliente é a que vale.
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, users } from '../db/schema.js'
import { transferirCliente } from '../router/carteira.js'

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-tubos') })
  if (!empresa) throw new Error('Empresa Odin Tubos e Conexões não encontrada')

  const cliente = await db.query.clientes.findFirst({
    where: and(eq(clientes.empresaId, empresa.id), eq(clientes.codigo, 'C004663')),
    with: { vendedorAtual: { columns: { name: true } } },
  })
  if (!cliente) throw new Error('Cliente C004663 não encontrado')

  const vendedores = await db.query.users.findMany({ where: and(eq(users.role, 'vendor'), eq(users.empresaId, empresa.id)) })
  const yasmin = vendedores.find((v) => v.name.trim().toUpperCase() === 'YASMIN SALLES')
  if (!yasmin) throw new Error('Vendedora "Yasmin Salles" não encontrada')

  const admin = await db.query.users.findFirst({ where: and(eq(users.empresaId, empresa.id), eq(users.role, 'admin')) })
  if (!admin) throw new Error('Admin não encontrado')

  console.log(`Cliente: ${cliente.razaoSocial} (${cliente.codigo}) — dono atual: ${cliente.vendedorAtual?.name ?? 'sem vendedor'}`)

  if (cliente.vendedorAtualId === yasmin.id) {
    console.log('Já está com a Yasmin Salles, nada a fazer.')
  } else {
    await transferirCliente(cliente.id, yasmin.id, admin.id)
    console.log(`✅ Transferido para Yasmin Salles.`)
  }
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
