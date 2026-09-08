// Prospecção Odin Compressores — esteira da Bruna: ela cadastra clientes que
// já compraram máquinas nos últimos anos, liga/manda WhatsApp/e-mail,
// registra o retorno da empresa e a situação, classifica como Revenda ou
// Consumidor Final e, quando está tudo certo, envia pra carteira (vira
// cliente de verdade com card no Kanban).
//
// Só Odin Compressores (feature `prospeccao_odin`). A tela de Prospecção
// genérica (prospeccao.ts) fica ESCONDIDA pra essa empresa — ver
// `ocultoEmpresa` no Sidebar —, então não há sobreposição.
//
// Reaproveita do router `prospeccao` (genérico, protectedProcedure já
// escopado por empresa + dono): `descartar`, `registrarContato`,
// `listarRegistros`. Aqui ficam só as partes que mudam pro fluxo da Bruna
// (campos ricos no cadastro, filtros/busca, situação, classificação
// obrigatória ao enviar pra carteira).
import { z } from 'zod'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, carteiraHistorico, funilMensal, users, prospeccaoRegistros, empresas } from '../db/schema.js'
import { mesReferenciaAtual, agoraSqlite } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'

const SLUG_ODIN = 'odin-compressores'

const SITUACAO_VALUES = ['novo', 'em_negociacao', 'sem_interesse', 'retornar_depois', 'pronto_carteira'] as const
const CLASSIFICACAO_VALUES = ['revenda', 'consumidor_final'] as const

async function assertEmpresaOdin(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_ODIN) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
  }
}

async function carregarProspect(id: number, empresaId: number, userId: number, role: 'admin' | 'vendor') {
  const cliente = await db.query.clientes.findFirst({
    where: and(eq(clientes.id, id), eq(clientes.empresaId, empresaId), isNull(clientes.deletedAt)),
  })
  if (!cliente) throw new TRPCError({ code: 'NOT_FOUND', message: 'Prospect não encontrado' })
  if (role !== 'admin' && cliente.vendedorAtualId !== userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso negado' })
  }
  return cliente
}

// Erro de índice único (empresa_id + cnpj  /  empresa_id + codigo) vira uma
// mensagem que faz sentido pra quem tá cadastrando, não o texto cru do SQLite.
function traduzErroUnico(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('UNIQUE') && msg.includes('cnpj')) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Já existe um cliente com esse CNPJ nesta empresa.' })
  }
  if (msg.includes('UNIQUE') && msg.includes('codigo')) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Já existe um cliente com esse código nesta empresa.' })
  }
  throw e
}

const camposCliente = z.object({
  razaoSocial: z.string().trim().min(2, 'Informe o nome do cliente.'),
  cnpj: z.string().trim().optional(),
  codigo: z.string().trim().optional(),
  nomeContato: z.string().trim().optional(),
  telefoneWhatsapp: z.string().trim().optional(),
  email: z.string().trim().optional(),
  cidade: z.string().trim().optional(),
  estado: z.string().trim().optional(),
  classificacaoComercial: z.enum(CLASSIFICACAO_VALUES).optional(),
  prospeccaoSituacao: z.enum(SITUACAO_VALUES).optional(),
  observacoes: z.string().trim().optional(),
})

