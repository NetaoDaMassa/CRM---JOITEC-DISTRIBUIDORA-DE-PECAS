import { z } from 'zod'
import { and, desc, eq, gte, inArray, isNotNull, lte, max, sql } from 'drizzle-orm'
import { router, protectedProcedure, superAdminProcedure, temFeature } from './_base.js'
import { db } from '../db/client.js'
import { clientes, contasVinculadas, empresas, funilMensal, gotoRamais, leads, pabxLigacoesProcessadas, pabxRamais, registroContato, users } from '../db/schema.js'
import { getConfigBool, getConfigNumero, getConfigTexto, setConfig } from '../lib/configuracoes.js'
import { agoraSqlite, contarDiasUteis, hojeBrString } from '../lib/dataBr.js'
import {
  SLUGS_EMPRESAS_PABX,
  buscarChamadasPabxone360,
  discarPabx,
  lerCredenciaisPabx,
  listarRamaisPabx,
  registrarLigacoesAutomaticasPabxone360,
} from '../lib/pabxone360.js'
import { acompanharLigacao } from '../lib/pabxAcompanhamento.js'

// Telefonia PABXONE360 das 3 empresas Odin (uma conta só) — ver o cabeçalho
// de lib/pabxone360.ts. Configuração e ramais: só superAdmin (o token nunca
// volta pra tela, só "configurado"). Relatório: admin com a permissão
// `relatorio_ligacoes` vê a empresa; vendedor vê só as próprias ligações.
const FEATURE_RELATORIO = 'relatorio_ligacoes'

async function credenciaisOuErro() {
  const cred = await lerCredenciaisPabx()
  if (!cred) throw new Error('Usuário/token da PABXONE360 ainda não configurados (Telefonia → Configuração)')
  return cred
}

// Datas da tela vêm como YYYY-MM-DD de Brasília — vira Date em UTC certo.
function inicioDiaBr(data: string) {
  return new Date(`${data}T03:00:00Z`)
}
function fimDiaBr(data: string) {
  return new Date(new Date(`${data}T03:00:00Z`).getTime() + 24 * 3600e3 - 1000)
}
const paraSqlite = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19)

// Quem pode ouvir a gravação de uma ligação: a mesma regra do relatório —
// superAdmin; admin/gestor com Ligações (PABX) na empresa da ligação; ou a
// própria pessoa que ligou/atendeu (qualquer conta vinculada dela).
export async function podeOuvirLigacao(
  user: { id: number; role: string; superAdmin: boolean },
  empresaIdAtual: number | null,
  ligacao: { userId: number | null; empresaId: number | null; registroContatoId?: number | null; leadId?: number | null; clienteId?: number | null }
): Promise<boolean> {
  if (user.superAdmin) return true
  const meus = await idsDaPessoa(user.id)
  if (ligacao.userId && meus.includes(ligacao.userId)) return true
  // Ligação registrada num card do Kanban: o dono do card ouve; admin da
  // empresa do card também (é ele quem acompanha a carteira).
  if (ligacao.registroContatoId) {
    const [card] = await db
      .select({ vendedorId: funilMensal.vendedorId, empresaId: clientes.empresaId })
      .from(registroContato)
      .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(eq(registroContato.id, ligacao.registroContatoId))
    if (card && (meus.includes(card.vendedorId) || (user.role !== 'vendor' && card.empresaId === empresaIdAtual))) return true
  }
  // Lead / prospect: o vendedor responsável ouve; admin da empresa também.
  if (ligacao.leadId) {
    const l = await db.query.leads.findFirst({ where: eq(leads.id, ligacao.leadId), columns: { vendorId: true, empresaId: true } })
    if (l && ((l.vendorId && meus.includes(l.vendorId)) || (user.role !== 'vendor' && l.empresaId === empresaIdAtual))) return true
  }
  if (ligacao.clienteId) {
    const c = await db.query.clientes.findFirst({ where: eq(clientes.id, ligacao.clienteId), columns: { vendedorAtualId: true, empresaId: true } })
    if (c && ((c.vendedorAtualId && meus.includes(c.vendedorAtualId)) || (user.role !== 'vendor' && c.empresaId === empresaIdAtual))) return true
  }
  return user.role !== 'vendor' && ligacao.empresaId === empresaIdAtual && (await temFeature(user.id, FEATURE_RELATORIO))
}

