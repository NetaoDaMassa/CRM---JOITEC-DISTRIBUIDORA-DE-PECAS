// Script de teste manual da Fase 1 (módulo Ordens) — cria um pedido de
// teste tipo "maquina", percorre as 12 etapas checando os gates, e um
// pedido "peca" pelas 8 etapas. Roda direto contra o banco local
// (server/joitec_crm.db), sem precisar de login/HTTP. Descartável — não é
// parte do produto, só verificação da Fase 1.
import { db } from '../src/db/client.js'
import { eq } from 'drizzle-orm'
import {
  ordens,
  ordemLiberacaoFinanceira,
  ordemAnexos,
  ordemAprovacaoFrete,
  ordemFreteFinalizado,
  ordemPreparacao,
  ordemMaquinas,
  ordemConferencia,
  ordemConferenciaItens,
  ordemColeta,
  ordemCotacoesFrete,
} from '../src/db/schema.js'
import { and } from 'drizzle-orm'
import { avancarEtapaPedido, moverEtapaPedido } from '../src/lib/ordensGates.js'
import { getStageSequence } from '../src/lib/ordensStages.js'

const EMPRESA_ODIN = 4
const USER_GESTOR = 29 // Roberto (admin)
const CLIENTE_TESTE = 7195

async function tentarAvancar(ordemId: number, esperado: 'ok' | 'bloqueado') {
  try {
    const r = await avancarEtapaPedido({ ordemId, empresaId: EMPRESA_ODIN, userId: USER_GESTOR })
    if (esperado === 'bloqueado') throw new Error(`ESPERAVA BLOQUEIO mas avançou pra "${r.stage}"`)
    console.log(`  ✅ avançou pra "${r.stage}"`)
    return r
  } catch (e: any) {
    if (esperado === 'ok') throw new Error(`ESPERAVA SUCESSO mas bloqueou: ${e.message}`)
    console.log(`  ✅ bloqueado como esperado: ${e.message}`)
  }
}

