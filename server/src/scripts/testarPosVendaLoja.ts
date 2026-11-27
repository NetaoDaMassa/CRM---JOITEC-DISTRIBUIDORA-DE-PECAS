// Teste do Pós-venda de máquinas da Compretec Loja Física.
// Uso: DATABASE_URL=file:./teste_posvenda.db npx tsx src/scripts/testarPosVendaLoja.ts
import path from 'path'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users, clientes, compromissos, vendas, funilMensal, empresas, clienteMaquinas } from '../db/schema.js'
import { appRouter } from '../router/index.js'
import { somarDias } from '../lib/maquinasPosVenda.js'
import { hojeBrString } from '../lib/dataBr.js'

if (!String(process.env.DATABASE_URL).includes('teste')) throw new Error('Rode só contra uma cópia')
await migrate(db, { migrationsFolder: path.resolve('drizzle') })
let falhas = 0
const ok = (c: unknown, nome: string) => { console.log(`${c ? '✅' : '❌'} ${nome}`); if (!c) falhas++ }
const emp = (await db.query.empresas.findFirst({ where: eq(empresas.slug, 'compretec-loja-fisica') }))!
const novoUser = async (nome: string) => Number((await db.insert(users).values({ empresaId: emp.id, name: nome, username: `pv_${nome}_${Date.now()}`, passwordHash: 'x', role: 'vendor' })).lastInsertRowid)
const v1 = await novoUser('thiago'), v2 = await novoUser('marcos')
const caller = (id: number, empresaId = emp.id) => appRouter.createCaller({ user: { id, username: 'x', name: 'x', role: 'vendor', empresaId, superAdmin: false }, empresaId } as any)
const c1 = Number((await db.insert(clientes).values({ empresaId: emp.id, razaoSocial: `Oficina Teste ${Date.now()}`, codigo: `T${Date.now()}`, regiao: 'sul', vendedorAtualId: v1 })).lastInsertRowid)
const cf = Number((await db.insert(clientes).values({ empresaId: emp.id, razaoSocial: 'CONSUMIDOR FINAL TESTE', codigo: `CF${Date.now()}`, regiao: 'sul', vendedorAtualId: v1 })).lastInsertRowid)
const hoje = hojeBrString()

const r = await caller(v1).posVendaLoja.cadastrar({ clienteId: c1, tipo: 'parafuso', modelo: 'SRP 3010', numeroSerie: 'ABC123', dataVenda: hoje })
ok(r.proximoContato === somarDias(hoje, 30), `1º contato = venda + 30 dias (${r.proximoContato})`)
const comp = (await db.query.clienteMaquinas.findFirst({ where: eq(clienteMaquinas.id, r.id) }))!
const ag = comp.compromissoId ? await db.query.compromissos.findFirst({ where: eq(compromissos.id, comp.compromissoId) }) : null
ok(ag?.vendedorId === v1 && ag?.dataHora === `${r.proximoContato} 12:00:00` && ag.tipo === 'ligacao' && ag.clienteId === c1, 'vira ligação na agenda do vendedor (9h)')
const lista = await caller(v1).posVendaLoja.listar()
ok(lista.mostrar && lista.itens.some((i) => i.id === r.id) && lista.clientesComMaquina.includes(c1), 'aparece na coluna Pós-venda do vendedor')
ok(!(await caller(v2).posVendaLoja.listar()).itens.some((i) => i.id === r.id), 'outro vendedor não vê')
try { await caller(v2).posVendaLoja.obter({ id: r.id }); ok(false, 'outro vendedor não abre') } catch { ok(true, 'outro vendedor não abre') }
try { await caller(v1).posVendaLoja.cadastrar({ clienteId: cf, tipo: 'pistao', modelo: 'CSL 10', dataVenda: hoje }); ok(false, 'bloqueia CONSUMIDOR FINAL') } catch { ok(true, 'bloqueia CONSUMIDOR FINAL (compressor sai com nota)') }
try { await caller(v2).posVendaLoja.cadastrar({ clienteId: c1, tipo: 'pistao', modelo: 'CSL 10', dataVenda: hoje }); ok(false, 'bloqueia cliente de outro') } catch { ok(true, 'bloqueia cadastrar em cliente de outro vendedor') }
const outraEmp = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'joitec') })
ok(!(await caller(v1, outraEmp!.id).posVendaLoja.listar()).mostrar, 'coluna não aparece nas outras empresas')

