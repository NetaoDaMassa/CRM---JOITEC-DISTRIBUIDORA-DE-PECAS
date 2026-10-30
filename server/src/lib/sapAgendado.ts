import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { getConfigBool } from './configuracoes.js'
import { sapConfigurado } from './sapServiceLayer.js'
import { sincronizarItensSap } from './sapSyncItens.js'
import { sincronizarContasReceberSap } from './sapContasReceber.js'
import { sincronizarVendasSap } from './sapVendasAuto.js'

// Rodada de hora em hora da integração com o SAP (scheduler.ts): itens das
// notas novas + foto das contas a receber. Desligada até alguém ligar
// `sap_sync_ativo` = 1 (o João libera depois de conferir) e sem
// SAP_SL_* no .env sai calada. Uma rodada por vez — a de contas a receber
// leva ~2 min (baixa todos os lançamentos e recebimentos).
let rodando = false

export async function rodarSincronizacaoSap(): Promise<void> {
  if (rodando || !sapConfigurado() || !(await getConfigBool('sap_sync_ativo', false))) return
  rodando = true
  try {
    const autor = await db.query.users.findFirst({ where: eq(users.superAdmin, true), columns: { id: true } })
    if (autor) {
      const itens = await sincronizarItensSap({ confirmar: true, usuarioId: autor.id })
      const novas = Object.values(itens.porEmpresa).reduce((s, e) => s + e.notas, 0)
      console.log(`[sap] itens: ${novas} nota(s) nova(s) (${itens.periodo.de} a ${itens.periodo.ate}), ${itens.naoEncontradas.length} de cliente fora do CRM`)
    }
    const receber = await sincronizarContasReceberSap()
    console.log(`[sap] contas a receber: ${receber.titulos} títulos, ${receber.conferem}/${receber.clientesComSaldo} clientes batem com o saldo do SAP (${receber.segundos}s)`)
  } catch (err) {
    console.error('[sap] erro na sincronização:', err instanceof Error ? err.message : err)
  } finally {
    rodando = false
  }
}

// Venda automática a partir do pedido do SAP (lib/sapVendasAuto.ts) — de 10
// em 10 min, só com `sap_sync_ativo` ligado e `sap_vendas_auto_desde` definido.
let rodandoVendas = false

export async function rodarVendasSap(): Promise<void> {
  if (rodandoVendas || !sapConfigurado() || !(await getConfigBool('sap_sync_ativo', false))) return
  rodandoVendas = true
  try {
    const r = await sincronizarVendasSap()
    if (r && (r.criadas || r.ligadas || r.canceladas || r.faturadas))
      console.log(`[sap-vendas] ${r.criadas} criada(s), ${r.ligadas} ligada(s) a registro manual, ${r.canceladas} cancelada(s), ${r.faturadas} faturada(s)`)
  } catch (err) {
    console.error('[sap-vendas] erro:', err instanceof Error ? err.message : err)
  } finally {
    rodandoVendas = false
  }
}
