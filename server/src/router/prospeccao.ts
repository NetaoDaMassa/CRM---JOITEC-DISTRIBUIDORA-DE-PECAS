import { z } from 'zod'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, carteiraHistorico, funilMensal, users, prospeccaoRegistros } from '../db/schema.js'
import { mesReferenciaAtual, agoraSqlite } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { CANAL_ORIGEM_VALUES } from '../lib/canalOrigem.js'

async function assertProspectAlcancavel(clienteId: number, empresaId: number, userId: number, role: 'admin' | 'vendor') {
  const cliente = await db.query.clientes.findFirst({ where: and(eq(clientes.id, clienteId), eq(clientes.empresaId, empresaId)) })
  if (!cliente) throw new Error('Prospect não encontrado')
  if (role !== 'admin' && cliente.vendedorAtualId !== userId) throw new Error('Acesso negado')
  return cliente
}

// Prospects que o próprio vendedor caçou (Google, indicação etc.) — cadastro
// rápido (só nome + telefone), ficam fora do Kanban/funil normal até o
// vendedor decidir "enviar pra carteira". Nenhum `funil_mensal` é criado
// enquanto `emProspeccao` for true, então eles nunca aparecem no Kanban nem
// na lista normal de clientes (`clientes.list` já filtra emProspeccao=false).
export const prospeccaoRouter = router({
  listar: protectedProcedure.input(z.object({ vendedorId: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
    const vendedorId = ctx.user.role === 'admin' ? (input?.vendedorId ?? ctx.user.id) : ctx.user.id
    return db.query.clientes.findMany({
      where: and(
        eq(clientes.empresaId, ctx.empresaId),
        eq(clientes.vendedorAtualId, vendedorId),
        eq(clientes.emProspeccao, true),
        isNull(clientes.deletedAt)
      ),
      orderBy: [desc(clientes.createdAt)],
      with: { telefonesExtras: { orderBy: (t, { asc }) => [asc(t.id)] } },
    })
  }),

  criar: protectedProcedure
    .input(
      z.object({
        razaoSocial: z.string().min(2),
        telefoneWhatsapp: z.string().optional(),
        observacoes: z.string().optional(),
        canalOrigem: z.enum(CANAL_ORIGEM_VALUES),
        // Só o admin pode usar isso — cadastrar um prospect em nome de um
        // vendedor específico enquanto olha a lista dele (senão o prospect
        // nasceria na conta do próprio admin).
        vendedorId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const vendedorAtualId = ctx.user.role === 'admin' && input.vendedorId ? input.vendedorId : ctx.user.id

      // Região é obrigatória na tabela — pro cadastro de prospect ficar
      // rápido (só nome + telefone) sem pedir a região na hora, herda a do
      // próprio vendedor (todo vendedor real já tem uma região configurada).
      const vendedor = await db.query.users.findFirst({ where: eq(users.id, vendedorAtualId) })
      if (!vendedor?.regiao) {
        throw new Error('Este vendedor não tem uma região configurada — ajuste antes de cadastrar prospects pra ele.')
      }

      const result = await db.insert(clientes).values({
        empresaId: ctx.empresaId,
        razaoSocial: input.razaoSocial,
        codigo: `P${Date.now()}`,
        regiao: vendedor.regiao,
        telefoneWhatsapp: input.telefoneWhatsapp,
        observacoes: input.observacoes,
        canalOrigem: input.canalOrigem,
        vendedorAtualId,
        cadastradoPor: ctx.user.id,
        emProspeccao: true,
      })
      return { id: Number(result.lastInsertRowid) }
    }),

  enviarParaCarteira: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const cliente = await db.query.clientes.findFirst({
      where: and(eq(clientes.id, input.id), eq(clientes.empresaId, ctx.empresaId)),
    })
    if (!cliente) throw new Error('Prospect não encontrado')
    if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')
    if (!cliente.emProspeccao) throw new Error('Este cliente já está na carteira.')
    if (!cliente.vendedorAtualId) throw new Error('Defina um vendedor responsável antes de enviar pra carteira.')

    await db.update(clientes).set({ emProspeccao: false, updatedAt: agoraSqlite() }).where(eq(clientes.id, input.id))
    await db.insert(carteiraHistorico).values({ clienteId: cliente.id, vendedorId: cliente.vendedorAtualId })
    await db.insert(funilMensal).values({
      clienteId: cliente.id,
      vendedorId: cliente.vendedorAtualId,
      mesReferencia: mesReferenciaAtual(),
    })
    await registrarAuditoria({
      tabela: 'clientes',
      registroId: cliente.id,
      acao: 'editar',
      campo: 'em_prospeccao',
      valorAnterior: 'true',
      valorNovo: 'false',
      alteradoPor: ctx.user.id,
    })
    return { success: true }
  }),

  descartar: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const cliente = await db.query.clientes.findFirst({
      where: and(eq(clientes.id, input.id), eq(clientes.empresaId, ctx.empresaId)),
    })
    if (!cliente) throw new Error('Prospect não encontrado')
    if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')
    if (!cliente.emProspeccao) throw new Error('Só é possível descartar prospects que ainda não foram enviados pra carteira.')

    await db.update(clientes).set({ deletedAt: agoraSqlite() }).where(eq(clientes.id, input.id))
    return { success: true }
  }),

  // ── Linha do tempo de contatos/informações (aba Prospecção) ──────────────
  // Prospect não tem funilMensal aberto, então não reaproveita
  // `registroContato` — essa é a versão equivalente pra quem ainda tá em
  // prospecção. Pedido do João, 2026-09-02: registrar o que tá rolando com
  // cada prospect (ligação, whatsapp, e-mail, visita ou só uma nota solta),
  // pra todas as empresas que usam esse módulo.
  listarRegistros: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    await assertProspectAlcancavel(input.clienteId, ctx.empresaId, ctx.user.id, ctx.user.role)
    return db.query.prospeccaoRegistros.findMany({
      where: eq(prospeccaoRegistros.clienteId, input.clienteId),
      with: { registradoPor: { columns: { id: true, name: true } } },
      orderBy: [desc(prospeccaoRegistros.createdAt)],
    })
  }),

  registrarContato: protectedProcedure
    .input(
      z.object({
        clienteId: z.number(),
        tipo: z.enum(['ligacao', 'whatsapp', 'email', 'visita', 'nota']),
        observacao: z.string().min(1, 'Escreva o que aconteceu.'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProspectAlcancavel(input.clienteId, ctx.empresaId, ctx.user.id, ctx.user.role)
      await db.insert(prospeccaoRegistros).values({
        clienteId: input.clienteId,
        tipo: input.tipo,
        observacao: input.observacao.trim(),
        registradoPorId: ctx.user.id,
      })
      return { success: true }
    }),
})
