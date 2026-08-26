// Script de teste manual do módulo de Propostas — descartável, só verificação.
import { db } from '../src/db/client.js'
import { eq } from 'drizzle-orm'
import { propostas, propostaArquivos, ordens, ordemLiberacaoFinanceira, clientes } from '../src/db/schema.js'
import { mudarEtapaProposta } from '../src/lib/propostasGates.js'

const EMPRESA_ODIN = 4
const USER_GESTOR = 29
const CLIENTE_TESTE = 7195

async function main() {
  console.log('=== Criar proposta ===')
  const result = await db.insert(propostas).values({ empresaId: EMPRESA_ODIN, vendedorId: USER_GESTOR, clienteNome: 'Cliente Teste Proposta', produtosDescricao: 'Compressor OD-100' })
  const propostaId = Number(result.lastInsertRowid)
  console.log(`Proposta criada: id=${propostaId}, stage inicial=proposta`)

  console.log('=== Tentar ir pra negociação sem PDF (deve bloquear) ===')
  try {
    await mudarEtapaProposta({ propostaId, empresaId: EMPRESA_ODIN, userId: USER_GESTOR, novaEtapa: 'negociacao' })
    console.log('  ❌ FALHA: deveria ter bloqueado')
  } catch (e: any) {
    console.log(`  ✅ bloqueado: ${e.message}`)
  }

  console.log('=== Anexar PDF e avançar ===')
  await db.insert(propostaArquivos).values({ propostaId, fileCategory: 'proposta_pdf', nomeOriginal: 'proposta.pdf', nomeArmazenado: 'teste.pdf', tipoArquivo: 'application/pdf' })
  await mudarEtapaProposta({ propostaId, empresaId: EMPRESA_ODIN, userId: USER_GESTOR, novaEtapa: 'negociacao' })
  let p = await db.query.propostas.findFirst({ where: eq(propostas.id, propostaId) })
  console.log(`  stage agora: ${p?.stage} (esperado: negociacao)`)

  await mudarEtapaProposta({ propostaId, empresaId: EMPRESA_ODIN, userId: USER_GESTOR, novaEtapa: 'fechado' })
  p = await db.query.propostas.findFirst({ where: eq(propostas.id, propostaId) })
  console.log(`  stage agora: ${p?.stage} (esperado: fechado)`)

  console.log('=== Converter em pedido ===')
  const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, CLIENTE_TESTE) })
  if (!cliente) throw new Error('cliente de teste não encontrado')

  const partes: string[] = []
  if (p!.produtosDescricao) partes.push(`Produto/Serviço: ${p!.produtosDescricao}`)
  const ordemResult = await db.insert(ordens).values({ empresaId: EMPRESA_ODIN, clienteId: CLIENTE_TESTE, vendedorId: p!.vendedorId, criadoPor: p!.vendedorId, orderType: 'maquina', stage: 'liberacao_financeira' })
  const ordemId = Number(ordemResult.lastInsertRowid)
  await db.insert(ordemLiberacaoFinanceira).values({ ordemId, observacoes: partes.join('\n') })
  await db.update(propostas).set({ convertidoParaOrdemId: ordemId, stage: 'convertido' }).where(eq(propostas.id, propostaId))

  const ordemCriada = await db.query.ordens.findFirst({ where: eq(ordens.id, ordemId) })
  const libCriada = await db.query.ordemLiberacaoFinanceira.findFirst({ where: eq(ordemLiberacaoFinanceira.ordemId, ordemId) })
  console.log(`  Pedido criado: id=${ordemCriada?.id}, stage=${ordemCriada?.stage} (esperado: liberacao_financeira)`)
  console.log(`  Observações pré-populadas: "${libCriada?.observacoes}"`)

  console.log('=== Testar "chamar depois" sem data (deve bloquear) ===')
  const result2 = await db.insert(propostas).values({ empresaId: EMPRESA_ODIN, vendedorId: USER_GESTOR, clienteNome: 'Cliente Teste 2' })
  const propostaId2 = Number(result2.lastInsertRowid)
  try {
    await mudarEtapaProposta({ propostaId: propostaId2, empresaId: EMPRESA_ODIN, userId: USER_GESTOR, novaEtapa: 'chamar_depois' })
    console.log('  ❌ FALHA: deveria ter bloqueado')
  } catch (e: any) {
    console.log(`  ✅ bloqueado: ${e.message}`)
  }

  console.log('\n=== FIM ===')
  process.exit(0)
}

main().catch((e) => {
  console.error('ERRO:', e)
  process.exit(1)
})