export const prospeccaoOdinRouter = router({
  // ── Lista com filtros/busca ────────────────────────────────────────────
  listar: adminOrFeatureProcedure('prospeccao_odin')
    .input(
      z
        .object({
          vendedorId: z.number().optional(),
          filtroPor: z.enum(['cadastro', 'ultimo_contato']).default('cadastro'),
          dataDe: z.string().optional(),
          dataAte: z.string().optional(),
          classificacao: z.enum(CLASSIFICACAO_VALUES).optional(),
          situacao: z.enum(SITUACAO_VALUES).optional(),
          busca: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      await assertEmpresaOdin(ctx.empresaId)
      const f = input ?? { filtroPor: 'cadastro' as const }

      const vendedorId = ctx.user.role === 'admin' ? f.vendedorId : ctx.user.id

      const base = await db.query.clientes.findMany({
        where: and(
          eq(clientes.empresaId, ctx.empresaId),
          eq(clientes.emProspeccao, true),
          isNull(clientes.deletedAt),
          ...(vendedorId ? [eq(clientes.vendedorAtualId, vendedorId)] : [])
        ),
        with: {
          telefonesExtras: { orderBy: (t, { asc }) => [asc(t.id)] },
          vendedorAtual: { columns: { id: true, name: true } },
        },
        orderBy: [desc(clientes.createdAt)],
      })

      // Nº de tentativas e data do último contato de cada prospect, numa
      // tacada só (a lista da Bruna é pequena — dezenas, não milhares).
      const ids = base.map((c) => c.id)
      const registros = ids.length
        ? await db.query.prospeccaoRegistros.findMany({
            where: inArray(prospeccaoRegistros.clienteId, ids),
            columns: { clienteId: true, tipo: true, createdAt: true },
          })
        : []
      const porCliente = new Map<number, { qtd: number; ultimo: string | null }>()
      for (const r of registros) {
        const cur = porCliente.get(r.clienteId) ?? { qtd: 0, ultimo: null }
        cur.qtd += 1
        if (!cur.ultimo || r.createdAt > cur.ultimo) cur.ultimo = r.createdAt
        porCliente.set(r.clienteId, cur)
      }

      let lista = base.map((c) => {
        const reg = porCliente.get(c.id)
        return { ...c, qtdTentativas: reg?.qtd ?? 0, ultimoContatoEm: reg?.ultimo ?? null }
      })

      if (f.classificacao) lista = lista.filter((c) => c.classificacaoComercial === f.classificacao)
      if (f.situacao) lista = lista.filter((c) => c.prospeccaoSituacao === f.situacao)

      const busca = f.busca?.trim().toLowerCase()
      if (busca) {
        lista = lista.filter((c) =>
          [c.razaoSocial, c.cnpj, c.codigo, c.nomeContato, c.cidade]
            .filter((v): v is string => !!v)
            .some((v) => v.toLowerCase().includes(busca))
        )
      }

      if (f.dataDe || f.dataAte) {
        lista = lista.filter((c) => {
          const ref = (f.filtroPor === 'ultimo_contato' ? c.ultimoContatoEm : c.createdAt)?.slice(0, 10)
          if (!ref) return false // sem contato ainda não entra num filtro por último contato
          if (f.dataDe && ref < f.dataDe) return false
          if (f.dataAte && ref > f.dataAte) return false
          return true
        })
      }

      return lista
    }),

  // ── Cadastro (campos ricos) ────────────────────────────────────────────
  criar: adminOrFeatureProcedure('prospeccao_odin')
    .input(camposCliente.extend({ vendedorId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOdin(ctx.empresaId)
      const vendedorAtualId = ctx.user.role === 'admin' && input.vendedorId ? input.vendedorId : ctx.user.id

      // Região é obrigatória na tabela de clientes — herda a do vendedor
      // responsável (todo vendedor real já tem uma configurada), igual o
      // cadastro rápido da Prospecção genérica.
      const vendedor = await db.query.users.findFirst({ where: eq(users.id, vendedorAtualId) })
      if (!vendedor?.regiao) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Esse vendedor não tem região configurada — ajuste antes de cadastrar prospects pra ele.',
        })
      }

      try {
        const result = await db.insert(clientes).values({
          empresaId: ctx.empresaId,
          razaoSocial: input.razaoSocial,
          cnpj: input.cnpj || null,
          codigo: input.codigo || `P${Date.now()}`,
          regiao: vendedor.regiao,
          estado: input.estado || null,
          cidade: input.cidade || null,
          telefoneWhatsapp: input.telefoneWhatsapp || null,
          email: input.email || null,
          nomeContato: input.nomeContato || null,
          observacoes: input.observacoes || null,
          classificacaoComercial: input.classificacaoComercial ?? null,
          prospeccaoSituacao: input.prospeccaoSituacao ?? 'novo',
          vendedorAtualId,
          cadastradoPor: ctx.user.id,
          emProspeccao: true,
        })
        return { id: Number(result.lastInsertRowid) }
      } catch (e) {
        traduzErroUnico(e)
      }
    }),

  // ── Edição ────────────────────────────────────────────────────────────
  atualizar: adminOrFeatureProcedure('prospeccao_odin')
    .input(camposCliente.partial().extend({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOdin(ctx.empresaId)
      const { id, ...campos } = input
      await carregarProspect(id, ctx.empresaId, ctx.user.id, ctx.user.role)

      const patch: Record<string, unknown> = { updatedAt: agoraSqlite() }
      // razaoSocial e codigo são NOT NULL — só troca se vier um valor de
      // verdade (campo vazio no formulário = "não mexe", nunca vira null).
      if (campos.razaoSocial) patch.razaoSocial = campos.razaoSocial
      if (campos.codigo) patch.codigo = campos.codigo
      if (campos.cnpj !== undefined) patch.cnpj = campos.cnpj || null
      if (campos.nomeContato !== undefined) patch.nomeContato = campos.nomeContato || null
      if (campos.telefoneWhatsapp !== undefined) patch.telefoneWhatsapp = campos.telefoneWhatsapp || null
      if (campos.email !== undefined) patch.email = campos.email || null
      if (campos.cidade !== undefined) patch.cidade = campos.cidade || null
      if (campos.estado !== undefined) patch.estado = campos.estado || null
      if (campos.observacoes !== undefined) patch.observacoes = campos.observacoes || null
      if (campos.classificacaoComercial !== undefined) patch.classificacaoComercial = campos.classificacaoComercial ?? null
      if (campos.prospeccaoSituacao !== undefined) patch.prospeccaoSituacao = campos.prospeccaoSituacao

      try {
        await db.update(clientes).set(patch).where(eq(clientes.id, id))
      } catch (e) {
        traduzErroUnico(e)
      }
      return { ok: true }
    }),

  // Troca rápida da situação direto na lista.
  mudarSituacao: adminOrFeatureProcedure('prospeccao_odin')
    .input(z.object({ id: z.number(), situacao: z.enum(SITUACAO_VALUES) }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOdin(ctx.empresaId)
      await carregarProspect(input.id, ctx.empresaId, ctx.user.id, ctx.user.role)
      await db
        .update(clientes)
        .set({ prospeccaoSituacao: input.situacao, updatedAt: agoraSqlite() })
        .where(eq(clientes.id, input.id))
      return { ok: true }
    }),

  // ── Enviar pra carteira ───────────────────────────────────────────────
  // Igual `prospeccao.enviarParaCarteira`, mas EXIGE a classificação
  // (Revenda/Consumidor Final) e, se o status fiscal ainda estiver vazio,
  // preenche a partir dela.
  enviarParaCarteira: adminOrFeatureProcedure('prospeccao_odin')
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOdin(ctx.empresaId)
      const cliente = await carregarProspect(input.id, ctx.empresaId, ctx.user.id, ctx.user.role)

      if (!cliente.emProspeccao) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esse cliente já está na carteira.' })
      if (!cliente.vendedorAtualId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Defina o vendedor responsável antes de enviar pra carteira.' })
      }
      if (!cliente.classificacaoComercial) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escolha Revenda ou Consumidor Final antes de enviar pra carteira.' })
      }

      const statusFiscal =
        cliente.statusFiscal ?? (cliente.classificacaoComercial === 'consumidor_final' ? 'consumidor_final' : 'normal')

      await db
        .update(clientes)
        .set({ emProspeccao: false, statusFiscal, updatedAt: agoraSqlite() })
        .where(eq(clientes.id, cliente.id))
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
})
