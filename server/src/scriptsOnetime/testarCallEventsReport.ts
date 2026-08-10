// ⚠️ TEMPORÁRIO — só leitura, não grava nada. Busca um relatório real via
// GET /call-events-report/v1/reports/{conversationSpaceId} usando um
// conversationSpaceId real capturado nos logs de hoje, só pra confirmar o
// formato de verdade do payload antes de migrar a integração (Passo 2).
import { obterAccessTokenValido } from '../lib/goto.js'

const IDS_REAIS = [
  '3c68f7cf-39ac-3aee-b529-fe313395aeca', // INBOUND, 10/08 17:32
  'af72d877-3841-3a81-be72-73e7de908849', // OUTBOUND, 10/08 17:15
]

async function run() {
  const accessToken = await obterAccessTokenValido()
  for (const id of IDS_REAIS) {
    console.log(`\n===== GET /call-events-report/v1/reports/${id} =====`)
    const res = await fetch(`https://api.goto.com/call-events-report/v1/reports/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    console.log('status:', res.status)
    const texto = await res.text()
    console.log('corpo:', texto)
  }
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
