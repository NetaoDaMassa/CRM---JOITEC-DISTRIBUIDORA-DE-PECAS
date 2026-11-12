// Cadastro de cliente no CRM → SAP → aprovação do financeiro (João,
// 2026-11-11: "vamos parar de puxar novos cadastros de clientes do SAP; vamos
// cadastrar no CRM com as informações que o SAP precisa, vai pro SAP e as
// pessoas responsáveis aprovam" — quem aprova é a Izabelly do financeiro).
// Fluxo: vendedor preenche (igual ao "Inserir Lead" do Portal One) → Enviar
// cria o cliente INATIVO no SAP + o cliente no CRM (carteira do vendedor) →
// Izabelly confere, ajusta o fiscal se precisar e Aprova (CRM ativa no SAP e
// marca todas as formas de pagamento) ou Devolve com motivo → vendedor é
// avisado. Se ela ativar direto no SAP, a rodada de 10 min percebe.
import { z } from 'zod'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure, temFeature } from './_base.js'
import { db } from '../db/client.js'
import { cadastrosClientesSap, carteiraHistorico, clientes, empresas, funilMensal, notifications, permissoesAdmin, sapListasPreco, sapPrazosPagamento, users } from '../db/schema.js'
import { agoraSqlite, mesReferenciaAtual } from '../lib/dataBr.js'
import { buscarCnpj } from '../lib/brasilApi.js'
import { cnpjValido, limparCnpj } from '../lib/cnpj.js'
import { cpfValido, limparCpf } from '../lib/cpf.js'
import { regiaoPorUf } from '../lib/regiao.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { filialDaEmpresa } from '../lib/sapEstoque.js'
import { formasPagamentoDaFilial } from '../lib/sapCotacoesEscrita.js'
import { vendedoresLigados, vendedoresSap } from '../lib/sapClientes.js'
import { comSessaoSap, sapConfigurado } from '../lib/sapServiceLayer.js'
import {
  FILIAIS_SAP,
  GRUPOS_CLIENTE,
  GRUPOS_TRIBUTARIOS,
  USOS_PRINCIPAIS,
  contatosDe,
  listasCadastroSap,
  INDICADORES,
  INDICADORES_CONSUMIDOR,
  INDICADORES_IE,
  REGIOES_SUFRAMA,
  aprovarClienteSap,
  corrigirClienteSap,
  criarClienteSap,
  faltando,
  procurarNoSap,
  situacaoNoSap,
  type DadosCadastro,
} from '../lib/sapCadastroCliente.js'

export const FEATURE_APROVAR = 'aprovacao_cadastro_cliente'
const SLUGS = ['joitec', 'odin-tubos', 'joitec-automacao']

const cadastroProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user.superAdmin && !(await temFeature(ctx.user.id, 'cotacoes'))) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cadastro de clientes não liberado pra você' })
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { slug: true } })
  const filial = empresa ? filialDaEmpresa(empresa.slug) : null
  if (!empresa || !filial || !SLUGS.includes(empresa.slug)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cadastro no SAP só para Joitec, Odin Automação e Odin Tubos' })
  const veTudo = ctx.user.superAdmin || ctx.user.role === 'admin'
  return next({ ctx: { ...ctx, filial, veTudo } })
})

const aprovadorProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user.superAdmin && !(await temFeature(ctx.user.id, FEATURE_APROVAR))) throw new TRPCError({ code: 'FORBIDDEN', message: 'Aprovação de cadastros não liberada pra você' })
  return next({ ctx })
})

