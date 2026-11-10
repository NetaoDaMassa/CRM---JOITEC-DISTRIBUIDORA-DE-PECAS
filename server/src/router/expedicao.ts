import { z } from 'zod'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lte, ne, notInArray, or, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, featureProcedure, protectedProcedure, temFeature } from './_base.js'
import { db } from '../db/client.js'
import { clientes, empresas, expedicaoAgendamentos, expedicaoColaboradores, expedicaoErros, expedicaoItens, expedicaoKits, expedicaoPausas, expedicaoPedidos, sapPedidosPendentes, users } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'
import { sincronizarExpedicaoSap } from '../lib/sapExpedicao.js'
import { gerarPickingSap, registrarConferenciaSap } from '../lib/sapExpedicaoEscrita.js'
import { filialDaEmpresa } from '../lib/sapEstoque.js'
import { kitsDosItens, type ComponenteKit } from '../lib/sapKits.js'
import { getConfigTexto, setConfig } from '../lib/configuracoes.js'
import { horasUteisEntre, prazoLimiteExpedicao } from '../lib/expedicaoPrazo.js'
import { ROTULO_PAUSA, TIPOS_PAUSA, vendedoresComProblemas } from '../lib/expedicaoVendedores.js'
import { agendamentosPorCard, type AgendamentoColeta } from '../lib/expedicaoAgendamentos.js'

// Controle do Estoque / Expedição — ver expedicaoPedidos em schema.ts. Cada
// empresa vê só a própria fila e a própria equipe (estoques separados). Os 3
// computadores do estoque entram com um login que tem a permissão
// `controle_estoque`; quem está trabalhando escolhe o próprio nome a cada
// ação (não precisa de login por pessoa).
const FEATURE = 'controle_estoque'
const gerandoPicking = new Set<string>()
const FEATURE_DESCARTAR = 'expedicao_descartar'
const FEATURE_PAINEL = 'painel_logistica'

const ETAPAS = ['separacao', 'conferencia', 'embalagem', 'nf', 'agendamento', 'coleta', 'coletado'] as const
type Etapa = (typeof ETAPAS)[number]
const ETAPAS_COM_PESSOA = ['separacao', 'conferencia', 'embalagem'] as const
type EtapaPessoa = (typeof ETAPAS_COM_PESSOA)[number]
const CARGO_DA_ETAPA: Record<EtapaPessoa, string> = { separacao: 'separador', conferencia: 'conferente', embalagem: 'embalador' }
// Erro achado na etapa X conta pra quem fez a etapa anterior.
const ETAPA_ANTERIOR: Record<'conferencia' | 'embalagem' | 'expedicao', EtapaPessoa> = {
  conferencia: 'separacao',
  embalagem: 'conferencia',
  expedicao: 'embalagem',
}

const campos = {
  separacao: { pessoa: 'separacaoColaboradorId', inicio: 'separacaoInicio', fim: 'separacaoFim' },
  conferencia: { pessoa: 'conferenciaColaboradorId', inicio: 'conferenciaInicio', fim: 'conferenciaFim' },
  embalagem: { pessoa: 'embalagemColaboradorId', inicio: 'embalagemInicio', fim: 'embalagemFim' },
} as const

// SQLite "YYYY-MM-DD HH:MM:SS" (UTC) → ms.
const ms = (s: string | null) => (s ? Date.parse(`${s.replace(' ', 'T')}Z`) : NaN)
// 48h contando só dia útil (fim de semana e feriado não contam) — ver lib/expedicaoPrazo.ts.
const prazoLimite = (inicio: string) => prazoLimiteExpedicao(inicio)

export const TIPOS_ERRO = ['faltou', 'sobrou', 'trocado', 'quantidade', 'avaria', 'outro', 'volume_ficou', 'envio_errado', 'nao_despachado', 'etiqueta_errada', 'embalagem_mal_feita'] as const

async function acharPedido(empresaId: number, id: number) {
  const p = await db.query.expedicaoPedidos.findFirst({ where: and(eq(expedicaoPedidos.id, id), eq(expedicaoPedidos.empresaId, empresaId)) })
  if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pedido não encontrado' })
  return p
}

async function acharColaborador(empresaId: number, id: number) {
  const c = await db.query.expedicaoColaboradores.findFirst({
    where: and(eq(expedicaoColaboradores.id, id), eq(expedicaoColaboradores.empresaId, empresaId)),
  })
  if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Colaborador não encontrado' })
  return c
}

// Regra do João: cada pessoa faz um pedido por vez — não pode iniciar outro
// com uma etapa (separação, conferência ou embalagem) ainda aberta.
async function pedidoEmAndamento(colaboradorId: number): Promise<{ pedido: string; etapa: string } | null> {
  for (const etapa of ETAPAS_COM_PESSOA) {
    const c = campos[etapa]
    const [p] = await db
      .select({ pedido: expedicaoPedidos.pedidosSap })
      .from(expedicaoPedidos)
      .where(
        and(
          eq(expedicaoPedidos.etapa, etapa),
          eq(expedicaoPedidos[c.pessoa], colaboradorId),
          isNotNull(expedicaoPedidos[c.inicio]),
          isNull(expedicaoPedidos[c.fim])
        )
      )
      .limit(1)
    if (p) return { pedido: p.pedido, etapa }
  }
  return null
}

const NOME_ETAPA: Record<EtapaPessoa, string> = { separacao: 'separando', conferencia: 'conferindo', embalagem: 'embalando' }

// Jornada do pedido pro vendedor (pedido do João, 2026-10-29): do "aguardando
// financeiro" até "coletado", de todos os pedidos em andamento do cliente
// (código do SAP = mesmo nas empresas do grupo). Coletado some depois de 3 dias.
type PassoJornada = { pedido: string; empresaSlug: string | null; etapa: string; texto: string; detalhe: string | null; data: string | null; atrasado: boolean; entrySap?: number; agendamentos?: AgendamentoColeta[] }

