import { db } from '../db/client.js'
import { logAuditoria } from '../db/schema.js'

type Acao = 'criar' | 'editar' | 'excluir' | 'restaurar' | 'mudar_etapa' | 'transferir_carteira'

export async function registrarAuditoria(params: {
  tabela: string
  registroId: number
  acao: Acao
  campo?: string
  valorAnterior?: string | null
  valorNovo?: string | null
  alteradoPor: number | null
}) {
  await db.insert(logAuditoria).values({
    tabela: params.tabela,
    registroId: params.registroId,
    acao: params.acao,
    campo: params.campo,
    valorAnterior: params.valorAnterior ?? null,
    valorNovo: params.valorNovo ?? null,
    alteradoPor: params.alteradoPor,
  })
}
