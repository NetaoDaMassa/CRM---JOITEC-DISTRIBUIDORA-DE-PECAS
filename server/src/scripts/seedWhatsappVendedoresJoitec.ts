// Carga ÚNICA — grava o WhatsApp dos vendedores da Joitec na coluna
// `users.whatsapp` (a mesma que os botões de Devolução já usam). A automação
// de aviso de leads novos lê SÓ dessa coluna; nenhum número fica no código
// do motor. Este script é dado de carga, no mesmo espírito dos
// `importar-carteira-*.ts`.
//
// Rodar:
//   Local:  npm run wa:seed-joitec -- --dry-run   (confere sem gravar)
//           npm run wa:seed-joitec
//   VPS:    docker compose exec backend node dist/scripts/seedWhatsappVendedoresJoitec.js --dry-run
//           docker compose exec backend node dist/scripts/seedWhatsappVendedoresJoitec.js
//
// Depois de rodar uma vez, para MUDAR/ADICIONAR número: edite a coluna
// `whatsapp` do usuário direto no CRM/banco, ou ajuste a lista abaixo e rode
// de novo (ele sobrescreve).
//
// Mapeamentos confirmados pelo gestor em 2026-08-27:
//   - "Josi"          → usuário `jean` (nome no cadastro: "Josemeri")
//   - "CLÁUDIA EGER"   → usuário `claudia` (nome no cadastro: "Claudia de Freitas")

import { config } from 'dotenv'
config()

import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { normalizarBr } from '../lib/whatsapp/telefone.js'

const EMPRESA_ID = 1 // Joitec Distribuidora de Peças

// username no CRM -> número informado pelo gestor, VERBATIM (só dígitos, com
// 55 na frente). É normalizado antes de gravar. Vários vieram com 8 dígitos
// depois do DDD (sem o "9" de celular) — não são "consertados" aqui de
// propósito: o envio testa as duas formas via onWhatsApp() (ver telefone.ts).
const ROSTER: Record<string, string> = {
  gustavo: '554789010859',
  antonio: '554797257408',
  sarah: '554788942786',
  yuri: '554796449522',
  guilherme: '554797193125',
  kati: '554797512416',
  gino: '554789039304',
  jean: '554789116976', // Josemeri / "Josi"
  enzo: '5547999612342',
  claudia: '554799858267', // "CLÁUDIA EGER"
  camila: '554796803694',
}

const dryRun = process.argv.includes('--dry-run')

async function run() {
  console.log(`[wa:seed-joitec] ${dryRun ? 'DRY RUN — nada será gravado' : 'gravando na coluna users.whatsapp'}\n`)
  let ok = 0
  const naoEncontrados: string[] = []

  for (const [username, bruto] of Object.entries(ROSTER)) {
    const numero = normalizarBr(bruto)
    const user = await db.query.users.findFirst({
      where: and(eq(users.username, username), eq(users.empresaId, EMPRESA_ID)),
      columns: { id: true, name: true, whatsapp: true },
    })
    if (!user) {
      naoEncontrados.push(username)
      console.warn(`  ⚠️  usuário "${username}" não encontrado na empresa ${EMPRESA_ID} — pulado`)
      continue
    }
    const antes = user.whatsapp?.trim() || '(vazio)'
    console.log(`  ${user.name.padEnd(32)} ${username.padEnd(10)} ${antes}  ->  ${numero}`)
    if (!dryRun) {
      await db
        .update(users)
        .set({ whatsapp: numero, updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) })
        .where(eq(users.id, user.id))
    }
    ok++
  }

  console.log(`\n[wa:seed-joitec] ${dryRun ? 'conferido' : 'gravado'}: ${ok} vendedor(es).` + (naoEncontrados.length ? ` Não encontrados: ${naoEncontrados.join(', ')}` : ''))
  process.exit(0)
}

run().catch((err) => {
  console.error('[wa:seed-joitec] erro:', err)
  process.exit(1)
})
