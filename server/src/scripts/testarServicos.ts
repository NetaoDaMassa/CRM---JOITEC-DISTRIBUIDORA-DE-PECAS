// Teste do Controle de serviços (Compretec Loja Física).
// Uso: DESLIGAR_AGENDADOR=1 DATABASE_URL=file:./teste_serv.db npx tsx src/scripts/testarServicos.ts
import path from 'path'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users, clientes, compromissos, vendas, funilMensal, empresas, servicos, leads, itensPedido } from '../db/schema.js'
import { appRouter } from '../router/index.js'
import { prazoUmDiaUtil } from '../lib/servicos.js'
import { hojeBrString, mesReferenciaAtual } from '../lib/dataBr.js'

if (!String(process.env.DATABASE_URL).includes('teste')) throw new Error('Rode só contra uma cópia')
await migrate(db, { migrationsFolder: path.resolve('drizzle') })
let falhas = 0
const ok = (c: unknown, nome: string) => {
  console.log(`${c ? '✅' : '❌'} ${nome}`)
  if (!c) falhas++
}
const erro = async (fn: () => Promise<unknown>, nome: string, trecho?: RegExp) => {
  try {
    await fn()
    ok(false, nome)
  } catch (e) {
    const msg = (e as Error).message
    ok(!trecho || trecho.test(msg), `${nome} (${msg})`)
  }
}
const emp = (await db.query.empresas.findFirst({ where: eq(empresas.slug, 'compretec-loja-fisica') }))!
const stamp = Date.now()
const novoUser = async (nome: string, role: 'vendor' | 'admin' = 'vendor') =>
  Number((await db.insert(users).values({ empresaId: emp.id, name: nome, username: `sv_${nome}_${stamp}`, passwordHash: 'x', role })).lastInsertRowid)
const v1 = await novoUser('thiago'),
  v2 = await novoUser('marcos'),
  gestor = await novoUser('flavio', 'admin')
const caller = (id: number, role = 'vendor', empresaId = emp.id) =>
  appRouter.createCaller({ user: { id, username: 'x', name: 'x', role, empresaId, superAdmin: false }, empresaId } as any)
const hoje = hojeBrString()
const amanha = new Date(Date.now() + 86400000 - 3 * 3600000).toISOString().slice(0, 10)

// Prazo de 1 dia útil: sexta → segunda; véspera de feriado pula o feriado.
ok(prazoUmDiaUtil(new Date('2026-11-27T13:00:00Z')) === '2026-11-30 13:00:00', 'prazo: sexta 10h → segunda 10h')
ok(prazoUmDiaUtil(new Date('2026-12-24T13:00:00Z')) === '2026-12-28 13:00:00', 'prazo: 24/12 → pula Natal e fim de semana')

const c1 = Number((await db.insert(clientes).values({ empresaId: emp.id, razaoSocial: `Madeireira Teste ${stamp}`, codigo: `T${stamp}`, regiao: 'sul', vendedorAtualId: v1, telefoneWhatsapp: '47999990001' })).lastInsertRowid)
const cf = Number((await db.insert(clientes).values({ empresaId: emp.id, razaoSocial: 'CONSUMIDOR FINAL TESTE SV', codigo: `CF${stamp}`, regiao: 'sul', vendedorAtualId: v1 })).lastInsertRowid)
const prospect = Number(
  (await db.insert(clientes).values({ empresaId: emp.id, razaoSocial: `Funilaria Prospect ${stamp}`, codigo: `P${stamp}`, regiao: 'sul', vendedorAtualId: v1, emProspeccao: true, prospeccaoEtapa: 'conversando', prospeccaoOrigem: 'manual' })).lastInsertRowid
)
const lead = Number((await db.insert(leads).values({ empresaId: emp.id, name: `Lead Rede Ar ${stamp}`, ddd: 47, phone: '988887777', vendorId: v1, status: 'em_negociacao', source: 'whatsapp' })).lastInsertRowid)

const t = caller(v1)
ok((await t.servicos.disponivel()).mostrar, 'tela liberada na Loja Física')
const joitec = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'joitec') })
ok(!(await caller(v1, 'vendor', joitec!.id).servicos.disponivel()).mostrar, 'não aparece nas outras empresas')