const endereco = z.object({
  cep: z.string().default(''),
  tipoLogradouro: z.string().default('Rua'),
  rua: z.string().default(''),
  numero: z.string().default(''),
  complemento: z.string().default(''),
  bairro: z.string().default(''),
  cidade: z.string().default(''),
  uf: z.string().default(''),
})
const dadosSchema = z.object({
  pessoa: z.enum(['juridica', 'fisica']),
  nome: z.string().default(''),
  fantasia: z.string().default(''),
  cnpj: z.string().default(''),
  cpf: z.string().default(''),
  ie: z.string().default(''),
  ieIsento: z.boolean().default(false),
  suframa: z.string().default(''),
  regiaoSuframa: z.string().default('0'),
  grupoTributario: z.string().default(''),
  indicadorIE: z.string().default(''),
  indicadorConsumidor: z.string().default(''),
  grupoCliente: z.number().int().default(100),
  ultimaConsultaSerasa: z.string().default(''),
  ddd: z.string().default(''),
  telefone: z.string().default(''),
  dddCelular: z.string().default(''),
  celular: z.string().default(''),
  email: z.string().default(''),
  site: z.string().default(''),
  indicador: z.string().default(''),
  observacoes: z.string().default(''),
  contatoNome: z.string().default(''),
  contatoTelefone: z.string().default(''),
  contatoEmail: z.string().default(''),
  contatos: z
    .array(z.object({ nome: z.string().default(''), cargo: z.string().default(''), telefone: z.string().default(''), celular: z.string().default(''), email: z.string().default('') }))
    .max(20)
    .default([]),
  respComercial: z.number().int().nullable().default(null),
  usoPrincipal: z.number().int().default(10),
  limiteCredito: z.number().min(0).max(100_000_000).default(0),
  segmento: z.number().int().nullable().default(null),
  territorio: z.number().int().nullable().default(null),
  formasPagamento: z.array(z.string()).nullable().default(null),
  filiais: z.array(z.number().int()).default([]),
  cobranca: endereco,
  entregaIgual: z.boolean().default(true),
  entrega: endereco,
  prazoCodigo: z.number().int().default(-1),
  listaPreco: z.number().int().default(1),
})

type Historico = { em: string; por: string; acao: string; detalhe?: string }
type Linha = typeof cadastrosClientesSap.$inferSelect

const lerDados = (l: Linha) => JSON.parse(l.dados) as DadosCadastro
const lerHistorico = (l: Linha): Historico[] => {
  try {
    return JSON.parse(l.historico) as Historico[]
  } catch {
    return []
  }
}
function comHistorico(l: Linha, por: string, acao: string, detalhe?: string) {
  return JSON.stringify([...lerHistorico(l), { em: agoraSqlite(), por, acao, ...(detalhe ? { detalhe } : {}) }])
}

const so = (s: string) => (s ?? '').replace(/\D/g, '')
const erroSap = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 600)

async function avisar(userId: number, clienteId: number | null, titulo: string, mensagem: string) {
  await db.insert(notifications).values({ vendedorId: userId, clienteId, type: 'info', title: titulo, message: mensagem })
}

async function aprovadores(): Promise<number[]> {
  const l = await db
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(permissoesAdmin, eq(permissoesAdmin.userId, users.id))
    .where(and(eq(permissoesAdmin.feature, FEATURE_APROVAR), eq(users.isActive, true)))
  return l.map((u) => u.id)
}

// Código do vendedor no SAP (ligação vendedor SAP → usuário do CRM).
async function vendedorSapDe(userId: number | null): Promise<number | null> {
  if (!userId) return null
  const mapa = await vendedoresLigados()
  const achado = Object.entries(mapa).find(([, uid]) => uid === userId)
  return achado ? Number(achado[0]) : null
}

