import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import {
  comprasCategorias,
  comprasCotacaoItens,
  comprasCotacoes,
  comprasFornecedores,
  comprasHistorico,
  comprasItens,
  comprasSolicitacoes,
  empresas,
  notifications,
  permissoesAdmin,
  users,
} from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'

// Setor de Compras — processo completo (pedido do João, 2026-11-04):
// Solicitação → Cotação → Negociação → Aprovação → Pedido de compra →
// Recebimento → Finalizado (+ Reprovado/Cancelado, que encerram).
//
// Quem faz o quê (Permissões, tabela permissoes_admin — vale pra admin E
// vendedor, não depende de role):
//   compras_solicitar  → abre solicitação e acompanha as PRÓPRIAS
//   compras_gestao     → comprador: vê todas, cota, negocia, emite pedido,
//                        recebe, cadastra fornecedor
//   compras_aprovar    → aprova / reprova / devolve pra negociar
//   compras_relatorios → dashboard e relatórios
// superAdmin sempre pode tudo. Papel 'gestor' sempre pode solicitar.
// Setor único do grupo: quem tem gestão/aprovação/relatórios vê as compras
// de TODAS as empresas (empresaId diz de qual é cada uma).

export const FEATURES_COMPRAS = ['compras_solicitar', 'compras_gestao', 'compras_aprovar', 'compras_relatorios'] as const
type FeatureCompras = (typeof FEATURES_COMPRAS)[number]

type Etapa = (typeof comprasSolicitacoes.$inferSelect)['etapa']

export const ETAPA_LABEL: Record<Etapa, string> = {
  solicitacao: 'Solicitação',
  cotacao: 'Cotação',
  negociacao: 'Negociação',
  aprovacao: 'Aprovação',
  pedido: 'Pedido de compra',
  recebimento: 'Recebimento',
  finalizado: 'Finalizado',
  reprovado: 'Reprovado',
  cancelado: 'Cancelado',
}

// Etapas em que a compra já "aconteceu" (pedido emitido) — é o que entra no
// total gasto. Mês = data do pedido.
const ETAPAS_COM_GASTO: Etapa[] = ['recebimento', 'finalizado']

type Acesso = { userId: number; superAdmin: boolean; solicitar: boolean; gestao: boolean; aprovar: boolean; relatorios: boolean }

async function acessoCompras(user: { id: number; superAdmin?: boolean | null; role: string }): Promise<Acesso> {
  if (user.superAdmin) return { userId: user.id, superAdmin: true, solicitar: true, gestao: true, aprovar: true, relatorios: true }
  const linhas = await db
    .select({ feature: permissoesAdmin.feature })
    .from(permissoesAdmin)
    .where(and(eq(permissoesAdmin.userId, user.id), inArray(permissoesAdmin.feature, [...FEATURES_COMPRAS])))
  const tem = new Set(linhas.map((l) => l.feature))
  return {
    userId: user.id,
    superAdmin: false,
    // Quem compra/aprova também pode abrir solicitação; gestor (papel) sempre.
    solicitar: tem.has('compras_solicitar') || tem.has('compras_gestao') || tem.has('compras_aprovar') || user.role === 'gestor',
    gestao: tem.has('compras_gestao'),
    aprovar: tem.has('compras_aprovar'),
    relatorios: tem.has('compras_relatorios'),
  }
}

const veTodas = (a: Acesso) => a.gestao || a.aprovar || a.relatorios

function comprasProcedure(...algumaDe: (FeatureCompras | 'ver_todas')[]) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const acesso = await acessoCompras(ctx.user)
    const ok = algumaDe.some((f) =>
      f === 'ver_todas'
        ? veTodas(acesso)
        : f === 'compras_solicitar'
          ? acesso.solicitar
          : f === 'compras_gestao'
            ? acesso.gestao
            : f === 'compras_aprovar'
              ? acesso.aprovar
              : acesso.relatorios
    )
    if (!ok) throw new TRPCError({ code: 'FORBIDDEN', message: 'Você não tem permissão pra essa ação de Compras.' })
    return next({ ctx: { ...ctx, acesso } })
  })
}

async function carregar(id: number) {
  const s = await db.query.comprasSolicitacoes.findFirst({ where: and(eq(comprasSolicitacoes.id, id), isNull(comprasSolicitacoes.deletedAt)) })
  if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: 'Compra não encontrada' })
  return s
}

