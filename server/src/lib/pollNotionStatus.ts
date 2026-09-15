// Traz de volta pro CRM o status ("Não iniciada"/"Em andamento"/
// "Concluído") que a marketing move na coluna Status do Notion — pedido do
// João, 2026-09-14: quem pediu a arte/vídeo (e o admin) precisa ver em que
// pé está, sem entrar no Notion. O Notion não tem webhook pra integração
// interna simples que estamos usando, então isso é polling mesmo (mesmo
// padrão do pabxone360.ts, que também só tem REST).
import { and, eq, isNotNull, ne, or, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { solicitacoesDesign } from '../db/schema.js'
import { buscarStatusNotion } from './notion.js'
import { agoraSqlite } from './dataBr.js'

export async function sincronizarStatusNotion(): Promise<{ atualizados: number }> {
  // Só pedidos aprovados (têm página no Notion, `notionPageId` gravado em
  // design.ts na hora de aprovar) e ainda não "Concluído" — depois de
  // concluído não tem mais pra onde andar, poupa chamada à API pros
  // pedidos antigos que só vão se acumulando.
  const pendentes = await db.query.solicitacoesDesign.findMany({
    where: and(
      eq(solicitacoesDesign.status, 'aprovado'),
      isNotNull(solicitacoesDesign.notionPageId),
      or(isNull(solicitacoesDesign.notionStatus), ne(solicitacoesDesign.notionStatus, 'Concluído'))
    ),
    columns: { id: true, notionPageId: true, notionStatus: true },
  })

  let atualizados = 0
  for (const s of pendentes) {
    if (!s.notionPageId) continue
    const statusAtual = await buscarStatusNotion(s.notionPageId)
    if (statusAtual && statusAtual !== s.notionStatus) {
      await db
        .update(solicitacoesDesign)
        .set({ notionStatus: statusAtual, notionStatusAtualizadoEm: agoraSqlite() })
        .where(eq(solicitacoesDesign.id, s.id))
      atualizados++
    }
  }
  return { atualizados }
}
