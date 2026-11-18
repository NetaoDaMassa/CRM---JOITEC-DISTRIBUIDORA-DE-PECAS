import { z } from 'zod'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, cobrancaContatos, cobrancaTitulos, empresas, pabxLigacoesProcessadas, sapTitulosAbertos, users } from '../db/schema.js'
import { registrarLigacoesCobranca } from '../lib/cobrancaLigacoes.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'
import { setConfig } from '../lib/configuracoes.js'
import { diaUtilApos } from '../lib/reguaCobranca.js'
import { DIA_UTIL_CARTORIO, EMPRESAS_COBRANCA, MSG_PADRAO, atualizarCobrancas, diasUteisAposVencimento, mensagensCobranca, regrasCobranca, somarDias } from '../lib/cobrancaSap.js'

// Cobrança (financeiro, 2026-11-13) — contas a receber do SAP → régua →
// cartório → RC. Cross-empresa (Joitec, Odin Tubos, Odin Automação).
const FEATURE = 'cobranca_sap'

// created_at é UTC (datetime('now')) — o dia que vale é o de Brasília.
const diaBr = (utc: string) => new Date(new Date(`${utc.replace(' ', 'T')}Z`).getTime() - 3 * 3600_000).toISOString().slice(0, 10)

const ABA_STATUS = { cobrar: 'cobrar', cartorio: 'cartorio', rc: 'rc', pago: 'pago' } as const

