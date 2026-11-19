import { atualizarCobrancas } from './cobrancaSap.js'
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
import { verificarCadastrosAprovadosNoSap } from '../router/cadastrosClientes.js'
import { verificarVendedoresNovosSap } from './sapVendedoresNovos.js'
import { sincronizarEstoqueSap } from './sapEstoque.js'
import { sincronizarCatalogoSap } from './sapCatalogo.js'
import { sincronizarNfRapida } from './sapNfRapida.js'
import { sincronizarNfOrdensOdin } from './sapNfOrdensOdin.js'
import { sincronizarIsentosSap } from './sapIsentos.js'

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
    const cob = await atualizarCobrancas().catch((e) => (console.error('[cobranca] erro', e), null))
    if (cob && (cob.novos || cob.pagos || cob.cartorio || cob.rc)) console.log(`[cobranca] ${cob.novos} novo(s), ${cob.pagos} pago(s), ${cob.cartorio} p/ cartório, ${cob.rc} p/ RC`)
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

// NF rápida (lib/sapNfRapida.ts) — de minuto em minuto, só no horário em que
// sai nota (seg–sáb, 7h–20h de Brasília), com `sap_sync_ativo` ligado. Lê só
// as notas de ontem e hoje (~1 s) e preenche o nº da NF de venda/Expedição.
let rodandoNfRapida = false

export async function rodarNfRapidaSap(): Promise<void> {
  const br = new Date(Date.now() - 3 * 3600_000)
  if (br.getUTCDay() === 0 || br.getUTCHours() < 7 || br.getUTCHours() >= 20) return
  if (rodandoNfRapida || !sapConfigurado() || !(await getConfigBool('sap_sync_ativo', false))) return
  rodandoNfRapida = true
  try {
    const r = await sincronizarNfRapida()
    if (r.vendas || r.expedicao || r.garantias) console.log(`[sap-nf-rapida] NF chegou: ${r.vendas} venda(s), ${r.expedicao} pedido(s) da Expedição, ${r.garantias} garantia(s)`)
  } catch (err) {
    console.error('[sap-nf-rapida] erro:', err instanceof Error ? err.message : err)
  } finally {
    rodandoNfRapida = false
  }
}

// NF do SAP na aba Faturamento dos Pedidos da Odin Compressores
// (lib/sapNfOrdensOdin.ts, João 2026-11-19): de minuto em minuto lê as notas
// de ontem/hoje da filial 1 (mesmo horário da NF rápida); de meia em meia
// hora, 120 dias (pega NF antiga quando o nº do pedido foi digitado depois).
let rodandoNfOrdens = false

export async function rodarNfOrdensOdinSap(dias = 1): Promise<void> {
  if (dias <= 1) {
    const br = new Date(Date.now() - 3 * 3600_000)
    if (br.getUTCDay() === 0 || br.getUTCHours() < 7 || br.getUTCHours() >= 20) return
  }
  if (rodandoNfOrdens || !sapConfigurado() || !(await getConfigBool('sap_sync_ativo', false))) return
  rodandoNfOrdens = true
  try {
    const r = await sincronizarNfOrdensOdin(dias)
    if (r.preenchidos) console.log(`[sap-nf-pedidos-odin] NF do SAP em ${r.preenchidos} pedido(s) da Odin Compressores`)
  } catch (err) {
    console.error('[sap-nf-pedidos-odin] erro:', err instanceof Error ? err.message : err)
  } finally {
    rodandoNfOrdens = false
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
  // Cadastro feito no CRM que a Izabelly ativou direto no SAP → aprovado.
  try {
    const n = await verificarCadastrosAprovadosNoSap()
    if (n) console.log(`[sap-cadastros] ${n} cadastro(s) do CRM aprovado(s) direto no SAP`)
  } catch (err) {
    console.error('[sap-cadastros] erro:', err instanceof Error ? err.message : err)
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
    if (r.novas || r.nfs || r.freteSap || r.localizacoes || r.descartadosSap || r.retomados || r.soTubosPularam) console.log(`[sap-expedicao] ${r.novas} picking(s) novo(s), ${r.soTubosPularam} só tubos → embalagem, ${r.descartadosSap} descartado(s) no SAP, ${r.retomados} retomado(s) do descartado, ${r.nfs} NF(s), ${r.freteSap} volume/transportadora atualizados, ${r.localizacoes} item(ns) com endereço`)
  } catch (err) {
    console.error('[sap-expedicao] erro:', err instanceof Error ? err.message : err)
  } finally {
    rodandoExpedicao = false
  }
}

// Estoque de Revenda + entradas por item (lib/sapEstoque.ts) — de 15 em 15
// min: a foto do estoque só quando a última tem mais de 55 min, e mais 15
// dias do histórico por rodada até chegar em hoje. Com `sap_sync_ativo`.
let rodandoEstoque = false

export async function rodarEstoqueSap(): Promise<void> {
  if (rodandoEstoque || !sapConfigurado() || !(await getConfigBool('sap_sync_ativo', false))) return
  rodandoEstoque = true
  try {
    const r = await sincronizarEstoqueSap()
    if (r.itensEstoque !== null) console.log(`[sap-estoque] estoque: ${r.itensEstoque} item(ns) em Revenda, ${r.entradas} entrada(s) recentes`)
    if (r.historico) console.log(`[sap-estoque] histórico ${r.historico.de} a ${r.historico.ate}: ${r.historico.vendas} venda(s), ${r.historico.entradas} entrada(s)`)
  } catch (err) {
    console.error('[sap-estoque] erro:', err instanceof Error ? err.message : err)
  } finally {
    rodandoEstoque = false
  }
}

// Catálogo das Cotações do CRM (itens, preços, prazos, lista/prazo de cada
// cliente) — confere de hora em hora e refaz a cada 3 horas (sapCatalogo.ts).
let rodandoCatalogo = false
export async function rodarCatalogoSap(): Promise<void> {
  if (rodandoCatalogo || !sapConfigurado() || !(await getConfigBool('sap_sync_ativo', false))) return
  rodandoCatalogo = true
  try {
    const r = await sincronizarCatalogoSap()
    if (r) console.log(`[sap-catalogo] ${r.itens} item(ns), ${r.precos} preço(s), ${r.clientes} cliente(s)`)
  } catch (err) {
    console.error('[sap-catalogo] erro:', err instanceof Error ? err.message : err)
  } finally {
    rodandoCatalogo = false
  }
}

// Isento pela regra do SAP (lib/sapIsentos.ts) — uma vez por dia, de manhã.
let rodandoIsentos = false
export async function rodarIsentosSap(): Promise<void> {
  if (rodandoIsentos || !sapConfigurado() || !(await getConfigBool('sap_sync_ativo', false))) return
  rodandoIsentos = true
  try {
    const r = await sincronizarIsentosSap()
    if (r) console.log(`[sap-isentos] ${r.conferidos} cliente(s) conferido(s): ${r.viraramIsento} viraram isento, ${r.deixaramDeSer} deixaram de ser — ${r.isentosAgora} isento(s) agora`)
  } catch (err) {
    console.error('[sap-isentos] erro:', err instanceof Error ? err.message : err)
  } finally {
    rodandoIsentos = false
  }
}
