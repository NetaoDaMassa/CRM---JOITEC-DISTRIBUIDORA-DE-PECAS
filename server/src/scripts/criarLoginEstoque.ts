// Login geral do estoque (pedido do João, 2026-11-02: "1 login só" pro
// pessoal do estoque). O usuário é único no sistema todo e cada login é de
// uma empresa, então são 3 contas ligadas (contas_vinculadas): entra com
// `estoque` (Joitec) e troca pra Odin Tubos / Odin Automação sem senha.
// Admin sem permissão nenhuma além de Controle do Estoque e do painel de TV
// do estoque — só vê a Expedição. Quem é admin de verdade (descartar,
// finalizar, cancelar) é o André, criado à parte pelo João.
//
//   ESTOQUE_SENHA='...' node dist/scripts/criarLoginEstoque.js
// Rodar de novo só acerta permissões/ligações (e a senha, se mandar).
import bcrypt from 'bcryptjs'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { contasVinculadas, empresas, permissoesAdmin, users } from '../db/schema.js'

const CONTAS = [
  { slug: 'joitec', username: 'estoque' },
  { slug: 'odin-tubos', username: 'estoque.tubos' },
  { slug: 'joitec-automacao', username: 'estoque.automacao' },
]
const FEATURES = ['controle_estoque', 'painel_logistica']

async function main() {
  const senha = process.env.ESTOQUE_SENHA
  const lista = await db.query.empresas.findMany({ where: inArray(empresas.slug, CONTAS.map((c) => c.slug)) })
  const ids: number[] = []
  for (const c of CONTAS) {
    const empresa = lista.find((e) => e.slug === c.slug)
    if (!empresa) throw new Error(`Empresa ${c.slug} não encontrada`)
    let u = await db.query.users.findFirst({ where: eq(users.username, c.username) })
    if (!u) {
      if (!senha || senha.length < 6) throw new Error('Defina ESTOQUE_SENHA (mínimo 6 caracteres) para criar o login')
      const r = await db.insert(users).values({
        empresaId: empresa.id,
        name: 'Estoque',
        username: c.username,
        passwordHash: await bcrypt.hash(senha, 12),
        role: 'admin',
        senhaTrocarNoLogin: false,
        ocultoPainelTv: true,
      })
      u = (await db.query.users.findFirst({ where: eq(users.id, Number(r.lastInsertRowid)) }))!
      console.log(`criado: ${c.username} (${empresa.nome})`)
    } else {
      if (u.empresaId !== empresa.id) throw new Error(`O usuário ${c.username} já existe em outra empresa — confira antes`)
      if (senha) await db.update(users).set({ passwordHash: await bcrypt.hash(senha, 12), isActive: true }).where(eq(users.id, u.id))
      console.log(`já existia: ${c.username} (${empresa.nome})${senha ? ' — senha atualizada' : ''}`)
    }
    for (const f of FEATURES) await db.insert(permissoesAdmin).values({ userId: u.id, feature: f }).onConflictDoNothing()
    ids.push(u.id)
  }
  for (const a of ids)
    for (const b of ids) {
      if (a === b) continue
      const ja = await db.query.contasVinculadas.findFirst({ where: and(eq(contasVinculadas.userId, a), eq(contasVinculadas.contaVinculadaId, b)) })
      if (!ja) await db.insert(contasVinculadas).values({ userId: a, contaVinculadaId: b })
    }
  console.log(`ok — permissões: ${FEATURES.join(', ')}; contas ligadas entre si`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERRO:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
