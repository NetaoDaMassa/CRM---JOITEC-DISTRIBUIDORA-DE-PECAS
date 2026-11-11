import { comSessaoSap, sapConfigurado } from './sapServiceLayer.js'

// Limite de crédito do cliente no SAP (João, 2026-11-11: "puxar os erros de
// falta de limite de crédito"). No SAP deles não há aprovação por crédito —
// só por desconto —, então o bloqueio aparece na hora de lançar o pedido e
// não fica registrado. Aqui o CRM avisa ANTES: limite − (saldo em aberto +
// pedidos abertos + entregas abertas) = disponível.
// Limite 0 no SAP = SEM limite: venda a prazo é recusada pelo SAP ("(13)
// CLIENTE SEM LIMITE DE CRÉDITO"), só à vista passa (vídeo do Portal One,
// 2026-11-11 — antes este arquivo tratava 0 como "não avisa", estava errado).
// Conferido em 11/11: 2.850 clientes com limite (51 passando dele) e 8.733 com 0.

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

function calcular(b: Bp): LimiteCredito {
  const pedidosAbertos = (b.OpenOrdersBalance ?? 0) + (b.OpenDeliveryNotesBalance ?? 0)
  const usado = (b.CurrentAccountBalance ?? 0) + pedidosAbertos
  const limite = b.CreditLimit > 0 ? b.CreditLimit : 0
  return { limite: r2(limite), usado: r2(usado), disponivel: r2(limite - usado), saldo: r2(b.CurrentAccountBalance ?? 0), pedidosAbertos: r2(pedidosAbertos) }
}

// Foto de todos os clientes com limite (pro selo no Kanban). Fica em memória
// e é refeita de 30 em 30 min (scheduler); sem foto ainda, não mostra selo.
let foto = new Map<string, LimiteCredito>()
let fotoEm = 0

export async function atualizarFotoLimites(): Promise<number> {
  if (!sapConfigurado()) return 0
  const lista = await comSessaoSap((sap) => sap.getTodos<Bp>(`/BusinessPartners?$filter=CardType eq 'cCustomer' and CreditLimit gt 0&$select=${CAMPOS}`))
  const nova = new Map<string, LimiteCredito>()
  for (const b of lista) nova.set(b.CardCode.toUpperCase(), calcular(b))
  foto = nova
  fotoEm = Date.now()
  return nova.size
}

// Código de cliente do SAP (C000123) — cadastro criado no CRM (P…) não tem limite no SAP.
const ehCodigoSap = (codigo: string) => /^C\d{4,}$/i.test(codigo.trim())

// Da foto (rápido, sem ir ao SAP). Cliente do SAP fora da foto = limite 0.
// null = não dá pra saber (sem foto ainda ou não é cliente do SAP).
export function limiteDaFoto(codigo: string | null | undefined): LimiteCredito | null {
  if (!codigo) return null
  if (!fotoEm && sapConfigurado()) {
    fotoEm = Date.now() // evita disparar várias vezes
    void atualizarFotoLimites().catch((e) => console.error('[sap-limite] foto:', e instanceof Error ? e.message : e))
  }
  const l = foto.get(codigo.trim().toUpperCase())
  if (l) return l
  if (foto.size && ehCodigoSap(codigo)) return { limite: 0, usado: 0, disponivel: 0, saldo: 0, pedidosAbertos: 0 }
  return null
}

// Na hora, direto do SAP (tela da cotação). null = não é cliente do SAP.
export async function limiteAgora(codigo: string): Promise<LimiteCredito | null> {
  if (!ehCodigoSap(codigo)) return null
  const b = await comSessaoSap((sap) => sap.get<Bp>(`/BusinessPartners('${encodeURIComponent(codigo.replace(/'/g, "''"))}')?$select=${CAMPOS}`))
  const l = calcular(b)
  if (l.limite > 0) foto.set(codigo.trim().toUpperCase(), l)
  else foto.delete(codigo.trim().toUpperCase())
  return l
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export function textoLimite(l: LimiteCredito): string {
  return `limite ${brl(l.limite)} · usado ${brl(l.usado)} · disponível ${brl(Math.max(0, l.disponivel))}`
}

// Empresas que usam o SAP (cadastro de cliente = código do SAP).
export const SLUGS_EMPRESAS_SAP = ['joitec', 'odin-tubos', 'joitec-automacao', 'odin-compressores']
