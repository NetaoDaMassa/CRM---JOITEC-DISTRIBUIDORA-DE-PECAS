// Cotações no CRM — troca do Portal One (pedido do João, 2026-11-10).
// Catálogo/preço/prazo vêm das cópias do SAP (lib/sapCatalogo.ts), estoque da
// foto de Revenda (lib/sapEstoque.ts). Enviar ao SAP e gerar o pedido são as
// etapas 2 e 4 (precisam de usuário próprio + base de teste).
//
// Jornada (decisões do João, 2026-11-10):
//   rascunho → concluir → (maior desconto acima do "desconto livre" da
//   empresa, padrão 5%) aguardando_aprovacao → gerente da empresa aprova ou
//   reprova (volta pra rascunho com o motivo) → aprovada → enviada ao cliente
//   (vale até o último dia do mês) → ganha (cliente aprovou; pode ser só parte
//   dos itens) ou perdida (preço, prazo, concorrente, sem resposta, outro).
//   Reabrir (negociação) volta pra rascunho e, se precisar, pede aprovação de novo.
//
// Acesso: permissão 'cotacoes' (superAdmin sempre). Vendedor vê só as próprias
// cotações e os clientes da carteira; admin e o gerente de cotações da
// empresa veem a empresa toda.
import { z } from 'zod'
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure, temFeature } from './_base.js'
import { db } from '../db/client.js'
import {
  clientes,
  cotacoesCrm,
  cotacoesCrmHistorico,
  cotacoesCrmItens,
  empresas,
  notifications,
  sapCatalogoItens,
  sapCatalogoPrecos,
  sapClientesComercial,
  sapEstoqueItens,
  sapListasPreco,
  sapPrazosPagamento,
  users,
} from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'
import { getConfigNumero, setConfig } from '../lib/configuracoes.js'
import { filialDaEmpresa } from '../lib/sapEstoque.js'
import { levarParaNegociacao } from '../lib/sapCotacoesAuto.js'
import { fotosPorItem } from '../lib/fotosProdutos.js'
import { enviarCotacaoSap, faltasDeEstoqueSap, fecharCotacaoSap, gerarPedidoSap, type CotacaoParaSap } from '../lib/sapCotacoesEscrita.js'
import { atualizarDadosClienteSap, catalogoAtualizadoEm, dadosClienteSap, emitenteDaFilial, sincronizarCatalogoSap } from '../lib/sapCatalogo.js'

const FEATURE = 'cotacoes'
// Lista 01.BASE — usada quando o cliente não tem lista no SAP.
const LISTA_BASE = 1
const DESCONTO_LIVRE_PADRAO = 5
export const MOTIVOS_PERDA = ['Preço', 'Prazo', 'Concorrente', 'Sem resposta', 'Outro'] as const

const chaveGerente = (empresaId: number) => `cotacoes_gerente_${empresaId}`
const chaveDescontoLivre = (empresaId: number) => `cotacoes_desconto_livre_${empresaId}`

const cotacoesProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user.superAdmin && !(await temFeature(ctx.user.id, FEATURE))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Cotações não liberadas pra você' })
  }
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { slug: true } })
  const filial = empresa ? filialDaEmpresa(empresa.slug) : null
  // Só Joitec (e Automação, que vende pela filial dela) e Odin Tubos — a Odin
  // Compressores não vai cotar pelo CRM (João, 2026-11-10).
  if (!empresa || !filial || ![3, 4].includes(filial)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cotações só para Joitec, Odin Automação e Odin Tubos' })
  const gerenteId = await getConfigNumero(chaveGerente(ctx.empresaId), 0)
  const descontoLivre = await getConfigNumero(chaveDescontoLivre(ctx.empresaId), DESCONTO_LIVRE_PADRAO)
  const souGerente = gerenteId > 0 && gerenteId === ctx.user.id
  const podeConfigurar = ctx.user.superAdmin || ctx.user.role === 'admin'
  const veTudo = podeConfigurar || souGerente
  return next({ ctx: { ...ctx, filial, empresaSlug: empresa.slug, gerenteId, descontoLivre, souGerente, podeAprovar: souGerente || ctx.user.superAdmin, podeConfigurar, veTudo } })
})

type Ctx = { empresaId: number; user: { id: number; name: string }; veTudo: boolean }

const arred = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas

function ultimoDiaDoMes(dia: string): string {
  const [a, m] = dia.split('-').map(Number)
  return `${a}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`
}

