// Pós-venda de máquina + Agendamentos de peças + relatórios (Odin
// Compressores) — pedido do João, 2026-10-29. Regras em lib/posVendaOdin.ts.
import { z } from 'zod'
import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, publicProcedure, protectedProcedure, adminProcedure, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import {
  agendamentoPecasContatos,
  agendamentosPecas,
  clientes,
  empresas,
  ordemAnexos,
  ordemHistorico,
  ordemMaquinas,
  ordemPosVenda,
  ordemRastreio,
  ordens,
  posVendaDocumentos,
  revendas,
  posVendaPesquisas,
  users,
} from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'
import { getConfigNumero, setConfig } from '../lib/configuracoes.js'
import {
  chaveDiasPrimeiroContato,
  chaveVendedorPecas,
  concluirPedidoPelaPesquisa,
  documentoValeParaModelos,
  DIAS_PRIMEIRO_CONTATO_PADRAO,
  criarAgendamentoDaOrdem,
  obterOuCriarPesquisa,
  respostaPedeAtencao,
  revendaDaOrdem,
  tipoPedidoMaquina,
  vendedorPecasPadrao,
} from '../lib/posVendaOdin.js'
import { assertEmpresaOrdens, assertOrdemAlcancavel } from './ordens/core.js'
import { avancarEtapaPedido } from '../lib/ordensGates.js'

const nota = z.number().int().min(1).max(5)
const respostaSchema = z.object({
  notaOdin: nota,
  notaTransportadora: nota,
  // Peça não tem técnico de partida — só máquina responde essa.
  notaTecnico: nota.optional(),
  atendeu: z.enum(['sim', 'parcial', 'nao']),
  comentario: z.string().max(2000).optional(),
  querContato: z.boolean(),
})

const filtroPeriodo = z.object({ dataDe: z.string().optional(), dataAte: z.string().optional() }).optional()