async function acharLinha(id: number, empresaId?: number) {
  const l = await db.query.cadastrosClientesSap.findFirst({ where: eq(cadastrosClientesSap.id, id) })
  if (!l || (empresaId != null && l.empresaId !== empresaId)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cadastro não encontrado' })
  return l
}

function podeMexer(l: Linha, ctx: { user: { id: number }; veTudo: boolean }) {
  if (!ctx.veTudo && l.vendedorId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cadastro de outro vendedor' })
}

const statusFiscalDe = (d: DadosCadastro): 'isento' | 'normal' | 'consumidor_final' =>
  d.indicadorConsumidor === '1' ? 'consumidor_final' : d.ieIsento ? 'isento' : 'normal'

// Campos do cliente do CRM a partir do cadastro.
function camposCliente(d: DadosCadastro) {
  const e = d.cobranca
  const fone = so(d.celular) ? `${so(d.dddCelular)}${so(d.celular)}` : `${so(d.ddd)}${so(d.telefone)}`
  const uf = e.uf.trim().toUpperCase()
  return {
    razaoSocial: d.nome.trim().toUpperCase(),
    cnpj: d.pessoa === 'juridica' ? limparCnpj(d.cnpj) : null,
    cpf: d.pessoa === 'fisica' ? limparCpf(d.cpf) : null,
    inscricaoEstadual: d.pessoa === 'juridica' ? (d.ieIsento ? 'ISENTO' : d.ie.trim()) : null,
    estado: uf || null,
    regiao: uf ? regiaoPorUf(uf) : null,
    cidade: e.cidade.trim() || null,
    endereco: e.rua.trim() || null,
    numero: e.numero.trim() || null,
    complemento: e.complemento.trim() || null,
    bairro: e.bairro.trim() || null,
    cep: so(e.cep) || null,
    telefoneWhatsapp: fone || null,
    email: d.email.trim() || null,
    nomeContato: contatosDe(d)[0]?.nome.trim() || null,
    statusFiscal: statusFiscalDe(d),
  }
}

// Cria (ou liga) o cliente no CRM com o código do SAP.
async function clienteNoCrm(l: Linha, d: DadosCadastro, cardCode: string, autorId: number): Promise<number> {
  const campos = camposCliente(d)
  const doc = campos.cnpj ? eq(clientes.cnpj, campos.cnpj) : campos.cpf ? eq(clientes.cpf, campos.cpf) : null
  let alvo = l.clienteId ? await db.query.clientes.findFirst({ where: and(eq(clientes.id, l.clienteId), eq(clientes.empresaId, l.empresaId)) }) : undefined
  if (!alvo && doc) alvo = await db.query.clientes.findFirst({ where: and(eq(clientes.empresaId, l.empresaId), doc, isNull(clientes.deletedAt)) })
  if (alvo) {
    const codigo = alvo.codigo.startsWith('M') || alvo.codigo.startsWith('P') ? { codigo: cardCode } : alvo.codigo === cardCode ? {} : { codigoAntigo: alvo.codigoAntigo ?? alvo.codigo, codigo: cardCode }
    await db.update(clientes).set({ ...campos, ...codigo, updatedAt: agoraSqlite() }).where(eq(clientes.id, alvo.id))
    await registrarAuditoria({ tabela: 'clientes', registroId: alvo.id, acao: 'editar', alteradoPor: autorId, campo: 'codigo', valorAnterior: alvo.codigo, valorNovo: `${cardCode} (cadastro enviado ao SAP)` })
    return alvo.id
  }
  const r = await db.insert(clientes).values({ empresaId: l.empresaId, ...campos, codigo: cardCode, cadastradoPor: autorId, vendedorAtualId: l.vendedorId })
  const clienteId = Number(r.lastInsertRowid)
  if (l.vendedorId) {
    await db.insert(carteiraHistorico).values({ clienteId, vendedorId: l.vendedorId })
    await db.insert(funilMensal).values({ clienteId, vendedorId: l.vendedorId, mesReferencia: mesReferenciaAtual() })
  }
  await registrarAuditoria({ tabela: 'clientes', registroId: clienteId, acao: 'criar', alteradoPor: autorId, campo: 'origem', valorNovo: `Cadastro do CRM enviado ao SAP (${cardCode})` })
  return clienteId
}

// Pré-preenche a partir de um cliente do CRM (prospect sem código do SAP).
function dadosDoCliente(c: typeof clientes.$inferSelect): Partial<DadosCadastro> {
  const fone = so(c.telefoneWhatsapp ?? '').replace(/^55(?=\d{10,11}$)/, '')
  const end = { cep: c.cep ?? '', tipoLogradouro: 'Rua', rua: c.endereco ?? '', numero: c.numero ?? '', complemento: c.complemento ?? '', bairro: c.bairro ?? '', cidade: c.cidade ?? '', uf: c.estado ?? '' }
  const isento = (c.inscricaoEstadual ?? '').toUpperCase().startsWith('ISENT')
  return {
    pessoa: c.cpf && !c.cnpj ? 'fisica' : 'juridica',
    nome: c.razaoSocial,
    cnpj: c.cnpj ?? '',
    cpf: c.cpf ?? '',
    ie: isento ? '' : c.inscricaoEstadual ?? '',
    ieIsento: isento,
    dddCelular: fone.length >= 10 ? fone.slice(0, 2) : '',
    celular: fone.length >= 10 ? fone.slice(2) : fone,
    email: c.email ?? '',
    contatoNome: c.nomeContato ?? '',
    cobranca: end,
    entrega: end,
    entregaIgual: true,
  }
}

function resumo(l: Linha, nomes: Map<number, string>, empresasNome?: Map<number, string>) {
  const d = lerDados(l)
  return {
    id: l.id,
    status: l.status,
    cardCode: l.cardCode,
    clienteId: l.clienteId,
    nome: d.nome,
    documento: d.pessoa === 'juridica' ? d.cnpj : d.cpf,
    cidade: [d.cobranca.cidade, d.cobranca.uf].filter(Boolean).join(' / '),
    vendedor: l.vendedorId ? nomes.get(l.vendedorId) ?? '—' : '—',
    empresa: empresasNome?.get(l.empresaId) ?? null,
    motivoDevolucao: l.motivoDevolucao,
    erroSap: l.erroSap,
    enviadoEm: l.enviadoEm,
    aprovadoEm: l.aprovadoEm,
    updatedAt: l.updatedAt,
  }
}

async function nomesUsuarios(ids: (number | null)[]) {
  const lista = [...new Set(ids.filter((x): x is number => x != null))]
  if (!lista.length) return new Map<number, string>()
  const us = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, lista))
  return new Map(us.map((u) => [u.id, u.name]))
}

