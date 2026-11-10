// Catálogo único de permissões (funções vivas, 2026-11-09).
//
// Cada ITEM é uma tela/poder como o João enxerga ("Kanban de vendas",
// "Caixa"), agrupado por ÁREA, com NÍVEIS. Cada nível liga as chaves de
// `permissoes_admin` que o resto do CRM já confere (featureProcedure,
// adminOrFeatureProcedure, Sidebar...). Os níveis são cumulativos: o nível
// 3 inclui as chaves do 2, que inclui as do 1.
//
// Nada no resto do sistema lê este arquivo pra decidir acesso — ele só
// serve pra Funções/Pessoas montarem a tabela `permissoes_admin` de sempre
// (ver lib/acessos.ts). Chave que não estiver aqui (ex: 'chat', que é
// liberado pra todo mundo) nunca é mexida por função nem exceção.
//
// TELA NOVA COM PERMISSÃO NOVA → adicione a chave aqui também, senão ela
// não aparece em Funções. O script scripts/conferirCatalogoAcessos.ts
// aponta chave de permissoes.ts que ficou de fora.
//
// Este arquivo não importa nada de propósito: é empacotado sozinho pra
// rodar a simulação no servidor (scripts/simularFuncoesVivas).

export type Nivel = 1 | 2 | 3

export const NIVEL_LABEL: Record<0 | Nivel, string> = {
  0: 'Não vê',
  1: 'Vê',
  2: 'Usa',
  3: 'Gerencia',
}

export interface ItemCatalogo {
  id: string
  area: string
  nome: string
  // O que o nível "Gerencia" (ou outro) libera a mais, em palavras — aparece
  // como dica na tela.
  dica?: string
  // Só existe nessas empresas (slug). Vazio = todas. Em outra empresa o
  // item nem aparece e as chaves dele ficam como estão.
  empresas?: string[]
  // Chaves que cada nível ACRESCENTA (cumulativo).
  niveis: Partial<Record<Nivel, string[]>>
}

const ODIN = ['odin-compressores']
const EXPEDICAO = ['joitec', 'odin-tubos', 'joitec-automacao']

export const AREAS = [
  'Vendas',
  'Leads',
  'Odin Compressores',
  'Devoluções',
  'Estoque e expedição',
  'Financeiro',
  'Compras',
  'Marketing',
  'RH',
  'Relatórios',
  'Painéis de TV',
  'Configurações',
] as const

