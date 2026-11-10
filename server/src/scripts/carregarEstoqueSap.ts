// Carrega de uma vez o que falta do histórico de vendas/entradas dos
// relatórios de estoque (lib/sapEstoque.ts), um mês por vez, em vez de 15
// dias a cada 15 min. Pedido do João, 2026-11-10: rodar no horário de almoço,
// porque enquanto roda a Expedição, as cotações e as vendas do SAP atrasam.
//
//   node dist/scripts/carregarEstoqueSap.js
import { situacaoHistoricoEstoque, sincronizarEstoqueSap } from '../lib/sapEstoque.js'
import { sapConfigurado } from '../lib/sapServiceLayer.js'

async function main() {
  if (!sapConfigurado()) throw new Error('SAP não configurado no .env (SAP_SL_*)')
  const inicio = Date.now()
  for (let i = 0; i < 20; i++) {
    const r = await sincronizarEstoqueSap({ diasPorRodada: 31 })
    if (r.itensEstoque !== null) console.log(`estoque atualizado: ${r.itensEstoque} item(ns) em Revenda`)
    if (!r.historico) break
    console.log(`histórico ${r.historico.de} a ${r.historico.ate}: ${r.historico.vendas} venda(s), ${r.historico.entradas} entrada(s) — ${Math.round((Date.now() - inicio) / 60_000)} min`)
  }
  const s = await situacaoHistoricoEstoque()
  console.log(s.completo ? `PRONTO: histórico completo até ${s.historicoAte}.` : `Parou em ${s.historicoAte} — o resto entra sozinho de 15 em 15 min.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERRO:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
