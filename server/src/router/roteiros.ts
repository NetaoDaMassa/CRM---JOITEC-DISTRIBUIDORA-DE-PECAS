// Roteiro do dia — vendedores externos da Odin Compressores (canalVenda
// 'visitas'). Pedido do João, 2026-10-22, trava RÍGIDA:
//   1. na véspera (até o horário limite) o vendedor monta o roteiro saindo
//      de casa, com objetivo em cada parada, e envia pra aprovação;
//   2. o gestor aprova ou devolve (sem análise até o horário configurado do
//      dia, aprova sozinho);
//   3. com a trava ligada, visita só é registrada pelo roteiro aprovado
//      ("Cheguei" em uma parada) — fora dele, só com visita extra aprovada.
// Ver lib/roteiro.ts (cálculo do caminho, endereço → mapa, agendador).
import { z } from 'zod'
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, roteiros, roteiroParadas, users, visitas, propostas, clientes, compromissos, notifications } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'
import { setConfig } from '../lib/configuracoes.js'
import { notificarGestores } from '../lib/propostasGates.js'
import { painelDoDia } from '../lib/painelDoDia.js'
import {
  SLUG_ROTEIRO,
  aplicarAprovacaoAutomatica,
  configRoteiro,
  distanciaM,
  estimarRoteiro,
  geocodificar,
  localizacaoPorVisitas,
  normalizarNome,
  otimizarOrdem,
  participa,
  proximoDiaUtil,
  travaAtiva,
  vendedoresExternos,
  type Ponto,
} from '../lib/roteiro.js'
import { gerarPropostaDaVisita } from './visitas.js'

const FEATURE = 'visitas_odin'
const dataSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const dataBr = (d: string) => d.split('-').reverse().join('/')

// Fase de teste: vendedor só entra se estiver na lista de participantes.
async function assertEmpresa(ctx: { empresaId: number; user: { id: number; role: string; superAdmin?: boolean | null } }) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId) })
  if (empresa?.slug !== SLUG_ROTEIRO) throw new TRPCError({ code: 'FORBIDDEN', message: 'Roteiro disponível só pra Odin Compressores' })
  if (ctx.user.role === 'vendor' && !ctx.user.superAdmin && !participa(await configRoteiro(ctx.empresaId), ctx.user.id)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'O Roteiro do dia está em teste e ainda não foi liberado para você.' })
  }
}

// Vendedor só mexe no próprio roteiro; admin escolhe de quem.
function alvoVendedor(ctx: { user: { id: number; role: string; superAdmin?: boolean | null } }, vendedorId?: number) {
  const ehGestor = ctx.user.role === 'admin' || !!ctx.user.superAdmin
  return { vendedorId: ehGestor && vendedorId ? vendedorId : ctx.user.id, ehGestor }
}

async function casaDo(vendedorId: number): Promise<{ endereco: string | null; ponto: Ponto | null }> {
  const u = await db.query.users.findFirst({ where: eq(users.id, vendedorId), columns: { casaEndereco: true, casaLat: true, casaLng: true } })
  return { endereco: u?.casaEndereco ?? null, ponto: u?.casaLat != null && u?.casaLng != null ? { lat: u.casaLat, lng: u.casaLng } : null }
}

async function carregarRoteiro(empresaId: number, vendedorId: number, data: string) {
  return db.query.roteiros.findFirst({
    where: and(eq(roteiros.empresaId, empresaId), eq(roteiros.vendedorId, vendedorId), eq(roteiros.data, data)),
    with: {
      paradas: {
        orderBy: (p, { asc }) => [asc(p.ordem), asc(p.id)],
        with: { visitas: { columns: { id: true, nomeEmpresa: true, clienteNome: true, checkinEm: true, checkoutEm: true, resultado: true, latCheckin: true, distanciaParadaM: true, convertidoParaPropostaId: true } } },
      },
    },
  })
}

// Prazo de envio: horário limite do dia útil anterior ao roteiro (em UTC,
// pra comparar com enviadoEm, que é gravado em UTC).
function prazoEnvioUtc(data: string, horaLimite: string): string {
  const d = new Date(`${data}T12:00:00Z`)
  // dia útil anterior: volta até achar um dia cujo próximo dia útil é `data`
  do d.setUTCDate(d.getUTCDate() - 1)
  while (proximoDiaUtil(d.toISOString().slice(0, 10)) !== data)
  const local = new Date(`${d.toISOString().slice(0, 10)}T${horaLimite}:00Z`)
  return new Date(local.getTime() + 3 * 3600000).toISOString().replace('T', ' ').slice(0, 19)
}

const paradaInput = z.object({
  id: z.number().optional(),
  tipo: z.enum(['cliente', 'prospeccao']),
  nome: z.string().trim().min(1),
  endereco: z.string().nullish(),
  cidade: z.string().nullish(),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
  localizacaoFonte: z.enum(['gps_visita', 'endereco', 'cidade', 'manual']).nullish(),
  objetivo: z.string().trim(),
  motivoSugestao: z.string().nullish(),
  clienteId: z.number().nullish(),
  quantidadePrevista: z.number().int().min(1).max(50).nullish(),
})

