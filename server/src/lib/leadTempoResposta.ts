import { and, inArray, isNotNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leadHistory } from '../db/schema.js'
import { businessHoursElapsedMs, toUtcISO } from './businessHours.js'

// Tempo até o 1º contato de um lead, justo com quem atendeu (pedido do João,
// 2026-11-11, depois da revisão dos leads do Guilherme/Joitec): o relógio
// começa quando o lead CHEGOU pra quem fez o 1º contato confirmado — não
// quando o lead entrou no CRM. Antes, lead que vinha do rodízio automático
// (3h no "Novo" sem contato → troca de vendedor) chegava pro próximo já com
// 3h (ou 6h, 2 rodízios) "na conta" dele. Sem registro de atribuição pra essa
// pessoa, vale a criação do lead (o lead já nasceu com ela). Sempre em horas
// úteis (businessHours.ts).

export type Atribuicao = { para: number; em: number }

const ms = (s: string) => new Date(toUtcISO(s)).getTime()

export async function carregarAtribuicoes(leadIds: number[]): Promise<Map<number, Atribuicao[]>> {
  const mapa = new Map<number, Atribuicao[]>()
  for (let i = 0; i < leadIds.length; i += 500) {
    const linhas = await db
      .select({ leadId: leadHistory.leadId, para: leadHistory.toVendorId, em: leadHistory.createdAt })
      .from(leadHistory)
      .where(and(inArray(leadHistory.leadId, leadIds.slice(i, i + 500)), isNotNull(leadHistory.toVendorId)))
    for (const l of linhas) {
      const lista = mapa.get(l.leadId) ?? []
      lista.push({ para: l.para!, em: ms(l.em) })
      mapa.set(l.leadId, lista)
    }
  }
  for (const lista of mapa.values()) lista.sort((a, b) => a.em - b.em)
  return mapa
}

export function inicioDoRelogio(leadCreatedAt: string, quemContatou: number, contatoEm: string, atribuicoes: Atribuicao[] | undefined): string {
  const criado = ms(leadCreatedAt)
  const contato = ms(contatoEm)
  let inicio = criado
  for (const a of atribuicoes ?? []) {
    if (a.para === quemContatou && a.em <= contato && a.em > inicio) inicio = a.em
  }
  return new Date(inicio).toISOString()
}

export function tempoPrimeiroContatoMs(leadCreatedAt: string, quemContatou: number, contatoEm: string, atribuicoes: Atribuicao[] | undefined): number {
  return businessHoursElapsedMs(inicioDoRelogio(leadCreatedAt, quemContatou, contatoEm, atribuicoes), toUtcISO(contatoEm))
}
