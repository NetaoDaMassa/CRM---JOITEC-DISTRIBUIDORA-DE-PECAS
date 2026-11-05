// Ligações que ficaram SEM registro por 'numero_ambiguo' (mesmo telefone em
// mais de um cadastro) — agora a regra escolhe o cadastro mais provável.
// Este script tira essas ligações da lista de "já vistas" e busca de novo na
// PABXONE360 os últimos N dias (padrão 30): só elas são reprocessadas, o
// resto já foi visto e é pulado. Usado 2026-11-05 (Yasmin / Conectudo).
//
//   node dist/scripts/registrarAmbiguasPabx.js [--dias 30]
import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { pabxLigacoesProcessadas } from '../db/schema.js'
import { duracaoMinimaPabx, lerCredenciaisPabx, registrarLigacoesAutomaticasPabxone360 } from '../lib/pabxone360.js'

async function main() {
  await db.run(sql`PRAGMA busy_timeout = 30000`)
  const i = process.argv.indexOf('--dias')
  const dias = Math.min(58, Math.max(1, Number(i >= 0 ? process.argv[i + 1] : 30) || 30)) // API: no máximo 2 meses por consulta
  const cred = await lerCredenciaisPabx()
  if (!cred) throw new Error('PABXONE360 sem usuário/token configurado')
  const fim = new Date()
  const inicio = new Date(fim.getTime() - dias * 86400e3)
  const desde = inicio.toISOString().replace('T', ' ').slice(0, 19)

  const filtro = and(eq(pabxLigacoesProcessadas.motivoNaoRegistrado, 'numero_ambiguo'), gte(pabxLigacoesProcessadas.dataHora, desde))
  // Guarda as linhas inteiras: se a PABXONE360 falhar no meio, devolve.
  const apagadas = await db.select().from(pabxLigacoesProcessadas).where(filtro)
  await db.delete(pabxLigacoesProcessadas).where(filtro)
  console.log(`${apagadas.length} ligação(ões) 'numero_ambiguo' nos últimos ${dias} dias — reprocessando...`)
  if (!apagadas.length) return

  let resultados
  try {
    resultados = await registrarLigacoesAutomaticasPabxone360(cred, inicio, fim, await duracaoMinimaPabx(), true)
  } catch (e) {
    for (const l of apagadas) await db.insert(pabxLigacoesProcessadas).values(l).onConflictDoNothing()
    throw e
  }
  // Alguma que a PABXONE360 não devolveu: volta como estava.
  const voltaram = new Set(resultados.map((r) => r.chamadaId))
  for (const l of apagadas) if (!voltaram.has(l.chamadaId)) await db.insert(pabxLigacoesProcessadas).values(l).onConflictDoNothing()
  for (const r of resultados) {
    console.log(`  ${r.chamadaId}: ${r.registroContatoId ? `registrada no cliente #${r.clienteId}` : r.leadId ? `registrada no lead #${r.leadId}` : `não registrada (${r.motivoNaoRegistrado})`}`)
  }
  const faltando = apagadas.filter((l) => !voltaram.has(l.chamadaId)).length
  if (faltando) console.log(`ATENÇÃO: ${faltando} não voltaram da PABXONE360 nesse período (ficaram como estavam).`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
