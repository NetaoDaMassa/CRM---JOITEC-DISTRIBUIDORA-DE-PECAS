// Busca de novo na PABXONE360 as ligações dos últimos N dias (padrão 30) e
// completa link da gravação / resumo / transcrição que ficaram vazios.
// Usado 2026-11-04: o link vinha como lista e era descartado.
//
//   node dist/scripts/completarGravacoesPabx.js [--dias 30]
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { completarResumosPabxone360, duracaoMinimaPabx, lerCredenciaisPabx } from '../lib/pabxone360.js'

async function main() {
  await db.run(sql`PRAGMA busy_timeout = 30000`)
  const i = process.argv.indexOf('--dias')
  const dias = Math.min(58, Math.max(1, Number(i >= 0 ? process.argv[i + 1] : 30) || 30)) // API: no máximo 2 meses por consulta
  const cred = await lerCredenciaisPabx()
  if (!cred) throw new Error('PABXONE360 sem usuário/token configurado')
  const fim = new Date()
  const atualizadas = await completarResumosPabxone360(cred, new Date(fim.getTime() - dias * 86400e3), fim, await duracaoMinimaPabx())
  const tot = (await db.all(sql`SELECT count(*) n, sum(link_gravacao IS NOT NULL) grav FROM pabx_ligacoes_processadas WHERE data_hora >= datetime('now', ${`-${dias} days`})`)) as { n: number; grav: number }[]
  console.log(`Últimos ${dias} dias: ${atualizadas} ligação(ões) completada(s). Agora ${tot[0]?.grav ?? 0} de ${tot[0]?.n ?? 0} têm gravação.`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
