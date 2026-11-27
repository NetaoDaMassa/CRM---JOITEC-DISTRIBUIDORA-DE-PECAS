import { z } from 'zod'
import { and, desc, eq, gte, inArray, isNotNull, isNull, like, lte, or, sql } from 'drizzle-orm'
import { router, adminOrFeatureProcedure, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { solicitacoesCredito, solicitacaoCreditoAnexos, solicitacaoCreditoRespostas, liberacoesCredito, clientes, empresas, users, cotacoesCrmHistorico, notifications } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { buildHistoricoCliente } from './clientes.js'
import { QUEM_LIBERA } from './liberacaoCredito.js'
import { businessHoursElapsedMs, toLocalDateKey, toUtcISO } from '../lib/businessHours.js'
import { buscarSerasaSap, serasaSapDoCliente } from '../lib/sapSerasa.js'

const anexoInput = z.object({
  urlArquivo: z.string(),
  nomeArquivo: z.string(),
  tipoArquivo: z.string().optional(),
})

// Pedido só com CNPJ, sem cadastro (só Odin Compressores, João 2026-11-27):
// cliente_id vazio, nome/código vêm do que o vendedor digitou.
const EMPRESAS_CNPJ_AVULSO = new Set(['odin-compressores'])
const clienteNomeSql = sql<string>`coalesce(${clientes.razaoSocial}, ${solicitacoesCredito.nomeAvulso}, ${solicitacoesCredito.cnpjAvulso}, '—')`
const clienteCodigoSql = sql<string>`coalesce(${clientes.codigo}, 'sem cadastro')`
const soDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')
function formatarCnpj(d: string) {
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d
}

// Filtros da fila e dos relatórios (os mesmos nas duas abas).
const filtrosInput = z
  .object({
    status: z.enum(['pendente', 'liberado', 'negado']).optional(),
    tipo: z.enum(['consulta', 'limite']).optional(),
    dataDe: z.string().optional(),
    dataAte: z.string().optional(),
    vendedorId: z.number().optional(),
    empresaId: z.number().optional(),
    // Quem decidiu (texto, igual QUEM_LIBERA) — última resposta da linha.
    quemLiberou: z.string().optional(),
    serasaLimpo: z.enum(['sim', 'nao']).optional(),
    q: z.string().optional(),
  })
  .optional()

function montarFiltros(input: z.infer<typeof filtrosInput>) {
  const filtros = []
  if (input?.status) filtros.push(eq(solicitacoesCredito.status, input.status))
  if (input?.tipo) filtros.push(eq(solicitacoesCredito.tipo, input.tipo))
  if (input?.dataDe) filtros.push(gte(solicitacoesCredito.createdAt, input.dataDe))
  if (input?.dataAte) filtros.push(lte(solicitacoesCredito.createdAt, `${input.dataAte} 23:59:59`))
  if (input?.vendedorId) filtros.push(eq(solicitacoesCredito.vendedorSolicitanteId, input.vendedorId))
  if (input?.empresaId) filtros.push(eq(solicitacoesCredito.empresaId, input.empresaId))
  if (input?.quemLiberou) filtros.push(eq(solicitacoesCredito.quemLiberou, input.quemLiberou))
  if (input?.serasaLimpo) filtros.push(eq(solicitacoesCredito.serasaLimpo, input.serasaLimpo === 'sim'))
  if (input?.q) {
    const termo = `%${input.q.trim()}%`
    filtros.push(or(like(clientes.razaoSocial, termo), like(clientes.codigo, termo), like(solicitacoesCredito.nomeAvulso, termo), like(solicitacoesCredito.cnpjAvulso, `%${soDigitos(input.q) || '#'}%`))!)
  }
  return filtros
}

// Busca usada pelas duas telas (financeiro completo; vendedor resumido).
// Junta 3 fontes: cadastros do CRM (mesmo CNPJ em todas as empresas),
// pedidos feitos só com CNPJ (Odin Compressores) e a data da última consulta
// Serasa gravada no SAP (João, 2026-11-27 — pra quem nunca foi consultado
// pelo CRM; o SAP só tem a data, não diz se está limpo).
async function pesquisarClienteCredito(input: { q: string }) {
  const termo = `%${input.q}%`
  const digitos = input.q.replace(/\D/g, '')
  const soNumero = digitos.length >= 5 && /^[\d.\/\-\s]+$/.test(input.q)
  const docSql = (col: typeof clientes.cnpj | typeof clientes.cpf) => sql<string>`replace(replace(replace(replace(coalesce(${col}, ''), '.', ''), '/', ''), '-', ''), ' ', '')`
  const condicoes = [like(clientes.codigo, termo), like(clientes.codigoAntigo, termo), like(clientes.razaoSocial, termo)]
  // Só procura no CNPJ/CPF quando digitou número (senão "C000001" casaria
  // com todo CNPJ que tem 000001 no meio).
  if (soNumero) condicoes.push(like(docSql(clientes.cnpj), `%${digitos}%`), like(docSql(clientes.cpf), `%${digitos}%`))
  const achados = await db
    .select({ id: clientes.id, cnpj: clientes.cnpj, cpf: clientes.cpf })
    .from(clientes)
    .where(or(...condicoes))
    .limit(60)

  // Mesmo documento em outras empresas.
  const docs = [...new Set(achados.map((c) => (c.cnpj || c.cpf || '').replace(/\D/g, '')).filter((d) => d.length >= 11))]
  const irmaos = docs.length
    ? await db
        .select({ id: clientes.id })
        .from(clientes)
        .where(or(inArray(docSql(clientes.cnpj), docs), inArray(docSql(clientes.cpf), docs)))
    : []
  const ids = [...new Set([...achados.map((c) => c.id), ...irmaos.map((c) => c.id)])]

  const cadastros = ids.length
    ? await db
        .select({ id: clientes.id, razaoSocial: clientes.razaoSocial, codigo: clientes.codigo, cnpj: clientes.cnpj, cpf: clientes.cpf, empresaNome: empresas.nome })
        .from(clientes)
        .innerJoin(empresas, eq(empresas.id, clientes.empresaId))
        .where(inArray(clientes.id, ids))
    : []
  const buscarPedidos = (onde: ReturnType<typeof and>) =>
    db
      .select({
        id: solicitacoesCredito.id,
        clienteId: solicitacoesCredito.clienteId,
        cnpjAvulso: solicitacoesCredito.cnpjAvulso,
        nomeAvulso: solicitacoesCredito.nomeAvulso,
        empresaNome: empresas.nome,
        vendedorNome: users.name,
        tipo: solicitacoesCredito.tipo,
        tipoConsulta: solicitacoesCredito.tipoConsulta,
        status: solicitacoesCredito.status,
        valorSolicitado: solicitacoesCredito.valorSolicitado,
        valorLiberado: solicitacoesCredito.valorLiberado,
        quemLiberou: solicitacoesCredito.quemLiberou,
        serasaLimpo: solicitacoesCredito.serasaLimpo,
        serasaConsultaEm: solicitacoesCredito.serasaConsultaEm,
        decididoEm: solicitacoesCredito.decididoEm,
        createdAt: solicitacoesCredito.createdAt,
      })
      .from(solicitacoesCredito)
      .innerJoin(empresas, eq(empresas.id, solicitacoesCredito.empresaId))
      .innerJoin(users, eq(users.id, solicitacoesCredito.vendedorSolicitanteId))
      .where(onde)
      .orderBy(desc(solicitacoesCredito.createdAt))
  const pedidos = ids.length ? await buscarPedidos(and(inArray(solicitacoesCredito.clienteId, ids))) : []
  // Pedidos só com CNPJ (sem cadastro) — pelo CNPJ digitado, pelo nome, ou
  // com o mesmo CNPJ de um cadastro achado.
  const condAvulso = [like(solicitacoesCredito.nomeAvulso, termo), ...(soNumero ? [like(solicitacoesCredito.cnpjAvulso, `%${digitos}%`)] : []), ...(docs.length ? [inArray(solicitacoesCredito.cnpjAvulso, docs)] : [])]
  const avulsos = await buscarPedidos(and(isNull(solicitacoesCredito.clienteId), or(...condAvulso)))

  type Pedido = (typeof pedidos)[number] & { clienteCodigo: string }
  type Grupo = {
    chave: string
    documento: string | null
    nome: string
    cadastros: { id: number; codigo: string; empresaNome: string; razaoSocial: string }[]
    pedidos: Pedido[]
    ultimaConsulta: Pedido | null
    // Data da última consulta Serasa gravada no SAP (só a data).
    sap: { data: string; cardCode: string } | null
    soNoSap: boolean
  }
  const grupos = new Map<string, Grupo>()
  const novoGrupo = (chave: string, documento: string | null, nome: string): Grupo => ({ chave, documento, nome, cadastros: [], pedidos: [], ultimaConsulta: null, sap: null, soNoSap: false })
  for (const c of cadastros) {
    const doc = (c.cnpj || c.cpf || '').replace(/\D/g, '')
    const chave = doc.length >= 11 ? `doc:${doc}` : `id:${c.id}`
    const g = grupos.get(chave) ?? novoGrupo(chave, doc.length >= 11 ? c.cnpj || c.cpf : null, c.razaoSocial)
    g.cadastros.push({ id: c.id, codigo: c.codigo, empresaNome: c.empresaNome, razaoSocial: c.razaoSocial })
    g.pedidos.push(...pedidos.filter((p) => p.clienteId === c.id).map((p) => ({ ...p, clienteCodigo: c.codigo })))
    grupos.set(chave, g)
  }
  for (const p of avulsos) {
    const doc = p.cnpjAvulso ?? ''
    const chave = `doc:${doc}`
    const g = grupos.get(chave) ?? novoGrupo(chave, formatarCnpj(doc), p.nomeAvulso ?? formatarCnpj(doc))
    g.pedidos.push({ ...p, clienteCodigo: 'sem cadastro' })
    grupos.set(chave, g)
  }
  for (const g of grupos.values()) {
    const s = await serasaSapDoCliente(g.cadastros.map((c) => c.codigo), g.documento)
    if (s) g.sap = { data: s.data, cardCode: s.cardCode }
  }
  // Cliente que só existe no SAP (sem cadastro no CRM) com data de consulta.
  for (const s of await buscarSerasaSap(input.q)) {
    const chave = s.doc.length >= 11 ? `doc:${s.doc}` : `sap:${s.cardCode}`
    if (grupos.has(chave) || [...grupos.values()].some((g) => g.cadastros.some((c) => c.codigo.toUpperCase() === s.cardCode))) continue
    const g = novoGrupo(chave, s.doc.length >= 11 ? formatarCnpj(s.doc) : null, s.nome)
    g.cadastros.push({ id: 0, codigo: s.cardCode, empresaNome: 'só no SAP', razaoSocial: s.nome })
    g.sap = { data: s.data, cardCode: s.cardCode }
    g.soNoSap = true
    grupos.set(chave, g)
  }
  const lista = [...grupos.values()].map((g) => {
    g.pedidos.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    // Última consulta do Serasa = a resposta mais recente com data de consulta.
    g.ultimaConsulta = [...g.pedidos].filter((p) => p.serasaConsultaEm).sort((a, b) => (b.serasaConsultaEm! + b.createdAt).localeCompare(a.serasaConsultaEm! + a.createdAt))[0] ?? null
    return g
  })
  // Código/CNPJ exato primeiro; depois quem tem pedido (mais recente em
  // cima); depois o resto por nome.
  const qMaiusculo = input.q.toUpperCase()
  const exato = (g: Grupo) =>
    g.cadastros.some((c) => c.codigo.toUpperCase() === qMaiusculo) || (digitos.length >= 11 && (g.documento ?? '').replace(/\D/g, '') === digitos) ? 1 : 0
  lista.sort((a, b) => exato(b) - exato(a) || (b.pedidos[0]?.createdAt ?? '').localeCompare(a.pedidos[0]?.createdAt ?? '') || a.nome.localeCompare(b.nome))
  return { grupos: lista.slice(0, 30), muitos: lista.length > 30 || achados.length === 60 }
}

// Fluxo completo de solicitação de crédito: o vendedor abre o pedido (com
// tudo que tem sobre o cliente, inclusive anexos — print, áudio, vídeo) e
// quem cuida do Financeiro (feature 'solicitacao_credito') responde com a
// decisão. Mesma chave de feature controla os dois lados — `solicitar` e
// `meusPedidos` usam `adminOrFeatureProcedure` (vendedor passa só com a
// permissão concedida em Permissões, admin sempre passa); o resto exige
// `featureProcedure` (financeiro, admin-only). Cross-empresa igual
// liberacaoCredito.ts: quem responde vê/decide pras 4 empresas numa tela
// só. Pedido do João, 2026-10-01.
export const solicitacaoCreditoRouter = router({
  solicitar: adminOrFeatureProcedure('solicitacao_credito')
    .input(
      z.object({
        // Ou um cliente da carteira, ou (só Odin Compressores) só o CNPJ.
        clienteId: z.number().optional(),
        cnpjAvulso: z.string().trim().optional(),
        nomeAvulso: z.string().trim().optional(),
        tipo: z.enum(['consulta', 'limite']),
        // Só faz sentido (e é obrigatório) quando tipo='consulta' —
        // 'limite' não tem sub-tipo, é sempre "quanto de limite pra esse
        // cliente". Checado abaixo, não dá pra exigir isso no próprio
        // schema zod porque depende do valor de outro campo.
        tipoConsulta: z.enum(['geral', 'limpo']).optional(),
        valorSolicitado: z.number().positive().optional(),
        // Pedido de limite (2026-11-13): valor de limite desejado + valor do
        // pedido de venda.
        valorPedido: z.number().positive().optional(),
        informacoesFiscais: z.string().trim().optional(),
        observacoes: z.string().trim().optional(),
        anexos: z.array(anexoInput).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // "Só verificar se está limpo" saiu (financeiro, 2026-11-13): toda
      // consulta já responde primeiro se está limpo.
      if (input.tipo === 'consulta') input.tipoConsulta = 'geral'

      let cnpjAvulso: string | null = null
      let cliente: typeof clientes.$inferSelect | undefined
      if (input.clienteId == null) {
        const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { slug: true } })
        if (!empresa || !EMPRESAS_CNPJ_AVULSO.has(empresa.slug)) throw new Error('Escolha o cliente')
        cnpjAvulso = soDigitos(input.cnpjAvulso)
        if (cnpjAvulso.length !== 14) throw new Error('Digite o CNPJ completo (14 números)')
        if (!input.nomeAvulso || input.nomeAvulso.length < 2) throw new Error('Digite o nome da empresa')
        const pendenteAvulso = await db.query.solicitacoesCredito.findFirst({
          where: and(eq(solicitacoesCredito.cnpjAvulso, cnpjAvulso), eq(solicitacoesCredito.status, 'pendente'), eq(solicitacoesCredito.tipo, input.tipo)),
        })
        if (pendenteAvulso) throw new Error('Já existe uma solicitação desse tipo pendente pra este CNPJ.')
      } else {
        cliente = await db.query.clientes.findFirst({
          where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId), isNull(clientes.deletedAt)),
        })
        if (!cliente) throw new Error('Cliente não encontrado')
        // Vendedor só pode pedir crédito pra cliente que já é dele — mesma
        // regra de qualquer outra ação de carteira. Admin pode pra qualquer um.
        if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) {
          throw new Error('Esse cliente não está na sua carteira')
        }
      }

      // Mesmo padrão de aprovacoes.solicitar — evita o vendedor abrir vários
      // pedidos em paralelo pro mesmo cliente (o financeiro teria que
      // decidir qual vale, e o segundo pedido ficaria com dados
      // desatualizados assim que o primeiro for respondido). Escopado por
      // `tipo` — pode ter uma "consulta" E uma "limite" pendentes ao mesmo
      // tempo pro mesmo cliente, são filas separadas agora.
      const pendente = cliente && await db.query.solicitacoesCredito.findFirst({
        where: and(
          eq(solicitacoesCredito.clienteId, cliente.id),
          eq(solicitacoesCredito.status, 'pendente'),
          eq(solicitacoesCredito.tipo, input.tipo)
        ),
      })
      if (pendente) throw new Error('Já existe uma solicitação desse tipo pendente pra este cliente.')

      const result = await db.insert(solicitacoesCredito).values({
        empresaId: cliente?.empresaId ?? ctx.empresaId,
        clienteId: cliente?.id ?? null,
        cnpjAvulso,
        nomeAvulso: cliente ? null : input.nomeAvulso!.trim(),
        vendedorSolicitanteId: ctx.user.id,
        tipo: input.tipo,
        tipoConsulta: input.tipo === 'consulta' ? input.tipoConsulta : undefined,
        valorSolicitado: input.valorSolicitado,
        valorPedido: input.tipo === 'limite' ? input.valorPedido : undefined,
        informacoesFiscais: input.informacoesFiscais,
        observacoes: input.observacoes,
      })
      const solicitacaoId = Number(result.lastInsertRowid)

      if (input.anexos?.length) {
        await db.insert(solicitacaoCreditoAnexos).values(
          input.anexos.map((a) => ({
            solicitacaoId,
            origem: 'vendedor' as const,
            urlArquivo: a.urlArquivo,
            nomeArquivo: a.nomeArquivo,
            tipoArquivo: a.tipoArquivo,
          }))
        )
      }

      return { id: solicitacaoId }
    }),

  // Histórico do próprio vendedor — status de cada pedido que ele fez,
  // inclusive já respondidos (pra ver a decisão e usar o botão "Contestar
  // no WhatsApp").
  meusPedidos: adminOrFeatureProcedure('solicitacao_credito').query(async ({ ctx }) => {
    const linhas = await db
      .select({
        id: solicitacoesCredito.id,
        clienteId: solicitacoesCredito.clienteId,
        clienteNome: clienteNomeSql,
        clienteCodigo: clienteCodigoSql,
        cnpjAvulso: solicitacoesCredito.cnpjAvulso,
        tipo: solicitacoesCredito.tipo,
        tipoConsulta: solicitacoesCredito.tipoConsulta,
        status: solicitacoesCredito.status,
        valorSolicitado: solicitacoesCredito.valorSolicitado,
        informacoesFiscais: solicitacoesCredito.informacoesFiscais,
        observacoes: solicitacoesCredito.observacoes,
        valorLiberado: solicitacoesCredito.valorLiberado,
        quemLiberou: solicitacoesCredito.quemLiberou,
        motivoResposta: solicitacoesCredito.motivoResposta,
        serasaObservacao: solicitacoesCredito.serasaObservacao,
        serasaLimpo: solicitacoesCredito.serasaLimpo,
        serasaConsultaEm: solicitacoesCredito.serasaConsultaEm,
        valorPedido: solicitacoesCredito.valorPedido,
        decididoPor: solicitacoesCredito.decididoPor,
        decididoEm: solicitacoesCredito.decididoEm,
        createdAt: solicitacoesCredito.createdAt,
      })
      .from(solicitacoesCredito)
      .leftJoin(clientes, eq(clientes.id, solicitacoesCredito.clienteId))
      .where(eq(solicitacoesCredito.vendedorSolicitanteId, ctx.user.id))
      .orderBy(desc(solicitacoesCredito.createdAt))
      .limit(200)

      const ids = linhas.map((l) => l.id)
      const anexos = ids.length
        ? await db.query.solicitacaoCreditoAnexos.findMany({ where: inArray(solicitacaoCreditoAnexos.solicitacaoId, ids) })
        : []
      const anexosPorSolicitacao = new Map<number, typeof anexos>()
      for (const a of anexos) {
        const lista = anexosPorSolicitacao.get(a.solicitacaoId) ?? []
        lista.push(a)
        anexosPorSolicitacao.set(a.solicitacaoId, lista)
      }

      const decisorIds = [...new Set(linhas.map((l) => l.decididoPor).filter((id): id is number => id !== null))]
      const decisores = decisorIds.length
        ? await db.query.users.findMany({ where: inArray(users.id, decisorIds), columns: { id: true, name: true, whatsapp: true } })
        : []
      const decisorPorId = new Map(decisores.map((d) => [d.id, d]))

      return linhas.map((l) => ({
        ...l,
        anexos: anexosPorSolicitacao.get(l.id) ?? [],
        decisorNome: l.decididoPor ? decisorPorId.get(l.decididoPor)?.name ?? null : null,
        decisorWhatsapp: l.decididoPor ? decisorPorId.get(l.decididoPor)?.whatsapp ?? null : null,
      }))
  }),

  // Nomes dos vendedores que já têm alguma solicitação — alimenta o filtro
  // de vendedor na fila do Financeiro. Cross-empresa também (não dá pra
  // reaproveitar `users.vendors`, que só traz os da empresa ativa da
  // sessão).
  vendedoresOpcoes: featureProcedure('solicitacao_credito').query(async () => {
    return db
      .selectDistinct({ id: users.id, name: users.name })
      .from(solicitacoesCredito)
      .innerJoin(users, eq(users.id, solicitacoesCredito.vendedorSolicitanteId))
      .orderBy(users.name)
  }),

  // Empresas que já têm alguma solicitação — filtro "Empresa" (só aparece
  // na tela quando tem mais de uma).
  empresasOpcoes: featureProcedure('solicitacao_credito').query(async () => {
    return db
      .selectDistinct({ id: empresas.id, nome: empresas.nome })
      .from(solicitacoesCredito)
      .innerJoin(empresas, eq(empresas.id, solicitacoesCredito.empresaId))
      .orderBy(empresas.nome)
  }),

  // Quem decidiu — os 3 fixos + qualquer nome antigo que já tenha sido usado.
  quemDecidiuOpcoes: featureProcedure('solicitacao_credito').query(async () => {
    const linhas = await db
      .selectDistinct({ quemLiberou: solicitacoesCredito.quemLiberou })
      .from(solicitacoesCredito)
      .where(isNotNull(solicitacoesCredito.quemLiberou))
    return [...new Set([...QUEM_LIBERA, ...linhas.map((l) => l.quemLiberou).filter((n): n is string => !!n)])]
  }),

  // Fila do Financeiro — cross-empresa, sem filtro de ctx.empresaId de
  // propósito (mesmo padrão de liberacaoCredito.listar).
  listar: featureProcedure('solicitacao_credito')
    .input(filtrosInput)
    .query(async ({ input }) => {
      const filtros = montarFiltros(input)

      const linhas = await db
        .select({
          id: solicitacoesCredito.id,
          clienteId: solicitacoesCredito.clienteId,
          clienteNome: clienteNomeSql,
          clienteCodigo: clienteCodigoSql,
          cnpjAvulso: solicitacoesCredito.cnpjAvulso,
          empresaId: solicitacoesCredito.empresaId,
          empresaNome: empresas.nome,
          vendedorSolicitanteId: solicitacoesCredito.vendedorSolicitanteId,
          vendedorNome: users.name,
          tipo: solicitacoesCredito.tipo,
          tipoConsulta: solicitacoesCredito.tipoConsulta,
          status: solicitacoesCredito.status,
          valorSolicitado: solicitacoesCredito.valorSolicitado,
          valorPedido: solicitacoesCredito.valorPedido,
          valorLiberado: solicitacoesCredito.valorLiberado,
          quemLiberou: solicitacoesCredito.quemLiberou,
          serasaLimpo: solicitacoesCredito.serasaLimpo,
          cotacaoId: solicitacoesCredito.cotacaoId,
          createdAt: solicitacoesCredito.createdAt,
        })
        .from(solicitacoesCredito)
        .leftJoin(clientes, eq(clientes.id, solicitacoesCredito.clienteId))
        .innerJoin(empresas, eq(empresas.id, solicitacoesCredito.empresaId))
        .innerJoin(users, eq(users.id, solicitacoesCredito.vendedorSolicitanteId))
        .where(filtros.length ? and(...filtros) : undefined)
        .orderBy(desc(solicitacoesCredito.createdAt))
        .limit(500)

      return linhas
    }),

  // Relatórios (João, 2026-11-16: "deixar prontos relatórios, e filtros
  // ali, por vendedor e etc"). Mesmos filtros da lista. Calcula tudo em
  // memória — o volume é pequeno (dezenas/centenas por mês).
  relatorio: featureProcedure('solicitacao_credito')
    .input(filtrosInput)
    .query(async ({ input }) => {
      const filtros = montarFiltros(input)
      const linhas = await db
        .select({
          id: solicitacoesCredito.id,
          clienteId: solicitacoesCredito.clienteId,
          clienteNome: clienteNomeSql,
          clienteCodigo: clienteCodigoSql,
          cnpjAvulso: solicitacoesCredito.cnpjAvulso,
          empresaId: solicitacoesCredito.empresaId,
          empresaNome: empresas.nome,
          vendedorId: solicitacoesCredito.vendedorSolicitanteId,
          vendedorNome: users.name,
          tipo: solicitacoesCredito.tipo,
          status: solicitacoesCredito.status,
          valorSolicitado: solicitacoesCredito.valorSolicitado,
          valorLiberado: solicitacoesCredito.valorLiberado,
          serasaLimpo: solicitacoesCredito.serasaLimpo,
          createdAt: solicitacoesCredito.createdAt,
        })
        .from(solicitacoesCredito)
        .leftJoin(clientes, eq(clientes.id, solicitacoesCredito.clienteId))
        .innerJoin(empresas, eq(empresas.id, solicitacoesCredito.empresaId))
        .innerJoin(users, eq(users.id, solicitacoesCredito.vendedorSolicitanteId))
        .where(filtros.length ? and(...filtros) : undefined)

      // Todas as análises (inclusive réplicas) das solicitações filtradas —
      // "por quem decidiu" conta cada resposta dada, não só a última.
      const ids = linhas.map((l) => l.id)
      const respostas: { solicitacaoId: number; status: 'liberado' | 'negado'; quemLiberou: string; decididoEm: string }[] = []
      for (let i = 0; i < ids.length; i += 500) {
        const parte = ids.slice(i, i + 500)
        respostas.push(
          ...(await db
            .select({
              solicitacaoId: solicitacaoCreditoRespostas.solicitacaoId,
              status: solicitacaoCreditoRespostas.status,
              quemLiberou: solicitacaoCreditoRespostas.quemLiberou,
              decididoEm: solicitacaoCreditoRespostas.decididoEm,
            })
            .from(solicitacaoCreditoRespostas)
            .where(inArray(solicitacaoCreditoRespostas.solicitacaoId, parte)))
        )
      }
      respostas.sort((a, b) => a.decididoEm.localeCompare(b.decididoEm))

      // Tempo de resposta = da abertura do pedido até a 1ª análise, em
      // horário de trabalho (mesma regra dos leads: seg-sex, 8-12/13-17:48).
      const criadoEmPorId = new Map(linhas.map((l) => [l.id, l.createdAt]))
      const primeiraRespostaVista = new Set<number>()
      type Decisor = { quemLiberou: string; respostas: number; liberou: number; negou: number; somaMinutos: number; qtdTempo: number }
      const porDecisorMap = new Map<string, Decisor>()
      let somaMinutosGeral = 0
      let qtdTempoGeral = 0
      for (const r of respostas) {
        if (input?.quemLiberou && r.quemLiberou !== input.quemLiberou) continue
        const d = porDecisorMap.get(r.quemLiberou) ?? { quemLiberou: r.quemLiberou, respostas: 0, liberou: 0, negou: 0, somaMinutos: 0, qtdTempo: 0 }
        d.respostas++
        if (r.status === 'liberado') d.liberou++
        else d.negou++
        if (!primeiraRespostaVista.has(r.solicitacaoId)) {
          primeiraRespostaVista.add(r.solicitacaoId)
          const criadoEm = criadoEmPorId.get(r.solicitacaoId)
          if (criadoEm) {
            const min = businessHoursElapsedMs(toUtcISO(criadoEm), toUtcISO(r.decididoEm)) / 60000
            d.somaMinutos += min
            d.qtdTempo++
            somaMinutosGeral += min
            qtdTempoGeral++
          }
        }
        porDecisorMap.set(r.quemLiberou, d)
      }

      type Grupo = { pedidos: number; consultas: number; limites: number; pendentes: number; liberados: number; negados: number; valorSolicitado: number; valorLiberado: number }
      const novoGrupo = (): Grupo => ({ pedidos: 0, consultas: 0, limites: 0, pendentes: 0, liberados: 0, negados: 0, valorSolicitado: 0, valorLiberado: 0 })
      const somar = (g: Grupo, l: (typeof linhas)[number]) => {
        g.pedidos++
        if (l.tipo === 'limite') g.limites++
        else g.consultas++
        if (l.status === 'pendente') g.pendentes++
        else if (l.status === 'liberado') g.liberados++
        else g.negados++
        g.valorSolicitado += l.valorSolicitado ?? 0
        if (l.status === 'liberado') g.valorLiberado += l.valorLiberado ?? 0
      }
      const pct = (g: Grupo) => (g.liberados + g.negados ? Math.round((g.liberados / (g.liberados + g.negados)) * 1000) / 10 : null)

      const totais = novoGrupo()
      let serasaLimpos = 0
      let serasaNaoLimpos = 0
      const porVendedorMap = new Map<number, Grupo & { vendedorId: number; vendedorNome: string }>()
      const porMesMap = new Map<string, Grupo & { mes: string }>()
      const porEmpresaMap = new Map<number, Grupo & { empresaId: number; empresaNome: string }>()
      const porClienteMap = new Map<string, Grupo & { clienteId: number | null; clienteNome: string; clienteCodigo: string; empresaNome: string; ultimoPedido: string }>()
      for (const l of linhas) {
        somar(totais, l)
        if (l.serasaLimpo === true) serasaLimpos++
        if (l.serasaLimpo === false) serasaNaoLimpos++

        const v = porVendedorMap.get(l.vendedorId) ?? { ...novoGrupo(), vendedorId: l.vendedorId, vendedorNome: l.vendedorNome }
        somar(v, l)
        porVendedorMap.set(l.vendedorId, v)

        const mes = toLocalDateKey(toUtcISO(l.createdAt)).slice(0, 7)
        const m = porMesMap.get(mes) ?? { ...novoGrupo(), mes }
        somar(m, l)
        porMesMap.set(mes, m)

        const e = porEmpresaMap.get(l.empresaId) ?? { ...novoGrupo(), empresaId: l.empresaId, empresaNome: l.empresaNome }
        somar(e, l)
        porEmpresaMap.set(l.empresaId, e)

        const chaveCliente = l.clienteId != null ? `c${l.clienteId}` : `cnpj${l.cnpjAvulso}`
        const c = porClienteMap.get(chaveCliente) ?? { ...novoGrupo(), clienteId: l.clienteId, clienteNome: l.clienteNome, clienteCodigo: l.clienteCodigo, empresaNome: l.empresaNome, ultimoPedido: l.createdAt }
        somar(c, l)
        if (l.createdAt > c.ultimoPedido) c.ultimoPedido = l.createdAt
        porClienteMap.set(chaveCliente, c)
      }

      const comPct = <T extends Grupo>(g: T) => ({ ...g, pctLiberado: pct(g) })
      return {
        totais: {
          ...comPct(totais),
          serasaLimpos,
          serasaNaoLimpos,
          tempoMedioMinutos: qtdTempoGeral ? Math.round(somaMinutosGeral / qtdTempoGeral) : null,
        },
        porVendedor: [...porVendedorMap.values()].map(comPct).sort((a, b) => b.pedidos - a.pedidos || a.vendedorNome.localeCompare(b.vendedorNome)),
        porDecisor: [...porDecisorMap.values()]
          .map((d) => ({
            quemLiberou: d.quemLiberou,
            respostas: d.respostas,
            liberou: d.liberou,
            negou: d.negou,
            pctLiberado: d.respostas ? Math.round((d.liberou / d.respostas) * 1000) / 10 : null,
            tempoMedioMinutos: d.qtdTempo ? Math.round(d.somaMinutos / d.qtdTempo) : null,
          }))
          .sort((a, b) => b.respostas - a.respostas),
        porMes: [...porMesMap.values()].map(comPct).sort((a, b) => b.mes.localeCompare(a.mes)),
        porEmpresa: [...porEmpresaMap.values()].map(comPct).sort((a, b) => b.pedidos - a.pedidos),
        porCliente: [...porClienteMap.values()]
          .map(comPct)
          .sort((a, b) => b.pedidos - a.pedidos || b.ultimoPedido.localeCompare(a.ultimoPedido))
          .slice(0, 50),
      }
    }),

  // Pesquisar cliente (financeiro, 2026-11-24: "pesquisar o código do
  // cliente e ver se recente já consultei o CNPJ dele, ao invés de olhar um
  // por um"). Busca por código, código antigo, razão social ou CNPJ/CPF e
  // junta os cadastros do MESMO documento em todas as empresas — o CNPJ pode
  // ter sido consultado pela Joitec e agora o pedido vir da Odin Tubos.
  pesquisarCliente: featureProcedure('solicitacao_credito')
    .input(z.object({ q: z.string().trim().min(2) }))
    .query(async ({ input }) => pesquisarClienteCredito(input)),

  // Versão do vendedor (João, 2026-11-24: "preciso mostrar pro vendedor, é
  // para ele pesquisar"): antes de pedir de novo, vê se o CNPJ já foi
  // consultado e se tem pedido esperando. Só data, limpo/não e resultado —
  // sem valores, sem quem liberou, sem nome de outros vendedores.
  pesquisarClienteVendedor: adminOrFeatureProcedure('solicitacao_credito')
    .input(z.object({ q: z.string().trim().min(2) }))
    .query(async ({ input }) => {
      const r = await pesquisarClienteCredito(input)
      return {
        muitos: r.muitos,
        grupos: r.grupos.map((g) => {
          const pendente = g.pedidos.find((p) => p.status === 'pendente')
          return {
            chave: g.chave,
            nome: g.nome,
            documento: g.documento,
            cadastros: g.cadastros.map((c) => ({ codigo: c.codigo, empresaNome: c.empresaNome })),
            ultimaConsulta: g.ultimaConsulta
              ? { serasaConsultaEm: g.ultimaConsulta.serasaConsultaEm, serasaLimpo: g.ultimaConsulta.serasaLimpo, status: g.ultimaConsulta.status, empresaNome: g.ultimaConsulta.empresaNome }
              : null,
            sapSerasaEm: g.sap?.data ?? null,
            soNoSap: g.soNoSap,
            pendenteDesde: pendente?.createdAt ?? null,
            totalPedidos: g.pedidos.length,
          }
        }),
      }
    }),

  detalhe: featureProcedure('solicitacao_credito').input(z.object({ id: z.number() })).query(async ({ input }) => {
    const solicitacao = await db.query.solicitacoesCredito.findFirst({ where: eq(solicitacoesCredito.id, input.id) })
    if (!solicitacao) throw new Error('Solicitação não encontrada')

    const [cliente, vendedor, anexos, respostas] = await Promise.all([
      solicitacao.clienteId != null ? db.query.clientes.findFirst({ where: eq(clientes.id, solicitacao.clienteId) }) : Promise.resolve(undefined),
      db.query.users.findFirst({ where: eq(users.id, solicitacao.vendedorSolicitanteId), columns: { id: true, name: true, whatsapp: true } }),
      db.query.solicitacaoCreditoAnexos.findMany({
        where: eq(solicitacaoCreditoAnexos.solicitacaoId, solicitacao.id),
        orderBy: (a, { asc }) => [asc(a.createdAt)],
      }),
      db.query.solicitacaoCreditoRespostas.findMany({
        where: eq(solicitacaoCreditoRespostas.solicitacaoId, solicitacao.id),
        orderBy: (r, { asc }) => [asc(r.createdAt)],
      }),
    ])
    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, cliente?.empresaId ?? solicitacao.empresaId) })

    const decisorIds = [...new Set(respostas.map((r) => r.decididoPor).filter((id): id is number => id !== null))]
    const decisores = decisorIds.length
      ? await db.query.users.findMany({ where: inArray(users.id, decisorIds), columns: { id: true, name: true } })
      : []
    const decisorPorId = new Map(decisores.map((d) => [d.id, d.name]))

    return {
      ...solicitacao,
      clienteNome: cliente?.razaoSocial ?? solicitacao.nomeAvulso ?? (solicitacao.cnpjAvulso ? formatarCnpj(solicitacao.cnpjAvulso) : '—'),
      clienteCodigo: cliente?.codigo ?? (solicitacao.cnpjAvulso ? 'sem cadastro' : '—'),
      // CNPJ/CPF em destaque pro financeiro consultar o Serasa direto.
      clienteDocumento: cliente?.cnpj || cliente?.cpf || (solicitacao.cnpjAvulso ? formatarCnpj(solicitacao.cnpjAvulso) : null),
      semCadastro: solicitacao.clienteId == null,
      empresaNome: empresa?.nome ?? '—',
      vendedorNome: vendedor?.name ?? '—',
      vendedorWhatsapp: vendedor?.whatsapp ?? null,
      anexos,
      respostas: respostas.map((r) => ({ ...r, decisorNome: r.decididoPor ? decisorPorId.get(r.decididoPor) ?? null : null })),
    }
  }),

  // Histórico completo do cliente pra quem vai decidir — cross-empresa igual
  // o resto desta tela, por isso NÃO reaproveita `clientes.historico`
  // diretamente (aquele é travado na empresa ativa da sessão e em quem é
  // dono do cliente; aqui a permissão de verdade já é a feature acima).
  historicoCliente: featureProcedure('solicitacao_credito')
    .input(z.object({ clienteId: z.number() }))
    .query(async ({ input }) => buildHistoricoCliente(input.clienteId)),

  responder: featureProcedure('solicitacao_credito')
    .input(
      z.object({
        id: z.number(),
        decisao: z.enum(['liberado', 'negado']),
        valorLiberado: z.number().positive().optional(),
        quemLiberou: z.string().trim().min(1, 'Informe quem decidiu'),
        motivoResposta: z.string().trim().min(1, 'Informe o motivo'),
        serasaObservacao: z.string().trim().optional(),
        // Primeiro: está limpo ou não? E quando foi a consulta (2026-11-13).
        serasaLimpo: z.boolean(),
        serasaConsultaEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data da consulta do Serasa'),
        anexos: z.array(anexoInput).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const solicitacao = await db.query.solicitacoesCredito.findFirst({ where: eq(solicitacoesCredito.id, input.id) })
      if (!solicitacao) throw new Error('Solicitação não encontrada')
      // tipo='consulta'+'limpo' é só "está limpo ou não", sem valor nenhum
      // — pedido do João, 2026-10-05. Pros outros dois casos (consulta
      // geral e limite), valor continua obrigatório pra liberar.
      const exigeValor = !(solicitacao.tipo === 'consulta' && solicitacao.tipoConsulta === 'limpo')
      if (input.decisao === 'liberado' && exigeValor && !input.valorLiberado) {
        throw new Error('Informe o valor liberado.')
      }

      const decididoEm = agoraSqlite()
      const updates: Record<string, unknown> = {
        status: input.decisao,
        quemLiberou: input.quemLiberou.trim(),
        motivoResposta: input.motivoResposta.trim(),
        decididoPor: ctx.user.id,
        decididoEm,
        updatedAt: agoraSqlite(),
      }
      if (input.decisao === 'liberado') updates.valorLiberado = input.valorLiberado
      if (input.serasaObservacao) updates.serasaObservacao = input.serasaObservacao
      updates.serasaLimpo = input.serasaLimpo
      updates.serasaConsultaEm = input.serasaConsultaEm

      await db.update(solicitacoesCredito).set(updates).where(eq(solicitacoesCredito.id, input.id))

      // Guarda essa resposta no histórico — dá pra responder de novo depois
      // (reavaliação: ex. cliente quitou o boleto que motivou a negativa),
      // sem perder o registro da decisão anterior. Pedido do João, 2026-10-14.
      await db.insert(solicitacaoCreditoRespostas).values({
        solicitacaoId: input.id,
        status: input.decisao,
        valorLiberado: input.decisao === 'liberado' ? input.valorLiberado : undefined,
        quemLiberou: input.quemLiberou.trim(),
        motivoResposta: input.motivoResposta.trim(),
        serasaObservacao: [input.serasaLimpo ? 'Serasa: LIMPO' : 'Serasa: NÃO está limpo', `consulta de ${input.serasaConsultaEm.split('-').reverse().join('/')}`, input.serasaObservacao].filter(Boolean).join(' · '),
        decididoPor: ctx.user.id,
        decididoEm,
      })

      if (input.anexos?.length) {
        await db.insert(solicitacaoCreditoAnexos).values(
          input.anexos.map((a) => ({
            solicitacaoId: input.id,
            origem: 'financeiro' as const,
            urlArquivo: a.urlArquivo,
            nomeArquivo: a.nomeArquivo,
            tipoArquivo: a.tipoArquivo,
          }))
        )
      }

      // Pedido do João, 2026-10-01: toda resposta de CONSULTA (liberado OU
      // negado) também entra no histórico de Liberação de Crédito > Lançamentos
      // — registro único de "o que já foi decidido" pra esse cliente, cross-
      // empresa. Mudou em 2026-10-05: 'limite' não entra mais aqui — fica só
      // na própria fila (aba "Limites"), pra não misturar as duas listas.
      // 2026-11-13 (financeiro): consulta/limite e liberação são coisas
      // diferentes — a consulta só registra os dados e dá o limite; os
      // Registros de liberação são lançados pelo próprio financeiro. Não
      // copia mais a resposta da consulta pra lá.
      if (false as boolean) {
        const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, solicitacao.clienteId!) })
        await db.insert(liberacoesCredito).values({
          clienteId: solicitacao.clienteId!,
          empresaId: solicitacao.empresaId,
          vendedorId: cliente?.vendedorAtualId ?? solicitacao.vendedorSolicitanteId,
          quemLiberou: input.quemLiberou.trim(),
          motivo: input.motivoResposta.trim(),
          status: input.decisao,
          valorLiberado: input.decisao === 'liberado' ? input.valorLiberado : undefined,
          origemSolicitacaoId: input.id,
          criadoPor: ctx.user.id,
        })
      }

      // Veio da Cotação do CRM (venda a prazo sem limite no SAP): a resposta
      // aparece na cotação e o vendedor é avisado (João, 2026-11-11).
      if (solicitacao.cotacaoId && solicitacao.clienteId != null) {
        const valor = input.valorLiberado ? ` · ${input.valorLiberado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''
        const liberou = input.decisao === 'liberado'
        await db.insert(cotacoesCrmHistorico).values({
          cotacaoId: solicitacao.cotacaoId,
          userId: ctx.user.id,
          acao: liberou ? 'Financeiro liberou o crédito' : 'Financeiro negou o crédito',
          detalhe: `${input.motivoResposta.trim()}${valor} (${input.quemLiberou.trim()})`,
        })
        const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, solicitacao.clienteId!), columns: { razaoSocial: true } })
        await db.insert(notifications).values({
          vendedorId: solicitacao.vendedorSolicitanteId,
          clienteId: solicitacao.clienteId,
          type: 'info',
          title: liberou ? 'Crédito liberado — pode gerar o pedido' : 'Crédito negado pelo financeiro',
          message: liberou
            ? `O financeiro liberou a venda a prazo da cotação nº ${solicitacao.cotacaoId} (${cliente?.razaoSocial ?? ''})${valor}. Abra em Cotações e clique em Gerar pedido no SAP.`
            : `O financeiro negou a venda a prazo da cotação nº ${solicitacao.cotacaoId} (${cliente?.razaoSocial ?? ''}): ${input.motivoResposta.trim()}. Dá para mudar o prazo para À vista.`,
        })
      }

      // Sininho + aviso animado pro vendedor em TODA resposta (João,
      // 2026-11-27) — a da cotação já tem o aviso próprio acima.
      if (!solicitacao.cotacaoId) {
        const cli = solicitacao.clienteId != null
          ? await db.query.clientes.findFirst({ where: eq(clientes.id, solicitacao.clienteId), columns: { razaoSocial: true } })
          : null
        const nome = cli?.razaoSocial ?? solicitacao.nomeAvulso ?? (solicitacao.cnpjAvulso ? formatarCnpj(solicitacao.cnpjAvulso) : 'cliente')
        const liberou = input.decisao === 'liberado'
        const oQue = solicitacao.tipo === 'limite' ? 'Limite de crédito' : 'Consulta de crédito'
        const valor = liberou && input.valorLiberado ? ` · limite ${input.valorLiberado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''
        await db.insert(notifications).values({
          vendedorId: solicitacao.vendedorSolicitanteId,
          type: liberou ? 'credito_resposta_liberado' : 'credito_resposta_negado',
          title: `${oQue} ${liberou ? 'LIBERADA' : 'NEGADA'} — ${nome}`,
          message: `${input.serasaLimpo ? 'Serasa limpo' : 'Serasa NÃO está limpo'}${valor}. ${input.motivoResposta.trim()} — ${input.quemLiberou.trim()}`,
        })
      }

      return { success: true }
    }),
})