async function listasSap() {
  const [prazos, listas] = await Promise.all([db.select().from(sapPrazosPagamento), db.select().from(sapListasPreco)])
  return {
    prazos: prazos.sort((a, b) => (a.codigo === -1 ? -1 : b.codigo === -1 ? 1 : a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))).map((p) => ({ v: p.codigo, l: p.nome })),
    listas: listas.sort((a, b) => a.numero - b.numero).map((x) => ({ v: x.numero, l: x.nome })),
  }
}

const OPCOES = {
  gruposTributarios: GRUPOS_TRIBUTARIOS,
  indicadoresIE: INDICADORES_IE,
  indicadoresConsumidor: INDICADORES_CONSUMIDOR,
  regioesSuframa: REGIOES_SUFRAMA,
  gruposCliente: GRUPOS_CLIENTE,
  indicadores: INDICADORES,
  filiais: FILIAIS_SAP,
  usosPrincipais: USOS_PRINCIPAIS,
}

// Listas que vêm do SAP: segmentos, territórios e vendedores (resp. comercial).
async function opcoesSap() {
  const [l, vend] = await Promise.all([sapConfigurado() ? listasCadastroSap() : { segmentos: [], territorios: [] }, sapConfigurado() ? vendedoresSap().catch(() => []) : []])
  return { ...l, vendedores: vend.filter((v) => v.ativo).map((v) => ({ v: v.codigo, l: v.nome })).sort((a, b) => a.l.localeCompare(b.l, 'pt-BR')) }
}

