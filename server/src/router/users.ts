import { z } from 'zod'
import bcrypt from 'bcryptjs'
import * as XLSX from 'xlsx'
import { and, eq, isNull, inArray } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { users, clientes, metasMensais, logAcessoUsuario, atividadeDiariaUsuario } from '../db/schema.js'
import { mesReferenciaAtual } from '../lib/dataBr.js'
import { getConfigNumero } from '../lib/configuracoes.js'
import { toUtcISO, toLocalDateKey, toLocalTimeKey } from '../lib/businessHours.js'

// Ping considerado "ao vivo" se chegou há menos de 2 min — um pouco acima do
// intervalo de 60s do heartbeat do frontend, pra tolerar jitter de rede sem
// piscar o selo à toa.
const LIVE_THRESHOLD_MS = 2 * 60 * 1000

function fmtMinutos(segundos: number): string {
  const mins = Math.round(segundos / 60)
  if (mins < 60) return `${mins}min`
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}min`
}

// Dias úteis (seg-sex) do mês corrente, do dia 1 até hoje — em vez de uma
// janela fixa de X dias corridos, pontua "quantos dias trabalhados do mês a
// pessoa já acessou", que é o que realmente importa pra cobrança de presença
// (fim de semana não conta como falta).
function diasUteisMesAtual(): string[] {
  const TZ_OFFSET_MS = 3 * 60 * 60 * 1000
  const hojeLocal = new Date(Date.now() - TZ_OFFSET_MS)
  const ano = hojeLocal.getUTCFullYear()
  const mes = hojeLocal.getUTCMonth()
  const ultimoDia = hojeLocal.getUTCDate()
  const lista: string[] = []
  for (let dia = 1; dia <= ultimoDia; dia++) {
    const d = new Date(Date.UTC(ano, mes, dia))
    const diaSemana = d.getUTCDay()
    if (diaSemana === 0 || diaSemana === 6) continue
    lista.push(d.toISOString().slice(0, 10))
  }
  return lista
}

const REGIAO_VALUES = ['norte', 'nordeste', 'centro_oeste', 'sudeste', 'sul'] as const

function gerarSenhaTemporaria(): string {
  return `Joitec${Math.random().toString(36).slice(2, 8)}9x`
}

export const usersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.query.users.findMany({
      where: eq(users.empresaId, ctx.empresaId),
      columns: { passwordHash: false },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
  }),

  // "Vendors" aqui não é só quem tem role='vendor' — um admin de uma
  // empresa (ex: Pamela na Joitec Automação) também pode ter carteira
  // própria e vender. Só o superAdmin (cross-empresa, puramente
  // administrativo) fica de fora dessa lista.
  vendors: protectedProcedure.query(async ({ ctx }) => {
    const all = await db.query.users.findMany({
      where: eq(users.empresaId, ctx.empresaId),
      columns: { passwordHash: false },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    return all.filter((u) => u.isActive && !u.superAdmin)
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(2),
        username: z.string().min(3),
        role: z.enum(['admin', 'vendor']).default('vendor'),
        regiao: z.enum(REGIAO_VALUES).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // username é único globalmente (o login não sabe de qual empresa é
      // antes de autenticar), então essa checagem não leva empresaId.
      const existing = await db.query.users.findFirst({ where: eq(users.username, input.username) })
      if (existing) throw new Error('Nome de usuário já existe')

      const senhaTemporaria = gerarSenhaTemporaria()
      const hash = await bcrypt.hash(senhaTemporaria, 12)
      const result = await db.insert(users).values({
        empresaId: ctx.empresaId,
        name: input.name,
        username: input.username,
        passwordHash: hash,
        role: input.role,
        regiao: input.regiao,
        senhaTrocarNoLogin: true,
      })
      const id = Number(result.lastInsertRowid)

      // Vendedor novo já nasce com meta do mês corrente (padrão configurável
      // em Configurações) — evita aparecer sem meta no dashboard/TV.
      if (input.role === 'vendor') {
        const metaFaturamento = await getConfigNumero('meta_faturamento_padrao', 100000)
        const metaLigacoesDia = await getConfigNumero('meta_ligacoes_dia_padrao', 25)
        await db.insert(metasMensais).values({
          vendedorId: id,
          mesReferencia: mesReferenciaAtual(),
          metaFaturamento,
          metaLigacoesDia,
        })
      }

      return { id, senhaTemporaria }
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(2).optional(),
        username: z.string().min(3).optional(),
        regiao: z.enum(REGIAO_VALUES).optional(),
        role: z.enum(['admin', 'vendor']).optional(),
        isActive: z.boolean().optional(),
        ocultoPainelTv: z.boolean().optional(),
        fotoUrl: z.string().optional(),
        whatsapp: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input
      const target = await db.query.users.findFirst({ where: and(eq(users.id, id), eq(users.empresaId, ctx.empresaId)) })
      if (!target) throw new Error('Usuário não encontrado')

      // username é único globalmente (mesmo motivo do create) — checa contra
      // qualquer outro usuário, não só dentro da empresa.
      if (updates.username && updates.username !== target.username) {
        const existing = await db.query.users.findFirst({ where: eq(users.username, updates.username) })
        if (existing) throw new Error('Nome de usuário já existe')
      }

      await db.update(users).set(updates).where(eq(users.id, id))
      return { success: true }
    }),

  resetPassword: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const target = await db.query.users.findFirst({ where: and(eq(users.id, input.id), eq(users.empresaId, ctx.empresaId)) })
      if (!target) throw new Error('Usuário não encontrado')
      const senhaTemporaria = gerarSenhaTemporaria()
      const hash = await bcrypt.hash(senhaTemporaria, 12)
      await db.update(users).set({ passwordHash: hash, senhaTrocarNoLogin: true }).where(eq(users.id, input.id))
      return { senhaTemporaria }
    }),

  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const target = await db.query.users.findFirst({ where: and(eq(users.id, input.id), eq(users.empresaId, ctx.empresaId)) })
    if (!target) throw new Error('Usuário não encontrado')

    const ativos = await db.query.clientes.findMany({
      where: and(eq(clientes.vendedorAtualId, input.id), isNull(clientes.deletedAt)),
      columns: { id: true },
    })
    if (ativos.length > 0) {
      throw new Error(`Este vendedor ainda tem ${ativos.length} cliente(s) na carteira. Redistribua antes de excluir.`)
    }
    await db.delete(users).where(eq(users.id, input.id))
    return { success: true }
  }),

  // Registro de acesso diário — pra admin ver quais vendedores estão (ou
  // não) entrando no CRM, dia a dia, quanto tempo ficaram online, e não só
  // "quando foi o último login".
  accessLog: adminProcedure.query(async ({ ctx }) => {
      const empresaUsers = await db.query.users.findMany({
        where: eq(users.empresaId, ctx.empresaId),
        columns: { passwordHash: false },
        orderBy: (u, { asc }) => [asc(u.name)],
      })
      const userIds = empresaUsers.map((u) => u.id)

      const dayList = diasUteisMesAtual()
      const hoje = dayList[dayList.length - 1]

      const [logs, atividade] = userIds.length
        ? await Promise.all([
            db.query.logAcessoUsuario.findMany({
              where: inArray(logAcessoUsuario.usuarioId, userIds),
              orderBy: (l, { asc }) => [asc(l.criadoEm)],
            }),
            db.query.atividadeDiariaUsuario.findMany({ where: inArray(atividadeDiariaUsuario.usuarioId, userIds) }),
          ])
        : [[], []]

      const horariosPorUsuario = new Map<number, Map<string, string[]>>()
      for (const log of logs) {
        const dia = toLocalDateKey(log.criadoEm)
        if (!dayList.includes(dia)) continue
        if (!horariosPorUsuario.has(log.usuarioId)) horariosPorUsuario.set(log.usuarioId, new Map())
        const diasUsuario = horariosPorUsuario.get(log.usuarioId)!
        if (!diasUsuario.has(dia)) diasUsuario.set(dia, [])
        diasUsuario.get(dia)!.push(toLocalTimeKey(log.criadoEm))
      }

      const segundosPorUsuario = new Map<number, Map<string, number>>()
      const ultimoPingPorUsuario = new Map<number, string>()
      for (const a of atividade) {
        if (!segundosPorUsuario.has(a.usuarioId)) segundosPorUsuario.set(a.usuarioId, new Map())
        segundosPorUsuario.get(a.usuarioId)!.set(a.data, a.segundosOnline)
        if (a.data === hoje) ultimoPingPorUsuario.set(a.usuarioId, a.ultimoPingEm)
      }

      const agora = Date.now()

      return {
        days: dayList,
        users: empresaUsers.map((u) => {
          const diasUsuario = horariosPorUsuario.get(u.id) ?? new Map<string, string[]>()
          const segundosUsuario = segundosPorUsuario.get(u.id) ?? new Map<string, number>()
          const horariosHoje = diasUsuario.get(hoje) ?? []
          const ultimoPing = ultimoPingPorUsuario.get(u.id)
          const onlineAgora = !!ultimoPing && agora - new Date(toUtcISO(ultimoPing)).getTime() < LIVE_THRESHOLD_MS

          return {
            id: u.id,
            name: u.name,
            accessedToday: horariosHoje.length > 0,
            lastLoginTimeToday: horariosHoje[horariosHoje.length - 1] ?? null,
            lastLoginAt: u.lastLoginAt,
            onlineNow: onlineAgora,
            onlineSecondsToday: segundosUsuario.get(hoje) ?? 0,
            days: dayList.map((dia) => diasUsuario.has(dia)),
            dayTimes: dayList.map((dia) => diasUsuario.get(dia) ?? []),
            dayOnlineSeconds: dayList.map((dia) => segundosUsuario.get(dia) ?? 0),
          }
        }),
      }
    }),

  // Exporta o registro de acesso (mesmos dados do accessLog) em Excel, um
  // vendedor+dia por linha.
  exportAccessLog: adminProcedure.mutation(async ({ ctx }) => {
      const empresaUsers = await db.query.users.findMany({
        where: eq(users.empresaId, ctx.empresaId),
        columns: { passwordHash: false },
        orderBy: (u, { asc }) => [asc(u.name)],
      })
      const userIds = empresaUsers.map((u) => u.id)
      const dayList = diasUteisMesAtual()

      const [logs, atividade] = userIds.length
        ? await Promise.all([
            db.query.logAcessoUsuario.findMany({ where: inArray(logAcessoUsuario.usuarioId, userIds) }),
            db.query.atividadeDiariaUsuario.findMany({ where: inArray(atividadeDiariaUsuario.usuarioId, userIds) }),
          ])
        : [[], []]

      const horariosPorUsuario = new Map<number, Map<string, string[]>>()
      for (const log of logs) {
        const dia = toLocalDateKey(log.criadoEm)
        if (!dayList.includes(dia)) continue
        if (!horariosPorUsuario.has(log.usuarioId)) horariosPorUsuario.set(log.usuarioId, new Map())
        const diasUsuario = horariosPorUsuario.get(log.usuarioId)!
        if (!diasUsuario.has(dia)) diasUsuario.set(dia, [])
        diasUsuario.get(dia)!.push(toLocalTimeKey(log.criadoEm))
      }
      const segundosPorUsuario = new Map<number, Map<string, number>>()
      for (const a of atividade) {
        if (!segundosPorUsuario.has(a.usuarioId)) segundosPorUsuario.set(a.usuarioId, new Map())
        segundosPorUsuario.get(a.usuarioId)!.set(a.data, a.segundosOnline)
      }

      const linhas: Record<string, string | number>[] = []
      for (const u of empresaUsers) {
        const diasUsuario = horariosPorUsuario.get(u.id) ?? new Map<string, string[]>()
        const segundosUsuario = segundosPorUsuario.get(u.id) ?? new Map<string, number>()
        for (const dia of dayList) {
          const horarios = diasUsuario.get(dia) ?? []
          const segundos = segundosUsuario.get(dia) ?? 0
          linhas.push({
            Vendedor: u.name,
            Usuário: u.username,
            Data: dia.split('-').reverse().join('/'),
            Acessou: horarios.length > 0 ? 'Sim' : 'Não',
            'Horários de acesso': horarios.join(', '),
            'Tempo online': segundos > 0 ? fmtMinutos(segundos) : '—',
            'Tempo online (min)': Math.round(segundos / 60),
          })
        }
      }

      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.json_to_sheet(linhas)
      XLSX.utils.book_append_sheet(wb, ws, 'Acessos')
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

      return {
        data: buffer.toString('base64'),
        filename: `acessos_${new Date().toISOString().slice(0, 10)}.xlsx`,
        count: linhas.length,
      }
    }),
})
