import { db } from '../db/client.js'
import { clientes, empresas } from '../db/schema.js'
import { and, eq, isNull, like } from 'drizzle-orm'

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'joitec') })
  if (!empresa) throw new Error('Empresa Joitec não encontrada')

  const encontrados = await db.query.clientes.findMany({
    where: and(eq(clientes.empresaId, empresa.id), isNull(clientes.deletedAt), like(clientes.razaoSocial, '%eto%')),
    columns: { id: true, razaoSocial: true, telefoneWhatsapp: true, vendedorAtualId: true },
    with: { telefonesExtras: { columns: { numero: true } } },
  })
  console.log(`🔎 Clientes da Joitec com "eto" no nome (${encontrados.length}):\n`)
  for (const c of encontrados) {
    console.log(
      `id ${c.id} — "${c.razaoSocial}" — telefoneWhatsapp: ${c.telefoneWhatsapp ?? '-'} — vendedorAtualId: ${c.vendedorAtualId ?? '-'} — extras: ${c.telefonesExtras.map((t: { numero: string }) => t.numero).join(', ') || '-'}`
    )
  }

  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
