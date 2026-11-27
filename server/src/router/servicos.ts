// Tela "Serviços" (Compretec Loja Física, João 2026-11-27) — controle dos
// serviços (manutenção, rede de ar, instalação) que substitui a planilha.
// Regras em lib/servicos.ts.
import { z } from 'zod'
import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, empresas, leads, servicoEventos, servicos, servicoVisitas, STATUS_SERVICO, users } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'
import {
  SLUGS_SERVICOS,
  STATUS_LABEL,
  MOTIVOS_NAO_APROVOU,
  prazoUmDiaUtil,
  registrarEvento,
  sincronizarAgenda,
  criarClienteDoServico,
  enviarServicoParaCarteira,
  tiposDoServico,
  valorTotal,
  type Servico,
  type StatusServico,
} from '../lib/servicos.js'

type Usuario = { id: number; role: string; superAdmin: boolean }
const ehGestor = (u: Usuario) => u.role !== 'vendor' || u.superAdmin
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const valor = z.number().min(0).nullable().optional()

async function empresaSlug(empresaId: number) {
  return (await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId), columns: { slug: true } }))?.slug ?? ''
}

async function assertEmpresa(empresaId: number) {
  const slug = await empresaSlug(empresaId)
  if (!SLUGS_SERVICOS.includes(slug)) throw new TRPCError({ code: 'FORBIDDEN', message: 'A tela de Serviços ainda não está liberada para esta empresa' })
  return slug
}

async function assertServico(id: number, empresaId: number, user: Usuario): Promise<Servico> {
  const s = await db.query.servicos.findFirst({ where: and(eq(servicos.id, id), eq(servicos.empresaId, empresaId), isNull(servicos.deletedAt)) })
  if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: 'Serviço não encontrado' })
  if (!ehGestor(user) && s.vendedorId !== user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Este serviço é de outro vendedor' })
  return s
}

async function recarregar(id: number) {
  return (await db.query.servicos.findFirst({ where: eq(servicos.id, id) }))!
}

