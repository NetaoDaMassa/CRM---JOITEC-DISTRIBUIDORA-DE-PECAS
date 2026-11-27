// Tela "WhatsApp → captura de leads" (só superAdmin). Liga/desliga por empresa,
// mostra o QR para parear, status da conexão e as últimas mensagens capturadas.
// Ver lib/whatsapp/captura.ts e capturaLeads.ts.
import { z } from 'zod'
import { desc, eq, and, gte, sql } from 'drizzle-orm'
import { router, superAdminProcedure, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { leads, clientes, leadWhatsappMensagens } from '../db/schema.js'
import { conversaDoCliente, clientesComMensagemNova, marcarMensagensVistas } from '../lib/whatsapp/capturaLeads.js'
import { distribuicaoWhatsapp, salvarDistribuicaoWhatsapp, vendedoresDaEmpresa, filaDoRodizio, proximoDaVez } from '../lib/whatsapp/rodizioVendedor.js'
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
    if (ctx.user.role === 'vendor' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')
    return conversaDoCliente(ctx.empresaId, cliente.id)
  }),

  // Selo "💬 mensagem nova" nos cards (Kanban da carteira e Prospecção).
  // Vendedor vê só os clientes dele; admin/gestor vê todos da empresa.
  naoVistas: protectedProcedure.query(async ({ ctx }) => {
    const linhas = await clientesComMensagemNova(ctx.empresaId, ctx.user.role === 'vendor' ? ctx.user.id : null)
    return linhas.filter((l) => l.clienteId).map((l) => ({ clienteId: l.clienteId as number, qtd: Number(l.qtd), ultima: l.ultima, texto: String(l.texto || '').slice(0, 140) }))
  }),

  // Abriu o card e a conversa apareceu: só o VENDEDOR DONO do cliente "dá
  // baixa" (admin olhando não tira o selo do vendedor). Cliente sem vendedor:
  // quem abrir dá baixa.
  marcarVistas: protectedProcedure.input(z.object({ clienteId: z.number() })).mutation(async ({ ctx, input }) => {
    const cliente = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId)), columns: { id: true, vendedorAtualId: true } })
    if (!cliente) throw new Error('Cliente não encontrado')
    if (cliente.vendedorAtualId && cliente.vendedorAtualId !== ctx.user.id) return { marcadas: 0, dono: false }
    return { marcadas: await marcarMensagensVistas(ctx.empresaId, cliente.id, cliente.vendedorAtualId ?? null), dono: true }
  }),

  // Como os leads novos do WhatsApp são distribuídos: DDD (padrão) ou
  // rodízio entre vendedores escolhidos (Compretec Loja Física).
  distribuicao: superAdminProcedure.input(empresaInput).query(async ({ input }) => {
    const [d, vendedores, fila, proximo] = await Promise.all([
      distribuicaoWhatsapp(input.empresaId),
      vendedoresDaEmpresa(input.empresaId),
      filaDoRodizio(input.empresaId),
      proximoDaVez(input.empresaId),
    ])
    return { ...d, opcoes: vendedores.filter((v) => v.ativo), fila, proximo }
  }),

  salvarDistribuicao: superAdminProcedure
    .input(empresaInput.extend({ modo: z.enum(['ddd', 'vendedor']), vendedores: z.array(z.number().int().positive()) }))
    .mutation(async ({ input }) => {
      await salvarDistribuicaoWhatsapp(input.empresaId, { modo: input.modo, vendedores: input.vendedores })
      return { ok: true }
    }),

  desconectar: superAdminProcedure.input(empresaInput).mutation(async ({ input }) => {
    await desconectarCaptura(input.empresaId)
    return { ok: true }
  }),
})
