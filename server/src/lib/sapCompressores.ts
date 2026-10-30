import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas } from '../db/schema.js'
import { getConfigTexto } from './configuracoes.js'
import { limparCodigo, semZerosEsquerda } from './importSapHistorico.js'
import type { SapSessao } from './sapServiceLayer.js'

// Odin Compressores no SAP (filial 1) — pedido do João, 2026-10-30: da Odin
// Compressores o CRM só puxa a CARTEIRA DA BRUNA (vendedora interna de
// peças), igual ao que já vem da Joitec e da Odin Tubos: histórico de vendas,
// cotações, itens, venda automática e boletos. O resto da Odin Compressores
// (máquinas, externos) continua só no módulo Pedidos.
//   - carteiras puxadas: usuários do CRM em `sap_compressores_carteiras`
//     (padrão 30 = Bruna);
//   - todas as compras do cliente entram no histórico, de qualquer vendedor
//     do SAP (decisão do João: "tudo do cliente");
//   - venda automática só dos pedidos feitos pelos vendedores do SAP em
//     `sap_vendedores_compressores` (padrão 93 = BRUNA RAFAELLI) — máquina
//     vendida por externo vira Pedido (ordem) e já conta nos relatórios;
//   - os códigos de cliente da Odin Compressores no CRM vieram do sistema
//     antigo (ex.: "4" = JR Manutenção = C002798 no SAP): casa pelo código
//     e, se não bater, pelo CNPJ/CPF do cadastro do SAP.

export const SLUG_COMPRESSORES = 'odin-compressores'
export const FILIAL_COMPRESSORES = 1
const CARTEIRAS_PADRAO = '30'
const VENDEDORES_SAP_PADRAO = '93'

function listaNumeros(texto: string): Set<number> {
  return new Set(
    texto
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  )
}

export async function carteirasCompressores(): Promise<Set<number>> {
  return listaNumeros((await getConfigTexto('sap_compressores_carteiras')) ?? CARTEIRAS_PADRAO)
}

export async function vendedoresSapCompressores(): Promise<Set<number>> {
  return listaNumeros((await getConfigTexto('sap_vendedores_compressores')) ?? VENDEDORES_SAP_PADRAO)
}

export interface ClienteCompressores {
  id: number
  vendedorAtualId: number | null
  razaoSocial: string
  casadoPor: 'codigo' | 'cnpj'
}

const soDigitos = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '')

// CardCode do SAP → cliente da carteira (Odin Compressores). Só os códigos
// pedidos: o cadastro do SAP (CNPJ) é buscado só pros que não casaram pelo
// código, de 40 em 40 — ou vem pronto em `documentos` (CardCode → CNPJ/CPF),
// quando quem chama já baixou os cadastros.
export async function clientesCompressoresPorCodigoSap(
  sap: SapSessao,
  cardCodes: string[],
  documentos?: Map<string, string[]>
): Promise<Map<string, ClienteCompressores>> {
  const resultado = new Map<string, ClienteCompressores>()
  const codigos = [...new Set(cardCodes.filter(Boolean))]
  if (!codigos.length) return resultado
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, SLUG_COMPRESSORES), columns: { id: true } })
  const carteiras = await carteirasCompressores()
  if (!empresa || !carteiras.size) return resultado

  const lista = await db.query.clientes.findMany({
    where: and(eq(clientes.empresaId, empresa.id), isNull(clientes.deletedAt), inArray(clientes.vendedorAtualId, [...carteiras])),
    columns: { id: true, codigo: true, codigoAntigo: true, cnpj: true, cpf: true, razaoSocial: true, vendedorAtualId: true },
  })
  const porCodigo = new Map<string, (typeof lista)[number]>()
  const porDocumento = new Map<string, (typeof lista)[number]>()
  for (const c of lista) {
    for (const cod of [c.codigo, c.codigoAntigo]) {
      if (!cod) continue
      const limpo = limparCodigo(cod)
      if (!porCodigo.has(limpo)) porCodigo.set(limpo, c)
      const sz = semZerosEsquerda(limpo)
      if (!porCodigo.has(sz)) porCodigo.set(sz, c)
    }
    for (const doc of [soDigitos(c.cnpj), soDigitos(c.cpf)]) if (doc.length >= 11 && !porDocumento.has(doc)) porDocumento.set(doc, c)
  }

  const faltam: string[] = []
  for (const cardCode of codigos) {
    const limpo = limparCodigo(cardCode)
    // Só código no formato do SAP (C000123) — os números curtos do sistema
    // antigo ("4", "11") não podem casar com nada por acaso.
    const c = /^[A-Z]\d{3,}$/.test(limpo) ? (porCodigo.get(limpo) ?? porCodigo.get(semZerosEsquerda(limpo))) : undefined
    if (c) resultado.set(cardCode, { id: c.id, vendedorAtualId: c.vendedorAtualId, razaoSocial: c.razaoSocial, casadoPor: 'codigo' })
    else faltam.push(cardCode)
  }
  if (!faltam.length || !porDocumento.size) return resultado

  if (documentos) {
    for (const cardCode of faltam) {
      const c = (documentos.get(cardCode) ?? []).map((d) => porDocumento.get(soDigitos(d))).find(Boolean)
      if (c) resultado.set(cardCode, { id: c.id, vendedorAtualId: c.vendedorAtualId, razaoSocial: c.razaoSocial, casadoPor: 'cnpj' })
    }
    return resultado
  }

  for (let i = 0; i < faltam.length; i += 40) {
    const filtro = faltam
      .slice(i, i + 40)
      .map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`)
      .join(' or ')
    const bps = await sap.getTodos<{ CardCode: string; BPFiscalTaxIDCollection?: { TaxId0: string | null; TaxId4: string | null }[] }>(
      `/BusinessPartners?$select=CardCode,BPFiscalTaxIDCollection&$filter=${encodeURIComponent(filtro)}`,
      100
    )
    for (const bp of bps) {
      for (const t of bp.BPFiscalTaxIDCollection ?? []) {
        const c = porDocumento.get(soDigitos(t.TaxId0)) ?? porDocumento.get(soDigitos(t.TaxId4))
        if (c) {
          resultado.set(bp.CardCode, { id: c.id, vendedorAtualId: c.vendedorAtualId, razaoSocial: c.razaoSocial, casadoPor: 'cnpj' })
          break
        }
      }
    }
  }
  return resultado
}

// Ligação cliente do CRM ↔ código do SAP da carteira da Bruna, gravada a cada
// foto das contas a receber (lib/sapContasReceber.ts) — os boletos são
// guardados pelo código do SAP e o código do CRM dela é do sistema antigo.
export const CHAVE_CODIGOS_COMPRESSORES = 'sap_compressores_codigos'

export async function codigosSapCompressores(): Promise<Map<number, string[]>> {
  const m = new Map<number, string[]>()
  try {
    const obj = JSON.parse((await getConfigTexto(CHAVE_CODIGOS_COMPRESSORES)) ?? '{}') as Record<string, number>
    for (const [codigo, clienteId] of Object.entries(obj)) m.set(clienteId, [...(m.get(clienteId) ?? []), codigo])
  } catch {
    // config estragada: sem ligação até a próxima foto
  }
  return m
}