const TZ_OFFSET_MS = 3 * 60 * 60 * 1000
function brDataHora(sqliteUtc: string | null) {
  if (!sqliteUtc) return null
  const d = new Date(new Date(sqliteUtc.replace(' ', 'T') + 'Z').getTime() - TZ_OFFSET_MS)
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

/** Campos que a tela precisa de cada serviço, com os alertas já calculados. */
function paraTela(s: Servico & { vendedorNome?: string | null }) {
  const agora = agoraSqlite()
  const hoje = hojeBrString()
  return {
    ...s,
    tipos: tiposDoServico(s),
    valorTotal: valorTotal(s),
    prazoOrcamentoBr: brDataHora(s.prazoOrcamento),
    orcamentoAtrasado: s.status === 'montando_orcamento' && !!s.prazoOrcamento && s.prazoOrcamento < agora,
    contatoVencido: s.status === 'aguardando_cliente' && !!s.proximoContato && s.proximoContato < hoje,
    contatoHoje: s.status === 'aguardando_cliente' && s.proximoContato === hoje,
  }
}

const camposEditaveis = {
  manutencao: z.boolean(),
  redeAr: z.boolean(),
  instalacao: z.boolean(),
  compressor: z.string().max(200).nullable().optional(),
  descricao: z.string().max(4000).nullable().optional(),
  endereco: z.string().max(500).nullable().optional(),
  telefone: z.string().max(40).nullable().optional(),
  valorMaoObra: valor,
  valorMaterial: valor,
  dataExecucao: data.nullable().optional(),
}

export const servicosRouter = router({
  disponivel: protectedProcedure.query(async ({ ctx }) => ({ mostrar: SLUGS_SERVICOS.includes(await empresaSlug(ctx.empresaId)) })),

  /**
   * Tudo que está aberto (qualquer mês) + finalizados/não aprovados do mês
   * escolhido + o que foi aberto no mês — a tela monta o quadro e a lista.
   */
  listar: protectedProcedure
    .input(z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/).optional(), vendedorId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await assertEmpresa(ctx.empresaId)
      const mes = input?.mes ?? hojeBrString().slice(0, 7)
      const condicoes = [eq(servicos.empresaId, ctx.empresaId), isNull(servicos.deletedAt)]
      if (!ehGestor(ctx.user)) condicoes.push(eq(servicos.vendedorId, ctx.user.id))
      else if (input?.vendedorId) condicoes.push(eq(servicos.vendedorId, input.vendedorId))
      // status_desde/created_at são UTC; o mês é o de Brasília.
      const mesBr = (col: typeof servicos.statusDesde | typeof servicos.createdAt) => sql`strftime('%Y-%m', ${col}, '-3 hours')`
      const linhas = await db
        .select({ s: servicos, vendedorNome: users.name })
        .from(servicos)
        .leftJoin(users, eq(users.id, servicos.vendedorId))
        .where(
          and(
            ...condicoes,
            or(
              inArray(servicos.status, ['montando_orcamento', 'aguardando_cliente', 'em_andamento']),
              sql`${mesBr(servicos.statusDesde)} = ${mes}`,
              sql`${mesBr(servicos.createdAt)} = ${mes}`
            )
          )
        )
        .orderBy(desc(servicos.updatedAt))
      const itens = linhas.map((l) => paraTela({ ...l.s, vendedorNome: l.vendedorNome }))

      // Resumo do mês (finalizados e não aprovados que fecharam no mês).
      const fechadosNoMes = itens.filter((i) => (i.status === 'finalizado' || i.status === 'nao_aprovou') && brDataHora(i.statusDesde)?.slice(0, 7) === mes)
      const finalizados = fechadosNoMes.filter((i) => i.status === 'finalizado')
      const naoAprovou = fechadosNoMes.filter((i) => i.status === 'nao_aprovou')
      const respondidos = itens.filter((i) => i.orcamentoRespondidoEm && i.prazoOrcamento && brDataHora(i.orcamentoRespondidoEm)?.slice(0, 7) === mes)
      const porTipo = (['Manutenção', 'Rede de ar', 'Instalação'] as const).map((t) => ({
        tipo: t,
        finalizados: finalizados.filter((i) => i.tipos.includes(t)).length,
        valor: finalizados.filter((i) => i.tipos.includes(t)).reduce((a, i) => a + i.valorTotal, 0),
        abertos: itens.filter((i) => ['montando_orcamento', 'aguardando_cliente', 'em_andamento'].includes(i.status) && i.tipos.includes(t)).length,
      }))
      const vendedoresMap = new Map<string, { nome: string; finalizados: number; valor: number; naoAprovou: number; abertos: number }>()
      for (const i of itens) {
        const nome = i.vendedorNome ?? 'Sem vendedor'
        const v = vendedoresMap.get(nome) ?? { nome, finalizados: 0, valor: 0, naoAprovou: 0, abertos: 0 }
        if (finalizados.includes(i)) {
          v.finalizados++
          v.valor += i.valorTotal
        } else if (naoAprovou.includes(i)) v.naoAprovou++
        else if (!['finalizado', 'nao_aprovou'].includes(i.status)) v.abertos++
        vendedoresMap.set(nome, v)
      }
      const motivos = new Map<string, number>()
      for (const i of naoAprovou) motivos.set(i.motivoNaoAprovouCategoria ?? 'outro', (motivos.get(i.motivoNaoAprovouCategoria ?? 'outro') ?? 0) + 1)

      return {
        mes,
        itens,
        resumo: {
          finalizados: finalizados.length,
          valorFinalizado: finalizados.reduce((a, i) => a + i.valorTotal, 0),
          valorMaoObra: finalizados.reduce((a, i) => a + (i.valorMaoObra ?? 0), 0),
          naoAprovou: naoAprovou.length,
          valorPerdido: naoAprovou.reduce((a, i) => a + i.valorTotal, 0),
          taxaAprovacao: fechadosNoMes.length ? Math.round((finalizados.length / fechadosNoMes.length) * 100) : null,
          emAberto: itens.filter((i) => ['montando_orcamento', 'aguardando_cliente', 'em_andamento'].includes(i.status)).length,
          valorEmAberto: itens.filter((i) => ['aguardando_cliente', 'em_andamento'].includes(i.status)).reduce((a, i) => a + i.valorTotal, 0),
          orcamentosAtrasados: itens.filter((i) => i.orcamentoAtrasado).length,
          contatosVencidos: itens.filter((i) => i.contatoVencido).length,
          contatosHoje: itens.filter((i) => i.contatoHoje).length,
          orcamentosRespondidos: respondidos.length,
          orcamentosNoPrazo: respondidos.filter((i) => i.orcamentoRespondidoEm! <= i.prazoOrcamento!).length,
          porTipo,
          porVendedor: [...vendedoresMap.values()].sort((a, b) => b.valor - a.valor || b.abertos - a.abertos),
          motivosNaoAprovou: [...motivos.entries()].map(([motivo, qtd]) => ({ motivo, qtd })).sort((a, b) => b.qtd - a.qtd),
        },
      }
    }),

  obter: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const s = await assertServico(input.id, ctx.empresaId, ctx.user)
    const vendedor = s.vendedorId ? await db.query.users.findFirst({ where: eq(users.id, s.vendedorId), columns: { name: true } }) : null
    const cliente = s.clienteId
      ? await db.query.clientes.findFirst({
          where: eq(clientes.id, s.clienteId),
          columns: { id: true, razaoSocial: true, cnpj: true, cpf: true, cidade: true, telefoneWhatsapp: true, emProspeccao: true, vendedorAtualId: true },
        })
      : null
    const lead = s.leadId ? await db.query.leads.findFirst({ where: eq(leads.id, s.leadId), columns: { id: true, name: true, status: true, source: true, city: true } }) : null
    const eventos = await db
      .select({ e: servicoEventos, nome: users.name })
      .from(servicoEventos)
      .leftJoin(users, eq(users.id, servicoEventos.userId))
      .where(eq(servicoEventos.servicoId, s.id))
      .orderBy(desc(servicoEventos.id))
    const visitas = await db
      .select({ v: servicoVisitas, nome: users.name })
      .from(servicoVisitas)
      .leftJoin(users, eq(users.id, servicoVisitas.vendedorId))
      .where(eq(servicoVisitas.servicoId, s.id))
      .orderBy(desc(servicoVisitas.id))
    return {
      ...paraTela({ ...s, vendedorNome: vendedor?.name ?? null }),
      cliente,
      lead,
      eventos: eventos.map((e) => ({ ...e.e, userNome: e.nome, quandoBr: brDataHora(e.e.createdAt) })),
      visitas: visitas.map((v) => ({ ...v.v, vendedorNome: v.nome, checkinBr: brDataHora(v.v.checkinEm), checkoutBr: brDataHora(v.v.checkoutEm) })),
    }
  }),

  /** Busca de quem pode virar serviço: carteira, prospecção e leads do marketing. */
  buscarOrigem: protectedProcedure.input(z.object({ texto: z.string().min(2) })).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const termo = `%${input.texto.trim()}%`
    const digitos = input.texto.replace(/\D/g, '')
    const meus = !ehGestor(ctx.user)
    const cl = await db
      .select({
        id: clientes.id,
        nome: clientes.razaoSocial,
        telefone: clientes.telefoneWhatsapp,
        cidade: clientes.cidade,
        emProspeccao: clientes.emProspeccao,
        vendedorId: clientes.vendedorAtualId,
        vendedorNome: users.name,
      })
      .from(clientes)
      .leftJoin(users, eq(users.id, clientes.vendedorAtualId))
      .where(
        and(
          eq(clientes.empresaId, ctx.empresaId),
          isNull(clientes.deletedAt),
          sql`${clientes.razaoSocial} not like '%consumidor final%'`,
          meus ? eq(clientes.vendedorAtualId, ctx.user.id) : undefined,
          or(
            like(clientes.razaoSocial, termo),
            like(clientes.nomeContato, termo),
            like(clientes.codigo, termo),
            digitos.length >= 4 ? like(clientes.telefoneWhatsapp, `%${digitos}%`) : undefined,
            digitos.length >= 4 ? like(clientes.cnpj, `%${digitos}%`) : undefined,
            digitos.length >= 4 ? like(clientes.cpf, `%${digitos}%`) : undefined
          )
        )
      )
      .limit(15)
    const ld = await db
      .select({
        id: leads.id,
        nome: leads.name,
        ddd: leads.ddd,
        phone: leads.phone,
        cidade: leads.city,
        status: leads.status,
        convertidoParaClienteId: leads.convertidoParaClienteId,
        vendedorId: leads.vendorId,
        vendedorNome: users.name,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.vendorId))
      .where(
        and(
          eq(leads.empresaId, ctx.empresaId),
          isNull(leads.deletedAt),
          meus ? eq(leads.vendorId, ctx.user.id) : undefined,
          or(like(leads.name, termo), digitos.length >= 4 ? like(sql`coalesce(${leads.ddd}, '') || coalesce(${leads.phone}, '')`, `%${digitos}%`) : undefined)
        )
      )
      .orderBy(desc(leads.id))
      .limit(15)
    // Serviços abertos de cada um (aviso de "já tem serviço aberto").
    const abertos = await db
      .select({ clienteId: servicos.clienteId, leadId: servicos.leadId })
      .from(servicos)
      .where(and(eq(servicos.empresaId, ctx.empresaId), isNull(servicos.deletedAt), inArray(servicos.status, ['montando_orcamento', 'aguardando_cliente', 'em_andamento'])))
    const abertoCliente = new Set(abertos.map((a) => a.clienteId).filter(Boolean))
    const abertoLead = new Set(abertos.map((a) => a.leadId).filter(Boolean))
    return [
      ...cl.map((c) => ({
        chave: `c${c.id}`,
        origem: (c.emProspeccao ? 'prospeccao' : 'carteira') as 'prospeccao' | 'carteira',
        clienteId: c.id as number | null,
        leadId: null as number | null,
        nome: c.nome,
        telefone: c.telefone,
        cidade: c.cidade,
        vendedorId: c.vendedorId,
        vendedorNome: c.vendedorNome,
        servicoAberto: abertoCliente.has(c.id),
      })),
      ...ld.map((l) => ({
        chave: `l${l.id}`,
        origem: 'marketing' as const,
        clienteId: l.convertidoParaClienteId,
        leadId: l.id as number | null,
        nome: l.nome,
        telefone: `${l.ddd ?? ''}${l.phone ?? ''}` || null,
        cidade: l.cidade,
        vendedorId: l.vendedorId,
        vendedorNome: l.vendedorNome,
        servicoAberto: abertoLead.has(l.id),
      })),
    ]
  }),

  /** Abre o "Novo serviço" já com o cliente/lead (botão no card do Kanban, no lead e na prospecção). */
  origemPorId: protectedProcedure.input(z.object({ clienteId: z.number().optional(), leadId: z.number().optional() })).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    if (input.leadId) {
      const l = await db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt)) })
      if (!l) return null
      return { chave: `l${l.id}`, origem: 'marketing' as const, clienteId: l.convertidoParaClienteId, leadId: l.id as number | null, nome: l.name, telefone: `${l.ddd ?? ''}${l.phone ?? ''}` || null, cidade: l.city, vendedorId: l.vendorId, vendedorNome: null as string | null, servicoAberto: false }
    }
    if (input.clienteId) {
      const c = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId), isNull(clientes.deletedAt)) })
      if (!c) return null
      return { chave: `c${c.id}`, origem: (c.emProspeccao ? 'prospeccao' : 'carteira') as 'prospeccao' | 'carteira' | 'marketing', clienteId: c.id as number | null, leadId: null as number | null, nome: c.razaoSocial, telefone: c.telefoneWhatsapp, cidade: c.cidade, vendedorId: c.vendedorAtualId, vendedorNome: null as string | null, servicoAberto: false }
    }
    return null
  }),

  vendedores: protectedProcedure.query(async ({ ctx }) => {
    await assertEmpresa(ctx.empresaId)
    return db
      .select({ id: users.id, nome: users.name })
      .from(users)
      .where(and(eq(users.empresaId, ctx.empresaId), eq(users.isActive, true), eq(users.role, 'vendor')))
      .orderBy(users.name)
  }),

  criar: protectedProcedure
    .input(
      z.object({
        origem: z.enum(['carteira', 'marketing', 'prospeccao', 'avulso']),
        clienteId: z.number().nullable().optional(),
        leadId: z.number().nullable().optional(),
        clienteNome: z.string().max(200).optional(),
        vendedorId: z.number().optional(),
        ...camposEditaveis,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx.empresaId)
      if (!input.manutencao && !input.redeAr && !input.instalacao) throw new Error('Marque o que vai ser feito: manutenção, rede de ar e/ou instalação')
      let nome = input.clienteNome?.trim() ?? ''
      let telefone = input.telefone?.trim() || null
      let clienteId: number | null = null
      let leadId: number | null = null
      let vendedorDoCadastro: number | null = null
      if (input.clienteId) {
        const c = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId)) })
        if (!c || c.deletedAt) throw new Error('Cliente não encontrado')
        if (/consumidor final/i.test(c.razaoSocial)) throw new Error('Escolha o cliente de verdade — CONSUMIDOR FINAL não pode ter serviço')
        if (!ehGestor(ctx.user) && c.vendedorAtualId && c.vendedorAtualId !== ctx.user.id) throw new Error('Este cliente é da carteira de outro vendedor')
        clienteId = c.id
        nome = nome || c.razaoSocial
        telefone = telefone || c.telefoneWhatsapp
        vendedorDoCadastro = c.vendedorAtualId
      }
      if (input.leadId) {
        const l = await db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), eq(leads.empresaId, ctx.empresaId)) })
        if (!l || l.deletedAt) throw new Error('Lead não encontrado')
        if (!ehGestor(ctx.user) && l.vendorId && l.vendorId !== ctx.user.id) throw new Error('Este lead é de outro vendedor')
        leadId = l.id
        clienteId = clienteId ?? l.convertidoParaClienteId
        nome = nome || l.name
        telefone = telefone || `${l.ddd ?? ''}${l.phone ?? ''}` || null
        vendedorDoCadastro = vendedorDoCadastro ?? l.vendorId
      }
      if (nome.length < 2) throw new Error('Informe o cliente')
      const vendedorId = ehGestor(ctx.user) ? (input.vendedorId ?? vendedorDoCadastro ?? (ctx.user.role === 'vendor' ? ctx.user.id : null)) : ctx.user.id
      if (!vendedorId) throw new Error('Escolha o vendedor responsável')
      const [s] = await db
        .insert(servicos)
        .values({
          empresaId: ctx.empresaId,
          vendedorId,
          clienteId,
          leadId,
          origem: input.origem,
          clienteNome: nome,
          telefone,
          manutencao: input.manutencao,
          redeAr: input.redeAr,
          instalacao: input.instalacao,
          compressor: input.compressor?.trim() || null,
          descricao: input.descricao?.trim() || null,
          endereco: input.endereco?.trim() || null,
          valorMaoObra: input.valorMaoObra ?? null,
          valorMaterial: input.valorMaterial ?? null,
          dataExecucao: input.dataExecucao ?? null,
          status: 'montando_orcamento',
          statusDesde: agoraSqlite(),
          prazoOrcamento: prazoUmDiaUtil(),
          criadoPor: ctx.user.id,
        })
        .returning()
      await registrarEvento(s.id, ctx.user.id, 'criado', { statusPara: 'montando_orcamento', texto: `Serviço aberto (${tiposDoServico(s).join(' + ')}) — origem ${input.origem}` })
      await sincronizarAgenda(s)
      return { id: s.id }
    }),

  atualizar: protectedProcedure
    .input(z.object({ id: z.number(), vendedorId: z.number().optional(), clienteNome: z.string().min(2).max(200).optional(), ...camposEditaveis }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx.empresaId)
      const s = await assertServico(input.id, ctx.empresaId, ctx.user)
      if (s.status === 'finalizado' && !ctx.user.superAdmin) throw new Error('Serviço finalizado já virou venda — não dá mais para editar')
      if (!input.manutencao && !input.redeAr && !input.instalacao) throw new Error('Marque pelo menos um: manutenção, rede de ar ou instalação')
      const novo = {
        manutencao: input.manutencao,
        redeAr: input.redeAr,
        instalacao: input.instalacao,
        compressor: input.compressor?.trim() || null,
        descricao: input.descricao?.trim() || null,
        endereco: input.endereco?.trim() || null,
        telefone: input.telefone?.trim() || null,
        valorMaoObra: input.valorMaoObra ?? null,
        valorMaterial: input.valorMaterial ?? null,
        dataExecucao: input.dataExecucao ?? null,
        clienteNome: input.clienteNome?.trim() || s.clienteNome,
        vendedorId: ehGestor(ctx.user) && input.vendedorId ? input.vendedorId : s.vendedorId,
      }
      const mudancas: string[] = []
      const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v))
      const rotulos: Record<string, string> = {
        manutencao: 'Manutenção',
        redeAr: 'Rede de ar',
        instalacao: 'Instalação',
        compressor: 'Compressor',
        descricao: 'Descrição',
        endereco: 'Endereço',
        telefone: 'Telefone',
        valorMaoObra: 'Mão de obra',
        valorMaterial: 'Material',
        dataExecucao: 'Data do serviço',
        clienteNome: 'Cliente',
        vendedorId: 'Vendedor',
      }
      for (const [k, v] of Object.entries(novo)) {
        const antes = (s as Record<string, unknown>)[k]
        if ((antes ?? null) !== (v ?? null)) mudancas.push(`${rotulos[k]}: ${fmt(antes)} → ${fmt(v)}`)
      }
      if (!mudancas.length) return { ok: true }
      await db.update(servicos).set({ ...novo, updatedAt: agoraSqlite() }).where(eq(servicos.id, s.id))
      await registrarEvento(s.id, ctx.user.id, 'edicao', { texto: mudancas.join(' · ') })
      await sincronizarAgenda(await recarregar(s.id))
      return { ok: true }
    }),

  mudarStatus: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(STATUS_SERVICO),
        observacao: z.string().max(2000).optional(),
        proximoContato: data.optional(),
        dataExecucao: data.optional(),
        motivoCategoria: z.enum(MOTIVOS_NAO_APROVOU).optional(),
        motivo: z.string().max(2000).optional(),
        // Finalizado:
        condicaoPagamento: z.string().optional(),
        numeroPedido: z.string().optional(),
        valorMaoObra: valor,
        valorMaterial: valor,
        clienteExistenteId: z.number().optional(),
        novoCliente: z.object({ razaoSocial: z.string(), cpf: z.string().optional(), cnpj: z.string().optional(), cidade: z.string().optional() }).optional(),
        confirmarOutroCliente: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const slug = await assertEmpresa(ctx.empresaId)
      const s = await assertServico(input.id, ctx.empresaId, ctx.user)
      if (s.status === input.status && input.status !== 'aguardando_cliente') throw new Error(`O serviço já está em "${STATUS_LABEL[input.status]}"`)
      if (s.status === 'finalizado') throw new Error('Serviço finalizado já virou venda na carteira — não dá para mudar a situação')

      const agora = agoraSqlite()
      const updates: Partial<typeof servicos.$inferInsert> = { status: input.status, statusDesde: agora, updatedAt: agora }
      if (s.status === 'montando_orcamento' && !s.orcamentoRespondidoEm) updates.orcamentoRespondidoEm = agora
      let textoEvento = input.observacao?.trim() || ''

      switch (input.status as StatusServico) {
        case 'montando_orcamento':
          updates.prazoOrcamento = prazoUmDiaUtil()
          updates.orcamentoRespondidoEm = null
          break
        case 'aguardando_cliente':
          if (!input.proximoContato) throw new Error('Aguardando cliente: marque a data do próximo contato')
          if (input.proximoContato < hojeBrString()) throw new Error('A data do próximo contato não pode ser no passado')
          updates.proximoContato = input.proximoContato
          textoEvento = [`Próximo contato: ${input.proximoContato.split('-').reverse().join('/')}`, textoEvento].filter(Boolean).join(' — ')
          break
        case 'em_andamento':
          if (input.dataExecucao) updates.dataExecucao = input.dataExecucao
          break
        case 'nao_aprovou': {
          const motivo = input.motivo?.trim() ?? ''
          if (!input.motivoCategoria) throw new Error('Não aprovou: escolha o motivo')
          if (motivo.length < 5) throw new Error('Não aprovou: escreva o motivo (o que o cliente disse)')
          updates.motivoNaoAprovouCategoria = input.motivoCategoria
          updates.motivoNaoAprovou = motivo
          textoEvento = motivo
          break
        }
        case 'finalizado': {
          if (!input.condicaoPagamento) throw new Error('Finalizado: informe a forma de pagamento')
          if (!input.numeroPedido?.trim()) throw new Error('Finalizado: informe o número do pedido / OS')
          if (input.valorMaoObra !== undefined) updates.valorMaoObra = input.valorMaoObra
          if (input.valorMaterial !== undefined) updates.valorMaterial = input.valorMaterial
          let clienteId = s.clienteId
          if (!clienteId && input.clienteExistenteId) {
            const c = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.clienteExistenteId), eq(clientes.empresaId, ctx.empresaId)) })
            if (!c || c.deletedAt) throw new Error('Cliente não encontrado')
            if (!ehGestor(ctx.user) && c.vendedorAtualId && c.vendedorAtualId !== ctx.user.id) throw new Error('Este cliente é da carteira de outro vendedor')
            clienteId = c.id
            if (s.leadId) {
              const l = await db.query.leads.findFirst({ where: eq(leads.id, s.leadId), columns: { convertidoParaClienteId: true } })
              if (l && !l.convertidoParaClienteId) await db.update(leads).set({ convertidoParaClienteId: c.id }).where(eq(leads.id, s.leadId))
            }
          }
          if (!clienteId && input.novoCliente) {
            clienteId = await criarClienteDoServico(s, input.novoCliente, ctx.user.id, !!input.confirmarOutroCliente && ehGestor(ctx.user))
          }
          if (!clienteId) throw new Error('Finalizado: o serviço sai com nota — escolha o cliente cadastrado ou cadastre agora')
          updates.clienteId = clienteId
          const atualizado = { ...s, ...updates } as Servico
          const r = await enviarServicoParaCarteira(atualizado, { condicaoPagamento: input.condicaoPagamento, numeroPedido: input.numeroPedido.trim() }, ctx.user.id, slug)
          updates.vendaId = r.vendaId
          updates.funilMensalId = r.funilMensalId
          updates.finalizadoEm = agora
          textoEvento = [`Virou venda na carteira (Fechado) — R$ ${valorTotal(atualizado).toFixed(2)} · ${input.condicaoPagamento} · pedido ${input.numeroPedido.trim()}`, textoEvento]
            .filter(Boolean)
            .join(' — ')
          break
        }
      }

      await db.update(servicos).set(updates).where(eq(servicos.id, s.id))
      await registrarEvento(s.id, ctx.user.id, input.status === s.status ? 'contato' : 'status', { statusDe: s.status, statusPara: input.status, texto: textoEvento || null })
      await sincronizarAgenda(await recarregar(s.id))
      return { ok: true, vendaId: updates.vendaId ?? null }
    }),

  /** Contato com o cliente sem mudar a situação (ex.: aguardando cliente → nova data). */
  registrarContato: protectedProcedure
    .input(z.object({ id: z.number(), texto: z.string().min(3).max(2000), proximoContato: data.optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx.empresaId)
      const s = await assertServico(input.id, ctx.empresaId, ctx.user)
      if (s.status === 'aguardando_cliente' && !input.proximoContato) throw new Error('Aguardando cliente: marque a data do próximo contato')
      if (input.proximoContato && input.proximoContato < hojeBrString()) throw new Error('A data do próximo contato não pode ser no passado')
      if (input.proximoContato) await db.update(servicos).set({ proximoContato: input.proximoContato, updatedAt: agoraSqlite() }).where(eq(servicos.id, s.id))
      else await db.update(servicos).set({ updatedAt: agoraSqlite() }).where(eq(servicos.id, s.id))
      await registrarEvento(s.id, ctx.user.id, 'contato', {
        texto: input.proximoContato ? `${input.texto.trim()} — próximo contato ${input.proximoContato.split('-').reverse().join('/')}` : input.texto.trim(),
      })
      await sincronizarAgenda(await recarregar(s.id))
      return { ok: true }
    }),

  // Visita (rede de ar, instalação): check-in com GPS, igual às Visitas de
  // Campo da Odin, só que resumido.
  checkin: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        objetivo: z.enum(['levantamento', 'execucao', 'retorno']),
        endereco: z.string().max(500).optional(),
        lat: z.number().nullable().optional(),
        lng: z.number().nullable().optional(),
        precisao: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx.empresaId)
      const s = await assertServico(input.id, ctx.empresaId, ctx.user)
      const aberta = await db.query.servicoVisitas.findFirst({ where: and(eq(servicoVisitas.servicoId, s.id), isNull(servicoVisitas.checkoutEm)) })
      if (aberta) throw new Error('Já tem uma visita em andamento neste serviço — faça o check-out primeiro')
      const endereco = input.endereco?.trim() || s.endereco || null
      const [v] = await db
        .insert(servicoVisitas)
        .values({
          servicoId: s.id,
          vendedorId: ctx.user.id,
          objetivo: input.objetivo,
          endereco,
          checkinEm: agoraSqlite(),
          latCheckin: input.lat ?? null,
          lngCheckin: input.lng ?? null,
          precisaoCheckinM: input.precisao ?? null,
        })
        .returning({ id: servicoVisitas.id })
      if (endereco && !s.endereco) await db.update(servicos).set({ endereco }).where(eq(servicos.id, s.id))
      const rot = { levantamento: 'levantamento / orçamento', execucao: 'execução do serviço', retorno: 'retorno' }[input.objetivo]
      await registrarEvento(s.id, ctx.user.id, 'visita', { texto: `Check-in no cliente (${rot})${input.lat == null ? ' — sem GPS' : ''}${endereco ? ` — ${endereco}` : ''}` })
      return { visitaId: v.id }
    }),

  checkout: protectedProcedure
    .input(z.object({ visitaId: z.number(), observacoes: z.string().max(2000).optional(), lat: z.number().nullable().optional(), lng: z.number().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx.empresaId)
      const v = await db.query.servicoVisitas.findFirst({ where: eq(servicoVisitas.id, input.visitaId) })
      if (!v) throw new Error('Visita não encontrada')
      const s = await assertServico(v.servicoId, ctx.empresaId, ctx.user)
      if (v.checkoutEm) throw new Error('Esta visita já teve check-out')
      const agora = agoraSqlite()
      await db
        .update(servicoVisitas)
        .set({ checkoutEm: agora, latCheckout: input.lat ?? null, lngCheckout: input.lng ?? null, observacoes: input.observacoes?.trim() || null })
        .where(eq(servicoVisitas.id, v.id))
      const min = Math.max(1, Math.round((new Date(agora.replace(' ', 'T') + 'Z').getTime() - new Date(v.checkinEm.replace(' ', 'T') + 'Z').getTime()) / 60000))
      await registrarEvento(s.id, ctx.user.id, 'visita', { texto: `Check-out — ${min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} min`} no cliente${input.observacoes?.trim() ? ` — ${input.observacoes.trim()}` : ''}` })
      return { ok: true }
    }),

  nota: protectedProcedure.input(z.object({ id: z.number(), texto: z.string().min(2).max(2000) })).mutation(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const s = await assertServico(input.id, ctx.empresaId, ctx.user)
    await registrarEvento(s.id, ctx.user.id, 'nota', { texto: input.texto.trim() })
    await db.update(servicos).set({ updatedAt: agoraSqlite() }).where(eq(servicos.id, s.id))
    return { ok: true }
  }),

  excluir: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const s = await assertServico(input.id, ctx.empresaId, ctx.user)
    if (s.status === 'finalizado') throw new Error('Serviço finalizado já virou venda — não dá para excluir')
    if (!ehGestor(ctx.user) && s.status !== 'montando_orcamento') throw new Error('Só o gestor exclui um serviço que já andou — marque "Não aprovou" com o motivo')
    await db.update(servicos).set({ deletedAt: agoraSqlite() }).where(eq(servicos.id, s.id))
    await registrarEvento(s.id, ctx.user.id, 'edicao', { texto: 'Serviço excluído' })
    await sincronizarAgenda({ ...s, status: 'nao_aprovou' })
    return { ok: true }
  }),

  /** Serviços de um cliente/lead (selo no card do Kanban e no lead). */
  doCliente: protectedProcedure.input(z.object({ clienteId: z.number().optional(), leadId: z.number().optional() })).query(async ({ ctx, input }) => {
    if (!SLUGS_SERVICOS.includes(await empresaSlug(ctx.empresaId))) return []
    if (!input.clienteId && !input.leadId) return []
    const linhas = await db.query.servicos.findMany({
      where: and(
        eq(servicos.empresaId, ctx.empresaId),
        isNull(servicos.deletedAt),
        or(input.clienteId ? eq(servicos.clienteId, input.clienteId) : undefined, input.leadId ? eq(servicos.leadId, input.leadId) : undefined)
      ),
      orderBy: desc(servicos.id),
    })
    return linhas.map((s) => ({ id: s.id, status: s.status, tipos: tiposDoServico(s), valorTotal: valorTotal(s), createdAt: s.createdAt }))
  }),
})