export const roteirosRouter = router({
  // Mostra (ou não) as abas do Roteiro na tela de Visitas.
  acesso: adminOrFeatureProcedure(FEATURE).query(async ({ ctx }) => {
    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { slug: true } })
    if (empresa?.slug !== SLUG_ROTEIRO) return { vendedor: false, gestor: false }
    const ehGestor = ctx.user.role === 'admin' || !!ctx.user.superAdmin
    return { vendedor: !ehGestor && participa(await configRoteiro(ctx.empresaId), ctx.user.id), gestor: ehGestor }
  }),

  // ── Tela do vendedor ──────────────────────────────────────────────────
  obter: adminOrFeatureProcedure(FEATURE)
    .input(z.object({ data: dataSchema, vendedorId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      await assertEmpresa(ctx)
      await aplicarAprovacaoAutomatica(ctx.empresaId)
      const { vendedorId, ehGestor } = alvoVendedor(ctx, input.vendedorId)
      const [conf, casa, roteiro] = await Promise.all([configRoteiro(ctx.empresaId), casaDo(vendedorId), carregarRoteiro(ctx.empresaId, vendedorId, input.data)])
      const paradas = roteiro?.paradas ?? []
      const visiveis = paradas.filter((p) => !p.extra || p.extraStatus !== 'recusada')
      const est = estimarRoteiro(casa.ponto, visiveis, roteiro?.horaSaida ?? '08:00')
      const hoje = hojeBrString()
      return {
        roteiro: roteiro ? { ...roteiro, paradas: visiveis.map((p, i) => ({ ...p, horaPrevista: est.chegadas[i] })), paradasRecusadas: paradas.filter((p) => p.extra && p.extraStatus === 'recusada') } : null,
        estimativa: { kmTotal: est.kmTotal, horaVolta: est.horaVolta },
        casa,
        config: conf,
        travaAtiva: travaAtiva(conf, input.data),
        prazoEnvio: input.data > hoje ? prazoEnvioUtc(input.data, conf.horaLimite) : null,
        ehGestor,
        hoje,
        proximoDiaUtil: proximoDiaUtil(hoje),
      }
    }),

  // Ponto de partida = casa do vendedor (pelo endereço ou pelo GPS de agora).
  salvarCasa: adminOrFeatureProcedure(FEATURE)
    .input(z.object({ vendedorId: z.number().optional(), endereco: z.string().trim().optional(), lat: z.number().optional(), lng: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx)
      const { vendedorId } = alvoVendedor(ctx, input.vendedorId)
      let ponto: Ponto | null = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null
      if (!ponto && input.endereco) {
        const g = await geocodificar(input.endereco, null)
        if (!g || g.fonte !== 'endereco') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Não achei esse endereço no mapa. Escreva rua, número e cidade, ou use "Estou em casa agora" (GPS).' })
        ponto = g.ponto
      }
      if (!ponto) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe o endereço ou use a localização atual' })
      await db.update(users).set({ casaEndereco: input.endereco || 'Localização marcada pelo GPS', casaLat: ponto.lat, casaLng: ponto.lng }).where(and(eq(users.id, vendedorId), eq(users.empresaId, ctx.empresaId)))
      return { ok: true, ponto }
    }),

  // Endereço → ponto no mapa. Primeiro tenta o GPS de visita anterior na
  // mesma empresa (preciso), depois o OpenStreetMap.
  localizar: adminOrFeatureProcedure(FEATURE)
    .input(z.object({ nome: z.string().optional(), endereco: z.string().nullish(), cidade: z.string().nullish() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx)
      if (input.nome) {
        const porVisita = (await localizacaoPorVisitas(ctx.empresaId, [input.nome])).get(normalizarNome(input.nome))
        if (porVisita) return { lat: porVisita.lat, lng: porVisita.lng, fonte: 'gps_visita' as const }
      }
      const g = await geocodificar(input.endereco ?? null, input.cidade ?? null)
      return g ? { lat: g.ponto.lat, lng: g.ponto.lng, fonte: g.fonte } : null
    }),

  // Busca empresas pra adicionar: carteira de clientes + empresas já
  // visitadas pela equipe (com endereço e, quando tem, GPS do check-in).
  buscarLugares: adminOrFeatureProcedure(FEATURE)
    .input(z.object({ q: z.string().trim().min(2) }))
    .query(async ({ ctx, input }) => {
      await assertEmpresa(ctx)
      const termo = `%${input.q.toLowerCase()}%`
      const carteira = await db
        .select({ id: clientes.id, nome: clientes.razaoSocial, endereco: clientes.endereco, numero: clientes.numero, bairro: clientes.bairro, cidade: clientes.cidade, estado: clientes.estado })
        .from(clientes)
        .where(and(eq(clientes.empresaId, ctx.empresaId), sql`${clientes.deletedAt} is null`, sql`lower(${clientes.razaoSocial}) like ${termo}`))
        .limit(15)
      const visitadas = await db
        .select({ nome: sql<string>`coalesce(nullif(${visitas.nomeEmpresa}, ''), ${visitas.clienteNome})`, endereco: visitas.endereco, lat: visitas.latCheckin, lng: visitas.lngCheckin, data: visitas.dataVisita })
        .from(visitas)
        .where(and(eq(visitas.empresaId, ctx.empresaId), sql`lower(coalesce(nullif(${visitas.nomeEmpresa}, ''), ${visitas.clienteNome}, '')) like ${termo}`))
        .orderBy(sql`${visitas.id} desc`)
        .limit(60)
      const vistos = new Set<string>()
      const res: { nome: string; endereco: string | null; cidade: string | null; lat: number | null; lng: number | null; clienteId: number | null; origem: string }[] = []
      for (const c of carteira) {
        vistos.add(normalizarNome(c.nome))
        const end = [c.endereco, c.numero, c.bairro].filter(Boolean).join(', ') || null
        res.push({ nome: c.nome, endereco: end, cidade: [c.cidade, c.estado].filter(Boolean).join(' - ') || null, lat: null, lng: null, clienteId: c.id, origem: 'Carteira' })
      }
      for (const v of visitadas) {
        const n = normalizarNome(v.nome ?? '')
        if (!n) continue
        const ja = res.find((r) => normalizarNome(r.nome) === n)
        if (ja) {
          if (ja.lat == null && v.lat != null) Object.assign(ja, { lat: v.lat, lng: v.lng })
          if (!ja.endereco && v.endereco) ja.endereco = v.endereco
          continue
        }
        if (vistos.has(n)) continue
        vistos.add(n)
        res.push({ nome: v.nome, endereco: v.endereco, cidade: null, lat: v.lat, lng: v.lng, clienteId: null, origem: `Visitada em ${dataBr((v.data ?? '').slice(0, 10))}` })
      }
      return res.slice(0, 20)
    }),

  // Sugestões do que visitar no dia: retornos combinados, propostas
  // paradas, compromissos de visita e clientes que pararam de comprar.
  sugestoes: adminOrFeatureProcedure(FEATURE)
    .input(z.object({ data: dataSchema, vendedorId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      await assertEmpresa(ctx)
      const { vendedorId } = alvoVendedor(ctx, input.vendedorId)
      type Sug = { chave: string; nome: string; endereco: string | null; cidade: string | null; motivo: string; prioridade: number; objetivo: string; clienteId: number | null; lat?: number | null; lng?: number | null }
      const sugs: Sug[] = []
      const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86400000)

      // 1. Retornos combinados em visita (follow-up com data até o dia)
      const minhas = await db.query.visitas.findMany({
        where: and(eq(visitas.empresaId, ctx.empresaId), eq(visitas.vendedorId, vendedorId)),
        columns: { id: true, nomeEmpresa: true, clienteNome: true, endereco: true, resultado: true, dataRetorno: true, dataVisita: true, latCheckin: true, lngCheckin: true },
        orderBy: (v, { desc }) => [desc(v.dataVisita)],
      })
      const ultimaVisita = new Map<string, (typeof minhas)[number]>()
      for (const v of minhas) {
        const n = normalizarNome(v.nomeEmpresa || v.clienteNome || '')
        if (n && !ultimaVisita.has(n)) ultimaVisita.set(n, v)
      }
      for (const [n, v] of ultimaVisita) {
        if (v.resultado === 'follow_up' && v.dataRetorno && v.dataRetorno.slice(0, 10) <= input.data) {
          const atraso = diasEntre(v.dataRetorno, input.data)
          sugs.push({ chave: `ret:${n}`, nome: v.nomeEmpresa || v.clienteNome || '—', endereco: v.endereco, cidade: null, lat: v.latCheckin, lng: v.lngCheckin, clienteId: null, prioridade: 1, objetivo: 'Retorno combinado', motivo: atraso > 0 ? `Retorno combinado para ${dataBr(v.dataRetorno.slice(0, 10))} (${atraso} dia${atraso > 1 ? 's' : ''} atrasado)` : `Retorno combinado para ${dataBr(v.dataRetorno.slice(0, 10))}` })
        }
      }

      // 2. Propostas paradas (sem mexer há 7+ dias) e "chamar depois" vencidos
      const props = await db.query.propostas.findMany({
        where: and(eq(propostas.empresaId, ctx.empresaId), eq(propostas.vendedorId, vendedorId), inArray(propostas.stage, ['proposta', 'negociacao', 'chamar_depois'])),
        columns: { id: true, clienteNome: true, stage: true, updatedAt: true, dataRetorno: true },
      })
      for (const p of props) {
        const n = normalizarNome(p.clienteNome)
        if (!n || sugs.some((s) => s.chave.endsWith(`:${n}`))) continue
        const v = ultimaVisita.get(n)
        if (p.stage === 'chamar_depois') {
          if (!p.dataRetorno || p.dataRetorno.slice(0, 10) > input.data) continue
          sugs.push({ chave: `prop:${n}`, nome: p.clienteNome, endereco: v?.endereco ?? null, cidade: null, lat: v?.latCheckin, lng: v?.lngCheckin, clienteId: null, prioridade: 2, objetivo: 'Retomar proposta', motivo: `Proposta #${p.id}: chamar de novo em ${dataBr(p.dataRetorno.slice(0, 10))}` })
        } else {
          const parada = diasEntre(p.updatedAt, input.data)
          if (parada < 7) continue
          sugs.push({ chave: `prop:${n}`, nome: p.clienteNome, endereco: v?.endereco ?? null, cidade: null, lat: v?.latCheckin, lng: v?.lngCheckin, clienteId: null, prioridade: 2 + Math.min(parada, 90) / 1000, objetivo: 'Fechar proposta', motivo: `Proposta #${p.id} parada há ${parada} dias` })
        }
      }

      // 3. Compromissos de visita marcados pro dia
      const comps = await db.query.compromissos.findMany({
        where: and(eq(compromissos.vendedorId, vendedorId), eq(compromissos.tipo, 'visita'), eq(compromissos.concluido, false), sql`${compromissos.deletedAt} is null`, gte(compromissos.dataHora, `${input.data} 00:00`), lte(compromissos.dataHora, `${input.data} 23:59:59`)),
        with: { cliente: { columns: { id: true, razaoSocial: true, endereco: true, numero: true, cidade: true, estado: true } } },
      })
      for (const c of comps) {
        const nome = c.cliente?.razaoSocial ?? c.titulo
        sugs.push({ chave: `comp:${c.id}`, nome, endereco: c.cliente ? [c.cliente.endereco, c.cliente.numero].filter(Boolean).join(', ') || null : null, cidade: c.cliente ? [c.cliente.cidade, c.cliente.estado].filter(Boolean).join(' - ') || null : null, clienteId: c.cliente?.id ?? null, prioridade: 0, objetivo: c.titulo, motivo: `Compromisso marcado às ${c.dataHora.slice(11, 16)}` })
      }

      // 4. Clientes da carteira que pararam de comprar (60 a 365 dias)
      try {
        const painel = await painelDoDia(ctx.empresaId, { vendedorId })
        const ids = painel.urgencias.pararamDeComprar.slice(0, 40)
        if (ids.length) {
          const cs = await db.query.clientes.findMany({ where: inArray(clientes.id, ids), columns: { id: true, razaoSocial: true, endereco: true, numero: true, cidade: true, estado: true } })
          for (const c of cs) {
            const n = normalizarNome(c.razaoSocial)
            if (sugs.some((s) => s.chave.endsWith(`:${n}`))) continue
            sugs.push({ chave: `parou:${n}`, nome: c.razaoSocial, endereco: [c.endereco, c.numero].filter(Boolean).join(', ') || null, cidade: [c.cidade, c.estado].filter(Boolean).join(' - ') || null, clienteId: c.id, prioridade: 3, objetivo: 'Recuperar cliente', motivo: 'Parou de comprar (mais de 60 dias sem compra)' })
          }
        }
      } catch (err) {
        console.error('[roteiro] sugestões: falha ao buscar clientes parados', err)
      }

      // Completa a localização com o GPS de visitas anteriores da equipe.
      const semPonto = sugs.filter((s) => s.lat == null)
      const gps = await localizacaoPorVisitas(ctx.empresaId, semPonto.map((s) => s.nome))
      for (const s of semPonto) {
        const g = gps.get(normalizarNome(s.nome))
        if (g) Object.assign(s, { lat: g.lat, lng: g.lng, endereco: s.endereco ?? g.endereco })
      }
      return sugs.sort((a, b) => a.prioridade - b.prioridade).slice(0, 30)
    }),

  // Melhor ordem + estimativa (km/horários) — sem gravar. Usado pela tela
  // enquanto o vendedor monta.
  calcular: adminOrFeatureProcedure(FEATURE)
    .input(
      z.object({
        vendedorId: z.number().optional(),
        horaSaida: z.string().regex(/^\d{2}:\d{2}$/),
        otimizar: z.boolean(),
        paradas: z.array(z.object({ chave: z.string(), lat: z.number().nullish(), lng: z.number().nullish(), tipo: z.enum(['cliente', 'prospeccao']), quantidadePrevista: z.number().nullish(), fixa: z.boolean().optional() })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { vendedorId } = alvoVendedor(ctx, input.vendedorId)
      const casa = (await casaDo(vendedorId)).ponto
      const norm = input.paradas.map((p) => ({ ...p, lat: p.lat ?? null, lng: p.lng ?? null, quantidadePrevista: p.quantidadePrevista ?? null }))
      // Paradas já visitadas/puladas ficam no lugar (início), só o resto é reordenado.
      const fixas = norm.filter((p) => p.fixa)
      const livres = norm.filter((p) => !p.fixa)
      const ordem = input.otimizar ? [...fixas, ...otimizarOrdem(fixas.length && fixas[fixas.length - 1].lat != null ? (fixas[fixas.length - 1] as Ponto) : casa, livres)] : norm
      const est = estimarRoteiro(casa, ordem, input.horaSaida)
      return { ordem: ordem.map((p) => p.chave), chegadas: est.chegadas, kmTotal: est.kmTotal, horaVolta: est.horaVolta }
    }),

  // Grava o roteiro (rascunho). Vendedor só edita rascunho/devolvido/enviado
  // (enviado volta pra rascunho e precisa reenviar); aprovado só o gestor —
  // no dia, o vendedor usa "pular parada" e "pedir visita extra".
  salvar: adminOrFeatureProcedure(FEATURE)
    .input(z.object({ data: dataSchema, vendedorId: z.number().optional(), horaSaida: z.string().regex(/^\d{2}:\d{2}$/), paradas: z.array(paradaInput) }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx)
      const { vendedorId, ehGestor } = alvoVendedor(ctx, input.vendedorId)
      if (!ehGestor && input.data < hojeBrString()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Não dá para mudar roteiro de dia que já passou' })
      let roteiro = await db.query.roteiros.findFirst({ where: and(eq(roteiros.vendedorId, vendedorId), eq(roteiros.data, input.data)) })
      if (roteiro && roteiro.empresaId !== ctx.empresaId) throw new TRPCError({ code: 'FORBIDDEN' })
      if (roteiro?.status === 'aprovado' && !ehGestor) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Roteiro já aprovado. Para mudar no dia, use "Pular" ou "Pedir visita extra".' })

      const casa = (await casaDo(vendedorId)).ponto
      const est = estimarRoteiro(casa, input.paradas.map((p) => ({ lat: p.lat ?? null, lng: p.lng ?? null, tipo: p.tipo, quantidadePrevista: p.quantidadePrevista ?? null })), input.horaSaida)
      // Gestor mexendo não muda o status (nem tira da fila de aprovação);
      // vendedor mexendo volta pra rascunho e precisa reenviar.
      const novoStatus = ehGestor && roteiro ? roteiro.status : 'rascunho'
      if (!roteiro) {
        const r = await db.insert(roteiros).values({ empresaId: ctx.empresaId, vendedorId, data: input.data, horaSaida: input.horaSaida, kmPrevisto: est.kmTotal })
        roteiro = (await db.query.roteiros.findFirst({ where: eq(roteiros.id, Number(r.lastInsertRowid)) }))!
      } else {
        await db.update(roteiros).set({ horaSaida: input.horaSaida, kmPrevisto: est.kmTotal, status: novoStatus, updatedAt: agoraSqlite() }).where(eq(roteiros.id, roteiro.id))
      }

      const existentes = await db.query.roteiroParadas.findMany({ where: eq(roteiroParadas.roteiroId, roteiro.id), with: { visitas: { columns: { id: true } } } })
      const manter = new Set(input.paradas.map((p) => p.id).filter(Boolean))
      for (const e of existentes) {
        if (manter.has(e.id)) continue
        if (e.visitas.length) throw new TRPCError({ code: 'BAD_REQUEST', message: `"${e.nome}" já tem visita registrada e não pode sair do roteiro` })
        await db.delete(roteiroParadas).where(eq(roteiroParadas.id, e.id))
      }
      for (const [i, p] of input.paradas.entries()) {
        const valores = {
          ordem: i,
          tipo: p.tipo,
          nome: p.nome,
          endereco: p.endereco || null,
          cidade: p.cidade || null,
          lat: p.lat ?? null,
          lng: p.lng ?? null,
          localizacaoFonte: p.localizacaoFonte ?? null,
          objetivo: p.objetivo,
          motivoSugestao: p.motivoSugestao ?? null,
          clienteId: p.clienteId ?? null,
          quantidadePrevista: p.tipo === 'prospeccao' ? p.quantidadePrevista ?? 4 : null,
        }
        if (p.id && existentes.some((e) => e.id === p.id)) await db.update(roteiroParadas).set(valores).where(eq(roteiroParadas.id, p.id))
        else await db.insert(roteiroParadas).values({ roteiroId: roteiro.id, ...valores })
      }
      return { ok: true, id: roteiro.id, status: novoStatus }
    }),

  enviar: adminOrFeatureProcedure(FEATURE)
    .input(z.object({ data: dataSchema, vendedorId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx)
      const { vendedorId } = alvoVendedor(ctx, input.vendedorId)
      const [conf, casa, roteiro] = await Promise.all([configRoteiro(ctx.empresaId), casaDo(vendedorId), carregarRoteiro(ctx.empresaId, vendedorId, input.data)])
      if (!roteiro) throw new TRPCError({ code: 'NOT_FOUND', message: 'Monte o roteiro antes de enviar' })
      if (roteiro.status === 'aprovado') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Roteiro já aprovado' })
      if (!casa.ponto) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cadastre o endereço de casa (ponto de partida) antes de enviar' })
      const paradas = roteiro.paradas.filter((p) => !p.extra)
      if (!paradas.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'O roteiro está vazio' })
      if (paradas.length < conf.minParadas) throw new TRPCError({ code: 'BAD_REQUEST', message: `O roteiro precisa ter pelo menos ${conf.minParadas} paradas (tem ${paradas.length})` })
      const semObjetivo = paradas.filter((p) => !p.objetivo.trim())
      if (semObjetivo.length) throw new TRPCError({ code: 'BAD_REQUEST', message: `Falta o objetivo da visita em: ${semObjetivo.map((p) => p.nome).join(', ')}` })
      await db.update(roteiros).set({ status: 'enviado', enviadoEm: agoraSqlite(), comentarioGestor: null, updatedAt: agoraSqlite() }).where(eq(roteiros.id, roteiro.id))
      const vendedor = await db.query.users.findFirst({ where: eq(users.id, vendedorId), columns: { name: true } })
      await notificarGestores(ctx.empresaId, 'Roteiro para aprovar', `${vendedor?.name ?? 'Vendedor'} enviou o roteiro de ${dataBr(input.data)} (${paradas.length} paradas, ~${roteiro.kmPrevisto ?? 0} km).`)
      return { ok: true }
    }),

  // ── Gestor ────────────────────────────────────────────────────────────
  aprovar: adminProcedure.input(z.object({ roteiroId: z.number() })).mutation(async ({ ctx, input }) => {
    const r = await db.query.roteiros.findFirst({ where: and(eq(roteiros.id, input.roteiroId), eq(roteiros.empresaId, ctx.empresaId)) })
    if (!r) throw new TRPCError({ code: 'NOT_FOUND' })
    await db.update(roteiros).set({ status: 'aprovado', aprovadoEm: agoraSqlite(), aprovadoPor: ctx.user.id, aprovacaoAutomatica: false, comentarioGestor: null, updatedAt: agoraSqlite() }).where(eq(roteiros.id, r.id))
    await db.insert(notifications).values({ vendedorId: r.vendedorId, title: 'Roteiro aprovado ✅', message: `Seu roteiro de ${dataBr(r.data)} foi aprovado. Boa rota!`, type: 'success' })
    return { ok: true }
  }),

  devolver: adminProcedure.input(z.object({ roteiroId: z.number(), comentario: z.string().trim().min(3) })).mutation(async ({ ctx, input }) => {
    const r = await db.query.roteiros.findFirst({ where: and(eq(roteiros.id, input.roteiroId), eq(roteiros.empresaId, ctx.empresaId)) })
    if (!r) throw new TRPCError({ code: 'NOT_FOUND' })
    await db.update(roteiros).set({ status: 'devolvido', comentarioGestor: input.comentario, updatedAt: agoraSqlite() }).where(eq(roteiros.id, r.id))
    await db.insert(notifications).values({ vendedorId: r.vendedorId, title: 'Roteiro devolvido para ajuste', message: `Roteiro de ${dataBr(r.data)}: ${input.comentario}`, type: 'warning' })
    return { ok: true }
  }),

  // ── No dia ────────────────────────────────────────────────────────────
  pedirExtra: adminOrFeatureProcedure(FEATURE)
    .input(z.object({ data: dataSchema, parada: paradaInput.omit({ id: true }), justificativa: z.string().trim().min(5, 'Explique o motivo da visita extra') }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx)
      const roteiro = await db.query.roteiros.findFirst({ where: and(eq(roteiros.empresaId, ctx.empresaId), eq(roteiros.vendedorId, ctx.user.id), eq(roteiros.data, input.data)) })
      if (!roteiro || roteiro.status !== 'aprovado') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Visita extra só depois do roteiro do dia aprovado' })
      if (!input.parada.objetivo) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe o objetivo da visita' })
      const ordem = (await db.query.roteiroParadas.findMany({ where: eq(roteiroParadas.roteiroId, roteiro.id), columns: { id: true } })).length
      const p = input.parada
      await db.insert(roteiroParadas).values({ roteiroId: roteiro.id, ordem, tipo: p.tipo, nome: p.nome, endereco: p.endereco || null, cidade: p.cidade || null, lat: p.lat ?? null, lng: p.lng ?? null, localizacaoFonte: p.localizacaoFonte ?? null, objetivo: p.objetivo, clienteId: p.clienteId ?? null, quantidadePrevista: p.tipo === 'prospeccao' ? p.quantidadePrevista ?? 4 : null, extra: true, extraStatus: 'pendente', extraJustificativa: input.justificativa })
      const vendedor = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id), columns: { name: true } })
      await notificarGestores(ctx.empresaId, 'Pedido de visita extra', `${vendedor?.name ?? 'Vendedor'} quer visitar "${p.nome}" fora do roteiro: ${input.justificativa}`, 'warning')
      return { ok: true }
    }),

  decidirExtra: adminProcedure.input(z.object({ paradaId: z.number(), aprovar: z.boolean() })).mutation(async ({ ctx, input }) => {
    const p = await db.query.roteiroParadas.findFirst({ where: eq(roteiroParadas.id, input.paradaId), with: { roteiro: true } })
    if (!p || p.roteiro.empresaId !== ctx.empresaId || !p.extra) throw new TRPCError({ code: 'NOT_FOUND' })
    await db.update(roteiroParadas).set({ extraStatus: input.aprovar ? 'aprovada' : 'recusada' }).where(eq(roteiroParadas.id, p.id))
    await db.insert(notifications).values({ vendedorId: p.roteiro.vendedorId, title: input.aprovar ? 'Visita extra liberada' : 'Visita extra recusada', message: `"${p.nome}" ${input.aprovar ? 'foi liberada, pode registrar a visita.' : 'não foi liberada pelo gestor.'}`, type: input.aprovar ? 'success' : 'warning' })
    return { ok: true }
  }),

  pularParada: adminOrFeatureProcedure(FEATURE)
    .input(z.object({ paradaId: z.number(), motivo: z.string().trim().min(3, 'Diga o motivo') }))
    .mutation(async ({ ctx, input }) => {
      const p = await db.query.roteiroParadas.findFirst({ where: eq(roteiroParadas.id, input.paradaId), with: { roteiro: true, visitas: { columns: { id: true } } } })
      if (!p || p.roteiro.empresaId !== ctx.empresaId) throw new TRPCError({ code: 'NOT_FOUND' })
      const { ehGestor } = alvoVendedor(ctx)
      if (!ehGestor && p.roteiro.vendedorId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN' })
      if (p.tipo === 'cliente' && p.visitas.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Essa parada já tem visita registrada' })
      await db.update(roteiroParadas).set({ status: 'pulada', motivoPulo: input.motivo }).where(eq(roteiroParadas.id, p.id))
      return { ok: true }
    }),

  // "Cheguei": cria a visita ligada à parada, com check-in e GPS. Em área de
  // prospecção, cada empresa visitada ali é uma visita (nome digitado na hora).
  chegar: adminOrFeatureProcedure(FEATURE)
    .input(z.object({ paradaId: z.number(), lat: z.number().optional(), lng: z.number().optional(), nomeEmpresa: z.string().trim().optional(), pessoaContato: z.string().optional(), telefoneContato: z.string().optional(), endereco: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx)
      const p = await db.query.roteiroParadas.findFirst({ where: eq(roteiroParadas.id, input.paradaId), with: { roteiro: true, visitas: { columns: { id: true, checkoutEm: true } } } })
      if (!p || p.roteiro.empresaId !== ctx.empresaId) throw new TRPCError({ code: 'NOT_FOUND' })
      if (p.roteiro.vendedorId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só o próprio vendedor registra a chegada' })
      if (p.roteiro.data !== hojeBrString()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esse roteiro não é de hoje' })
      if (p.roteiro.status !== 'aprovado') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Seu roteiro de hoje ainda não foi aprovado' })
      if (p.extra && p.extraStatus !== 'aprovada') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Essa visita extra ainda não foi liberada pelo gestor' })
      if (p.status === 'pulada') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Essa parada foi marcada como pulada' })
      if (p.tipo === 'cliente' && p.visitas.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Você já registrou a chegada nessa parada' })
      // Uma visita por vez no roteiro inteiro (não só nesta parada).
      const idsParadas = (await db.query.roteiroParadas.findMany({ where: eq(roteiroParadas.roteiroId, p.roteiroId), columns: { id: true } })).map((x) => x.id)
      const aberta = await db.query.visitas.findFirst({ where: and(inArray(visitas.roteiroParadaId, idsParadas), isNull(visitas.checkoutEm)), columns: { nomeEmpresa: true } })
      if (aberta) throw new TRPCError({ code: 'BAD_REQUEST', message: `Finalize a visita em andamento (${aberta.nomeEmpresa ?? 'outra parada'}) antes de começar outra` })
      const nome = p.tipo === 'prospeccao' ? input.nomeEmpresa : p.nome
      if (!nome) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe o nome da empresa visitada' })

      const temGps = input.lat != null && input.lng != null
      const distancia = temGps && p.lat != null && p.lng != null && p.tipo === 'cliente' && p.localizacaoFonte !== 'cidade' ? Math.round(distanciaM({ lat: input.lat!, lng: input.lng! }, { lat: p.lat, lng: p.lng })) : null
      // dataVisita é hora de parede de Brasília (padrão do módulo de Visitas).
      const agoraBr = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 16)
      const r = await db.insert(visitas).values({
        empresaId: ctx.empresaId,
        vendedorId: ctx.user.id,
        dataVisita: agoraBr,
        clienteNome: nome,
        nomeEmpresa: nome,
        pessoaContato: input.pessoaContato || null,
        telefoneContato: input.telefoneContato || null,
        endereco: input.endereco || (p.tipo === 'cliente' ? p.endereco : null),
        objetivo: p.objetivo,
        planejada: !p.extra,
        checkinEm: agoraSqlite(),
        latCheckin: temGps ? input.lat : null,
        lngCheckin: temGps ? input.lng : null,
        roteiroParadaId: p.id,
        distanciaParadaM: distancia,
      })
      // Primeira vez que alguém confirma o lugar pelo GPS: melhora o ponto da parada.
      if (temGps && p.tipo === 'cliente' && (p.lat == null || p.localizacaoFonte === 'cidade')) {
        await db.update(roteiroParadas).set({ lat: input.lat, lng: input.lng, localizacaoFonte: 'gps_visita' }).where(eq(roteiroParadas.id, p.id))
      }
      return { visitaId: Number(r.lastInsertRowid), distanciaM: distancia }
    }),

  // Check-out obrigatório com o resultado da visita — fecha a parada.
  finalizar: adminOrFeatureProcedure(FEATURE)
    .input(
      z.object({
        visitaId: z.number(),
        resultado: z.enum(['gerar_proposta', 'follow_up', 'sem_interesse', 'nao_encontrado']),
        pessoaContato: z.string().optional(),
        telefoneContato: z.string().optional(),
        proximoPasso: z.string().optional(),
        dataRetorno: z.string().optional(),
        observacoes: z.string().optional(),
        propostaItens: z.string().optional(),
        propostaPagamento: z.string().optional(),
        propostaComissao: z.string().optional(),
        propostaRevenda: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { visitaId, ...dados } = input
      const v = await db.query.visitas.findFirst({ where: and(eq(visitas.id, visitaId), eq(visitas.empresaId, ctx.empresaId)) })
      if (!v || !v.roteiroParadaId) throw new TRPCError({ code: 'NOT_FOUND' })
      if (v.vendedorId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN' })
      if (dados.resultado === 'follow_up' && !dados.dataRetorno) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe a data de retorno' })
      const limpo = Object.fromEntries(Object.entries(dados).filter(([, x]) => x !== undefined && x !== ''))
      await db.update(visitas).set({ ...limpo, checkoutEm: v.checkoutEm ?? agoraSqlite(), updatedAt: agoraSqlite() }).where(eq(visitas.id, v.id))
      await db.update(roteiroParadas).set({ status: 'visitada' }).where(eq(roteiroParadas.id, v.roteiroParadaId))
      let propostaId: number | undefined
      if (dados.resultado === 'gerar_proposta' && !v.convertidoParaPropostaId) {
        const atualizada = await db.query.visitas.findFirst({ where: eq(visitas.id, v.id) })
        if (atualizada) propostaId = await gerarPropostaDaVisita(atualizada, ctx.empresaId, ctx.user.id)
      }
      return { ok: true, propostaId }
    }),

  // ── Painel do gestor: todos os vendedores externos num dia ──────────────
  painelEquipe: adminProcedure.input(z.object({ data: dataSchema })).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx)
    await aplicarAprovacaoAutomatica(ctx.empresaId)
    const [conf, vendedores] = await Promise.all([configRoteiro(ctx.empresaId), vendedoresExternos(ctx.empresaId)])
    const lista = await db.query.roteiros.findMany({
      where: and(eq(roteiros.empresaId, ctx.empresaId), eq(roteiros.data, input.data)),
      with: { paradas: { orderBy: (p, { asc }) => [asc(p.ordem)], with: { visitas: { columns: { id: true, nomeEmpresa: true, checkinEm: true, checkoutEm: true, resultado: true, distanciaParadaM: true, latCheckin: true } } } } },
    })
    const prazo = prazoEnvioUtc(input.data, conf.horaLimite)
    const ids = new Set(vendedores.map((v) => v.id))
    const extras = lista.filter((r) => !ids.has(r.vendedorId))
    const nomesExtras = extras.length ? await db.query.users.findMany({ where: inArray(users.id, extras.map((r) => r.vendedorId)), columns: { id: true, name: true, casaLat: true, casaLng: true, casaEndereco: true } }) : []
    const candidatos = await db.query.users.findMany({
      where: and(eq(users.empresaId, ctx.empresaId), eq(users.role, 'vendor'), eq(users.isActive, true)),
      columns: { id: true, name: true },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    return {
      config: conf,
      candidatos,
      travaAtiva: travaAtiva(conf, input.data),
      prazo,
      vendedores: [...vendedores, ...nomesExtras].map((v) => {
        const r = lista.find((x) => x.vendedorId === v.id) ?? null
        const paradas = r?.paradas.filter((p) => !p.extra || p.extraStatus !== 'recusada') ?? []
        const planejadas = paradas.filter((p) => !p.extra)
        const emAndamento = paradas.flatMap((p) => p.visitas.filter((x) => x.checkinEm && !x.checkoutEm).map(() => p.nome))[0] ?? null
        return {
          vendedorId: v.id,
          nome: v.name,
          casa: v.casaLat != null && v.casaLng != null ? { lat: v.casaLat, lng: v.casaLng } : null,
          temCasa: v.casaLat != null,
          roteiro: r ? { id: r.id, status: r.status, enviadoEm: r.enviadoEm, noPrazo: !!r.enviadoEm && !!prazo && r.enviadoEm <= prazo, aprovacaoAutomatica: r.aprovacaoAutomatica, kmPrevisto: r.kmPrevisto, horaSaida: r.horaSaida, comentarioGestor: r.comentarioGestor } : null,
          paradas,
          totais: {
            planejadas: planejadas.length,
            // base do % feito: paradas do roteiro + extras liberadas
            total: paradas.filter((p) => !p.extra || p.extraStatus === 'aprovada').length,
            visitadas: paradas.filter((p) => p.status === 'visitada').length,
            puladas: paradas.filter((p) => p.status === 'pulada').length,
            extrasPendentes: paradas.filter((p) => p.extra && p.extraStatus === 'pendente').length,
            visitas: paradas.reduce((s, p) => s + p.visitas.length, 0),
          },
          emAndamento,
        }
      }),
    }
  }),

  // ── Planejado x realizado (período) ──────────────────────────────────
  relatorio: adminProcedure.input(z.object({ de: dataSchema, ate: dataSchema })).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx)
    const conf = await configRoteiro(ctx.empresaId)
    const lista = await db.query.roteiros.findMany({
      where: and(eq(roteiros.empresaId, ctx.empresaId), gte(roteiros.data, input.de), lte(roteiros.data, input.ate)),
      with: { vendedor: { columns: { id: true, name: true } }, paradas: { with: { visitas: { columns: { checkinEm: true, checkoutEm: true, resultado: true, distanciaParadaM: true, latCheckin: true } } } } },
    })
    const porVendedor = new Map<number, { vendedorId: number; nome: string; roteiros: number; noPrazo: number; automaticos: number; devolvidos: number; planejadas: number; visitadas: number; puladas: number; extras: number; visitas: number; minutos: number[]; km: number; resultados: Record<string, number>; longe: number; semGps: number; motivosPulo: Record<string, number> }>()
    for (const r of lista) {
      if (r.status === 'rascunho') continue
      const linha = porVendedor.get(r.vendedorId) ?? { vendedorId: r.vendedorId, nome: r.vendedor.name, roteiros: 0, noPrazo: 0, automaticos: 0, devolvidos: 0, planejadas: 0, visitadas: 0, puladas: 0, extras: 0, visitas: 0, minutos: [], km: 0, resultados: {}, longe: 0, semGps: 0, motivosPulo: {} }
      porVendedor.set(r.vendedorId, linha)
      linha.roteiros++
      if (r.enviadoEm && r.enviadoEm <= prazoEnvioUtc(r.data, conf.horaLimite)) linha.noPrazo++
      if (r.aprovacaoAutomatica) linha.automaticos++
      if (r.status === 'devolvido') linha.devolvidos++
      linha.km += r.kmPrevisto ?? 0
      for (const p of r.paradas) {
        if (p.extra) {
          if (p.extraStatus === 'aprovada') linha.extras++
          else continue
        } else linha.planejadas++
        if (p.status === 'visitada') linha.visitadas++
        if (p.status === 'pulada') {
          linha.puladas++
          const m = (p.motivoPulo ?? 'Sem motivo').trim()
          linha.motivosPulo[m] = (linha.motivosPulo[m] ?? 0) + 1
        }
        for (const v of p.visitas) {
          linha.visitas++
          if (v.resultado) linha.resultados[v.resultado] = (linha.resultados[v.resultado] ?? 0) + 1
          if (v.checkinEm && v.checkoutEm) linha.minutos.push((Date.parse(v.checkoutEm.replace(' ', 'T') + 'Z') - Date.parse(v.checkinEm.replace(' ', 'T') + 'Z')) / 60000)
          if (v.latCheckin == null) linha.semGps++
          else if ((v.distanciaParadaM ?? 0) > 300) linha.longe++
        }
      }
    }
    return [...porVendedor.values()]
      .map(({ minutos, ...l }) => ({ ...l, km: Math.round(l.km), cumprimento: l.planejadas ? Math.round((l.visitadas / (l.planejadas + l.extras)) * 100) : 0, tempoMedioMin: minutos.length ? Math.round(minutos.reduce((s, x) => s + x, 0) / minutos.length) : null }))
      .sort((a, b) => b.cumprimento - a.cumprimento)
  }),

  salvarConfig: adminProcedure
    .input(z.object({ travaDesde: dataSchema.nullable(), horaLimite: z.string().regex(/^\d{2}:\d{2}$/), autoAprovarHora: z.string().regex(/^\d{2}:\d{2}$/).nullable(), minParadas: z.number().int().min(0).max(30), participantes: z.array(z.number().int().positive()).max(50) }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx)
      await setConfig(`roteiro_trava_desde_${ctx.empresaId}`, input.travaDesde ?? '')
      await setConfig(`roteiro_hora_limite_${ctx.empresaId}`, input.horaLimite)
      await setConfig(`roteiro_auto_aprovar_hora_${ctx.empresaId}`, input.autoAprovarHora ?? '')
      await setConfig(`roteiro_min_paradas_${ctx.empresaId}`, input.minParadas)
      await setConfig(`roteiro_participantes_${ctx.empresaId}`, input.participantes.join(','))
      return { ok: true }
    }),
})
