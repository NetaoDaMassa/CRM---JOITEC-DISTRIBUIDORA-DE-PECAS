import { and, eq, gte, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { funilMensal, notifications } from '../db/schema.js'
import { diasDesde, mesReferenciaAtual } from './dataBr.js'
import { getConfigNumero } from './configuracoes.js'

const ETAPAS_ABERTAS = ['novo', 'abordagem', 'negociacao', 'sem_contato'] as const

// Avisa o vendedor quando um cliente do funil aberto do mês está há muito
// tempo sem contato — no máximo uma vez por semana por cliente, pra não
// martelar a mesma notificação toda hora que o scheduler roda.
export async function checarClientesSemContato(): Promise<{ criadas: number }> {
  const limiteDias = await getConfigNumero('dias_sem_contato_alerta', 7)
  const mesAtual = mesReferenciaAtual()
  const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const funis = await db.query.funilMensal.findMany({
    where: and(eq(funilMensal.mesReferencia, mesAtual), isNull(funilMensal.deletedAt)),
    with: { cliente: { columns: { razaoSocial: true } } },
  })

  let criadas = 0

  for (const funil of funis) {
    // Defesa contra funil_mensal órfão (cliente_id apontando pra um cliente
    // que não existe mais — só acontece se um cliente foi apagado direto no
    // banco sem passar pelo soft-delete da app, então o cascade de FK do
    // SQLite não roda). Não deveria acontecer no fluxo normal, mas não pode
    // derrubar o scheduler inteiro se acontecer.
    if (!funil.cliente) continue
    if (!ETAPAS_ABERTAS.includes(funil.etapa as (typeof ETAPAS_ABERTAS)[number])) continue

    const dias = diasDesde(funil.dataUltimoContato ?? funil.dataEntradaEtapa)
    if (dias === null || dias < limiteDias) continue

    const jaNotificadoRecente = await db.query.notifications.findFirst({
      where: and(
        eq(notifications.clienteId, funil.clienteId),
        eq(notifications.type, 'cliente_sem_contato'),
        gte(notifications.createdAt, seteDiasAtras)
      ),
    })
    if (jaNotificadoRecente) continue

    await db.insert(notifications).values({
      vendedorId: funil.vendedorId,
      clienteId: funil.clienteId,
      type: 'cliente_sem_contato',
      title: 'Cliente sem contato',
      message: `${funil.cliente.razaoSocial} está há ${dias} dia(s) sem contato.`,
    })
    criadas++
  }

  return { criadas }
}
