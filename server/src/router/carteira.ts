import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, carteiraHistorico, funilMensal, users } from '../db/schema.js'
import { mesReferenciaAtual, agoraSqlite } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { REGIAO_VALUES } from '../lib/regiao.js'

export async function validarVendedorDaEmpresa(vendedorId: number, empresaId: number) {
  const vendedor = await db.query.users.findFirst({ where: eq(users.id, vendedorId) })
  if (!vendedor || vendedor.empresaId !== empresaId) throw new Error('Vendedor inválido')
}

// `seAindaSemVendedor` faz a troca ser atômica — usada pelo autoatribuir do
// Banco de Clientes (clientes.bancoAutoAtribuir): sem isso, dois vendedores
// clicando em "pegar" o mesmo cliente quase ao mesmo tempo os dois passavam
// pela checagem de "ainda tá livre?" (feita antes, numa consulta separada)
// e os dois escreviam por cima um do outro — o segundo ganhava o cliente
// sem avisar ninguém, e o primeiro achava que tinha conseguido (recebia
// "sucesso") mas na real tinha perdido. Corrigido movendo a checagem pra
// dentro do próprio UPDATE (WHERE vendedor_atual_id IS NULL) — só um dos
// dois cliques consegue de verdade, o outro recebe `ok: false` e sabe na
// hora que precisa escolher outro cliente. Os outros chamadores (admin
// transferindo manualmente) não passam essa opção — comportamento
// inalterado pra eles, inclusive quando o cliente JÁ tem vendedor (é
// exatamente o caso de uso deles, transferir de um vendedor pra outro).
export async function transferirCliente(
  clienteId: number,
  novoVendedorId: number,
  alteradoPor: number,
  opts?: { seAindaSemVendedor?: boolean }
): Promise<{ ok: boolean }> {
  const mesAtual = mesReferenciaAtual()
  const condicoesUpdate = [eq(clientes.id, clienteId)]
  if (opts?.seAindaSemVendedor) condicoesUpdate.push(isNull(clientes.vendedorAtualId))
  const resultado = await db.update(clientes).set({ vendedorAtualId: novoVendedorId }).where(and(...condicoesUpdate))
  if (opts?.seAindaSemVendedor && resultado.rowsAffected === 0) return { ok: false }

  await db.insert(carteiraHistorico).values({ clienteId, vendedorId: novoVendedorId })

  // O card do mês precisa acompanhar a transferência — senão o cliente some
  // do Kanban de todo mundo (o vendedor antigo não devia mais ver, e o novo
  // nunca chegava a ver, já que o card ficava com o vendedor_id de quem não
  // é mais o dono da carteira).
  const funilExistente = await db.query.funilMensal.findFirst({
    where: and(eq(funilMensal.clienteId, clienteId), eq(funilMensal.mesReferencia, mesAtual), isNull(funilMensal.deletedAt)),
  })
  if (funilExistente) {
    if (funilExistente.vendedorId !== novoVendedorId) {
      await db.update(funilMensal).set({ vendedorId: novoVendedorId }).where(eq(funilMensal.id, funilExistente.id))
    }
  } else {
    await db.insert(funilMensal).values({ clienteId, vendedorId: novoVendedorId, mesReferencia: mesAtual })
  }

  await registrarAuditoria({
    tabela: 'clientes',
    registroId: clienteId,
    acao: 'transferir_carteira',
    campo: 'vendedor_atual_id',
    valorNovo: String(novoVendedorId),
    alteradoPor,
  })
  return { ok: true }
}

// Tira o cliente da carteira de quem for (sem escolher destino) — volta pro
// Banco de Clientes, igual um cliente importado sem vendedor. O card do mês
// some do Kanban (soft-delete), já que Banco de Clientes não tem funil
// aberto — o próximo admin que atribuir um vendedor cria um novo. Extraída
// à parte (não só na mutation `moverParaBanco`) pra ser reaproveitada
// também quando o admin aprova um pedido de transferência sem escolher um
// vendedor específico de destino (aprovacoes.ts).
export async function moverClienteParaBanco(clienteId: number, rotulo: string | undefined, alteradoPor: number) {
  const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, clienteId) })
  if (!cliente) throw new Error('Cliente não encontrado')

  await db
    .update(clientes)
    .set({ vendedorAtualId: null, origemBanco: rotulo ?? null })
    .where(eq(clientes.id, clienteId))

  const mesAtual = mesReferenciaAtual()
  const funilExistente = await db.query.funilMensal.findFirst({
    where: and(eq(funilMensal.clienteId, clienteId), eq(funilMensal.mesReferencia, mesAtual), isNull(funilMensal.deletedAt)),
  })
  if (funilExistente) {
    await db.update(funilMensal).set({ deletedAt: agoraSqlite() }).where(eq(funilMensal.id, funilExistente.id))
  }

  await registrarAuditoria({
    tabela: 'clientes',
    registroId: clienteId,
    acao: 'transferir_carteira',
    campo: 'vendedor_atual_id',
    valorAnterior: cliente.vendedorAtualId ? String(cliente.vendedorAtualId) : null,
    valorNovo: null,
    alteradoPor,
  })
}

