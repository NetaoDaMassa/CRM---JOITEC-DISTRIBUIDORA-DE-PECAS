// Cálculo ÚNICO de "cobertura de contato do mês", usado pelo widget do
// Kanban, pelo relatório e pelo alerta "cliente sem contato".
//
// Regras (definidas pelo João):
//  - Universo (denominador): a CARTEIRA INTEIRA do vendedor — clientes
//    ativos, não-prospect. Não é só o mês, não é só a coluna "Novo".
//  - "Contatado": o cliente teve QUALQUER contato (ligação, WhatsApp,
//    e-mail ou visita) registrado no card do mês corrente.
//  - CNPJ vinculado: contato no cliente A conta pro cliente B vinculado —
//    MAS só quando A e B são do MESMO vendedor. Vínculo entre carteiras de
//    vendedores diferentes não propaga.

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, funilMensal, registroContato, clienteVinculos } from '../db/schema.js'
import { mesReferenciaAtual } from './dataBr.js'

// União-busca (union-find) pra agrupar CNPJs vinculados do mesmo vendedor.
class UnionFind {
  private pai = new Map<number, number>()
  find(x: number): number {
    const p = this.pai.get(x)
    if (p === undefined || p === x) {
      this.pai.set(x, x)
      return x
    }
    const raiz = this.find(p)
    this.pai.set(x, raiz)
    return raiz
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.pai.set(ra, rb)
  }
}

export interface Cobertura {
  total: number
  contatados: number
  semContato: number
  percentual: number
}

// Cobertura de UM vendedor. `regiao` opcional filtra a carteira (usado pelo
// relatório, que tem filtro de região).
export async function coberturaContatosVendedor(
  empresaId: number,
  vendedorId: number,
  mesReferencia: string = mesReferenciaAtual(),
  regiao?: string,
): Promise<Cobertura> {
  // Denominador: carteira do vendedor.
  const filtros = [
    eq(clientes.empresaId, empresaId),
    eq(clientes.vendedorAtualId, vendedorId),
    eq(clientes.emProspeccao, false),
    isNull(clientes.deletedAt),
  ]
  if (regiao) filtros.push(eq(clientes.regiao, regiao as 'norte' | 'nordeste' | 'centro_oeste' | 'sudeste' | 'sul'))
  const carteira = await db.query.clientes.findMany({
    where: and(...filtros),
    columns: { id: true },
  })
  const total = carteira.length
  if (total === 0) return { total: 0, contatados: 0, semContato: 0, percentual: 0 }
  const idSet = new Set(carteira.map((c) => c.id))

  // Clientes do vendedor com algum contato no card do mês (qualquer tipo).
  const regs = await db
    .select({ clienteId: funilMensal.clienteId })
    .from(registroContato)
    .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
    .where(
      and(
        eq(funilMensal.vendedorId, vendedorId),
        eq(funilMensal.mesReferencia, mesReferencia),
        isNull(funilMensal.deletedAt),
        isNull(registroContato.deletedAt),
      ),
    )
  const comContatoProprio = new Set<number>(regs.map((r) => r.clienteId))

  // Vínculos (tabela pequena — pega tudo e filtra os que são da carteira deste vendedor).
  const vinculos = await db.query.clienteVinculos.findMany({
    columns: { clienteId: true, clienteVinculadoId: true },
  })
  const uf = new UnionFind()
  for (const id of idSet) uf.find(id)
  for (const v of vinculos) {
    if (idSet.has(v.clienteId) && idSet.has(v.clienteVinculadoId)) {
      uf.union(v.clienteId, v.clienteVinculadoId)
    }
  }

  // Um "grupo" (cliente + vinculados do mesmo vendedor) conta como contatado
  // se qualquer membro teve contato.
  const gruposContatados = new Set<number>()
  for (const cid of comContatoProprio) gruposContatados.add(uf.find(cid))

  let contatados = 0
  for (const id of idSet) if (gruposContatados.has(uf.find(id))) contatados++

  return {
    total,
    contatados,
    semContato: total - contatados,
    percentual: Math.round((contatados / total) * 100),
  }
}

// Pro alerta "cliente sem contato": pra cada cliente que tem card no mês,
// devolve a data do ÚLTIMO contato do GRUPO (cliente + vinculados do mesmo
// vendedor) naquele mês — ou null se o grupo não teve contato nenhum.
// O alerta usa isso no lugar de `funil.dataUltimoContato` (que só enxerga o
// contato do próprio card).
export async function ultimoContatoDoGrupoPorCliente(
  mesReferencia: string = mesReferenciaAtual(),
): Promise<Map<number, string>> {
  const cards = await db
    .select({ id: funilMensal.id, clienteId: funilMensal.clienteId, vendedorId: funilMensal.vendedorId })
    .from(funilMensal)
    .where(and(eq(funilMensal.mesReferencia, mesReferencia), isNull(funilMensal.deletedAt)))

  const vendedorDoCliente = new Map<number, number>()
  for (const c of cards) vendedorDoCliente.set(c.clienteId, c.vendedorId)

  const regs = await db
    .select({ clienteId: funilMensal.clienteId, dataHora: registroContato.dataHora })
    .from(registroContato)
    .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
    .where(
      and(
        eq(funilMensal.mesReferencia, mesReferencia),
        isNull(funilMensal.deletedAt),
        isNull(registroContato.deletedAt),
      ),
    )
  const ultimoProprio = new Map<number, string>()
  for (const r of regs) {
    const atual = ultimoProprio.get(r.clienteId)
    if (!atual || r.dataHora > atual) ultimoProprio.set(r.clienteId, r.dataHora)
  }

  const vinculos = await db.query.clienteVinculos.findMany({
    columns: { clienteId: true, clienteVinculadoId: true },
  })
  const uf = new UnionFind()
  for (const c of cards) uf.find(c.clienteId)
  for (const v of vinculos) {
    const va = vendedorDoCliente.get(v.clienteId)
    const vb = vendedorDoCliente.get(v.clienteVinculadoId)
    if (va !== undefined && vb !== undefined && va === vb) {
      uf.union(v.clienteId, v.clienteVinculadoId)
    }
  }

  // Máximo do contato próprio por grupo.
  const ultimoDoGrupo = new Map<number, string>()
  for (const [clienteId, dataHora] of ultimoProprio) {
    const raiz = uf.find(clienteId)
    const atual = ultimoDoGrupo.get(raiz)
    if (!atual || dataHora > atual) ultimoDoGrupo.set(raiz, dataHora)
  }

  // Espalha pro cada cliente que tem card no mês.
  const resultado = new Map<number, string>()
  for (const c of cards) {
    const d = ultimoDoGrupo.get(uf.find(c.clienteId))
    if (d) resultado.set(c.clienteId, d)
  }
  return resultado
}
