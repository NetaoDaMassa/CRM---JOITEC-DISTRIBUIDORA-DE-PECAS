// Funções iniciais e quem entra em cada uma — montado com o João em
// 2026-11-09 a partir do levantamento de quem tinha acesso a quê (71
// pessoas ativas). Usado UMA vez, na primeira subida (lib/acessos.ts,
// migrarParaFuncoesVivas), e pela simulação. Depois disso, quem manda é a
// tela Funções e permissões.
//
// Sem imports de banco de propósito (ver acessosCatalogo.ts).
import { CATALOGO, itensPorChaves, niveisDoItem } from './acessosCatalogo.js'

export interface FuncaoInicial {
  chave: string
  nome: string
  descricao: string
  camada: 'grupo' | 'empresa'
  tipoConta: 'admin' | 'vendor'
  chaves: string[]
}

const ABAS_RELATORIO = ['relatorio_visao_geral', 'relatorio_contatos', 'relatorio_orcamentos', 'relatorio_alertas']
const ODIN_GERENCIA = [
  'dashboard_odin', 'propostas_odin', 'pedidos_odin', 'garantias_odin', 'garantias_oficina', 'revendas_odin', 'visitas_odin',
  'prospeccao_odin', 'demonstracoes_odin', 'qualidade_odin', 'estoque_odin', 'pos_venda', 'relatorios_odin', 'configuracoes_odin', 'painel_tv_odin',
]
const VENDEDOR = ['meu_painel', 'fila_hoje', 'kanban', 'agenda', 'clientes', 'prospeccao', 'leads', 'devolucoes', 'pos_venda', 'relatorios', ...ABAS_RELATORIO, 'solicitar_design']
const VENDEDOR_ODIN = ['meu_painel', 'fila_hoje', 'kanban', 'agenda', 'clientes', 'prospeccao', 'pos_venda', 'relatorios', 'solicitar_design', 'dashboard_odin', 'propostas_odin', 'pedidos_odin', 'revendas_odin', 'visitas_odin']
const FINANCEIRO = ['caixa', 'boletos', 'negociacoes', 'painel_financeiro', 'dashboard', 'relatorios', 'demandas', 'compras_solicitar', 'solicitar_design']
const COMPRAS = ['compras', 'compras_gestao', 'compras_relatorios', 'compras_solicitar', 'dashboard', 'relatorios']

