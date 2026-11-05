import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { getConfigBool } from './configuracoes.js'
import { sapConfigurado } from './sapServiceLayer.js'
import { sincronizarItensSap } from './sapSyncItens.js'
import { sincronizarContasReceberSap } from './sapContasReceber.js'
import { sincronizarVendasSap } from './sapVendasAuto.js'
import { sincronizarCotacoesSap } from './sapCotacoesAuto.js'
import { sincronizarExpedicaoSap } from './sapExpedicao.js'
import { sincronizarClientesNovosSap } from './sapClientes.js'
import { verificarVendedoresNovosSap } from './sapVendedoresNovos.js'

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

// Cotações do SAP ao vivo (lib/sapCotacoesAuto.ts, Fase 1: só mostrar) — de
// 2 em 2 minutos, com `sap_sync_ativo` ligado.
let rodandoCotacoes = false

export async function rodarCotacoesSap(): Promise<void> {
  if (rodandoCotacoes || !sapConfigurado() || !(await getConfigBool('sap_sync_ativo', false))) return
  rodandoCotacoes = true
  try {
    const r = await sincronizarCotacoesSap()
    if (r && (r.novas || r.alteradas)) console.log(`[sap-cotacoes] ${r.novas} nova(s), ${r.alteradas} alterada(s), ${r.cardsParaNegociacao} card(s) pra Negociação`)
  } catch (err) {
    console.error('[sap-cotacoes] erro:', err instanceof Error ? err.message : err)
  } finally {
    rodandoCotacoes = false
  }
}

// Cadastro novo do SAP → cliente no CRM (lib/sapClientes.ts) — de 10 em 10
// min, com `sap_sync_ativo` ligado e `sap_clientes_auto_desde` definido.
let rodandoClientes = false

export async function rodarClientesSap(): Promise<void> {
  if (rodandoClientes || !sapConfigurado() || !(await getConfigBool('sap_sync_ativo', false))) return
  rodandoClientes = true
  try {
    const r = await sincronizarClientesNovosSap()
    if (r?.criados) console.log(`[sap-clientes] ${r.criados} cliente(s) novo(s) do SAP cadastrado(s), ${r.pendentes} esperando o gestor`)
  } catch (err) {
    console.error('[sap-clientes] erro:', err instanceof Error ? err.message : err)
  }
  try {
    const v = await verificarVendedoresNovosSap()
    if (v.baseCriada) console.log('[sap-vendedores] base criada: quem já está no SAP não entra na lista de novos')
    if (v.novos) console.log(`[sap-vendedores] ${v.novos} vendedor(es) novo(s) no SAP esperando o gestor`)
  } catch (err) {
    console.error('[sap-vendedores] erro:', err instanceof Error ? err.message : err)
  } finally {
    rodandoClientes = false
  }
}

// Fila do Controle do Estoque (lib/sapExpedicao.ts) — leve (só os pickings
// dos últimos dias), roda de 5 em 5 min com `expedicao_sap_ativo` ligado.
let rodandoExpedicao = false

export async function rodarExpedicaoSap(): Promise<void> {
  if (rodandoExpedicao || !sapConfigurado() || !(await getConfigBool('expedicao_sap_ativo', false))) return
  rodandoExpedicao = true
  try {
    const r = await sincronizarExpedicaoSap()
    if (r.novas || r.nfs || r.freteSap || r.localizacoes || r.descartadosSap || r.retomados) console.log(`[sap-expedicao] ${r.novas} picking(s) novo(s), ${r.descartadosSap} descartado(s) no SAP, ${r.retomados} retomado(s) do descartado, ${r.nfs} NF(s), ${r.freteSap} volume/transportadora atualizados, ${r.localizacoes} item(ns) com endereço`)
  } catch (err) {
    console.error('[sap-expedicao] erro:', err instanceof Error ? err.message : err)
  } finally {
    rodandoExpedicao = false
  }
}
