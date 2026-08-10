import { db } from '../db/client.js'
import { clientes, empresas, users } from '../db/schema.js'
import { and, eq, isNull, like, or } from 'drizzle-orm'

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'joitec') })
  if (!empresa) throw new Error('Empresa Joitec não encontrada')

  const cliente7643 = await db.query.clientes.findFirst({
    where: eq(clientes.id, 7643),
    columns: { id: true, razaoSocial: true, telefoneWhatsapp: true, vendedorAtualId: true },
    with: { telefonesExtras: { columns: { numero: true } } },
  })
  console.log('📌 Cliente id 7643 (o que bateu com +5547997823085):')
  console.log(cliente7643)

  const buscaNumero = await db.query.clientes.findMany({
    where: and(
      eq(clientes.empresaId, empresa.id),
      isNull(clientes.deletedAt),
      or(like(clientes.telefoneWhatsapp, '%997008385%'), like(clientes.telefoneWhatsapp, '%997823085%'))
    ),
    columns: { id: true, razaoSocial: true, telefoneWhatsapp: true, vendedorAtualId: true },
  })
  console.log(`\n🔎 Clientes com telefoneWhatsapp contendo "997008385" ou "997823085" (${buscaNumero.length}):`)
  for (const c of buscaNumero) console.log(c)

  if (cliente7643?.vendedorAtualId) {
    const vendedor = await db.query.users.findFirst({ where: eq(users.id, cliente7643.vendedorAtualId), columns: { name: true, username: true } })
    console.log('\n👤 Vendedor do cliente 7643:', vendedor)
  }

  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
