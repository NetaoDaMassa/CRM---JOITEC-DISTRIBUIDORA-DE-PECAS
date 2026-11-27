// Teste do rodízio por vendedor dos leads do WhatsApp (Compretec Loja Física).
// Uso: DATABASE_URL=file:./teste_rodizio.db npx tsx src/scripts/testarRodizioWhatsapp.ts
import path from 'path'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, users, empresas } from '../db/schema.js'
import { extrairMensagem, registrarMensagem } from '../lib/whatsapp/capturaLeads.js'
import { distribuicaoWhatsapp, salvarDistribuicaoWhatsapp, filaDoRodizio } from '../lib/whatsapp/rodizioVendedor.js'

if (!String(process.env.DATABASE_URL).includes('teste')) throw new Error('Rode só contra uma cópia')
await migrate(db, { migrationsFolder: path.resolve('drizzle') })
let falhas = 0
const ok = (c: unknown, nome: string) => { console.log(`${c ? '✅' : '❌'} ${nome}`); if (!c) falhas++ }
const EMP = 7
if (!(await db.query.empresas.findFirst({ where: eq(empresas.id, EMP) }))) throw new Error('cópia sem empresa 7')
// 3 vendedores de teste na empresa 7
const vs: number[] = []
for (const nome of ['Thiago Teste', 'Marcos Teste', 'Terceiro Teste']) {
  const r = await db.insert(users).values({ empresaId: EMP, name: nome, username: `rod_${nome.split(' ')[0].toLowerCase()}_${Date.now()}`, passwordHash: 'x', role: 'vendor' })
  vs.push(Number(r.lastInsertRowid))
}
ok((await distribuicaoWhatsapp(EMP)).modo === 'vendedor', 'Compretec Loja Física já nasce no rodízio por vendedor')
ok((await distribuicaoWhatsapp(4)).modo === 'ddd', 'outras empresas continuam pelo DDD')
await salvarDistribuicaoWhatsapp(EMP, { modo: 'vendedor', vendedores: [vs[0], vs[1]] })
ok((await filaDoRodizio(EMP)).map((v) => v.id).join() === `${vs[0]},${vs[1]}`, 'fila = Thiago, Marcos')

let n = 0
const enviar = async (jid: string) => {
  const m = extrairMensagem({ key: { remoteJid: jid, fromMe: false, id: `ROD${Date.now()}${n++}` }, pushName: `Cliente ${n}`, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: 'quero compressor' } })
  const r = await registrarMensagem(EMP, m!)
  return r?.leadId ? (await db.query.leads.findFirst({ where: eq(leads.id, r.leadId) }))?.vendorId : null
}
// DDDs diferentes de propósito: não pode importar
const base = 900000000 + Math.floor(Math.random() * 9000000)
const a = await Promise.all([enviar(`5547${base + 1}@s.whatsapp.net`), enviar(`5511${base + 2}@s.whatsapp.net`), enviar(`5521${base + 3}@s.whatsapp.net`), enviar(`5548${base + 4}@s.whatsapp.net`)])
const cont = (id: number) => a.filter((x) => x === id).length
ok(cont(vs[0]) === 2 && cont(vs[1]) === 2, `4 mensagens chegando juntas: 2 Thiago, 2 Marcos (${a.join(',')})`)
ok(cont(vs[2]) === 0, 'quem não está na fila não recebe')
const lid = await enviar(`99887766${n}@lid`)
ok(lid === vs[0] || lid === vs[1], 'lead sem número (@lid) também vai pro vendedor da vez')
await db.update(users).set({ isActive: false }).where(eq(users.id, vs[1]))
const b = [await enviar(`5547${base + 6}@s.whatsapp.net`), await enviar(`5547${base + 7}@s.whatsapp.net`)]
ok(b.every((x) => x === vs[0]), 'vendedor inativado sai da fila sozinho')
await salvarDistribuicaoWhatsapp(EMP, { modo: 'vendedor', vendedores: [] })
await db.update(users).set({ isActive: true }).where(eq(users.id, vs[1]))
ok((await filaDoRodizio(EMP)).some((v) => v.id === vs[2]), 'lista vazia = todos os vendedores ativos')
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo OK')
process.exit(falhas ? 1 : 0)
