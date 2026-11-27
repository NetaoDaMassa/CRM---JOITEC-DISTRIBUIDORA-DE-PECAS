// Trava do motivo de perda (João, 2026-11-27 — caso AGROMOTORES: o texto do
// perdido foi reescrito e ficou mais "leve" que o original). Regras:
//   - perdido com motivo escrito não deixa reescrever: o vendedor só
//     ACRESCENTA (motivosPerda.complementar → funil_perda_comentarios tipo
//     'complemento', com nome e data);
//   - toda vez que um motivo já gravado é trocado por outro (card saiu de
//     Perdido e voltou, cancelamento de pedido, reclassificação de novembro)
//     o texto anterior vai pro log_auditoria (campo 'motivo_perda') e aparece
//     na tela Motivos de perda.
import { db } from '../db/client.js'
import { logAuditoria } from '../db/schema.js'

export const MSG_MOTIVO_TRAVADO =
  'O motivo dessa perda já foi registrado e não pode ser alterado. Se quiser acrescentar alguma coisa, use "Adicionar informação" no card.'

type FunilMotivo = {
  id: number
  motivoPerdaCategoria: string | null
  motivoPerdaObservacao: string | null
  motivoPerdaItem?: string | null
  motivoPerdaConcorrente?: string | null
  motivoPerdaReclassificar: boolean
}

export function motivoPerdaJaRegistrado(f: FunilMotivo): boolean {
  return !!f.motivoPerdaObservacao?.trim() && !f.motivoPerdaReclassificar
}

const igual = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim() === (b ?? '').trim()

// Veio alguma coisa diferente do que está gravado? Campo não enviado = mantém.
export function motivoPerdaMudou(
  f: FunilMotivo,
  input: { motivoPerdaCategoria?: string; motivoPerdaObservacao?: string; motivoPerdaItem?: string; motivoPerdaConcorrente?: string }
): boolean {
  if (input.motivoPerdaCategoria !== undefined && input.motivoPerdaCategoria !== f.motivoPerdaCategoria) return true
  if (input.motivoPerdaObservacao !== undefined && !igual(input.motivoPerdaObservacao, f.motivoPerdaObservacao)) return true
  if (input.motivoPerdaItem !== undefined && !igual(input.motivoPerdaItem, f.motivoPerdaItem)) return true
  if (input.motivoPerdaConcorrente !== undefined && !igual(input.motivoPerdaConcorrente, f.motivoPerdaConcorrente)) return true
  return false
}

// Guarda o motivo anterior quando ele é trocado por um diferente.
export async function auditarTrocaMotivo(f: FunilMotivo, categoriaNova: string, observacaoNova: string, userId: number) {
  if (!f.motivoPerdaObservacao?.trim()) return
  if (f.motivoPerdaCategoria === categoriaNova && igual(f.motivoPerdaObservacao, observacaoNova)) return
  await db.insert(logAuditoria).values({
    tabela: 'funil_mensal',
    registroId: f.id,
    acao: 'editar',
    campo: 'motivo_perda',
    valorAnterior: JSON.stringify({ categoria: f.motivoPerdaCategoria, texto: f.motivoPerdaObservacao }),
    valorNovo: JSON.stringify({ categoria: categoriaNova, texto: observacaoNova.trim() }),
    alteradoPor: userId,
  })
}
