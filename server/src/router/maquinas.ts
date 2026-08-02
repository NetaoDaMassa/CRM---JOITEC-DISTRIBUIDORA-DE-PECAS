import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { maquinasCliente, clientes, catalogoCompressores } from '../db/schema.js'
import { diasDesde, hojeBrString } from '../lib/dataBr.js'

// Sem telemetria de horímetro real — o acompanhamento é por estimativa
// (horas de uso por dia informadas no cadastro), projetando a data da
// próxima troca a partir da última troca (ou da instalação, se nunca
// trocou). Reaproveitado tanto pro filtro de ar quanto pro de óleo.
function projetarTroca(dataReferencia: string, horasUsoDia: number, intervaloHoras: number) {
  const dias = diasDesde(dataReferencia) ?? 0
  const horasAcumuladas = dias * horasUsoDia
  const horasRestantes = intervaloHoras - horasAcumuladas
  if (horasUsoDia <= 0) return { diasRestantes: null, dataProjetada: null, vencido: false }
  const diasRestantes = Math.ceil(horasRestantes / horasUsoDia)
  const dataProjetada = new Date(`${hojeBrString()}T00:00:00Z`)
  dataProjetada.setUTCDate(dataProjetada.getUTCDate() + diasRestantes)
  return {
    diasRestantes,
    dataProjetada: dataProjetada.toISOString().slice(0, 10),
    vencido: diasRestantes <= 0,
  }
}

function enriquecer(maquina: typeof maquinasCliente.$inferSelect) {
  const filtroAr = projetarTroca(
    maquina.dataUltimaTrocaFiltroAr ?? maquina.dataInstalacao,
    maquina.horasUsoDia,
    maquina.intervaloFiltroArHoras
  )
  const filtroOleo = projetarTroca(
    maquina.dataUltimaTrocaFiltroOleo ?? maquina.dataInstalacao,
    maquina.horasUsoDia,
    maquina.intervaloFiltroOleoHoras
  )
  return { ...maquina, filtroAr, filtroOleo }
}

async function validarAcessoCliente(clienteId: number, ctxUserId: number, ctxIsAdmin: boolean, empresaId: number) {
  const cliente = await db.query.clientes.findFirst({
    where: and(eq(clientes.id, clienteId), isNull(clientes.deletedAt), eq(clientes.empresaId, empresaId)),
  })
  if (!cliente) throw new Error('Cliente não encontrado')
  if (!ctxIsAdmin && cliente.vendedorAtualId !== ctxUserId) throw new Error('Acesso negado')
  return cliente
}

