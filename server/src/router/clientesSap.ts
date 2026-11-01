import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { router, adminProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, users } from '../db/schema.js'
import {
  autoDesde,
  cadastrarClienteSap,
  cadastrosNovosPendentes,
  clientesComVendaFora,
  ignorarCodigo,
  ligarAutomatico,
  ligarCodigoSap,
  salvarVendedoresLigados,
  vendedoresLigados,
  vendedoresSap,
} from '../lib/sapClientes.js'

// Clientes do SAP pra cadastrar no CRM (ver lib/sapClientes.ts). Gestor
// (admin) vê e cadastra só na empresa ativa; ligar vendedores do SAP aos do
// CRM e ligar o cadastro automático é do superAdmin.
export const clientesSapRouter = router({
  comVenda: adminProcedure.input(z.object({ atualizar: z.boolean().optional() }).optional()).query(async ({ ctx, input }) => {
    return clientesComVendaFora(ctx.empresaId, input?.atualizar)
  }),

  novos: adminProcedure.query(async ({ ctx }) => cadastrosNovosPendentes(ctx.empresaId)),

  cadastrar: adminProcedure.input(z.object({ codigo: z.string().min(2), vendedorId: z.number().nullable() })).mutation(async ({ ctx, input }) => {
    return cadastrarClienteSap(input.codigo, ctx.empresaId, input.vendedorId, ctx.user.id)
  }),

  ligarCodigo: adminProcedure.input(z.object({ clienteId: z.number(), codigo: z.string().min(2) })).mutation(async ({ ctx, input }) => {
    return ligarCodigoSap(input.clienteId, input.codigo, ctx.empresaId, ctx.user.id)
  }),

  ignorar: adminProcedure.input(z.object({ codigo: z.string().min(2), ignorar: z.boolean() })).mutation(async ({ ctx, input }) => {
    await ignorarCodigo(ctx.empresaId, input.codigo, input.ignorar)
    return { ok: true }
  }),

  // Vendedores do SAP × vendedores do CRM (das empresas da integração).
  vendedores: superAdminProcedure.query(async () => {
    const [sap, ligados, desde] = await Promise.all([vendedoresSap(), vendedoresLigados(), autoDesde()])
    const crm = await db
      .select({ id: users.id, nome: users.name, empresa: empresas.nome, slug: empresas.slug, ativo: users.isActive })
      .from(users)
      .innerJoin(empresas, eq(empresas.id, users.empresaId))
      .where(inArray(empresas.slug, ['joitec', 'odin-tubos', 'joitec-automacao']))
    return { sap, ligados, crm: crm.filter((u) => u.ativo), autoDesde: desde }
  }),

  salvarVendedores: superAdminProcedure.input(z.object({ ligados: z.record(z.string(), z.number()) })).mutation(async ({ input }) => {
    await salvarVendedoresLigados(input.ligados)
    return { ok: true }
  }),

  ligarAutomatico: superAdminProcedure.input(z.object({ ligado: z.boolean() })).mutation(async ({ input }) => {
    await ligarAutomatico(input.ligado)
    return { autoDesde: await autoDesde() }
  }),
})
