// Limpeza única da carteira da Compretec Loja Física (pedido do João,
// 2026-11-11): "retirar das carteiras de ambos os vendedores clientes parados
// sem registro de contato e sem compras, deixando apenas os que já compraram
// e possuem algum contato".
//
// Separa cada cliente da carteira em 4 grupos:
//   A) comprou e tem contato      → FICA sempre
//   B) comprou, mas sem contato
//   C) tem contato, mas nunca comprou
//   D) sem compra e sem contato   → parado de verdade
//
// "Retirar" = volta pro Banco de Clientes (mesma função do botão "Mover pro
// banco"), com o rótulo abaixo — dá pra devolver pra um vendedor depois.
// Nada é apagado.
//
//   node dist/scripts/carteiraLojaParados.js                → só PRÉVIA
//   node dist/scripts/carteiraLojaParados.js --tirar-parados → tira só o D
//   node dist/scripts/carteiraLojaParados.js --tirar-todos   → tira B + C + D (fica só o A)

import { config } from 'dotenv'
config()

import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, users } from '../db/schema.js'
import { moverClienteParaBanco } from '../router/carteira.js'
import { ehClienteBalcao } from '../lib/consumidorFinalBalcao.js'

const ROTULO = 'Retirados da carteira (parados) - 11/11/2026'
const tirarParados = process.argv.includes('--tirar-parados')
const tirarTodos = process.argv.includes('--tirar-todos')

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'compretec-loja-fisica') })
  if (!empresa) throw new Error('Empresa Compretec Loja Física não encontrada')
  const admin = await db.query.users.findFirst({ where: and(eq(users.superAdmin, true)), columns: { id: true } })
  if (!admin) throw new Error('superAdmin não encontrado')

  const lista = await db
    .select({
      id: clientes.id,
      razaoSocial: clientes.razaoSocial,
      codigo: clientes.codigo,
      vendedorId: clientes.vendedorAtualId,
      vendedor: users.name,
      dataUltimaCompra: clientes.dataUltimaCompra,
      vendas: sql<number>`(select count(*) from vendas v where v.cliente_id = ${clientes.id} and v.deleted_at is null)`.mapWith(Number),
      contatos: sql<number>`(select count(*) from registro_contato r join funil_mensal f on f.id = r.funil_mensal_id where f.cliente_id = ${clientes.id} and r.deleted_at is null)`.mapWith(Number),
    })
    .from(clientes)
    .innerJoin(users, eq(users.id, clientes.vendedorAtualId))
    .where(
      and(
        eq(clientes.empresaId, empresa.id),
        isNotNull(clientes.vendedorAtualId),
        isNull(clientes.deletedAt),
        eq(clientes.emProspeccao, false)
      )
    )

  type G = 'A' | 'B' | 'C' | 'D'
  const grupo = (c: (typeof lista)[number]): G => {
    const comprou = c.vendas > 0 || !!c.dataUltimaCompra
    const contato = c.contatos > 0
    return comprou && contato ? 'A' : comprou ? 'B' : contato ? 'C' : 'D'
  }
  const NOME: Record<G, string> = {
    A: 'A) comprou e tem contato (FICA)',
    B: 'B) comprou, mas sem contato',
    C: 'C) tem contato, mas nunca comprou',
    D: 'D) sem compra e sem contato (parado)',
  }

  const carteira = lista.filter((c) => !ehClienteBalcao(c.codigo))
  console.log(`Compretec Loja Física — ${carteira.length} clientes na carteira dos vendedores\n`)
  const vendedores = [...new Set(carteira.map((c) => c.vendedor))]
  for (const v of vendedores) {
    const dele = carteira.filter((c) => c.vendedor === v)
    const n = (g: G) => dele.filter((c) => grupo(c) === g).length
    console.log(`${v}: ${dele.length} clientes → A ${n('A')} · B ${n('B')} · C ${n('C')} · D ${n('D')}`)
  }
  console.log('')
  for (const g of ['A', 'B', 'C', 'D'] as G[]) {
    const doGrupo = carteira.filter((c) => grupo(c) === g)
    console.log(`${NOME[g]}: ${doGrupo.length}`)
    for (const c of doGrupo.slice(0, 8)) console.log(`    ${c.razaoSocial.slice(0, 40)} (${c.vendedor}) vendas=${c.vendas} contatos=${c.contatos}`)
    if (doGrupo.length > 8) console.log(`    ... e mais ${doGrupo.length - 8}`)
  }

  const alvo = tirarTodos ? carteira.filter((c) => grupo(c) !== 'A') : tirarParados ? carteira.filter((c) => grupo(c) === 'D') : []
  if (!tirarTodos && !tirarParados) {
    console.log('\nPRÉVIA — nada foi alterado.')
    return
  }
  console.log(`\nTirando ${alvo.length} clientes da carteira → Banco de Clientes "${ROTULO}"...`)
  for (const c of alvo) await moverClienteParaBanco(c.id, ROTULO, admin.id)
  console.log('Pronto.')
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