export const carteiraRouter = router({
  atribuirPorRegiao: adminProcedure
    .input(z.object({ regiao: z.enum(REGIAO_VALUES), vendedorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await validarVendedorDaEmpresa(input.vendedorId, ctx.empresaId)
      const semDono = await db.query.clientes.findMany({
        where: and(
          eq(clientes.regiao, input.regiao),
          isNull(clientes.vendedorAtualId),
          isNull(clientes.deletedAt),
          eq(clientes.empresaId, ctx.empresaId)
        ),
      })
      for (const cliente of semDono) {
        await transferirCliente(cliente.id, input.vendedorId, ctx.user.id)
      }
      return { quantidade: semDono.length }
    }),

  redistribuirCompleta: adminProcedure
    .input(z.object({ deVendedorId: z.number(), paraVendedorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await validarVendedorDaEmpresa(input.deVendedorId, ctx.empresaId)
      await validarVendedorDaEmpresa(input.paraVendedorId, ctx.empresaId)
      const clientesDoVendedor = await db.query.clientes.findMany({
        where: and(
          eq(clientes.vendedorAtualId, input.deVendedorId),
          isNull(clientes.deletedAt),
          eq(clientes.empresaId, ctx.empresaId)
        ),
      })
      for (const cliente of clientesDoVendedor) {
        await transferirCliente(cliente.id, input.paraVendedorId, ctx.user.id)
      }
      return { quantidade: clientesDoVendedor.length }
    }),

  // Mesma ideia do redistribuirCompleta, mas o destino é o Banco de Clientes
  // em vez de outro vendedor — usado quando o vendedor sai da empresa ou fica
  // temporariamente sem carteira. `rotulo` vira a origem exibida no Banco de
  // Clientes (filtro por "banco"); sem rotulo, cai no nome do próprio
  // vendedor de origem, igual o padrão do moverParaBanco individual.
  redistribuirParaBanco: adminProcedure
    .input(z.object({ deVendedorId: z.number(), rotulo: z.string().trim().optional() }))
    .mutation(async ({ ctx, input }) => {
      await validarVendedorDaEmpresa(input.deVendedorId, ctx.empresaId)
      const vendedor = await db.query.users.findFirst({ where: eq(users.id, input.deVendedorId) })
      const clientesDoVendedor = await db.query.clientes.findMany({
        where: and(
          eq(clientes.vendedorAtualId, input.deVendedorId),
          isNull(clientes.deletedAt),
          eq(clientes.empresaId, ctx.empresaId)
        ),
      })
      const rotulo = input.rotulo || vendedor?.name
      for (const cliente of clientesDoVendedor) {
        await moverClienteParaBanco(cliente.id, rotulo, ctx.user.id)
      }
      return { quantidade: clientesDoVendedor.length }
    }),

  transferirIndividual: adminProcedure
    .input(z.object({ clienteId: z.number(), vendedorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const cliente = await db.query.clientes.findFirst({
        where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId)),
      })
      if (!cliente) throw new Error('Cliente não encontrado')
      await validarVendedorDaEmpresa(input.vendedorId, ctx.empresaId)

      await transferirCliente(input.clienteId, input.vendedorId, ctx.user.id)
      return { success: true }
    }),

  // Tira o cliente da carteira de quem for (sem escolher destino) — volta
  // pro Banco de Clientes, igual um cliente importado sem vendedor. O card
  // do mês some do Kanban (soft-delete), já que Banco de Clientes não tem
  // funil aberto — o próximo admin que atribuir um vendedor cria um novo.
  moverParaBanco: adminProcedure
    .input(z.object({ clienteId: z.number(), rotulo: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const cliente = await db.query.clientes.findFirst({
        where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId)),
      })
      if (!cliente) throw new Error('Cliente não encontrado')

      await moverClienteParaBanco(input.clienteId, input.rotulo, ctx.user.id)
      return { success: true }
    }),

  desativarVendedor: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await validarVendedorDaEmpresa(input.id, ctx.empresaId)

    const ativos = await db.query.clientes.findMany({
      where: and(eq(clientes.vendedorAtualId, input.id), isNull(clientes.deletedAt)),
      columns: { id: true },
    })
    if (ativos.length > 0) {
      throw new Error(`Este vendedor ainda tem ${ativos.length} cliente(s) na carteira. Redistribua antes de desativar.`)
    }

    await db.update(users).set({ isActive: false }).where(eq(users.id, input.id))
    return { success: true }
  }),
})