// Busca acha carteira, prospecção e lead
const busca = await t.servicos.buscarOrigem({ texto: String(stamp) })
ok(busca.some((b) => b.clienteId === c1 && b.origem === 'carteira'), 'busca: cliente da carteira')
ok(busca.some((b) => b.clienteId === prospect && b.origem === 'prospeccao'), 'busca: prospect')
ok(busca.some((b) => b.leadId === lead && b.origem === 'marketing'), 'busca: lead do marketing')
ok(!busca.some((b) => b.clienteId === cf), 'busca: não traz CONSUMIDOR FINAL')
ok(!(await caller(v2).servicos.buscarOrigem({ texto: String(stamp) })).length, 'busca: vendedor só vê os dele')

await erro(() => t.servicos.criar({ origem: 'carteira', clienteId: c1, manutencao: false, redeAr: false, instalacao: false }), 'precisa marcar o que vai fazer')
await erro(() => t.servicos.criar({ origem: 'carteira', clienteId: cf, manutencao: true, redeAr: false, instalacao: false }), 'bloqueia CONSUMIDOR FINAL')
await erro(() => caller(v2).servicos.criar({ origem: 'carteira', clienteId: c1, manutencao: true, redeAr: false, instalacao: false }), 'bloqueia cliente de outro vendedor')

// 1) Carteira: manutenção + instalação → orçamento → aguardando → finalizado
const s1 = await t.servicos.criar({ origem: 'carteira', clienteId: c1, manutencao: true, redeAr: false, instalacao: true, compressor: 'CSL 20BR', valorMaoObra: 600 })
let row = (await db.query.servicos.findFirst({ where: eq(servicos.id, s1.id) }))!
ok(row.status === 'montando_orcamento' && row.prazoOrcamento && row.vendedorId === v1, 'nasce em Montando orçamento com prazo de 1 dia útil')
let ag = await db.query.compromissos.findFirst({ where: eq(compromissos.id, row.compromissoId!) })
ok(ag && ag.dataHora === row.prazoOrcamento && ag.vendedorId === v1 && /Responder orçamento/.test(ag.titulo), 'prazo do orçamento vira compromisso na agenda')
// força atraso
await db.update(servicos).set({ prazoOrcamento: '2020-01-01 12:00:00' }).where(eq(servicos.id, s1.id))
let lista = await t.servicos.listar()
ok(lista.itens.find((i) => i.id === s1.id)?.orcamentoAtrasado && lista.resumo.orcamentosAtrasados >= 1, 'orçamento passou do prazo → marcado como atrasado')
ok(!(await caller(v2).servicos.listar()).itens.some((i) => i.id === s1.id), 'outro vendedor não vê')
ok((await caller(gestor, 'admin').servicos.listar()).itens.some((i) => i.id === s1.id), 'gestor vê todos')

await erro(() => t.servicos.mudarStatus({ id: s1.id, status: 'aguardando_cliente' }), 'aguardando cliente exige data do próximo contato', /próximo contato/)
await erro(() => t.servicos.mudarStatus({ id: s1.id, status: 'aguardando_cliente', proximoContato: '2020-01-01' }), 'data no passado não vale')
await t.servicos.mudarStatus({ id: s1.id, status: 'aguardando_cliente', proximoContato: amanha, observacao: 'Mandei o orçamento no WhatsApp' })
row = (await db.query.servicos.findFirst({ where: eq(servicos.id, s1.id) }))!
const agOrc = await db.query.compromissos.findFirst({ where: eq(compromissos.id, ag!.id) })
const agLig = await db.query.compromissos.findFirst({ where: eq(compromissos.id, row.compromissoId!) })
ok(row.orcamentoRespondidoEm && agOrc?.concluido, 'orçamento respondido: compromisso do prazo concluído')
ok(agLig && agLig.tipo === 'ligacao' && agLig.dataHora === `${amanha} 12:00:00` && !agLig.concluido, 'próximo contato vira ligação na agenda (9h)')
await t.servicos.registrarContato({ id: s1.id, texto: 'Cliente pediu mais uns dias', proximoContato: amanha })
await erro(() => t.servicos.registrarContato({ id: s1.id, texto: 'sem data' }), 'contato em aguardando cliente exige nova data')

