import { Activity, BarChart3, Building2, FileText, PackageSearch, PhoneCall, Layers, MessagesSquare, UserX, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// Relatórios detalhados (pedido do João, 2026-10-20): cada um numa página
// própria, dentro da subpasta "Relatórios detalhados" do menu. Admin vê
// todos (respeitando as permissões relatorio_* que já existiam por aba);
// vendedor vê só os marcados `vendedor`, numa versão mais simples e só com
// os dados dele (o servidor já filtra).
export type RelatorioDetalhado = {
  slug: string
  titulo: string
  // Nome curto pro menu lateral.
  curto: string
  descricao: string
  icone: LucideIcon
  cor: string
  feature: string | null
  vendedor?: boolean
  superAdmin?: boolean
}

export const RELATORIOS_DETALHADOS: RelatorioDetalhado[] = [
  { slug: 'positivacao', curto: 'Positivação', titulo: 'Positivação de carteira', descricao: 'Carteira por data da última compra: ativos, novos, recuperados, quase inativos e inativos.', icone: Activity, cor: '#22a861', feature: 'relatorio_visao_geral', vendedor: true },
  { slug: 'curva-abc', curto: 'Curva ABC', titulo: 'Curva ABC de clientes', descricao: 'Quem traz 80% do faturamento (A), os próximos 15% (B) e o resto (C).', icone: Layers, cor: '#f2a516', feature: 'relatorio_visao_geral' },
  { slug: 'vendas', curto: 'Vendas', titulo: 'Vendas', descricao: 'Faturamento por dia e por vendedor, ticket médio e vendas de marketing.', icone: BarChart3, cor: '#24aff4', feature: 'relatorio_visao_geral', vendedor: true },
  { slug: 'orcamentos', curto: 'Orçamentos', titulo: 'Orçamentos', descricao: 'Orçamentos em aberto, há quantos dias parados, e quantos cada vendedor fez.', icone: FileText, cor: '#8b5cf6', feature: 'relatorio_orcamentos', vendedor: true },
  { slug: 'produtos', curto: 'Produtos e mix', titulo: 'Produtos e mix', descricao: 'Itens mais comprados e média de itens por cliente de cada vendedor.', icone: PackageSearch, cor: '#0ea5a4', feature: 'relatorio_orcamentos' },
  { slug: 'contatos', curto: 'Contatos', titulo: 'Contatos e cobertura', descricao: 'Quantos clientes da carteira cada vendedor contatou, por cliente e por dia.', icone: MessagesSquare, cor: '#3b82f6', feature: 'relatorio_contatos' },
  { slug: 'ligacoes', curto: 'Ligações', titulo: 'Ligações', descricao: 'Tentativas x ligações efetivas, por vendedor, por cliente e uma a uma.', icone: PhoneCall, cor: '#06b6d4', feature: 'relatorio_contatos' },
  { slug: 'clientes-parados', curto: 'Clientes parados', titulo: 'Clientes parados', descricao: 'Clientes sem contato, sem orçamento ou sem compra há X dias.', icone: UserX, cor: '#e34948', feature: 'relatorio_alertas', vendedor: true },
  { slug: 'perdas', curto: 'Motivos de perda', titulo: 'Motivos de perda', descricao: 'Por que os pedidos foram perdidos: categoria, item e o que o vendedor escreveu.', icone: XCircle, cor: '#f97316', feature: 'relatorio_alertas' },
  { slug: 'todas-empresas', curto: 'Todas as empresas', titulo: 'Todas as empresas', descricao: 'Vendas e contato com a carteira das empresas do grupo lado a lado.', icone: Building2, cor: '#64748b', feature: null, superAdmin: true },
]

export function relatoriosPermitidos(user: { role: string; superAdmin?: boolean } | null | undefined, features: string[] | undefined) {
  if (!user) return []
  return RELATORIOS_DETALHADOS.filter((r) => {
    if (r.superAdmin) return !!user.superAdmin
    if (user.role !== 'admin' && !r.vendedor) return false
    return !!user.superAdmin || !!features?.includes(r.feature ?? '')
  })
}

export function baseRelatorios(role: string | undefined) {
  return role === 'admin' ? '/admin/relatorios' : '/vendedor/relatorios'
}