export const FUNCOES_INICIAIS: FuncaoInicial[] = [
  // Setores do grupo
  { chave: 'gerente_financeiro', nome: 'Gerente financeiro', camada: 'grupo', tipoConta: 'admin', descricao: 'Responsável pelo financeiro de todas as empresas.', chaves: [...FINANCEIRO, 'liberacao_credito', 'solicitacao_credito', 'controle_suframa', 'requisicao_posto', 'cartao_credito_relatorio', 'faturamento_geral'] },
  { chave: 'financeiro', nome: 'Financeiro', camada: 'grupo', tipoConta: 'admin', descricao: 'Caixa, boletos e cobrança.', chaves: FINANCEIRO },
  { chave: 'gerente_compras', nome: 'Gerente de compras', camada: 'grupo', tipoConta: 'admin', descricao: 'Responsável pelas compras do grupo; aprova as compras.', chaves: [...COMPRAS, 'compras_aprovar'] },
  { chave: 'compras', nome: 'Compras', camada: 'grupo', tipoConta: 'admin', descricao: 'Cuida das compras das empresas do grupo.', chaves: COMPRAS },
  { chave: 'rh', nome: 'RH', camada: 'grupo', tipoConta: 'admin', descricao: 'Só a parte de RH.', chaves: ['vagas', 'candidatos', 'mensagens_rh', 'usuarios', 'dashboard', 'demandas', 'compras_solicitar', 'solicitar_design'] },
  { chave: 've_tudo', nome: 'Vê tudo (Marketing)', camada: 'grupo', tipoConta: 'admin', descricao: 'Enxerga todas as telas, sem mexer em usuários, permissões e configurações.', chaves: [] /* preenchida em funcoesIniciaisComVeTudo */ },

  // Em cada empresa
  { chave: 'gerente', nome: 'Gerente', camada: 'empresa', tipoConta: 'admin', descricao: 'Responsável pela empresa. Vê tudo da empresa dele.', chaves: [
    // Sem Caixa (é do financeiro), Importações (é de compras), Backup (só o
    // João), excluir card e Devoluções — João, 2026-11-09.
    'dashboard', 'kanban', 'agenda', 'clientes', 'prospeccao', 'banco_clientes', 'carteira', 'aprovacoes', 'metas', 'mensagens', 'demandas',
    'leads', 'relatorios', ...ABAS_RELATORIO, 'usuarios', 'configuracoes', 'lixeira', 'painel_tv', 'compras_solicitar', 'solicitar_design',
    ...ODIN_GERENCIA,
  ] },
  { chave: 'administrativo_comercial', nome: 'Administrativo comercial', camada: 'empresa', tipoConta: 'admin', descricao: 'Monta propostas e cuida da parte administrativa do comercial.', chaves: [
    'dashboard', 'kanban', 'agenda', 'clientes', 'banco_clientes', 'carteira', 'mensagens', 'demandas', 'relatorios', ...ABAS_RELATORIO, 'compras_solicitar', 'solicitar_design', 'painel_tv',
    'dashboard_odin', 'propostas_odin', 'pedidos_odin', 'garantias_odin', 'revendas_odin', 'visitas_odin', 'demonstracoes_odin', 'qualidade_odin', 'estoque_odin', 'pos_venda', 'relatorios_odin',
  ] },
  { chave: 'coordenador_vendas', nome: 'Coordenador de vendas', camada: 'empresa', tipoConta: 'vendor', descricao: 'Vende e também coordena uma equipe de vendas.', chaves: [...VENDEDOR_ODIN, 'banco_clientes', 'leads', 'leads_transferir', 'leads_excluir', 'leads_gerenciar_todos', ...ABAS_RELATORIO] },
  { chave: 'vendedor', nome: 'Vendedor', camada: 'empresa', tipoConta: 'vendor', descricao: 'Comercial padrão: trabalha os próprios clientes, leads e agenda.', chaves: VENDEDOR },
  { chave: 'vendedor_odin', nome: 'Vendedor Odin Compressores', camada: 'empresa', tipoConta: 'vendor', descricao: 'Vendedor interno da Odin Compressores.', chaves: VENDEDOR_ODIN },
  { chave: 'vendedor_leads_odin', nome: 'Vendedor de leads Odin', camada: 'empresa', tipoConta: 'vendor', descricao: 'Equipe de leads da Odin Compressores: leads, propostas e pedidos.', chaves: ['dashboard_odin', 'leads', 'propostas_odin', 'pedidos_odin', 'solicitar_design'] },
  { chave: 'vendedor_externo_odin', nome: 'Vendedor externo Odin', camada: 'empresa', tipoConta: 'vendor', descricao: 'Vendedor de campo da Odin Compressores: visitas, propostas, pedidos e cartão.', chaves: ['dashboard_odin', 'propostas_odin', 'pedidos_odin', 'revendas_odin', 'visitas_odin', 'cartao_credito', 'solicitar_design'] },
  { chave: 'estoque', nome: 'Estoque', camada: 'empresa', tipoConta: 'admin', descricao: 'Separa e expede os pedidos; cuida de garantias e pós-venda.', chaves: ['controle_estoque', 'painel_logistica', 'compras_solicitar', 'pedidos_odin', 'garantias_odin', 'pos_venda', 'estoque_odin'] },
]