function exigirEtapa(s: { etapa: Etapa }, ...etapas: Etapa[]) {
  if (!etapas.includes(s.etapa)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Essa ação não vale na etapa atual (${ETAPA_LABEL[s.etapa]}).`,
    })
  }
}

async function mudarEtapa(
  s: { id: number; etapa: Etapa },
  para: Etapa,
  userId: number,
  extra: Partial<typeof comprasSolicitacoes.$inferInsert> = {},
  texto?: string | null
) {
  const agora = agoraSqlite()
  await db
    .update(comprasSolicitacoes)
    .set({ ...extra, etapa: para, etapaDesde: agora, updatedAt: agora })
    .where(eq(comprasSolicitacoes.id, s.id))
  await db.insert(comprasHistorico).values({
    solicitacaoId: s.id,
    userId,
    tipo: 'etapa',
    deEtapa: s.etapa,
    paraEtapa: para,
    texto: texto?.trim() || null,
  })
}

async function usuariosComFeature(feature: FeatureCompras): Promise<number[]> {
  const linhas = await db
    .select({ id: users.id })
    .from(permissoesAdmin)
    .innerJoin(users, eq(users.id, permissoesAdmin.userId))
    .where(and(eq(permissoesAdmin.feature, feature), eq(users.isActive, true)))
  return [...new Set(linhas.map((l) => l.id))]
}

async function notificar(userIds: (number | null | undefined)[], titulo: string, mensagem: string, exceto?: number) {
  const ids = [...new Set(userIds.filter((u): u is number => !!u && u !== exceto))]
  if (!ids.length) return
  await db.insert(notifications).values(ids.map((vendedorId) => ({ vendedorId, type: 'compras', title: titulo, message: mensagem })))
}

const itemInput = z.object({
  descricao: z.string().trim().min(1, 'Descreva o item'),
  quantidade: z.number().positive('Quantidade precisa ser maior que zero'),
  unidade: z.string().trim().min(1).default('un'),
  codigo: z.string().trim().optional().nullable(),
  observacao: z.string().trim().optional().nullable(),
})

const camposSolicitacao = {
  empresaId: z.number(),
  tipo: z.enum(['revenda', 'uso_consumo']),
  categoriaId: z.number().nullable().optional(),
  titulo: z.string().trim().min(3, 'Dê um título curto pra compra'),
  justificativa: z.string().trim().optional().nullable(),
  prioridade: z.enum(['baixa', 'normal', 'urgente']).default('normal'),
  dataNecessidade: z.string().optional().nullable(),
  setor: z.string().trim().optional().nullable(),
  valorEstimado: z.number().nonnegative().optional().nullable(),
  itens: z.array(itemInput).min(1, 'Coloque pelo menos um item'),
}

const vazioParaNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)

// Valor efetivo de uma cotação (negociado, se tiver)
const valorEfetivo = (c: { valorTotal: number; valorNegociado: number | null }) => c.valorNegociado ?? c.valorTotal

function diasEntre(deIso: string, ateIso: string) {
  const a = new Date(deIso.slice(0, 10) + 'T12:00:00Z').getTime()
  const b = new Date(ateIso.slice(0, 10) + 'T12:00:00Z').getTime()
  return Math.round((b - a) / 86_400_000)
}

async function mapasAuxiliares() {
  const [listaUsers, listaEmpresas, listaFornecedores, listaCategorias] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users),
    db.select({ id: empresas.id, nome: empresas.nome, slug: empresas.slug }).from(empresas),
    db.select({ id: comprasFornecedores.id, nome: comprasFornecedores.nome }).from(comprasFornecedores),
    db.select({ id: comprasCategorias.id, nome: comprasCategorias.nome }).from(comprasCategorias),
  ])
  return {
    user: new Map(listaUsers.map((u) => [u.id, u.name])),
    empresa: new Map(listaEmpresas.map((e) => [e.id, e.nome])),
    fornecedor: new Map(listaFornecedores.map((f) => [f.id, f.nome])),
    categoria: new Map(listaCategorias.map((c) => [c.id, c.nome])),
  }
}

// Linha "resumida" de uma compra pra listas/Kanban.
async function montarLinhas(lista: (typeof comprasSolicitacoes.$inferSelect)[]) {
  if (!lista.length) return []
  const ids = lista.map((s) => s.id)
  const [m, itens, cotacoes] = await Promise.all([
    mapasAuxiliares(),
    db.select({ solicitacaoId: comprasItens.solicitacaoId, descricao: comprasItens.descricao }).from(comprasItens).where(inArray(comprasItens.solicitacaoId, ids)),
    db
      .select({ solicitacaoId: comprasCotacoes.solicitacaoId, valorTotal: comprasCotacoes.valorTotal, valorNegociado: comprasCotacoes.valorNegociado })
      .from(comprasCotacoes)
      .where(inArray(comprasCotacoes.solicitacaoId, ids)),
  ])
  const hoje = hojeBrString()
  return lista.map((s) => {
    const meusItens = itens.filter((i) => i.solicitacaoId === s.id)
    const minhasCot = cotacoes.filter((c) => c.solicitacaoId === s.id)
    const menorCotacao = minhasCot.length ? Math.min(...minhasCot.map(valorEfetivo)) : null
    const entregaAtrasada = s.etapa === 'recebimento' && !!s.previsaoEntrega && s.previsaoEntrega < hoje
    return {
      id: s.id,
      empresaId: s.empresaId,
      empresaNome: m.empresa.get(s.empresaId) ?? '—',
      tipo: s.tipo,
      categoriaId: s.categoriaId,
      categoriaNome: s.categoriaId ? (m.categoria.get(s.categoriaId) ?? null) : null,
      titulo: s.titulo,
      prioridade: s.prioridade,
      dataNecessidade: s.dataNecessidade,
      setor: s.setor,
      etapa: s.etapa,
      etapaDesde: s.etapaDesde,
      diasNaEtapa: Math.max(0, diasEntre(s.etapaDesde, hoje)),
      solicitanteId: s.solicitanteId,
      solicitanteNome: s.solicitanteId ? (m.user.get(s.solicitanteId) ?? '—') : '—',
      compradorNome: s.compradorId ? (m.user.get(s.compradorId) ?? null) : null,
      fornecedorNome: s.fornecedorId ? (m.fornecedor.get(s.fornecedorId) ?? null) : null,
      valorEstimado: s.valorEstimado,
      valorFinal: s.valorFinal,
      valorInicial: s.valorInicial,
      menorCotacao,
      qtdCotacoes: minhasCot.length,
      qtdItens: meusItens.length,
      resumoItens: meusItens
        .slice(0, 3)
        .map((i) => i.descricao)
        .join(', '),
      numeroPedido: s.numeroPedido,
      dataPedido: s.dataPedido,
      previsaoEntrega: s.previsaoEntrega,
      entregaAtrasada,
      diasAtraso: entregaAtrasada && s.previsaoEntrega ? diasEntre(s.previsaoEntrega, hoje) : 0,
      dataRecebimento: s.dataRecebimento,
      createdAt: s.createdAt,
    }
  })
}

const filtrosLista = z
  .object({
    empresaId: z.number().optional(),
    tipo: z.enum(['revenda', 'uso_consumo']).optional(),
    incluirEncerradas: z.boolean().optional(),
  })
  .optional()

export const comprasProcessoRouter = router({
  // O que o usuário logado pode fazer + listas auxiliares (empresas,
  // categorias, fornecedores ativos). Qualquer logado pode chamar — a tela
  // usa pra decidir o que mostrar.
  meuAcesso: protectedProcedure.query(async ({ ctx }) => acessoCompras(ctx.user)),

  auxiliares: comprasProcedure('compras_solicitar', 'ver_todas').query(async () => {
    const [listaEmpresas, categorias, fornecedores] = await Promise.all([
      db.select({ id: empresas.id, nome: empresas.nome, slug: empresas.slug }).from(empresas).orderBy(asc(empresas.nome)),
      db.select().from(comprasCategorias).orderBy(asc(comprasCategorias.nome)),
      db
        .select({
          id: comprasFornecedores.id,
          nome: comprasFornecedores.nome,
          condicaoPagamento: comprasFornecedores.condicaoPagamento,
          prazoEntregaDias: comprasFornecedores.prazoEntregaDias,
          ativo: comprasFornecedores.ativo,
        })
        .from(comprasFornecedores)
        .where(isNull(comprasFornecedores.deletedAt))
        .orderBy(asc(comprasFornecedores.nome)),
    ])
    return { empresas: listaEmpresas, categorias, fornecedores }
  }),

  // ── Solicitação ─────────────────────────────────────────────────────────
  solicitar: comprasProcedure('compras_solicitar')
    .input(z.object(camposSolicitacao))
    .mutation(async ({ ctx, input }) => {
      const r = await db.insert(comprasSolicitacoes).values({
        empresaId: input.empresaId,
        tipo: input.tipo,
        categoriaId: input.categoriaId ?? null,
        titulo: input.titulo.trim(),
        justificativa: vazioParaNull(input.justificativa),
        prioridade: input.prioridade,
        dataNecessidade: vazioParaNull(input.dataNecessidade),
        setor: vazioParaNull(input.setor),
        valorEstimado: input.valorEstimado ?? null,
        solicitanteId: ctx.user.id,
      })
      const id = Number(r.lastInsertRowid)
      await db.insert(comprasItens).values(
        input.itens.map((it, i) => ({
          solicitacaoId: id,
          descricao: it.descricao,
          quantidade: it.quantidade,
          unidade: it.unidade || 'un',
          codigo: vazioParaNull(it.codigo),
          observacao: vazioParaNull(it.observacao),
          ordem: i,
        }))
      )
      await db.insert(comprasHistorico).values({ solicitacaoId: id, userId: ctx.user.id, tipo: 'etapa', paraEtapa: 'solicitacao', texto: 'Solicitação aberta' })
      await notificar(
        await usuariosComFeature('compras_gestao'),
        `Nova solicitação de compra #${id}`,
        `${ctx.user.name ?? 'Alguém'} pediu: ${input.titulo}${input.prioridade === 'urgente' ? ' (URGENTE)' : ''}`,
        ctx.user.id
      )
      return { id }
    }),

  minhas: comprasProcedure('compras_solicitar').query(async ({ ctx }) => {
    const lista = await db
      .select()
      .from(comprasSolicitacoes)
      .where(and(eq(comprasSolicitacoes.solicitanteId, ctx.user.id), isNull(comprasSolicitacoes.deletedAt)))
      .orderBy(desc(comprasSolicitacoes.id))
    return montarLinhas(lista)
  }),

  // Todas as compras (Kanban do comprador / tela de aprovação)
  listar: comprasProcedure('ver_todas')
    .input(filtrosLista)
    .query(async ({ input }) => {
      const filtros = [isNull(comprasSolicitacoes.deletedAt)]
      if (input?.empresaId) filtros.push(eq(comprasSolicitacoes.empresaId, input.empresaId))
      if (input?.tipo) filtros.push(eq(comprasSolicitacoes.tipo, input.tipo))
      if (!input?.incluirEncerradas) {
        // Finalizadas/encerradas só dos últimos 30 dias, pra o quadro não crescer pra sempre
        const limite = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
        const abertas = inArray(comprasSolicitacoes.etapa, ['solicitacao', 'cotacao', 'negociacao', 'aprovacao', 'pedido', 'recebimento'])
        filtros.push(or(abertas, and(inArray(comprasSolicitacoes.etapa, ['finalizado', 'reprovado', 'cancelado']), eqOuDepois(limite)))!)
      }
      const lista = await db
        .select()
        .from(comprasSolicitacoes)
        .where(and(...filtros))
        .orderBy(desc(comprasSolicitacoes.id))
      return montarLinhas(lista)
    }),

  detalhe: comprasProcedure('compras_solicitar', 'ver_todas')
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      if (!veTodas(ctx.acesso) && s.solicitanteId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Essa compra não é sua.' })
      }
      const [m, itens, cotacoes, historico] = await Promise.all([
        mapasAuxiliares(),
        db.select().from(comprasItens).where(eq(comprasItens.solicitacaoId, s.id)).orderBy(asc(comprasItens.ordem), asc(comprasItens.id)),
        db.select().from(comprasCotacoes).where(eq(comprasCotacoes.solicitacaoId, s.id)).orderBy(asc(comprasCotacoes.id)),
        db.select().from(comprasHistorico).where(eq(comprasHistorico.solicitacaoId, s.id)).orderBy(desc(comprasHistorico.id)),
      ])
      const precos = cotacoes.length
        ? await db
            .select()
            .from(comprasCotacaoItens)
            .where(
              inArray(
                comprasCotacaoItens.cotacaoId,
                cotacoes.map((c) => c.id)
              )
            )
        : []
      const menor = cotacoes.length ? Math.min(...cotacoes.map(valorEfetivo)) : null
      const ehDono = s.solicitanteId === ctx.user.id
      return {
        ...s,
        empresaNome: m.empresa.get(s.empresaId) ?? '—',
        categoriaNome: s.categoriaId ? (m.categoria.get(s.categoriaId) ?? null) : null,
        solicitanteNome: s.solicitanteId ? (m.user.get(s.solicitanteId) ?? '—') : '—',
        compradorNome: s.compradorId ? (m.user.get(s.compradorId) ?? null) : null,
        aprovadoPorNome: s.aprovadoPor ? (m.user.get(s.aprovadoPor) ?? null) : null,
        recebidoPorNome: s.recebidoPor ? (m.user.get(s.recebidoPor) ?? null) : null,
        fornecedorNome: s.fornecedorId ? (m.fornecedor.get(s.fornecedorId) ?? null) : null,
        itens,
        cotacoes: cotacoes.map((c) => ({
          ...c,
          fornecedorNome: m.fornecedor.get(c.fornecedorId) ?? '—',
          valorEfetivo: valorEfetivo(c),
          maisBarata: menor != null && valorEfetivo(c) === menor,
          precos: Object.fromEntries(precos.filter((p) => p.cotacaoId === c.id).map((p) => [p.itemId, p.valorUnitario])),
          registradoPorNome: c.registradoPor ? (m.user.get(c.registradoPor) ?? null) : null,
        })),
        historico: historico.map((h) => ({ ...h, userNome: h.userId ? (m.user.get(h.userId) ?? '—') : 'Sistema' })),
        pode: {
          gerir: ctx.acesso.gestao,
          aprovar: ctx.acesso.aprovar,
          // Solicitante edita/cancela enquanto ninguém começou a cotar
          editar: ctx.acesso.gestao ? ['solicitacao', 'cotacao'].includes(s.etapa) : ehDono && s.etapa === 'solicitacao',
          cancelar: ['solicitacao', 'cotacao', 'negociacao', 'aprovacao', 'pedido'].includes(s.etapa) && (ctx.acesso.gestao || (ehDono && s.etapa === 'solicitacao')),
          excluir: ctx.acesso.superAdmin,
        },
      }
    }),

  editar: comprasProcedure('compras_solicitar', 'compras_gestao')
    .input(z.object({ id: z.number(), ...camposSolicitacao }))
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      const ehDono = s.solicitanteId === ctx.user.id
      if (ctx.acesso.gestao) exigirEtapa(s, 'solicitacao', 'cotacao')
      else if (ehDono) exigirEtapa(s, 'solicitacao')
      else throw new TRPCError({ code: 'FORBIDDEN', message: 'Essa compra não é sua.' })

      await db
        .update(comprasSolicitacoes)
        .set({
          empresaId: input.empresaId,
          tipo: input.tipo,
          categoriaId: input.categoriaId ?? null,
          titulo: input.titulo.trim(),
          justificativa: vazioParaNull(input.justificativa),
          prioridade: input.prioridade,
          dataNecessidade: vazioParaNull(input.dataNecessidade),
          setor: vazioParaNull(input.setor),
          valorEstimado: input.valorEstimado ?? null,
          updatedAt: agoraSqlite(),
        })
        .where(eq(comprasSolicitacoes.id, s.id))

      // Itens: troca a lista inteira só se mudou alguma coisa (preço unitário
      // das cotações é ligado ao id do item — refazer sem precisar apagaria).
      const atuais = await db.select().from(comprasItens).where(eq(comprasItens.solicitacaoId, s.id)).orderBy(asc(comprasItens.ordem), asc(comprasItens.id))
      const assinatura = (l: { descricao: string; quantidade: number; unidade: string; codigo?: string | null; observacao?: string | null }[]) =>
        JSON.stringify(l.map((i) => [i.descricao.trim(), i.quantidade, i.unidade, vazioParaNull(i.codigo), vazioParaNull(i.observacao)]))
      if (assinatura(atuais) !== assinatura(input.itens)) {
        await db.delete(comprasItens).where(eq(comprasItens.solicitacaoId, s.id))
        await db.insert(comprasItens).values(
          input.itens.map((it, i) => ({
            solicitacaoId: s.id,
            descricao: it.descricao,
            quantidade: it.quantidade,
            unidade: it.unidade || 'un',
            codigo: vazioParaNull(it.codigo),
            observacao: vazioParaNull(it.observacao),
            ordem: i,
          }))
        )
      }
      await db.insert(comprasHistorico).values({ solicitacaoId: s.id, userId: ctx.user.id, tipo: 'edicao', texto: 'Dados da solicitação editados' })
      return { ok: true }
    }),

  // ── Cotação ─────────────────────────────────────────────────────────────
  iniciarCotacao: comprasProcedure('compras_gestao')
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      exigirEtapa(s, 'solicitacao')
      await mudarEtapa(s, 'cotacao', ctx.user.id, { compradorId: ctx.user.id })
      await notificar([s.solicitanteId], `Compra #${s.id} em cotação`, `${ctx.user.name ?? 'Compras'} começou a cotar "${s.titulo}".`, ctx.user.id)
      return { ok: true }
    }),

  salvarCotacao: comprasProcedure('compras_gestao')
    .input(
      z.object({
        id: z.number().optional(),
        solicitacaoId: z.number(),
        fornecedorId: z.number(),
        valorTotal: z.number().nonnegative(),
        frete: z.number().nonnegative().nullable().optional(),
        prazoEntregaDias: z.number().int().nonnegative().nullable().optional(),
        condicaoPagamento: z.string().optional().nullable(),
        validade: z.string().optional().nullable(),
        observacoes: z.string().optional().nullable(),
        anexoUrl: z.string().optional().nullable(),
        anexoNome: z.string().optional().nullable(),
        // itemId → preço unitário (opcional)
        precos: z.array(z.object({ itemId: z.number(), valorUnitario: z.number().nonnegative() })).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.solicitacaoId)
      exigirEtapa(s, 'solicitacao', 'cotacao', 'negociacao')
      const campos = {
        fornecedorId: input.fornecedorId,
        valorTotal: input.valorTotal,
        frete: input.frete ?? null,
        prazoEntregaDias: input.prazoEntregaDias ?? null,
        condicaoPagamento: vazioParaNull(input.condicaoPagamento),
        validade: vazioParaNull(input.validade),
        observacoes: vazioParaNull(input.observacoes),
        anexoUrl: input.anexoUrl ?? null,
        anexoNome: input.anexoNome ?? null,
      }
      let cotacaoId = input.id
      if (cotacaoId) {
        const c = await db.query.comprasCotacoes.findFirst({ where: eq(comprasCotacoes.id, cotacaoId) })
        if (!c || c.solicitacaoId !== s.id) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cotação não encontrada' })
        await db.update(comprasCotacoes).set({ ...campos, updatedAt: agoraSqlite() }).where(eq(comprasCotacoes.id, cotacaoId))
        // Se era a escolhida, o valor da compra acompanha
        if (s.cotacaoEscolhidaId === cotacaoId) {
          await db
            .update(comprasSolicitacoes)
            .set({ fornecedorId: input.fornecedorId, valorInicial: input.valorTotal, valorFinal: c.valorNegociado ?? input.valorTotal })
            .where(eq(comprasSolicitacoes.id, s.id))
        }
      } else {
        const r = await db.insert(comprasCotacoes).values({ ...campos, solicitacaoId: s.id, registradoPor: ctx.user.id })
        cotacaoId = Number(r.lastInsertRowid)
        const fornecedor = await db.query.comprasFornecedores.findFirst({ where: eq(comprasFornecedores.id, input.fornecedorId) })
        await db.insert(comprasHistorico).values({
          solicitacaoId: s.id,
          userId: ctx.user.id,
          tipo: 'edicao',
          texto: `Cotação registrada: ${fornecedor?.nome ?? 'fornecedor'} — R$ ${input.valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        })
        // Lançar cotação já tira da fila de "Solicitação"
        if (s.etapa === 'solicitacao') await mudarEtapa(s, 'cotacao', ctx.user.id, { compradorId: s.compradorId ?? ctx.user.id })
      }
      if (input.precos) {
        const itensDaCompra = new Set(
          (await db.select({ id: comprasItens.id }).from(comprasItens).where(eq(comprasItens.solicitacaoId, s.id))).map((i) => i.id)
        )
        await db.delete(comprasCotacaoItens).where(eq(comprasCotacaoItens.cotacaoId, cotacaoId))
        const validos = input.precos.filter((p) => itensDaCompra.has(p.itemId))
        if (validos.length) await db.insert(comprasCotacaoItens).values(validos.map((p) => ({ cotacaoId: cotacaoId!, itemId: p.itemId, valorUnitario: p.valorUnitario })))
      }
      return { id: cotacaoId }
    }),

  removerCotacao: comprasProcedure('compras_gestao')
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const c = await db.query.comprasCotacoes.findFirst({ where: eq(comprasCotacoes.id, input.id) })
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cotação não encontrada' })
      const s = await carregar(c.solicitacaoId)
      exigirEtapa(s, 'cotacao', 'negociacao')
      if (s.cotacaoEscolhidaId === c.id) {
        await db
          .update(comprasSolicitacoes)
          .set({ cotacaoEscolhidaId: null, fornecedorId: null, valorFinal: null, valorInicial: null })
          .where(eq(comprasSolicitacoes.id, s.id))
      }
      await db.delete(comprasCotacoes).where(eq(comprasCotacoes.id, c.id))
      await db.insert(comprasHistorico).values({ solicitacaoId: s.id, userId: ctx.user.id, tipo: 'edicao', texto: 'Cotação removida' })
      return { ok: true }
    }),

  irParaNegociacao: comprasProcedure('compras_gestao')
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      exigirEtapa(s, 'cotacao')
      const qtd = (await db.select({ id: comprasCotacoes.id }).from(comprasCotacoes).where(eq(comprasCotacoes.solicitacaoId, s.id))).length
      if (!qtd) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Registre pelo menos uma cotação antes de negociar.' })
      await mudarEtapa(s, 'negociacao', ctx.user.id)
      return { ok: true }
    }),

  // ── Negociação ──────────────────────────────────────────────────────────
  negociar: comprasProcedure('compras_gestao')
    .input(z.object({ cotacaoId: z.number(), valorNegociado: z.number().nonnegative().nullable(), observacoes: z.string().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const c = await db.query.comprasCotacoes.findFirst({ where: eq(comprasCotacoes.id, input.cotacaoId) })
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cotação não encontrada' })
      const s = await carregar(c.solicitacaoId)
      exigirEtapa(s, 'cotacao', 'negociacao')
      await db
        .update(comprasCotacoes)
        .set({ valorNegociado: input.valorNegociado, ...(input.observacoes !== undefined ? { observacoes: vazioParaNull(input.observacoes) } : {}), updatedAt: agoraSqlite() })
        .where(eq(comprasCotacoes.id, c.id))
      if (s.cotacaoEscolhidaId === c.id) {
        await db.update(comprasSolicitacoes).set({ valorFinal: input.valorNegociado ?? c.valorTotal }).where(eq(comprasSolicitacoes.id, s.id))
      }
      const fornecedor = await db.query.comprasFornecedores.findFirst({ where: eq(comprasFornecedores.id, c.fornecedorId) })
      await db.insert(comprasHistorico).values({
        solicitacaoId: s.id,
        userId: ctx.user.id,
        tipo: 'edicao',
        texto:
          input.valorNegociado == null
            ? `Negociação desfeita (${fornecedor?.nome ?? ''})`
            : `Negociado com ${fornecedor?.nome ?? 'fornecedor'}: de R$ ${c.valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para R$ ${input.valorNegociado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      })
      return { ok: true }
    }),

  escolherCotacao: comprasProcedure('compras_gestao')
    .input(z.object({ cotacaoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const c = await db.query.comprasCotacoes.findFirst({ where: eq(comprasCotacoes.id, input.cotacaoId) })
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cotação não encontrada' })
      const s = await carregar(c.solicitacaoId)
      exigirEtapa(s, 'cotacao', 'negociacao')
      await db
        .update(comprasSolicitacoes)
        .set({
          cotacaoEscolhidaId: c.id,
          fornecedorId: c.fornecedorId,
          valorInicial: c.valorTotal,
          valorFinal: valorEfetivo(c),
          condicaoPagamento: c.condicaoPagamento ?? s.condicaoPagamento,
          updatedAt: agoraSqlite(),
        })
        .where(eq(comprasSolicitacoes.id, s.id))
      const fornecedor = await db.query.comprasFornecedores.findFirst({ where: eq(comprasFornecedores.id, c.fornecedorId) })
      await db.insert(comprasHistorico).values({ solicitacaoId: s.id, userId: ctx.user.id, tipo: 'edicao', texto: `Cotação escolhida: ${fornecedor?.nome ?? 'fornecedor'}` })
      return { ok: true }
    }),

  enviarAprovacao: comprasProcedure('compras_gestao')
    .input(z.object({ id: z.number(), observacao: z.string().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      exigirEtapa(s, 'cotacao', 'negociacao')
      if (!s.cotacaoEscolhidaId || s.valorFinal == null) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escolha a cotação vencedora antes de mandar pra aprovação.' })
      await mudarEtapa(s, 'aprovacao', ctx.user.id, {}, input.observacao)
      const fornecedor = s.fornecedorId ? await db.query.comprasFornecedores.findFirst({ where: eq(comprasFornecedores.id, s.fornecedorId) }) : null
      await notificar(
        await usuariosComFeature('compras_aprovar'),
        `Compra #${s.id} aguardando sua aprovação`,
        `${s.titulo} — ${fornecedor?.nome ?? ''} — R$ ${s.valorFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        ctx.user.id
      )
      return { ok: true }
    }),

  // ── Aprovação ───────────────────────────────────────────────────────────
  aprovar: comprasProcedure('compras_aprovar')
    .input(z.object({ id: z.number(), observacao: z.string().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      exigirEtapa(s, 'aprovacao')
      await mudarEtapa(
        s,
        'pedido',
        ctx.user.id,
        { aprovadoPor: ctx.user.id, aprovadoEm: agoraSqlite(), observacaoAprovacao: vazioParaNull(input.observacao) },
        input.observacao ? `Aprovada: ${input.observacao}` : 'Aprovada'
      )
      await notificar([s.solicitanteId, s.compradorId], `Compra #${s.id} aprovada`, `"${s.titulo}" foi aprovada. Próximo passo: emitir o pedido de compra.`, ctx.user.id)
      return { ok: true }
    }),

  reprovar: comprasProcedure('compras_aprovar')
    .input(z.object({ id: z.number(), motivo: z.string().trim().min(3, 'Diga o motivo') }))
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      exigirEtapa(s, 'aprovacao')
      await mudarEtapa(
        s,
        'reprovado',
        ctx.user.id,
        { aprovadoPor: ctx.user.id, aprovadoEm: agoraSqlite(), observacaoAprovacao: input.motivo, motivoEncerramento: input.motivo, finalizadoEm: agoraSqlite() },
        `Reprovada: ${input.motivo}`
      )
      await notificar([s.solicitanteId, s.compradorId], `Compra #${s.id} reprovada`, `"${s.titulo}": ${input.motivo}`, ctx.user.id)
      return { ok: true }
    }),

  // "Negocia mais" — volta pra Negociação com um recado pro comprador
  devolverNegociacao: comprasProcedure('compras_aprovar')
    .input(z.object({ id: z.number(), motivo: z.string().trim().min(3, 'Diga o que precisa melhorar') }))
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      exigirEtapa(s, 'aprovacao')
      await mudarEtapa(s, 'negociacao', ctx.user.id, {}, `Devolvida pra negociar: ${input.motivo}`)
      await notificar([s.compradorId], `Compra #${s.id} voltou pra negociação`, input.motivo, ctx.user.id)
      return { ok: true }
    }),

  // ── Pedido de compra ────────────────────────────────────────────────────
  registrarPedido: comprasProcedure('compras_gestao')
    .input(
      z.object({
        id: z.number(),
        numeroPedido: z.string().trim().min(1, 'Informe o número do pedido'),
        dataPedido: z.string().min(10),
        previsaoEntrega: z.string().optional().nullable(),
        condicaoPagamento: z.string().optional().nullable(),
        formaPagamento: z.string().optional().nullable(),
        valorFinal: z.number().nonnegative().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      exigirEtapa(s, 'pedido')
      await mudarEtapa(
        s,
        'recebimento',
        ctx.user.id,
        {
          numeroPedido: input.numeroPedido,
          dataPedido: input.dataPedido.slice(0, 10),
          previsaoEntrega: vazioParaNull(input.previsaoEntrega),
          condicaoPagamento: vazioParaNull(input.condicaoPagamento),
          formaPagamento: vazioParaNull(input.formaPagamento),
          ...(input.valorFinal != null ? { valorFinal: input.valorFinal } : {}),
        },
        `Pedido ${input.numeroPedido} emitido${input.previsaoEntrega ? ` · entrega prevista ${input.previsaoEntrega.split('-').reverse().join('/')}` : ''}`
      )
      await notificar([s.solicitanteId], `Compra #${s.id}: pedido emitido`, `"${s.titulo}" foi pedida ao fornecedor. Aguardando entrega.`, ctx.user.id)
      return { ok: true }
    }),

  // ── Recebimento ─────────────────────────────────────────────────────────
  // Completo → Finalizado. Parcial / com problema → continua em Recebimento
  // (fica na lista de entregas pendentes) até registrar de novo como completo.
  registrarRecebimento: comprasProcedure('compras_gestao')
    .input(
      z.object({
        id: z.number(),
        dataRecebimento: z.string().min(10),
        notaFiscal: z.string().optional().nullable(),
        situacao: z.enum(['completo', 'parcial', 'com_problema']),
        observacao: z.string().optional().nullable(),
        valorFinal: z.number().nonnegative().optional(),
        quantidades: z.array(z.object({ itemId: z.number(), quantidadeRecebida: z.number().nonnegative() })).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      exigirEtapa(s, 'recebimento')
      for (const q of input.quantidades ?? []) {
        await db
          .update(comprasItens)
          .set({ quantidadeRecebida: q.quantidadeRecebida })
          .where(and(eq(comprasItens.id, q.itemId), eq(comprasItens.solicitacaoId, s.id)))
      }
      const dados = {
        dataRecebimento: input.dataRecebimento.slice(0, 10),
        notaFiscal: vazioParaNull(input.notaFiscal),
        recebimentoSituacao: input.situacao,
        recebimentoObs: vazioParaNull(input.observacao),
        recebidoPor: ctx.user.id,
        ...(input.valorFinal != null ? { valorFinal: input.valorFinal } : {}),
      }
      if (input.situacao === 'completo') {
        await mudarEtapa(s, 'finalizado', ctx.user.id, { ...dados, finalizadoEm: agoraSqlite() }, `Recebido completo${input.notaFiscal ? ` · NF ${input.notaFiscal}` : ''}`)
        await notificar([s.solicitanteId], `Compra #${s.id} chegou`, `"${s.titulo}" foi recebida e finalizada.`, ctx.user.id)
      } else {
        await db.update(comprasSolicitacoes).set({ ...dados, updatedAt: agoraSqlite() }).where(eq(comprasSolicitacoes.id, s.id))
        await db.insert(comprasHistorico).values({
          solicitacaoId: s.id,
          userId: ctx.user.id,
          tipo: 'edicao',
          texto: `Recebimento ${input.situacao === 'parcial' ? 'parcial' : 'com problema'}${input.observacao ? `: ${input.observacao}` : ''}`,
        })
      }
      return { ok: true }
    }),

  // ── Voltar / cancelar / comentar ───────────────────────────────────────
  voltarEtapa: comprasProcedure('compras_gestao')
    .input(z.object({ id: z.number(), motivo: z.string().trim().min(3, 'Diga o motivo') }))
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      const anterior: Partial<Record<Etapa, Etapa>> = { cotacao: 'solicitacao', negociacao: 'cotacao', recebimento: 'pedido' }
      // Aprovação/pedido não voltam pelo comprador — quem decide é o aprovador
      const para = anterior[s.etapa]
      if (!para) throw new TRPCError({ code: 'BAD_REQUEST', message: `Não dá pra voltar a partir de ${ETAPA_LABEL[s.etapa]}.` })
      await mudarEtapa(s, para, ctx.user.id, {}, `Voltou: ${input.motivo}`)
      return { ok: true }
    }),

  cancelar: comprasProcedure('compras_solicitar', 'compras_gestao')
    .input(z.object({ id: z.number(), motivo: z.string().trim().min(3, 'Diga o motivo') }))
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      if (ctx.acesso.gestao) exigirEtapa(s, 'solicitacao', 'cotacao', 'negociacao', 'aprovacao', 'pedido')
      else if (s.solicitanteId === ctx.user.id) exigirEtapa(s, 'solicitacao')
      else throw new TRPCError({ code: 'FORBIDDEN', message: 'Essa compra não é sua.' })
      await mudarEtapa(s, 'cancelado', ctx.user.id, { motivoEncerramento: input.motivo, finalizadoEm: agoraSqlite() }, `Cancelada: ${input.motivo}`)
      await notificar([s.solicitanteId, s.compradorId], `Compra #${s.id} cancelada`, `"${s.titulo}": ${input.motivo}`, ctx.user.id)
      return { ok: true }
    }),

  comentar: comprasProcedure('compras_solicitar', 'ver_todas')
    .input(z.object({ id: z.number(), texto: z.string().trim().optional(), anexoUrl: z.string().optional(), anexoNome: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const s = await carregar(input.id)
      if (!veTodas(ctx.acesso) && s.solicitanteId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Essa compra não é sua.' })
      if (!input.texto && !input.anexoUrl) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escreva algo ou anexe um arquivo.' })
      await db.insert(comprasHistorico).values({
        solicitacaoId: s.id,
        userId: ctx.user.id,
        tipo: input.anexoUrl ? 'anexo' : 'comentario',
        texto: input.texto || null,
        anexoUrl: input.anexoUrl ?? null,
        anexoNome: input.anexoNome ?? null,
      })
      const destino = s.solicitanteId === ctx.user.id ? [s.compradorId] : [s.solicitanteId, s.compradorId]
      await notificar(destino, `Compra #${s.id}: novo comentário`, `${ctx.user.name ?? ''}: ${input.texto ?? input.anexoNome ?? 'anexo'}`, ctx.user.id)
      return { ok: true }
    }),

  excluir: comprasProcedure('compras_gestao')
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.acesso.superAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só o administrador geral exclui compra (use Cancelar).' })
      await carregar(input.id)
      await db.update(comprasSolicitacoes).set({ deletedAt: agoraSqlite() }).where(eq(comprasSolicitacoes.id, input.id))
      return { ok: true }
    }),

  // ── Fornecedores ────────────────────────────────────────────────────────
  fornecedores: comprasProcedure('ver_todas').query(async () => {
    const lista = await db.select().from(comprasFornecedores).where(isNull(comprasFornecedores.deletedAt)).orderBy(asc(comprasFornecedores.nome))
    const compras = await db
      .select({
        fornecedorId: comprasSolicitacoes.fornecedorId,
        valorFinal: comprasSolicitacoes.valorFinal,
        etapa: comprasSolicitacoes.etapa,
        dataPedido: comprasSolicitacoes.dataPedido,
        dataRecebimento: comprasSolicitacoes.dataRecebimento,
        previsaoEntrega: comprasSolicitacoes.previsaoEntrega,
      })
      .from(comprasSolicitacoes)
      .where(and(isNull(comprasSolicitacoes.deletedAt), inArray(comprasSolicitacoes.etapa, ETAPAS_COM_GASTO)))
    const cotacoes = await db.select({ fornecedorId: comprasCotacoes.fornecedorId }).from(comprasCotacoes)
    return lista.map((f) => {
      const minhas = compras.filter((c) => c.fornecedorId === f.id)
      const entregues = minhas.filter((c) => c.dataRecebimento && c.dataPedido)
      const noPrazo = entregues.filter((c) => !c.previsaoEntrega || c.dataRecebimento! <= c.previsaoEntrega)
      return {
        ...f,
        qtdCompras: minhas.length,
        totalComprado: minhas.reduce((t, c) => t + (c.valorFinal ?? 0), 0),
        qtdCotacoes: cotacoes.filter((c) => c.fornecedorId === f.id).length,
        ultimaCompra: minhas.map((c) => c.dataPedido).filter(Boolean).sort().at(-1) ?? null,
        prazoMedioReal: entregues.length ? Math.round(entregues.reduce((t, c) => t + diasEntre(c.dataPedido!, c.dataRecebimento!), 0) / entregues.length) : null,
        percNoPrazo: entregues.length ? Math.round((noPrazo.length / entregues.length) * 100) : null,
      }
    })
  }),

  salvarFornecedor: comprasProcedure('compras_gestao')
    .input(
      z.object({
        id: z.number().optional(),
        nome: z.string().trim().min(2, 'Informe o nome'),
        razaoSocial: z.string().optional().nullable(),
        cnpj: z.string().optional().nullable(),
        contato: z.string().optional().nullable(),
        telefone: z.string().optional().nullable(),
        email: z.string().optional().nullable(),
        cidade: z.string().optional().nullable(),
        uf: z.string().optional().nullable(),
        fornece: z.string().optional().nullable(),
        condicaoPagamento: z.string().optional().nullable(),
        prazoEntregaDias: z.number().int().nonnegative().optional().nullable(),
        avaliacao: z.number().int().min(1).max(5).optional().nullable(),
        observacoes: z.string().optional().nullable(),
        ativo: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const cnpj = input.cnpj ? input.cnpj.replace(/\D/g, '') || null : null
      if (cnpj) {
        const mesmo = await db.query.comprasFornecedores.findFirst({ where: and(eq(comprasFornecedores.cnpj, cnpj), isNull(comprasFornecedores.deletedAt)) })
        if (mesmo && mesmo.id !== input.id) throw new TRPCError({ code: 'CONFLICT', message: `Já existe fornecedor com esse CNPJ: ${mesmo.nome}` })
      }
      const campos = {
        nome: input.nome.trim(),
        razaoSocial: vazioParaNull(input.razaoSocial),
        cnpj,
        contato: vazioParaNull(input.contato),
        telefone: vazioParaNull(input.telefone),
        email: vazioParaNull(input.email),
        cidade: vazioParaNull(input.cidade),
        uf: vazioParaNull(input.uf)?.toUpperCase() ?? null,
        fornece: vazioParaNull(input.fornece),
        condicaoPagamento: vazioParaNull(input.condicaoPagamento),
        prazoEntregaDias: input.prazoEntregaDias ?? null,
        avaliacao: input.avaliacao ?? null,
        observacoes: vazioParaNull(input.observacoes),
        ativo: input.ativo,
      }
      if (input.id) {
        await db.update(comprasFornecedores).set({ ...campos, updatedAt: agoraSqlite() }).where(eq(comprasFornecedores.id, input.id))
        return { id: input.id }
      }
      const r = await db.insert(comprasFornecedores).values({ ...campos, criadoPor: ctx.user.id })
      return { id: Number(r.lastInsertRowid) }
    }),

  excluirFornecedor: comprasProcedure('compras_gestao')
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const usado = await db.query.comprasCotacoes.findFirst({ where: eq(comprasCotacoes.fornecedorId, input.id) })
      if (usado) {
        // Tem histórico — só desativa, pra não perder relatórios
        await db.update(comprasFornecedores).set({ ativo: false, updatedAt: agoraSqlite() }).where(eq(comprasFornecedores.id, input.id))
        return { desativado: true }
      }
      await db.update(comprasFornecedores).set({ deletedAt: agoraSqlite() }).where(eq(comprasFornecedores.id, input.id))
      return { desativado: false }
    }),

  // ── Categorias ──────────────────────────────────────────────────────────
  salvarCategoria: comprasProcedure('compras_gestao')
    .input(z.object({ id: z.number().optional(), nome: z.string().trim().min(2), tipo: z.enum(['revenda', 'uso_consumo', 'ambos']), ativo: z.boolean().default(true) }))
    .mutation(async ({ input }) => {
      if (input.id) {
        await db.update(comprasCategorias).set({ nome: input.nome, tipo: input.tipo, ativo: input.ativo }).where(eq(comprasCategorias.id, input.id))
        return { id: input.id }
      }
      const r = await db.insert(comprasCategorias).values({ nome: input.nome, tipo: input.tipo })
      return { id: Number(r.lastInsertRowid) }
    }),

  // ── Dashboard ───────────────────────────────────────────────────────────
  // Gasto = compras com pedido emitido (Recebimento ou Finalizado), no mês
  // da data do pedido, pelo valor final (cotação escolhida já negociada).
  dashboard: comprasProcedure('compras_relatorios', 'compras_aprovar', 'compras_gestao')
    .input(z.object({ empresaId: z.number().optional(), meses: z.number().int().min(3).max(24).default(12) }).optional())
    .query(async ({ input }) => {
      const meses = input?.meses ?? 12
      const hoje = hojeBrString()
      const mesAtual = hoje.slice(0, 7)
      const listaMeses: string[] = []
      {
        const [a, m] = mesAtual.split('-').map(Number)
        for (let i = meses - 1; i >= 0; i--) {
          const d = new Date(Date.UTC(a, m - 1 - i, 1))
          listaMeses.push(d.toISOString().slice(0, 7))
        }
      }
      const filtros = [isNull(comprasSolicitacoes.deletedAt)]
      if (input?.empresaId) filtros.push(eq(comprasSolicitacoes.empresaId, input.empresaId))
      const todas = await db.select().from(comprasSolicitacoes).where(and(...filtros))
      const linhas = await montarLinhas(todas)
      const comGasto = todas.filter((s) => ETAPAS_COM_GASTO.includes(s.etapa) && s.dataPedido)

      const porMes = listaMeses.map((mes) => {
        const doMes = comGasto.filter((s) => s.dataPedido!.startsWith(mes))
        const revenda = doMes.filter((s) => s.tipo === 'revenda').reduce((t, s) => t + (s.valorFinal ?? 0), 0)
        const usoConsumo = doMes.filter((s) => s.tipo === 'uso_consumo').reduce((t, s) => t + (s.valorFinal ?? 0), 0)
        return { mes, revenda, usoConsumo, total: revenda + usoConsumo, qtd: doMes.length }
      })
      const mesAnterior = porMes.at(-2) ?? null
      const doAno = comGasto.filter((s) => s.dataPedido!.startsWith(hoje.slice(0, 4)))

      const aprovacoesPendentes = linhas.filter((l) => l.etapa === 'aprovacao')
      const entregasPendentes = linhas.filter((l) => l.etapa === 'recebimento')
      const pedidosAEmitir = linhas.filter((l) => l.etapa === 'pedido')
      const semCotacao = linhas.filter((l) => l.etapa === 'solicitacao')

      const porEtapa = (['solicitacao', 'cotacao', 'negociacao', 'aprovacao', 'pedido', 'recebimento'] as Etapa[]).map((etapa) => {
        const l = linhas.filter((x) => x.etapa === etapa)
        return { etapa, qtd: l.length, valor: l.reduce((t, x) => t + (x.valorFinal ?? x.menorCotacao ?? x.valorEstimado ?? 0), 0) }
      })

      // Top fornecedores / categorias nos meses do gráfico
      const primeiroMes = listaMeses[0]
      const noPeriodo = comGasto.filter((s) => s.dataPedido!.slice(0, 7) >= primeiroMes)
      const m = await mapasAuxiliares()
      const agrupar = (chave: (s: (typeof noPeriodo)[number]) => string) => {
        const mapa = new Map<string, { nome: string; total: number; qtd: number }>()
        for (const s of noPeriodo) {
          const nome = chave(s)
          const atual = mapa.get(nome) ?? { nome, total: 0, qtd: 0 }
          atual.total += s.valorFinal ?? 0
          atual.qtd += 1
          mapa.set(nome, atual)
        }
        return [...mapa.values()].sort((a, b) => b.total - a.total)
      }

      return {
        meses: listaMeses,
        porMes,
        mesAtual: porMes.at(-1)!,
        mesAnterior,
        ano: {
          revenda: doAno.filter((s) => s.tipo === 'revenda').reduce((t, s) => t + (s.valorFinal ?? 0), 0),
          usoConsumo: doAno.filter((s) => s.tipo === 'uso_consumo').reduce((t, s) => t + (s.valorFinal ?? 0), 0),
          economia: doAno.reduce((t, s) => t + Math.max(0, (s.valorInicial ?? s.valorFinal ?? 0) - (s.valorFinal ?? 0)), 0),
        },
        aprovacoesPendentes: { qtd: aprovacoesPendentes.length, valor: aprovacoesPendentes.reduce((t, l) => t + (l.valorFinal ?? 0), 0), lista: aprovacoesPendentes },
        entregasPendentes: {
          qtd: entregasPendentes.length,
          atrasadas: entregasPendentes.filter((l) => l.entregaAtrasada).length,
          valor: entregasPendentes.reduce((t, l) => t + (l.valorFinal ?? 0), 0),
          lista: entregasPendentes.sort((a, b) => (a.previsaoEntrega ?? '9').localeCompare(b.previsaoEntrega ?? '9')),
        },
        pedidosAEmitir: { qtd: pedidosAEmitir.length, valor: pedidosAEmitir.reduce((t, l) => t + (l.valorFinal ?? 0), 0) },
        semCotacao: { qtd: semCotacao.length, maisAntigaDias: semCotacao.reduce((mx, l) => Math.max(mx, l.diasNaEtapa), 0) },
        porEtapa,
        topFornecedores: agrupar((s) => (s.fornecedorId ? (m.fornecedor.get(s.fornecedorId) ?? '—') : '—')).slice(0, 8),
        topCategorias: agrupar((s) => (s.categoriaId ? (m.categoria.get(s.categoriaId) ?? 'Sem categoria') : 'Sem categoria')).slice(0, 8),
      }
    }),

  // ── Relatórios ──────────────────────────────────────────────────────────
  relatorio: comprasProcedure('compras_relatorios', 'compras_aprovar', 'compras_gestao')
    .input(
      z.object({
        de: z.string().regex(/^\d{4}-\d{2}$/),
        ate: z.string().regex(/^\d{4}-\d{2}$/),
        empresaId: z.number().optional(),
        tipo: z.enum(['revenda', 'uso_consumo']).optional(),
        fornecedorId: z.number().optional(),
        categoriaId: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const filtros = [isNull(comprasSolicitacoes.deletedAt), inArray(comprasSolicitacoes.etapa, ETAPAS_COM_GASTO)]
      if (input.empresaId) filtros.push(eq(comprasSolicitacoes.empresaId, input.empresaId))
      if (input.tipo) filtros.push(eq(comprasSolicitacoes.tipo, input.tipo))
      if (input.fornecedorId) filtros.push(eq(comprasSolicitacoes.fornecedorId, input.fornecedorId))
      if (input.categoriaId) filtros.push(eq(comprasSolicitacoes.categoriaId, input.categoriaId))
      const brutas = (await db.select().from(comprasSolicitacoes).where(and(...filtros))).filter((s) => {
        const mes = s.dataPedido?.slice(0, 7)
        return !!mes && mes >= input.de && mes <= input.ate
      })
      const compras = (await montarLinhas(brutas)).sort((a, b) => (b.dataPedido ?? '').localeCompare(a.dataPedido ?? ''))

      type Grupo = { chave: string; nome: string; qtd: number; revenda: number; usoConsumo: number; total: number; economia: number }
      const agrupar = (chaveDe: (c: (typeof compras)[number]) => [string, string]) => {
        const mapa = new Map<string, Grupo>()
        for (const c of compras) {
          const [chave, nome] = chaveDe(c)
          const g = mapa.get(chave) ?? { chave, nome, qtd: 0, revenda: 0, usoConsumo: 0, total: 0, economia: 0 }
          const v = c.valorFinal ?? 0
          g.qtd += 1
          g.total += v
          if (c.tipo === 'revenda') g.revenda += v
          else g.usoConsumo += v
          g.economia += Math.max(0, (c.valorInicial ?? v) - v)
          mapa.set(chave, g)
        }
        return [...mapa.values()]
      }

      // Meses do intervalo, mesmo os sem compra
      const meses: string[] = []
      {
        let [a, m] = input.de.split('-').map(Number)
        const [aFim, mFim] = input.ate.split('-').map(Number)
        while (a < aFim || (a === aFim && m <= mFim)) {
          meses.push(`${a}-${String(m).padStart(2, '0')}`)
          m += 1
          if (m > 12) {
            m = 1
            a += 1
          }
          if (meses.length > 60) break
        }
      }
      const porMesMapa = new Map(agrupar((c) => [c.dataPedido!.slice(0, 7), c.dataPedido!.slice(0, 7)]).map((g) => [g.chave, g]))
      const porMes = meses.map((mes) => porMesMapa.get(mes) ?? { chave: mes, nome: mes, qtd: 0, revenda: 0, usoConsumo: 0, total: 0, economia: 0 })

      return {
        porMes,
        porFornecedor: agrupar((c) => [c.fornecedorNome ?? '—', c.fornecedorNome ?? '—']).sort((a, b) => b.total - a.total),
        porCategoria: agrupar((c) => [c.categoriaNome ?? 'Sem categoria', c.categoriaNome ?? 'Sem categoria']).sort((a, b) => b.total - a.total),
        porEmpresa: agrupar((c) => [c.empresaNome, c.empresaNome]).sort((a, b) => b.total - a.total),
        compras,
        totais: {
          qtd: compras.length,
          revenda: compras.filter((c) => c.tipo === 'revenda').reduce((t, c) => t + (c.valorFinal ?? 0), 0),
          usoConsumo: compras.filter((c) => c.tipo === 'uso_consumo').reduce((t, c) => t + (c.valorFinal ?? 0), 0),
          economia: compras.reduce((t, c) => t + Math.max(0, (c.valorInicial ?? c.valorFinal ?? 0) - (c.valorFinal ?? 0)), 0),
        },
      }
    }),

  // Aprovações e entregas pendentes (lista completa, sem filtro de período)
  pendencias: comprasProcedure('compras_relatorios', 'compras_aprovar', 'compras_gestao').query(async () => {
    const lista = await db
      .select()
      .from(comprasSolicitacoes)
      .where(and(isNull(comprasSolicitacoes.deletedAt), inArray(comprasSolicitacoes.etapa, ['aprovacao', 'pedido', 'recebimento'])))
    const linhas = await montarLinhas(lista)
    return {
      aprovacoes: linhas.filter((l) => l.etapa === 'aprovacao').sort((a, b) => b.diasNaEtapa - a.diasNaEtapa),
      pedidosAEmitir: linhas.filter((l) => l.etapa === 'pedido').sort((a, b) => b.diasNaEtapa - a.diasNaEtapa),
      entregas: linhas.filter((l) => l.etapa === 'recebimento').sort((a, b) => (a.previsaoEntrega ?? '9').localeCompare(b.previsaoEntrega ?? '9')),
    }
  }),
})

// Encerradas recentes: usa finalizadoEm (ou updatedAt) ≥ limite
function eqOuDepois(limite: string) {
  return or(
    and(isNull(comprasSolicitacoes.finalizadoEm), gte(comprasSolicitacoes.updatedAt, limite)),
    gte(comprasSolicitacoes.finalizadoEm, limite)
  )!
}
