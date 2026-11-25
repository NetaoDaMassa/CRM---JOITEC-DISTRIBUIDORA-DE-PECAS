// Tela "WhatsApp → captura de leads" (só superAdmin). Liga/desliga por empresa,
// mostra o QR para parear, status da conexão e as últimas mensagens capturadas.
// Ver lib/whatsapp/captura.ts e capturaLeads.ts.
import { z } from 'zod'
import { desc, eq, and, gte, sql } from 'drizzle-orm'
import { router, superAdminProcedure, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { leads, clientes, leadWhatsappMensagens } from '../db/schema.js'
import { conversaDoCliente } from '../lib/whatsapp/capturaLeads.js'
import { capturaAtiva, statusCaptura, iniciarCaptura, ligarDesligarCaptura, desconectarCaptura } from '../lib/whatsapp/captura.js'

const empresaInput = z.object({ empresaId: z.number().int().min(1) })

export const whatsappCapturaRouter = router({
  empresas: superAdminProcedure.query(async () => {
    const todas = await db.query.empresas.findMany({ columns: { id: true, nome: true }, orderBy: (e, { asc }) => [asc(e.nome)] })
    return Promise.all(todas.map(async (e) => ({ ...e, ativa: await capturaAtiva(e.id), estado: statusCaptura(e.id).estado })))
  }),

  painel: superAdminProcedure.input(empresaInput).query(async ({ input }) => {
    const desde = new Date(Date.now() - 7 * 864e5).toISOString()
    const ultimas = await db
      .select({ id: leadWhatsappMensagens.id, direcao: leadWhatsappMensagens.direcao, texto: leadWhatsappMensagens.texto, pushName: leadWhatsappMensagens.pushName, telefone: leadWhatsappMensagens.telefone, enviadaEm: leadWhatsappMensagens.enviadaEm, leadId: leadWhatsappMensagens.leadId, leadNome: leads.name, clienteId: leadWhatsappMensagens.clienteId, clienteNome: clientes.razaoSocial })
      .from(leadWhatsappMensagens)
      .leftJoin(leads, eq(leads.id, leadWhatsappMensagens.leadId))
      .leftJoin(clientes, eq(clientes.id, leadWhatsappMensagens.clienteId))
      .where(eq(leadWhatsappMensagens.empresaId, input.empresaId))
      .orderBy(desc(leadWhatsappMensagens.id))
      .limit(30)
    const [{ n: leads7 } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(leads)
      .where(and(eq(leads.empresaId, input.empresaId), eq(leads.source, 'whatsapp'), gte(leads.createdAt, desde.slice(0, 19).replace('T', ' '))))
    return { ativa: await capturaAtiva(input.empresaId), ...statusCaptura(input.empresaId), ultimas, leads7: Number(leads7) }
  }),

  ligar: superAdminProcedure.input(empresaInput.extend({ ativa: z.boolean() })).mutation(async ({ input }) => {
    await ligarDesligarCaptura(input.empresaId, input.ativa)
    return statusCaptura(input.empresaId)
  }),

  // Chamado pela tela a cada poucos segundos enquanto mostra o QR.
  qr: superAdminProcedure.input(empresaInput).mutation(async ({ input }) => {
    if (!(await capturaAtiva(input.empresaId))) throw new Error('Ligue a captura desta empresa primeiro.')
    const st = statusCaptura(input.empresaId)
    if (st.estado === 'desligada' || st.estado === 'desconectado') await iniciarCaptura(input.empresaId).catch((e) => console.error('[wa-captura] qr:', e))
    return statusCaptura(input.empresaId)
  }),

  // Ficha do cliente da carteira → conversa do WhatsApp.
  conversaCliente: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const cliente = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.id), eq(clientes.empresaId, ctx.empresaId)), columns: { id: true, vendedorAtualId: true } })
    if (!cliente) throw new Error('Cliente não encontrado')
    if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')
    return conversaDoCliente(ctx.empresaId, cliente.id)
  }),

  desconectar: superAdminProcedure.input(empresaInput).mutation(async ({ input }) => {
    await desconectarCaptura(input.empresaId)
    return { ok: true }
  }),
})