// Quem vai pra qual função (pelo login). Vendedor sem login aqui cai em
// 'vendedor' (ou 'vendedor_odin' se for da Odin Compressores). Admin sem
// login aqui fica SEM função (continua exatamente como está).
export const PESSOAS_INICIAIS: Record<string, string> = {
  jessica: 'gerente_financeiro',
  isabelly: 'financeiro', rubia: 'financeiro', suyhane: 'financeiro', daniela: 'financeiro',
  paola: 'gerente_compras',
  maicon: 'compras', mary: 'compras', amanda: 'compras',
  recursoshumanos: 'rh',
  'victor.perin': 'gerente', marcio: 'gerente', jaciel: 'gerente', pamela: 'gerente', roberto: 'gerente', andreia: 'gerente', bianca: 'gerente', flavio: 'gerente',
  agatta: 'administrativo_comercial', marcusvinicius: 'administrativo_comercial',
  emily: 'coordenador_vendas', bruna: 'coordenador_vendas',
  alvaro: 'vendedor_odin', 'guilherme.compressores': 'vendedor_odin', 'sergio.compressores': 'vendedor_odin', wilians: 'vendedor_odin', matheus: 'vendedor_leads_odin', rodrigo: 'vendedor_leads_odin',
  'douglas.compressores': 'vendedor_externo_odin', edemilson: 'vendedor_externo_odin', hilton: 'vendedor_externo_odin', 'marco.compressores': 'vendedor_externo_odin', pedro: 'vendedor_externo_odin',
  estoque: 'estoque', 'estoque.tubos': 'estoque', 'estoque.automacao': 'estoque', rafa: 'estoque',
}

// Logins que ficam de fora de propósito: a conta da TV (vira "Tela de TV"
// numa próxima etapa) e o login legado que o João vai desativar.
export const PESSOAS_FORA = new Set(['tv/financeiro', 'legado_roberto_vendedor_odin'])

export function funcaoInicialDoUsuario(u: { username: string; role: string; superAdmin: boolean; empresaSlug: string | null }): string | null {
  if (u.superAdmin || PESSOAS_FORA.has(u.username)) return null
  const mapeada = PESSOAS_INICIAIS[u.username.trim()]
  if (mapeada) return mapeada
  if (u.role === 'vendor') return u.empresaSlug === 'odin-compressores' ? 'vendedor_odin' : 'vendedor'
  return null
}

// Correção aprovada pelo João (2026-11-09): vendedor não exclui chamado de
// devolução nem vê comissão. Na troca, essas duas NÃO viram exceção pra
// quem está numa função de vendedor — ou seja, quem tinha, perde.
export const FUNCOES_DE_VENDEDOR = new Set(['vendedor', 'vendedor_odin', 'vendedor_leads_odin', 'vendedor_externo_odin', 'coordenador_vendas'])
export const CHAVES_TIRADAS_DE_VENDEDOR = new Set(['devolucoes_excluir_chamado', 'devolucoes_ver_comissao'])
// Backup é só do João (superAdmin, que nem entra em função) — sai de todo
// mundo na troca. João, 2026-11-09.
export const CHAVES_TIRADAS_DE_TODOS = new Set(['backup'])

// Caixa é do financeiro: sai de quem tinha como exceção, menos do Flavio
// (Loja Física), que precisa. João, 2026-11-09.
export const CAIXA_MANTEM = new Set(['flavio'])

// Chaves que, na troca, NÃO viram exceção (ou seja, a pessoa perde).
export function correcaoTira(funcaoChave: string, feature: string, username: string): boolean {
  if (feature === 'caixa') return !CAIXA_MANTEM.has(username.trim())
  return CHAVES_TIRADAS_DE_TODOS.has(feature) || (FUNCOES_DE_VENDEDOR.has(funcaoChave) && CHAVES_TIRADAS_DE_VENDEDOR.has(feature))
}

export const NOME_CORRECAO: Record<string, string> = {
  devolucoes_excluir_chamado: 'excluir chamado',
  devolucoes_ver_comissao: 'ver comissão',
  backup: 'Backup',
  caixa: 'Caixa',
}

// "Vê tudo": cada item no nível mais baixo dele (só a tela, sem poderes
// extras), menos Configurações e as telas que só servem pra gerenciar.
export function itensVeTudo(): Record<string, number> {
  const fora = new Set(['configuracoes_odin', 'carteira', 'aprovacoes', 'metas'])
  const out: Record<string, number> = {}
  for (const item of CATALOGO) {
    if (item.area === 'Configurações' || fora.has(item.id)) continue
    out[item.id] = niveisDoItem(item)[0]
  }
  return out
}

export function itensDaFuncaoInicial(chave: string): Record<string, number> {
  if (chave === 've_tudo') return itensVeTudo()
  const f = FUNCOES_INICIAIS.find((x) => x.chave === chave)
  return f ? itensPorChaves(f.chaves) : {}
}