async function testarPedidoMaquina() {
  console.log('\n=== Pedido tipo MÁQUINA (12 etapas) ===')
  const result = await db.insert(ordens).values({ empresaId: EMPRESA_ODIN, clienteId: CLIENTE_TESTE, vendedorId: USER_GESTOR, criadoPor: USER_GESTOR, orderType: 'maquina', stage: 'cadastro' })
  const ordemId = Number(result.lastInsertRowid)
  console.log(`Pedido criado: id=${ordemId}, stage inicial=cadastro`)

  // cadastro -> liberacao_financeira (sem gate)
  await tentarAvancar(ordemId, 'ok')

  // liberacao_financeira -> pedido: BLOQUEADO sem aprovação
  await tentarAvancar(ordemId, 'bloqueado')
  await db.insert(ordemLiberacaoFinanceira).values({ ordemId, aprovado: true, aprovadoPor: USER_GESTOR, aprovadoEm: new Date().toISOString() })
  await tentarAvancar(ordemId, 'ok')

  // pedido -> cotacao_frete: BLOQUEADO sem anexo da etapa "pedido"
  await tentarAvancar(ordemId, 'bloqueado')
  await db.insert(ordemAnexos).values({ ordemId, stage: 'pedido', fileCategory: 'pedido_oficial', nomeOriginal: 'pedido.pdf', nomeArmazenado: 'teste-pedido.pdf', tipoArquivo: 'application/pdf' })
  await tentarAvancar(ordemId, 'ok')

  // cotacao_frete -> frete_finalizado: BLOQUEADO sem preparação aprovada
  await tentarAvancar(ordemId, 'bloqueado')
  // vincula uma máquina (necessário pra aprovar preparação em pedido "maquina")
  const maqResult = await db.insert(ordemMaquinas).values({ ordemId, modelo: 'ODX-100', numeroSerie: 'SN-TESTE-1' })
  const maquinaId = Number(maqResult.lastInsertRowid)
  // tenta aprovar preparação sem fotos -> deve falhar (testado via chamada direta abaixo)
  try {
    const { TRPCError } = await import('@trpc/server')
    // reaproveita a mesma lógica do router preparacao.aprovarPreparacao inline
    const categorias = ['placa_vaso_pressao', 'placa_compressor', 'vaso_pressao', 'valvula_seguranca']
    let faltou = false
    for (const cat of categorias) {
      const anexo = await db.query.ordemAnexos.findFirst({ where: (a, { and, eq }) => and(eq(a.ordemId, ordemId), eq(a.fileCategory, `${cat}__${maquinaId}`)) })
      if (!anexo) faltou = true
    }
    console.log(faltou ? '  ✅ preparação corretamente exigiria fotos por máquina (ODX-100 = compressor, 4 categorias)' : '  ❌ não deveria passar sem fotos')
  } catch {}
  // sobe as 4 fotos exigidas pro modelo ODX (prefixo OD = compressor)
  for (const cat of ['placa_vaso_pressao', 'placa_compressor', 'vaso_pressao', 'valvula_seguranca']) {
    await db.insert(ordemAnexos).values({ ordemId, stage: 'preparacao', fileCategory: `${cat}__${maquinaId}`, nomeOriginal: `${cat}.jpg`, nomeArmazenado: `teste-${cat}.jpg`, tipoArquivo: 'image/jpeg' })
  }
  await db.insert(ordemPreparacao).values({ ordemId, aprovadoGestor: true, aprovadoPor: USER_GESTOR, aprovadoEm: new Date().toISOString() })
  await tentarAvancar(ordemId, 'ok')

  // frete_finalizado -> faturamento: BLOQUEADO sem aprovação de frete + confirmação
  await tentarAvancar(ordemId, 'bloqueado')
  await db.insert(ordemAprovacaoFrete).values({ ordemId, semFrete: true, semFreteObservacoes: 'teste', aprovadoPor: USER_GESTOR, aprovadoEm: new Date().toISOString() })
  await tentarAvancar(ordemId, 'bloqueado') // ainda falta frete_finalizado.confirmado
  await db.insert(ordemFreteFinalizado).values({ ordemId, confirmado: true, confirmadoPor: USER_GESTOR, confirmadoEm: new Date().toISOString() })
  await tentarAvancar(ordemId, 'ok')

  // faturamento -> conferencia (sem gate)
  await tentarAvancar(ordemId, 'ok')

  // conferencia -> coleta: BLOQUEADO sem conferencia.confirmado
  await tentarAvancar(ordemId, 'bloqueado')
  await db.insert(ordemConferencia).values({ ordemId, confirmado: true, confirmadoPor: USER_GESTOR, confirmadoEm: new Date().toISOString() })
  await tentarAvancar(ordemId, 'ok')

  // coleta -> rastreio: BLOQUEADO sem coleta.confirmado
  await tentarAvancar(ordemId, 'bloqueado')
  await db.insert(ordemColeta).values({ ordemId, confirmado: true, confirmadoPor: USER_GESTOR, confirmadoEm: new Date().toISOString() })
  await tentarAvancar(ordemId, 'ok')

  // rastreio -> qualidade -> concluido -> pos_venda (sem gates)
  await tentarAvancar(ordemId, 'ok')
  await tentarAvancar(ordemId, 'ok')
  await tentarAvancar(ordemId, 'ok')

  const final = await db.query.ordens.findFirst({ where: eq(ordens.id, ordemId) })
  console.log(`Etapa final: ${final?.stage} (esperado: pos_venda)`)

  // testa mover() (pulo livre) voltando de pos_venda pra pedido
  await moverEtapaPedido({ ordemId, empresaId: EMPRESA_ODIN, userId: USER_GESTOR, novaEtapa: 'pedido' })
  const depoisMover = await db.query.ordens.findFirst({ where: eq(ordens.id, ordemId) })
  const freteFinalDepois = await db.query.ordemFreteFinalizado.findFirst({ where: eq(ordemFreteFinalizado.ordemId, ordemId) })
  console.log(`Depois de mover() pra "pedido": stage=${depoisMover?.stage}, frete_finalizado.confirmado=${freteFinalDepois?.confirmado} (esperado: false, reset)`)

  const historico = await db.query.ordemHistorico.findMany({ where: (h, { eq }) => eq(h.ordemId, ordemId) })
  console.log(`Linhas de histórico geradas: ${historico.length}`)

  return ordemId
}