export const cadastrosClientesRouter = router({
  contexto: cadastroProcedure.query(async ({ ctx }) => {
    const [l, formas, vendSap, sap] = await Promise.all([listasSap(), formasPagamentoDaFilial(ctx.filial).catch(() => []), vendedorSapDe(ctx.user.id), opcoesSap()])
    return { ...OPCOES, ...l, ...sap, formas, vendedorTemSap: vendSap != null, vendedorSap: vendSap, filialPadrao: ctx.filial, veTudo: ctx.veTudo }
  }),

  // CNPJ: dados da Receita + já existe no CRM/SAP?
  consultarDocumento: cadastroProcedure.input(z.object({ pessoa: z.enum(['juridica', 'fisica']), documento: z.string() })).mutation(async ({ ctx, input }) => {
    const doc = so(input.documento)
    if (input.pessoa === 'juridica' && !cnpjValido(doc)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'CNPJ inválido' })
    if (input.pessoa === 'fisica' && !cpfValido(doc)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'CPF inválido' })
    const noCrm = await db.query.clientes.findFirst({
      where: and(eq(clientes.empresaId, ctx.empresaId), input.pessoa === 'juridica' ? eq(clientes.cnpj, doc) : eq(clientes.cpf, doc), isNull(clientes.deletedAt)),
      columns: { id: true, razaoSocial: true, codigo: true, vendedorAtualId: true },
    })
    const vendedorCrm = noCrm?.vendedorAtualId ? (await nomesUsuarios([noCrm.vendedorAtualId])).get(noCrm.vendedorAtualId) ?? null : null
    const dadosParaSap = { pessoa: input.pessoa, cnpj: input.pessoa === 'juridica' ? doc : '', cpf: input.pessoa === 'fisica' ? doc : '' } as DadosCadastro
    const [receita, noSap] = await Promise.all([
      input.pessoa === 'juridica' ? buscarCnpj(doc).catch(() => null) : null,
      sapConfigurado() ? procurarNoSap(dadosParaSap).catch(() => null) : null,
    ])
    return { receita, noSap, noCrm: noCrm ? { ...noCrm, vendedor: vendedorCrm, ehSap: /^C\d{4,}$/i.test(noCrm.codigo) } : null }
  }),

  meus: cadastroProcedure.query(async ({ ctx }) => {
    const ls = await db
      .select()
      .from(cadastrosClientesSap)
      .where(and(eq(cadastrosClientesSap.empresaId, ctx.empresaId), ctx.veTudo ? undefined : eq(cadastrosClientesSap.vendedorId, ctx.user.id)))
      .orderBy(desc(cadastrosClientesSap.updatedAt))
      .limit(300)
    const nomes = await nomesUsuarios(ls.map((l) => l.vendedorId))
    return ls.map((l) => resumo(l, nomes))
  }),

  obter: cadastroProcedure.input(z.object({ id: z.number().int() })).query(async ({ ctx, input }) => {
    const l = await acharLinha(input.id, ctx.empresaId)
    podeMexer(l, ctx)
    return { ...resumo(l, await nomesUsuarios([l.vendedorId])), dados: lerDados(l), historico: lerHistorico(l) }
  }),

  doCliente: cadastroProcedure.input(z.object({ clienteId: z.number().int() })).query(async ({ ctx, input }) => {
    const c = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId), isNull(clientes.deletedAt)) })
    if (!c || (!ctx.veTudo && c.vendedorAtualId !== ctx.user.id)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cliente fora da sua carteira' })
    const aberto = await db.query.cadastrosClientesSap.findFirst({ where: and(eq(cadastrosClientesSap.clienteId, c.id), inArray(cadastrosClientesSap.status, ['rascunho', 'aguardando', 'devolvido'])) })
    return { cliente: { id: c.id, codigo: c.codigo, razaoSocial: c.razaoSocial }, dados: dadosDoCliente(c), cadastroAberto: aberto?.id ?? null }
  }),

  salvar: cadastroProcedure
    .input(z.object({ id: z.number().int().optional(), clienteId: z.number().int().optional(), dados: dadosSchema }))
    .mutation(async ({ ctx, input }) => {
      const dados = JSON.stringify(input.dados)
      if (input.id) {
        const l = await acharLinha(input.id, ctx.empresaId)
        podeMexer(l, ctx)
        if (l.status === 'aguardando' || l.status === 'aprovado') throw new TRPCError({ code: 'BAD_REQUEST', message: l.status === 'aprovado' ? 'Cadastro já aprovado' : 'Cadastro esperando o financeiro — não dá pra mudar agora' })
        await db.update(cadastrosClientesSap).set({ dados, updatedAt: agoraSqlite() }).where(eq(cadastrosClientesSap.id, l.id))
        return { id: l.id }
      }
      if (input.clienteId) {
        const c = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId)) })
        if (!c || (!ctx.veTudo && c.vendedorAtualId !== ctx.user.id)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cliente fora da sua carteira' })
      }
      const [nova] = await db
        .insert(cadastrosClientesSap)
        .values({ empresaId: ctx.empresaId, vendedorId: ctx.user.id, clienteId: input.clienteId ?? null, dados, historico: JSON.stringify([{ em: agoraSqlite(), por: ctx.user.name, acao: 'Começou o cadastro' }]) })
        .returning({ id: cadastrosClientesSap.id })
      return { id: nova.id }
    }),

  excluir: cadastroProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    const l = await acharLinha(input.id, ctx.empresaId)
    podeMexer(l, ctx)
    if (l.status !== 'rascunho' || l.cardCode) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Só dá pra apagar rascunho que ainda não foi ao SAP' })
    await db.delete(cadastrosClientesSap).where(eq(cadastrosClientesSap.id, l.id))
    return { ok: true }
  }),

  // Envia ao SAP (cria inativo) ou reenvia corrigido (devolvido).
  enviar: cadastroProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    const l = await acharLinha(input.id, ctx.empresaId)
    podeMexer(l, ctx)
    if (l.status === 'aguardando' || l.status === 'aprovado') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Já foi enviado' })
    const d = lerDados(l)
    if (!d.filiais?.length) d.filiais = [ctx.filial]
    const falta = faltando(d)
    if (falta.length) throw new TRPCError({ code: 'BAD_REQUEST', message: `Falta preencher: ${falta.join(', ')}` })
    if (d.pessoa === 'juridica' && !cnpjValido(d.cnpj)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'CNPJ inválido' })
    if (d.pessoa === 'fisica' && !cpfValido(d.cpf)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'CPF inválido' })
    if (!sapConfigurado()) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'SAP não configurado' })

    // Já está no CRM em outra carteira?
    const campos = camposCliente(d)
    const doc = campos.cnpj ? eq(clientes.cnpj, campos.cnpj) : eq(clientes.cpf, campos.cpf!)
    const noCrm = await db.query.clientes.findFirst({ where: and(eq(clientes.empresaId, l.empresaId), doc, isNull(clientes.deletedAt)) })
    if (noCrm && noCrm.id !== l.clienteId) {
      if (/^C\d{4,}$/i.test(noCrm.codigo) && noCrm.codigo !== l.cardCode) throw new TRPCError({ code: 'CONFLICT', message: `Esse cliente já existe no CRM com código do SAP: ${noCrm.razaoSocial} (${noCrm.codigo}).` })
      if (noCrm.vendedorAtualId && noCrm.vendedorAtualId !== l.vendedorId) {
        const dono = (await nomesUsuarios([noCrm.vendedorAtualId])).get(noCrm.vendedorAtualId)
        throw new TRPCError({ code: 'CONFLICT', message: `Esse cliente já está no CRM na carteira de ${dono ?? 'outro vendedor'} (${noCrm.razaoSocial}).` })
      }
    }

    const vendSap = await vendedorSapDe(l.vendedorId)
    const autor = ctx.user.name
    let cardCode = l.cardCode
    try {
      if (!cardCode) {
        const existe = await procurarNoSap(d)
        if (existe) throw new TRPCError({ code: 'CONFLICT', message: `Já existe no SAP: ${existe.nome} (${existe.codigo}, ${existe.tipo}${existe.ativo ? '' : ', inativo'}). Peça ao gestor pra trazer em "Clientes do SAP".` })
        const formas = (await formasPagamentoDaFilial(ctx.filial).catch(() => [])).map((f) => f.codigo)
        cardCode = await criarClienteSap(d, vendSap, formas)
      } else {
        await corrigirClienteSap(cardCode, d, vendSap)
      }
    } catch (e) {
      if (e instanceof TRPCError) throw e
      const msg = erroSap(e)
      await db.update(cadastrosClientesSap).set({ erroSap: msg, historico: comHistorico(l, autor, 'SAP recusou o envio', msg), updatedAt: agoraSqlite() }).where(eq(cadastrosClientesSap.id, l.id))
      throw new TRPCError({ code: 'BAD_REQUEST', message: `O SAP recusou: ${msg}` })
    }
    const clienteId = await clienteNoCrm(l, d, cardCode, ctx.user.id)
    const reenvio = l.status === 'devolvido'
    await db
      .update(cadastrosClientesSap)
      .set({
        status: 'aguardando',
        dados: JSON.stringify(d),
        cardCode,
        clienteId,
        erroSap: null,
        enviadoEm: agoraSqlite(),
        historico: comHistorico(l, autor, reenvio ? 'Corrigiu e reenviou ao SAP' : 'Enviou ao SAP', `${cardCode} criado inativo — esperando aprovação do financeiro${vendSap == null ? ' · vendedor sem ligação com o SAP (o financeiro escolhe o vendedor no SAP)' : ''}`),
        updatedAt: agoraSqlite(),
      })
      .where(eq(cadastrosClientesSap.id, l.id))
    for (const uid of await aprovadores())
      if (uid !== ctx.user.id) await avisar(uid, null, reenvio ? 'Cadastro corrigido para aprovar' : 'Cadastro de cliente para aprovar', `${ctx.user.name} ${reenvio ? 'corrigiu' : 'cadastrou'} ${d.nome.toUpperCase()} (${cardCode}). Confira em Aprovação de cadastros.`)
    return { cardCode, clienteId }
  }),

  // ── Financeiro (Izabelly) ──────────────────────────────────────────────
  fila: aprovadorProcedure.input(z.object({ ver: z.enum(['aguardando', 'todos']).default('aguardando') })).query(async ({ input }) => {
    const ls = await db
      .select()
      .from(cadastrosClientesSap)
      .where(input.ver === 'aguardando' ? eq(cadastrosClientesSap.status, 'aguardando') : inArray(cadastrosClientesSap.status, ['aguardando', 'devolvido', 'aprovado']))
      .orderBy(input.ver === 'aguardando' ? cadastrosClientesSap.enviadoEm : desc(cadastrosClientesSap.updatedAt))
      .limit(300)
    const nomes = await nomesUsuarios(ls.map((l) => l.vendedorId))
    const emps = await db.select({ id: empresas.id, nome: empresas.nome }).from(empresas)
    const empNome = new Map(emps.map((e) => [e.id, e.nome]))
    return ls.map((l) => resumo(l, nomes, empNome))
  }),

  detalheAprovacao: aprovadorProcedure.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const l = await acharLinha(input.id)
    const emp = await db.query.empresas.findFirst({ where: eq(empresas.id, l.empresaId), columns: { nome: true } })
    const empSlug = await db.query.empresas.findFirst({ where: eq(empresas.id, l.empresaId), columns: { slug: true } })
    const filialPadrao = filialDaEmpresa(empSlug?.slug ?? '')
    const formas = await formasPagamentoDaFilial(filialPadrao ?? 3).catch(() => [])
    return {
      ...resumo(l, await nomesUsuarios([l.vendedorId])),
      empresa: emp?.nome ?? null,
      filialPadrao,
      dados: lerDados(l),
      historico: lerHistorico(l),
      opcoes: { ...OPCOES, ...(await listasSap()), ...(await opcoesSap()), formas },
    }
  }),

  aprovar: aprovadorProcedure
    .input(
      z.object({
        id: z.number().int(),
        ajustes: z.object({
          grupoTributario: z.string().optional(),
          indicadorIE: z.string().optional(),
          indicadorConsumidor: z.string().optional(),
          grupoCliente: z.number().int().optional(),
          prazoCodigo: z.number().int().optional(),
          listaPreco: z.number().int().optional(),
          limiteCredito: z.number().min(0).max(100_000_000).optional(),
          filiais: z.array(z.number().int()).optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const l = await acharLinha(input.id)
      if (l.status !== 'aguardando' || !l.cardCode) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esse cadastro não está esperando aprovação' })
      const d = lerDados(l)
      const a = input.ajustes
      const mudou: string[] = []
      if (a.grupoTributario && a.grupoTributario !== d.grupoTributario) mudou.push('grupo tributário')
      if (a.indicadorIE && a.indicadorIE !== d.indicadorIE) mudou.push('indicador da IE')
      if (a.indicadorConsumidor && a.indicadorConsumidor !== d.indicadorConsumidor) mudou.push('indicador de consumidor')
      if (a.grupoCliente && a.grupoCliente !== d.grupoCliente) mudou.push('grupo do cliente')
      if (a.prazoCodigo != null && a.prazoCodigo !== d.prazoCodigo) mudou.push('condição de pagamento')
      if (a.listaPreco && a.listaPreco !== d.listaPreco) mudou.push('lista de preço')
      if (a.limiteCredito != null && a.limiteCredito !== (d.limiteCredito ?? 0)) mudou.push('limite de crédito')
      if (a.filiais && [...a.filiais].sort().join() !== [...(d.filiais ?? [])].sort().join()) mudou.push('filiais')
      try {
        await aprovarClienteSap(l.cardCode, a)
      } catch (e) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `O SAP recusou: ${erroSap(e)}` })
      }
      const novos: DadosCadastro = {
        ...d,
        ...(a.grupoTributario ? { grupoTributario: a.grupoTributario } : {}),
        ...(a.indicadorIE ? { indicadorIE: a.indicadorIE } : {}),
        ...(a.indicadorConsumidor ? { indicadorConsumidor: a.indicadorConsumidor } : {}),
        ...(a.grupoCliente ? { grupoCliente: a.grupoCliente } : {}),
        ...(a.prazoCodigo != null ? { prazoCodigo: a.prazoCodigo } : {}),
        ...(a.listaPreco ? { listaPreco: a.listaPreco } : {}),
        ...(a.limiteCredito != null ? { limiteCredito: a.limiteCredito } : {}),
        ...(a.filiais?.length ? { filiais: a.filiais } : {}),
      }
      await db
        .update(cadastrosClientesSap)
        .set({
          status: 'aprovado',
          dados: JSON.stringify(novos),
          aprovadoEm: agoraSqlite(),
          aprovadoPorId: ctx.user.id,
          motivoDevolucao: null,
          historico: comHistorico(l, ctx.user.name, 'Aprovou — cliente ativo no SAP', mudou.length ? `Ajustou: ${mudou.join(', ')}` : undefined),
          updatedAt: agoraSqlite(),
        })
        .where(eq(cadastrosClientesSap.id, l.id))
      if (l.clienteId) await db.update(clientes).set({ statusFiscal: statusFiscalDe(novos), updatedAt: agoraSqlite() }).where(eq(clientes.id, l.clienteId))
      if (l.vendedorId) await avisar(l.vendedorId, l.clienteId, 'Cadastro aprovado ✅', `${d.nome.toUpperCase()} (${l.cardCode}) foi aprovado por ${ctx.user.name} — já pode vender.`)
      return { ok: true }
    }),

  devolver: aprovadorProcedure.input(z.object({ id: z.number().int(), motivo: z.string().trim().min(3, 'Escreva o que precisa corrigir') })).mutation(async ({ ctx, input }) => {
    const l = await acharLinha(input.id)
    if (l.status !== 'aguardando') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esse cadastro não está esperando aprovação' })
    await db
      .update(cadastrosClientesSap)
      .set({ status: 'devolvido', motivoDevolucao: input.motivo, historico: comHistorico(l, ctx.user.name, 'Devolveu ao vendedor', input.motivo), updatedAt: agoraSqlite() })
      .where(eq(cadastrosClientesSap.id, l.id))
    const d = lerDados(l)
    if (l.vendedorId) await avisar(l.vendedorId, l.clienteId, 'Cadastro devolvido pelo financeiro', `${d.nome.toUpperCase()} (${l.cardCode}): ${input.motivo}. Corrija em Cadastro de clientes e reenvie.`)
    return { ok: true }
  }),

  // Quantos esperando (selo no menu do financeiro).
  pendentes: aprovadorProcedure.query(async () => {
    const ls = await db.select({ id: cadastrosClientesSap.id }).from(cadastrosClientesSap).where(eq(cadastrosClientesSap.status, 'aguardando'))
    return ls.length
  }),
})