export const maquinasRouter = router({
  // Alimenta o dropdown de "Modelo" em "Nova máquina" — se a empresa não
  // tiver catálogo cadastrado, o formulário cai pra digitação livre.
  listaCatalogo: protectedProcedure.query(async ({ ctx }) => {
    return db.query.catalogoCompressores.findMany({
      // Só compressor entra aqui — secador/outro item não tem o ciclo de
      // filtro de ar/óleo que "Nova máquina" acompanha.
      where: and(eq(catalogoCompressores.empresaId, ctx.empresaId), eq(catalogoCompressores.tipo, 'compressor')),
      orderBy: (c, { asc }) => [asc(c.modelo)],
    })
  }),

  // Todos os tipos (compressor + secador + outro) — usado no autocomplete de
  // "Itens do pedido" ao fechar uma venda, diferente do listaCatalogo acima
  // (só compressor, usado no dropdown de Nova Máquina).
  listaCatalogoItens: protectedProcedure.query(async ({ ctx }) => {
    return db.query.catalogoCompressores.findMany({
      where: eq(catalogoCompressores.empresaId, ctx.empresaId),
      orderBy: (c, { asc }) => [asc(c.modelo)],
    })
  }),

  listaPorCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    await validarAcessoCliente(input.clienteId, ctx.user.id, ctx.user.role === 'admin', ctx.empresaId)
    const maquinas = await db.query.maquinasCliente.findMany({
      where: and(eq(maquinasCliente.clienteId, input.clienteId), isNull(maquinasCliente.deletedAt)),
      orderBy: (m, { desc }) => [desc(m.createdAt)],
    })
    return maquinas.map(enriquecer)
  }),

  criar: protectedProcedure
    .input(
      z.object({
        clienteId: z.number(),
        modelo: z.string().min(1),
        quantidade: z.number().int().min(1),
        dataInstalacao: z.string().min(1),
        horasUsoDia: z.number().min(0),
        intervaloFiltroArHoras: z.number().int().min(1).optional(),
        intervaloFiltroOleoHoras: z.number().int().min(1).optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await validarAcessoCliente(input.clienteId, ctx.user.id, ctx.user.role === 'admin', ctx.empresaId)
      const result = await db.insert(maquinasCliente).values({
        clienteId: input.clienteId,
        modelo: input.modelo,
        quantidade: input.quantidade,
        dataInstalacao: input.dataInstalacao,
        horasUsoDia: input.horasUsoDia,
        intervaloFiltroArHoras: input.intervaloFiltroArHoras,
        intervaloFiltroOleoHoras: input.intervaloFiltroOleoHoras,
        observacoes: input.observacoes,
      })
      return { id: Number(result.lastInsertRowid) }
    }),

  atualizar: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        modelo: z.string().min(1),
        quantidade: z.number().int().min(1),
        horasUsoDia: z.number().min(0),
        intervaloFiltroArHoras: z.number().int().min(1),
        intervaloFiltroOleoHoras: z.number().int().min(1),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const maquina = await db.query.maquinasCliente.findFirst({ where: eq(maquinasCliente.id, input.id) })
      if (!maquina) throw new Error('Máquina não encontrada')
      await validarAcessoCliente(maquina.clienteId, ctx.user.id, ctx.user.role === 'admin', ctx.empresaId)

      await db
        .update(maquinasCliente)
        .set({
          modelo: input.modelo,
          quantidade: input.quantidade,
          horasUsoDia: input.horasUsoDia,
          intervaloFiltroArHoras: input.intervaloFiltroArHoras,
          intervaloFiltroOleoHoras: input.intervaloFiltroOleoHoras,
          observacoes: input.observacoes,
          updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        })
        .where(eq(maquinasCliente.id, input.id))
      return { success: true }
    }),

  marcarTroca: protectedProcedure
    .input(z.object({ id: z.number(), tipo: z.enum(['ar', 'oleo']) }))
    .mutation(async ({ ctx, input }) => {
      const maquina = await db.query.maquinasCliente.findFirst({ where: eq(maquinasCliente.id, input.id) })
      if (!maquina) throw new Error('Máquina não encontrada')
      await validarAcessoCliente(maquina.clienteId, ctx.user.id, ctx.user.role === 'admin', ctx.empresaId)

      const hoje = hojeBrString()
      await db
        .update(maquinasCliente)
        .set(
          input.tipo === 'ar'
            ? { dataUltimaTrocaFiltroAr: hoje, updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) }
            : { dataUltimaTrocaFiltroOleo: hoje, updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) }
        )
        .where(eq(maquinasCliente.id, input.id))
      return { success: true }
    }),

  remover: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const maquina = await db.query.maquinasCliente.findFirst({ where: eq(maquinasCliente.id, input.id) })
    if (!maquina) throw new Error('Máquina não encontrada')
    await validarAcessoCliente(maquina.clienteId, ctx.user.id, ctx.user.role === 'admin', ctx.empresaId)

    await db
      .update(maquinasCliente)
      .set({ deletedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) })
      .where(eq(maquinasCliente.id, input.id))
    return { success: true }
  }),

  // "Fila de Pós-venda" — mesmo espírito da "Fila de Hoje" do funil de venda
  // nova, só que pra reposição de peça: lista as máquinas do vendedor (ou,
  // se admin, todas da empresa) ordenadas por quem está mais perto (ou já
  // passou) da troca de filtro de ar/óleo, pra saber quem ligar primeiro.
  filaPosVenda: protectedProcedure.query(async ({ ctx }) => {
    const filtroCliente =
      ctx.user.role === 'admin' ? eq(clientes.empresaId, ctx.empresaId) : eq(clientes.vendedorAtualId, ctx.user.id)

    const linhas = await db
      .select({
        maquina: maquinasCliente,
        clienteId: clientes.id,
        clienteRazaoSocial: clientes.razaoSocial,
        clienteTelefone: clientes.telefoneWhatsapp,
      })
      .from(maquinasCliente)
      .innerJoin(clientes, eq(clientes.id, maquinasCliente.clienteId))
      .where(and(filtroCliente, isNull(maquinasCliente.deletedAt), isNull(clientes.deletedAt)))

    const itens = linhas.map((l) => {
      const enriquecida = enriquecer(l.maquina)
      const proximaPeca =
        (enriquecida.filtroAr.diasRestantes ?? Infinity) <= (enriquecida.filtroOleo.diasRestantes ?? Infinity)
          ? ('ar' as const)
          : ('oleo' as const)
      const diasRestantes = proximaPeca === 'ar' ? enriquecida.filtroAr.diasRestantes : enriquecida.filtroOleo.diasRestantes
      return {
        maquinaId: enriquecida.id,
        clienteId: l.clienteId,
        razaoSocial: l.clienteRazaoSocial,
        telefoneWhatsapp: l.clienteTelefone,
        modelo: enriquecida.modelo,
        quantidade: enriquecida.quantidade,
        pecaMaisUrgente: proximaPeca,
        diasRestantes,
        vencido: (diasRestantes ?? 0) <= 0,
        filtroAr: enriquecida.filtroAr,
        filtroOleo: enriquecida.filtroOleo,
      }
    })

    itens.sort((a, b) => (a.diasRestantes ?? Infinity) - (b.diasRestantes ?? Infinity))
    return itens
  }),
})
