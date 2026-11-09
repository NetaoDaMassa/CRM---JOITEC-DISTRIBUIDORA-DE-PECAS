import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { expedicaoAgendamentos, users } from '../db/schema.js'

export type AgendamentoColeta = {
  id: number
  transportadora: string | null
  coletaAgendada: string
  registradoEm: string
  registradoPor: string | null
}

// Tentativas de agendamento de coleta de cada card, da primeira à atual.
export async function agendamentosPorCard(ids: number[]): Promise<Map<number, AgendamentoColeta[]>> {
  const mapa = new Map<number, AgendamentoColeta[]>()
  if (!ids.length) return mapa
  const linhas = await db
    .select({
      id: expedicaoAgendamentos.id,
      expedicaoId: expedicaoAgendamentos.expedicaoId,
      transportadora: expedicaoAgendamentos.transportadora,
      coletaAgendada: expedicaoAgendamentos.coletaAgendada,
      registradoEm: expedicaoAgendamentos.registradoEm,
      registradoPor: users.name,
    })
    .from(expedicaoAgendamentos)
    .leftJoin(users, eq(users.id, expedicaoAgendamentos.registradoPor))
    .where(inArray(expedicaoAgendamentos.expedicaoId, ids))
    .orderBy(asc(expedicaoAgendamentos.id))
  for (const { expedicaoId, ...a } of linhas) mapa.set(expedicaoId, [...(mapa.get(expedicaoId) ?? []), a])
  return mapa
}
