// Créditos Odin + Pagamentos Odin (Financeiro) — pedido do João, 2026-11-26.
// Ver lib/revendaFinanceiro.ts (etapas, cálculo, integração com Pedidos).
//
// Cross-empresa como as outras telas do Financeiro (Controle SUFRAMA,
// Requisição Posto): quem tem a permissão vê tudo numa tela só, sem trocar de
// empresa ativa. As revendas são as da Odin Compressores.
//   creditos_odin          → Créditos Odin (registrar, analisar, abater)
//   creditos_odin_aprovar  → aprovar / recusar / devolver pra análise
//   pagamentos_odin        → Pagamentos Odin
import { z } from 'zod'
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, featureProcedure, temFeature } from './_base.js'
import { db } from '../db/client.js'
import {
  clientes,
  empresas,
  garantias,
  ordens,
  revendaCreditoMovimentos,
  revendaCreditos,
  revendaFinanceiroAnexos,
  revendaFinanceiroHistorico,
  revendaPagamentos,
  revendas,
  users,
} from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'
import {
  ETAPAS_PAGAMENTO_VALORES,
  ETAPAS_PAGAS,
  SLUG_ODIN,
  calcularComissao,
  etapasDoTipo,
  formatarBrl,
  registrarHistoricoRevenda,
  rotuloEtapa,
  type EtapaPagamento,
} from '../lib/revendaFinanceiro.js'

const F_CRED = 'creditos_odin'
const F_APROVAR = 'creditos_odin_aprovar'
const F_PAG = 'pagamentos_odin'

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const opt = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null)
const centavos = (v: number) => Math.round(v * 100) / 100

async function empresaOdinId(): Promise<number> {
  const e = await db.query.empresas.findFirst({ where: eq(empresas.slug, SLUG_ODIN), columns: { id: true } })
  if (!e) throw new TRPCError({ code: 'NOT_FOUND', message: 'Empresa Odin Compressores não encontrada' })
  return e.id
}

async function podeAprovar(user: { id: number; superAdmin: boolean }) {
  return user.superAdmin || (await temFeature(user.id, F_APROVAR))
}

async function revendaDaOdin(revendaId: number) {
  const r = await db.query.revendas.findFirst({ where: eq(revendas.id, revendaId) })
  if (!r || r.empresaId !== (await empresaOdinId())) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Revenda não encontrada' })
  return r
}

// Saldo de crédito por revenda: aprovados (ativos) − abatimentos + estornos.
// O uso de cada crédito é distribuído do mais antigo pro mais novo (FIFO).
async function calcularSaldos(revendaIds?: number[]) {
  const filtroRev = revendaIds?.length ? inArray(revendaCreditos.revendaId, revendaIds) : undefined
  const aprovados = await db
    .select({ id: revendaCreditos.id, revendaId: revendaCreditos.revendaId, valor: revendaCreditos.valorAprovado, decididoEm: revendaCreditos.decididoEm })
    .from(revendaCreditos)
    .where(and(eq(revendaCreditos.stage, 'aprovado'), eq(revendaCreditos.status, 'ativo'), filtroRev))
    .orderBy(asc(revendaCreditos.decididoEm), asc(revendaCreditos.id))
  const movs = await db
    .select({ revendaId: revendaCreditoMovimentos.revendaId, tipo: revendaCreditoMovimentos.tipo, valor: revendaCreditoMovimentos.valor })
    .from(revendaCreditoMovimentos)
    .where(and(isNull(revendaCreditoMovimentos.deletedAt), revendaIds?.length ? inArray(revendaCreditoMovimentos.revendaId, revendaIds) : undefined))

  const porRevenda = new Map<number, { aprovado: number; abatido: number; estornado: number }>()
  const pega = (id: number) => {
    let x = porRevenda.get(id)
    if (!x) porRevenda.set(id, (x = { aprovado: 0, abatido: 0, estornado: 0 }))
    return x
  }
  for (const a of aprovados) pega(a.revendaId).aprovado += a.valor ?? 0
  for (const m of movs) {
    if (m.tipo === 'abatimento') pega(m.revendaId).abatido += m.valor
    else pega(m.revendaId).estornado += m.valor
  }
  // Uso por crédito (FIFO): quanto do uso líquido da revenda cai em cada um.
  const usoPorCredito = new Map<number, number>()
  const restante = new Map<number, number>()
  for (const [id, x] of porRevenda) restante.set(id, Math.max(0, x.abatido - x.estornado))
  for (const a of aprovados) {
    const r = restante.get(a.revendaId) ?? 0
    const usa = Math.min(r, a.valor ?? 0)
    usoPorCredito.set(a.id, centavos(usa))
    restante.set(a.revendaId, r - usa)
  }
  const saldos = [...porRevenda].map(([revendaId, x]) => ({
    revendaId,
    aprovado: centavos(x.aprovado),
    utilizado: centavos(x.abatido - x.estornado),
    saldo: centavos(x.aprovado - x.abatido + x.estornado),
  }))
  return { saldos, usoPorCredito }
}

async function saldoDaRevenda(revendaId: number) {
  const { saldos } = await calcularSaldos([revendaId])
  return saldos[0]?.saldo ?? 0
}

async function nomesUsuarios(ids: (number | null | undefined)[]) {
  const unicos = [...new Set(ids.filter((x): x is number => !!x))]
  if (!unicos.length) return new Map<number, string>()
  const us = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unicos))
  return new Map(us.map((u) => [u.id, u.name]))
}

