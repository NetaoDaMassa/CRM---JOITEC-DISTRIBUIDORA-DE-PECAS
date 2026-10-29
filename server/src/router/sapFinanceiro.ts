import { z } from 'zod'
import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, empresas, sapSaldosClientes, sapTitulosAbertos } from '../db/schema.js'
import { getConfigNumero, getConfigTexto } from '../lib/configuracoes.js'
import { hojeBrString } from '../lib/dataBr.js'

// Quem está devendo, segundo o SAP (lib/sapContasReceber.ts) — pedido do
// João, 2026-10-29: o vendedor vê no card do Kanban e na ficha. Só aviso, não
// bloqueia nada. A dívida é do GRUPO (o código do cliente no SAP é o mesmo
// nas 3 filiais), então a Joitec vê também o que o cliente deve à Odin Tubos.
//
// Carência (`sap_inadimplencia_carencia_dias`, padrão 5): só marca o cliente
// depois de X dias do vencimento — boleto pago ontem pode ainda não ter a
// baixa lançada no SAP.

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86400000)

async function carenciaDias(): Promise<number> {
  return getConfigNumero('sap_inadimplencia_carencia_dias', 5)
}

// Em quais empresas do CRM o aviso aparece (`sap_inadimplencia_empresas`,
// slugs separados por vírgula) — João começou só com Joitec e Odin Tubos
// (2026-10-29). Mostra TODOS os valores, inclusive os títulos antigos.
async function inadimplenciaLigada(empresaId: number): Promise<boolean> {
  const lista = ((await getConfigTexto('sap_inadimplencia_empresas')) ?? 'joitec,odin-tubos').split(',').map((s) => s.trim())
  const e = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId), columns: { slug: true } })
  return !!e && lista.includes(e.slug)
}

export const sapFinanceiroRouter = router({
  // Clientes da empresa ativa com título vencido além da carência →
  // { clienteId, vencido, maiorAtraso }. O vendedor só recebe os dele.
  inadimplentes: protectedProcedure.query(async ({ ctx }) => {
    if (!(await inadimplenciaLigada(ctx.empresaId))) return []
    const hoje = hojeBrString()
    const carencia = await carenciaDias()
    const porCodigo = await db
      .select({
        codigo: sapTitulosAbertos.codigoCliente,
        vencido: sql<number>`sum(${sapTitulosAbertos.valorAberto})`,
        maisAntigo: sql<string>`min(${sapTitulosAbertos.vencimento})`,
      })
      .from(sapTitulosAbertos)
      .where(and(gt(sapTitulosAbertos.valorAberto, 0), lt(sapTitulosAbertos.vencimento, hoje)))
      .groupBy(sapTitulosAbertos.codigoCliente)
    const devedores = porCodigo.filter((d) => diasEntre(d.maisAntigo, hoje) > carencia)
    if (!devedores.length) return []
    const codigos = devedores.map((d) => d.codigo)
    const lista = await db.query.clientes.findMany({
      where: and(
        eq(clientes.empresaId, ctx.empresaId),
        isNull(clientes.deletedAt),
        or(inArray(clientes.codigo, codigos), inArray(clientes.codigoAntigo, codigos)),
        ctx.user.role === 'admin' ? undefined : eq(clientes.vendedorAtualId, ctx.user.id)
      ),
      columns: { id: true, codigo: true, codigoAntigo: true },
    })
    const porCod = new Map(devedores.map((d) => [d.codigo, d]))
    return lista.flatMap((c) => {
      const d = porCod.get(c.codigo) ?? (c.codigoAntigo ? porCod.get(c.codigoAntigo) : undefined)
      return d ? [{ clienteId: c.id, vencido: Math.round(d.vencido * 100) / 100, maiorAtraso: diasEntre(d.maisAntigo, hoje) }] : []
    })
  }),

  // Ficha / card aberto: todos os títulos em aberto do cliente (vencidos e a
  // vencer), em todas as empresas do grupo.
  doCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    if (!(await inadimplenciaLigada(ctx.empresaId))) return null
    const cliente = await db.query.clientes.findFirst({
      where: and(eq(clientes.id, input.clienteId), isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)),
      columns: { id: true, codigo: true, codigoAntigo: true, vendedorAtualId: true },
    })
    if (!cliente) throw new Error('Cliente não encontrado')
    if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')
    const codigos = [cliente.codigo, cliente.codigoAntigo].filter((c): c is string => !!c)
    const [titulos, saldos, carencia] = await Promise.all([
      db.select().from(sapTitulosAbertos).where(inArray(sapTitulosAbertos.codigoCliente, codigos)),
      db.select().from(sapSaldosClientes).where(inArray(sapSaldosClientes.codigoCliente, codigos)),
      carenciaDias(),
    ])
    const [{ atualizadoEm } = { atualizadoEm: null }] = await db
      .select({ atualizadoEm: sql<string | null>`max(${sapSaldosClientes.atualizadoEm})` })
      .from(sapSaldosClientes)
    const hoje = hojeBrString()
    const linhas = titulos
      .map((t) => ({
        tipo: t.tipo,
        documento: t.documento,
        parcela: t.parcela,
        emissao: t.emissao,
        vencimento: t.vencimento,
        valor: t.valorAberto,
        empresaSlug: t.empresaSlug,
        vendedor: t.vendedorSap,
        diasAtraso: t.vencimento && t.valorAberto > 0 ? Math.max(0, diasEntre(t.vencimento, hoje)) : 0,
      }))
      .sort((a, b) => (a.vencimento ?? '9999').localeCompare(b.vencimento ?? '9999'))
    const vencidas = linhas.filter((l) => l.diasAtraso > 0)
    const vencido = vencidas.reduce((s, l) => s + l.valor, 0)
    const maiorAtraso = vencidas.reduce((m, l) => Math.max(m, l.diasAtraso), 0)
    const saldoSap = saldos.reduce((s, x) => s + x.saldoSap, 0)
    const saldoCalculado = saldos.reduce((s, x) => s + x.saldoCalculado, 0)
    return {
      atualizadoEm,
      carenciaDias: carencia,
      inadimplente: maiorAtraso > carencia,
      vencido: Math.round(vencido * 100) / 100,
      aVencer: Math.round(linhas.filter((l) => l.valor > 0 && l.diasAtraso === 0).reduce((s, l) => s + l.valor, 0) * 100) / 100,
      creditos: Math.round(linhas.filter((l) => l.valor < 0).reduce((s, l) => s + l.valor, 0) * 100) / 100,
      maiorAtraso,
      saldoSap: Math.round(saldoSap * 100) / 100,
      confereComSap: Math.abs(saldoSap - saldoCalculado) < 1 || (saldoSap <= 0 && saldoCalculado <= 0),
      titulos: linhas,
    }
  }),
})
