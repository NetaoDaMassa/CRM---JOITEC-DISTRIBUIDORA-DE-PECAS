import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { cobrancasRegistro, clientesCartorio, clientes } from '../db/schema.js'
import { ehDiaNaoUtil, hojeBrString } from './dataBr.js'

// Régua de cobrança (Financeiro → Negociações), pedido do João, 2026-10-28:
// depois do vencimento o cliente é cobrado nos dias úteis 1 a 5; no 6º dia
// útil, se a cobrança ainda estiver pendente, ela vai sozinha pro Cartório.
// Dia útil = seg-sex sem feriado (mesma regra do resto do sistema).
export const DIAS_REGUA = 5
export const DIA_CARTORIO = DIAS_REGUA + 1

// N-ésimo dia útil depois de `dataIso` (YYYY-MM-DD) — o próprio dia do
// vencimento não conta.
export function diaUtilApos(dataIso: string, n: number): string {
  const d = new Date(`${dataIso.slice(0, 10)}T00:00:00Z`)
  let contados = 0
  while (contados < n) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (!ehDiaNaoUtil(d)) contados++
  }
  return d.toISOString().slice(0, 10)
}

export function lerDiasCobrados(texto: string | null): number[] {
  if (!texto) return []
  return texto
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= DIAS_REGUA)
}

export function gravarDiasCobrados(dias: number[]): string | null {
  const unicos = [...new Set(dias)].sort((a, b) => a - b)
  return unicos.length ? unicos.join(',') : null
}

// Datas dos dias 1..5 e do dia do cartório pra um vencimento.
export function reguaDoVencimento(dataVencimento: string | null) {
  if (!dataVencimento) return null
  const dias = Array.from({ length: DIAS_REGUA }, (_, i) => ({ dia: i + 1, data: diaUtilApos(dataVencimento, i + 1) }))
  return { dias, cartorioEm: diaUtilApos(dataVencimento, DIA_CARTORIO) }
}

// Qual dia da régua é `hoje` pra esse vencimento (1..5), ou null se não cair
// em nenhum — usado pra marcar sozinho o dia em que a cobrança foi lançada.
export function diaDaReguaEm(dataVencimento: string | null, hoje: string): number | null {
  const regua = reguaDoVencimento(dataVencimento)
  return regua?.dias.find((d) => d.data === hoje)?.dia ?? null
}

// Cobranças pendentes que já chegaram no 6º dia útil → Cartório. Só uma vez
// por cobrança (`cartorioAutoEm`): se alguém voltar pra "Pendente" depois,
// ela fica lá. Sem `empresaId` roda pra todas (agendador).
export async function enviarVencidasAoCartorio(empresaId?: number): Promise<number> {
  const hoje = hojeBrString()
  const condicoes = [eq(cobrancasRegistro.status, 'pendente'), isNotNull(cobrancasRegistro.dataVencimento), isNull(cobrancasRegistro.cartorioAutoEm)]
  if (empresaId) condicoes.push(eq(clientes.empresaId, empresaId))
  const pendentes = await db
    .select({
      id: cobrancasRegistro.id,
      clienteId: cobrancasRegistro.clienteId,
      valor: cobrancasRegistro.valor,
      dataVencimento: cobrancasRegistro.dataVencimento,
      registradoPorId: cobrancasRegistro.registradoPorId,
    })
    .from(cobrancasRegistro)
    .innerJoin(clientes, eq(cobrancasRegistro.clienteId, clientes.id))
    .where(and(...condicoes))

  let movidas = 0
  for (const c of pendentes) {
    const cartorioEm = diaUtilApos(c.dataVencimento!, DIA_CARTORIO)
    if (hoje < cartorioEm) continue
    // Condição repetida no UPDATE pra duas execuções ao mesmo tempo não
    // criarem a linha do Cartório em dobro.
    const res = await db
      .update(cobrancasRegistro)
      .set({ status: 'cartorio', cartorioAutoEm: hoje })
      .where(and(eq(cobrancasRegistro.id, c.id), eq(cobrancasRegistro.status, 'pendente'), isNull(cobrancasRegistro.cartorioAutoEm)))
    if (!res.rowsAffected) continue
    const [ano, mes, dia] = c.dataVencimento!.slice(0, 10).split('-')
    await db.insert(clientesCartorio).values({
      clienteId: c.clienteId,
      valor: c.valor,
      enviadoEm: hoje,
      cobrancaId: c.id,
      observacoes: `Enviado automaticamente: ${DIA_CARTORIO}º dia útil após o vencimento de ${dia}/${mes}/${ano}`,
      criadoPorId: c.registradoPorId,
    })
    movidas++
  }
  return movidas
}
