import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes } from '../db/schema.js'
import { agoraSqlite } from './dataBr.js'

// Venda de balcão da Compretec Loja Física não cria mais um cliente novo a
// cada venda (pedido do João, 2026-11-11: "pedidos de consumidor final não
// gerar um cliente novo"). Cada vendedor tem UM cadastro "CONSUMIDOR FINAL"
// e todas as vendas de balcão dele entram nele; nome/telefone de quem
// comprou ficam na própria venda (vendas.nomeComprador/telefoneComprador).
// Um por vendedor (e não um por empresa) pra continuar igual ao que já era:
// o cliente é do vendedor (histórico, permissões e relatórios por vendedor).
export const PREFIXO_CODIGO_BALCAO = 'CF-BALCAO-'
export const NOME_CLIENTE_BALCAO = 'CONSUMIDOR FINAL'

export function ehClienteBalcao(codigo: string | null | undefined): boolean {
  return !!codigo && codigo.startsWith(PREFIXO_CODIGO_BALCAO)
}

export async function clienteBalcaoDoVendedor(empresaId: number, vendedorId: number, criadoPor: number): Promise<number> {
  const codigo = `${PREFIXO_CODIGO_BALCAO}${vendedorId}`
  const existente = await db.query.clientes.findFirst({
    where: and(eq(clientes.empresaId, empresaId), eq(clientes.codigo, codigo)),
    columns: { id: true, deletedAt: true },
  })
  if (existente) {
    if (existente.deletedAt) await db.update(clientes).set({ deletedAt: null }).where(eq(clientes.id, existente.id))
    return existente.id
  }
  const r = await db.insert(clientes).values({
    empresaId,
    razaoSocial: NOME_CLIENTE_BALCAO,
    codigo,
    regiao: 'sul',
    statusFiscal: 'consumidor_final',
    cadastradoPor: criadoPor,
    vendedorAtualId: vendedorId,
    dataUltimaCompra: agoraSqlite(),
    // Igual aos clientes de balcão de antes: fora da carteira de verdade
    // (não volta como "Novo" todo mês, não conta na cobertura).
    emProspeccao: true,
  })
  return Number(r.lastInsertRowid)
}