export const CATALOGO: ItemCatalogo[] = [
  // Vendas
  { id: 'meu_painel', area: 'Vendas', nome: 'Meu painel e Fila de hoje', niveis: { 2: ['meu_painel', 'fila_hoje'] } },
  { id: 'dashboard', area: 'Vendas', nome: 'Dashboard', niveis: { 1: ['dashboard'] } },
  { id: 'kanban', area: 'Vendas', nome: 'Kanban de vendas', dica: 'Gerencia: exclui card do Kanban', niveis: { 2: ['kanban'], 3: ['funil_excluir_card'] } },
  { id: 'agenda', area: 'Vendas', nome: 'Agenda', niveis: { 2: ['agenda'] } },
  { id: 'clientes', area: 'Vendas', nome: 'Clientes', niveis: { 2: ['clientes'] } },
  { id: 'prospeccao', area: 'Vendas', nome: 'Prospecção', niveis: { 2: ['prospeccao'] } },
  { id: 'banco_clientes', area: 'Vendas', nome: 'Banco de Clientes', niveis: { 2: ['banco_clientes'] } },
  { id: 'carteira', area: 'Vendas', nome: 'Carteira (importar e distribuir)', niveis: { 3: ['carteira'] } },
  { id: 'aprovacoes', area: 'Vendas', nome: 'Aprovações', niveis: { 3: ['aprovacoes'] } },
  { id: 'metas', area: 'Vendas', nome: 'Metas', niveis: { 3: ['metas'] } },
  { id: 'mensagens', area: 'Vendas', nome: 'Mensagens', niveis: { 2: ['mensagens'] } },
  { id: 'demandas', area: 'Vendas', nome: 'Demandas', niveis: { 2: ['demandas'] } },
  { id: 'faturamento_geral', area: 'Vendas', nome: 'Faturamento Geral', empresas: ['compretec-loja-fisica'], niveis: { 2: ['faturamento_geral'] } },

  // Leads
  { id: 'leads', area: 'Leads', nome: 'Leads', dica: 'Gerencia: transfere, exclui e mexe nos leads de qualquer vendedor', niveis: { 2: ['leads'], 3: ['leads_transferir', 'leads_excluir', 'leads_gerenciar_todos'] } },

  // Odin Compressores
  { id: 'dashboard_odin', area: 'Odin Compressores', nome: 'Resultados, Controle de pedidos e Calendário', empresas: ODIN, niveis: { 1: ['dashboard_odin'] } },
  { id: 'propostas_odin', area: 'Odin Compressores', nome: 'Propostas', empresas: ODIN, niveis: { 2: ['propostas_odin'] } },
  { id: 'pedidos_odin', area: 'Odin Compressores', nome: 'Pedidos', empresas: ODIN, niveis: { 2: ['pedidos_odin'] } },
  { id: 'garantias_odin', area: 'Odin Compressores', nome: 'Garantias', empresas: ODIN, dica: 'Gerencia: inclui a etapa da oficina (avaliação técnica)', niveis: { 2: ['garantias_odin'], 3: ['garantias_oficina'] } },
  { id: 'revendas_odin', area: 'Odin Compressores', nome: 'Revendas', empresas: ODIN, niveis: { 2: ['revendas_odin'] } },
  { id: 'visitas_odin', area: 'Odin Compressores', nome: 'Visitas de campo', empresas: ODIN, niveis: { 2: ['visitas_odin'] } },
  { id: 'prospeccao_odin', area: 'Odin Compressores', nome: 'Prospecção Odin', empresas: ODIN, niveis: { 2: ['prospeccao_odin'] } },
  { id: 'demonstracoes_odin', area: 'Odin Compressores', nome: 'Controle de demonstrações', empresas: ODIN, niveis: { 2: ['demonstracoes_odin'] } },
  { id: 'qualidade_odin', area: 'Odin Compressores', nome: 'Controle de qualidade', empresas: ODIN, niveis: { 2: ['qualidade_odin'] } },
  { id: 'estoque_odin', area: 'Odin Compressores', nome: 'Almoxarifado', empresas: ODIN, niveis: { 2: ['estoque_odin'] } },
  { id: 'pos_venda', area: 'Odin Compressores', nome: 'Fila de pós-venda', empresas: ODIN, niveis: { 2: ['pos_venda'] } },
  { id: 'cartao_credito', area: 'Odin Compressores', nome: 'Cartão de crédito (lançar gastos)', empresas: ODIN, niveis: { 2: ['cartao_credito'] } },
  { id: 'cartao_credito_relatorio', area: 'Odin Compressores', nome: 'Cartão de crédito — relatório', niveis: { 1: ['cartao_credito_relatorio'] } },
  { id: 'relatorios_odin', area: 'Odin Compressores', nome: 'Relatórios Odin', empresas: ODIN, niveis: { 1: ['relatorios_odin'] } },
  { id: 'configuracoes_odin', area: 'Odin Compressores', nome: 'Config. Odin', empresas: ODIN, niveis: { 3: ['configuracoes_odin'] } },

  // Devoluções
  { id: 'devolucoes', area: 'Devoluções', nome: 'Devolução', dica: 'Gerencia: exclui chamado, finaliza fora de ordem e vê os chamados de todos', niveis: { 2: ['devolucoes'], 3: ['devolucoes_excluir_chamado', 'devolucoes_finalizar_fora_ordem', 'devolucoes_visao_global'] } },
  { id: 'devolucoes_ver_comissao', area: 'Devoluções', nome: 'Devolução — ver comissão', niveis: { 1: ['devolucoes_ver_comissao'] } },
  { id: 'devolucoes_mecanica', area: 'Devoluções', nome: 'Mecânica (devolução)', niveis: { 2: ['devolucoes_mecanica'] } },
  { id: 'devolucoes_demonstracao', area: 'Devoluções', nome: 'Demonstração (devolução)', niveis: { 2: ['devolucoes_demonstracao'] } },
  { id: 'devolucoes_ecommerce', area: 'Devoluções', nome: 'Devolução e-commerce', empresas: ['compretec-ecommerce'], niveis: { 2: ['devolucoes_ecommerce'] } },

  // Estoque e expedição
  { id: 'controle_estoque', area: 'Estoque e expedição', nome: 'Expedição (separação, coleta, equipe)', empresas: EXPEDICAO, dica: 'Gerencia: descarta pedido que voltou', niveis: { 2: ['controle_estoque'], 3: ['expedicao_descartar'] } },

  // Financeiro
  { id: 'caixa', area: 'Financeiro', nome: 'Caixa', niveis: { 2: ['caixa'] } },
  { id: 'boletos', area: 'Financeiro', nome: 'Boletos', niveis: { 2: ['boletos'] } },
  { id: 'negociacoes', area: 'Financeiro', nome: 'Negociações e cobrança', niveis: { 2: ['negociacoes'] } },
  { id: 'liberacao_credito', area: 'Financeiro', nome: 'Liberação de crédito', niveis: { 2: ['liberacao_credito'] } },
  { id: 'solicitacao_credito', area: 'Financeiro', nome: 'Consulta/solicitação de crédito', niveis: { 2: ['solicitacao_credito'] } },
  { id: 'controle_suframa', area: 'Financeiro', nome: 'Controle SUFRAMA', niveis: { 2: ['controle_suframa'] } },
  { id: 'requisicao_posto', area: 'Financeiro', nome: 'Requisição posto', niveis: { 2: ['requisicao_posto'] } },
  { id: 'painel_financeiro', area: 'Financeiro', nome: 'Painel Financeiro', niveis: { 1: ['painel_financeiro'] } },

  // Compras
  { id: 'compras_solicitar', area: 'Compras', nome: 'Solicitar compra', niveis: { 2: ['compras_solicitar'] } },
  { id: 'compras_gestao', area: 'Compras', nome: 'Quadro de compras e fornecedores', niveis: { 2: ['compras_gestao'] } },
  { id: 'compras_aprovar', area: 'Compras', nome: 'Aprovar compras', niveis: { 3: ['compras_aprovar'] } },
  { id: 'compras_relatorios', area: 'Compras', nome: 'Dashboard e relatórios de compras', niveis: { 1: ['compras_relatorios'] } },
  { id: 'compras', area: 'Compras', nome: 'Importações e nacionais', niveis: { 2: ['compras'] } },

  // Marketing
  { id: 'solicitar_design', area: 'Marketing', nome: 'Solicitar arte', niveis: { 2: ['solicitar_design'] } },
  { id: 'marketing_analytics', area: 'Marketing', nome: 'Analytics', niveis: { 1: ['marketing_analytics'] } },
  { id: 'loja_rastreamento', area: 'Marketing', nome: 'Loja virtual — visitantes', empresas: ['compretec-loja-fisica', 'compretec-ecommerce'], niveis: { 1: ['loja_rastreamento'] } },

  // RH
  { id: 'vagas', area: 'RH', nome: 'Vagas', niveis: { 2: ['vagas'] } },
  { id: 'candidatos', area: 'RH', nome: 'Candidatos', niveis: { 2: ['candidatos'] } },
  { id: 'mensagens_rh', area: 'RH', nome: 'Mensagens (RH)', niveis: { 2: ['mensagens_rh'] } },

  // Relatórios
  { id: 'relatorios', area: 'Relatórios', nome: 'Relatórios (a página)', niveis: { 1: ['relatorios'] } },
  { id: 'relatorio_visao_geral', area: 'Relatórios', nome: 'Aba Visão geral', niveis: { 1: ['relatorio_visao_geral'] } },
  { id: 'relatorio_contatos', area: 'Relatórios', nome: 'Aba Contatos e ligações', niveis: { 1: ['relatorio_contatos'] } },
  { id: 'relatorio_orcamentos', area: 'Relatórios', nome: 'Aba Orçamentos e vendas', niveis: { 1: ['relatorio_orcamentos'] } },
  { id: 'relatorio_alertas', area: 'Relatórios', nome: 'Aba Alertas', niveis: { 1: ['relatorio_alertas'] } },
  { id: 'relatorio_ligacoes', area: 'Relatórios', nome: 'Ligações (PABX)', niveis: { 1: ['relatorio_ligacoes'] } },

  // Painéis de TV
  { id: 'painel_tv', area: 'Painéis de TV', nome: 'Painel de TV (vendas)', niveis: { 1: ['painel_tv'] } },
  { id: 'painel_tv_odin', area: 'Painéis de TV', nome: 'Painel de TV Odin Compressores', empresas: ODIN, niveis: { 1: ['painel_tv_odin'] } },
  { id: 'painel_tv_marketing', area: 'Painéis de TV', nome: 'Painel de TV Marketing', niveis: { 1: ['painel_tv_marketing'] } },
  { id: 'painel_logistica', area: 'Painéis de TV', nome: 'Painel Controle Logístico', niveis: { 1: ['painel_logistica'] } },

  // Configurações
  { id: 'usuarios', area: 'Configurações', nome: 'Vendedores (usuários da empresa)', niveis: { 3: ['usuarios'] } },
  { id: 'configuracoes', area: 'Configurações', nome: 'Configurações', niveis: { 3: ['configuracoes'] } },
  { id: 'lixeira', area: 'Configurações', nome: 'Lixeira', niveis: { 3: ['lixeira'] } },
  { id: 'backup', area: 'Configurações', nome: 'Backup', niveis: { 3: ['backup'] } },
]