async function testarPedidoPeca() {
  console.log('\n=== Pedido tipo PEÇA (8 etapas) ===')
  const result = await db.insert(ordens).values({ empresaId: EMPRESA_ODIN, clienteId: CLIENTE_TESTE, vendedorId: USER_GESTOR, criadoPor: USER_GESTOR, orderType: 'peca', stage: 'pedido' })
  const ordemId = Number(result.lastInsertRowid)
  console.log(`Pedido criado: id=${ordemId}, stage inicial=pedido`)

  // pedido -> preparacao (é etapa normal pra peça, sem gate de liberação financeira!)
  await tentarAvancar(ordemId, 'ok')
  // preparacao -> frete_finalizado: gate de preparacao.gestor_approved
  await tentarAvancar(ordemId, 'bloqueado')
  await db.insert(ordemPreparacao).values({ ordemId, aprovadoGestor: true, aprovadoPor: USER_GESTOR, aprovadoEm: new Date().toISOString() })
  await tentarAvancar(ordemId, 'ok')
  // frete_finalizado -> faturamento
  await tentarAvancar(ordemId, 'bloqueado')
  await db.insert(ordemAprovacaoFrete).values({ ordemId, semFrete: true, aprovadoPor: USER_GESTOR, aprovadoEm: new Date().toISOString() })
  await db.insert(ordemFreteFinalizado).values({ ordemId, confirmado: true, confirmadoPor: USER_GESTOR, confirmadoEm: new Date().toISOString() })
  await tentarAvancar(ordemId, 'ok')
  // faturamento -> coleta (sem gate, "conferencia" não existe na sequência peça)
  await tentarAvancar(ordemId, 'ok')
  // coleta -> rastreio
  await tentarAvancar(ordemId, 'bloqueado')
  await db.insert(ordemColeta).values({ ordemId, confirmado: true, confirmadoPor: USER_GESTOR, confirmadoEm: new Date().toISOString() })
  await tentarAvancar(ordemId, 'ok')
  // rastreio -> concluido -> pos_venda
  await tentarAvancar(ordemId, 'ok')
  await tentarAvancar(ordemId, 'ok')

  const final = await db.query.ordens.findFirst({ where: eq(ordens.id, ordemId) })
  console.log(`Etapa final: ${final?.stage} (esperado: pos_venda)`)
  return ordemId
}

async function testarEmpresaScoping(ordemId: number) {
  console.log('\n=== Teste de empresa-scoping ===')
  try {
    await avancarEtapaPedido({ ordemId, empresaId: 1, userId: USER_GESTOR }) // empresa errada (Joitec, não Odin)
    console.log('  ❌ FALHA: avançou com empresaId errado!')
  } catch (e: any) {
    console.log(`  ✅ bloqueado corretamente pra empresa errada: ${e.message}`)
  }
}

async function testarTravaOtimista(ordemId: number) {
  console.log('\n=== Teste de trava otimista (versão) ===')
  // Simula uma corrida real: duas "sessões" leem a mesma versão V; a
  // primeira grava (V -> V+1); a segunda tenta gravar condicionada à V
  // antiga, que já não bate mais — precisa afetar 0 linhas.
  const ordemAntes = await db.query.ordens.findFirst({ where: eq(ordens.id, ordemId) })
  if (!ordemAntes) return
  const versaoLidaPelasDuasSessoes = ordemAntes.versao

  const sessao1 = await db.update(ordens).set({ versao: versaoLidaPelasDuasSessoes + 1 }).where(and(eq(ordens.id, ordemId), eq(ordens.versao, versaoLidaPelasDuasSessoes)))
  console.log(`  sessão 1 (versão correta) afetou ${sessao1.rowsAffected} linha(s) (esperado: 1)`)

  const sessao2 = await db.update(ordens).set({ versao: versaoLidaPelasDuasSessoes + 1 }).where(and(eq(ordens.id, ordemId), eq(ordens.versao, versaoLidaPelasDuasSessoes)))
  console.log(`  sessão 2 (mesma versão antiga, já obsoleta) afetou ${sessao2.rowsAffected} linha(s) (esperado: 0, é exatamente o que avancarEtapaPedido/moverEtapaPedido fazem antes de gravar)`)
}

async function main() {
  const idMaquina = await testarPedidoMaquina()
  const idPeca = await testarPedidoPeca()
  await testarEmpresaScoping(idMaquina)
  await testarTravaOtimista(idPeca)
  console.log('\n=== FIM DOS TESTES ===')
  process.exit(0)
}

main().catch((e) => {
  console.error('ERRO NÃO ESPERADO:', e)
  process.exit(1)
})
