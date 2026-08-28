import { and, eq, isNull, isNotNull, lt } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, funilMensal } from '../db/schema.js'
import { mesReferenciaAtual } from './dataBr.js'

// Odin Compressores mantém a regra ANTIGA (tudo volta pra "novo") até ela
// ganhar regra própria.
const EMPRESA_ODIN_COMPRESSORES = 4

// ── Regra NOVA (todas as empresas, menos Odin Compressores) ─────────────────
// Card do mês que fechou → card do mês novo:
//   novo / abordagem / interessado / sem_contato  → "novo" (selo "carregado do mês anterior")
//   negociacao                                    → CONTINUA em "negociacao"
//                                                   (leva valor_orcado + pdf da proposta + selo;
//                                                    contador de contato zera; "entrou na etapa" = agora)
//   fechado / perdido                             → "novo" (sem selo)
//   faturamento / consumidor_final(_loja)         → NÃO cria card (fica parado onde está)
//   sem card no mês passado (cliente novo)        → "novo" (sem selo)
const ETAPAS_VOLTA_NOVO_CARREGADO = ['novo', 'abordagem', 'interessado', 'sem_contato']
const ETAPAS_TERMINAIS_SEM_CARD = ['faturamento', 'consumidor_final', 'consumidor_final_loja']

// ── Regra ANTIGA (Odin Compressores) ───────────────────────────────────────
// "aberto" = card volta pra "novo" com selo; o resto vira "novo" sem selo.
const ETAPAS_ABERTAS_ANTIGA = ['novo', 'abordagem', 'interessado', 'negociacao', 'sem_contato']

// Roda todo dia (idempotente — só cria o que ainda não existe): garante que
// todo cliente DA CARTEIRA (com vendedor e fora de prospecção) tenha o
// funil_mensal do mês corrente. Prospects ficam de fora — só entram na
// carteira quando o vendedor clica "enviar pra carteira".
export async function executarResetMensal(): Promise<{ criados: number }> {
  const mesAtual = mesReferenciaAtual()

  const clientesAtivos = await db.query.clientes.findMany({
    where: and(
      isNull(clientes.deletedAt),
      isNotNull(clientes.vendedorAtualId),
      eq(clientes.emProspeccao, false),
    ),
    columns: { id: true, empresaId: true, vendedorAtualId: true },
  })

  let criados = 0

  for (const cliente of clientesAtivos) {
    if (!cliente.vendedorAtualId) continue

    const jaExiste = await db.query.funilMensal.findFirst({
      where: and(eq(funilMensal.clienteId, cliente.id), eq(funilMensal.mesReferencia, mesAtual)),
    })
    if (jaExiste) continue

    // Cards do mês anterior mais recente (pode ter mais de um — orçamentos
    // em paralelo).
    const anteriores = await db.query.funilMensal.findMany({
      where: and(
        eq(funilMensal.clienteId, cliente.id),
        lt(funilMensal.mesReferencia, mesAtual),
        isNull(funilMensal.deletedAt),
      ),
      orderBy: (f, { desc }) => [desc(f.mesReferencia)],
    })
    const ultimoMes = anteriores[0]?.mesReferencia
    const cardsUltimoMes = ultimoMes ? anteriores.filter((f) => f.mesReferencia === ultimoMes) : []

    const base = { clienteId: cliente.id, vendedorId: cliente.vendedorAtualId, mesReferencia: mesAtual }
    let criouAlgum = false

    if (cliente.empresaId === EMPRESA_ODIN_COMPRESSORES) {
      // Regra antiga: cada card "aberto" vira um "novo" com selo.
      const abertos = cardsUltimoMes.filter((f) => ETAPAS_ABERTAS_ANTIGA.includes(f.etapa))
      for (const _f of abertos) {
        await db.insert(funilMensal).values({ ...base, etapa: 'novo', carregadoMesAnterior: true })
        criouAlgum = true
      }
    } else {
      // Regra nova.
      for (const f of cardsUltimoMes) {
        if (f.etapa === 'negociacao') {
          await db.insert(funilMensal).values({
            ...base,
            etapa: 'negociacao',
            carregadoMesAnterior: true,
            valorOrcado: f.valorOrcado,
            pdfPropostaPath: f.pdfPropostaPath,
          })
          criouAlgum = true
        } else if (ETAPAS_VOLTA_NOVO_CARREGADO.includes(f.etapa)) {
          await db.insert(funilMensal).values({ ...base, etapa: 'novo', carregadoMesAnterior: true })
          criouAlgum = true
        }
        // fechado / perdido → cai no fallback abaixo (novo sem selo)
        // faturamento / consumidor_final(_loja) → nada, fica parado
      }
    }

    if (!criouAlgum) {
      // Nenhum card carregado. Cria um "novo" limpo — MENOS quando os únicos
      // cards do mês passado eram terminais de loja (faturamento / consumidor
      // final): aí não cria nada, o card fica onde está.
      const soTerminaisLoja =
        cardsUltimoMes.length > 0 && cardsUltimoMes.every((f) => ETAPAS_TERMINAIS_SEM_CARD.includes(f.etapa))
      if (!soTerminaisLoja) {
        await db.insert(funilMensal).values({ ...base, etapa: 'novo', carregadoMesAnterior: false })
        criouAlgum = true
      }
    }

    if (criouAlgum) criados++
  }

  return { criados }
}