async function idsDaPessoa(userId: number): Promise<number[]> {
  const v = await db.query.contasVinculadas.findMany({ where: eq(contasVinculadas.userId, userId) })
  return [userId, ...v.map((x) => x.contaVinculadaId)]
}

async function ultimaLigacaoId(userIds: number[]): Promise<number> {
  const [r] = await db
    .select({ id: max(pabxLigacoesProcessadas.id) })
    .from(pabxLigacoesProcessadas)
    .where(inArray(pabxLigacoesProcessadas.userId, userIds))
  return r?.id ?? 0
}

// Meta diária de LIGAÇÕES EFETIVAS por vendedor (pedido do João, 2026-11-05):
// Ligação entre colegas (ramal → ramal) não conta (João, 2026-11-05).
// Soma toda outra ligação efetiva do ramal — lead, carteira, prospecção ou número
// fora do CRM. Uma meta por empresa Odin; Odin Tubos começa em 30, as outras
// em 0 (= sem meta). Quem tem conta em mais de uma empresa fica com a maior.
const chaveMeta = (empresaId: number) => `pabxone360_meta_efetivas_dia_${empresaId}`
async function metasPorEmpresa(): Promise<Map<number, number>> {
  const es = await db.query.empresas.findMany({ where: inArray(empresas.slug, SLUGS_EMPRESAS_PABX), columns: { id: true, slug: true } })
  const m = new Map<number, number>()
  for (const e of es) m.set(e.id, await getConfigNumero(chaveMeta(e.id), e.slug === 'odin-tubos' ? 30 : 0))
  return m
}
async function metaDaPessoa(ids: number[], metas: Map<number, number>): Promise<number> {
  const us = await db.query.users.findMany({ where: inArray(users.id, ids), columns: { empresaId: true } })
  return Math.max(0, ...us.map((u) => (u.empresaId ? (metas.get(u.empresaId) ?? 0) : 0)))
}
type TipoLigacao = 'lead' | 'carteira' | 'prospeccao' | 'cliente' | 'nao_identificado' | 'colega'
// Tem ramal e nenhum número externo = ramal falando com ramal (PABXONE360:
// origem e destino são ramais; GoTo: sem participante PHONE_NUMBER).
function ehEntreColegas(l: { ramal: string | null; numero: string | null }) {
  return !!l.ramal && !l.numero
}
// pabxone360.ts grava: lead → leadId; carteira → registroContatoId (card do
// mês); prospect → clienteId sem registro e sem motivo; cliente sem card do
// mês nem prospecção → clienteId + motivo.
function tipoLigacao(l: { ramal: string | null; numero: string | null; leadId: number | null; registroContatoId: number | null; clienteId: number | null; motivo: string | null }): TipoLigacao {
  if (ehEntreColegas(l)) return 'colega'
  if (l.leadId) return 'lead'
  if (l.registroContatoId) return 'carteira'
  if (l.clienteId) return l.motivo ? 'cliente' : 'prospeccao'
  return 'nao_identificado'
}

