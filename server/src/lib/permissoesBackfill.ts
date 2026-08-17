import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { permissoesAdmin, users } from '../db/schema.js'
import { FEATURES_RELATORIOS } from '../router/permissoes.js'

// Roda uma vez, no primeiro boot depois que as abas de relatório (visão
// geral/contatos/orçamentos/alertas) passaram a ser controladas por
// permissão. Sem isso, todo vendedor e todo admin (que já tinha a página
// "Relatórios" liberada) perderia acesso a abas que já usava normalmente —
// então aqui a gente preserva o que já era visível, e só a partir daí o
// superAdmin passa a controlar aba por aba pela tela de Permissões.
// Idempotente: se já existe qualquer linha `relatorio_*` no banco (seja
// desse backfill, seja de alguém já ter mexido na tela), não roda de novo.
export async function backfillPermissoesRelatorios() {
  const jaRodou = await db.query.permissoesAdmin.findFirst({
    where: inArray(permissoesAdmin.feature, [...FEATURES_RELATORIOS]),
  })
  if (jaRodou) return

  const vendedores = await db.query.users.findMany({
    where: and(eq(users.role, 'vendor'), eq(users.isActive, true)),
    columns: { id: true },
  })
  const adminsComRelatorios = await db.query.permissoesAdmin.findMany({
    where: eq(permissoesAdmin.feature, 'relatorios'),
    columns: { userId: true },
  })

  const alvoIds = new Set<number>([...vendedores.map((v) => v.id), ...adminsComRelatorios.map((a) => a.userId)])
  if (alvoIds.size === 0) return

  const linhas = [...alvoIds].flatMap((userId) => FEATURES_RELATORIOS.map((feature) => ({ userId, feature })))
  await db.insert(permissoesAdmin).values(linhas)
  console.log(`[permissoes] backfill de abas de relatório aplicado a ${alvoIds.size} usuário(s)`)
}

// Mesma ideia, só pro "Painel de TV": antes dessa mudança QUALQUER admin
// (não só superAdmin) já enxergava o link, sem precisar de permissão —
// então todo admin não-superAdmin já ativo ganha a feature automaticamente
// pra não perder acesso do nada. "Painel Financeiro" NÃO entra aqui de
// propósito: sempre foi trancado só pro superAdmin (SuperAdminGuard), então
// o padrão novo é continuar fechado até o superAdmin liberar alguém.
export async function backfillPermissaoPainelTv() {
  const jaRodou = await db.query.permissoesAdmin.findFirst({ where: eq(permissoesAdmin.feature, 'painel_tv') })
  if (jaRodou) return

  const admins = await db.query.users.findMany({
    where: and(eq(users.role, 'admin'), eq(users.superAdmin, false), eq(users.isActive, true)),
    columns: { id: true },
  })
  if (admins.length === 0) return

  await db.insert(permissoesAdmin).values(admins.map((a) => ({ userId: a.id, feature: 'painel_tv' })))
  console.log(`[permissoes] backfill de Painel de TV aplicado a ${admins.length} admin(s)`)
}