const anexoInput = z.object({
  nomeOriginal: z.string().min(1),
  nomeArmazenado: z.string().min(1),
  tipoArquivo: z.string().optional(),
  tamanhoBytes: z.number().optional(),
  categoria: z.enum(['nf', 'comprovante', 'outro']).default('outro'),
})

async function gravarAnexos(tipo: 'credito' | 'pagamento', refId: number, anexos: z.infer<typeof anexoInput>[], userId: number) {
  for (const a of anexos) {
    await db.insert(revendaFinanceiroAnexos).values({
      tipo,
      refId,
      categoria: a.categoria,
      nomeOriginal: a.nomeOriginal,
      nomeArmazenado: a.nomeArmazenado.replace(/^\/?uploads\//, ''),
      tipoArquivo: a.tipoArquivo ?? null,
      tamanhoBytes: a.tamanhoBytes ?? null,
      enviadoPor: userId,
    })
  }
}

async function obterCredito(id: number) {
  const c = await db.query.revendaCreditos.findFirst({ where: eq(revendaCreditos.id, id) })
  if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Crédito não encontrado' })
  return c
}

async function obterPagamento(id: number) {
  const p = await db.query.revendaPagamentos.findFirst({ where: eq(revendaPagamentos.id, id) })
  if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pagamento não encontrado' })
  return p
}

// Quem pode abrir anexos/histórico: quem tem a tela daquele tipo.
async function assertAcessoTipo(user: { id: number; superAdmin: boolean }, tipo: 'credito' | 'pagamento' | 'movimento') {
  if (user.superAdmin) return
  const f = tipo === 'pagamento' ? F_PAG : F_CRED
  if (!(await temFeature(user.id, f))) throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso restrito a esse setor' })
}

const creditoCampos = {
  revendaId: z.number(),
  clienteId: z.number().nullable().optional(),
  clienteNome: z.string().optional(),
  equipamento: z.string().optional(),
  numeroSerie: z.string().optional(),
  servicoExecutado: z.string().min(3, 'Descreva o serviço executado'),
  dataAtendimento: dia.nullable().optional(),
  garantiaId: z.number().nullable().optional(),
  valorSolicitado: z.number().positive('Informe o valor solicitado'),
  responsavelId: z.number().nullable().optional(),
}

const pagamentoCampos = {
  tipo: z.enum(['comissao', 'garantia']),
  revendaId: z.number().nullable().optional(),
  revendaNome: z.string().optional(),
  clienteId: z.number().nullable().optional(),
  clienteNome: z.string().optional(),
  numeroPedido: z.string().optional(),
  equipamento: z.string().optional(),
  descricao: z.string().optional(),
  valorVenda: z.number().nullable().optional(),
  comissaoModalidade: z.enum(['percentual', 'fixo']).nullable().optional(),
  comissaoPercentual: z.number().nullable().optional(),
  valor: z.number().positive('Informe o valor a pagar').optional(),
  observacoes: z.string().optional(),
  responsavelId: z.number().nullable().optional(),
  dataPrevistaPagamento: dia.nullable().optional(),
  nfNumero: z.string().optional(),
}

async function nomeClienteDoCrm(clienteId: number | null | undefined) {
  if (!clienteId) return null
  const c = await db.query.clientes.findFirst({ where: eq(clientes.id, clienteId), columns: { razaoSocial: true } })
  return c?.razaoSocial ?? null
}

export const revendaFinanceiroRouter = router({
  // O que a tela precisa pra montar filtros/formulários + o que a pessoa pode.
  contexto: adminProcedure.query(async ({ ctx }) => {
    const u = ctx.user
    const [cred, pag, aprovar] = await Promise.all([
      u.superAdmin || temFeature(u.id, F_CRED),
      u.superAdmin || temFeature(u.id, F_PAG),
      podeAprovar(u),
    ])
    if (!cred && !pag) throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso restrito a esse setor' })
    const odinId = await empresaOdinId()
    const listaRevendas = await db.select({ id: revendas.id, nome: revendas.nome, cidade: revendas.cidade, estado: revendas.estado }).from(revendas).where(eq(revendas.empresaId, odinId)).orderBy(asc(revendas.nome))
    const responsaveis = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.isActive, true), inArray(users.role, ['admin', 'gestor'])))
      .orderBy(asc(users.name))
    return { podeCreditos: !!cred, podePagamentos: !!pag, podeAprovar: aprovar, revendas: listaRevendas, responsaveis, meuId: u.id }
  }),

  buscarClientes: adminProcedure.input(z.object({ q: z.string().min(2) })).query(async ({ input }) => {
    const odinId = await empresaOdinId()
    const termo = `%${input.q.trim()}%`
    return db
      .select({ id: clientes.id, razaoSocial: clientes.razaoSocial, codigo: clientes.codigo, cidade: clientes.cidade, revendaId: clientes.revendaId })
      .from(clientes)
      .where(and(eq(clientes.empresaId, odinId), isNull(clientes.deletedAt), or(like(clientes.razaoSocial, termo), like(clientes.codigo, termo), like(clientes.cnpj, termo))))
      .orderBy(asc(clientes.razaoSocial))
      .limit(15)
  }),

  // Garantias do cliente (ou as mais recentes) pra ligar o crédito ao processo.
  buscarGarantias: featureProcedure(F_CRED).input(z.object({ clienteId: z.number().nullable().optional() })).query(async ({ input }) => {
    const odinId = await empresaOdinId()
    return db
      .select({ id: garantias.id, clienteNome: clientes.razaoSocial, modelo: garantias.modeloMaquina, numeroSerie: garantias.numeroSerie, stage: garantias.stage, createdAt: garantias.createdAt })
      .from(garantias)
      .leftJoin(clientes, eq(clientes.id, garantias.clienteId))
      .where(and(eq(garantias.empresaId, odinId), input.clienteId ? eq(garantias.clienteId, input.clienteId) : undefined))
      .orderBy(desc(garantias.id))
      .limit(40)
  }),

  // ── Créditos ──────────────────────────────────────────────────────────────
  listarCreditos: featureProcedure(F_CRED).query(async () => {
    const lista = await db
      .select({ c: revendaCreditos, revendaNome: revendas.nome })
      .from(revendaCreditos)
      .innerJoin(revendas, eq(revendas.id, revendaCreditos.revendaId))
      .orderBy(desc(revendaCreditos.id))
    const movs = await db
      .select({ m: revendaCreditoMovimentos, revendaNome: revendas.nome })
      .from(revendaCreditoMovimentos)
      .innerJoin(revendas, eq(revendas.id, revendaCreditoMovimentos.revendaId))
      .where(isNull(revendaCreditoMovimentos.deletedAt))
      .orderBy(desc(revendaCreditoMovimentos.data), desc(revendaCreditoMovimentos.id))
    const { saldos, usoPorCredito } = await calcularSaldos()
    const nomes = await nomesUsuarios([...lista.flatMap((x) => [x.c.criadoPor, x.c.responsavelId, x.c.decididoPor]), ...movs.map((x) => x.m.criadoPor)])
    const contagemAnexos = await db
      .select({ refId: revendaFinanceiroAnexos.refId, n: sql<number>`count(*)` })
      .from(revendaFinanceiroAnexos)
      .where(eq(revendaFinanceiroAnexos.tipo, 'credito'))
      .groupBy(revendaFinanceiroAnexos.refId)
    const nAnexos = new Map(contagemAnexos.map((x) => [x.refId, Number(x.n)]))
    return {
      creditos: lista.map(({ c, revendaNome }) => ({
        ...c,
        revendaNome,
        criadoPorNome: c.criadoPor ? (nomes.get(c.criadoPor) ?? null) : null,
        responsavelNome: c.responsavelId ? (nomes.get(c.responsavelId) ?? null) : null,
        decididoPorNome: c.decididoPor ? (nomes.get(c.decididoPor) ?? null) : null,
        utilizado: usoPorCredito.get(c.id) ?? 0,
        anexos: nAnexos.get(c.id) ?? 0,
      })),
      movimentos: movs.map(({ m, revendaNome }) => ({ ...m, revendaNome, criadoPorNome: m.criadoPor ? (nomes.get(m.criadoPor) ?? null) : null })),
      saldos,
    }
  }),

  criarCredito: featureProcedure(F_CRED)
    .input(z.object({ ...creditoCampos, observacao: z.string().optional(), anexos: z.array(anexoInput).default([]) }))
    .mutation(async ({ ctx, input }) => {
      const revenda = await revendaDaOdin(input.revendaId)
      const clienteNome = opt(input.clienteNome) ?? (await nomeClienteDoCrm(input.clienteId))
      if (!input.clienteId && !clienteNome) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe o cliente atendido' })
      const r = await db.insert(revendaCreditos).values({
        empresaId: revenda.empresaId,
        revendaId: revenda.id,
        clienteId: input.clienteId ?? null,
        clienteNome,
        equipamento: opt(input.equipamento),
        numeroSerie: opt(input.numeroSerie),
        servicoExecutado: input.servicoExecutado.trim(),
        dataAtendimento: input.dataAtendimento ?? null,
        garantiaId: input.garantiaId ?? null,
        valorSolicitado: centavos(input.valorSolicitado),
        analiseObservacao: opt(input.observacao),
        responsavelId: input.responsavelId ?? ctx.user.id,
        criadoPor: ctx.user.id,
      })
      const id = Number(r.lastInsertRowid)
      await gravarAnexos('credito', id, input.anexos, ctx.user.id)
      await registrarHistoricoRevenda({ tipo: 'credito', refId: id, revendaId: revenda.id, userId: ctx.user.id, descricao: `Solicitação registrada: ${formatarBrl(input.valorSolicitado)} — ${revenda.nome}`, stage: 'analise' })
      return { id }
    }),

  editarCredito: featureProcedure(F_CRED)
    .input(z.object({ id: z.number(), ...creditoCampos }))
    .mutation(async ({ ctx, input }) => {
      const c = await obterCredito(input.id)
      if (c.status !== 'ativo' || c.stage === 'aprovado' || c.stage === 'recusado') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Só dá pra editar enquanto está em análise ou aguardando aprovação' })
      const revenda = await revendaDaOdin(input.revendaId)
      const clienteNome = opt(input.clienteNome) ?? (await nomeClienteDoCrm(input.clienteId))
      const mud: string[] = []
      if (c.revendaId !== revenda.id) mud.push('revenda')
      if (c.valorSolicitado !== centavos(input.valorSolicitado)) mud.push(`valor solicitado ${formatarBrl(c.valorSolicitado)} → ${formatarBrl(input.valorSolicitado)}`)
      if (c.servicoExecutado !== input.servicoExecutado.trim()) mud.push('serviço executado')
      if ((c.clienteNome ?? null) !== clienteNome) mud.push('cliente')
      if ((c.equipamento ?? null) !== opt(input.equipamento) || (c.numeroSerie ?? null) !== opt(input.numeroSerie)) mud.push('equipamento')
      if ((c.garantiaId ?? null) !== (input.garantiaId ?? null)) mud.push('garantia ligada')
      if ((c.responsavelId ?? null) !== (input.responsavelId ?? null)) mud.push('responsável')
      if ((c.dataAtendimento ?? null) !== (input.dataAtendimento ?? null)) mud.push('data do atendimento')
      await db
        .update(revendaCreditos)
        .set({
          revendaId: revenda.id,
          clienteId: input.clienteId ?? null,
          clienteNome,
          equipamento: opt(input.equipamento),
          numeroSerie: opt(input.numeroSerie),
          servicoExecutado: input.servicoExecutado.trim(),
          dataAtendimento: input.dataAtendimento ?? null,
          garantiaId: input.garantiaId ?? null,
          valorSolicitado: centavos(input.valorSolicitado),
          responsavelId: input.responsavelId ?? null,
          updatedAt: agoraSqlite(),
        })
        .where(eq(revendaCreditos.id, c.id))
      if (mud.length) await registrarHistoricoRevenda({ tipo: 'credito', refId: c.id, revendaId: revenda.id, userId: ctx.user.id, descricao: `Editado: ${mud.join('; ')}`, stage: c.stage })
      return { ok: true }
    }),

  salvarAnalise: featureProcedure(F_CRED)
    .input(z.object({ id: z.number(), observacao: z.string(), enviarParaAprovacao: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const c = await obterCredito(input.id)
      if (c.status !== 'ativo' || c.stage !== 'analise') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Este crédito não está em análise' })
      const obs = opt(input.observacao)
      if (input.enviarParaAprovacao && !obs) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escreva o parecer da análise antes de enviar pra aprovação' })
      await db
        .update(revendaCreditos)
        .set({ analiseObservacao: obs, ...(input.enviarParaAprovacao ? { stage: 'aprovacao' as const } : {}), updatedAt: agoraSqlite() })
        .where(eq(revendaCreditos.id, c.id))
      if ((c.analiseObservacao ?? null) !== obs) await registrarHistoricoRevenda({ tipo: 'credito', refId: c.id, revendaId: c.revendaId, userId: ctx.user.id, descricao: `Análise: ${obs ?? '—'}`, stage: 'analise' })
      if (input.enviarParaAprovacao) await registrarHistoricoRevenda({ tipo: 'credito', refId: c.id, revendaId: c.revendaId, userId: ctx.user.id, descricao: 'Enviado pra aprovação', stage: 'aprovacao' })
      return { ok: true }
    }),

  decidirCredito: featureProcedure(F_CRED)
    .input(z.object({ id: z.number(), decisao: z.enum(['aprovar', 'nova_analise', 'recusar']), valorAprovado: z.number().positive().optional(), observacao: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await podeAprovar(ctx.user))) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só quem aprova créditos pode decidir' })
      const c = await obterCredito(input.id)
      if (c.status !== 'ativo' || c.stage !== 'aprovacao') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Este crédito não está aguardando aprovação' })
      const obs = opt(input.observacao)
      if (input.decisao === 'aprovar') {
        if (!input.valorAprovado) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe o valor aprovado' })
        await db
          .update(revendaCreditos)
          .set({ stage: 'aprovado', valorAprovado: centavos(input.valorAprovado), decisaoObservacao: obs, decididoPor: ctx.user.id, decididoEm: agoraSqlite(), updatedAt: agoraSqlite() })
          .where(eq(revendaCreditos.id, c.id))
        const parcial = centavos(input.valorAprovado) !== c.valorSolicitado ? ` (solicitado ${formatarBrl(c.valorSolicitado)})` : ''
        await registrarHistoricoRevenda({ tipo: 'credito', refId: c.id, revendaId: c.revendaId, userId: ctx.user.id, descricao: `Aprovado: ${formatarBrl(input.valorAprovado)}${parcial} vira crédito da revenda${obs ? ` — ${obs}` : ''}`, stage: 'aprovado' })
      } else {
        if (!obs) throw new TRPCError({ code: 'BAD_REQUEST', message: input.decisao === 'recusar' ? 'Escreva o motivo da recusa' : 'Escreva o que precisa ser revisto' })
        const stage = input.decisao === 'recusar' ? ('recusado' as const) : ('analise' as const)
        await db
          .update(revendaCreditos)
          .set({ stage, decisaoObservacao: obs, decididoPor: ctx.user.id, decididoEm: agoraSqlite(), updatedAt: agoraSqlite() })
          .where(eq(revendaCreditos.id, c.id))
        await registrarHistoricoRevenda({ tipo: 'credito', refId: c.id, revendaId: c.revendaId, userId: ctx.user.id, descricao: input.decisao === 'recusar' ? `Recusado: ${obs}` : `Devolvido pra análise (nova abordagem): ${obs}`, stage })
      }
      return { ok: true }
    }),

  cancelarCredito: featureProcedure(F_CRED)
    .input(z.object({ id: z.number(), motivo: z.string().min(3, 'Escreva o motivo') }))
    .mutation(async ({ ctx, input }) => {
      const c = await obterCredito(input.id)
      if (c.status !== 'ativo') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Já está cancelado' })
      if (c.stage === 'aprovado') {
        if (!(await podeAprovar(ctx.user))) throw new TRPCError({ code: 'FORBIDDEN', message: 'Crédito já liberado: só quem aprova pode cancelar' })
        const saldo = await saldoDaRevenda(c.revendaId)
        if (saldo - (c.valorAprovado ?? 0) < -0.005) throw new TRPCError({ code: 'BAD_REQUEST', message: `Parte deste crédito já foi usada (saldo da revenda: ${formatarBrl(saldo)}). Lance um estorno ou desfaça o abatimento antes.` })
      }
      await db.update(revendaCreditos).set({ status: 'cancelado', cancelMotivo: input.motivo.trim(), updatedAt: agoraSqlite() }).where(eq(revendaCreditos.id, c.id))
      await registrarHistoricoRevenda({ tipo: 'credito', refId: c.id, revendaId: c.revendaId, userId: ctx.user.id, descricao: `Cancelado: ${input.motivo.trim()}`, stage: c.stage })
      return { ok: true }
    }),

  // Abatimento (crédito usado numa compra) ou estorno (crédito devolvido).
  registrarMovimento: featureProcedure(F_CRED)
    .input(z.object({ revendaId: z.number(), tipo: z.enum(['abatimento', 'estorno']), valor: z.number().positive('Informe o valor'), data: dia, numeroPedido: z.string().optional(), descricao: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const revenda = await revendaDaOdin(input.revendaId)
      const valor = centavos(input.valor)
      const saldo = await saldoDaRevenda(revenda.id)
      if (input.tipo === 'abatimento' && valor > saldo + 0.005) throw new TRPCError({ code: 'BAD_REQUEST', message: `Saldo insuficiente: a revenda tem ${formatarBrl(saldo)} de crédito` })
      if (input.tipo === 'abatimento' && !opt(input.numeroPedido)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe o número do pedido/NF em que o crédito foi usado' })
      if (input.tipo === 'estorno' && !opt(input.descricao)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Explique o motivo do estorno' })
      const r = await db.insert(revendaCreditoMovimentos).values({
        empresaId: revenda.empresaId,
        revendaId: revenda.id,
        tipo: input.tipo,
        valor,
        data: input.data,
        numeroPedido: opt(input.numeroPedido),
        descricao: opt(input.descricao),
        criadoPor: ctx.user.id,
      })
      const novoSaldo = input.tipo === 'abatimento' ? saldo - valor : saldo + valor
      await registrarHistoricoRevenda({
        tipo: 'movimento',
        refId: Number(r.lastInsertRowid),
        revendaId: revenda.id,
        userId: ctx.user.id,
        descricao: `${input.tipo === 'abatimento' ? `Abatimento de ${formatarBrl(valor)} no pedido ${opt(input.numeroPedido)}` : `Estorno de ${formatarBrl(valor)}`} — saldo ${formatarBrl(saldo)} → ${formatarBrl(novoSaldo)}`,
      })
      return { ok: true }
    }),

  excluirMovimento: featureProcedure(F_CRED)
    .input(z.object({ id: z.number(), motivo: z.string().min(3, 'Escreva o motivo') }))
    .mutation(async ({ ctx, input }) => {
      const m = await db.query.revendaCreditoMovimentos.findFirst({ where: eq(revendaCreditoMovimentos.id, input.id) })
      if (!m || m.deletedAt) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lançamento não encontrado' })
      if (m.tipo === 'estorno') {
        const saldo = await saldoDaRevenda(m.revendaId)
        if (saldo - m.valor < -0.005) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tirar este estorno deixaria o saldo negativo' })
      }
      await db.update(revendaCreditoMovimentos).set({ deletedAt: agoraSqlite(), deletedPor: ctx.user.id }).where(eq(revendaCreditoMovimentos.id, m.id))
      await registrarHistoricoRevenda({ tipo: 'movimento', refId: m.id, revendaId: m.revendaId, userId: ctx.user.id, descricao: `${m.tipo === 'abatimento' ? 'Abatimento' : 'Estorno'} de ${formatarBrl(m.valor)} desfeito: ${input.motivo.trim()}` })
      return { ok: true }
    }),

  // Extrato da revenda: créditos liberados, abatimentos, estornos — em ordem.
  extratoRevenda: featureProcedure(F_CRED).input(z.object({ revendaId: z.number() })).query(async ({ input }) => {
    const creds = await db.query.revendaCreditos.findMany({ where: and(eq(revendaCreditos.revendaId, input.revendaId), eq(revendaCreditos.stage, 'aprovado')) })
    const movs = await db.query.revendaCreditoMovimentos.findMany({ where: eq(revendaCreditoMovimentos.revendaId, input.revendaId) })
    const nomes = await nomesUsuarios([...creds.map((c) => c.decididoPor), ...movs.flatMap((m) => [m.criadoPor, m.deletedPor])])
    const linhas = [
      ...creds.map((c) => ({
        data: (c.decididoEm ?? c.createdAt).slice(0, 10),
        ordem: c.decididoEm ?? c.createdAt,
        tipo: 'credito' as const,
        descricao: `Crédito #${c.id} liberado — ${c.servicoExecutado}${c.clienteNome ? ` (${c.clienteNome})` : ''}`,
        valor: c.status === 'ativo' ? (c.valorAprovado ?? 0) : 0,
        cancelado: c.status !== 'ativo' ? c.cancelMotivo : null,
        por: c.decididoPor ? (nomes.get(c.decididoPor) ?? null) : null,
      })),
      ...movs.map((m) => ({
        data: m.data,
        ordem: `${m.data} ${m.createdAt.slice(11)}`,
        tipo: m.tipo,
        descricao: m.tipo === 'abatimento' ? `Abatimento no pedido ${m.numeroPedido ?? '—'}${m.descricao ? ` — ${m.descricao}` : ''}` : `Estorno${m.descricao ? ` — ${m.descricao}` : ''}`,
        valor: m.deletedAt ? 0 : m.tipo === 'abatimento' ? -m.valor : m.valor,
        cancelado: m.deletedAt ? `desfeito por ${m.deletedPor ? (nomes.get(m.deletedPor) ?? '') : ''}` : null,
        por: m.criadoPor ? (nomes.get(m.criadoPor) ?? null) : null,
      })),
    ].sort((a, b) => a.ordem.localeCompare(b.ordem))
    let saldo = 0
    return linhas.map((l) => ({ ...l, saldo: centavos((saldo += l.valor)) }))
  }),

  // ── Pagamentos ────────────────────────────────────────────────────────────
  listarPagamentos: featureProcedure(F_PAG).query(async () => {
    const lista = await db
      .select({ p: revendaPagamentos, ordemStatus: ordens.status, ordemStage: ordens.stage })
      .from(revendaPagamentos)
      .leftJoin(ordens, eq(ordens.id, revendaPagamentos.ordemId))
      .orderBy(desc(revendaPagamentos.id))
    const nomes = await nomesUsuarios(lista.flatMap((x) => [x.p.criadoPor, x.p.responsavelId]))
    const contagem = await db
      .select({ refId: revendaFinanceiroAnexos.refId, categoria: revendaFinanceiroAnexos.categoria, n: sql<number>`count(*)` })
      .from(revendaFinanceiroAnexos)
      .where(eq(revendaFinanceiroAnexos.tipo, 'pagamento'))
      .groupBy(revendaFinanceiroAnexos.refId, revendaFinanceiroAnexos.categoria)
    const anexos = new Map<number, { nf: number; comprovante: number; outro: number }>()
    for (const x of contagem) {
      const a = anexos.get(x.refId) ?? { nf: 0, comprovante: 0, outro: 0 }
      a[x.categoria] += Number(x.n)
      anexos.set(x.refId, a)
    }
    return lista.map(({ p, ordemStatus, ordemStage }) => ({
      ...p,
      ordemStatus,
      ordemStage,
      criadoPorNome: p.criadoPor ? (nomes.get(p.criadoPor) ?? null) : null,
      responsavelNome: p.responsavelId ? (nomes.get(p.responsavelId) ?? null) : null,
      anexos: anexos.get(p.id) ?? { nf: 0, comprovante: 0, outro: 0 },
    }))
  }),

  criarPagamento: featureProcedure(F_PAG)
    .input(z.object({ ...pagamentoCampos, valor: z.number().positive('Informe o valor a pagar').optional(), anexos: z.array(anexoInput).default([]) }))
    .mutation(async ({ ctx, input }) => {
      const odinId = await empresaOdinId()
      let revendaNome = opt(input.revendaNome)
      if (input.revendaId) revendaNome = (await revendaDaOdin(input.revendaId)).nome
      if (!revendaNome) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escolha a revenda' })
      const clienteNome = opt(input.clienteNome) ?? (await nomeClienteDoCrm(input.clienteId))
      // Comissão manual: dá pra informar % sobre o valor da venda.
      const valor = input.valor ?? (input.tipo === 'comissao' && input.comissaoModalidade === 'percentual' ? calcularComissao(input.valorVenda, 'percentual', input.comissaoPercentual) : null)
      if (!valor) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe o valor a pagar' })
      if (!opt(input.descricao)) throw new TRPCError({ code: 'BAD_REQUEST', message: input.tipo === 'garantia' ? 'Descreva o serviço prestado' : 'Escreva o motivo do pagamento' })
      const r = await db.insert(revendaPagamentos).values({
        empresaId: odinId,
        tipo: input.tipo,
        origem: 'manual',
        revendaId: input.revendaId ?? null,
        revendaNome,
        clienteId: input.clienteId ?? null,
        clienteNome,
        numeroPedido: opt(input.numeroPedido),
        equipamento: opt(input.equipamento),
        descricao: opt(input.descricao),
        valorVenda: input.valorVenda ?? null,
        comissaoModalidade: input.tipo === 'comissao' ? (input.comissaoModalidade ?? null) : null,
        comissaoPercentual: input.tipo === 'comissao' && input.comissaoModalidade === 'percentual' ? (input.comissaoPercentual ?? null) : null,
        valor: centavos(valor),
        stage: 'comissao_registrada',
        observacoes: opt(input.observacoes),
        responsavelId: input.responsavelId ?? ctx.user.id,
        dataPrevistaPagamento: input.dataPrevistaPagamento ?? null,
        nfNumero: opt(input.nfNumero),
        criadoPor: ctx.user.id,
      })
      const id = Number(r.lastInsertRowid)
      await gravarAnexos('pagamento', id, input.anexos, ctx.user.id)
      await registrarHistoricoRevenda({ tipo: 'pagamento', refId: id, revendaId: input.revendaId ?? null, userId: ctx.user.id, descricao: `Cadastrado à mão (${input.tipo === 'comissao' ? 'comissão' : 'garantia'}): ${formatarBrl(valor)} — ${revendaNome}`, stage: 'comissao_registrada' })
      return { id }
    }),

  // Pagamento automático: os valores vêm do Pedido (mudam lá). Aqui só
  // responsável, observações, NF e data prevista. Manual: tudo.
  editarPagamento: featureProcedure(F_PAG)
    .input(z.object({ id: z.number(), ...pagamentoCampos, tipo: z.enum(['comissao', 'garantia']).optional() }))
    .mutation(async ({ ctx, input }) => {
      const p = await obterPagamento(input.id)
      if (p.status !== 'ativo') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pagamento cancelado' })
      const pago = ETAPAS_PAGAS.includes(p.stage as EtapaPagamento)
      const set: Partial<typeof revendaPagamentos.$inferInsert> = {
        observacoes: opt(input.observacoes),
        responsavelId: input.responsavelId ?? null,
        nfNumero: opt(input.nfNumero),
        dataPrevistaPagamento: input.dataPrevistaPagamento ?? null,
      }
      if (p.origem === 'manual' && !pago) {
        let revendaNome = opt(input.revendaNome) ?? p.revendaNome
        if (input.revendaId) revendaNome = (await revendaDaOdin(input.revendaId)).nome
        const valor = input.valor ?? (p.tipo === 'comissao' && input.comissaoModalidade === 'percentual' ? calcularComissao(input.valorVenda, 'percentual', input.comissaoPercentual) : null)
        if (!valor) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe o valor a pagar' })
        Object.assign(set, {
          revendaId: input.revendaId ?? null,
          revendaNome,
          clienteId: input.clienteId ?? null,
          clienteNome: opt(input.clienteNome) ?? (await nomeClienteDoCrm(input.clienteId)),
          numeroPedido: opt(input.numeroPedido),
          equipamento: opt(input.equipamento),
          descricao: opt(input.descricao) ?? p.descricao,
          valorVenda: input.valorVenda ?? null,
          comissaoModalidade: p.tipo === 'comissao' ? (input.comissaoModalidade ?? null) : null,
          comissaoPercentual: p.tipo === 'comissao' && input.comissaoModalidade === 'percentual' ? (input.comissaoPercentual ?? null) : null,
          valor: centavos(valor),
        })
      }
      const mud: string[] = []
      const rotulos: Record<string, string> = { observacoes: 'observações', responsavelId: 'responsável', nfNumero: 'nº da NF', dataPrevistaPagamento: 'data prevista', revendaNome: 'revenda', clienteNome: 'cliente', numeroPedido: 'nº do pedido', equipamento: 'equipamento', descricao: 'descrição', valorVenda: 'valor da venda', valor: 'valor a pagar' }
      for (const [k, v] of Object.entries(set)) {
        const antes = (p as Record<string, unknown>)[k] ?? null
        if (antes !== (v ?? null) && rotulos[k]) mud.push(k === 'valor' ? `valor a pagar ${formatarBrl(antes as number)} → ${formatarBrl(v as number)}` : rotulos[k])
      }
      await db.update(revendaPagamentos).set({ ...set, updatedAt: agoraSqlite() }).where(eq(revendaPagamentos.id, p.id))
      if (mud.length) await registrarHistoricoRevenda({ tipo: 'pagamento', refId: p.id, revendaId: p.revendaId, userId: ctx.user.id, descricao: `Editado: ${mud.join('; ')}`, stage: p.stage })
      return { ok: true }
    }),

  moverPagamento: featureProcedure(F_PAG)
    .input(z.object({ id: z.number(), stage: z.enum(ETAPAS_PAGAMENTO_VALORES), dataPrevistaPagamento: dia.optional(), dataPagamento: dia.optional(), nfNumero: z.string().optional(), observacao: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const p = await obterPagamento(input.id)
      if (p.status !== 'ativo') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pagamento cancelado' })
      if (!etapasDoTipo(p.tipo).includes(input.stage)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Essa etapa não vale pra pagamento de garantia' })
      if (input.stage === p.stage) return { ok: true }
      const dataPrevista = input.dataPrevistaPagamento ?? p.dataPrevistaPagamento
      const dataPagamento = input.dataPagamento ?? p.dataPagamento
      const nf = opt(input.nfNumero) ?? p.nfNumero
      const ordemEtapas = ETAPAS_PAGAMENTO_VALORES
      const idx = (s: string) => ordemEtapas.indexOf(s as EtapaPagamento)
      if (idx(input.stage) >= idx('pagamento_agendado') && !dataPrevista) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe a data prevista do pagamento' })
      if (idx(input.stage) >= idx('pagamento_realizado') && !dataPagamento) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe a data em que o pagamento foi feito' })
      const voltando = idx(input.stage) < idx(p.stage)
      await db
        .update(revendaPagamentos)
        .set({
          stage: input.stage,
          dataPrevistaPagamento: dataPrevista,
          // Voltou pra antes do pagamento → a data de quitação deixa de valer.
          dataPagamento: idx(input.stage) >= idx('pagamento_realizado') ? dataPagamento : null,
          nfNumero: nf,
          updatedAt: agoraSqlite(),
        })
        .where(eq(revendaPagamentos.id, p.id))
      const extras = [
        input.dataPrevistaPagamento && input.dataPrevistaPagamento !== p.dataPrevistaPagamento ? `previsto para ${input.dataPrevistaPagamento.split('-').reverse().join('/')}` : null,
        input.dataPagamento && idx(input.stage) >= idx('pagamento_realizado') ? `pago em ${input.dataPagamento.split('-').reverse().join('/')}` : null,
        opt(input.nfNumero) && opt(input.nfNumero) !== p.nfNumero ? `NF ${opt(input.nfNumero)}` : null,
        opt(input.observacao),
      ].filter(Boolean)
      await registrarHistoricoRevenda({
        tipo: 'pagamento',
        refId: p.id,
        revendaId: p.revendaId,
        userId: ctx.user.id,
        descricao: `${voltando ? 'Voltou' : 'Avançou'}: ${rotuloEtapa(p.stage, p.tipo)} → ${rotuloEtapa(input.stage, p.tipo)}${extras.length ? ` (${extras.join('; ')})` : ''}`,
        stage: input.stage,
      })
      return { ok: true }
    }),

  cancelarPagamento: featureProcedure(F_PAG)
    .input(z.object({ id: z.number(), motivo: z.string().min(3, 'Escreva o motivo') }))
    .mutation(async ({ ctx, input }) => {
      const p = await obterPagamento(input.id)
      if (p.status !== 'ativo') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Já está cancelado' })
      await db.update(revendaPagamentos).set({ status: 'cancelado', cancelMotivo: input.motivo.trim(), updatedAt: agoraSqlite() }).where(eq(revendaPagamentos.id, p.id))
      await registrarHistoricoRevenda({ tipo: 'pagamento', refId: p.id, revendaId: p.revendaId, userId: ctx.user.id, descricao: `Cancelado: ${input.motivo.trim()}`, stage: p.stage })
      return { ok: true }
    }),

  reabrirPagamento: featureProcedure(F_PAG)
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const p = await obterPagamento(input.id)
      if (p.status === 'ativo') return { ok: true }
      await db.update(revendaPagamentos).set({ status: 'ativo', cancelMotivo: null, updatedAt: agoraSqlite() }).where(eq(revendaPagamentos.id, p.id))
      await registrarHistoricoRevenda({ tipo: 'pagamento', refId: p.id, revendaId: p.revendaId, userId: ctx.user.id, descricao: 'Reaberto', stage: p.stage })
      return { ok: true }
    }),

  // ── Comum: histórico e anexos ─────────────────────────────────────────────
  historico: adminProcedure.input(z.object({ tipo: z.enum(['credito', 'pagamento']), refId: z.number() })).query(async ({ ctx, input }) => {
    await assertAcessoTipo(ctx.user, input.tipo)
    const rows = await db
      .select({ h: revendaFinanceiroHistorico, userName: users.name })
      .from(revendaFinanceiroHistorico)
      .leftJoin(users, eq(users.id, revendaFinanceiroHistorico.userId))
      .where(and(eq(revendaFinanceiroHistorico.tipo, input.tipo), eq(revendaFinanceiroHistorico.refId, input.refId)))
      .orderBy(desc(revendaFinanceiroHistorico.id))
    return rows.map(({ h, userName }) => ({ ...h, userName }))
  }),

  // Histórico só dos lançamentos de crédito (abatimentos/estornos) — aba Movimentações.
  historicoMovimentos: featureProcedure(F_CRED).query(async () => {
    const rows = await db
      .select({ h: revendaFinanceiroHistorico, userName: users.name, revendaNome: revendas.nome })
      .from(revendaFinanceiroHistorico)
      .leftJoin(users, eq(users.id, revendaFinanceiroHistorico.userId))
      .leftJoin(revendas, eq(revendas.id, revendaFinanceiroHistorico.revendaId))
      .where(inArray(revendaFinanceiroHistorico.tipo, ['credito', 'movimento']))
      .orderBy(desc(revendaFinanceiroHistorico.id))
      .limit(300)
    return rows.map(({ h, userName, revendaNome }) => ({ ...h, userName, revendaNome }))
  }),

  anexos: adminProcedure.input(z.object({ tipo: z.enum(['credito', 'pagamento']), refId: z.number() })).query(async ({ ctx, input }) => {
    await assertAcessoTipo(ctx.user, input.tipo)
    const rows = await db
      .select({ a: revendaFinanceiroAnexos, userName: users.name })
      .from(revendaFinanceiroAnexos)
      .leftJoin(users, eq(users.id, revendaFinanceiroAnexos.enviadoPor))
      .where(and(eq(revendaFinanceiroAnexos.tipo, input.tipo), eq(revendaFinanceiroAnexos.refId, input.refId)))
      .orderBy(desc(revendaFinanceiroAnexos.id))
    return rows.map(({ a, userName }) => ({ ...a, userName }))
  }),

  adicionarAnexo: adminProcedure
    .input(z.object({ tipo: z.enum(['credito', 'pagamento']), refId: z.number(), anexo: anexoInput }))
    .mutation(async ({ ctx, input }) => {
      await assertAcessoTipo(ctx.user, input.tipo)
      const ref = input.tipo === 'credito' ? await obterCredito(input.refId) : await obterPagamento(input.refId)
      await gravarAnexos(input.tipo, input.refId, [input.anexo], ctx.user.id)
      const cat = { nf: 'nota fiscal', comprovante: 'comprovante de pagamento', outro: 'arquivo' }[input.anexo.categoria]
      await registrarHistoricoRevenda({ tipo: input.tipo, refId: input.refId, revendaId: ref.revendaId, userId: ctx.user.id, descricao: `Anexou ${cat}: ${input.anexo.nomeOriginal}`, stage: ref.stage })
      return { ok: true }
    }),

  removerAnexo: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const a = await db.query.revendaFinanceiroAnexos.findFirst({ where: eq(revendaFinanceiroAnexos.id, input.id) })
    if (!a) throw new TRPCError({ code: 'NOT_FOUND', message: 'Anexo não encontrado' })
    await assertAcessoTipo(ctx.user, a.tipo)
    await db.delete(revendaFinanceiroAnexos).where(eq(revendaFinanceiroAnexos.id, a.id))
    await registrarHistoricoRevenda({ tipo: a.tipo, refId: a.refId, userId: ctx.user.id, descricao: `Tirou o anexo: ${a.nomeOriginal}` })
    return { ok: true }
  }),

  // Hoje (BR) pra preencher datas padrão na tela.
  hoje: adminProcedure.query(() => hojeBrString()),
})
