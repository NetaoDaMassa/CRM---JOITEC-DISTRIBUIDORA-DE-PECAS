// Categorias da "Atividade da carteira" (ver reports.atividadeCarteira no
// servidor) — mesma ordem e cores da referência que o João mandou.
export const CATEGORIAS_ATIVIDADE = [
  { chave: 'ativo', rotulo: 'Ativos', cor: '#4cb860', ajuda: 'Compraram nos últimos 90 dias' },
  { chave: 'novo', rotulo: 'Novos', cor: '#7cc4f2', ajuda: 'Primeira compra da vida dentro do período' },
  { chave: 'recuperado', rotulo: 'Recuperados', cor: '#3a86d6', ajuda: 'Voltaram a comprar no período depois de mais de 180 dias parados' },
  { chave: 'quase_inativo', rotulo: 'Quase inativos', cor: '#e8c440', ajuda: 'Última compra entre 91 e 180 dias atrás' },
  { chave: 'inativo', rotulo: 'Inativos', cor: '#e5534b', ajuda: 'Última compra há mais de 180 dias' },
  { chave: 'nunca', rotulo: 'Nunca compraram', cor: '#9aa5b1', ajuda: 'Na carteira, sem compra registrada desde abril/2026 (início do histórico SAP)' },
] as const

export type CategoriaAtividade = (typeof CATEGORIAS_ATIVIDADE)[number]['chave']

export const categoriaInfo = (chave: string) => CATEGORIAS_ATIVIDADE.find((c) => c.chave === chave) ?? CATEGORIAS_ATIVIDADE[5]

// "Ativado" = não está inativo nem nunca comprou (taxa de ativação).
export const ehAtivado = (categoria: string) => categoria !== 'inativo' && categoria !== 'nunca'

export function contarCategorias<T extends { categoria: string }>(clientes: T[] | undefined) {
  const contagem: Record<string, number> = {}
  for (const c of clientes ?? []) contagem[c.categoria] = (contagem[c.categoria] ?? 0) + 1
  return CATEGORIAS_ATIVIDADE.map((c) => ({ chave: c.chave, rotulo: c.rotulo, cor: c.cor, ajuda: c.ajuda, valor: contagem[c.chave] ?? 0 }))
}
