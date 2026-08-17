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
