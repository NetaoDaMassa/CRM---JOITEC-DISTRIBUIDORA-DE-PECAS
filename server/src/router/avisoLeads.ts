// Tela "Automações → Aviso de leads no WhatsApp" (só superAdmin).
// Controla a automação POR EMPRESA sem mexer em .env nem SSH: liga/desliga,
// horários, texto, número de teste, status/QR do WhatsApp (uma sessão só pra
// todas as empresas), rodar agora, e os telefones dos vendedores.

import { z } from 'zod'
import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { router, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { users, leads, empresas } from '../db/schema.js'
import {
  getAvisoLeadsConfig,
  setAvisoLeadsConfig,
  getUltimaExecucao,
  getAvisoLeadsEmpresasAtivas,
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

const empresaInput = z.object({ empresaId: z.number().int().min(1) })

export const avisoLeadsRouter = router({
  // Lista de empresas pro seletor da tela + quais têm a automação ligada.
  listarEmpresas: superAdminProcedure.query(async () => {
    const [todas, ativas] = await Promise.all([
      db.query.empresas.findMany({ columns: { id: true, nome: true }, orderBy: (e, { asc }) => [asc(e.nome)] }),
      getAvisoLeadsEmpresasAtivas(),
    ])
    const ativasSet = new Set(ativas)
    return todas.map((e) => ({ id: e.id, nome: e.nome, ativa: ativasSet.has(e.id) }))
  }),

  // Estado completo pra montar a tela de uma empresa.
  getPainel: superAdminProcedure.input(empresaInput).query(async ({ input }) => {
    const [config, ultimaExecucao] = await Promise.all([
      getAvisoLeadsConfig(input.empresaId),
      getUltimaExecucao(input.empresaId),
    ])
    return { empresaId: input.empresaId, config, sessao: await sessaoInfo(), ultimaExecucao }
  }),

  salvarConfig: superAdminProcedure
    .input(
      empresaInput.extend({
        enabled: z.boolean().optional(),
        dryRun: z.boolean().optional(),
        testMode: z.boolean().optional(),
        testNumero: z.string().optional(),
        adminNumero: z.string().optional(),
        horarios: z.string().optional(),
        minIntervaloMs: z.number().int().min(0).optional(),
        maxIntervaloMs: z.number().int().min(0).optional(),
        msgManha: z.string().optional(),
        msgTarde: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { empresaId, ...patch } = input
      await setAvisoLeadsConfig(empresaId, patch)
      await reagendarAvisoLeadsNovos()
      return getAvisoLeadsConfig(empresaId)
    }),

  // Sessão do WhatsApp — uma só pra todas as empresas (sem empresaId).
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

  // Roda a automação agora, DENTRO do servidor (usa a sessão já conectada).
  rodarAgora: superAdminProcedure
    .input(
      empresaInput.extend({
        periodo: z.enum(['manha', 'tarde']).optional(),
        dryRun: z.boolean().default(true),
        testMode: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const periodo = input.periodo ?? periodoAgora()
      return executarAvisoLeadsNovos({ empresaId: input.empresaId, periodo, dryRun: input.dryRun, testMode: input.testMode })
    }),

  // Vendedores da empresa, com telefone e quantos leads "Novo".
  listarVendedores: superAdminProcedure.input(empresaInput).query(async ({ input }) => {
    const { empresaId } = input

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
    .input(empresaInput.extend({ userId: z.number().int(), whatsapp: z.string() }))
    .mutation(async ({ input }) => {
      const alvo = await db.query.users.findFirst({
        where: and(eq(users.id, input.userId), eq(users.empresaId, input.empresaId)),
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
