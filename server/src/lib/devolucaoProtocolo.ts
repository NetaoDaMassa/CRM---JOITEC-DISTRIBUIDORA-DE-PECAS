import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { devolucaoChamados } from '../db/schema.js'
import { hojeBr } from './dataBr.js'

// Prefixo por empresa, igual ao sistema original (JOI/ODTC/ODC/CPT) — só
// muda o id de referência (lá era slug fixo, aqui é o empresaId real do
// CRM). Liberado pra todas as empresas a pedido do João — as 3 últimas
// (Joitec Automação, Comprefer, Compretec E-commerce) nunca tinham usado
// esse fluxo antes.
const PREFIXO_POR_EMPRESA: Record<number, string> = {
  1: 'JOI', // Joitec Distribuidora de Peças
  2: 'ODTC', // Odin Tubos e Conexões
  3: 'JTA', // Joitec Automação
  4: 'ODC', // Odin Compressores
  5: 'CPR', // Comprefer
  6: 'CPE', // Compretec E-commerce
  7: 'CPT', // Compretec Loja Física
}

export const EMPRESAS_DEVOLUCAO = Object.keys(PREFIXO_POR_EMPRESA).map(Number)

export function prefixoDevolucao(empresaId: number): string {
  return PREFIXO_POR_EMPRESA[empresaId] ?? 'DEV'
}

// Sequência global (não por empresa/ano, igual ao original).
//
// Antes o número vinha de `count(*) + 1`. Isso quebrava assim que QUALQUER
// chamado era excluído (o `db.delete(devolucaoChamados)` de `criar`/`excluir`
// no router é hard delete — não tem `deleted_at` nessa tabela): o total caía,
// o próximo número repetia um protocolo que ainda existia e o INSERT batia no
// UNIQUE de `devolucao_chamados.protocolo`. Resultado: não dava mais pra abrir
// chamado nenhum (achado do João, 2026-09-08 — "SQLITE_CONSTRAINT_UNIQUE").
//
// Agora pega o MAIOR número de sequência já usado (não o total) e soma 1, e
// ainda confere se o candidato já existe antes de devolver, subindo até achar
// um livre — resiliente a exclusão e a colisão residual.
export async function gerarProtocoloDevolucao(empresaId: number): Promise<string> {
  const ano = hojeBr().getUTCFullYear()
  const prefixo = prefixoDevolucao(empresaId)

  const todos = await db
    .select({ protocolo: devolucaoChamados.protocolo })
    .from(devolucaoChamados)

  let maiorSeq = 0
  for (const { protocolo } of todos) {
    const m = protocolo.match(/(\d+)\s*$/)
    if (m) maiorSeq = Math.max(maiorSeq, Number(m[1]))
  }

  let seq = maiorSeq + 1
  for (let tentativa = 0; tentativa < 100; tentativa++) {
    const candidato = `${prefixo}-${ano}-${String(seq).padStart(5, '0')}`
    const existe = await db.query.devolucaoChamados.findFirst({
      where: eq(devolucaoChamados.protocolo, candidato),
      columns: { id: true },
    })
    if (!existe) return candidato
    seq++
  }

  throw new Error('Não foi possível gerar um protocolo de devolução único — tente novamente.')
}
