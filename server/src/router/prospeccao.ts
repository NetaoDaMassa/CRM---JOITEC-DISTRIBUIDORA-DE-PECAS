import { z } from 'zod'
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { bancoClientesLiberacoes, clientes, carteiraHistorico, logAuditoria, users, prospeccaoRegistros, vendas } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { CANAL_ORIGEM_VALUES } from '../lib/canalOrigem.js'
import { buscarCnpj } from '../lib/brasilApi.js'
import { regiaoPorUf } from '../lib/regiao.js'
import {
  ETAPAS_ABERTAS,
  assumirParaProspeccao,
  avancarEtapaPorContato,
  calcularSugestoes,
  enviarProspectParaCarteira,
  filtrarSugestoes,
  limparCacheSugestoes,
  registrarEntrada,
} from '../lib/prospeccaoNova.js'

type Role = 'admin' | 'vendor' | 'gestor'

async function assertProspectAlcancavel(clienteId: number, empresaId: number, userId: number, role: Role) {
  const cliente = await db.query.clientes.findFirst({ where: and(eq(clientes.id, clienteId), eq(clientes.empresaId, empresaId)) })
  if (!cliente) throw new Error('Prospect não encontrado')
  if (role === 'vendor' && cliente.vendedorAtualId !== userId) throw new Error('Acesso negado')
  return cliente
}

const ETAPAS = ['novo', 'tentando', 'conversando', 'orcamento', 'ganho', 'perdido', 'desqualificado'] as const
const dataYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
const SEM_ORIGEM = 'Sem origem definida'
const ORIGEM_BANCO_SUGESTAO = 'Sugestões do grupo (prospecção)'
const soDig = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')

// Prospect da tela nova = emProspeccao + origem preenchida (origem nula =
// balcão ou prospect da Bruna; ver lib/prospeccaoNova.ts).
function condProspectNovo(empresaId: number) {
  return and(eq(clientes.empresaId, empresaId), eq(clientes.emProspeccao, true), isNotNull(clientes.prospeccaoOrigem), isNull(clientes.deletedAt))
}