export const ITEM_POR_ID = new Map(CATALOGO.map((i) => [i.id, i]))

export function niveisDoItem(item: ItemCatalogo): Nivel[] {
  return ([1, 2, 3] as Nivel[]).filter((n) => item.niveis[n]?.length)
}

// Chaves do item até o nível pedido (cumulativo). Nível 0 = nenhuma.
export function chavesAteNivel(item: ItemCatalogo, nivel: number): string[] {
  const out: string[] = []
  for (const n of [1, 2, 3] as Nivel[]) if (n <= nivel) out.push(...(item.niveis[n] ?? []))
  return out
}

export function todasChavesDoItem(item: ItemCatalogo): string[] {
  return chavesAteNivel(item, 3)
}

// Item existe pra essa empresa?
export function itemVale(item: ItemCatalogo, empresaSlug: string | null | undefined): boolean {
  return !item.empresas?.length || (!!empresaSlug && item.empresas.includes(empresaSlug))
}

// Nível que um conjunto de chaves representa pro item: o maior nível cujas
// chaves (cumulativas) estão todas presentes. `exato` = false quando sobra
// chave do item que não fecha um nível (combinação torta, ex: tem "excluir
// chamado" mas não tem a tela de Devolução).
export function nivelPorChaves(item: ItemCatalogo, chaves: Set<string>): { nivel: number; exato: boolean } {
  let nivel = 0
  for (const n of niveisDoItem(item)) {
    if (chavesAteNivel(item, n).every((c) => chaves.has(c))) nivel = n
    else break
  }
  const dele = todasChavesDoItem(item).filter((c) => chaves.has(c))
  const exato = dele.length === chavesAteNivel(item, nivel).length
  return { nivel, exato }
}

