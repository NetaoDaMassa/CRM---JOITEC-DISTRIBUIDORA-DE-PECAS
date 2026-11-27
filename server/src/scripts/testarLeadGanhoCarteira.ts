// Confere: lead → Ganho → Transferir pra Carteira → cliente na carteira com origem Marketing.
// Uso: DATABASE_URL=file:./teste_ganho.db npx tsx src/scripts/testarLeadGanhoCarteira.ts
import path from 'path'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, users, clientes, funilMensal, empresas } from '../db/schema.js'
import { appRouter } from '../router/index.js'

if (!String(process.env.DATABASE_URL).includes('teste')) throw new Error('Rode só contra uma cópia')
await migrate(db, { migrationsFolder: path.resolve('drizzle') })
let falhas = 0
const ok = (c: unknown, nome: string) => { console.log(`${c ? '✅' : '❌'} ${nome}`); if (!c) falhas++ }
const slugs = (process.argv[2] || 'compretec-loja-fisica,joitec,odin-tubos').split(',')
for (const slug of slugs) {
  const emp = await db.query.empresas.findFirst({ where: eq(empresas.slug, slug) })
  if (!emp) { console.log(`(sem empresa ${slug})`); continue }
  console.log(`\n== ${emp.nome} ==`)
  const v = await db.query.users.findFirst({ where: and(eq(users.empresaId, emp.id), eq(users.role, 'vendor'), eq(users.isActive, true)) })
  if (!v) { console.log('(sem vendedor)'); continue }
  const caller = appRouter.createCaller({ user: { id: v.id, username: v.username, name: v.name, role: 'vendor', empresaId: emp.id, superAdmin: false }, empresaId: emp.id } as any)
  const tel = String(900000000 + Math.floor(Math.random() * 9e7))
  const ins = await db.insert(leads).values({ empresaId: emp.id, name: `Lead Teste ${slug}`, phone: tel, ddd: 47, source: 'whatsapp', vendorId: v.id, assignedAt: new Date().toISOString(), statusChangedAt: new Date().toISOString() })
  const leadId = Number(ins.lastInsertRowid)
  try {
    await caller.leads.changeStatus({ id: leadId, status: 'ganho', finalOrderValue: 1500, paymentMethod: 'avista' })
    const l = await db.query.leads.findFirst({ where: eq(leads.id, leadId) })
    ok(l?.status === 'ganho', 'vendedor marca o lead como Ganho')
  } catch (e) { ok(false, `marcar Ganho: ${(e as Error).message.slice(0, 600)}`); continue }
  try {
    const r = await caller.leads.transferirParaCarteira({ leadId, razaoSocial: `Cliente Teste ${slug} ${tel}`, cpf: '52998224725', regiao: 'sul', cidade: 'Joinville' })
    const c = await db.query.clientes.findFirst({ where: eq(clientes.id, r.clienteId) })
    ok(c?.vendedorAtualId === v.id, 'cliente entra na carteira do vendedor do lead')
    ok(c?.origemMarketing === true && c?.origemMarketingTipo === "padrao", `cliente fica marcado "veio do Marketing" (tipo: ${c?.origemMarketingTipo})`)
    ok(c?.telefoneWhatsapp === `47${tel}`, 'telefone do lead vai junto')
    const card = await db.query.funilMensal.findFirst({ where: eq(funilMensal.clienteId, r.clienteId) })
    ok(!!card, `card do mês criado no Kanban (etapa ${card?.etapa})`)
    const l2 = await db.query.leads.findFirst({ where: eq(leads.id, leadId) })
    ok(l2?.convertidoParaClienteId === r.clienteId, 'lead fica ligado ao cliente (não transfere 2x)')
    try { await caller.leads.transferirParaCarteira({ leadId, razaoSocial: 'x y', regiao: 'sul' }); ok(false, 'bloqueia 2ª transferência') } catch { ok(true, 'bloqueia 2ª transferência') }
  } catch (e) { ok(false, `transferir: ${(e as Error).message.slice(0, 300)}`) }
}
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo OK')
process.exit(falhas ? 1 : 0)