// Prospects que o próprio vendedor caçou (Google, indicação etc.) — ficam
// fora do Kanban/funil normal até "enviar pra carteira". Nenhum
// `funil_mensal` é criado enquanto `emProspeccao` for true.
export const prospeccaoRouter = router({
  // Lista antiga (simples) — mantida por compatibilidade.
  listar: protectedProcedure.input(z.object({ vendedorId: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
    const vendedorId = ctx.user.role === 'admin' ? (input?.vendedorId ?? ctx.user.id) : ctx.user.id
    return db.query.clientes.findMany({
      where: and(
        eq(clientes.empresaId, ctx.empresaId),
        eq(clientes.vendedorAtualId, vendedorId),
        eq(clientes.emProspeccao, true),
        isNull(clientes.deletedAt),
        // Cliente de venda de balcão também nasce com emProspeccao=true —
        // não é prospect (João, 2026-10-27).
        sql`NOT EXISTS (SELECT 1 FROM vendas v WHERE v.cliente_id = ${clientes.id} AND v.deleted_at IS NULL)`
      ),
      orderBy: [desc(clientes.createdAt)],
      with: { telefonesExtras: { orderBy: (t, { asc }) => [asc(t.id)] } },
    })
  }),

  // ── Tela nova (2026-11-05) ─────────────────────────────────────────────
  // Todos os prospects da empresa (admin) ou do vendedor, com contagem de
  // tentativas, último contato e cliques esperando confirmação.
  quadro: protectedProcedure.input(z.object({ vendedorId: z.number().nullable().optional() }).optional()).query(async ({ ctx, input }) => {
    const vePorTodos = ctx.user.role !== 'vendor'
    const filtros = [condProspectNovo(ctx.empresaId)]
    if (!vePorTodos) filtros.push(eq(clientes.vendedorAtualId, ctx.user.id))
    else if (input?.vendedorId) filtros.push(eq(clientes.vendedorAtualId, input.vendedorId))
    // Encerrados (perdido/desqualificado de cadastro manual) só aparecem 60 dias.
    const limite = new Date(Date.now() - 60 * 864e5).toISOString().replace('T', ' ').slice(0, 19)
    filtros.push(or(isNull(clientes.prospeccaoEncerradoEm), gte(clientes.prospeccaoEncerradoEm, limite))!)
    const lista = await db.query.clientes.findMany({
      where: and(...filtros),
      columns: {
        id: true,
        razaoSocial: true,
        codigo: true,
        cnpj: true,
        cpf: true,
        cidade: true,
        estado: true,
        telefoneWhatsapp: true,
        email: true,
        nomeContato: true,
        observacoes: true,
        vendedorAtualId: true,
        canalOrigem: true,
        prospeccaoEtapa: true,
        prospeccaoOrigem: true,
        prospeccaoProximoContato: true,
        prospeccaoMotivo: true,
        prospeccaoInfo: true,
        prospeccaoDesde: true,
        origemBanco: true,
        createdAt: true,
      },
      with: { telefonesExtras: { columns: { id: true, numero: true, rotulo: true } } },
      orderBy: [desc(clientes.prospeccaoDesde)],
    })
    const ids = lista.map((c) => c.id)
    const registros = ids.length
      ? await db
          .select({
            id: prospeccaoRegistros.id,
            clienteId: prospeccaoRegistros.clienteId,
            tipo: prospeccaoRegistros.tipo,
            observacao: prospeccaoRegistros.observacao,
            resultado: prospeccaoRegistros.resultado,
            pendente: prospeccaoRegistros.pendente,
            createdAt: prospeccaoRegistros.createdAt,
          })
          .from(prospeccaoRegistros)
          .where(inArray(prospeccaoRegistros.clienteId, ids))
          .orderBy(desc(prospeccaoRegistros.createdAt))
      : []
    const porCliente = new Map<number, typeof registros>()
    for (const r of registros) {
      const l = porCliente.get(r.clienteId) ?? []
      l.push(r)
      porCliente.set(r.clienteId, l)
    }
    const nomes = new Map(
      (await db.query.users.findMany({ where: eq(users.empresaId, ctx.empresaId), columns: { id: true, name: true } })).map((u) => [u.id, u.name])
    )
    return lista.map((c) => {
      const regs = porCliente.get(c.id) ?? []
      const contatos = regs.filter((r) => r.tipo !== 'nota' && !r.pendente)
      return {
        ...c,
        vendedorNome: c.vendedorAtualId ? (nomes.get(c.vendedorAtualId) ?? '') : '',
        tentativas: contatos.length,
        ultimoContato: contatos[0] ? { tipo: contatos[0].tipo, observacao: contatos[0].observacao, resultado: contatos[0].resultado, em: contatos[0].createdAt } : null,
        pendentes: regs.filter((r) => r.pendente).map((r) => ({ id: r.id, tipo: r.tipo, em: r.createdAt })),
      }
    })
  }),

  // Confere um CNPJ/CPF antes de cadastrar: dados da Receita + se já existe
  // em alguma empresa do grupo (e com quem).
  verificarDocumento: protectedProcedure.input(z.object({ documento: z.string().min(11) })).mutation(async ({ ctx, input }) => {
    const doc = soDig(input.documento)
    if (doc.length !== 11 && doc.length !== 14) throw new Error('Digite um CNPJ (14 números) ou CPF (11 números).')
    const iguais = await db.query.clientes.findMany({
      where: and(
        isNull(clientes.deletedAt),
        or(
          sql`replace(replace(replace(replace(coalesce(${clientes.cnpj}, ''), '.', ''), '/', ''), '-', ''), ' ', '') = ${doc}`,
          sql`replace(replace(replace(coalesce(${clientes.cpf}, ''), '.', ''), '-', ''), ' ', '') = ${doc}`
        )
      ),
      columns: { id: true, empresaId: true, razaoSocial: true, vendedorAtualId: true, emProspeccao: true, prospeccaoOrigem: true, bancoDesqualificado: true },
      with: { vendedorAtual: { columns: { name: true } } },
    })
    const nomeEmp = new Map((await db.query.empresas.findMany({ columns: { id: true, nome: true } })).map((e) => [e.id, e.nome]))
    const existentes = iguais.map((c) => ({
      id: c.id,
      aqui: c.empresaId === ctx.empresaId,
      empresa: nomeEmp.get(c.empresaId) ?? '',
      razaoSocial: c.razaoSocial,
      situacao: c.vendedorAtualId
        ? c.emProspeccao && c.prospeccaoOrigem
          ? `em prospecção com ${c.vendedorAtual?.name ?? 'outro vendedor'}`
          : `na carteira de ${c.vendedorAtual?.name ?? 'outro vendedor'}`
        : c.bancoDesqualificado
          ? `no Banco de Clientes (desqualificado: ${c.bancoDesqualificado})`
          : 'no Banco de Clientes, sem vendedor',
      semDono: !c.vendedorAtualId,
      souEu: c.vendedorAtualId === ctx.user.id,
    }))
    const receita = doc.length === 14 ? await buscarCnpj(doc).catch(() => null) : null
    return { existentes, receita }
  }),

  criar: protectedProcedure
    .input(
      z.object({
        razaoSocial: z.string().min(2),
        telefoneWhatsapp: z.string().optional(),
        observacoes: z.string().optional(),
        canalOrigem: z.enum(CANAL_ORIGEM_VALUES),
        documento: z.string().optional(),
        cidade: z.string().optional(),
        estado: z.string().max(2).optional(),
        email: z.string().optional(),
        nomeContato: z.string().optional(),
        endereco: z.string().optional(),
        bairro: z.string().optional(),
        cep: z.string().optional(),
        proximoContato: dataYmd.optional(),
        // Só o admin: cadastrar em nome de um vendedor.
        vendedorId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const vendedorAtualId = ctx.user.role !== 'vendor' && input.vendedorId ? input.vendedorId : ctx.user.id
      const vendedor = await db.query.users.findFirst({ where: eq(users.id, vendedorAtualId) })
      const uf = input.estado?.trim().toUpperCase() || null
      const regiao = (uf ? regiaoPorUf(uf) : null) ?? vendedor?.regiao ?? null
      const doc = soDig(input.documento)
      if (doc) {
        const jaAqui = await db.query.clientes.findFirst({
          where: and(
            eq(clientes.empresaId, ctx.empresaId),
            isNull(clientes.deletedAt),
            or(
              sql`replace(replace(replace(coalesce(${clientes.cnpj}, ''), '.', ''), '/', ''), '-', '') = ${doc}`,
              sql`replace(replace(coalesce(${clientes.cpf}, ''), '.', ''), '-', '') = ${doc}`
            )
          ),
          columns: { id: true, vendedorAtualId: true },
        })
        if (jaAqui?.vendedorAtualId) throw new Error('Esse CNPJ/CPF já tem vendedor nesta empresa — não dá pra cadastrar de novo.')
        if (jaAqui) {
          // Já existe no banco daqui: em vez de duplicar, puxa esse cadastro.
          const ok = await assumirParaProspeccao({ clienteId: jaAqui.id, vendedorId: vendedorAtualId, origem: 'banco', alteradoPor: ctx.user.id })
          if (!ok) throw new Error('Esse cliente acabou de ser pego por outro vendedor.')
          if (input.proximoContato) await db.update(clientes).set({ prospeccaoProximoContato: input.proximoContato }).where(eq(clientes.id, jaAqui.id))
          return { id: jaAqui.id, puxouDoBanco: true }
        }
      }
      const result = await db.insert(clientes).values({
        empresaId: ctx.empresaId,
        razaoSocial: input.razaoSocial.trim(),
        codigo: `P${Date.now()}`,
        regiao,
        cnpj: doc.length === 14 ? doc : null,
        cpf: doc.length === 11 ? doc : null,
        cidade: input.cidade?.trim() || null,
        estado: uf,
        email: input.email?.trim() || null,
        nomeContato: input.nomeContato?.trim() || null,
        endereco: input.endereco?.trim() || null,
        bairro: input.bairro?.trim() || null,
        cep: input.cep?.trim() || null,
        telefoneWhatsapp: input.telefoneWhatsapp,
        observacoes: input.observacoes,
        canalOrigem: input.canalOrigem,
        vendedorAtualId,
        cadastradoPor: ctx.user.id,
        emProspeccao: true,
        prospeccaoOrigem: 'manual',
        prospeccaoEtapa: 'novo',
        prospeccaoProximoContato: input.proximoContato ?? hojeBrString(),
        prospeccaoDesde: agoraSqlite(),
      })
      const id = Number(result.lastInsertRowid)
      await registrarEntrada(id, 'manual', vendedorAtualId, ctx.user.id)
      return { id, puxouDoBanco: false }
    }),

  // Muda a etapa. Perdido/Desqualificado exigem motivo; prospect que veio do
  // Banco/SAP volta pro Banco de Clientes (nunca é apagado) — desqualificado
  // volta marcado e fica escondido da lista do banco.
  moverEtapa: protectedProcedure
    .input(z.object({ id: z.number(), etapa: z.enum(ETAPAS), motivo: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const c = await assertProspectAlcancavel(input.id, ctx.empresaId, ctx.user.id, ctx.user.role)
      if (!c.emProspeccao || !c.prospeccaoOrigem) throw new Error('Esse cliente não está na prospecção.')
      if (input.etapa === c.prospeccaoEtapa) return { voltouProBanco: false }
      const encerra = input.etapa === 'perdido' || input.etapa === 'desqualificado'
      const motivo = input.motivo?.trim()
      if (encerra && !motivo) throw new Error('Escolha o motivo.')
      if (input.etapa === 'ganho') {
        await db.update(clientes).set({ prospeccaoEtapa: 'ganho', updatedAt: agoraSqlite() }).where(eq(clientes.id, c.id))
        return { voltouProBanco: false }
      }
      const vendedorId = c.vendedorAtualId
      const voltaProBanco = encerra && c.prospeccaoOrigem !== 'manual'
      await db
        .update(clientes)
        .set({
          prospeccaoEtapa: input.etapa,
          prospeccaoMotivo: encerra ? motivo : null,
          prospeccaoEncerradoEm: encerra ? agoraSqlite() : null,
          prospeccaoProximoContato: encerra ? null : c.prospeccaoProximoContato,
          ...(voltaProBanco
            ? {
                vendedorAtualId: null,
                emProspeccao: false,
                origemBanco: c.origemBanco ?? ORIGEM_BANCO_SUGESTAO,
                bancoDesqualificado: input.etapa === 'desqualificado' ? motivo : null,
              }
            : {}),
          updatedAt: agoraSqlite(),
        })
        .where(eq(clientes.id, c.id))
      await registrarAuditoria({
        tabela: 'clientes',
        registroId: c.id,
        acao: 'mudar_etapa',
        campo: 'prospeccao_etapa',
        valorAnterior: c.prospeccaoEtapa,
        valorNovo: `${input.etapa}|${vendedorId ?? ''}|${c.prospeccaoOrigem}|${motivo ?? ''}`,
        alteradoPor: ctx.user.id,
      })
      if (voltaProBanco) limparCacheSugestoes()
      return { voltouProBanco: voltaProBanco }
    }),

  editarProspect: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        razaoSocial: z.string().min(2).optional(),
        telefoneWhatsapp: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        nomeContato: z.string().nullable().optional(),
        cidade: z.string().nullable().optional(),
        observacoes: z.string().nullable().optional(),
        proximoContato: dataYmd.nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const c = await assertProspectAlcancavel(input.id, ctx.empresaId, ctx.user.id, ctx.user.role)
      if (!c.emProspeccao) throw new Error('Esse cliente não está na prospecção.')
      const { id, proximoContato, ...campos } = input
      await db
        .update(clientes)
        .set({ ...campos, ...(proximoContato !== undefined ? { prospeccaoProximoContato: proximoContato } : {}), updatedAt: agoraSqlite() })
        .where(eq(clientes.id, id))
      return { success: true }
    }),

  // Tentativa registrada à mão. Próximo contato é obrigatório enquanto o
  // prospect está em aberto — é o que alimenta o "Meu dia".
  registrarTentativa: protectedProcedure
    .input(
      z.object({
        clienteId: z.number(),
        tipo: z.enum(['ligacao', 'whatsapp', 'email', 'visita', 'nota']),
        resultado: z.enum(['respondeu', 'nao_respondeu']).optional(),
        observacao: z.string().min(1, 'Escreva o que aconteceu.'),
        proximoContato: dataYmd.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const c = await assertProspectAlcancavel(input.clienteId, ctx.empresaId, ctx.user.id, ctx.user.role)
      const aberto = (ETAPAS_ABERTAS as readonly string[]).includes(c.prospeccaoEtapa ?? '')
      if (aberto && !input.proximoContato) throw new Error('Marque a data do próximo contato.')
      if (input.tipo !== 'nota' && !input.resultado) throw new Error('Diga se respondeu ou não.')
      await db.insert(prospeccaoRegistros).values({
        clienteId: input.clienteId,
        tipo: input.tipo,
        observacao: input.observacao.trim(),
        registradoPorId: ctx.user.id,
        resultado: input.tipo === 'nota' ? null : input.resultado,
        origem: 'manual',
      })
      if (input.proximoContato) await db.update(clientes).set({ prospeccaoProximoContato: input.proximoContato, updatedAt: agoraSqlite() }).where(eq(clientes.id, c.id))
      if (input.tipo !== 'nota' && aberto) await avancarEtapaPorContato(c.id, input.resultado === 'respondeu')
      return { success: true }
    }),

  // Clique no WhatsApp / E-mail / Ligar (sem PABX) — fica pendente até o
  // vendedor confirmar como foi, igual o card da carteira. Ligação pelo PABX
  // não passa aqui: é registrada sozinha (lib/pabxone360.ts).
  registrarClique: protectedProcedure
    .input(z.object({ clienteId: z.number(), tipo: z.enum(['ligacao', 'whatsapp', 'email']) }))
    .mutation(async ({ ctx, input }) => {
      await assertProspectAlcancavel(input.clienteId, ctx.empresaId, ctx.user.id, ctx.user.role)
      const meiaHora = new Date(Date.now() - 30 * 60_000).toISOString().replace('T', ' ').slice(0, 19)
      const ja = await db.query.prospeccaoRegistros.findFirst({
        where: and(
          eq(prospeccaoRegistros.clienteId, input.clienteId),
          eq(prospeccaoRegistros.tipo, input.tipo),
          eq(prospeccaoRegistros.pendente, true),
          gte(prospeccaoRegistros.createdAt, meiaHora)
        ),
        columns: { id: true },
      })
      if (ja) return { id: ja.id }
      const rotulo = { ligacao: 'Ligação pelo discador', whatsapp: 'WhatsApp aberto', email: 'E-mail aberto' }[input.tipo]
      const r = await db
        .insert(prospeccaoRegistros)
        .values({ clienteId: input.clienteId, tipo: input.tipo, observacao: rotulo, registradoPorId: ctx.user.id, pendente: true, origem: 'clique' })
        .returning({ id: prospeccaoRegistros.id })
      return { id: r[0]?.id ?? null }
    }),

  confirmarContato: protectedProcedure
    .input(
      z.object({
        registroId: z.number(),
        respondeu: z.boolean(),
        observacao: z.string().optional(),
        proximoContato: dataYmd.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const reg = await db.query.prospeccaoRegistros.findFirst({ where: eq(prospeccaoRegistros.id, input.registroId) })
      if (!reg) throw new Error('Registro não encontrado')
      const c = await assertProspectAlcancavel(reg.clienteId, ctx.empresaId, ctx.user.id, ctx.user.role)
      const aberto = (ETAPAS_ABERTAS as readonly string[]).includes(c.prospeccaoEtapa ?? '')
      if (aberto && !input.proximoContato) throw new Error('Marque a data do próximo contato.')
      await db
        .update(prospeccaoRegistros)
        .set({
          pendente: false,
          resultado: input.respondeu ? 'respondeu' : 'nao_respondeu',
          observacao: input.observacao?.trim() ? `${reg.observacao} — ${input.observacao.trim()}` : reg.observacao,
        })
        .where(eq(prospeccaoRegistros.id, reg.id))
      if (input.proximoContato) await db.update(clientes).set({ prospeccaoProximoContato: input.proximoContato, updatedAt: agoraSqlite() }).where(eq(clientes.id, c.id))
      if (aberto) await avancarEtapaPorContato(c.id, input.respondeu)
      return { success: true }
    }),

  descartarClique: protectedProcedure.input(z.object({ registroId: z.number() })).mutation(async ({ ctx, input }) => {
    const reg = await db.query.prospeccaoRegistros.findFirst({ where: eq(prospeccaoRegistros.id, input.registroId) })
    if (!reg || !reg.pendente) throw new Error('Registro não encontrado')
    await assertProspectAlcancavel(reg.clienteId, ctx.empresaId, ctx.user.id, ctx.user.role)
    await db.delete(prospeccaoRegistros).where(eq(prospeccaoRegistros.id, reg.id))
    return { success: true }
  }),

  enviarParaCarteira: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertProspectAlcancavel(input.id, ctx.empresaId, ctx.user.id, ctx.user.role)
    await enviarProspectParaCarteira(input.id, ctx.user.id)
    return { success: true }
  }),

  // ── Sugestões (SAP / vendas do CRM) ──────────────────────────────────────
  // Vendedor vê só a região dele; admin vê todas (ou filtra).
  sugestoes: protectedProcedure.input(z.object({ regiao: z.string().nullable().optional() }).optional()).query(async ({ ctx, input }) => {
    const { grupo, parou } = await calcularSugestoes(ctx.empresaId)
    let regiao: string | null = input?.regiao ?? null
    let parouLiberado = parou
    if (ctx.user.role === 'vendor') {
      const eu = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id), columns: { regiao: true } })
      regiao = eu?.regiao ?? null
      // "Pararam de comprar" são clientes do Banco — respeita os bancos
      // liberados pro vendedor (mesma regra do "Pegar cliente").
      const lib = await db.query.bancoClientesLiberacoes.findMany({
        where: and(eq(bancoClientesLiberacoes.empresaId, ctx.empresaId), eq(bancoClientesLiberacoes.vendedorId, ctx.user.id)),
        columns: { origemBanco: true },
      })
      const ok = new Set(lib.map((l) => l.origemBanco))
      parouLiberado = parou.filter((s) => ok.has(s.origemBanco ?? SEM_ORIGEM))
    }
    const g = filtrarSugestoes(grupo, regiao)
    const pr = filtrarSugestoes(parouLiberado, regiao)
    return { regiao, grupo: g.itens, parou: pr.itens, totalGrupo: g.total, totalParou: pr.total }
  }),

  adicionarSugestao: protectedProcedure.input(z.object({ chave: z.string() })).mutation(async ({ ctx, input }) => {
    const { grupo, parou } = await calcularSugestoes(ctx.empresaId)
    const s = [...grupo, ...parou].find((x) => x.chave === input.chave)
    if (!s) throw new Error('Essa sugestão não está mais disponível — atualize a tela.')
    const vendedorId = ctx.user.id
    let clienteId = s.clienteDestinoId
    if (clienteId) {
      const ok = await assumirParaProspeccao({
        clienteId,
        vendedorId,
        origem: s.tipo === 'grupo' ? 'sap_grupo' : (await ehEmpresaSap(ctx.empresaId)) ? 'sap_parou' : 'crm_parou',
        info: s.info,
        alteradoPor: ctx.user.id,
      })
      if (!ok) throw new Error('Esse cliente acabou de ser pego por outro vendedor.')
    } else {
      // Não existe nesta empresa: cria o cadastro copiando da empresa do grupo.
      const f = s.clienteFonteId ? await db.query.clientes.findFirst({ where: eq(clientes.id, s.clienteFonteId) }) : null
      if (!f) throw new Error('Cadastro de origem não encontrado.')
      const codigoSap = /^C\d{5,}$/i.test(f.codigo.trim()) ? f.codigo.trim().toUpperCase() : null
      const codigoLivre = codigoSap
        ? !(await db.query.clientes.findFirst({ where: and(eq(clientes.empresaId, ctx.empresaId), eq(clientes.codigo, codigoSap)), columns: { id: true } }))
        : false
      const r = await db.insert(clientes).values({
        empresaId: ctx.empresaId,
        razaoSocial: f.razaoSocial,
        codigo: codigoLivre && codigoSap ? codigoSap : `P${Date.now()}`,
        cnpj: f.cnpj,
        cpf: f.cpf,
        inscricaoEstadual: f.inscricaoEstadual,
        regiao: s.regiao,
        estado: f.estado,
        cidade: f.cidade,
        endereco: f.endereco,
        numero: f.numero,
        complemento: f.complemento,
        bairro: f.bairro,
        cep: f.cep,
        telefoneWhatsapp: f.telefoneWhatsapp,
        email: f.email,
        nomeContato: f.nomeContato,
        vendedorAtualId: vendedorId,
        cadastradoPor: ctx.user.id,
        emProspeccao: true,
        prospeccaoOrigem: 'sap_grupo',
        prospeccaoEtapa: 'novo',
        prospeccaoProximoContato: hojeBrString(),
        prospeccaoInfo: s.info,
        prospeccaoDesde: agoraSqlite(),
      })
      clienteId = Number(r.lastInsertRowid)
      await registrarEntrada(clienteId, 'sap_grupo', vendedorId, ctx.user.id)
    }
    limparCacheSugestoes()
    return { id: clienteId }
  }),

  // ── Relatório ────────────────────────────────────────────────────────────
  relatorio: protectedProcedure
    .input(z.object({ de: dataYmd, ate: dataYmd, vendedorId: z.number().nullable().optional() }))
    .query(async ({ ctx, input }) => {
      const de = `${input.de} 03:00:00`
      const ate = new Date(new Date(`${input.ate}T03:00:00Z`).getTime() + 864e5 - 1000).toISOString().replace('T', ' ').slice(0, 19)
      const vendedorFiltro = ctx.user.role === 'vendor' ? ctx.user.id : (input.vendedorId ?? null)
      const usuarios = await db.query.users.findMany({ where: eq(users.empresaId, ctx.empresaId), columns: { id: true, name: true } })
      const nomes = new Map(usuarios.map((u) => [u.id, u.name]))
      const idsEmpresa = usuarios.map((u) => u.id)

      // Tentativas (sem pendentes nem anotações) por vendedor.
      const regs = idsEmpresa.length
        ? await db
            .select({ por: prospeccaoRegistros.registradoPorId, resultado: prospeccaoRegistros.resultado, tipo: prospeccaoRegistros.tipo })
            .from(prospeccaoRegistros)
            .innerJoin(clientes, eq(clientes.id, prospeccaoRegistros.clienteId))
            .where(
              and(
                eq(clientes.empresaId, ctx.empresaId),
                isNotNull(clientes.prospeccaoOrigem),
                eq(prospeccaoRegistros.pendente, false),
                sql`${prospeccaoRegistros.tipo} <> 'nota'`,
                gte(prospeccaoRegistros.createdAt, de),
                lte(prospeccaoRegistros.createdAt, ate),
                vendedorFiltro ? eq(prospeccaoRegistros.registradoPorId, vendedorFiltro) : undefined
              )
            )
        : []

      // Entradas e encerramentos (log de auditoria — sobrevive à volta pro banco).
      const logs = await db
        .select({ campo: logAuditoria.campo, valorNovo: logAuditoria.valorNovo, registroId: logAuditoria.registroId })
        .from(logAuditoria)
        .innerJoin(clientes, eq(clientes.id, logAuditoria.registroId))
        .where(
          and(
            eq(logAuditoria.tabela, 'clientes'),
            inArray(logAuditoria.campo, ['prospeccao_entrada', 'prospeccao_etapa']),
            eq(clientes.empresaId, ctx.empresaId),
            gte(logAuditoria.alteradoEm, de),
            lte(logAuditoria.alteradoEm, ate)
          )
        )
      type Linha = { vendedorId: number; tentativas: number; responderam: number; entraram: number; ganhos: number; perdidos: number; desqualificados: number }
      const porVend = new Map<number, Linha>()
      const linha = (id: number) => {
        let l = porVend.get(id)
        if (!l) porVend.set(id, (l = { vendedorId: id, tentativas: 0, responderam: 0, entraram: 0, ganhos: 0, perdidos: 0, desqualificados: 0 }))
        return l
      }
      for (const r of regs) {
        const l = linha(r.por)
        l.tentativas++
        if (r.resultado === 'respondeu') l.responderam++
      }
      const origens: Record<string, number> = {}
      const motivosPerda: Record<string, number> = {}
      const motivosDesq: Record<string, number> = {}
      for (const lg of logs) {
        const partes = (lg.valorNovo ?? '').split('|')
        if (lg.campo === 'prospeccao_entrada') {
          const [origem, vend] = partes
          const v = Number(vend)
          if (vendedorFiltro && v !== vendedorFiltro) continue
          origens[origem] = (origens[origem] ?? 0) + 1
          if (v) linha(v).entraram++
        } else {
          const [etapa, vend, , motivo] = partes
          const v = Number(vend)
          if (!['ganho', 'perdido', 'desqualificado'].includes(etapa)) continue
          if (vendedorFiltro && v !== vendedorFiltro) continue
          if (!v) continue
          const l = linha(v)
          if (etapa === 'ganho') l.ganhos++
          if (etapa === 'perdido') {
            l.perdidos++
            motivosPerda[motivo || 'Sem motivo'] = (motivosPerda[motivo || 'Sem motivo'] ?? 0) + 1
          }
          if (etapa === 'desqualificado') {
            l.desqualificados++
            motivosDesq[motivo || 'Sem motivo'] = (motivosDesq[motivo || 'Sem motivo'] ?? 0) + 1
          }
        }
      }
      const vendedores = [...porVend.values()].map((l) => ({ ...l, nome: nomes.get(l.vendedorId) ?? `#${l.vendedorId}` })).sort((a, b) => b.tentativas - a.tentativas)
      const tot = vendedores.reduce(
        (s, l) => ({
          tentativas: s.tentativas + l.tentativas,
          responderam: s.responderam + l.responderam,
          entraram: s.entraram + l.entraram,
          ganhos: s.ganhos + l.ganhos,
          perdidos: s.perdidos + l.perdidos,
          desqualificados: s.desqualificados + l.desqualificados,
        }),
        { tentativas: 0, responderam: 0, entraram: 0, ganhos: 0, perdidos: 0, desqualificados: 0 }
      )
      return { totais: tot, vendedores, origens, motivosPerda, motivosDesq }
    }),

  descartar: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const cliente = await db.query.clientes.findFirst({
      where: and(eq(clientes.id, input.id), eq(clientes.empresaId, ctx.empresaId)),
    })
    if (!cliente) throw new Error('Prospect não encontrado')
    if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')
    if (!cliente.emProspeccao) throw new Error('Só é possível descartar prospects que ainda não foram enviados pra carteira.')
    const temVenda = await db.query.vendas.findFirst({ where: and(eq(vendas.clienteId, input.id), isNull(vendas.deletedAt)), columns: { id: true } })
    if (temVenda) throw new Error('Esse cliente já tem venda registrada (ex.: venda de balcão) — não é um prospect, não dá pra descartar.')
    if (cliente.prospeccaoOrigem && cliente.prospeccaoOrigem !== 'manual') {
      throw new Error('Esse cliente veio do Banco/SAP — marque como Perdido ou Desqualificado (ele volta pro banco).')
    }
    // `emProspeccao` sozinho não é confiável — uma ferramenta de carteira
    // pode atribuir vendedor a um prospect sem mexer nessa flag (João,
    // 2026-10-14).
    const jaTeveCarteira = await db.query.carteiraHistorico.findFirst({ where: eq(carteiraHistorico.clienteId, input.id) })
    if (jaTeveCarteira) {
      throw new Error('Esse cliente já teve carteira atribuída — não é mais um prospect puro, fale com o admin antes de descartar.')
    }

    await db.update(clientes).set({ deletedAt: agoraSqlite() }).where(eq(clientes.id, input.id))
    await registrarAuditoria({ tabela: 'clientes', registroId: input.id, acao: 'excluir', campo: 'em_prospeccao', valorAnterior: 'true', alteradoPor: ctx.user.id })
    return { success: true }
  }),

  // ── Linha do tempo (também usada pela Prospecção Odin da Bruna) ──────────
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

async function ehEmpresaSap(empresaId: number) {
  const e = await db.query.empresas.findFirst({ where: (t, { eq }) => eq(t.id, empresaId), columns: { slug: true } })
  return !!e && ['joitec', 'odin-tubos', 'joitec-automacao'].includes(e.slug)
}
