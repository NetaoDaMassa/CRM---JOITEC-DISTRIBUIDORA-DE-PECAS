import { comSessaoSap, sapConfigurado } from './sapServiceLayer.js'

// Limite de crédito do cliente no SAP (João, 2026-11-11: "puxar os erros de
// falta de limite de crédito"). No SAP deles não há aprovação por crédito —
// só por desconto —, então o bloqueio aparece na hora de lançar o pedido e
// não fica registrado. Aqui o CRM avisa ANTES: limite − (saldo em aberto +
// pedidos abertos + entregas abertas) = disponível.
// Limite 0 no SAP = sem limite cadastrado (8.733 clientes em 11/11) — não avisa.
// Conferido em 11/11: 2.850 clientes com limite, 51 passando dele.

export interface LimiteCredito {
  limite: number
  usado: number
  disponivel: number
  saldo: number
  pedidosAbertos: number
}

type Bp = { CardCode: string; CreditLimit: number; CurrentAccountBalance: number; OpenOrdersBalance: number | null; OpenDeliveryNotesBalance: number | null }
const CAMPOS = 'CardCode,CreditLimit,CurrentAccountBalance,OpenOrdersBalance,OpenDeliveryNotesBalance'
const r2 = (n: number) => Math.round(n * 100) / 100

function calcular(b: Bp): LimiteCredito | null {
  if (!b.CreditLimit || b.CreditLimit <= 0) return null
  const pedidosAbertos = (b.OpenOrdersBalance ?? 0) + (b.OpenDeliveryNotesBalance ?? 0)
  const usado = (b.CurrentAccountBalance ?? 0) + pedidosAbertos
  return { limite: r2(b.CreditLimit), usado: r2(usado), disponivel: r2(b.CreditLimit - usado), saldo: r2(b.CurrentAccountBalance ?? 0), pedidosAbertos: r2(pedidosAbertos) }
}

// Foto de todos os clientes com limite (pro selo no Kanban). Fica em memória
// e é refeita de 30 em 30 min (scheduler); sem foto ainda, não mostra selo.
let foto = new Map<string, LimiteCredito>()
let fotoEm = 0

export async function atualizarFotoLimites(): Promise<number> {
  if (!sapConfigurado()) return 0
  const lista = await comSessaoSap((sap) => sap.getTodos<Bp>(`/BusinessPartners?$filter=CardType eq 'cCustomer' and CreditLimit gt 0&$select=${CAMPOS}`))
  const nova = new Map<string, LimiteCredito>()
  for (const b of lista) {
    const l = calcular(b)
    if (l) nova.set(b.CardCode.toUpperCase(), l)
  }
  foto = nova
  fotoEm = Date.now()
  return nova.size
}

// Da foto (rápido, sem ir ao SAP). Só clientes com limite cadastrado.
export function limiteDaFoto(codigo: string | null | undefined): LimiteCredito | null {
  if (!codigo) return null
  if (!fotoEm && sapConfigurado()) {
    fotoEm = Date.now() // evita disparar várias vezes
    void atualizarFotoLimites().catch((e) => console.error('[sap-limite] foto:', e instanceof Error ? e.message : e))
  }
  return foto.get(codigo.trim().toUpperCase()) ?? null
}

// Na hora, direto do SAP (tela da cotação). null = sem limite cadastrado.
export async function limiteAgora(codigo: string): Promise<LimiteCredito | null> {
  const b = await comSessaoSap((sap) => sap.get<Bp>(`/BusinessPartners('${encodeURIComponent(codigo.replace(/'/g, "''"))}')?$select=${CAMPOS}`))
  const l = calcular(b)
  if (l) foto.set(codigo.trim().toUpperCase(), l)
  else foto.delete(codigo.trim().toUpperCase())
  return l
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export function textoLimite(l: LimiteCredito): string {
  return `limite ${brl(l.limite)} · usado ${brl(l.usado)} · disponível ${brl(Math.max(0, l.disponivel))}`
}

// Empresas que usam o SAP (cadastro de cliente = código do SAP).
export const SLUGS_EMPRESAS_SAP = ['joitec', 'odin-tubos', 'joitec-automacao', 'odin-compressores']