// Função guardada como { item: nivel } → chaves, só dos itens que valem
// pra empresa da pessoa.
export function chavesDaFuncao(itens: Record<string, number>, empresaSlug: string | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const [id, nivel] of Object.entries(itens)) {
    const item = ITEM_POR_ID.get(id)
    if (!item || !itemVale(item, empresaSlug)) continue
    for (const c of chavesAteNivel(item, nivel)) out.add(c)
  }
  return out
}

// Chaves que função/exceção controlam pra uma pessoa dessa empresa. Fora
// disso (item de outra empresa, chave fora do catálogo) fica como está.
export function chavesGerenciadas(empresaSlug: string | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const item of CATALOGO) if (itemVale(item, empresaSlug)) for (const c of todasChavesDoItem(item)) out.add(c)
  return out
}

// Acesso final = (função ∪ exceções "a mais") − exceções "a menos", só nas
// chaves gerenciadas; o resto do que a pessoa já tem fica intacto.
export function calcularChavesFinais(args: {
  atuais: Set<string>
  funcao: Set<string>
  excecoes: { feature: string; modo: 'add' | 'remove' }[]
  gerenciadas: Set<string>
}): Set<string> {
  const alvo = new Set([...args.funcao].filter((c) => args.gerenciadas.has(c)))
  for (const e of args.excecoes) {
    if (!args.gerenciadas.has(e.feature)) continue
    if (e.modo === 'add') alvo.add(e.feature)
    else alvo.delete(e.feature)
  }
  const final = new Set([...args.atuais].filter((c) => !args.gerenciadas.has(c)))
  for (const c of alvo) final.add(c)
  return final
}

// Exceções que fazem a pessoa continuar exatamente com `atuais`, partindo
// da função (usado ao colocar alguém numa função "mantendo o acesso").
export function excecoesParaManter(atuais: Set<string>, funcao: Set<string>, gerenciadas: Set<string>) {
  const out: { feature: string; modo: 'add' | 'remove' }[] = []
  for (const c of gerenciadas) {
    const tem = atuais.has(c)
    const daFuncao = funcao.has(c)
    if (tem && !daFuncao) out.push({ feature: c, modo: 'add' })
    if (!tem && daFuncao) out.push({ feature: c, modo: 'remove' })
  }
  return out
}

// Converte lista de chaves (como as funções foram descritas a partir do
// levantamento) em { item: nivel }.
export function itensPorChaves(chaves: string[]): Record<string, number> {
  const set = new Set(chaves)
  const out: Record<string, number> = {}
  for (const item of CATALOGO) {
    const { nivel } = nivelPorChaves(item, set)
    if (nivel > 0) out[item.id] = nivel
  }
  return out
}