export const cobrancaSapRouter = router({
  listar: featureProcedure(FEATURE)
    .input(z.object({ aba: z.enum(['cobrar', 'cartorio', 'rc', 'pago']), empresa: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        await atualizarCobrancas()
      } catch (e) {
        console.error('[cobranca] atualizar falhou', e)
      }
      // Ligações que acabaram de acontecer já entram no histórico ao abrir a tela.
      await registrarLigacoesCobranca().catch((e) => console.error('[cobranca] ligações', e))
      const hoje = hojeBrString()
      const titulos = await db
        .select()
        .from(cobrancaTitulos)
        .where(and(eq(cobrancaTitulos.status, ABA_STATUS[input.aba]), input.empresa ? eq(cobrancaTitulos.empresaSlug, input.empresa) : undefined))
        .orderBy(cobrancaTitulos.vencimento)
        .limit(input.aba === 'pago' ? 400 : 3000)
      const ids = titulos.map((t) => t.id)
      const contatosBrutos = ids.length
        ? await db
            .select({
              id: cobrancaContatos.id,
              tituloId: cobrancaContatos.tituloId,
              canal: cobrancaContatos.canal,
              tipo: cobrancaContatos.tipo,
              diaRegua: cobrancaContatos.diaRegua,
              observacao: cobrancaContatos.observacao,
              createdAt: cobrancaContatos.createdAt,
              quem: users.name,
              ligacaoId: cobrancaContatos.pabxLigacaoId,
              ligacaoEfetiva: pabxLigacoesProcessadas.efetiva,
              ligacaoGravacao: pabxLigacoesProcessadas.linkGravacao,
              printPath: cobrancaContatos.printPath,
            })
            .from(cobrancaContatos)
            .leftJoin(users, eq(users.id, cobrancaContatos.userId))
            .leftJoin(pabxLigacoesProcessadas, eq(pabxLigacoesProcessadas.id, cobrancaContatos.pabxLigacaoId))
            .where(inArray(cobrancaContatos.tituloId, ids))
            .orderBy(desc(cobrancaContatos.id))
        : []
      const contatos = contatosBrutos.map(({ ligacaoGravacao, ...c }) => ({ ...c, ligacaoPartes: (ligacaoGravacao ?? '').split('\n').filter(Boolean).length }))
      const contatosPor = new Map<number, typeof contatos>()
      for (const c of contatos) contatosPor.set(c.tituloId, [...(contatosPor.get(c.tituloId) ?? []), c])

      // Contato do cliente pelo cadastro do CRM (código do SAP).
      const codigos = [...new Set(titulos.map((t) => t.codigoCliente))]
      const cads = codigos.length
        ? await db
            .select({ codigo: clientes.codigo, codigoAntigo: clientes.codigoAntigo, empresaSlug: empresas.slug, telefone: clientes.telefoneWhatsapp, email: clientes.email, nomeContato: clientes.nomeContato, vendedor: users.name, cnpj: clientes.cnpj, cpf: clientes.cpf })
            .from(clientes)
            .innerJoin(empresas, eq(empresas.id, clientes.empresaId))
            .leftJoin(users, eq(users.id, clientes.vendedorAtualId))
            .where(and(isNull(clientes.deletedAt), or(inArray(clientes.codigo, codigos), inArray(clientes.codigoAntigo, codigos))))
        : []
      const contatoDe = (codigo: string, slug: string | null) => {
        const doCodigo = cads.filter((c) => c.codigo === codigo || c.codigoAntigo === codigo)
        const melhor = doCodigo.find((c) => c.empresaSlug === slug && (c.telefone || c.email)) ?? doCodigo.find((c) => c.telefone || c.email) ?? doCodigo[0]
        return melhor ? { telefone: melhor.telefone, email: melhor.email, nomeContato: melhor.nomeContato, vendedor: melhor.vendedor, documento: melhor.cnpj || melhor.cpf || null } : null
      }

      const grupos = new Map<string, { chave: string; codigoCliente: string; nomeCliente: string | null; empresaSlug: string | null; contato: ReturnType<typeof contatoDe>; titulos: unknown[]; total: number; cobradoHoje: boolean; retornoVencido: boolean; maiorDia: number }>()
      for (const t of titulos) {
        const k = `${t.empresaSlug}|${t.codigoCliente}`
        const g =
          grupos.get(k) ??
          ({ chave: k, codigoCliente: t.codigoCliente, nomeCliente: t.nomeCliente, empresaSlug: t.empresaSlug, contato: contatoDe(t.codigoCliente, t.empresaSlug), titulos: [], total: 0, cobradoHoje: false, retornoVencido: false, maiorDia: 0 } as const as never)
        const cs = contatosPor.get(t.id) ?? []
        const diaUtil = diasUteisAposVencimento(t.vencimento, hoje)
        const item = {
          ...t,
          diaUtil,
          cartorioPrevisto: t.status === 'cobrar' ? diaUtilApos(t.vencimento, DIA_UTIL_CARTORIO) : null,
          diasVencido: Math.round((Date.parse(hoje) - Date.parse(t.vencimento)) / 86400000),
          retornoVencido: t.status === 'cartorio' && !!t.retornoEm && t.retornoEm <= hoje,
          contatos: cs,
          diasCobrados: [...new Set(cs.filter((c) => c.tipo === 'cobranca' && c.diaRegua).map((c) => c.diaRegua!))].sort((a, b) => a - b),
        }
        g.titulos.push(item)
        g.total += t.valor
        g.maiorDia = Math.max(g.maiorDia, diaUtil)
        if (cs.some((c) => c.tipo === 'cobranca' && diaBr(c.createdAt) === hoje)) g.cobradoHoje = true
        if (item.retornoVencido) g.retornoVencido = true
        grupos.set(k, g)
      }
      const lista = [...grupos.values()]
      // A cobrar: quem ainda não foi cobrado hoje e está mais perto do cartório em cima.
      if (input.aba === 'cobrar') lista.sort((a, b) => Number(a.cobradoHoje) - Number(b.cobradoHoje) || b.maiorDia - a.maiorDia)
      if (input.aba === 'cartorio') lista.sort((a, b) => Number(b.retornoVencido) - Number(a.retornoVencido))
      return lista as {
        chave: string
        codigoCliente: string
        nomeCliente: string | null
        empresaSlug: string | null
        contato: ReturnType<typeof contatoDe>
        total: number
        cobradoHoje: boolean
        retornoVencido: boolean
        maiorDia: number
        titulos: (typeof titulos[number] & {
          diaUtil: number
          cartorioPrevisto: string | null
          diasVencido: number
          retornoVencido: boolean
          contatos: typeof contatos
          diasCobrados: number[]
        })[]
      }[]
    }),

  resumo: featureProcedure(FEATURE).query(async () => {
    const hoje = hojeBrString()
    const t = await db.select({ status: cobrancaTitulos.status, valor: cobrancaTitulos.valor, retornoEm: cobrancaTitulos.retornoEm }).from(cobrancaTitulos)
    const soma = (s: string) => t.filter((x) => x.status === s)
    const foto = await db.select({ em: sapTitulosAbertos.atualizadoEm }).from(sapTitulosAbertos).orderBy(desc(sapTitulosAbertos.atualizadoEm)).limit(1)
    return {
      cobrar: { qtd: soma('cobrar').length, valor: soma('cobrar').reduce((s, x) => s + x.valor, 0) },
      cartorio: { qtd: soma('cartorio').length, valor: soma('cartorio').reduce((s, x) => s + x.valor, 0), retornoVencido: soma('cartorio').filter((x) => x.retornoEm && x.retornoEm <= hoje).length },
      rc: { qtd: soma('rc').length, valor: soma('rc').reduce((s, x) => s + x.valor, 0) },
      fotoSapEm: foto[0]?.em ?? null,
      ...(await regrasCobranca()),
    }
  }),

  // Clique em WhatsApp / Ligação / E-mail registra a cobrança (todos os
  // títulos do cliente que estavam na tela).
  registrarContato: featureProcedure(FEATURE)
    .input(
      z.object({
        tituloIds: z.array(z.number()).min(1).max(200),
        canal: z.enum(['whatsapp', 'ligacao', 'email', 'outro']),
        tipo: z.enum(['cobranca', 'aviso_cartorio', 'retorno', 'observacao']).default('cobranca'),
        observacao: z.string().trim().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Só observação (sem ter cobrado): vai pro histórico, não conta na régua.
      if (input.tipo === 'observacao' && !input.observacao) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escreva a observação' })
      const hoje = hojeBrString()
      const ts = await db.select().from(cobrancaTitulos).where(inArray(cobrancaTitulos.id, input.tituloIds))
      for (const t of ts) {
        const dia = diasUteisAposVencimento(t.vencimento, hoje)
        await db.insert(cobrancaContatos).values({
          tituloId: t.id,
          canal: input.canal,
          tipo: input.tipo,
          diaRegua: input.tipo === 'cobranca' && dia >= 1 && dia <= 5 ? dia : null,
          observacao: input.observacao || null,
          userId: ctx.user.id,
        })
        if (input.tipo === 'aviso_cartorio' && !t.cartorioAvisoEm) await db.update(cobrancaTitulos).set({ cartorioAvisoEm: agoraSqlite() }).where(eq(cobrancaTitulos.id, t.id))
      }
      return { ok: true, registrados: ts.length }
    }),

  // Ligação pelo WhatsApp (João, 2026-11-18): só o print é obrigatório —
  // tempo e o que foi conversado são opcionais. Conta como cobrança do dia.
  registrarLigacaoWhatsapp: featureProcedure(FEATURE)
    .input(
      z.object({
        tituloIds: z.array(z.number()).min(1).max(200),
        tipo: z.enum(['cobranca', 'aviso_cartorio']).default('cobranca'),
        printPath: z.string().regex(/^\/uploads\/[^/\\]+$/, 'Anexe o print da ligação'),
        atendeu: z.boolean().default(true),
        duracaoSegundos: z.number().int().min(1).max(4 * 3600).optional(),
        observacao: z.string().trim().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const s = input.duracaoSegundos
      const tempo = s ? `, ${Math.floor(s / 60) ? `${Math.floor(s / 60)}min ` : ''}${s % 60}s` : ''
      const texto = `📱 Ligação pelo WhatsApp: ${input.atendeu ? `atendida${tempo}` : 'não atendida'} (print anexado)${input.observacao ? ` — ${input.observacao}` : ''}`
      const hoje = hojeBrString()
      const ts = await db.select().from(cobrancaTitulos).where(inArray(cobrancaTitulos.id, input.tituloIds))
      for (const t of ts) {
        const dia = diasUteisAposVencimento(t.vencimento, hoje)
        await db.insert(cobrancaContatos).values({
          tituloId: t.id,
          canal: 'ligacao',
          tipo: input.tipo,
          diaRegua: input.tipo === 'cobranca' && dia >= 1 && dia <= 5 ? dia : null,
          observacao: texto,
          userId: ctx.user.id,
          printPath: input.printPath,
        })
        if (input.tipo === 'aviso_cartorio' && !t.cartorioAvisoEm) await db.update(cobrancaTitulos).set({ cartorioAvisoEm: agoraSqlite() }).where(eq(cobrancaTitulos.id, t.id))
      }
      return { ok: true, registrados: ts.length }
    }),

  marcarPago: featureProcedure(FEATURE)
    .input(z.object({ tituloIds: z.array(z.number()).min(1).max(200), observacao: z.string().trim().max(500).optional() }))
    .mutation(async ({ input }) => {
      await db
        .update(cobrancaTitulos)
        .set({ status: 'pago', pagoEm: hojeBrString(), pagoAuto: false, observacao: input.observacao || null, atualizadoEm: agoraSqlite() })
        .where(inArray(cobrancaTitulos.id, input.tituloIds))
      return { ok: true }
    }),

  // Passou o prazo do cartório (10 dias): voltou e conferiu.
  verificarRetorno: featureProcedure(FEATURE)
    .input(z.object({ tituloIds: z.array(z.number()).min(1).max(200), resultado: z.enum(['pago', 'nao_pago']), observacao: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const hoje = hojeBrString()
      const { diasRetorno } = await regrasCobranca()
      for (const id of input.tituloIds) {
        await db.insert(cobrancaContatos).values({ tituloId: id, canal: 'outro', tipo: 'retorno', observacao: `${input.resultado === 'pago' ? 'Conferido: pago' : 'Conferido: ainda não pago'}${input.observacao ? ` — ${input.observacao}` : ''}`, userId: ctx.user.id })
      }
      await db
        .update(cobrancaTitulos)
        .set(
          input.resultado === 'pago'
            ? { status: 'pago', pagoEm: hoje, pagoAuto: false, retornoVerificadoEm: agoraSqlite(), retornoResultado: 'pago', atualizadoEm: agoraSqlite() }
            : { retornoVerificadoEm: agoraSqlite(), retornoResultado: input.observacao || 'não pago', retornoEm: somarDias(hoje, diasRetorno), atualizadoEm: agoraSqlite() }
        )
        .where(inArray(cobrancaTitulos.id, input.tituloIds))
      return { ok: true }
    }),

  mover: featureProcedure(FEATURE)
    .input(z.object({ tituloIds: z.array(z.number()).min(1).max(200), para: z.enum(['cobrar', 'cartorio', 'rc']) }))
    .mutation(async ({ input }) => {
      const hoje = hojeBrString()
      const { diasRetorno } = await regrasCobranca()
      const set =
        input.para === 'cartorio'
          ? { status: 'cartorio' as const, cartorioEm: hoje, retornoEm: somarDias(hoje, diasRetorno) }
          : input.para === 'rc'
            ? { status: 'rc' as const, rcEm: hoje }
            : { status: 'cobrar' as const, pagoEm: null, pagoAuto: false }
      await db.update(cobrancaTitulos).set({ ...set, atualizadoEm: agoraSqlite() }).where(inArray(cobrancaTitulos.id, input.tituloIds))
      return { ok: true }
    }),

  mensagens: featureProcedure(FEATURE).query(async () => ({ ...(await mensagensCobranca()), padrao: MSG_PADRAO })),

  salvarMensagens: featureProcedure(FEATURE)
    .input(z.object({ cobranca: z.string().max(3000), cartorio: z.string().max(3000), diasRetorno: z.number().int().min(1).max(90), diasRc: z.number().int().min(10).max(365) }))
    .mutation(async ({ input }) => {
      await setConfig('cobranca_msg_cobranca', input.cobranca)
      await setConfig('cobranca_msg_cartorio', input.cartorio)
      await setConfig('cobranca_dias_retorno_cartorio', input.diasRetorno)
      await setConfig('cobranca_dias_rc', input.diasRc)
      return { ok: true }
    }),

  atualizarAgora: featureProcedure(FEATURE).mutation(async () => {
    try {
      return await atualizarCobrancas()
    } catch (e) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: (e as Error).message })
    }
  }),
})

void EMPRESAS_COBRANCA
