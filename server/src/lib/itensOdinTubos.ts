import { sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sapCatalogoItens, sapItemMovimentos } from '../db/schema.js'

// Tubos e conexões (PPR) são da Odin Tubos, mesmo quando a nota sai pela
// filial da Joitec (João, 2026-11-17 e 2026-11-19: "separar Odin Tubos e
// conexões, que é tudo PPR, e não deixar na Joitec"). Item da Odin Tubos =
// grupo do item no SAP "PPR" ou "ODIN TUBOS" (pega as conexões que não têm
// "PPR" no nome: bucha de redução, cap, bocal…) OU "PPR" no nome (item
// inativo que não está no catálogo, "MOLD PPR" do grupo JOITEC).
// Antes era só "PPR" na descrição de cada linha de nota.
export const GRUPOS_ODIN_TUBOS = ['PPR', 'ODIN TUBOS']
export const SLUGS_JOITEC = ['joitec', 'joitec-automacao']
// Venda da filial Joitec PARA a própria Odin Tubos é abastecimento (ela
// revende depois pela filial dela) — não conta como venda de item de
// ninguém, senão contaria duas vezes.
// Cadastro C003770 / CNPJ 54.774.805/0001-11 (ou o nome, pra outro código).
export const ehClienteOdinTubos = (razaoCol: unknown, codigoCol: unknown, cnpjCol: unknown) =>
  sql`(upper(${razaoCol}) like '%ODIN TUBOS%' or upper(trim(coalesce(${codigoCol}, ''))) = 'C003770' or replace(replace(replace(coalesce(${cnpjCol}, ''), '.', ''), '/', ''), '-', '') = '54774805000111')`

// `coluna` (código do item) está na lista acima. Lista vazia = nada.
export function sqlCodigoNaLista(coluna: unknown, codigos: Set<string>): SQL {
  if (!codigos.size) return sql`0`
  return sql`${coluna} in (${sql.join([...codigos].map((c) => sql`${c}`), sql`, `)})`
}

// Códigos dos itens da Odin Tubos (uma lista só pra todas as abas — antes a
// regra olhava a descrição de cada linha, e o mesmo item caía metade numa
// empresa e metade na outra quando a descrição mudava).
export async function codigosItensOdinTubos(): Promise<Set<string>> {
  const [cat, nomes] = await Promise.all([
    db.select({ c: sapCatalogoItens.itemCodigo, g: sapCatalogoItens.grupo, n: sapCatalogoItens.nome }).from(sapCatalogoItens),
    db
      .selectDistinct({ c: sapItemMovimentos.itemCodigo })
      .from(sapItemMovimentos)
      .where(sql`upper(coalesce(${sapItemMovimentos.itemNome}, '')) like '%PPR%'`),
  ])
  const s = new Set<string>()
  for (const r of cat) if (GRUPOS_ODIN_TUBOS.includes(r.g ?? '') || /PPR/i.test(r.n)) s.add(r.c)
  for (const r of nomes) s.add(r.c)
  return s
}
