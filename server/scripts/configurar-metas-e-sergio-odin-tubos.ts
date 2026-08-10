// Script avulso — Odin Tubos e Conexões, pedido do João (mensagem de
// 10/08/2026):
// 1. Cria o acesso da Sergio Leandro Gratao como vendedor (ele já tinha 186
//    clientes parados no Banco de Clientes sob esse nome — vira carteira
//    de verdade agora, com card do mês no Kanban via transferirCliente).
// 2. Define a meta de faturamento do mês corrente por vendedor: Luana,
//    Yasmin Ramos, Karinna e Yasmin Salles = 170k; Ricardo e Iris = 30k;
//    Sergio = 170k.
// 3. Define a meta geral da empresa (mês corrente) = 1.245.000.
import { and, eq, isNull } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '../src/db/client.js'
import { clientes, empresas, metasMensais, users } from '../src/db/schema.js'
import { mesReferenciaAtual } from '../src/lib/dataBr.js'
import { setConfig } from '../src/lib/configuracoes.js'
import { transferirCliente } from '../src/router/carteira.js'

const METAS: Record<string, number> = {
  'LUANA APARECIDA': 170000,
  'YASMIN RAMOS': 170000,
  KARINNA: 170000,
  'YASMIN SALLES': 170000,
  RICARDO: 30000,
  IRIS: 30000,
  SERGIO: 170000, // nome curto — o cadastro dele usa "Sergio Leandro Gratao", comparado sem acento/maiúsculas mais abaixo
}

const META_GERAL_EMPRESA = 1245000

function gerarSenhaTemporaria(): string {
  return `Odin${Math.random().toString(36).slice(2, 8)}9x`
}

async function definirMeta(vendedorId: number, mesAtual: string, metaFaturamento: number) {
  const existente = await db.query.metasMensais.findFirst({
    where: and(eq(metasMensais.vendedorId, vendedorId), eq(metasMensais.mesReferencia, mesAtual)),
  })
  if (existente) {
    await db.update(metasMensais).set({ metaFaturamento }).where(eq(metasMensais.id, existente.id))
  } else {
    await db.insert(metasMensais).values({ vendedorId, mesReferencia: mesAtual, metaFaturamento })
  }
}

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-tubos') })
  if (!empresa) throw new Error('Empresa Odin Tubos e Conexões não encontrada')

  const admin = await db.query.users.findFirst({ where: and(eq(users.empresaId, empresa.id), eq(users.role, 'admin')) })
  if (!admin) throw new Error('Admin não encontrado')

  const mesAtual = mesReferenciaAtual()

  // 1. Cria o Sergio, se ainda não existir.
  const vendedoresAtuais = await db.query.users.findMany({ where: and(eq(users.role, 'vendor'), eq(users.empresaId, empresa.id)) })
  let sergio = vendedoresAtuais.find((v) => v.name.trim().toUpperCase().startsWith('SERGIO'))

  let senhaTemporaria: string | undefined
  let clientesMovidos = 0

  if (!sergio) {
    // "sergio" já existe globalmente (mesma pessoa tem login na Joitec
    // Distribuidora, empresa diferente) — username é único entre empresas,
    // por isso o sufixo aqui.
    const username = 'sergio.tubos'
    const usernameExistente = await db.query.users.findFirst({ where: eq(users.username, username) })
    if (usernameExistente) throw new Error(`Username "${username}" já existe (id ${usernameExistente.id}) — escolher outro`)

    senhaTemporaria = gerarSenhaTemporaria()
    const hash = await bcrypt.hash(senhaTemporaria, 12)
    const result = await db.insert(users).values({
      empresaId: empresa.id,
      name: 'Sergio Leandro Gratao',
      username,
      passwordHash: hash,
      role: 'vendor',
      senhaTrocarNoLogin: true,
    })
    const sergioId = Number(result.lastInsertRowid)
    sergio = await db.query.users.findFirst({ where: eq(users.id, sergioId) })
    console.log(`✅ Vendedor Sergio criado (id ${sergioId}, username "${username}")`)

    // 2. Traz pra carteira dele os clientes que já estavam no Banco de
    // Clientes sob o rótulo "Sergio Leandro Gratao" (mesmo texto usado na
    // importação original que os deixou sem vendedor de verdade).
    const clientesNoBanco = await db.query.clientes.findMany({
      where: and(eq(clientes.empresaId, empresa.id), isNull(clientes.vendedorAtualId), isNull(clientes.deletedAt), eq(clientes.origemBanco, 'Sergio Leandro Gratao')),
      columns: { id: true },
    })
    for (const c of clientesNoBanco) {
      await transferirCliente(c.id, sergioId, admin.id)
      clientesMovidos++
    }
  } else {
    console.log(`Sergio já existia (id ${sergio.id}) — não recriei, só ajusto a meta.`)
  }

  // 3. Metas por vendedor.
  const vendedores = await db.query.users.findMany({ where: and(eq(users.role, 'vendor'), eq(users.empresaId, empresa.id)) })
  const metasAplicadas: string[] = []
  const metasNaoEncontradas: string[] = []

  for (const [nomeAlvo, valor] of Object.entries(METAS)) {
    // Match exato por padrão (evita "Yasmin Ramos" x "Yasmin Salles" se
    // colidirem num prefixo) — só o Sergio usa prefixo, porque o cadastro
    // dele tem nome completo ("Sergio Leandro Gratao") e aqui a chave é só
    // o primeiro nome.
    const vendedor =
      vendedores.find((v) => v.name.trim().toUpperCase() === nomeAlvo) ??
      (nomeAlvo === 'SERGIO' ? vendedores.find((v) => v.name.trim().toUpperCase().startsWith('SERGIO')) : undefined)
    if (!vendedor) {
      metasNaoEncontradas.push(nomeAlvo)
      continue
    }
    await definirMeta(vendedor.id, mesAtual, valor)
    metasAplicadas.push(`${vendedor.name}: R$ ${valor.toLocaleString('pt-BR')}`)
  }

  // 4. Meta geral da empresa.
  await setConfig(`meta_faturamento_empresa_${empresa.id}`, META_GERAL_EMPRESA)

  console.log('\n📊 Resumo:')
  if (senhaTemporaria) {
    console.log(`  Sergio — usuário: sergio.tubos / senha temporária: ${senhaTemporaria} (obrigado a trocar no 1º login)`)
    console.log(`  Clientes movidos do Banco pra carteira do Sergio: ${clientesMovidos}`)
  }
  console.log(`  Meta geral da empresa (${mesAtual}): R$ ${META_GERAL_EMPRESA.toLocaleString('pt-BR')}`)
  console.log(`  Metas por vendedor aplicadas (${metasAplicadas.length}):`)
  for (const item of metasAplicadas) console.log('   -', item)
  if (metasNaoEncontradas.length) {
    console.log(`  Nomes não encontrados como vendedor (${metasNaoEncontradas.length}):`)
    for (const item of metasNaoEncontradas) console.log('   -', item)
  }
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
