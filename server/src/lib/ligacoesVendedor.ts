// Ligações por vendedor nos painéis (TV de vendas, TV da Odin, Dashboards).
// Pedido do João, 2026-11-06: vendedor via um número no contador do topo e
// outro na TV, porque a TV só contava o que estava salvo em card do Kanban.
//
// - Quem tem ramal: conta o PABX/GoTo, igual ao contador e ao relatório de
//   Ligações (lead, carteira, prospecção e fora do CRM; colega não entra).
//   Registro digitado à mão não soma, senão a mesma ligação contaria 2x.
// - Quem não tem ramal: conta os registros do card, menos as ligações que o
//   PABX sabe que foram feitas por outra pessoa (o card fica com o dono quando
//   quem ligou não tem conta naquela empresa).
// - O dia é o de Brasília (coluna em UTC).
import { and, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { contasVinculadas, gotoRamais, pabxLigacoesProcessadas, pabxRamais, registroContato } from '../db/schema.js'
import { hojeBrString, mesReferenciaAtual } from './dataBr.js'
import { metaDaPessoa, metasPorEmpresa } from './metaLigacoes.js'

type Contagem = { tentativas: number; efetivas: number }
export type LigacoesVendedor = {
  temRamal: boolean
  // Meta de efetivas da empresa (Odin Tubos: 30/dia); 0 = sem essa meta.
  metaEfetivasDia: number
  hoje: Contagem
  mes: Contagem
  porDia: Map<string, Contagem>
}

const somar = (m: Map<string, Contagem>, dia: string, tentativas: number, efetivas: number) => {
  const atual = m.get(dia) ?? { tentativas: 0, efetivas: 0 }
  m.set(dia, { tentativas: atual.tentativas + tentativas, efetivas: atual.efetivas + efetivas })
}

export async function ligacoesDosVendedores(vendedorIds: number[], desdeDia?: string): Promise<Map<number, LigacoesVendedor>> {
  const resultado = new Map<number, LigacoesVendedor>()
  if (!vendedorIds.length) return resultado

  const hoje = hojeBrString()
  const mes = mesReferenciaAtual()
  const inicio = `${desdeDia && desdeDia < mes ? desdeDia : mes} 03:00:00`

  // Mesma regra do contador (idsDaPessoa): a conta + as contas vinculadas a ela.
  const vinculos = await db.query.contasVinculadas.findMany({ where: inArray(contasVinculadas.userId, vendedorIds) })
  const contasDe = new Map<number, number[]>(vendedorIds.map((id) => [id, [id]]))
  for (const v of vinculos) contasDe.get(v.userId)?.push(v.contaVinculadaId)
  const todasContas = [...new Set([...contasDe.values()].flat())]

  const ramaisPabx = await db.select({ userId: pabxRamais.userId }).from(pabxRamais).where(inArray(pabxRamais.userId, todasContas))
  const ramaisGoto = await db.select({ userId: gotoRamais.userId }).from(gotoRamais).where(inArray(gotoRamais.userId, todasContas))
  const comPabx = new Set(ramaisPabx.map((r) => r.userId))
  const comRamal = new Set([...comPabx, ...ramaisGoto.map((r) => r.userId)])

  const diaPabx = sql<string>`substr(datetime(${pabxLigacoesProcessadas.dataHora}, '-3 hours'), 1, 10)`
  const linhasPabx = await db
    .select({ userId: pabxLigacoesProcessadas.userId, dia: diaPabx, tentativas: sql<number>`count(*)`, efetivas: sql<number>`sum(${pabxLigacoesProcessadas.efetiva} = 1)` })
    .from(pabxLigacoesProcessadas)
    .where(and(inArray(pabxLigacoesProcessadas.userId, todasContas), isNotNull(pabxLigacoesProcessadas.numeroExterno), gte(pabxLigacoesProcessadas.dataHora, inicio)))
    .groupBy(pabxLigacoesProcessadas.userId, diaPabx)

  const diaCard = sql<string>`substr(datetime(${registroContato.dataHora}, '-3 hours'), 1, 10)`
  const ligacoesDeOutraPessoa = db
    .select({ id: pabxLigacoesProcessadas.registroContatoId })
    .from(pabxLigacoesProcessadas)
    .where(and(isNotNull(pabxLigacoesProcessadas.registroContatoId), isNotNull(pabxLigacoesProcessadas.userId), gte(pabxLigacoesProcessadas.dataHora, inicio)))
  const linhasCard = await db
    .select({ vendedorId: registroContato.vendedorId, dia: diaCard, tentativas: sql<number>`count(*)`, efetivas: sql<number>`sum(${registroContato.efetiva} = 1)` })
    .from(registroContato)
    .where(
      and(
        inArray(registroContato.vendedorId, vendedorIds),
        eq(registroContato.tipo, 'ligacao'),
        isNull(registroContato.deletedAt),
        gte(registroContato.dataHora, inicio),
        or(eq(registroContato.origem, 'manual'), sql`${registroContato.id} not in ${ligacoesDeOutraPessoa}`)
      )
    )
    .groupBy(registroContato.vendedorId, diaCard)

  const metas = await metasPorEmpresa()
  for (const id of vendedorIds) {
    const contas = contasDe.get(id) ?? [id]
    const temRamal = contas.some((c) => comRamal.has(c))
    const porDia = new Map<string, Contagem>()
    if (temRamal) {
      for (const l of linhasPabx) if (l.userId != null && contas.includes(l.userId)) somar(porDia, l.dia, Number(l.tentativas), Number(l.efetivas ?? 0))
    } else {
      for (const l of linhasCard) if (l.vendedorId === id) somar(porDia, l.dia, Number(l.tentativas), Number(l.efetivas ?? 0))
    }
    const doMes = { tentativas: 0, efetivas: 0 }
    for (const [dia, c] of porDia) {
      if (dia < mes) continue
      doMes.tentativas += c.tentativas
      doMes.efetivas += c.efetivas
    }
    resultado.set(id, {
      temRamal,
      // O contador do topo só tem meta pra quem tem ramal do PABX: mesma regra.
      metaEfetivasDia: contas.some((c) => comPabx.has(c)) ? await metaDaPessoa(contas, metas) : 0,
      hoje: porDia.get(hoje) ?? { tentativas: 0, efetivas: 0 },
      mes: doMes,
      porDia,
    })
  }
  return resultado
}

// Campos que os painéis mostram. Com meta de efetivas, o ritmo do mês soma só as
// atendidas (igual ao contador); sem ela, segue a meta antiga sobre as tentativas.
export function camposLigacoes(l: LigacoesVendedor | undefined, metaAntigaDia: number, diasUteisAteHoje: number) {
  const hoje = l?.hoje ?? { tentativas: 0, efetivas: 0 }
  const mes = l?.mes ?? { tentativas: 0, efetivas: 0 }
  const metaEhEfetivas = !!l?.metaEfetivasDia
  const metaLigacoesDia = metaEhEfetivas ? l!.metaEfetivasDia : metaAntigaDia
  const metaLigacoesAcumulada = Math.round(metaLigacoesDia * diasUteisAteHoje)
  const ligacoesNaMeta = metaEhEfetivas ? mes.efetivas : mes.tentativas
  return {
    ligacoesHoje: hoje.tentativas,
    ligacoesEfetivasHoje: hoje.efetivas,
    percentualEfetividadeHoje: hoje.tentativas > 0 ? Math.round((hoje.efetivas / hoje.tentativas) * 1000) / 10 : 0,
    ligacoesMes: mes.tentativas,
    ligacoesEfetivasMes: mes.efetivas,
    ligacoesNaMeta,
    metaEhEfetivas,
    metaLigacoesDia,
    metaLigacoesAcumulada,
    bateuMetaLigacoes: metaLigacoesAcumulada > 0 ? ligacoesNaMeta >= metaLigacoesAcumulada : false,
    percentualMetaLigacoes: metaLigacoesAcumulada > 0 ? Math.round((ligacoesNaMeta / metaLigacoesAcumulada) * 1000) / 10 : 0,
  }
}

// Ligações efetivas por dia, somando os vendedores (gráfico de 14 dias).
export function efetivasPorDia(ligacoes: Iterable<LigacoesVendedor>): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of ligacoes) for (const [dia, c] of l.porDia) m.set(dia, (m.get(dia) ?? 0) + c.efetivas)
  return m
}
