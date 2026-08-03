import { and, eq, isNull, isNotNull, lt } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, funilMensal } from '../db/schema.js'
import { mesReferenciaAtual } from './dataBr.js'

const ETAPAS_ABERTAS = ['novo', 'abordagem', 'interessado', 'negociacao', 'sem_contato']

// Roda todo dia (idempotente — só cria o que ainda não existe): garante que
// todo cliente com vendedor tenha um funil_mensal no mês corrente. Se o funil
// do mês anterior não tinha fechado nem perdido, o novo nasce marcado
// "carregado_mes_anterior" (mesma regra do spec original em Postgres).
export async function executarResetMensal(): Promise<{ criados: number }> {
  const mesAtual = mesReferenciaAtual()

  const clientesAtivos = await db.query.clientes.findMany({
    where: and(isNull(clientes.deletedAt), isNotNull(clientes.vendedorAtualId)),
    columns: { id: true, vendedorAtualId: true },
  })

  let criados = 0

  for (const cliente of clientesAtivos) {
    if (!cliente.vendedorAtualId) continue

    const jaExiste = await db.query.funilMensal.findFirst({
      where: and(eq(funilMensal.clienteId, cliente.id), eq(funilMensal.mesReferencia, mesAtual)),
    })
    if (jaExiste) continue

    // Um cliente pode ter tido mais de um orçamento aberto ao mesmo tempo no
    // mês anterior (múltiplos orçamentos em paralelo) — carrega cada um que
    // ainda estava em aberto, não só o primeiro que a busca encontrar.
    const mesesAnteriores = await db.query.funilMensal.findMany({
      where: and(eq(funilMensal.clienteId, cliente.id), lt(funilMensal.mesReferencia, mesAtual), isNull(funilMensal.deletedAt)),
      orderBy: (f, { desc }) => [desc(f.mesReferencia)],
    })
    const ultimoMesReferencia = mesesAnteriores[0]?.mesReferencia
    const funisAbertosUltimoMes = ultimoMesReferencia
      ? mesesAnteriores.filter((f) => f.mesReferencia === ultimoMesReferencia && ETAPAS_ABERTAS.includes(f.etapa))
      : []

    if (funisAbertosUltimoMes.length > 0) {
      for (const f of funisAbertosUltimoMes) {
        await db.insert(funilMensal).values({
          clienteId: cliente.id,
          vendedorId: cliente.vendedorAtualId,
          mesReferencia: mesAtual,
          etapa: 'novo',
          carregadoMesAnterior: true,
        })
      }
    } else {
      await db.insert(funilMensal).values({
        clienteId: cliente.id,
        vendedorId: cliente.vendedorAtualId,
        mesReferencia: mesAtual,
        etapa: 'novo',
        carregadoMesAnterior: false,
      })
    }
    criados++
  }

  return { criados }
}