await t.servicos.mudarStatus({ id: s1.id, status: 'em_andamento', dataExecucao: amanha })
await erro(() => t.servicos.mudarStatus({ id: s1.id, status: 'finalizado', condicaoPagamento: 'Pix' }), 'finalizado exige nº do pedido', /pedido/)
const vendasAntes = (await db.query.vendas.findMany({ where: eq(vendas.clienteId, c1) })).length
await t.servicos.mudarStatus({ id: s1.id, status: 'finalizado', condicaoPagamento: 'Pix', numeroPedido: 'OS-123', valorMaterial: 150 })
row = (await db.query.servicos.findFirst({ where: eq(servicos.id, s1.id) }))!
const venda = row.vendaId ? await db.query.vendas.findFirst({ where: eq(vendas.id, row.vendaId) }) : null
const card = row.funilMensalId ? await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, row.funilMensalId) }) : null
ok(venda && venda.valorFechado === 750 && venda.numeroPedido === 'OS-123' && venda.vendedorId === v1, `finalizado vira venda de R$ 750 (mão de obra + material)`)
ok(card && card.etapa === 'fechado' && card.mesReferencia === mesReferenciaAtual() && card.clienteId === c1, 'card do cliente vai pra Fechado na carteira')
ok((await db.query.vendas.findMany({ where: eq(vendas.clienteId, c1) })).length === vendasAntes + 1, 'uma venda só')
const itens = await db.query.itensPedido.findMany({ where: eq(itensPedido.vendaId, venda!.id) })
ok(itens.length === 2 && itens.some((i) => /Manutenção \+ Instalação/.test(i.descricao)), 'itens do pedido: mão de obra e material')
ok((await db.query.compromissos.findFirst({ where: eq(compromissos.id, agLig!.id) }))?.concluido === true, 'ligação pendente concluída ao finalizar')
await erro(() => t.servicos.mudarStatus({ id: s1.id, status: 'em_andamento' }), 'finalizado fica travado')
await erro(() => t.servicos.atualizar({ id: s1.id, manutencao: true, redeAr: false, instalacao: false }), 'finalizado não edita')

// 2) Segundo serviço finalizado no mesmo mês → soma venda no card já Fechado
const s1b = await t.servicos.criar({ origem: 'carteira', clienteId: c1, manutencao: true, redeAr: false, instalacao: false, valorMaoObra: 290 })
await t.servicos.mudarStatus({ id: s1b.id, status: 'finalizado', condicaoPagamento: 'Dinheiro', numeroPedido: 'OS-124' })
const vendasCard = await db.query.vendas.findMany({ where: and(eq(vendas.funilMensalId, card!.id), isNull(vendas.deletedAt)) })
ok(vendasCard.length >= 2 && vendasCard.some((v) => v.valorFechado === 290), 'segundo serviço no mês soma outra venda no mesmo card')

// 3) Não aprovou exige motivo
const s2 = await t.servicos.criar({ origem: 'carteira', clienteId: c1, manutencao: false, redeAr: true, instalacao: false, valorMaoObra: 2200 })
await erro(() => t.servicos.mudarStatus({ id: s2.id, status: 'nao_aprovou' }), 'não aprovou exige motivo')
await erro(() => t.servicos.mudarStatus({ id: s2.id, status: 'nao_aprovou', motivoCategoria: 'preco', motivo: 'ok' }), 'motivo escrito curto não vale')
await t.servicos.mudarStatus({ id: s2.id, status: 'nao_aprovou', motivoCategoria: 'preco', motivo: 'Achou caro, fechou com outro técnico' })
row = (await db.query.servicos.findFirst({ where: eq(servicos.id, s2.id) }))!
ok(row.status === 'nao_aprovou' && row.motivoNaoAprovouCategoria === 'preco' && !row.compromissoId, 'não aprovou grava motivo e limpa a agenda')

// 4) Rede de ar com visita GPS
const s3 = await t.servicos.criar({ origem: 'carteira', clienteId: c1, manutencao: false, redeAr: true, instalacao: false, endereco: 'Rua A, 100 - Joinville' })
const vis = await t.servicos.checkin({ id: s3.id, objetivo: 'levantamento', lat: -26.3, lng: -48.84, precisao: 12 })
await erro(() => t.servicos.checkin({ id: s3.id, objetivo: 'levantamento' }), 'não abre 2 visitas ao mesmo tempo')
await t.servicos.checkout({ visitaId: vis.visitaId, observacoes: 'Medido 40 m de tubulação' })
const det = await t.servicos.obter({ id: s3.id })
ok(det.visitas.length === 1 && det.visitas[0].latCheckin === -26.3 && det.visitas[0].checkoutEm, 'visita com GPS registrada (check-in/out)')
ok(det.eventos.filter((e) => e.tipo === 'visita').length === 2, 'visita aparece no histórico')

