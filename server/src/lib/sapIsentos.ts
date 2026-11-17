import { and, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas } from '../db/schema.js'
import { setConfig } from './configuracoes.js'
import { registrarAuditoria } from './auditoria.js'
import { limparCodigo } from './importSapHistorico.js'
import { comSessaoSap, sapConfigurado } from './sapServiceLayer.js'
import type { SapSessao } from './sapServiceLayer.js'

// Isento vem do SAP (João, 2026-11-17): "quero deixar tudo com o padrão do
// SAP — no CRM o cadastro meio que foi à mão". Na conferência só 172 de 805
// isentos estavam marcados no CRM.
//
// Regra: no cadastro do SAP o cliente tem
//   Grupo = ISENTO  +  Indicador da IE = 9 (Não contribuinte)
//   +  Indicador de Op. Consumidor = 1 (Consumidor final)
// e NÃO é de SC (exceção). UF = endereço de cobrança do SAP; sem endereço,
// a UF do cadastro do CRM.
//
// O que muda no CRM (Status fiscal, que alimenta o selo da Expedição, o
// Faturamento isentos e a trava de coleta):
//   - bate a regra → 'isento'
//   - não bate e estava 'isento' → 'normal'
//   - os outros (normal / consumidor final / vazio) ficam como estão
// Cliente que não existe no SAP não é mexido. Só Joitec, Odin Tubos e Odin
// Automação (as que usam o SAP da Joitec).

const SLUGS = ['joitec', 'odin-tubos', 'joitec-automacao']
const GRUPO_ISENTO_PADRAO = 118

export interface BpIsento {
  CardCode: string
  GroupCode: number | null
  U_TX_IndIEDest: string | null
  U_TX_IndFinal: string | null
  BPAddresses?: { AddressType: string; State: string | null }[]
}

export function isentoPelaRegra(bp: BpIsento, gruposIsento: Set<number>, ufCrm: string | null): boolean {
  const end = bp.BPAddresses?.find((a) => a.AddressType === 'bo_BillTo' && a.State) ?? bp.BPAddresses?.find((a) => a.State)
  const uf = (end?.State ?? ufCrm ?? '').trim().toUpperCase()
  return bp.GroupCode != null && gruposIsento.has(bp.GroupCode) && bp.U_TX_IndIEDest === '9' && bp.U_TX_IndFinal === '1' && uf !== 'SC'
}

async function gruposIsentoSap(sap: SapSessao): Promise<Set<number>> {
  const grupos = await sap.getTodos<{ Code: number; Name: string }>('/BusinessPartnerGroups?$select=Code,Name').catch(() => [])
  const s = new Set(grupos.filter((g) => /isent/i.test(g.Name ?? '')).map((g) => g.Code))
  if (!s.size) s.add(GRUPO_ISENTO_PADRAO)
  return s
}

const CAMPOS = 'CardCode,GroupCode,U_TX_IndIEDest,U_TX_IndFinal,BPAddresses'

export interface ResultadoIsentos {
  clientesSap: number
  conferidos: number
  viraramIsento: number
  deixaramDeSer: number
  isentosAgora: number
  em: string
}

// Aplica a regra nos clientes do CRM. `bps` = cadastros do SAP já lidos
// (todos, ou só alguns quando é um cliente só).
export async function aplicarIsentos(bps: BpIsento[], gruposIsento: Set<number>, autorId: number | null = null): Promise<Omit<ResultadoIsentos, 'clientesSap' | 'em'>> {
  const porCodigo = new Map(bps.map((b) => [limparCodigo(b.CardCode), b]))
  const emp = await db.select({ id: empresas.id }).from(empresas).where(inArray(empresas.slug, SLUGS))
  const lista = await db
    .select({ id: clientes.id, codigo: clientes.codigo, codigoAntigo: clientes.codigoAntigo, estado: clientes.estado, statusFiscal: clientes.statusFiscal })
    .from(clientes)
    .where(and(isNull(clientes.deletedAt), inArray(clientes.empresaId, emp.map((e) => e.id))))
  const paraIsento: number[] = []
  const paraNormal: number[] = []
  let conferidos = 0
  let isentosAgora = 0
  for (const c of lista) {
    const bp = [c.codigo, c.codigoAntigo].map((k) => (k ? porCodigo.get(limparCodigo(k)) : undefined)).find(Boolean)
    if (!bp) {
      if (c.statusFiscal === 'isento') isentosAgora++
      continue
    }
    conferidos++
    const isento = isentoPelaRegra(bp, gruposIsento, c.estado)
    if (isento) isentosAgora++
    if (isento && c.statusFiscal !== 'isento') paraIsento.push(c.id)
    else if (!isento && c.statusFiscal === 'isento') paraNormal.push(c.id)
  }
  const anterior = new Map(lista.map((c) => [c.id, c.statusFiscal]))
  for (const [ids, novo] of [[paraIsento, 'isento'], [paraNormal, 'normal']] as const)
    for (let i = 0; i < ids.length; i += 500) {
      const lote = ids.slice(i, i + 500)
      await db.update(clientes).set({ statusFiscal: novo }).where(inArray(clientes.id, lote))
      for (const id of lote)
        await registrarAuditoria({ tabela: 'clientes', registroId: id, acao: 'editar', campo: 'statusFiscal (regra do SAP)', valorAnterior: anterior.get(id) ?? null, valorNovo: novo, alteradoPor: autorId })
    }
  return { conferidos, viraramIsento: paraIsento.length, deixaramDeSer: paraNormal.length, isentosAgora }
}

// Rodada completa (todo dia de manhã): lê todos os clientes do SAP.
export async function sincronizarIsentosSap(): Promise<ResultadoIsentos | null> {
  if (!sapConfigurado()) return null
  const { bps, grupos } = await comSessaoSap(async (sap) => ({
    grupos: await gruposIsentoSap(sap),
    bps: await sap.getTodos<BpIsento>(`/BusinessPartners?$filter=CardType eq 'cCustomer'&$select=${CAMPOS}`, 100),
  }))
  const r = { clientesSap: bps.length, ...(await aplicarIsentos(bps, grupos)), em: new Date().toISOString() }
  await setConfig('sap_isentos_ultima', JSON.stringify(r))
  return r
}

// Um cliente só (logo depois que o financeiro aprova o cadastro).
export async function atualizarIsentoDoCliente(cardCode: string, autorId: number | null): Promise<void> {
  if (!sapConfigurado()) return
  const codigo = cardCode.replace(/'/g, "''")
  const { bps, grupos } = await comSessaoSap(async (sap) => ({
    grupos: await gruposIsentoSap(sap),
    bps: await sap.getTodos<BpIsento>(`/BusinessPartners?$filter=CardCode eq '${codigo}'&$select=${CAMPOS}`),
  }))
  if (bps.length) await aplicarIsentos(bps, grupos, autorId)
}