// compra antes do 1º contato: não mexe nos 30 dias
const card = Number((await db.insert(funilMensal).values({ clienteId: c1, vendedorId: v1, mesReferencia: `${hoje.slice(0, 7)}-01`, etapa: 'fechado' })).lastInsertRowid)
const venda = async (diasAtras: number) => db.insert(vendas).values({ funilMensalId: card, clienteId: c1, vendedorId: v1, mesReferencia: `${hoje.slice(0, 7)}-01`, valorFechado: 200, dataFechamento: `${somarDias(hoje, -diasAtras)} 15:00:00` })
await db.update(clienteMaquinas).set({ dataVenda: somarDias(hoje, -40), baseData: somarDias(hoje, -40), proximoContato: somarDias(hoje, -10) }).where(eq(clienteMaquinas.id, r.id))
await venda(20)
await caller(v1).posVendaLoja.listar()
ok((await db.query.clienteMaquinas.findFirst({ where: eq(clienteMaquinas.id, r.id) }))!.proximoContato === somarDias(hoje, -10), 'compra ANTES do 1º contato não muda a data dos 30 dias')
// 1º contato feito
await caller(v1).posVendaLoja.registrarContato({ id: r.id, tipo: 'ligacao', observacao: 'Cliente ok, revisão depois', proximoContato: somarDias(hoje, 90) })
const m2 = (await db.query.clienteMaquinas.findFirst({ where: eq(clienteMaquinas.id, r.id) }))!
const agAntigo = await db.query.compromissos.findFirst({ where: eq(compromissos.id, comp.compromissoId!) })
const agNovo = m2.compromissoId ? await db.query.compromissos.findFirst({ where: eq(compromissos.id, m2.compromissoId) }) : null
ok(agAntigo?.concluido && agNovo && !agNovo.concluido && agNovo.dataHora.startsWith(somarDias(hoje, 90)), 'contato registrado: compromisso velho concluído, novo marcado')
// compra nova depois do contato → +90 da compra
await db.update(clienteMaquinas).set({ baseData: somarDias(hoje, -5) }).where(eq(clienteMaquinas.id, r.id))
await venda(2)
await caller(v1).posVendaLoja.listar()
const m3 = (await db.query.clienteMaquinas.findFirst({ where: eq(clienteMaquinas.id, r.id) }))!
ok(m3.proximoContato === somarDias(somarDias(hoje, -2), 90) && m3.baseMotivo === 'nova_compra', `compra depois do contato → próximo = compra + 90 dias (${m3.proximoContato})`)
const agC = await db.query.compromissos.findFirst({ where: eq(compromissos.id, m3.compromissoId!) })
ok(agC?.dataHora.startsWith(m3.proximoContato!), 'agenda acompanha a data nova')
await caller(v1).posVendaLoja.listar()
ok((await db.query.clienteMaquinas.findFirst({ where: eq(clienteMaquinas.id, r.id) }))!.proximoContato === m3.proximoContato, 'abrir de novo não empurra a data')
await caller(v1).posVendaLoja.encerrar({ id: r.id, motivo: 'Cliente vendeu a máquina' })
const agE = await db.query.compromissos.findFirst({ where: eq(compromissos.id, m3.compromissoId!) })
ok(!!agE?.deletedAt && !(await caller(v1).posVendaLoja.listar()).itens.some((i) => i.id === r.id), 'encerrar tira da coluna e da agenda')
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo OK')
process.exit(falhas ? 1 : 0)