// Cadastro do cliente ainda não aprovado? (trava enviar cotação/gerar pedido)
export async function cadastroPendente(clienteId: number): Promise<{ status: string; cardCode: string | null } | null> {
  const l = await db.query.cadastrosClientesSap.findFirst({
    where: and(eq(cadastrosClientesSap.clienteId, clienteId), or(eq(cadastrosClientesSap.status, 'aguardando'), eq(cadastrosClientesSap.status, 'devolvido'))),
    columns: { status: true, cardCode: true },
  })
  return l ?? null
}

// Rodada (10 min): a Izabelly ativou direto no SAP → marca aprovado e avisa.
export async function verificarCadastrosAprovadosNoSap(): Promise<number> {
  if (!sapConfigurado()) return 0
  const ls = await db.select().from(cadastrosClientesSap).where(eq(cadastrosClientesSap.status, 'aguardando'))
  const comCodigo = ls.filter((l) => l.cardCode)
  if (!comCodigo.length) return 0
  const ativos = await comSessaoSap((sap) => situacaoNoSap(sap, comCodigo.map((l) => l.cardCode!)))
  let n = 0
  for (const l of comCodigo) {
    if (!ativos.get(l.cardCode!)) continue
    await db
      .update(cadastrosClientesSap)
      .set({ status: 'aprovado', aprovadoEm: agoraSqlite(), historico: comHistorico(l, 'SAP', 'Aprovado direto no SAP (cliente ficou ativo)'), updatedAt: agoraSqlite() })
      .where(eq(cadastrosClientesSap.id, l.id))
    const d = lerDados(l)
    if (l.vendedorId) await avisar(l.vendedorId, l.clienteId, 'Cadastro aprovado ✅', `${d.nome.toUpperCase()} (${l.cardCode}) foi aprovado no SAP — já pode vender.`)
    n++
  }
  return n
}