// 5) Lead do marketing → finaliza cadastrando cliente → lead Ganho
const s4 = await t.servicos.criar({ origem: 'marketing', leadId: lead, manutencao: false, redeAr: true, instalacao: false, valorMaoObra: 900 })
await erro(() => t.servicos.mudarStatus({ id: s4.id, status: 'finalizado', condicaoPagamento: 'Pix', numeroPedido: 'OS-200' }), 'lead sem cadastro: exige cliente', /cliente/)
await erro(
  () => t.servicos.mudarStatus({ id: s4.id, status: 'finalizado', condicaoPagamento: 'Pix', numeroPedido: 'OS-200', novoCliente: { razaoSocial: 'Cleanwork Ltda' } }),
  'cadastro novo exige CPF/CNPJ',
  /CPF|CNPJ/
)
await t.servicos.mudarStatus({ id: s4.id, status: 'finalizado', condicaoPagamento: 'Boleto', numeroPedido: 'OS-200', novoCliente: { razaoSocial: `Cleanwork ${stamp}`, cpf: '52998224725', cidade: 'Joinville' } })
row = (await db.query.servicos.findFirst({ where: eq(servicos.id, s4.id) }))!
const cNovo = row.clienteId ? await db.query.clientes.findFirst({ where: eq(clientes.id, row.clienteId) }) : null
const leadDepois = await db.query.leads.findFirst({ where: eq(leads.id, lead) })
ok(cNovo && cNovo.vendedorAtualId === v1 && cNovo.origemMarketing && !cNovo.emProspeccao, 'lead virou cliente na carteira do vendedor, marcado como Marketing')
ok(leadDepois?.status === 'ganho' && leadDepois.convertidoParaClienteId === cNovo?.id && leadDepois.finalOrderValue === 900, 'lead foi para Ganho com o valor do serviço')
const vLead = await db.query.vendas.findFirst({ where: eq(vendas.id, row.vendaId!) })
ok(vLead?.origemMarketing, 'venda conta como de Marketing')

// 6) Prospect → finalizado manda pra carteira
const s5 = await t.servicos.criar({ origem: 'prospeccao', clienteId: prospect, manutencao: true, redeAr: false, instalacao: false, valorMaoObra: 300 })
await t.servicos.mudarStatus({ id: s5.id, status: 'finalizado', condicaoPagamento: 'Pix', numeroPedido: 'OS-300' })
const pDepois = await db.query.clientes.findFirst({ where: eq(clientes.id, prospect) })
ok(pDepois && !pDepois.emProspeccao && pDepois.prospeccaoEtapa === 'ganho', 'prospect saiu da prospecção e entrou na carteira')

// 7) Resumo do mês
lista = await caller(gestor, 'admin').servicos.listar()
ok(lista.resumo.finalizados >= 4 && lista.resumo.naoAprovou >= 1 && lista.resumo.valorFinalizado >= 750 + 290 + 900 + 300, `resumo do mês (finalizados ${lista.resumo.finalizados}, R$ ${lista.resumo.valorFinalizado})`)
ok(lista.resumo.porTipo.find((p) => p.tipo === 'Rede de ar')!.finalizados >= 1, 'resumo por tipo')

// 8) Exclusão
const s6 = await t.servicos.criar({ origem: 'avulso', clienteNome: 'Cliente de balcão', manutencao: true, redeAr: false, instalacao: false })
await t.servicos.mudarStatus({ id: s6.id, status: 'em_andamento' })
await erro(() => t.servicos.excluir({ id: s6.id }), 'vendedor não exclui serviço que já andou')
await caller(gestor, 'admin').servicos.excluir({ id: s6.id })
ok(!(await t.servicos.listar()).itens.some((i) => i.id === s6.id), 'gestor exclui')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo')
process.exit(falhas ? 1 : 0)