async function jornadaPorCodigos(codigos: string[]): Promise<Map<string, PassoJornada[]>> {
  const mapa = new Map<string, PassoJornada[]>()
  if (!codigos.length) return mapa
  const add = (codigo: string, p: PassoJornada) => mapa.set(codigo, [...(mapa.get(codigo) ?? []), p])
  const pendentes = await db.select().from(sapPedidosPendentes).where(inArray(sapPedidosPendentes.codigoCliente, codigos))
  for (const p of pendentes) {
    add(p.codigoCliente, {
      pedido: p.numero,
      empresaSlug: p.empresaSlug,
      etapa: p.tipo,
      texto: p.tipo === 'aprovacao' ? 'Aguardando liberação do financeiro' : 'Pedido fechado — aguardando o estoque gerar o picking',
      detalhe: p.valor ? `R$ ${p.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null,
      data: p.data,
      atrasado: false,
    })
  }
  const tresDias = new Date(Date.now() - 3 * 86400_000).toISOString().replace('T', ' ').slice(0, 19)
  const exp = await db
    .select()
    .from(expedicaoPedidos)
    .where(
      and(
        inArray(expedicaoPedidos.clienteCodigo, codigos),
        eq(expedicaoPedidos.historico, false),
        notInArray(expedicaoPedidos.etapa, ['cancelado', 'descartado']),
        or(ne(expedicaoPedidos.etapa, 'coletado'), gte(expedicaoPedidos.coletadoEm, tresDias))
      )
    )
  const ids = [...new Set(exp.flatMap((p) => [p.separacaoColaboradorId, p.conferenciaColaboradorId, p.embalagemColaboradorId]).filter((x): x is number => !!x))]
  const nomes = new Map(ids.length ? (await db.select({ id: expedicaoColaboradores.id, nome: expedicaoColaboradores.nome }).from(expedicaoColaboradores).where(inArray(expedicaoColaboradores.id, ids))).map((c) => [c.id, c.nome]) : [])
  const nome = (id: number | null) => (id ? nomes.get(id) ?? '' : '')
  const agendamentos = await agendamentosPorCard(exp.map((p) => p.id))
  const agora = Date.now()
  for (const p of exp) {
    const tentativas = agendamentos.get(p.id) ?? []
    const atrasado = p.etapa !== 'coletado' && agora > prazoLimite(p.inicioPrazo)
    const nf = p.nfNumero ? `NF ${p.nfNumero}` : null
    const [texto, detalhe] = ((): [string, string | null] => {
      switch (p.etapa) {
        case 'separacao':
          return p.separacaoInicio ? [`No estoque — separando (${nome(p.separacaoColaboradorId)})`, null] : ['No estoque — na fila de separação', null]
        case 'conferencia':
          return [p.conferenciaInicio ? `Em conferência (${nome(p.conferenciaColaboradorId)})` : 'Separado — aguardando conferência', `separou: ${nome(p.separacaoColaboradorId)}`]
        case 'embalagem':
          return [p.embalagemInicio ? `Embalando (${nome(p.embalagemColaboradorId)})` : 'Conferido — aguardando embalagem', nf]
        case 'nf':
          return p.nfNumero
            ? [`Faturado ${nf} — liberado para a coleta`, p.volumes ? `${p.volumes} volume(s)` : null]
            : ['Embalado — aguardando a NF', p.volumes ? `${p.volumes} volume(s)` : null]
        case 'agendamento':
          return [`Faturado ${nf} — aguardando agendar a coleta`, p.volumes ? `${p.volumes} volume(s)` : null]
        case 'coleta':
          return [`Coleta agendada ${p.coletaAgendada ? `${p.coletaAgendada.slice(8, 10)}/${p.coletaAgendada.slice(5, 7)} ${p.coletaAgendada.slice(11, 16)}` : ''}${tentativas.length > 1 ? ` · ${tentativas.length}ª tentativa` : ''}`, [nf, p.transportadora].filter(Boolean).join(' · ') || null]
        default:
          return [tentativas.length > 1 ? `Coletado · ${tentativas.length} agendamentos` : 'Coletado', [nf, p.transportadora].filter(Boolean).join(' · ') || null]
      }
    })()
    add(p.clienteCodigo ?? '', { pedido: p.pedidosSap, empresaSlug: null, etapa: p.etapa, texto, detalhe, data: p.coletadoEm ?? p.inicioPrazo, atrasado, entrySap: Number(p.orderEntriesSap.split(',')[0]), agendamentos: tentativas })
  }
  return mapa
}

const POR_PAGINA_COLETADOS = 100

// Nomes de quem fez cada etapa, erros e prazo: o que a tela usa de cada pedido.
// Ordem de separação (pedido do João, 2026-11-09): o admin escolhe qual
// pedido o estoque separa primeiro. Guardada em configuracoes como a lista de
// ids da coluna Separação, por empresa (sem migração). Quem não está na lista
// (picking que chegou depois) vai pro fim, pelo mais antigo — sem ordem
// salva, fica como sempre foi (mais antigo primeiro).
const chaveOrdemSeparacao = (empresaId: number) => `expedicao_ordem_separacao_${empresaId}`
async function lerOrdemSeparacao(empresaId: number): Promise<number[]> {
  try {
    const v = JSON.parse((await getConfigTexto(chaveOrdemSeparacao(empresaId))) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []
  } catch {
    return []
  }
}
// Reordena só os cards em separação, nas mesmas posições que eles ocupavam
// (as outras etapas não mudam). Lista de entrada já vem pelo inicioPrazo.
async function aplicarOrdemSeparacao<T extends { id: number; empresaId: number; etapa: string }>(pedidos: T[]): Promise<T[]> {
  const empresasIds = [...new Set(pedidos.filter((p) => p.etapa === 'separacao').map((p) => p.empresaId))]
  if (!empresasIds.length) return pedidos
  const rank = new Map<number, number>()
  for (const e of empresasIds) (await lerOrdemSeparacao(e)).forEach((id, i) => rank.set(id, i))
  const sep = pedidos.filter((p) => p.etapa === 'separacao')
  const ordenados = sep
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (rank.get(a.p.id) ?? Infinity) - (rank.get(b.p.id) ?? Infinity) || a.i - b.i)
    .map((x) => x.p)
  let k = 0
  return pedidos.map((p) => (p.etapa === 'separacao' ? ordenados[k++] : p))
}

async function comCalculos(empresaId: number, pedidos: (typeof expedicaoPedidos.$inferSelect)[]) {
  const ids = pedidos.map((p) => p.id)
  const erros = ids.length
    ? await db
        .select({ id: expedicaoErros.expedicaoId, n: sql<number>`count(*)` })
        .from(expedicaoErros)
        .where(inArray(expedicaoErros.expedicaoId, ids))
        .groupBy(expedicaoErros.expedicaoId)
    : []
  const errosPor = new Map(erros.map((e) => [e.id, Number(e.n)]))
  const pessoas = new Map((await db.query.expedicaoColaboradores.findMany({ where: eq(expedicaoColaboradores.empresaId, empresaId) })).map((c) => [c.id, c.nome]))
  const agendamentos = await agendamentosPorCard(ids)
  // Selo "CLIENTE ISENTO" no card (João, 2026-11-06): vem do Status fiscal do
  // cadastro do cliente, achado pelo código do SAP. Vale o cadastro da empresa
  // do pedido; sem status lá, o de outra empresa com o mesmo código (é o mesmo
  // parceiro no SAP — ex.: Automação vende pelo cadastro da Joitec).
  const codigos = [...new Set(pedidos.map((p) => p.clienteCodigo).filter((c): c is string => !!c))]
  const cadastros = codigos.length
    ? await db
        .select({ codigo: clientes.codigo, codigoAntigo: clientes.codigoAntigo, empresaId: clientes.empresaId, statusFiscal: clientes.statusFiscal })
        .from(clientes)
        .where(and(isNull(clientes.deletedAt), or(inArray(clientes.codigo, codigos), inArray(clientes.codigoAntigo, codigos))))
    : []
  const clienteIsento = (codigo: string | null) => {
    if (!codigo) return false
    const doCodigo = cadastros.filter((c) => c.statusFiscal && (c.codigo === codigo || c.codigoAntigo === codigo))
    const daEmpresa = doCodigo.filter((c) => c.empresaId === empresaId)
    return (daEmpresa.length ? daEmpresa : doCodigo).some((c) => c.statusFiscal === 'isento')
  }
  const agora = Date.now()
  return pedidos.map((p) => {
    const limite = prazoLimite(p.inicioPrazo)
    return {
      ...p,
      clienteIsento: clienteIsento(p.clienteCodigo),
      separador: p.separacaoColaboradorId ? pessoas.get(p.separacaoColaboradorId) ?? null : null,
      conferente: p.conferenciaColaboradorId ? pessoas.get(p.conferenciaColaboradorId) ?? null : null,
      embalador: p.embalagemColaboradorId ? pessoas.get(p.embalagemColaboradorId) ?? null : null,
      erros: errosPor.get(p.id) ?? 0,
      agendamentos: agendamentos.get(p.id) ?? [],
      prazoLimite: new Date(limite).toISOString(),
      horasRestantes: Math.round(horasUteisEntre(p.coletadoEm ? ms(p.coletadoEm) : agora, limite) * 10) / 10,
      noPrazo: p.coletadoEm ? ms(p.coletadoEm) <= limite : null,
    }
  })
}

export const expedicaoRouter = router({
  // Card aberto / ficha do cliente — o vendedor só vê cliente da carteira dele.
  jornadaCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    const c = await db.query.clientes.findFirst({
      where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId), isNull(clientes.deletedAt)),
      columns: { codigo: true, codigoAntigo: true, vendedorAtualId: true },
    })
    if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cliente não encontrado' })
    if (ctx.user.role !== 'admin' && c.vendedorAtualId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso negado' })
    const codigos = [c.codigo, c.codigoAntigo].filter((x): x is string => !!x)
    const mapa = await jornadaPorCodigos(codigos)
    return codigos.flatMap((k) => mapa.get(k) ?? [])
  }),

  // Kanban: { clienteId → passo mais recente } pra etiqueta no card.
  jornadaMapa: protectedProcedure.query(async ({ ctx }) => {
    const [pend, exp] = await Promise.all([
      db.selectDistinct({ c: sapPedidosPendentes.codigoCliente }).from(sapPedidosPendentes),
      db
        .selectDistinct({ c: expedicaoPedidos.clienteCodigo })
        .from(expedicaoPedidos)
        .where(and(eq(expedicaoPedidos.historico, false), notInArray(expedicaoPedidos.etapa, ['cancelado', 'descartado']))),
    ])
    const codigos = [...new Set([...pend.map((x) => x.c), ...exp.map((x) => x.c)].filter((x): x is string => !!x))]
    if (!codigos.length) return []
    const lista = await db.query.clientes.findMany({
      where: and(
        eq(clientes.empresaId, ctx.empresaId),
        isNull(clientes.deletedAt),
        inArray(clientes.codigo, codigos),
        ctx.user.role === 'admin' ? undefined : eq(clientes.vendedorAtualId, ctx.user.id)
      ),
      columns: { id: true, codigo: true },
    })
    const mapa = await jornadaPorCodigos(lista.map((c) => c.codigo))
    return lista.flatMap((c) => {
      const passos = mapa.get(c.codigo) ?? []
      // O que está em andamento primeiro; coletado só se não tiver outro.
      const p = passos.find((x) => x.etapa !== 'coletado') ?? passos[0]
      if (!p) return []
      const { agendamentos: _lista, ...etiqueta } = p
      return [{ clienteId: c.id, total: passos.length, ...etiqueta }]
    })
  }),

  // `ocupadoCom`: pedido que a pessoa está fazendo agora (não pode pegar outro).
  colaboradores: featureProcedure(FEATURE).query(async ({ ctx }) => {
    const lista = await db.query.expedicaoColaboradores.findMany({
      where: eq(expedicaoColaboradores.empresaId, ctx.empresaId),
      orderBy: [desc(expedicaoColaboradores.ativo), asc(expedicaoColaboradores.cargo), asc(expedicaoColaboradores.nome)],
    })
    return Promise.all(lista.map(async (c) => ({ ...c, ocupadoCom: c.ativo ? await pedidoEmAndamento(c.id) : null })))
  }),

  salvarColaborador: featureProcedure(FEATURE)
    .input(
      z.object({
        id: z.number().optional(),
        nome: z.string().trim().min(1),
        cargo: z.enum(['separador', 'conferente', 'embalador', 'expedicao', 'geral']),
        limiteErro: z.number().min(0).max(1),
        ativo: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...dados } = input
      if (id) {
        await acharColaborador(ctx.empresaId, id)
        await db.update(expedicaoColaboradores).set(dados).where(eq(expedicaoColaboradores.id, id))
      } else {
        await db.insert(expedicaoColaboradores).values({ ...dados, empresaId: ctx.empresaId })
      }
    }),

  // Fila: tudo que não foi coletado + o que foi coletado hoje.
  fila: featureProcedure(FEATURE).query(async ({ ctx }) => {
    const inicioHojeUtc = new Date(`${hojeBrString()}T00:00:00-03:00`).toISOString().replace('T', ' ').slice(0, 19)
    const pedidos = await db
      .select()
      .from(expedicaoPedidos)
      .where(
        and(
          eq(expedicaoPedidos.empresaId, ctx.empresaId),
          eq(expedicaoPedidos.historico, false),
          notInArray(expedicaoPedidos.etapa, ['cancelado', 'descartado']),
          or(ne(expedicaoPedidos.etapa, 'coletado'), gte(expedicaoPedidos.coletadoEm, inicioHojeUtc))
        )
      )
      .orderBy(asc(expedicaoPedidos.inicioPrazo))
    return comCalculos(ctx.empresaId, await aplicarOrdemSeparacao(pedidos))
  }),

  // Admin muda a ordem da coluna Separação: recebe os ids na ordem nova.
  ordenarSeparacao: featureProcedure(FEATURE_DESCARTAR)
    .input(z.object({ ids: z.array(z.number()).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const naFila = input.ids.length
        ? await db
            .select({ id: expedicaoPedidos.id })
            .from(expedicaoPedidos)
            .where(and(eq(expedicaoPedidos.empresaId, ctx.empresaId), eq(expedicaoPedidos.etapa, 'separacao'), inArray(expedicaoPedidos.id, input.ids)))
        : []
      const validos = new Set(naFila.map((p) => p.id))
      const ids = [...new Set(input.ids)].filter((id) => validos.has(id))
      await setConfig(chaveOrdemSeparacao(ctx.empresaId), JSON.stringify(ids))
      return { ok: true }
    }),

  // Aba "Coletados": todos os pedidos que já saíram, do mais recente pro mais antigo.
  coletados: featureProcedure(FEATURE)
    .input(
      z.object({
        busca: z.string().trim().optional(),
        de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        pagina: z.number().int().min(1).default(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const termo = input.busca ? `%${input.busca}%` : null
      const filtro = and(
        eq(expedicaoPedidos.empresaId, ctx.empresaId),
        eq(expedicaoPedidos.etapa, 'coletado'),
        // Sem data = já estava fechado no SAP ao entrar na fila: ninguém anotou a coleta.
        isNotNull(expedicaoPedidos.coletadoEm),
        input.de ? gte(expedicaoPedidos.coletadoEm, new Date(`${input.de}T00:00:00-03:00`).toISOString().replace('T', ' ').slice(0, 19)) : undefined,
        input.ate ? lte(expedicaoPedidos.coletadoEm, new Date(`${input.ate}T23:59:59-03:00`).toISOString().replace('T', ' ').slice(0, 19)) : undefined,
        termo
          ? or(
              like(expedicaoPedidos.pedidosSap, termo),
              like(expedicaoPedidos.clienteNome, termo),
              like(expedicaoPedidos.nfNumero, termo),
              like(expedicaoPedidos.vendedorSap, termo),
              like(expedicaoPedidos.transportadora, termo),
              sql`cast(${expedicaoPedidos.pickListSap} as text) like ${termo}`
            )
          : undefined
      )
      const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(expedicaoPedidos).where(filtro)
      const pedidos = await db
        .select()
        .from(expedicaoPedidos)
        .where(filtro)
        .orderBy(desc(expedicaoPedidos.coletadoEm), desc(expedicaoPedidos.id))
        .limit(POR_PAGINA_COLETADOS)
        .offset((input.pagina - 1) * POR_PAGINA_COLETADOS)
      return { total: Number(total), porPagina: POR_PAGINA_COLETADOS, lista: await comCalculos(ctx.empresaId, pedidos) }
    }),

  detalhe: featureProcedure(FEATURE)
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      const [itens, erros] = await Promise.all([
        db.select().from(expedicaoItens).where(eq(expedicaoItens.expedicaoId, p.id)).orderBy(asc(expedicaoItens.localizacao), asc(expedicaoItens.itemCodigo)),
        db.select().from(expedicaoErros).where(eq(expedicaoErros.expedicaoId, p.id)).orderBy(asc(expedicaoErros.id)),
      ])
      return { itens: await kitsDosItens(itens), erros }
    }),

  // Kits do SAP (estruturas) e como o estoque separa cada um. Ver lib/sapKits.ts.
  kits: featureProcedure(FEATURE).query(async () => {
    const kits = await db.select().from(expedicaoKits).orderBy(asc(expedicaoKits.descricao))
    return kits.map((k) => ({ ...k, componentes: JSON.parse(k.componentes) as ComponenteKit[] }))
  }),

  definirModoKit: featureProcedure(FEATURE_DESCARTAR)
    .input(z.object({ itemCodigo: z.string(), modo: z.enum(['kit', 'peca']) }))
    .mutation(async ({ ctx, input }) => {
      const r = await db
        .update(expedicaoKits)
        .set({ modo: input.modo, alteradoPor: ctx.user.id, alteradoEm: agoraSqlite() })
        .where(eq(expedicaoKits.itemCodigo, input.itemCodigo))
      if (!r.rowsAffected) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kit não encontrado' })
      return { ok: true }
    }),

  iniciar: featureProcedure(FEATURE)
    .input(z.object({ id: z.number(), etapa: z.enum(ETAPAS_COM_PESSOA), colaboradorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      if (p.etapa !== input.etapa) throw new TRPCError({ code: 'BAD_REQUEST', message: 'O pedido não está nessa etapa (a tela pode estar desatualizada).' })
      if (p.pausadoEm) throw new TRPCError({ code: 'BAD_REQUEST', message: `Pedido pausado (${p.pausaMotivo ?? 'sem motivo'}) — retome antes de iniciar.` })
      const pessoa = await acharColaborador(ctx.empresaId, input.colaboradorId)
      const ocupado = await pedidoEmAndamento(pessoa.id)
      if (ocupado)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${pessoa.nome} ainda está ${NOME_ETAPA[ocupado.etapa as EtapaPessoa]} o pedido ${ocupado.pedido} — termine esse antes de pegar outro.`,
        })
      const c = campos[input.etapa]
      await db
        .update(expedicaoPedidos)
        .set({ [c.pessoa]: input.colaboradorId, [c.inicio]: agoraSqlite(), [c.fim]: null, updatedAt: agoraSqlite() })
        .where(eq(expedicaoPedidos.id, p.id))
    }),

  terminar: featureProcedure(FEATURE)
    .input(
      z.object({
        id: z.number(),
        etapa: z.enum(ETAPAS_COM_PESSOA),
        volumes: z.number().int().min(0).optional(),
        cabecotes: z.number().int().min(0).optional(),
        paletes: z.number().int().min(0).optional(),
        transportadora: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      const c = campos[input.etapa]
      if (p.etapa !== input.etapa || !p[c.inicio]) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Essa etapa ainda não foi iniciada.' })
      if (input.etapa === 'embalagem' && !input.volumes && !input.paletes) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe os volumes (ou paletes) embalados.' })
      if (input.etapa === 'conferencia') {
        const [falta] = await db
          .select({ n: sql<number>`count(*)` })
          .from(expedicaoItens)
          .where(and(eq(expedicaoItens.expedicaoId, p.id), isNull(expedicaoItens.conferidoEm)))
        if (Number(falta.n) > 0) throw new TRPCError({ code: 'BAD_REQUEST', message: `Faltam ${falta.n} item(ns) para conferir.` })
      }
      // Embalagem → etapa NF: o pedido fica lá até agendarem a coleta —
      // "aguardando NF" ou, com a nota emitida, "liberado próxima etapa"
      // (João, 2026-10-29). 'agendamento' ficou só pra card antigo.
      const proxima: Etapa = ETAPAS[ETAPAS.indexOf(input.etapa) + 1]
      await db
        .update(expedicaoPedidos)
        .set({
          [c.fim]: agoraSqlite(),
          etapa: proxima,
          ...(input.etapa === 'embalagem'
            ? { volumes: input.volumes ?? 0, cabecotes: input.cabecotes ?? 0, paletes: input.paletes ?? 0, transportadora: input.transportadora?.trim() || p.transportadora }
            : {}),
          updatedAt: agoraSqlite(),
        })
        .where(eq(expedicaoPedidos.id, p.id))
    }),

  // Volta uma etapa (clicou errado). Limpa o que a etapa desfeita anotou.
  voltar: featureProcedure(FEATURE)
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      const agora = agoraSqlite()
      const set: Partial<typeof expedicaoPedidos.$inferInsert> = (() => {
        switch (p.etapa) {
          case 'coletado':
            return { etapa: 'coleta', coletadoEm: null, coletadoColaboradorId: null }
          case 'coleta':
            return { etapa: 'agendamento', agendadoEm: null }
          case 'agendamento':
          case 'nf':
            return { etapa: 'embalagem', embalagemFim: null }
          case 'embalagem':
            return { etapa: 'conferencia', embalagemColaboradorId: null, embalagemInicio: null, conferenciaFim: null }
          case 'conferencia':
            return { etapa: 'separacao', conferenciaColaboradorId: null, conferenciaInicio: null, separacaoFim: null }
          default:
            return { separacaoColaboradorId: null, separacaoInicio: null, separacaoFim: null }
        }
      })()
      await db.update(expedicaoPedidos).set({ ...set, updatedAt: agora }).where(eq(expedicaoPedidos.id, p.id))
      // Desfez a conferência: os itens voltam a ser conferidos do zero.
      if (p.etapa === 'conferencia') {
        await db
          .update(expedicaoItens)
          .set({ qtdConferida: null, conferidoEm: null, tentativasConferencia: 0 })
          .where(eq(expedicaoItens.expedicaoId, p.id))
      }
    }),

  // Conferência às cegas: confere se a quantidade contada bate com a do
  // pedido, sem devolver a quantidade certa.
  conferirItem: featureProcedure(FEATURE)
    .input(z.object({ id: z.number(), itemId: z.number(), quantidade: z.number().min(0) }))
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      if (p.etapa !== 'conferencia' || !p.conferenciaInicio || p.conferenciaFim)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Inicie a conferência antes de conferir os itens.' })
      const item = await db.query.expedicaoItens.findFirst({ where: and(eq(expedicaoItens.id, input.itemId), eq(expedicaoItens.expedicaoId, p.id)) })
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Item não encontrado' })
      // Kit sai do estoque por KIT: conta kits montados (5 PC4 = 5, não 20).
      const esperado = item.ehKit && item.qtdVenda != null ? item.qtdVenda : item.quantidade
      const confere = Math.abs(esperado - input.quantidade) < 0.0001
      await db
        .update(expedicaoItens)
        .set(confere ? { qtdConferida: input.quantidade, conferidoEm: agoraSqlite() } : { tentativasConferencia: item.tentativasConferencia + 1 })
        .where(eq(expedicaoItens.id, item.id))
      return { confere }
    }),

  registrarErro: featureProcedure(FEATURE)
    .input(
      z.object({
        id: z.number(),
        etapa: z.enum(['conferencia', 'embalagem', 'expedicao']),
        registradoPorId: z.number().optional(),
        itemCodigo: z.string().optional(),
        descricao: z.string().optional(),
        tipo: z.enum(TIPOS_ERRO),
        quantidade: z.number().optional(),
        observacao: z.string().optional(),
        // Normalmente quem fez a etapa anterior (expedição → embalador).
        // Dá pra apontar outra pessoa quando foi outro que embalou/despachou.
        responsavelId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      let responsavelId = p[campos[ETAPA_ANTERIOR[input.etapa]].pessoa]
      if (input.responsavelId) responsavelId = (await acharColaborador(ctx.empresaId, input.responsavelId)).id
      await db.insert(expedicaoErros).values({
        expedicaoId: p.id,
        etapa: input.etapa,
        responsavelId,
        registradoPorId: input.registradoPorId ?? null,
        itemCodigo: input.itemCodigo || null,
        descricao: input.descricao || null,
        tipo: input.tipo,
        quantidade: input.quantidade ?? null,
        observacao: input.observacao?.trim() || null,
      })
    }),

  removerErro: featureProcedure(FEATURE)
    .input(z.object({ erroId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const e = await db.query.expedicaoErros.findFirst({ where: eq(expedicaoErros.id, input.erroId) })
      if (!e) return
      await acharPedido(ctx.empresaId, e.expedicaoId)
      await db.delete(expedicaoErros).where(eq(expedicaoErros.id, e.id))
    }),

  // Agendar (ou reagendar) a coleta — só com a NF já emitida no SAP.
  agendar: featureProcedure(FEATURE)
    .input(
      z.object({
        id: z.number(),
        transportadora: z.string().trim().min(1, 'Informe a transportadora'),
        coletaAgendada: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Informe dia e hora da coleta'),
        observacao: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      if (!['nf', 'agendamento', 'coleta'].includes(p.etapa)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Só dá pra agendar depois da embalagem.' })
      if (!p.nfNumero) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A NF ainda não saiu no SAP — a coleta só é agendada depois da NF.' })
      return db.transaction(async (tx) => {
        await tx
          .update(expedicaoPedidos)
          .set({
            etapa: 'coleta',
            transportadora: input.transportadora,
            coletaAgendada: input.coletaAgendada,
            agendadoEm: p.agendadoEm ?? agoraSqlite(),
            observacao: input.observacao?.trim() || null,
            updatedAt: agoraSqlite(),
          })
          .where(eq(expedicaoPedidos.id, p.id))
        const anteriores = await tx
          .select({ transportadora: expedicaoAgendamentos.transportadora, coletaAgendada: expedicaoAgendamentos.coletaAgendada })
          .from(expedicaoAgendamentos)
          .where(eq(expedicaoAgendamentos.expedicaoId, p.id))
          .orderBy(asc(expedicaoAgendamentos.id))
        // Mesma data e transportadora (clique duplo, por exemplo) não é nova tentativa.
        const ultimo = anteriores[anteriores.length - 1]
        if (ultimo?.coletaAgendada === input.coletaAgendada && ultimo.transportadora === input.transportadora) return { tentativa: anteriores.length, nova: false }
        await tx.insert(expedicaoAgendamentos).values({
          expedicaoId: p.id,
          transportadora: input.transportadora,
          coletaAgendada: input.coletaAgendada,
          registradoEm: agoraSqlite(),
          registradoPor: ctx.user.id,
        })
        return { tentativa: anteriores.length + 1, nova: true }
      })
    }),

  coletar: featureProcedure(FEATURE)
    .input(z.object({ id: z.number(), colaboradorId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      if (p.etapa !== 'coleta' || !p.nfNumero) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Só dá pra marcar coleta com a NF emitida e a coleta agendada.' })
      await db
        .update(expedicaoPedidos)
        .set({ etapa: 'coletado', coletadoEm: agoraSqlite(), coletadoColaboradorId: input.colaboradorId ?? null, updatedAt: agoraSqlite() })
        .where(eq(expedicaoPedidos.id, p.id))
    }),

  sincronizarAgora: featureProcedure(FEATURE).mutation(() => sincronizarExpedicaoSap()),

  // Pedidos de venda abertos no SAP (últimos 15 dias) que ainda não têm
  // picking — a mesma foto que alimenta a jornada do vendedor.
  pedidosSemPicking: featureProcedure(FEATURE).query(async ({ ctx }) => {
    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { slug: true } })
    if (!empresa) return []
    const linhas = await db
      .select()
      .from(sapPedidosPendentes)
      .where(and(eq(sapPedidosPendentes.tipo, 'pedido'), eq(sapPedidosPendentes.empresaSlug, empresa.slug)))
      .orderBy(asc(sapPedidosPendentes.data))
    const codigos = [...new Set(linhas.map((l) => l.codigoCliente))]
    const nomes = codigos.length
      ? await db.select({ codigo: clientes.codigo, nome: clientes.razaoSocial }).from(clientes).where(and(eq(clientes.empresaId, ctx.empresaId), inArray(clientes.codigo, codigos)))
      : []
    const nomeDe = new Map(nomes.map((n) => [n.codigo, n.nome]))
    return linhas.map((l) => ({ numero: l.numero, codigoCliente: l.codigoCliente, cliente: nomeDe.get(l.codigoCliente) ?? null, data: l.data, valor: l.valor, vendedorSap: l.vendedorSap }))
  }),

  // Gera a lista de picking no SAP (todas as linhas em aberto do pedido) e
  // já roda a sincronização pra o card aparecer na Expedição.
  gerarPicking: featureProcedure(FEATURE)
    .input(z.object({ numero: z.string().regex(/^\d+$/) }))
    .mutation(async ({ ctx, input }) => {
      const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { slug: true } })
      const filial = empresa ? filialDaEmpresa(empresa.slug) : null
      if (!filial || ![3, 4].includes(filial)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Gerar picking só na Joitec, Odin Automação e Odin Tubos' })
      // Um picking por pedido de cada vez (clique duplo criava dois).
      const chave = `${filial}:${input.numero}`
      if (gerandoPicking.has(chave)) throw new TRPCError({ code: 'CONFLICT', message: 'Esse picking já está sendo gerado — aguarde' })
      gerandoPicking.add(chave)
      let r
      try {
        r = await gerarPickingSap(filial, Number(input.numero), ctx.user.name)
      } catch (e) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `SAP: ${(e as Error).message}` })
      } finally {
        gerandoPicking.delete(chave)
      }
      await db.delete(sapPedidosPendentes).where(and(eq(sapPedidosPendentes.tipo, 'pedido'), eq(sapPedidosPendentes.numero, input.numero), eq(sapPedidosPendentes.empresaSlug, empresa!.slug)))
      await sincronizarExpedicaoSap().catch((e) => console.error('[expedicao] sincronizar depois do picking:', e))
      return r
    }),

  // Depois da conferência no CRM: marca o picking como separado no SAP.
  registrarConferenciaSap: featureProcedure(FEATURE)
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      if (!p.conferenciaFim) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Termine a conferência no CRM antes' })
      let r
      try {
        r = await registrarConferenciaSap(p.id, p.pickListSap)
      } catch (e) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `SAP: ${(e as Error).message}` })
      }
      await db.update(expedicaoPedidos).set({ statusPickingSap: 'ps_Picked', updatedAt: agoraSqlite() }).where(eq(expedicaoPedidos.id, p.id))
      return r
    }),

  // ---- Ações pra resolver de uma vez (pedido do João, 2026-11-02, na
  // subida: "pedidos que já foram feitos mas quero finalizar o processo
  // todo"; cancelar, voltar, pausar, editar). Finalizar, mover, cancelar e
  // reabrir: só quem tem `expedicao_descartar` (admin); pausar e editar:
  // o estoque (trocar a pessoa de uma etapa: só admin).

  // Fecha sem passar pelas etapas (já saiu antes da fila existir, foi feito
  // no papel...). Vai como histórico: fora do desempenho e do % no prazo.
  finalizar: featureProcedure(FEATURE_DESCARTAR)
    .input(z.object({ ids: z.array(z.number()).min(1).max(500), motivo: z.string().trim().optional() }))
    .mutation(async ({ ctx, input }) => {
      const agora = agoraSqlite()
      let n = 0
      for (const id of input.ids) {
        const p = await acharPedido(ctx.empresaId, id)
        if (['coletado', 'cancelado', 'descartado'].includes(p.etapa)) continue
        const nota = `Finalizado manualmente por ${ctx.user.name} em ${agora.slice(8, 10)}/${agora.slice(5, 7)}${input.motivo ? ` — ${input.motivo}` : ''}`
        await db
          .update(expedicaoPedidos)
          .set({
            etapa: 'coletado',
            coletadoEm: agora,
            finalizadoManual: true,
            historico: true,
            pausadoEm: null,
            pausaMotivo: null,
            pausadoPor: null,
            observacao: [p.observacao, nota].filter(Boolean).join(' · '),
            updatedAt: agora,
          })
          .where(eq(expedicaoPedidos.id, p.id))
        n++
      }
      return { finalizados: n }
    }),

  // Pula pra uma etapa (ex.: já separado no papel → direto pra conferência).
  // Não preenche quem fez — a etapa pulada não conta no desempenho.
  moverPara: featureProcedure(FEATURE_DESCARTAR)
    .input(z.object({ ids: z.array(z.number()).min(1).max(500), etapa: z.enum(['separacao', 'conferencia', 'embalagem', 'nf', 'coleta']) }))
    .mutation(async ({ ctx, input }) => {
      let n = 0
      for (const id of input.ids) {
        const p = await acharPedido(ctx.empresaId, id)
        if (['coletado', 'cancelado', 'descartado'].includes(p.etapa) || p.etapa === input.etapa) continue
        if (input.etapa === 'coleta' && !p.nfNumero) continue
        const alvo = ETAPAS.indexOf(input.etapa)
        // Etapas com pessoa a partir do destino ficam em aberto de novo.
        const limpar: Partial<typeof expedicaoPedidos.$inferInsert> = {}
        for (const e of ETAPAS_COM_PESSOA)
          if (ETAPAS.indexOf(e) >= alvo) Object.assign(limpar, { [campos[e].pessoa]: null, [campos[e].inicio]: null, [campos[e].fim]: null })
        await db
          .update(expedicaoPedidos)
          .set({ ...limpar, etapa: input.etapa, ...(alvo < ETAPAS.indexOf('coleta') ? { agendadoEm: null } : {}), updatedAt: agoraSqlite() })
          .where(eq(expedicaoPedidos.id, p.id))
        if (alvo <= ETAPAS.indexOf('conferencia'))
          await db.update(expedicaoItens).set({ qtdConferida: null, conferidoEm: null, tentativasConferencia: 0 }).where(eq(expedicaoItens.expedicaoId, p.id))
        n++
      }
      return { movidos: n }
    }),

  // Cancela sem recriar (diferente do descarte). Fica na lista com o motivo.
  cancelar: featureProcedure(FEATURE_DESCARTAR)
    .input(z.object({ ids: z.array(z.number()).min(1).max(500), motivo: z.string().trim().min(3, 'Escreva o motivo') }))
    .mutation(async ({ ctx, input }) => {
      let n = 0
      for (const id of input.ids) {
        const p = await acharPedido(ctx.empresaId, id)
        if (['cancelado', 'descartado'].includes(p.etapa)) continue
        await db
          .update(expedicaoPedidos)
          .set({ etapa: 'cancelado', etapaAntesCancelar: p.etapa, descartadoEm: agoraSqlite(), descartadoPor: ctx.user.id, motivoDescarte: input.motivo, updatedAt: agoraSqlite() })
          .where(eq(expedicaoPedidos.id, p.id))
        n++
      }
      return { cancelados: n }
    }),

  reabrir: featureProcedure(FEATURE_DESCARTAR)
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      if (p.etapa !== 'cancelado') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Só pedido cancelado pode ser reaberto (descartado é recriado sozinho pelo SAP).' })
      const etapa = (p.etapaAntesCancelar && (ETAPAS as readonly string[]).includes(p.etapaAntesCancelar) ? p.etapaAntesCancelar : 'separacao') as Etapa
      await db
        .update(expedicaoPedidos)
        .set({ etapa, etapaAntesCancelar: null, descartadoEm: null, descartadoPor: null, motivoDescarte: null, updatedAt: agoraSqlite() })
        .where(eq(expedicaoPedidos.id, p.id))
    }),

  pausar: featureProcedure(FEATURE)
    .input(z.object({ id: z.number(), tipo: z.enum(TIPOS_PAUSA), motivo: z.string().trim().optional() }))
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      if (['coletado', 'cancelado', 'descartado'].includes(p.etapa)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esse pedido já saiu da fila.' })
      if (p.pausadoEm) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esse pedido já está pausado.' })
      const detalhe = input.motivo || null
      if (input.tipo === 'outro' && (detalhe?.length ?? 0) < 3) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escreva o motivo da pausa' })
      const agora = agoraSqlite()
      const texto = input.tipo === 'outro' ? detalhe : `${ROTULO_PAUSA[input.tipo]}${detalhe ? ` — ${detalhe}` : ''}`
      await db.transaction(async (tx) => {
        await tx.update(expedicaoPedidos).set({ pausadoEm: agora, pausadoPor: ctx.user.id, pausaMotivo: texto, updatedAt: agora }).where(eq(expedicaoPedidos.id, p.id))
        await tx.insert(expedicaoPausas).values({ expedicaoId: p.id, tipo: input.tipo, motivo: texto, pausadoEm: agora, pausadoPor: ctx.user.id })
      })
    }),

  retomar: featureProcedure(FEATURE)
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      const agora = agoraSqlite()
      await db.transaction(async (tx) => {
        await tx.update(expedicaoPedidos).set({ pausadoEm: null, pausadoPor: null, pausaMotivo: null, updatedAt: agora }).where(eq(expedicaoPedidos.id, p.id))
        await tx.update(expedicaoPausas).set({ retomadoEm: agora }).where(and(eq(expedicaoPausas.expedicaoId, p.id), isNull(expedicaoPausas.retomadoEm)))
      })
    }),

  // Corrige o que foi anotado errado. Trocar quem fez uma etapa muda o
  // desempenho — só admin.
  editar: featureProcedure(FEATURE)
    .input(
      z.object({
        id: z.number(),
        volumes: z.number().int().min(0).nullable().optional(),
        cabecotes: z.number().int().min(0).nullable().optional(),
        paletes: z.number().int().min(0).nullable().optional(),
        transportadora: z.string().nullable().optional(),
        observacao: z.string().nullable().optional(),
        separacaoColaboradorId: z.number().nullable().optional(),
        conferenciaColaboradorId: z.number().nullable().optional(),
        embalagemColaboradorId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      const { id: _id, separacaoColaboradorId, conferenciaColaboradorId, embalagemColaboradorId, ...resto } = input
      const pessoas = { separacaoColaboradorId, conferenciaColaboradorId, embalagemColaboradorId }
      const trocaPessoa = Object.values(pessoas).some((v) => v !== undefined)
      if (trocaPessoa && !(ctx.user.superAdmin || (await temFeature(ctx.user.id, FEATURE_DESCARTAR))))
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Trocar quem fez a etapa é só para administrador.' })
      for (const v of Object.values(pessoas)) if (v) await acharColaborador(ctx.empresaId, v)
      const set: Record<string, unknown> = {}
      for (const [k, v] of Object.entries({ ...resto, ...pessoas })) if (v !== undefined) set[k] = typeof v === 'string' ? v.trim() || null : v
      if (!Object.keys(set).length) return
      await db.update(expedicaoPedidos).set({ ...set, updatedAt: agoraSqlite() }).where(eq(expedicaoPedidos.id, p.id))
    }),


  // Painel de TV "Controle Logístico" (pedido do João, 2026-10-29, pro
  // Financeiro, TV de 75"): as 3 empresas juntas (Joitec, Odin Tubos, Odin
  // Automação), quantidade e pedidos em cada etapa. Agendamento entra em
  // "Aguardando coleta"; coletados = hoje. `desde` = quando entrou na etapa.
  painelTv: featureProcedure(FEATURE_PAINEL).query(async () => {
    const lista = await db.query.empresas.findMany({ where: inArray(empresas.slug, ['joitec', 'odin-tubos', 'joitec-automacao']) })
    const nomeEmpresa = new Map(lista.map((e) => [e.id, e.slug === 'joitec' ? 'Joitec' : e.slug === 'odin-tubos' ? 'Odin Tubos' : 'Automação']))
    const inicioHojeUtc = new Date(`${hojeBrString()}T00:00:00-03:00`).toISOString().replace('T', ' ').slice(0, 19)
    const pedidos = await db
      .select()
      .from(expedicaoPedidos)
      .where(
        and(
          inArray(expedicaoPedidos.empresaId, lista.map((e) => e.id)),
          eq(expedicaoPedidos.historico, false),
          notInArray(expedicaoPedidos.etapa, ['cancelado', 'descartado']),
          or(ne(expedicaoPedidos.etapa, 'coletado'), gte(expedicaoPedidos.coletadoEm, inicioHojeUtc))
        )
      )
      .orderBy(asc(expedicaoPedidos.inicioPrazo))
      .then(aplicarOrdemSeparacao)
    const ids = [...new Set(pedidos.flatMap((p) => [p.separacaoColaboradorId, p.conferenciaColaboradorId, p.embalagemColaboradorId]).filter((x): x is number => !!x))]
    const nomes = new Map(ids.length ? (await db.select({ id: expedicaoColaboradores.id, nome: expedicaoColaboradores.nome }).from(expedicaoColaboradores).where(inArray(expedicaoColaboradores.id, ids))).map((c) => [c.id, c.nome]) : [])
    const agora = Date.now()
    const coluna = (etapa: string) => (etapa === 'agendamento' ? 'nf' : etapa)
    const linhas = pedidos.map((p) => {
      const [desde, quem] = ((): [string | null, number | null] => {
        switch (p.etapa) {
          case 'separacao':
            return [p.separacaoInicio ?? p.inicioPrazo, p.separacaoInicio ? p.separacaoColaboradorId : null]
          case 'conferencia':
            return [p.conferenciaInicio ?? p.separacaoFim, p.conferenciaInicio ? p.conferenciaColaboradorId : null]
          case 'embalagem':
            return [p.embalagemInicio ?? p.conferenciaFim, p.embalagemInicio ? p.embalagemColaboradorId : null]
          case 'nf':
            return [p.embalagemFim, null]
          case 'coletado':
            return [p.coletadoEm, null]
          default:
            return [p.agendadoEm ?? p.nfEmissao ?? p.embalagemFim, null]
        }
      })()
      const limite = prazoLimite(p.inicioPrazo)
      return {
        id: p.id,
        coluna: coluna(p.etapa),
        pedido: p.pedidosSap,
        cliente: p.clienteNome ?? '',
        empresa: nomeEmpresa.get(p.empresaId) ?? '',
        desde,
        trabalhando: quem ? nomes.get(quem) ?? null : null,
        nf: p.nfNumero,
        coletaAgendada: p.etapa === 'coleta' ? p.coletaAgendada : null,
        liberado: (p.etapa === 'nf' || p.etapa === 'agendamento') && !!p.nfNumero,
        atrasado: p.etapa !== 'coletado' && agora > limite,
        noPrazo: p.coletadoEm ? ms(p.coletadoEm) <= limite : null,
      }
    })
    return {
      linhas,
      atualizadoEm: new Date().toISOString(),
    }
  }),

  // Telas extras dos painéis de TV (pedido do João, 2026-11-02): resumo por
  // empresa (Joitec, Odin Tubos, Odin Automação) — inclusive quantas notas
  // estão esperando o Financeiro emitir —, a equipe do dia e as coletas da
  // semana. Serve o painel do estoque (`painel_logistica`) e o Painel
  // Financeiro (`painel_financeiro`).
  painelResumo: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.superAdmin && !(await temFeature(ctx.user.id, FEATURE_PAINEL)) && !(await temFeature(ctx.user.id, 'painel_financeiro')))
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso restrito a esse setor' })
    const lista = await db.query.empresas.findMany({ where: inArray(empresas.slug, ['joitec', 'odin-tubos', 'joitec-automacao']) })
    const ordem = ['joitec', 'odin-tubos', 'joitec-automacao']
    lista.sort((a, b) => ordem.indexOf(a.slug) - ordem.indexOf(b.slug))
    const nome = (slug: string) => (slug === 'joitec' ? 'Joitec' : slug === 'odin-tubos' ? 'Odin Tubos' : 'Odin Automação')
    const hoje = hojeBrString()
    const inicioDia = (dia: string) => new Date(`${dia}T00:00:00-03:00`).toISOString().replace('T', ' ').slice(0, 19)
    const seteDias = new Date(`${hoje}T12:00:00Z`)
    seteDias.setUTCDate(seteDias.getUTCDate() - 6)
    const desde7 = inicioDia(seteDias.toISOString().slice(0, 10))
    const inicioHoje = inicioDia(hoje)
    const agora = Date.now()
    const pedidos = await db
      .select()
      .from(expedicaoPedidos)
      .where(
        and(
          inArray(expedicaoPedidos.empresaId, lista.map((e) => e.id)),
          eq(expedicaoPedidos.historico, false),
          notInArray(expedicaoPedidos.etapa, ['cancelado', 'descartado']),
          or(ne(expedicaoPedidos.etapa, 'coletado'), gte(expedicaoPedidos.coletadoEm, desde7))
        )
      )
    const ativos = pedidos.filter((p) => p.etapa !== 'coletado')
    const diaBr = (utc: string) => new Date(Date.parse(`${utc.replace(' ', 'T')}Z`) - 3 * 3600_000).toISOString().slice(0, 10)

    const empresasResumo = lista.map((e) => {
      const dela = ativos.filter((p) => p.empresaId === e.id)
      const col = (etapa: string) => dela.filter((p) => p.etapa === etapa)
      const aguardandoNf = dela.filter((p) => (p.etapa === 'nf' || p.etapa === 'agendamento') && !p.nfNumero)
      const coletadosHoje = pedidos.filter((p) => p.empresaId === e.id && p.etapa === 'coletado' && p.coletadoEm && p.coletadoEm >= inicioHoje)
      return {
        slug: e.slug,
        nome: nome(e.slug),
        separacao: col('separacao').length,
        conferencia: col('conferencia').length,
        embalagem: col('embalagem').length,
        aguardandoNf: aguardandoNf.length,
        liberados: dela.filter((p) => (p.etapa === 'nf' || p.etapa === 'agendamento') && !!p.nfNumero).length,
        coleta: col('coleta').length,
        coletadosHoje: coletadosHoje.length,
        noPrazoHoje: coletadosHoje.filter((p) => ms(p.coletadoEm) <= prazoLimite(p.inicioPrazo)).length,
        atrasados: dela.filter((p) => agora > prazoLimite(p.inicioPrazo)).length,
        pausados: dela.filter((p) => !!p.pausadoEm).length,
        emAndamento: dela.length,
        // Notas que o Financeiro precisa emitir: embalado, sem NF ainda.
        notasAguardando: aguardandoNf
          .map((p) => ({ pedido: p.pedidosSap, cliente: p.clienteNome ?? '', desde: p.embalagemFim, volumes: p.volumes, atrasado: agora > prazoLimite(p.inicioPrazo) }))
          .sort((a, b) => (a.desde ?? '').localeCompare(b.desde ?? '')),
      }
    })

    // Equipe hoje: etapas terminadas hoje por pessoa + erros de hoje.
    const pessoas = await db.query.expedicaoColaboradores.findMany({ where: inArray(expedicaoColaboradores.empresaId, lista.map((e) => e.id)) })
    const feitosHoje = await db
      .select()
      .from(expedicaoPedidos)
      .where(
        and(
          inArray(expedicaoPedidos.empresaId, lista.map((e) => e.id)),
          eq(expedicaoPedidos.historico, false),
          or(gte(expedicaoPedidos.separacaoFim, inicioHoje), gte(expedicaoPedidos.conferenciaFim, inicioHoje), gte(expedicaoPedidos.embalagemFim, inicioHoje))
        )
      )
    const errosHoje = await db.select({ responsavelId: expedicaoErros.responsavelId }).from(expedicaoErros).where(gte(expedicaoErros.createdAt, inicioHoje))
    const empresaSlug = new Map(lista.map((e) => [e.id, e.slug]))
    const equipe = pessoas
      .filter((c) => c.ativo)
      .map((c) => {
        const conta = (fim: 'separacaoFim' | 'conferenciaFim' | 'embalagemFim', quem: 'separacaoColaboradorId' | 'conferenciaColaboradorId' | 'embalagemColaboradorId') =>
          feitosHoje.filter((p) => p[quem] === c.id && p[fim] && p[fim]! >= inicioHoje)
        const sep = conta('separacaoFim', 'separacaoColaboradorId')
        const conf = conta('conferenciaFim', 'conferenciaColaboradorId')
        const emb = conta('embalagemFim', 'embalagemColaboradorId')
        const agoraFazendo = ativos.find(
          (p) =>
            (p.etapa === 'separacao' && p.separacaoColaboradorId === c.id && p.separacaoInicio && !p.separacaoFim) ||
            (p.etapa === 'conferencia' && p.conferenciaColaboradorId === c.id && p.conferenciaInicio && !p.conferenciaFim) ||
            (p.etapa === 'embalagem' && p.embalagemColaboradorId === c.id && p.embalagemInicio && !p.embalagemFim)
        )
        return {
          id: c.id,
          nome: c.nome,
          empresa: nome(empresaSlug.get(c.empresaId) ?? ''),
          separados: sep.length,
          conferidos: conf.length,
          embalados: emb.length,
          pecas: [...sep, ...conf, ...emb].reduce((s, p) => s + p.pecas, 0),
          erros: errosHoje.filter((e) => e.responsavelId === c.id).length,
          agora: agoraFazendo ? `${agoraFazendo.etapa === 'separacao' ? 'separando' : agoraFazendo.etapa === 'conferencia' ? 'conferindo' : 'embalando'} ${agoraFazendo.pedidosSap}` : null,
        }
      })
      .filter((p) => p.separados + p.conferidos + p.embalados > 0 || p.agora)
      .sort((a, b) => b.separados + b.conferidos + b.embalados - (a.separados + a.conferidos + a.embalados))

    // Coletas: agendadas pra hoje por transportadora + últimos 7 dias.
    const agendadasHoje = ativos.filter((p) => p.etapa === 'coleta' && p.coletaAgendada?.slice(0, 10) === hoje)
    const porTransp = new Map<string, { transportadora: string; agendadas: number; coletadas: number; volumes: number }>()
    for (const p of [...agendadasHoje, ...pedidos.filter((p) => p.etapa === 'coletado' && p.coletadoEm && p.coletadoEm >= inicioHoje)]) {
      const t = (p.transportadora ?? 'Sem transportadora').trim() || 'Sem transportadora'
      const x = porTransp.get(t) ?? { transportadora: t, agendadas: 0, coletadas: 0, volumes: 0 }
      if (p.etapa === 'coletado') x.coletadas++
      else x.agendadas++
      x.volumes += p.volumes ?? 0
      porTransp.set(t, x)
    }
    const dias = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(seteDias)
      d.setUTCDate(d.getUTCDate() + i)
      return d.toISOString().slice(0, 10)
    })
    const semana = dias.map((dia) => {
      const doDia = pedidos.filter((p) => p.etapa === 'coletado' && p.coletadoEm && diaBr(p.coletadoEm) === dia)
      return { dia, coletados: doDia.length, noPrazo: doDia.filter((p) => ms(p.coletadoEm) <= prazoLimite(p.inicioPrazo)).length }
    })

    return {
      empresas: empresasResumo,
      equipe,
      transportadoras: [...porTransp.values()].sort((a, b) => b.agendadas + b.coletadas - (a.agendadas + a.coletadas)),
      semana,
      atualizadoEm: new Date().toISOString(),
    }
  }),

  // Descartar = pedido que voltou (o SAP mudou o picking): sai da fila, fica
  // em "Descartados" com o motivo, e a busca no SAP já cria o card novo com
  // o picking atual. Só quem tem `expedicao_descartar` (admin), pedido do
  // João, 2026-10-29.
  podeDescartar: featureProcedure(FEATURE).query(({ ctx }) => (ctx.user.superAdmin ? true : temFeature(ctx.user.id, FEATURE_DESCARTAR))),

  descartar: featureProcedure(FEATURE_DESCARTAR)
    .input(z.object({ id: z.number(), motivo: z.string().trim().min(3, 'Escreva o motivo do descarte') }))
    .mutation(async ({ ctx, input }) => {
      const p = await acharPedido(ctx.empresaId, input.id)
      if (p.etapa === 'descartado') return { recriado: false }
      await db
        .update(expedicaoPedidos)
        .set({ etapa: 'descartado', etapaAntesCancelar: p.etapa, descartadoEm: agoraSqlite(), descartadoPor: ctx.user.id, motivoDescarte: input.motivo, updatedAt: agoraSqlite() })
        .where(eq(expedicaoPedidos.id, p.id))
      const r = await sincronizarExpedicaoSap().catch(() => null)
      return { recriado: !!r?.novas }
    }),

  descartados: featureProcedure(FEATURE).query(async ({ ctx }) => {
    const lista = await db
      .select({
        id: expedicaoPedidos.id,
        pedidosSap: expedicaoPedidos.pedidosSap,
        pickListSap: expedicaoPedidos.pickListSap,
        clienteNome: expedicaoPedidos.clienteNome,
        descartadoEm: expedicaoPedidos.descartadoEm,
        motivoDescarte: expedicaoPedidos.motivoDescarte,
        alteracaoSap: expedicaoPedidos.alteracaoSap,
        separacaoFim: expedicaoPedidos.separacaoFim,
        conferenciaFim: expedicaoPedidos.conferenciaFim,
        embalagemFim: expedicaoPedidos.embalagemFim,
        etapa: expedicaoPedidos.etapa,
        etapaAntesCancelar: expedicaoPedidos.etapaAntesCancelar,
        por: users.name,
      })
      .from(expedicaoPedidos)
      .leftJoin(users, eq(users.id, expedicaoPedidos.descartadoPor))
      .where(and(eq(expedicaoPedidos.empresaId, ctx.empresaId), inArray(expedicaoPedidos.etapa, ['descartado', 'cancelado'])))
      .orderBy(desc(expedicaoPedidos.descartadoEm))
      .limit(200)
    return lista
  }),

  // Lista dos erros do período (tela Desempenho): quando, pedido, tipo e pra
  // quem contou — pra ver e corrigir o "placar" de cada um.
  errosPeriodo: featureProcedure(FEATURE)
    .input(z.object({ de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      const deUtc = new Date(`${input.de}T00:00:00-03:00`).toISOString().replace('T', ' ').slice(0, 19)
      const ateUtc = new Date(`${input.ate}T23:59:59-03:00`).toISOString().replace('T', ' ').slice(0, 19)
      return db
        .select({
          id: expedicaoErros.id,
          createdAt: expedicaoErros.createdAt,
          etapa: expedicaoErros.etapa,
          tipo: expedicaoErros.tipo,
          itemCodigo: expedicaoErros.itemCodigo,
          descricao: expedicaoErros.descricao,
          quantidade: expedicaoErros.quantidade,
          observacao: expedicaoErros.observacao,
          responsavelId: expedicaoErros.responsavelId,
          responsavelNome: expedicaoColaboradores.nome,
          expedicaoId: expedicaoPedidos.id,
          pedidosSap: expedicaoPedidos.pedidosSap,
          clienteNome: expedicaoPedidos.clienteNome,
          nfNumero: expedicaoPedidos.nfNumero,
        })
        .from(expedicaoErros)
        .innerJoin(expedicaoPedidos, eq(expedicaoPedidos.id, expedicaoErros.expedicaoId))
        .leftJoin(expedicaoColaboradores, eq(expedicaoColaboradores.id, expedicaoErros.responsavelId))
        .where(and(eq(expedicaoPedidos.empresaId, ctx.empresaId), gte(expedicaoErros.createdAt, deUtc), lte(expedicaoErros.createdAt, ateUtc)))
        .orderBy(desc(expedicaoErros.createdAt))
    }),

  vendedoresProblemas: featureProcedure(FEATURE)
    .input(z.object({ de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(({ ctx, input }) => vendedoresComProblemas(ctx.empresaId, input.de, input.ate)),

  // Substitui o "Painel Diário"/"Painel Mensal" da planilha. Cada etapa
  // terminada no período conta 1 pedido pra quem fez; peças/itens do
  // pedido; erros = registrados no período em que a pessoa é a responsável.
  // Bonificação: erros ÷ pedidos ≤ limite da pessoa.
  desempenho: featureProcedure(FEATURE)
    .input(z.object({ de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      const deUtc = new Date(`${input.de}T00:00:00-03:00`).toISOString().replace('T', ' ').slice(0, 19)
      const ateUtc = new Date(`${input.ate}T23:59:59-03:00`).toISOString().replace('T', ' ').slice(0, 19)
      const pessoas = await db.query.expedicaoColaboradores.findMany({ where: eq(expedicaoColaboradores.empresaId, ctx.empresaId) })
      const pedidos = await db
        .select()
        .from(expedicaoPedidos)
        .where(
          and(
            eq(expedicaoPedidos.empresaId, ctx.empresaId),
            eq(expedicaoPedidos.historico, false),
            or(
              and(gte(expedicaoPedidos.separacaoFim, deUtc), lte(expedicaoPedidos.separacaoFim, ateUtc)),
              and(gte(expedicaoPedidos.conferenciaFim, deUtc), lte(expedicaoPedidos.conferenciaFim, ateUtc)),
              and(gte(expedicaoPedidos.embalagemFim, deUtc), lte(expedicaoPedidos.embalagemFim, ateUtc)),
              and(gte(expedicaoPedidos.coletadoEm, deUtc), lte(expedicaoPedidos.coletadoEm, ateUtc))
            )
          )
        )
      const erros = await db
        .select({ responsavelId: expedicaoErros.responsavelId, n: sql<number>`count(*)` })
        .from(expedicaoErros)
        .innerJoin(expedicaoPedidos, eq(expedicaoPedidos.id, expedicaoErros.expedicaoId))
        .where(and(eq(expedicaoPedidos.empresaId, ctx.empresaId), gte(expedicaoErros.createdAt, deUtc), lte(expedicaoErros.createdAt, ateUtc)))
        .groupBy(expedicaoErros.responsavelId)
      const errosPor = new Map(erros.map((e) => [e.responsavelId, Number(e.n)]))
      const dentro = (s: string | null) => !!s && s >= deUtc && s <= ateUtc

      const linhas = pessoas.map((c) => {
        let qtd = 0
        let pecas = 0
        let itens = 0
        let volumes = 0
        let cabecotes = 0
        let paletes = 0
        let minutos = 0
        for (const p of pedidos) {
          for (const etapa of ETAPAS_COM_PESSOA) {
            const f = campos[etapa]
            if (p[f.pessoa] !== c.id || !dentro(p[f.fim])) continue
            qtd++
            pecas += p.pecas
            itens += p.itens
            minutos += (ms(p[f.fim]) - ms(p[f.inicio])) / 60_000
            if (etapa === 'embalagem') {
              volumes += p.volumes ?? 0
              cabecotes += p.cabecotes ?? 0
              paletes += p.paletes ?? 0
            }
          }
        }
        const nErros = errosPor.get(c.id) ?? 0
        const taxa = qtd ? nErros / qtd : 0
        return {
          id: c.id,
          nome: c.nome,
          cargo: c.cargo,
          ativo: c.ativo,
          pedidos: qtd,
          itens,
          pecas,
          erros: nErros,
          volumes,
          cabecotes,
          paletes,
          minutosPorPedido: qtd ? Math.round(minutos / qtd) : null,
          taxaErro: taxa,
          limiteErro: c.limiteErro,
          status: qtd === 0 ? 'sem_producao' : taxa <= c.limiteErro ? 'elegivel' : 'nao_elegivel',
        }
      })

      const coletados = pedidos.filter((p) => dentro(p.coletadoEm))
      const noPrazo = coletados.filter((p) => ms(p.coletadoEm) <= prazoLimite(p.inicioPrazo)).length
      const horas = coletados.map((p) => (ms(p.coletadoEm) - ms(p.inicioPrazo)) / 3600_000)
      return {
        linhas: linhas.filter((l) => l.ativo || l.pedidos > 0),
        coletados: coletados.length,
        noPrazo,
        horasMediasAteColeta: horas.length ? Math.round((horas.reduce((s, h) => s + h, 0) / horas.length) * 10) / 10 : null,
        erros: [...errosPor.values()].reduce((s, n) => s + n, 0),
      }
    }),
})