async function acharCotacao(ctx: Ctx, id: number) {
  const c = await db.query.cotacoesCrm.findFirst({
    where: and(eq(cotacoesCrm.id, id), eq(cotacoesCrm.empresaId, ctx.empresaId), isNull(cotacoesCrm.deletedAt)),
  })
  if (!c || (!ctx.veTudo && c.vendedorId !== ctx.user.id)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cotação não encontrada' })
  return c
}

// Só o vendedor dono (ou quem vê tudo) mexe na cotação.
function exigirDono(ctx: Ctx, c: { vendedorId: number }) {
  if (!ctx.veTudo && c.vendedorId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Essa cotação não é sua' })
}

function exigirStatus(c: { status: string }, permitidos: string[], acao: string) {
  if (!permitidos.includes(c.status)) throw new TRPCError({ code: 'BAD_REQUEST', message: `Não dá pra ${acao} uma cotação nessa situação` })
}

async function registrar(cotacaoId: number, userId: number, acao: string, detalhe?: string | null) {
  await db.insert(cotacoesCrmHistorico).values({ cotacaoId, userId, acao, detalhe: detalhe ?? null })
}

async function avisar(userId: number, clienteId: number, titulo: string, mensagem: string) {
  await db.insert(notifications).values({ vendedorId: userId, clienteId, type: 'info', title: titulo, message: mensagem })
}

async function nomeCliente(clienteId: number) {
  const c = await db.query.clientes.findFirst({ where: eq(clientes.id, clienteId), columns: { razaoSocial: true } })
  return c?.razaoSocial ?? 'cliente'
}

// Monta o que vai pro SAP: cliente (código), itens na ordem (= LineNum).
async function paraSap(c: typeof cotacoesCrm.$inferSelect, filial: number): Promise<{ dados: CotacaoParaSap; itens: (typeof cotacoesCrmItens.$inferSelect)[] }> {
  const [cliente, itens, vendedor] = await Promise.all([
    db.query.clientes.findFirst({ where: eq(clientes.id, c.clienteId), columns: { codigo: true } }),
    db.select().from(cotacoesCrmItens).where(eq(cotacoesCrmItens.cotacaoId, c.id)).orderBy(cotacoesCrmItens.id),
    db.query.users.findFirst({ where: eq(users.id, c.vendedorId), columns: { name: true } }),
  ])
  if (!cliente?.codigo) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cliente sem código do SAP' })
  return {
    itens,
    dados: {
      id: c.id,
      cardCode: cliente.codigo,
      filial,
      prazoCodigo: c.prazoCodigo,
      dataEntrega: c.dataEntrega,
      numeroReferencia: c.numeroReferencia,
      observacao: c.observacao,
      transportadora: c.transportadora,
      contato: c.contato,
      tipoEnvio: c.tipoEnvio,
      valorFrete: c.valorFrete,
      vendedorNome: vendedor?.name ?? '',
      itens: itens.map((i) => ({ itemCodigo: i.itemCodigo, quantidade: i.quantidade, precoTabela: i.precoTabela, descontoPct: i.descontoPct, precoUnitario: i.precoUnitario, precoManual: i.precoManual })),
    },
  }
}

// Confere no SAP, na hora, o saldo disponível dos itens (só os aceitos pelo
// cliente, no pedido). Falta → bloqueia com a lista.
async function exigirEstoque(cotacaoId: number, filial: number, soAceitos = false) {
  const itens = await db.select().from(cotacoesCrmItens).where(eq(cotacoesCrmItens.cotacaoId, cotacaoId))
  let faltas: string[]
  try {
    faltas = await faltasDeEstoqueSap(filial, itens.filter((i) => !soAceitos || i.aceito))
  } catch (e) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Não consegui conferir o estoque no SAP: ${(e as Error).message}` })
  }
  if (faltas.length) throw new TRPCError({ code: 'BAD_REQUEST', message: `Sem estoque no SAP agora — ajuste a cotação: ${faltas.join('; ')}` })
}

const sapErro = (e: unknown) => new TRPCError({ code: 'BAD_REQUEST', message: `SAP: ${(e as Error).message}` })

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const cotacoesCrmRouter = router({
  // Listas de preço, prazos, regras da empresa (gerente e desconto livre) e
  // quando o catálogo foi copiado do SAP.
  contexto: cotacoesProcedure.query(async ({ ctx }) => {
    const [listas, prazos, atualizadoEm, gerente, usuarios, emitente] = await Promise.all([
      db.select().from(sapListasPreco).orderBy(sapListasPreco.numero),
      db.select().from(sapPrazosPagamento).orderBy(sapPrazosPagamento.nome),
      catalogoAtualizadoEm(),
      ctx.gerenteId ? db.query.users.findFirst({ where: eq(users.id, ctx.gerenteId), columns: { id: true, name: true } }) : null,
      ctx.podeConfigurar
        ? db
            .select({ id: users.id, nome: users.name })
            .from(users)
            .where(and(eq(users.empresaId, ctx.empresaId), eq(users.isActive, true)))
            .orderBy(asc(users.name))
        : [],
      emitenteDaFilial(ctx.filial),
    ])
    return {
      listas,
      prazos,
      atualizadoEm,
      listaBase: LISTA_BASE,
      veTudo: ctx.veTudo,
      gerente: gerente ?? null,
      descontoLivre: ctx.descontoLivre,
      podeAprovar: ctx.podeAprovar,
      podeConfigurar: ctx.podeConfigurar,
      usuarios,
      motivosPerda: MOTIVOS_PERDA,
      hoje: hojeBrString(),
      empresaSlug: ctx.empresaSlug,
      emitente,
    }
  }),

  // Gerente que aprova desconto e o desconto que o vendedor dá sozinho.
  configurar: cotacoesProcedure
    .input(z.object({ gerenteId: z.number().int().nullable(), descontoLivre: z.number().min(0).max(100) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.podeConfigurar) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só admin configura as cotações' })
      if (input.gerenteId) {
        const u = await db.query.users.findFirst({ where: and(eq(users.id, input.gerenteId), eq(users.empresaId, ctx.empresaId)), columns: { id: true } })
        if (!u) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Gerente precisa ser da empresa' })
      }
      await setConfig(chaveGerente(ctx.empresaId), input.gerenteId ?? 0)
      await setConfig(chaveDescontoLivre(ctx.empresaId), input.descontoLivre)
      return { ok: true }
    }),

  // Catálogo inteiro (~2.600 itens) com o preço da lista pedida e o estoque
  // de Revenda da filial — a tela filtra na hora, sem ir ao servidor.
  catalogo: cotacoesProcedure.input(z.object({ lista: z.number().int() })).query(async ({ ctx, input }) => {
    const [itens, precos, base, estoque] = await Promise.all([
      db.select().from(sapCatalogoItens).where(eq(sapCatalogoItens.ativo, true)),
      db.select({ item: sapCatalogoPrecos.itemCodigo, preco: sapCatalogoPrecos.preco }).from(sapCatalogoPrecos).where(eq(sapCatalogoPrecos.lista, input.lista)),
      db.select({ item: sapCatalogoPrecos.itemCodigo, preco: sapCatalogoPrecos.preco }).from(sapCatalogoPrecos).where(eq(sapCatalogoPrecos.lista, LISTA_BASE)),
      db.select({ item: sapEstoqueItens.itemCodigo, qtd: sql<number>`coalesce(${sapEstoqueItens.disponivel}, ${sapEstoqueItens.quantidade})` }).from(sapEstoqueItens).where(eq(sapEstoqueItens.filial, ctx.filial)),
    ])
    const fotoDe = await fotosPorItem()
    const precoDe = new Map(precos.map((p) => [p.item, p.preco]))
    const precoBase = new Map(base.map((p) => [p.item, p.preco]))
    const estoqueDe = new Map(estoque.map((e) => [e.item, e.qtd]))
    return itens
      .map((i) => ({
        codigo: i.itemCodigo,
        nome: i.nome,
        codigoAntigo: i.codigoAntigo,
        grupo: i.grupo,
        unidade: i.unidade,
        ncm: i.ncm,
        pesoKg: i.pesoKg,
        foto: fotoDe.get(i.itemCodigo) ?? null,
        preco: precoDe.get(i.itemCodigo) ?? precoBase.get(i.itemCodigo) ?? null,
        estoque: estoqueDe.get(i.itemCodigo) ?? 0,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }),

  // Clientes pra cotar: vendedor só a própria carteira, admin/gerente a
  // empresa toda. Junta a lista de preço e o prazo padrão do cliente no SAP.
  clientes: cotacoesProcedure.input(z.object({ busca: z.string().trim().min(2) })).query(async ({ ctx, input }) => {
    const termo = `%${input.busca}%`
    return db
      .select({
        id: clientes.id,
        codigo: clientes.codigo,
        nome: clientes.razaoSocial,
        cidade: clientes.cidade,
        estado: clientes.estado,
        nomeContato: clientes.nomeContato,
        codigoAntigo: clientes.codigoAntigo,
        nomeFantasia: sapClientesComercial.nomeFantasia,
        listaPreco: sapClientesComercial.listaPreco,
        prazoCodigo: sapClientesComercial.prazoCodigo,
        bloqueado: sapClientesComercial.bloqueado,
      })
      .from(clientes)
      .leftJoin(sapClientesComercial, eq(sapClientesComercial.cardCode, clientes.codigo))
      .where(
        and(
          eq(clientes.empresaId, ctx.empresaId),
          isNull(clientes.deletedAt),
          ctx.veTudo ? undefined : eq(clientes.vendedorAtualId, ctx.user.id),
          or(
            like(clientes.razaoSocial, termo),
            like(clientes.codigo, termo),
            like(clientes.codigoAntigo, termo),
            like(sapClientesComercial.nomeFantasia, termo),
            like(clientes.cnpj, termo),
            like(clientes.cpf, termo)
          )
        )
      )
      // Código exato (novo ou antigo) primeiro, depois quem começa com o termo.
      .orderBy(
        sql`case when ${clientes.codigo} = ${input.busca} or ${clientes.codigoAntigo} = ${input.busca} then 0 when ${clientes.razaoSocial} like ${input.busca + '%'} then 1 else 2 end`,
        asc(clientes.razaoSocial)
      )
      .limit(25)
  }),

  // Etiqueta no card do Kanban: cotações do CRM do cliente no mês do card.
  // Aberto a quem vê o Kanban (não exige a permissão de Cotações).
  doCards: protectedProcedure.input(z.object({ meses: z.array(z.string().regex(/^\d{4}-\d{2}$/)).max(12) })).query(async ({ ctx, input }) => {
    if (!input.meses.length) return []
    const linhas = await db
      .select({ id: cotacoesCrm.id, clienteId: cotacoesCrm.clienteId, status: cotacoesCrm.status, total: cotacoesCrm.total, createdAt: cotacoesCrm.createdAt })
      .from(cotacoesCrm)
      .where(
        and(
          eq(cotacoesCrm.empresaId, ctx.empresaId),
          isNull(cotacoesCrm.deletedAt),
          inArray(sql<string>`substr(${cotacoesCrm.createdAt}, 1, 7)`, input.meses)
        )
      )
      .orderBy(desc(cotacoesCrm.id))
    const porCard = new Map<string, { clienteId: number; mes: string; qtd: number; valor: number; ultima: { id: number; status: string; total: number }; cotacoes: { id: number; status: string; total: number }[] }>()
    for (const l of linhas) {
      const mes = l.createdAt.slice(0, 7)
      const chave = `${l.clienteId}:${mes}`
      const atual = porCard.get(chave) ?? { clienteId: l.clienteId, mes, qtd: 0, valor: 0, ultima: { id: l.id, status: l.status, total: l.total }, cotacoes: [] }
      atual.qtd++
      atual.valor += l.total
      atual.cotacoes.push({ id: l.id, status: l.status, total: l.total })
      porCard.set(chave, atual)
    }
    return [...porCard.values()]
  }),

  listar: cotacoesProcedure.query(async ({ ctx }) => {
    const hoje = hojeBrString()
    const linhas = await db
      .select({
        id: cotacoesCrm.id,
        status: cotacoesCrm.status,
        total: cotacoesCrm.total,
        maiorDescontoPct: cotacoesCrm.maiorDescontoPct,
        validaAte: cotacoesCrm.validaAte,
        createdAt: cotacoesCrm.createdAt,
        encerradaEm: cotacoesCrm.encerradaEm,
        enviadaClienteEm: cotacoesCrm.enviadaClienteEm,
        updatedAt: cotacoesCrm.updatedAt,
        sapDocNum: cotacoesCrm.sapDocNum,
        sapPedidoNum: cotacoesCrm.sapPedidoNum,
        vendedorId: cotacoesCrm.vendedorId,
        clienteNome: clientes.razaoSocial,
        clienteCodigo: clientes.codigo,
        vendedorNome: users.name,
        itens: sql<number>`(select count(*) from ${cotacoesCrmItens} where ${cotacoesCrmItens.cotacaoId} = ${cotacoesCrm.id})`,
      })
      .from(cotacoesCrm)
      .innerJoin(clientes, eq(clientes.id, cotacoesCrm.clienteId))
      .innerJoin(users, eq(users.id, cotacoesCrm.vendedorId))
      .where(and(eq(cotacoesCrm.empresaId, ctx.empresaId), isNull(cotacoesCrm.deletedAt), ctx.veTudo ? undefined : eq(cotacoesCrm.vendedorId, ctx.user.id)))
      .orderBy(desc(cotacoesCrm.updatedAt))
      .limit(500)
    return linhas.map((l) => ({ ...l, vencida: l.status === 'enviada' && !!l.validaAte && l.validaAte < hoje }))
  }),

  obter: cotacoesProcedure.input(z.object({ id: z.number().int() })).query(async ({ ctx, input }) => {
    const c = await acharCotacao(ctx, input.id)
    const [cliente, itens, historico, vendedor, aprovador] = await Promise.all([
      db.query.clientes.findFirst({
        where: eq(clientes.id, c.clienteId),
        columns: {
          id: true, codigo: true, razaoSocial: true, cidade: true, estado: true, endereco: true, numero: true, complemento: true, bairro: true, cep: true,
          cnpj: true, cpf: true, inscricaoEstadual: true, telefoneWhatsapp: true, email: true, nomeContato: true,
        },
      }),
      db.select().from(cotacoesCrmItens).where(eq(cotacoesCrmItens.cotacaoId, c.id)).orderBy(cotacoesCrmItens.id),
      db
        .select({ id: cotacoesCrmHistorico.id, acao: cotacoesCrmHistorico.acao, detalhe: cotacoesCrmHistorico.detalhe, createdAt: cotacoesCrmHistorico.createdAt, quem: users.name })
        .from(cotacoesCrmHistorico)
        .leftJoin(users, eq(users.id, cotacoesCrmHistorico.userId))
        .where(eq(cotacoesCrmHistorico.cotacaoId, c.id))
        .orderBy(desc(cotacoesCrmHistorico.id)),
      db.query.users.findFirst({ where: eq(users.id, c.vendedorId), columns: { name: true } }),
      c.aprovadoPorId ? db.query.users.findFirst({ where: eq(users.id, c.aprovadoPorId), columns: { name: true } }) : null,
    ])
    const vencida = c.status === 'enviada' && !!c.validaAte && c.validaAte < hojeBrString()
    // Endereço/CNPJ/IE do SAP já guardados. Nunca espera o SAP aqui (a tela
    // tem que abrir na hora); se faltar, busca em segundo plano.
    const clienteSap = cliente ? await dadosClienteSap(cliente.codigo) : null
    if (cliente && !clienteSap) void atualizarDadosClienteSap(cliente.codigo).catch(() => null)
    return { ...c, cliente, clienteSap, itens, historico, vendedorNome: vendedor?.name ?? '', aprovadorNome: aprovador?.name ?? null, vencida, souDono: c.vendedorId === ctx.user.id }
  }),

  // Cria ou atualiza o rascunho. O preço de tabela é sempre o do catálogo
  // (lista escolhida, ou a 01.BASE se o item não tiver preço nela); o
  // vendedor só mexe em quantidade e desconto.
  salvar: cotacoesProcedure
    .input(
      z.object({
        id: z.number().int().optional(),
        clienteId: z.number().int(),
        listaPreco: z.number().int(),
        prazoCodigo: z.number().int().nullable(),
        observacao: z.string().max(2000).nullable(),
        numeroReferencia: z.string().trim().max(100).nullable().optional(),
        dataEntrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        contato: z.string().trim().max(120).nullable().optional(),
        transportadora: z.string().trim().max(160).nullable().optional(),
        tipoEnvio: z.enum(['CIF', 'FOB']).nullable().optional(),
        valorFrete: z.number().min(0).max(1_000_000).optional(),
        itens: z
          .array(
            z.object({
              itemCodigo: z.string().min(1),
              quantidade: z.number().positive(),
              descontoPct: z.number().min(0).max(100),
              // Preço digitado pelo vendedor (substitui o desconto).
              precoUnitario: z.number().positive().max(10_000_000).optional(),
            })
          )
          .max(300),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        const atual = await acharCotacao(ctx, input.id)
        exigirDono(ctx, atual)
        exigirStatus(atual, ['rascunho'], 'editar')
      }
      const cliente = await db.query.clientes.findFirst({
        where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId), isNull(clientes.deletedAt)),
        columns: { id: true, vendedorAtualId: true },
      })
      if (!cliente || (!ctx.veTudo && cliente.vendedorAtualId !== ctx.user.id)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cliente fora da sua carteira' })

      const codigos = [...new Set(input.itens.map((i) => i.itemCodigo))]
      const [catalogo, precos] = codigos.length
        ? await Promise.all([
            db.select({ codigo: sapCatalogoItens.itemCodigo, nome: sapCatalogoItens.nome }).from(sapCatalogoItens).where(inArray(sapCatalogoItens.itemCodigo, codigos)),
            db
              .select()
              .from(sapCatalogoPrecos)
              .where(and(inArray(sapCatalogoPrecos.itemCodigo, codigos), inArray(sapCatalogoPrecos.lista, [input.listaPreco, LISTA_BASE]))),
          ])
        : [[], []]
      const nomeDe = new Map(catalogo.map((c) => [c.codigo, c.nome]))
      const preco = (item: string) =>
        precos.find((p) => p.itemCodigo === item && p.lista === input.listaPreco)?.preco ?? precos.find((p) => p.itemCodigo === item && p.lista === LISTA_BASE)?.preco
      const linhas = input.itens.map((i) => {
        const nome = nomeDe.get(i.itemCodigo)
        const tabela = preco(i.itemCodigo)
        if (!nome) throw new TRPCError({ code: 'BAD_REQUEST', message: `Item ${i.itemCodigo} não está mais no catálogo do SAP` })
        if (tabela == null) throw new TRPCError({ code: 'BAD_REQUEST', message: `Item ${i.itemCodigo} está sem preço no SAP` })
        const manual = i.precoUnitario != null
        const unitario = manual ? arred(i.precoUnitario!, 4) : arred(tabela * (1 - i.descontoPct / 100), 4)
        return {
          itemCodigo: i.itemCodigo,
          nome,
          quantidade: i.quantidade,
          precoTabela: tabela,
          descontoPct: manual ? arred((1 - unitario / tabela) * 100, 2) : arred(i.descontoPct, 2),
          precoUnitario: unitario,
          precoManual: manual,
        }
      })
      // Item sem estoque é proibido (João, 2026-11-10). Aqui pela foto de
      // estoque (de hora em hora); concluir/enviar conferem no SAP ao vivo.
      const estoque = codigos.length
        ? await db
            .select({ item: sapEstoqueItens.itemCodigo, qtd: sql<number>`coalesce(${sapEstoqueItens.disponivel}, ${sapEstoqueItens.quantidade})` })
            .from(sapEstoqueItens)
            .where(and(eq(sapEstoqueItens.filial, ctx.filial), inArray(sapEstoqueItens.itemCodigo, codigos)))
        : []
      const dispDe = new Map(estoque.map((e) => [e.item, e.qtd]))
      const faltas = linhas.filter((l) => (dispDe.get(l.itemCodigo) ?? 0) < l.quantidade)
      if (faltas.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Item sem estoque não pode entrar na cotação: ${faltas.map((l) => `${l.nome} (${(dispDe.get(l.itemCodigo) ?? 0) > 0 ? `só ${dispDe.get(l.itemCodigo)} disponível` : 'sem estoque'})`).join('; ')}`,
        })
      }
      const total = arred(linhas.reduce((s, l) => s + l.precoUnitario * l.quantidade, 0))
      const maiorDescontoPct = linhas.reduce((m, l) => Math.max(m, l.descontoPct), 0)
      const agora = agoraSqlite()

      const id = await db.transaction(async (tx) => {
        let id = input.id
        const dados = {
          clienteId: input.clienteId,
          listaPreco: input.listaPreco,
          prazoCodigo: input.prazoCodigo,
          observacao: input.observacao?.trim() || null,
          numeroReferencia: input.numeroReferencia || null,
          dataEntrega: input.dataEntrega ?? null,
          contato: input.contato || null,
          transportadora: input.transportadora || null,
          tipoEnvio: input.tipoEnvio ?? null,
          valorFrete: arred(input.valorFrete ?? 0),
          total,
          maiorDescontoPct,
          updatedAt: agora,
        }
        if (id) {
          await tx.update(cotacoesCrm).set(dados).where(eq(cotacoesCrm.id, id))
          await tx.delete(cotacoesCrmItens).where(eq(cotacoesCrmItens.cotacaoId, id))
        } else {
          const [nova] = await tx
            .insert(cotacoesCrm)
            .values({ ...dados, empresaId: ctx.empresaId, vendedorId: ctx.user.id })
            .returning({ id: cotacoesCrm.id })
          id = nova.id
        }
        if (linhas.length) await tx.insert(cotacoesCrmItens).values(linhas.map((l) => ({ ...l, cotacaoId: id! })))
        return id!
      })
      if (!input.id) {
        await registrar(id, ctx.user.id, 'Criou a cotação', `${linhas.length} item(ns) · ${brl(total)}`)
        // Mesma regra da cotação do SAP: card do mês vai pra Negociação (se
        // estava antes) e ganha o valor orçado; sem card, cria um pro dono.
        await levarParaNegociacao(input.clienteId, total, `nº ${id}`, ctx.user.id, 'do CRM').catch((e) => console.error('[cotacoes] levar card pra Negociação:', e))
      }
      // Atualiza endereço/CNPJ/IE do cliente no SAP pro documento (sem esperar).
      const codigo = (await db.query.clientes.findFirst({ where: eq(clientes.id, input.clienteId), columns: { codigo: true } }))?.codigo
      if (codigo) void atualizarDadosClienteSap(codigo).catch((e) => console.error('[cotacoes] dados do cliente no SAP:', e instanceof Error ? e.message : e))
      return { id, total }
    }),

  // Rascunho pronto: vai pro gerente se algum desconto passar do livre;
  // senão já fica aprovada.
  concluir: cotacoesProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    const c = await acharCotacao(ctx, input.id)
    exigirDono(ctx, c)
    exigirStatus(c, ['rascunho'], 'concluir')
    const n = await db.select({ n: sql<number>`count(*)` }).from(cotacoesCrmItens).where(eq(cotacoesCrmItens.cotacaoId, c.id))
    if (!n[0]?.n) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Adicione pelo menos um item' })
    if (c.prazoCodigo == null) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escolha o prazo de pagamento' })
    await exigirEstoque(c.id, ctx.filial)
    const agora = agoraSqlite()
    if (c.maiorDescontoPct > ctx.descontoLivre) {
      if (!ctx.gerenteId) throw new TRPCError({ code: 'BAD_REQUEST', message: `Desconto acima de ${ctx.descontoLivre}% precisa de aprovação, mas a empresa ainda não tem gerente de cotações. Peça a um admin para configurar.` })
      await db.update(cotacoesCrm).set({ status: 'aguardando_aprovacao', reprovacaoMotivo: null, updatedAt: agora }).where(eq(cotacoesCrm.id, c.id))
      await registrar(c.id, ctx.user.id, 'Pediu aprovação do desconto', `Maior desconto ${c.maiorDescontoPct}% (livre até ${ctx.descontoLivre}%)`)
      if (ctx.gerenteId !== ctx.user.id) {
        await avisar(
          ctx.gerenteId,
          c.clienteId,
          'Cotação esperando sua aprovação',
          `${ctx.user.name} pediu aprovação de ${c.maiorDescontoPct}% de desconto na cotação nº ${c.id} (${await nomeCliente(c.clienteId)}, ${brl(c.total)}). Abra em Cotações.`
        )
      }
      return { status: 'aguardando_aprovacao' as const }
    }
    await db.update(cotacoesCrm).set({ status: 'aprovada', aprovadoPorId: null, aprovadoEm: agora, reprovacaoMotivo: null, updatedAt: agora }).where(eq(cotacoesCrm.id, c.id))
    await registrar(c.id, ctx.user.id, 'Concluiu a cotação', c.maiorDescontoPct > 0 ? `Desconto ${c.maiorDescontoPct}% dentro do livre (${ctx.descontoLivre}%)` : 'Sem desconto')
    return { status: 'aprovada' as const }
  }),

  aprovar: cotacoesProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    if (!ctx.podeAprovar) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só o gerente de cotações da empresa aprova' })
    const c = await acharCotacao(ctx, input.id)
    exigirStatus(c, ['aguardando_aprovacao'], 'aprovar')
    const agora = agoraSqlite()
    await db.update(cotacoesCrm).set({ status: 'aprovada', aprovadoPorId: ctx.user.id, aprovadoEm: agora, updatedAt: agora }).where(eq(cotacoesCrm.id, c.id))
    await registrar(c.id, ctx.user.id, 'Aprovou o desconto', `${c.maiorDescontoPct}%`)
    if (c.vendedorId !== ctx.user.id) {
      await avisar(c.vendedorId, c.clienteId, 'Desconto aprovado', `${ctx.user.name} aprovou a cotação nº ${c.id} (${await nomeCliente(c.clienteId)}). Já pode enviar ao cliente.`)
    }
    return { ok: true }
  }),

  reprovar: cotacoesProcedure.input(z.object({ id: z.number().int(), motivo: z.string().trim().min(3).max(500) })).mutation(async ({ ctx, input }) => {
    if (!ctx.podeAprovar) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só o gerente de cotações da empresa reprova' })
    const c = await acharCotacao(ctx, input.id)
    exigirStatus(c, ['aguardando_aprovacao'], 'reprovar')
    await db.update(cotacoesCrm).set({ status: 'rascunho', reprovacaoMotivo: input.motivo, updatedAt: agoraSqlite() }).where(eq(cotacoesCrm.id, c.id))
    await registrar(c.id, ctx.user.id, 'Reprovou o desconto', input.motivo)
    if (c.vendedorId !== ctx.user.id) {
      await avisar(c.vendedorId, c.clienteId, 'Desconto reprovado', `${ctx.user.name} reprovou a cotação nº ${c.id} (${await nomeCliente(c.clienteId)}): ${input.motivo}`)
    }
    return { ok: true }
  }),

  // Mandou pro cliente: vale até o último dia do mês. Reenviar renova.
  marcarEnviada: cotacoesProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    const c = await acharCotacao(ctx, input.id)
    exigirDono(ctx, c)
    exigirStatus(c, ['aprovada', 'enviada'], 'marcar como enviada')
    const hoje = hojeBrString()
    const validaAte = ultimoDiaDoMes(hoje)
    await db.update(cotacoesCrm).set({ status: 'enviada', enviadaClienteEm: agoraSqlite(), validaAte, updatedAt: agoraSqlite() }).where(eq(cotacoesCrm.id, c.id))
    await registrar(c.id, ctx.user.id, c.status === 'enviada' ? 'Reenviou ao cliente' : 'Enviou ao cliente', `Válida até ${validaAte.split('-').reverse().join('/')}`)
    return { validaAte }
  }),

  // Negociação: volta pra rascunho pra mudar itens/preço (e, se o desconto
  // passar do livre, pede aprovação de novo).
  reabrir: cotacoesProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    const c = await acharCotacao(ctx, input.id)
    exigirDono(ctx, c)
    exigirStatus(c, ['aguardando_aprovacao', 'aprovada', 'enviada'], 'reabrir')
    // Já estava no SAP: fecha lá (ao reenviar, nasce uma cotação nova no SAP).
    if (c.sapDocEntry) await fecharCotacaoSap(c.sapDocEntry).catch((e) => { throw sapErro(e) })
    await db.update(cotacoesCrm).set({ status: 'rascunho', aprovadoPorId: null, aprovadoEm: null, sapDocEntry: null, sapDocNum: null, updatedAt: agoraSqlite() }).where(eq(cotacoesCrm.id, c.id))
    await registrar(c.id, ctx.user.id, 'Reabriu para negociar', c.sapDocNum ? `Cotação SAP nº ${c.sapDocNum} fechada no SAP` : null)
    return { ok: true }
  }),

  // Cliente aprovou — pode ser só parte dos itens (o pedido sai só com eles).
  ganhar: cotacoesProcedure.input(z.object({ id: z.number().int(), itensAceitos: z.array(z.number().int()).min(1) })).mutation(async ({ ctx, input }) => {
    const c = await acharCotacao(ctx, input.id)
    exigirDono(ctx, c)
    exigirStatus(c, ['aprovada', 'enviada'], 'marcar como aprovada pelo cliente')
    const itens = await db.select().from(cotacoesCrmItens).where(eq(cotacoesCrmItens.cotacaoId, c.id))
    const aceitos = new Set(input.itensAceitos.filter((i) => itens.some((x) => x.id === i)))
    if (!aceitos.size) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Marque pelo menos um item que o cliente aprovou' })
    const valorAceito = arred(itens.filter((i) => aceitos.has(i.id)).reduce((s, i) => s + i.precoUnitario * i.quantidade, 0))
    await db.transaction(async (tx) => {
      for (const i of itens) await tx.update(cotacoesCrmItens).set({ aceito: aceitos.has(i.id) }).where(eq(cotacoesCrmItens.id, i.id))
      await tx.update(cotacoesCrm).set({ status: 'ganha', encerradaEm: agoraSqlite(), updatedAt: agoraSqlite() }).where(eq(cotacoesCrm.id, c.id))
    })
    await registrar(
      c.id,
      ctx.user.id,
      'Cliente aprovou',
      aceitos.size === itens.length ? `Todos os itens · ${brl(valorAceito)}` : `${aceitos.size} de ${itens.length} itens · ${brl(valorAceito)}`
    )
    return { valorAceito }
  }),

  perder: cotacoesProcedure
    .input(z.object({ id: z.number().int(), motivo: z.enum(MOTIVOS_PERDA), observacao: z.string().trim().max(500).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const c = await acharCotacao(ctx, input.id)
      exigirDono(ctx, c)
      exigirStatus(c, ['rascunho', 'aguardando_aprovacao', 'aprovada', 'enviada'], 'marcar como perdida')
      if (input.motivo === 'Outro' && !input.observacao) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Conte o motivo em "Outro"' })
      if (c.sapDocEntry) await fecharCotacaoSap(c.sapDocEntry).catch((e) => { throw sapErro(e) })
      await db
        .update(cotacoesCrm)
        .set({ status: 'perdida', motivoPerda: input.motivo, motivoPerdaObs: input.observacao || null, encerradaEm: agoraSqlite(), updatedAt: agoraSqlite() })
        .where(eq(cotacoesCrm.id, c.id))
      await registrar(c.id, ctx.user.id, 'Marcou como perdida', input.observacao ? `${input.motivo}: ${input.observacao}` : input.motivo)
      return { ok: true }
    }),

  // Cria a Cotação de Venda no SAP (pronta p/ enviar ou já enviada ao cliente).
  enviarAoSap: cotacoesProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    const c = await acharCotacao(ctx, input.id)
    exigirDono(ctx, c)
    exigirStatus(c, ['aprovada', 'enviada'], 'enviar ao SAP')
    if (c.sapDocNum) throw new TRPCError({ code: 'BAD_REQUEST', message: `Já está no SAP (cotação nº ${c.sapDocNum})` })
    const { dados } = await paraSap(c, ctx.filial)
    await exigirEstoque(c.id, ctx.filial)
    let r
    try {
      r = await enviarCotacaoSap(dados)
    } catch (e) {
      throw sapErro(e)
    }
    await db.update(cotacoesCrm).set({ sapDocEntry: r.docEntry, sapDocNum: r.docNum, updatedAt: agoraSqlite() }).where(eq(cotacoesCrm.id, c.id))
    await registrar(c.id, ctx.user.id, 'Enviou ao SAP', `Cotação SAP nº ${r.docNum} · ${brl(r.total)} com impostos`)
    return { docNum: r.docNum, total: r.total }
  }),

  // Cliente aprovou → Pedido de Venda no SAP baseado na cotação, só com os
  // itens aceitos. Se a cotação ainda não estava no SAP, envia antes.
  // O pedido no SAP vira venda no card (Fechado) pela venda automática.
  gerarPedido: cotacoesProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    const c = await acharCotacao(ctx, input.id)
    exigirDono(ctx, c)
    exigirStatus(c, ['ganha'], 'gerar pedido de')
    if (c.sapPedidoNum) throw new TRPCError({ code: 'BAD_REQUEST', message: `Pedido já gerado (SAP nº ${c.sapPedidoNum})` })
    const { dados, itens } = await paraSap(c, ctx.filial)
    await exigirEstoque(c.id, ctx.filial, true)
    let cotEntry = c.sapDocEntry
    try {
      if (!cotEntry) {
        const q = await enviarCotacaoSap(dados)
        cotEntry = q.docEntry
        await db.update(cotacoesCrm).set({ sapDocEntry: q.docEntry, sapDocNum: q.docNum }).where(eq(cotacoesCrm.id, c.id))
        await registrar(c.id, ctx.user.id, 'Enviou ao SAP', `Cotação SAP nº ${q.docNum}`)
      }
      const aceitas = itens.map((i, linha) => (i.aceito ? linha : -1)).filter((l) => l >= 0)
      const r = await gerarPedidoSap(dados, cotEntry, aceitas)
      await db.update(cotacoesCrm).set({ sapPedidoEntry: r.docEntry, sapPedidoNum: r.docNum, updatedAt: agoraSqlite() }).where(eq(cotacoesCrm.id, c.id))
      await registrar(c.id, ctx.user.id, 'Gerou o pedido no SAP', `Pedido SAP nº ${r.docNum} · ${brl(r.total)} com impostos`)
      return { docNum: r.docNum, total: r.total }
    } catch (e) {
      if (e instanceof TRPCError) throw e
      throw sapErro(e)
    }
  }),

  // Pra impressão: dados do cliente no SAP, buscando agora se ainda não tem.
  dadosClienteSap: cotacoesProcedure.input(z.object({ id: z.number().int() })).query(async ({ ctx, input }) => {
    const c = await acharCotacao(ctx, input.id)
    const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, c.clienteId), columns: { codigo: true } })
    if (!cliente) return null
    return (await dadosClienteSap(cliente.codigo)) ?? (await atualizarDadosClienteSap(cliente.codigo).catch(() => null))
  }),

  // Nova cotação (rascunho) com o mesmo cliente, itens, preços e condições —
  // pra cliente que repete pedido. Validade, aprovação e situação zeram.
  duplicar: cotacoesProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    const c = await acharCotacao(ctx, input.id)
    const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, c.clienteId), columns: { vendedorAtualId: true } })
    if (!ctx.veTudo && cliente?.vendedorAtualId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cliente fora da sua carteira' })
    const itens = await db.select().from(cotacoesCrmItens).where(eq(cotacoesCrmItens.cotacaoId, c.id)).orderBy(cotacoesCrmItens.id)
    const agora = agoraSqlite()
    const id = await db.transaction(async (tx) => {
      const [nova] = await tx
        .insert(cotacoesCrm)
        .values({
          empresaId: ctx.empresaId,
          clienteId: c.clienteId,
          vendedorId: ctx.user.id,
          listaPreco: c.listaPreco,
          prazoCodigo: c.prazoCodigo,
          observacao: c.observacao,
          numeroReferencia: null,
          dataEntrega: null,
          contato: c.contato,
          transportadora: c.transportadora,
          tipoEnvio: c.tipoEnvio,
          valorFrete: c.valorFrete,
          total: c.total,
          maiorDescontoPct: c.maiorDescontoPct,
          createdAt: agora,
          updatedAt: agora,
        })
        .returning({ id: cotacoesCrm.id })
      if (itens.length) {
        await tx.insert(cotacoesCrmItens).values(
          itens.map((i) => ({ cotacaoId: nova.id, itemCodigo: i.itemCodigo, nome: i.nome, quantidade: i.quantidade, precoTabela: i.precoTabela, descontoPct: i.descontoPct, precoUnitario: i.precoUnitario, precoManual: i.precoManual }))
        )
      }
      return nova.id
    })
    await registrar(id, ctx.user.id, 'Criou a cotação', `Duplicada da cotação nº ${c.id}`)
    return { id }
  }),

  excluir: cotacoesProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    const c = await acharCotacao(ctx, input.id)
    exigirDono(ctx, c)
    exigirStatus(c, ['rascunho'], 'excluir')
    await db.update(cotacoesCrm).set({ deletedAt: agoraSqlite() }).where(eq(cotacoesCrm.id, c.id))
    return { ok: true }
  }),

  // Recopia o catálogo do SAP agora (admin). Leva alguns segundos.
  atualizarCatalogo: cotacoesProcedure.mutation(async ({ ctx }) => {
    if (!ctx.podeConfigurar) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só admin atualiza o catálogo' })
    return sincronizarCatalogoSap(true)
  }),
})
