// Tela "Automações → Aviso de leads no WhatsApp" (só superAdmin).
// Controla a automação sem mexer em .env nem SSH: liga/desliga, horários,
// número de teste, status/QR da sessão do WhatsApp, rodar agora, e os
// telefones dos vendedores.

import { z } from 'zod'
import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { router, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { users, leads } from '../db/schema.js'
import {
  getAvisoLeadsConfig,
  setAvisoLeadsConfig,
  getUltimaExecucao,
} from '../lib/avisoLeadsConfig.js'
import { getStatus, getUltimoQr, precisaPareamento, ensureStarted, desconectar } from '../lib/whatsapp/session.js'
import { executarAvisoLeadsNovos, type Periodo } from '../lib/avisoLeadsNovos.js'
import { reagendarAvisoLeadsNovos } from '../lib/scheduler.js'
import { normalizarBr } from '../lib/whatsapp/telefone.js'
import { hojeBr } from '../lib/dataBr.js'

function periodoAgora(): Periodo {
  return hojeBr().getUTCHours() < 12 ? 'manha' : 'tarde'
}

async function sessaoInfo() {
  return { status: getStatus(), precisaPareamento: precisaPareamento(), qr: getUltimoQr() }
}

export const avisoLeadsRouter = router({
  // Estado completo pra montar a tela.
  getPainel: superAdminProcedure.query(async () => {
    const [config, ultimaExecucao] = await Promise.all([getAvisoLeadsConfig(), getUltimaExecucao()])
    return { config, sessao: await sessaoInfo(), ultimaExecucao }
  }),

  salvarConfig: superAdminProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        dryRun: z.boolean().optional(),
        testMode: z.boolean().optional(),
        testNumero: z.string().optional(),
        adminNumero: z.string().optional(),
        horarios: z.string().optional(),
        empresaId: z.number().int().min(1).optional(),
        minIntervaloMs: z.number().int().min(0).optional(),
        maxIntervaloMs: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await setAvisoLeadsConfig(input)
      await reagendarAvisoLeadsNovos()
      return getAvisoLeadsConfig()
    }),

  // Garante que a sessão está tentando conectar e devolve o QR atual (pra
  // desenhar na tela). Chamado em loop pela tela enquanto não conecta.
  getQr: superAdminProcedure.mutation(async () => {
    if (getStatus() === 'desconectado') {
      await ensureStarted().catch((err) => console.error('[aviso-leads] ensureStarted (getQr):', err))
    }
    return sessaoInfo()
  }),

  desconectarWhatsapp: superAdminProcedure.mutation(async () => {
    await desconectar()
    return { ok: true }
  }),

  // Roda a automação agora, DENTRO do servidor (usa a sessão já conectada —
  // sem o conflito do script em processo separado). Por padrão em dry run.
  rodarAgora: superAdminProcedure
    .input(
      z.object({
        periodo: z.enum(['manha', 'tarde']).optional(),
        dryRun: z.boolean().default(true),
        testMode: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const periodo = input.periodo ?? periodoAgora()
      return executarAvisoLeadsNovos({ periodo, dryRun: input.dryRun, testMode: input.testMode })
    }),

  // Vendedores da empresa configurada, com telefone e quantos leads "Novo".
  listarVendedores: superAdminProcedure.query(async () => {
    const { empresaId } = await getAvisoLeadsConfig()

    const vendedores = await db.query.users.findMany({
      where: and(eq(users.empresaId, empresaId), eq(users.role, 'vendor'), eq(users.isActive, true)),
      columns: { id: true, name: true, whatsapp: true },
      orderBy: (u, { asc }) => [asc(u.name)],
    })

    const novos = await db.query.leads.findMany({
      where: and(
        eq(leads.empresaId, empresaId),
        eq(leads.status, 'novo'),
        isNull(leads.deletedAt),
        isNotNull(leads.vendorId),
      ),
      columns: { vendorId: true },
    })
    const contagem = new Map<number, number>()
    for (const l of novos) contagem.set(l.vendorId!, (contagem.get(l.vendorId!) ?? 0) + 1)

    const semVendedor = await db.query.leads.findMany({
      where: and(
        eq(leads.empresaId, empresaId),
        eq(leads.status, 'novo'),
        isNull(leads.deletedAt),
        isNull(leads.vendorId),
      ),
      columns: { id: true },
    })

    return {
      empresaId,
      leadsSemVendedor: semVendedor.length,
      vendedores: vendedores.map((v) => ({
        id: v.id,
        nome: v.name,
        whatsapp: v.whatsapp ?? '',
        leadsNovos: contagem.get(v.id) ?? 0,
      })),
    }
  }),

  salvarTelefoneVendedor: superAdminProcedure
    .input(z.object({ userId: z.number().int(), whatsapp: z.string() }))
    .mutation(async ({ input }) => {
      const { empresaId } = await getAvisoLeadsConfig()
      const alvo = await db.query.users.findFirst({
        where: and(eq(users.id, input.userId), eq(users.empresaId, empresaId)),
        columns: { id: true },
      })
      if (!alvo) throw new Error('Vendedor não encontrado nesta empresa')

      const limpo = input.whatsapp.trim()
      const valor = limpo ? normalizarBr(limpo) : null
      await db
        .update(users)
        .set({ whatsapp: valor, updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) })
        .where(eq(users.id, input.userId))
      return { ok: true, whatsapp: valor ?? '' }
    }),
})