// Dia BR → faixa UTC (mesma conta de lib/controlePedidosOdin.ts).
function faixaUtc(de?: string, ate?: string) {
  const proximoDia = (dia: string) => new Date(new Date(`${dia}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
  return { de: de ? `${de} 03:00:00` : null, ate: ate ? `${proximoDia(ate)} 03:00:00` : null }
}

const media = (ns: (number | null)[]) => {
  const v = ns.filter((n): n is number => n != null)
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null
}

async function modelosDaOrdem(ordemId: number) {
  return db.query.ordemMaquinas.findMany({ where: eq(ordemMaquinas.ordemId, ordemId), columns: { modelo: true, numeroSerie: true } })
}

async function documentosDaOrdem(empresaId: number, modelos: string[]) {
  const docs = await db.query.posVendaDocumentos.findMany({ where: and(eq(posVendaDocumentos.empresaId, empresaId), eq(posVendaDocumentos.ativo, true)) })
  return docs.filter((d) => documentoValeParaModelos(d, modelos)).map((d) => ({ id: d.id, titulo: d.titulo, modelo: d.modelo, url: `/uploads/${d.nomeArmazenado}` }))
}

async function validarNotaTecnico(ordemId: number, notaTecnico: number | undefined) {
  const o = await db.query.ordens.findFirst({ where: eq(ordens.id, ordemId), columns: { orderType: true } })
  if (o?.orderType === 'maquina' && notaTecnico == null) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Falta a nota do assistente técnico' })
  return o?.orderType ?? 'maquina'
}

// Agendamento: vendedor só mexe no que é dele; admin em qualquer um da empresa.
async function assertAgendamento(id: number, empresaId: number, user: { id: number; role: string }) {
  const ag = await db.query.agendamentosPecas.findFirst({ where: and(eq(agendamentosPecas.id, id), eq(agendamentosPecas.empresaId, empresaId)) })
  if (!ag) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agendamento não encontrado' })
  if (user.role !== 'admin' && ag.vendedorId !== user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão' })
  return ag
}

export const posVendaOdinRouter = router({
  // ---------- Etapa Pós-venda do pedido ----------
  painelOrdem: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    const pesquisa = await obterOuCriarPesquisa(input.ordemId)
    const maquinas = await modelosDaOrdem(input.ordemId)
    const documentos = ordem.orderType === 'peca' ? [] : await documentosDaOrdem(ctx.empresaId, maquinas.map((m) => m.modelo))
    const anexosPosVenda = await db.query.ordemAnexos.findMany({ where: and(eq(ordemAnexos.ordemId, input.ordemId), eq(ordemAnexos.stage, 'pos_venda')), columns: { id: true, nomeOriginal: true, nomeArmazenado: true } })
    const agendamento = await db.query.agendamentosPecas.findFirst({ where: eq(agendamentosPecas.ordemId, input.ordemId), columns: { id: true } })
    return {
      orderType: ordem.orderType,
      tipo: await tipoPedidoMaquina(input.ordemId),
      temAgendamento: !!agendamento,
      revenda: (await revendaDaOrdem(input.ordemId)).nome,
      pesquisa: { ...pesquisa, pedeAtencao: pesquisa.respondidoEm ? respostaPedeAtencao(pesquisa) : false },
      linkPesquisa: `/pesquisa/${pesquisa.token}`,
      maquinas,
      documentos: [...documentos, ...anexosPosVenda.map((a) => ({ id: -a.id, titulo: a.nomeOriginal, modelo: null, url: `/uploads/${a.nomeArmazenado}` }))],
    }
  }),

  // Peça, etapa Concluído: previsão de chegada ao cliente (vai pro Calendário).
  previsaoChegadaObter: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    const r = await db.query.ordemRastreio.findFirst({ where: eq(ordemRastreio.ordemId, input.ordemId), columns: { previsaoChegada: true, transportadora: true, codigoRastreio: true, linkRastreio: true } })
    return { previsaoChegada: r?.previsaoChegada ?? null, transportadora: r?.transportadora ?? null, codigoRastreio: r?.codigoRastreio ?? null, linkRastreio: r?.linkRastreio ?? null }
  }),

  previsaoChegadaSalvar: adminOrFeatureProcedure('pedidos_odin')
    .input(z.object({ ordemId: z.number(), previsaoChegada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
      const existente = await db.query.ordemRastreio.findFirst({ where: eq(ordemRastreio.ordemId, input.ordemId), columns: { id: true, previsaoChegada: true } })
      if (existente) await db.update(ordemRastreio).set({ previsaoChegada: input.previsaoChegada, updatedAt: agoraSqlite() }).where(eq(ordemRastreio.id, existente.id))
      else await db.insert(ordemRastreio).values({ ordemId: input.ordemId, previsaoChegada: input.previsaoChegada })
      if ((existente?.previsaoChegada ?? null) !== input.previsaoChegada) {
        const txt = input.previsaoChegada ? input.previsaoChegada.split('-').reverse().join('/') : 'sem data'
        await db.insert(ordemHistorico).values({ ordemId: input.ordemId, userId: ctx.user.id, action: 'update', description: `Previsão de chegada: ${txt}`, stage: ordem.stage })
      }
      return { ok: true }
    }),

  salvarAvaliados: adminOrFeatureProcedure('pedidos_odin')
    .input(z.object({ ordemId: z.number(), transportadora: z.string().max(200), tecnicoNome: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
      await obterOuCriarPesquisa(input.ordemId)
      await db
        .update(posVendaPesquisas)
        .set({ transportadora: input.transportadora.trim() || null, tecnicoNome: input.tecnicoNome.trim() || null, updatedAt: agoraSqlite() })
        .where(eq(posVendaPesquisas.ordemId, input.ordemId))
      return { ok: true }
    }),

  // Chamado quando a equipe clica em "Enviar no WhatsApp"/"Copiar mensagem"
  // — é o que libera o pedido pra sair do Pós-venda.
  marcarEnviado: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    const p = await obterOuCriarPesquisa(input.ordemId)
    if (!p.enviadoEm) {
      await db.update(posVendaPesquisas).set({ enviadoEm: agoraSqlite(), enviadoPor: ctx.user.id, updatedAt: agoraSqlite() }).where(eq(posVendaPesquisas.id, p.id))
      await db.insert(ordemHistorico).values({ ordemId: input.ordemId, userId: ctx.user.id, action: 'update', description: 'Documento de pós-venda e pesquisa de satisfação enviados ao cliente', stage: ordem.stage })
    }
    return { ok: true }
  }),

  // Resposta lançada pela equipe (pesquisa feita por telefone, cliente
  // respondeu no WhatsApp etc.).
  registrarResposta: adminOrFeatureProcedure('pedidos_odin')
    .input(respostaSchema.extend({ ordemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
      const p = await obterOuCriarPesquisa(input.ordemId)
      if (p.respondidoEm) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Essa pesquisa já foi respondida' })
      await validarNotaTecnico(input.ordemId, input.notaTecnico)
      const { ordemId, comentario, ...notas } = input
      await db
        .update(posVendaPesquisas)
        .set({ ...notas, comentario: comentario?.trim() || null, respondidoEm: agoraSqlite(), respondidoVia: 'equipe', respondidoPor: ctx.user.id, updatedAt: agoraSqlite(), enviadoEm: p.enviadoEm ?? agoraSqlite(), enviadoPor: p.enviadoPor ?? ctx.user.id })
        .where(eq(posVendaPesquisas.id, p.id))
      const concluiu = await concluirPedidoPelaPesquisa(ordemId, ctx.user.id, 'equipe')
      return { ok: true, concluiu }
    }),

  // Os dois botões do fim do Pós-venda (João, 2026-10-29):
  //  'bruna' = compressor → desce pra carteira da Bruna (Agendamentos) e conclui;
  //  'ok'    = secador/trafo/reservatório/filtro/motocompressor → só conclui,
  //            sem agendamento (não tem peça/preventiva pra vender).
  concluirPosVenda: adminOrFeatureProcedure('pedidos_odin')
    .input(z.object({ ordemId: z.number(), acao: z.enum(['bruna', 'ok']) }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
      if (ordem.orderType !== 'maquina' && input.acao !== 'ok') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pedido de peça não vai para a carteira da Bruna' })
      if (input.acao === 'bruna') await criarAgendamentoDaOrdem(input.ordemId, { forcar: true })
      if (ordem.stage === 'pos_venda') {
        await avancarEtapaPedido({ ordemId: input.ordemId, empresaId: ctx.empresaId, userId: ctx.user.id, semAgendamento: input.acao === 'ok' })
      } else if (input.acao === 'ok' || ordem.stage !== 'concluido') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'O pedido precisa estar na etapa Pós-venda' })
      }
      if (input.acao === 'ok' && ordem.orderType === 'maquina') {
        await db.insert(ordemHistorico).values({ ordemId: input.ordemId, userId: ctx.user.id, action: 'update', description: 'Concluído sem agendamento de peças (item sem peças/preventiva)', stage: 'concluido' })
      }
      return { ok: true }
    }),

  resolverAcompanhamento: adminOrFeatureProcedure('pedidos_odin')
    .input(z.object({ ordemId: z.number(), obs: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
      await db
        .update(posVendaPesquisas)
        .set({ acompanhamentoResolvidoEm: agoraSqlite(), acompanhamentoResolvidoPor: ctx.user.id, acompanhamentoObs: input.obs.trim(), updatedAt: agoraSqlite() })
        .where(eq(posVendaPesquisas.ordemId, input.ordemId))
      return { ok: true }
    }),

  agendamentoDaOrdem: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    const ag = await db.query.agendamentosPecas.findFirst({ where: eq(agendamentosPecas.ordemId, input.ordemId), with: { vendedor: { columns: { name: true } } } })
    return ag ? { id: ag.id, status: ag.status, proximoContato: ag.proximoContato, vendedorNome: ag.vendedor?.name ?? null } : null
  }),

  // ---------- Página pública da pesquisa (/pesquisa/:token, sem login) ----------
  publicoObter: publicProcedure.input(z.object({ token: z.string().min(10).max(40) })).query(async ({ input }) => {
    const p = await db.query.posVendaPesquisas.findFirst({ where: eq(posVendaPesquisas.token, input.token) })
    if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pesquisa não encontrada' })
    const [empresa, cliente, maquinas, ordem] = await Promise.all([
      db.query.empresas.findFirst({ where: eq(empresas.id, p.empresaId), columns: { nome: true } }),
      p.clienteId ? db.query.clientes.findFirst({ where: eq(clientes.id, p.clienteId), columns: { razaoSocial: true } }) : null,
      modelosDaOrdem(p.ordemId),
      db.query.ordens.findFirst({ where: eq(ordens.id, p.ordemId), columns: { orderType: true } }),
    ])
    const peca = ordem?.orderType === 'peca'
    // O guia (cuidados/preventiva/garantia) é de máquina — peça não leva PDF.
    const documentos = peca ? [] : await documentosDaOrdem(p.empresaId, maquinas.map((m) => m.modelo))
    return {
      orderType: peca ? ('peca' as const) : ('maquina' as const),
      empresaNome: empresa?.nome ?? 'Odin',
      clienteNome: cliente?.razaoSocial ?? null,
      modelos: [...new Set(maquinas.map((m) => m.modelo))],
      documentos: documentos.map((d) => ({ titulo: d.titulo, url: d.url })),
      respondida: !!p.respondidoEm,
    }
  }),

  publicoResponder: publicProcedure.input(respostaSchema.extend({ token: z.string().min(10).max(40) })).mutation(async ({ input }) => {
    const p = await db.query.posVendaPesquisas.findFirst({ where: eq(posVendaPesquisas.token, input.token) })
    if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pesquisa não encontrada' })
    if (p.respondidoEm) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Essa pesquisa já foi respondida. Obrigado!' })
    await validarNotaTecnico(p.ordemId, input.notaTecnico)
    const { token: _token, comentario, ...notas } = input
    await db
      .update(posVendaPesquisas)
      .set({ ...notas, comentario: comentario?.trim() || null, respondidoEm: agoraSqlite(), respondidoVia: 'cliente', updatedAt: agoraSqlite(), enviadoEm: p.enviadoEm ?? agoraSqlite() })
      .where(eq(posVendaPesquisas.id, p.id))
    await concluirPedidoPelaPesquisa(p.ordemId, null, 'cliente')
    return { ok: true }
  }),

  // ---------- Config. Odin → Pós-venda ----------
  configObter: adminProcedure.query(async ({ ctx }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const [vendedorPecasId, diasPrimeiroContato, documentos, vendedores] = await Promise.all([
      vendedorPecasPadrao(ctx.empresaId),
      getConfigNumero(chaveDiasPrimeiroContato(ctx.empresaId), DIAS_PRIMEIRO_CONTATO_PADRAO),
      db.query.posVendaDocumentos.findMany({ where: and(eq(posVendaDocumentos.empresaId, ctx.empresaId), eq(posVendaDocumentos.ativo, true)), orderBy: (d, { asc }) => [asc(d.titulo)] }),
      db.query.users.findMany({ where: and(eq(users.empresaId, ctx.empresaId), eq(users.isActive, true)), columns: { id: true, name: true }, orderBy: (u, { asc }) => [asc(u.name)] }),
    ])
    return {
      vendedorPecasId,
      diasPrimeiroContato,
      vendedores,
      documentos: documentos.map((d) => ({ id: d.id, titulo: d.titulo, modelo: d.modelo, nomeOriginal: d.nomeOriginal, url: `/uploads/${d.nomeArmazenado}` })),
    }
  }),

  configSalvar: adminProcedure
    .input(z.object({ vendedorPecasId: z.number(), diasPrimeiroContato: z.number().int().min(0).max(365) }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const u = await db.query.users.findFirst({ where: and(eq(users.id, input.vendedorPecasId), eq(users.empresaId, ctx.empresaId)) })
      if (!u) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Vendedor inválido' })
      await setConfig(chaveVendedorPecas(ctx.empresaId), input.vendedorPecasId)
      await setConfig(chaveDiasPrimeiroContato(ctx.empresaId), input.diasPrimeiroContato)
      return { ok: true }
    }),

  documentoCriar: adminProcedure
    .input(z.object({ titulo: z.string().min(1).max(200), modelo: z.string().max(100).optional(), nomeOriginal: z.string().min(1), nomeArmazenado: z.string().min(1).regex(/^ordem-[\w-]+\.pdf$/i) }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      await db.insert(posVendaDocumentos).values({ empresaId: ctx.empresaId, titulo: input.titulo.trim(), modelo: input.modelo?.trim() || null, nomeOriginal: input.nomeOriginal, nomeArmazenado: input.nomeArmazenado, criadoPor: ctx.user.id })
      return { ok: true }
    }),

  documentoRemover: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await db.update(posVendaDocumentos).set({ ativo: false }).where(and(eq(posVendaDocumentos.id, input.id), eq(posVendaDocumentos.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  // ---------- Agendamentos de peças (coluna do Kanban) ----------
  agendamentosListar: protectedProcedure.input(z.object({ vendedorId: z.number().optional(), todos: z.boolean().optional() }).optional()).query(async ({ ctx, input }) => {
    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { slug: true } })
    if (empresa?.slug !== 'odin-compressores') return { mostrar: false, itens: [] }
    const ehAdmin = ctx.user.role === 'admin'
    const condicoes = [eq(agendamentosPecas.empresaId, ctx.empresaId), eq(agendamentosPecas.status, 'aberto')]
    if (!ehAdmin) condicoes.push(eq(agendamentosPecas.vendedorId, ctx.user.id))
    else if (!input?.todos && input?.vendedorId) condicoes.push(eq(agendamentosPecas.vendedorId, input.vendedorId))
    const lista = await db.query.agendamentosPecas.findMany({
      where: and(...condicoes),
      with: {
        cliente: { columns: { id: true, razaoSocial: true, telefoneWhatsapp: true } },
        revenda: { columns: { nome: true } },
        vendedor: { columns: { name: true } },
        contatos: { columns: { createdAt: true, observacao: true, tipo: true }, orderBy: (c, { desc }) => [desc(c.createdAt)], limit: 1 },
      },
    })
    const ordemIds = lista.map((a) => a.ordemId).filter((x): x is number => x != null)
    const maquinas = ordemIds.length ? await db.query.ordemMaquinas.findMany({ where: inArray(ordemMaquinas.ordemId, ordemIds), columns: { ordemId: true, modelo: true } }) : []
    const itens = lista
      .map((a) => ({
        id: a.id,
        ordemId: a.ordemId,
        clienteNome: a.cliente?.razaoSocial ?? '—',
        clienteWhatsapp: a.cliente?.telefoneWhatsapp ?? null,
        revendaNome: a.revenda?.nome ?? null,
        vendedorNome: a.vendedor?.name ?? null,
        proximoContato: a.proximoContato,
        modelos: [...new Set(maquinas.filter((m) => m.ordemId === a.ordemId).map((m) => m.modelo))],
        ultimoContato: a.contatos[0] ?? null,
      }))
      .sort((x, y) => (x.proximoContato ?? '9999').localeCompare(y.proximoContato ?? '9999'))
    let mostrar = ehAdmin || itens.length > 0
    if (!mostrar) {
      const u = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id), columns: { canalVenda: true } })
      mostrar = u?.canalVenda === 'pecas'
    }
    return { mostrar, itens }
  }),

  agendamentoObter: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const ag = await assertAgendamento(input.id, ctx.empresaId, ctx.user)
    const completo = await db.query.agendamentosPecas.findFirst({
      where: eq(agendamentosPecas.id, ag.id),
      with: {
        cliente: { columns: { id: true, razaoSocial: true, telefoneWhatsapp: true, cidade: true, estado: true, codigo: true } },
        revenda: true,
        vendedor: { columns: { id: true, name: true } },
        contatos: { with: { user: { columns: { name: true } } }, orderBy: (c, { desc }) => [desc(c.createdAt)] },
        ordem: { with: { detalhes: { columns: { numeroPedido: true } }, faturamento: { columns: { numeroNotaFiscal: true, dataFaturamento: true } }, pesquisaPosVenda: true, posVenda: true } },
      },
    })
    if (!completo) throw new TRPCError({ code: 'NOT_FOUND' })
    const [maquinas, nfs] = ag.ordemId
      ? await Promise.all([
          modelosDaOrdem(ag.ordemId),
          db.query.ordemAnexos.findMany({ where: and(eq(ordemAnexos.ordemId, ag.ordemId), eq(ordemAnexos.stage, 'faturamento')), columns: { id: true, nomeOriginal: true, nomeArmazenado: true, fileCategory: true } }),
        ])
      : [[], []]
    const p = completo.ordem?.pesquisaPosVenda
    // Lista própria (revendas.listar pede a permissão de Revendas, que a
    // Bruna pode não ter) — só id/nome pra escolher no card.
    const revendasOpcoes = await db.query.revendas.findMany({ where: eq(revendas.empresaId, ctx.empresaId), columns: { id: true, nome: true }, orderBy: (r, { asc }) => [asc(r.nome)] })
    return {
      ...completo,
      revendasOpcoes,
      maquinas,
      notasFiscais: nfs.map((n) => ({ id: n.id, nome: n.nomeOriginal, url: `/uploads/${n.nomeArmazenado}` })),
      pesquisa: p?.respondidoEm ? { notaOdin: p.notaOdin, notaTransportadora: p.notaTransportadora, notaTecnico: p.notaTecnico, atendeu: p.atendeu, comentario: p.comentario } : null,
    }
  }),

  agendamentoRegistrarContato: protectedProcedure
    .input(z.object({ id: z.number(), tipo: z.enum(['whatsapp', 'ligacao', 'email', 'visita', 'outro']), observacao: z.string().min(1).max(2000), encaminhamento: z.string().max(1000).optional(), proximoContato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
    .mutation(async ({ ctx, input }) => {
      const ag = await assertAgendamento(input.id, ctx.empresaId, ctx.user)
      await db.insert(agendamentoPecasContatos).values({ agendamentoId: ag.id, userId: ctx.user.id, tipo: input.tipo, observacao: input.observacao.trim(), encaminhamento: input.encaminhamento?.trim() || null })
      await db.update(agendamentosPecas).set({ ...(input.proximoContato ? { proximoContato: input.proximoContato } : {}), updatedAt: agoraSqlite() }).where(eq(agendamentosPecas.id, ag.id))
      return { ok: true }
    }),

  agendamentoAtualizar: protectedProcedure
    .input(z.object({ id: z.number(), proximoContato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), observacoes: z.string().max(2000).optional(), vendedorId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const ag = await assertAgendamento(input.id, ctx.empresaId, ctx.user)
      const set: Partial<typeof agendamentosPecas.$inferInsert> = { updatedAt: agoraSqlite() }
      if (input.proximoContato !== undefined) set.proximoContato = input.proximoContato
      if (input.observacoes !== undefined) set.observacoes = input.observacoes.trim() || null
      if (input.vendedorId !== undefined) {
        if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: 'Só gestor troca o responsável' })
        const u = await db.query.users.findFirst({ where: and(eq(users.id, input.vendedorId), eq(users.empresaId, ctx.empresaId), eq(users.isActive, true)) })
        if (!u) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Vendedor inválido' })
        set.vendedorId = input.vendedorId
      }
      await db.update(agendamentosPecas).set(set).where(eq(agendamentosPecas.id, ag.id))
      return { ok: true }
    }),

  // Dados que a Bruna completa no card (antes ficavam na parte 5 do
  // Pós-venda do pedido — João, 2026-10-29). Ficam gravados no Pós-venda do
  // pedido (ordemPosVenda), pra continuar aparecendo nos relatórios antigos.
  // Data nova de preventiva/lembrete vira o próximo contato.
  agendamentoSalvarDados: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        revendaId: z.number().nullable(),
        vendaPeca: z.boolean(),
        primeiraPreventiva: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        dataLembrete: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        notaLembrete: z.string().max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ag = await assertAgendamento(input.id, ctx.empresaId, ctx.user)
      let nomeRevenda: string | null = null
      if (input.revendaId) {
        const r = await db.query.revendas.findFirst({ where: and(eq(revendas.id, input.revendaId), eq(revendas.empresaId, ctx.empresaId)), columns: { nome: true } })
        if (!r) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Revenda inválida' })
        nomeRevenda = r.nome
      }
      const anterior = ag.ordemId ? await db.query.ordemPosVenda.findFirst({ where: eq(ordemPosVenda.ordemId, ag.ordemId) }) : null
      const set: Partial<typeof agendamentosPecas.$inferInsert> = { revendaId: input.revendaId, updatedAt: agoraSqlite() }
      const dataNova =
        (input.primeiraPreventiva && input.primeiraPreventiva !== anterior?.primeiraPreventiva ? input.primeiraPreventiva : null) ||
        (input.dataLembrete && input.dataLembrete !== anterior?.dataLembrete ? input.dataLembrete : null)
      if (dataNova && ag.status === 'aberto') set.proximoContato = dataNova
      await db.update(agendamentosPecas).set(set).where(eq(agendamentosPecas.id, ag.id))
      if (ag.ordemId) {
        const valores = {
          vendaPeca: input.vendaPeca,
          primeiraPreventiva: input.primeiraPreventiva,
          dataLembrete: input.dataLembrete,
          notaLembrete: input.notaLembrete.trim() || null,
          ...(nomeRevenda ? { nomeRevenda } : {}),
        }
        if (anterior) await db.update(ordemPosVenda).set({ ...valores, updatedAt: agoraSqlite() }).where(eq(ordemPosVenda.ordemId, ag.ordemId))
        else await db.insert(ordemPosVenda).values({ ordemId: ag.ordemId, ...valores })
      }
      return { ok: true, proximoContato: set.proximoContato ?? null }
    }),

  agendamentoConcluir: protectedProcedure
    .input(z.object({ id: z.number(), resultado: z.enum(['venda', 'revenda', 'sem_interesse', 'outro']), observacao: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const ag = await assertAgendamento(input.id, ctx.empresaId, ctx.user)
      if (input.observacao?.trim()) await db.insert(agendamentoPecasContatos).values({ agendamentoId: ag.id, userId: ctx.user.id, tipo: 'outro', observacao: input.observacao.trim(), encaminhamento: 'Agendamento concluído' })
      await db.update(agendamentosPecas).set({ status: 'concluido', resultado: input.resultado, concluidoEm: agoraSqlite(), concluidoPor: ctx.user.id, updatedAt: agoraSqlite() }).where(eq(agendamentosPecas.id, ag.id))
      return { ok: true }
    }),

  agendamentoReabrir: protectedProcedure.input(z.object({ id: z.number(), proximoContato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).mutation(async ({ ctx, input }) => {
    const ag = await assertAgendamento(input.id, ctx.empresaId, ctx.user)
    await db.update(agendamentosPecas).set({ status: 'aberto', resultado: null, concluidoEm: null, concluidoPor: null, proximoContato: input.proximoContato, updatedAt: agoraSqlite() }).where(eq(agendamentosPecas.id, ag.id))
    return { ok: true }
  }),

  // ---------- Relatórios (Relatórios Odin → Pós-venda) ----------
  relatorioSatisfacao: adminProcedure.input(z.object({ dataDe: z.string().optional(), dataAte: z.string().optional(), tipo: z.enum(['maquina', 'peca']).optional() }).optional()).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const f = faixaUtc(input?.dataDe, input?.dataAte)
    const todasTipos = await db.query.posVendaPesquisas.findMany({
      where: eq(posVendaPesquisas.empresaId, ctx.empresaId),
      with: { cliente: { columns: { razaoSocial: true } }, ordem: { columns: { id: true, stage: true, vendedorId: true, orderType: true }, with: { vendedor: { columns: { name: true } }, detalhes: { columns: { numeroPedido: true } } } } },
    })
    const todas = input?.tipo ? todasTipos.filter((p) => (p.ordem?.orderType ?? 'maquina') === input.tipo) : todasTipos
    const noPeriodo = (d: string | null) => !!d && (!f.de || d >= f.de) && (!f.ate || d < f.ate)
    const enviadas = todas.filter((p) => noPeriodo(p.enviadoEm))
    const respondidas = todas.filter((p) => noPeriodo(p.respondidoEm))
    const distribuicao = (campo: 'notaOdin' | 'notaTransportadora' | 'notaTecnico') => [1, 2, 3, 4, 5].map((n) => respondidas.filter((p) => p[campo] === n).length)
    type Resp = (typeof respondidas)[number]
    const agrupar = (nome: (p: Resp) => string | null, notaDe: (p: Resp) => number | null) => {
      const mapa = new Map<string, Resp[]>()
      for (const p of respondidas) {
        if (notaDe(p) == null) continue
        const k = nome(p)?.trim() || 'Não informado'
        mapa.set(k, [...(mapa.get(k) ?? []), p])
      }
      return [...mapa.entries()].map(([n, ps]) => ({ nome: n, respostas: ps.length, media: media(ps.map(notaDe)) })).sort((a, b) => b.respostas - a.respostas)
    }
    const agora = Date.now()
    return {
      enviadas: enviadas.length,
      respondidas: respondidas.length,
      taxaResposta: enviadas.length ? Math.round((enviadas.filter((p) => p.respondidoEm).length / enviadas.length) * 100) : null,
      mediaOdin: media(respondidas.map((p) => p.notaOdin)),
      mediaTransportadora: media(respondidas.map((p) => p.notaTransportadora)),
      mediaTecnico: media(respondidas.map((p) => p.notaTecnico)),
      atendeu: { sim: respondidas.filter((p) => p.atendeu === 'sim').length, parcial: respondidas.filter((p) => p.atendeu === 'parcial').length, nao: respondidas.filter((p) => p.atendeu === 'nao').length },
      queremContato: respondidas.filter((p) => p.querContato).length,
      pendentesAcompanhamento: todas.filter((p) => p.respondidoEm && respostaPedeAtencao(p) && !p.acompanhamentoResolvidoEm).length,
      distribuicao: { odin: distribuicao('notaOdin'), transportadora: distribuicao('notaTransportadora'), tecnico: distribuicao('notaTecnico') },
      porTransportadora: agrupar((p) => p.transportadora, (p) => p.notaTransportadora),
      porTecnico: agrupar((p) => p.tecnicoNome, (p) => p.notaTecnico),
      // Atenção vem sempre inteira (sem filtro de período): o que ainda não
      // foi resolvido não pode sumir só porque mudou o mês.
      respostas: todas
        .filter((p) => p.respondidoEm && (noPeriodo(p.respondidoEm) || (respostaPedeAtencao(p) && !p.acompanhamentoResolvidoEm)))
        .sort((a, b) => (b.respondidoEm ?? '').localeCompare(a.respondidoEm ?? ''))
        .map((p) => ({
          ordemId: p.ordemId,
          orderType: p.ordem?.orderType ?? 'maquina',
          numeroPedido: p.ordem?.detalhes?.numeroPedido ?? null,
          clienteNome: p.cliente?.razaoSocial ?? '—',
          vendedorNome: p.ordem?.vendedor?.name ?? '—',
          respondidoEm: p.respondidoEm,
          via: p.respondidoVia,
          notaOdin: p.notaOdin,
          notaTransportadora: p.notaTransportadora,
          notaTecnico: p.notaTecnico,
          transportadora: p.transportadora,
          tecnicoNome: p.tecnicoNome,
          atendeu: p.atendeu,
          comentario: p.comentario,
          querContato: p.querContato,
          pedeAtencao: respostaPedeAtencao(p),
          resolvido: !!p.acompanhamentoResolvidoEm,
          acompanhamentoObs: p.acompanhamentoObs,
        })),
      aguardando: todas
        .filter((p) => p.enviadoEm && !p.respondidoEm)
        .map((p) => ({ ordemId: p.ordemId, numeroPedido: p.ordem?.detalhes?.numeroPedido ?? null, clienteNome: p.cliente?.razaoSocial ?? '—', enviadoEm: p.enviadoEm!, dias: Math.floor((agora - new Date(p.enviadoEm!.replace(' ', 'T') + 'Z').getTime()) / 86_400_000) }))
        .sort((a, b) => b.dias - a.dias),
    }
  }),

  relatorioAgendamentos: adminProcedure.input(filtroPeriodo).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const f = faixaUtc(input?.dataDe, input?.dataAte)
    const hoje = hojeBrString()
    const em = (dias: number) => new Date(new Date(`${hoje}T12:00:00Z`).getTime() + dias * 86_400_000).toISOString().slice(0, 10)
    const todos = await db.query.agendamentosPecas.findMany({
      where: eq(agendamentosPecas.empresaId, ctx.empresaId),
      with: { cliente: { columns: { razaoSocial: true } }, revenda: { columns: { nome: true } }, vendedor: { columns: { name: true } } },
    })
    const abertos = todos.filter((a) => a.status === 'aberto')
    const condContatos = [inArray(agendamentoPecasContatos.agendamentoId, todos.length ? todos.map((a) => a.id) : [0])]
    if (f.de) condContatos.push(gte(agendamentoPecasContatos.createdAt, f.de))
    if (f.ate) condContatos.push(lt(agendamentoPecasContatos.createdAt, f.ate))
    const contatos = await db.query.agendamentoPecasContatos.findMany({ where: and(...condContatos), columns: { id: true, agendamentoId: true } })
    const concluidos = todos.filter((a) => a.status === 'concluido' && a.concluidoEm && (!f.de || a.concluidoEm >= f.de) && (!f.ate || a.concluidoEm < f.ate))
    const criados = todos.filter((a) => (!f.de || a.createdAt >= f.de) && (!f.ate || a.createdAt < f.ate))
    const contar = <T,>(lista: T[], chave: (x: T) => string) => {
      const m = new Map<string, number>()
      for (const x of lista) m.set(chave(x), (m.get(chave(x)) ?? 0) + 1)
      return [...m.entries()].map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd)
    }
    return {
      abertos: abertos.length,
      atrasados: abertos.filter((a) => a.proximoContato && a.proximoContato < hoje).length,
      hoje: abertos.filter((a) => a.proximoContato === hoje).length,
      proximos7: abertos.filter((a) => a.proximoContato && a.proximoContato > hoje && a.proximoContato <= em(7)).length,
      proximos30: abertos.filter((a) => a.proximoContato && a.proximoContato > hoje && a.proximoContato <= em(30)).length,
      semData: abertos.filter((a) => !a.proximoContato).length,
      criados: criados.length,
      contatos: contatos.length,
      concluidos: concluidos.length,
      porResultado: { venda: concluidos.filter((a) => a.resultado === 'venda').length, revenda: concluidos.filter((a) => a.resultado === 'revenda').length, sem_interesse: concluidos.filter((a) => a.resultado === 'sem_interesse').length, outro: concluidos.filter((a) => a.resultado === 'outro').length },
      porRevenda: contar(abertos, (a) => a.revenda?.nome ?? 'Sem revenda'),
      porVendedor: contar(abertos, (a) => a.vendedor?.name ?? 'Sem responsável'),
      lista: abertos
        .sort((a, b) => (a.proximoContato ?? '9999').localeCompare(b.proximoContato ?? '9999'))
        .map((a) => ({ id: a.id, ordemId: a.ordemId, clienteNome: a.cliente?.razaoSocial ?? '—', revendaNome: a.revenda?.nome ?? null, vendedorNome: a.vendedor?.name ?? null, proximoContato: a.proximoContato, contatos: contatos.filter((c) => c.agendamentoId === a.id).length })),
    }
  }),
})