export const pabxRouter = router({
  status: superAdminProcedure.query(async () => {
    const [usuario, token, ligada, click2call, duracaoMinima, ultimaSync, ultimoErro, prefixo, atrasoApi] = await Promise.all([
      getConfigTexto('pabxone360_usuario'),
      getConfigTexto('pabxone360_token'),
      getConfigBool('pabxone360_ligada', false),
      getConfigBool('pabxone360_click2call', false),
      getConfigNumero('pabxone360_duracao_minima_segundos', 15),
      getConfigTexto('pabxone360_ultima_sync'),
      getConfigTexto('pabxone360_ultimo_erro'),
      getConfigTexto('pabxone360_prefixo_discagem'),
      getConfigTexto('pabxone360_atraso_api'),
    ])
    return {
      usuario: usuario ?? '',
      tokenConfigurado: !!token,
      ligada,
      click2call,
      duracaoMinima,
      prefixoDiscagem: prefixo ?? '0',
      ultimaSync,
      ultimoErro,
      atrasoApi,
      metas: await (async () => {
        const metas = await metasPorEmpresa()
        const es = await db.query.empresas.findMany({ where: inArray(empresas.id, [...metas.keys()]), columns: { id: true, nome: true } })
        return es.map((e) => ({ empresaId: e.id, nome: e.nome, meta: metas.get(e.id) ?? 0 }))
      })(),
    }
  }),

  salvarConfig: superAdminProcedure
    .input(
      z.object({
        usuario: z.string().optional(),
        token: z.string().optional(),
        ligada: z.boolean(),
        click2call: z.boolean(),
        duracaoMinima: z.number().int().min(0).max(600),
        prefixoDiscagem: z.string().max(4),
        metas: z.array(z.object({ empresaId: z.number(), meta: z.number().int().min(0).max(500) })).optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (input.usuario !== undefined && input.usuario.trim()) await setConfig('pabxone360_usuario', input.usuario.trim())
      if (input.token !== undefined && input.token.trim()) await setConfig('pabxone360_token', input.token.trim())
      if (input.ligada && !(await lerCredenciaisPabx())) throw new Error('Preencha usuário e token antes de ligar a integração')
      await setConfig('pabxone360_ligada', input.ligada ? '1' : '0')
      await setConfig('pabxone360_click2call', input.click2call ? '1' : '0')
      await setConfig('pabxone360_duracao_minima_segundos', input.duracaoMinima)
      await setConfig('pabxone360_prefixo_discagem', input.prefixoDiscagem.replace(/\D/g, ''))
      for (const m of input.metas ?? []) await setConfig(chaveMeta(m.empresaId), m.meta)
      if (input.ligada) await setConfig('pabxone360_ultimo_erro', '')
      return { ok: true }
    }),

  // Testa usuário/token: lista os ramais e conta as ligações de hoje.
  testarConexao: superAdminProcedure.mutation(async () => {
    const cred = await credenciaisOuErro()
    const ramais = await listarRamaisPabx(cred)
    const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
    const chamadas = await buscarChamadasPabxone360(cred, inicioDiaBr(hoje), new Date(), await getConfigNumero('pabxone360_duracao_minima_segundos', 15))
    return { ramais: ramais.length, chamadasHoje: chamadas.length, efetivasHoje: chamadas.filter((c) => c.efetiva).length }
  }),

  // Ramais do PABX + vendedor ligado a cada um + quem pode ser escolhido
  // (usuários ativos das 3 empresas Odin).
  ramais: superAdminProcedure.query(async () => {
    const cred = await lerCredenciaisPabx()
    let doPabx: { numero: string; nome: string }[] = []
    let erro: string | null = null
    if (cred) {
      try {
        doPabx = await listarRamaisPabx(cred)
      } catch (e) {
        erro = (e as Error).message
      }
    }
    const salvos = await db.query.pabxRamais.findMany()
    const porRamal = new Map(salvos.map((r) => [r.ramal, r]))
    const numeros = [...new Set([...doPabx.map((r) => r.numero), ...salvos.map((r) => r.ramal)])].sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { numeric: true })
    )
    const nomePabx = new Map(doPabx.map((r) => [r.numero, r.nome]))
    const usuarios = await db
      .select({ id: users.id, name: users.name, role: users.role, empresa: empresas.nome, empresaSlug: empresas.slug })
      .from(users)
      .innerJoin(empresas, eq(empresas.id, users.empresaId))
      .where(and(eq(users.isActive, true), inArray(empresas.slug, SLUGS_EMPRESAS_PABX)))
      .orderBy(users.name)
    return {
      erro,
      ramais: numeros.map((n) => ({
        ramal: n,
        nome: nomePabx.get(n) ?? porRamal.get(n)?.nome ?? '',
        userId: porRamal.get(n)?.userId ?? null,
        noPabx: nomePabx.has(n),
      })),
      usuarios,
    }
  }),

  salvarRamal: superAdminProcedure
    .input(z.object({ ramal: z.string().min(1), nome: z.string().optional(), userId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      const ramal = input.ramal.trim()
      if (input.userId) {
        // 1 ramal por vendedor: tira esse vendedor de outro ramal, se tiver.
        const outro = await db.query.pabxRamais.findFirst({ where: eq(pabxRamais.userId, input.userId) })
        if (outro && outro.ramal !== ramal) await db.update(pabxRamais).set({ userId: null, updatedAt: agoraSqlite() }).where(eq(pabxRamais.id, outro.id))
      }
      await db
        .insert(pabxRamais)
        .values({ ramal, nome: input.nome ?? null, userId: input.userId })
        .onConflictDoUpdate({ target: pabxRamais.ramal, set: { userId: input.userId, nome: input.nome ?? null, updatedAt: agoraSqlite() } })
      return { ok: true }
    }),

  // Reprocessa um período na mão (ex: depois de cadastrar os ramais, pra
  // pegar as ligações de hoje cedo). Não duplica nada.
  sincronizarAgora: superAdminProcedure
    .input(z.object({ dataInicio: z.string(), dataFim: z.string() }))
    .mutation(async ({ input }) => {
      const cred = await credenciaisOuErro()
      const duracaoMinima = await getConfigNumero('pabxone360_duracao_minima_segundos', 15)
      const resultados = await registrarLigacoesAutomaticasPabxone360(cred, inicioDiaBr(input.dataInicio), fimDiaBr(input.dataFim), duracaoMinima, true)
      return {
        novas: resultados.length,
        registradas: resultados.filter((r) => r.registroContatoId || r.leadId).length,
      }
    }),

  // Pro botão Ligar: se o Click2Call está ligado e a pessoa tem ramal, o
  // botão liga pelo PABX; senão continua abrindo o discador (tel:).
  meuRamal: protectedProcedure.query(async ({ ctx }) => {
    const [ligada, click2call] = await Promise.all([getConfigBool('pabxone360_ligada', false), getConfigBool('pabxone360_click2call', false)])
    if (!ligada || !click2call) return { click2call: false, ramal: null }
    const ids = await idsDaPessoa(ctx.user.id)
    const r = await db.query.pabxRamais.findFirst({ where: inArray(pabxRamais.userId, ids) })
    return { click2call: !!r, ramal: r?.ramal ?? null }
  }),

  discar: protectedProcedure.input(z.object({ numero: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    const cred = await credenciaisOuErro()
    if (!(await getConfigBool('pabxone360_click2call', false))) throw new Error('Ligar pelo CRM não está ativado')
    const ids = await idsDaPessoa(ctx.user.id)
    const r = await db.query.pabxRamais.findFirst({ where: inArray(pabxRamais.userId, ids) })
    if (!r) throw new Error('Você ainda não tem ramal cadastrado no CRM — peça pro administrador em Telefonia → Ramais')
    let digitos = input.numero.replace(/\D/g, '')
    if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) digitos = digitos.slice(2)
    if ((digitos.length === 11 || digitos.length === 12) && digitos.startsWith('0')) digitos = digitos.slice(1)
    const prefixo = (await getConfigTexto('pabxone360_prefixo_discagem')) ?? '0'
    const ultimoId = await ultimaLigacaoId(ids)
    const resultado = await discarPabx(cred, r.ramal, `${prefixo}${digitos}`)
    // Passa a checar a PABXONE360 a cada ~10s até a ligação aparecer
    // (em vez de esperar a sincronização do minuto) — pabxAcompanhamento.ts.
    acompanharLigacao(r.ramal)
    return { ...resultado, ultimoId }
  }),

  // A tela, depois do clique em Ligar, pergunta isto a cada poucos segundos:
  // quando o id muda, a ligação foi gravada e ela recarrega os dados.
  // Ligações gravadas de um lead ou prospect (ficha do lead / da
  // prospecção). Só as que a pessoa pode ouvir.
  gravacoesDoContato: protectedProcedure
    .input(z.object({ leadId: z.number().optional(), clienteId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      if (!input.leadId && !input.clienteId) return []
      const linhas = await db
        .select({
          id: pabxLigacoesProcessadas.id,
          userId: pabxLigacoesProcessadas.userId,
          empresaId: pabxLigacoesProcessadas.empresaId,
          leadId: pabxLigacoesProcessadas.leadId,
          clienteId: pabxLigacoesProcessadas.clienteId,
          registroContatoId: pabxLigacoesProcessadas.registroContatoId,
          dataHora: pabxLigacoesProcessadas.dataHora,
          direcao: pabxLigacoesProcessadas.direcao,
          duracao: pabxLigacoesProcessadas.duracaoSegundos,
          efetiva: pabxLigacoesProcessadas.efetiva,
          ramal: pabxLigacoesProcessadas.ramal,
          link: pabxLigacoesProcessadas.linkGravacao,
          quem: users.name,
        })
        .from(pabxLigacoesProcessadas)
        .leftJoin(users, eq(users.id, pabxLigacoesProcessadas.userId))
        .where(input.leadId ? eq(pabxLigacoesProcessadas.leadId, input.leadId) : eq(pabxLigacoesProcessadas.clienteId, input.clienteId!))
        .orderBy(desc(pabxLigacoesProcessadas.dataHora))
        .limit(50)
      const out = []
      for (const l of linhas) {
        if (!(await podeOuvirLigacao(ctx.user, ctx.empresaId, l))) continue
        const { link, ...resto } = l
        out.push({ ...resto, partes: (link ?? '').split('\n').filter(Boolean).length })
      }
      return out
    }),

  // Contador do topo da tela: ligações efetivas de hoje × meta do dia.
  // null = pessoa sem ramal ou empresa sem meta (não mostra nada).
  minhaMetaHoje: protectedProcedure.query(async ({ ctx }) => {
    const ids = await idsDaPessoa(ctx.user.id)
    const temRamal = await db.query.pabxRamais.findFirst({ where: inArray(pabxRamais.userId, ids), columns: { id: true } })
    if (!temRamal) return null
    const meta = await metaDaPessoa(ids, await metasPorEmpresa())
    if (!meta) return null
    const hoje = hojeBrString()
    const [r] = await db
      .select({ n: sql<number>`count(*)` })
      .from(pabxLigacoesProcessadas)
      .where(
        and(
          inArray(pabxLigacoesProcessadas.userId, ids),
          eq(pabxLigacoesProcessadas.efetiva, true),
          isNotNull(pabxLigacoesProcessadas.numeroExterno),
          gte(pabxLigacoesProcessadas.dataHora, paraSqlite(inicioDiaBr(hoje))),
          lte(pabxLigacoesProcessadas.dataHora, paraSqlite(fimDiaBr(hoje)))
        )
      )
    return { meta, efetivas: Number(r?.n ?? 0) }
  }),

  minhaUltimaLigacao: protectedProcedure.query(async ({ ctx }) => ({ id: await ultimaLigacaoId(await idsDaPessoa(ctx.user.id)) })),

  // Relatório de ligações: tentativas x efetivas por vendedor + lista.
  relatorio: protectedProcedure
    .input(z.object({ dataInicio: z.string(), dataFim: z.string(), empresaId: z.number().nullable().optional(), userId: z.number().nullable().optional() }))
    .query(async ({ ctx, input }) => {
      const veTudo = ctx.user.superAdmin || (ctx.user.role !== 'vendor' && (await temFeature(ctx.user.id, FEATURE_RELATORIO)))
      const filtros = [
        gte(pabxLigacoesProcessadas.dataHora, paraSqlite(inicioDiaBr(input.dataInicio))),
        lte(pabxLigacoesProcessadas.dataHora, paraSqlite(fimDiaBr(input.dataFim))),
      ]
      if (!veTudo) {
        filtros.push(inArray(pabxLigacoesProcessadas.userId, await idsDaPessoa(ctx.user.id)))
      } else {
        if (input.userId) filtros.push(eq(pabxLigacoesProcessadas.userId, input.userId))
        // Admin comum vê a empresa em que está; superAdmin escolhe (null = as 3).
        const empresaId = ctx.user.superAdmin ? (input.empresaId ?? null) : ctx.empresaId
        if (empresaId) filtros.push(eq(pabxLigacoesProcessadas.empresaId, empresaId))
      }

      const linhas = await db
        .select({
          id: pabxLigacoesProcessadas.id,
          dataHora: pabxLigacoesProcessadas.dataHora,
          direcao: pabxLigacoesProcessadas.direcao,
          numero: pabxLigacoesProcessadas.numeroExterno,
          duracao: pabxLigacoesProcessadas.duracaoSegundos,
          efetiva: pabxLigacoesProcessadas.efetiva,
          status: pabxLigacoesProcessadas.statusChamada,
          ramal: pabxLigacoesProcessadas.ramal,
          userId: pabxLigacoesProcessadas.userId,
          vendedor: users.name,
          empresaId: pabxLigacoesProcessadas.empresaId,
          clienteId: pabxLigacoesProcessadas.clienteId,
          leadId: pabxLigacoesProcessadas.leadId,
          registroContatoId: pabxLigacoesProcessadas.registroContatoId,
          motivo: pabxLigacoesProcessadas.motivoNaoRegistrado,
          linkGravacao: pabxLigacoesProcessadas.linkGravacao,
          resumo: pabxLigacoesProcessadas.resumo,
          transcricao: pabxLigacoesProcessadas.transcricao,
        })
        .from(pabxLigacoesProcessadas)
        .leftJoin(users, eq(users.id, pabxLigacoesProcessadas.userId))
        .where(and(...filtros))
        .orderBy(desc(pabxLigacoesProcessadas.dataHora))

      const idsCliente = [...new Set(linhas.map((l) => l.clienteId).filter((x): x is number => !!x))]
      const idsLead = [...new Set(linhas.map((l) => l.leadId).filter((x): x is number => !!x))]
      const nomesCliente = new Map<number, string>()
      for (let i = 0; i < idsCliente.length; i += 900) {
        const rs = await db.query.clientes.findMany({ where: inArray(clientes.id, idsCliente.slice(i, i + 900)), columns: { id: true, razaoSocial: true } })
        for (const c of rs) nomesCliente.set(c.id, c.razaoSocial)
      }
      const nomesLead = new Map<number, string>()
      for (let i = 0; i < idsLead.length; i += 900) {
        const rs = await db.query.leads.findMany({ where: inArray(leads.id, idsLead.slice(i, i + 900)), columns: { id: true, name: true, company: true } })
        for (const l of rs) nomesLead.set(l.id, l.company ? `${l.name} / ${l.company}` : l.name)
      }
      const nomesEmpresa = new Map((await db.query.empresas.findMany({ columns: { id: true, nome: true } })).map((e) => [e.id, e.nome]))

      // Meta do período = meta/dia × dias úteis do período até hoje.
      const hoje = hojeBrString()
      const fimMeta = input.dataFim < hoje ? input.dataFim : hoje
      const diasUteis = input.dataInicio <= fimMeta ? contarDiasUteis(new Date(`${input.dataInicio}T00:00:00Z`), new Date(`${fimMeta}T00:00:00Z`)) : 0
      const hojeNoPeriodo = input.dataInicio <= hoje && hoje <= input.dataFim
      const inicioHoje = paraSqlite(inicioDiaBr(hoje))
      const metas = await metasPorEmpresa()

      // Por vendedor (ligação sem ramal cadastrado fica em "Sem vendedor").
      type PorVendedor = {
        userId: number | null
        vendedor: string
        ramal: string | null
        tentativas: number
        efetivas: number
        segundosFalados: number
        feitas: number
        recebidas: number
        efetivasPorTipo: Record<Exclude<TipoLigacao, 'colega'>, number>
        efetivasHoje: number
        metaDia: number
        metaPeriodo: number
      }
      const porVendedor = new Map<string, PorVendedor>()
      for (const l of linhas) {
        // Entre colegas só aparece na lista; não soma em nada.
        const tipo = tipoLigacao(l)
        if (tipo === 'colega') continue
        const chave = l.userId ? `u${l.userId}` : `r${l.ramal ?? '?'}`
        const p = porVendedor.get(chave) ?? {
          userId: l.userId,
          vendedor: l.vendedor ?? (l.ramal ? `Ramal ${l.ramal} (sem vendedor)` : 'Sem ramal (fila/URA)'),
          ramal: l.ramal,
          tentativas: 0,
          efetivas: 0,
          segundosFalados: 0,
          feitas: 0,
          recebidas: 0,
          efetivasPorTipo: { lead: 0, carteira: 0, prospeccao: 0, cliente: 0, nao_identificado: 0 },
          efetivasHoje: 0,
          metaDia: 0,
          metaPeriodo: 0,
        }
        p.tentativas++
        if (l.efetiva) {
          p.efetivas++
          p.segundosFalados += l.duracao ?? 0
          p.efetivasPorTipo[tipo]++
          if (l.dataHora && l.dataHora >= inicioHoje) p.efetivasHoje++
        }
        if (l.direcao === 'OUTBOUND') p.feitas++
        if (l.direcao === 'INBOUND') p.recebidas++
        porVendedor.set(chave, p)
      }
      // Quem tem ramal e não ligou nada no período também aparece (0 / meta).
      const meusIds = veTudo ? null : await idsDaPessoa(ctx.user.id)
      const empresaFiltro = veTudo ? (ctx.user.superAdmin ? (input.empresaId ?? null) : ctx.empresaId) : null
      const comRamal = await db
        .select({ userId: users.id, nome: users.name, ramal: pabxRamais.ramal, empresaId: users.empresaId, ativo: users.isActive })
        .from(pabxRamais)
        .innerJoin(users, eq(users.id, pabxRamais.userId))
      for (const r of comRamal) {
        if (!r.ativo || porVendedor.has(`u${r.userId}`)) continue
        if (meusIds && !meusIds.includes(r.userId)) continue
        if (veTudo && input.userId && input.userId !== r.userId) continue
        if (empresaFiltro && r.empresaId !== empresaFiltro) continue
        porVendedor.set(`u${r.userId}`, {
          userId: r.userId,
          vendedor: r.nome,
          ramal: r.ramal,
          tentativas: 0,
          efetivas: 0,
          segundosFalados: 0,
          feitas: 0,
          recebidas: 0,
          efetivasPorTipo: { lead: 0, carteira: 0, prospeccao: 0, cliente: 0, nao_identificado: 0 },
          efetivasHoje: 0,
          metaDia: 0,
          metaPeriodo: 0,
        })
      }
      for (const p of porVendedor.values()) {
        if (!p.userId) continue
        p.metaDia = await metaDaPessoa(await idsDaPessoa(p.userId), metas)
        p.metaPeriodo = p.metaDia * diasUteis
      }

      return {
        veTudo,
        porVendedor: [...porVendedor.values()].sort((a, b) => b.efetivas - a.efetivas || b.tentativas - a.tentativas),
        diasUteis,
        hojeNoPeriodo,
        chamadas: linhas.slice(0, 3000).map((l) => ({
          ...l,
          tipo: tipoLigacao(l),
          empresa: l.empresaId ? (nomesEmpresa.get(l.empresaId) ?? null) : null,
          contato: l.clienteId ? (nomesCliente.get(l.clienteId) ?? null) : l.leadId ? (nomesLead.get(l.leadId) ?? null) : null,
        })),
        totalChamadas: linhas.length,
      }
    }),

  // Opções de filtro do relatório (empresas Odin + vendedores com ramal).
  filtrosRelatorio: protectedProcedure.query(async ({ ctx }) => {
    const empresasOdin = await db.query.empresas.findMany({ where: inArray(empresas.slug, [...SLUGS_EMPRESAS_PABX, 'joitec']), columns: { id: true, nome: true } })
    const comRamal = await db
      .select({ id: users.id, name: users.name, ramal: pabxRamais.ramal, empresaId: users.empresaId })
      .from(pabxRamais)
      .innerJoin(users, eq(users.id, pabxRamais.userId))
      .orderBy(users.name)
    // + ramais da GoTo (Joitec)
    comRamal.push(
      ...(await db
        .select({ id: users.id, name: users.name, ramal: gotoRamais.ramal, empresaId: users.empresaId })
        .from(gotoRamais)
        .innerJoin(users, eq(users.id, gotoRamais.userId))
        .orderBy(users.name))
    )
    return {
      empresas: ctx.user.superAdmin ? empresasOdin : empresasOdin.filter((e) => e.id === ctx.empresaId),
      vendedores: ctx.user.superAdmin ? comRamal : comRamal.filter((v) => v.empresaId === ctx.empresaId),
    }
  }),
})
