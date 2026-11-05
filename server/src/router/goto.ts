import { z } from 'zod'
import { and, asc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, gotoLigacoesProcessadas, gotoRamais, users } from '../db/schema.js'
import { montarUrlAutorizacao, statusConexao, desconectar, pararListener } from '../lib/goto.js'

// Nome do ramal na GoTo × nome do usuário: sugere quando o primeiro nome e
// mais um pedaço batem (o admin confirma).
const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/).filter((p) => p.length > 1)
function sugerir(nomeRamal: string | null, usuarios: { id: number; name: string }[]): number | null {
  if (!nomeRamal) return null
  const r = normal(nomeRamal)
  if (!r.length) return null
  const pontos = usuarios
    .map((u) => {
      const n = normal(u.name)
      if (n[0] !== r[0]) return { u, p: 0 }
      return { u, p: 1 + r.slice(1).filter((x) => n.includes(x)).length }
    })
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p)
  if (!pontos.length) return null
  if (pontos.length > 1 && pontos[0].p === pontos[1].p) return null
  return pontos[0].u.id
}

export const gotoRouter = router({
  status: adminProcedure.query(() => statusConexao()),

  urlConexao: adminProcedure.query(() => ({ url: montarUrlAutorizacao() })),

  desconectar: adminProcedure.mutation(async () => {
    await desconectar()
    pararListener()
    return { success: true }
  }),

  // Ramais que já apareceram nas ligações + quem é cada um no CRM.
  ramais: adminProcedure.query(async () => {
    // Primeira vez: puxa os ramais das ligações já recebidas (últimos 60 dias).
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(gotoRamais)
    if (!n) {
      const limite = new Date(Date.now() - 60 * 86400_000).toISOString().replace('T', ' ').slice(0, 19)
      const payloads = await db
        .select({ p: gotoLigacoesProcessadas.payloadBruto })
        .from(gotoLigacoesProcessadas)
        .where(and(isNotNull(gotoLigacoesProcessadas.payloadBruto), gte(gotoLigacoesProcessadas.criadoEm, limite)))
      const vistos = new Map<string, string>()
      for (const { p } of payloads)
        for (const m of (p ?? '').matchAll(/"extensionNumber":"(\d+)","name":"([^"]*)"/g)) vistos.set(m[1], m[2])
      for (const [ramal, nome] of vistos) await db.insert(gotoRamais).values({ ramal, nome }).onConflictDoNothing()
    }
    const lista = await db.select().from(gotoRamais).orderBy(asc(gotoRamais.ramal))
    const usuarios = await db
      .select({ id: users.id, name: users.name, empresa: empresas.nome })
      .from(users)
      .innerJoin(empresas, eq(empresas.id, users.empresaId))
      .where(and(eq(users.isActive, true), inArray(empresas.slug, ['joitec', 'joitec-automacao'])))
      .orderBy(asc(users.name))
    return {
      ramais: lista.map((r) => ({ ...r, sugestao: r.userId ? null : sugerir(r.nome, usuarios) })),
      usuarios,
    }
  }),

  definirRamal: adminProcedure
    .input(z.object({ ramal: z.string(), userId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      await db.update(gotoRamais).set({ userId: input.userId }).where(eq(gotoRamais.ramal, input.ramal))
      return { ok: true }
    }),
})
