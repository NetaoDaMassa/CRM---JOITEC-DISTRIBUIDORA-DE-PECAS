import { useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, BarChart3,
  KanbanSquare, LogOut, ArrowRightLeft, Trash2,
  Sun, Moon, Target, Settings, Tv, DatabaseBackup, CalendarDays, MessageSquareText, ListChecks, Megaphone, Landmark, Wrench, Search, CheckSquare, Palette, Wallet, Banknote, Ship, ShieldCheck, Receipt, RotateCcw, Cog, PackageSearch, Briefcase, Contact, MessageCircle, UserCog, Activity, UserPlus, MapPin,
  ChevronDown, ChevronLeft, Folder, Layers, Package, FileText, Store, Warehouse, MapPinned, Settings2, ClipboardList, FileSpreadsheet, Handshake, Zap, X, Fuel, Building2, CreditCard, Instagram, Mail, Unlock,
  Gauge, CalendarRange, BookUser, BookOpen, Radar, Columns3, PieChart, TrendingUp, FileBarChart, BadgeCheck, ClipboardCheck, UserX, HandCoins, ShoppingCart, PackageOpen, ScrollText, MonitorPlay,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { trpc } from '../lib/trpc'

// Ícones disponíveis pra montar um grupo em "Grupos da Sidebar" — nome
// salvo como texto no banco (sidebarGroups.icone), mapeado pro componente
// aqui. `Folder` é o fallback se algum dia salvar um nome que saia da lista.
export const ICONES_GRUPO: Record<string, LucideIcon> = {
  Folder, Megaphone, Ship, Wrench, Banknote, Briefcase, RotateCcw, Users, Target, Palette, UserPlus, Landmark, Activity, Layers, Wallet,
}
export const NOMES_ICONES_GRUPO = Object.keys(ICONES_GRUPO)

// Joitec Automação é uma divisão da mesma marca Joitec — reaproveita a logo
// padrão, sem arte própria (confirmado com o João).
const LOGO_POR_EMPRESA: Record<string, string> = {
  joitec: '/logos/joitec-sidebar.png',
  'joitec-automacao': '/logos/joitec-sidebar.png',
  'odin-tubos': '/logos/odin-tubos-sidebar.png',
}

// Pós-venda por horas de filtro (ar/óleo) só faz sentido pro modelo de
// negócio da Odin Compressores (revenda que já comprou compressor) — as
// outras empresas não têm essa tela.
const SO_ODIN_COMPRESSORES = 'odin-compressores'
// Faturamento Geral (Fechado/Faturamento de todos os vendedores num board
// só) só existe pra Compretec Loja Física — é a única empresa com etapa
// "Faturamento" no funil.
const SO_COMPRETEC_LOJA_FISICA = 'compretec-loja-fisica'
const SO_COMPRETEC_ECOMMERCE = 'compretec-ecommerce'
// Mesma lista de SLUGS_COM_ANALYTICS_MARKETING em server/src/router/integracoes.ts
// — só essas 3 empresas têm o tracker do CRM de marketing instalado no site.
const EMPRESAS_ANALYTICS_MARKETING = ['joitec', 'odin-tubos', 'odin-compressores']

// Itens que aparecem pra QUALQUER admin/vendedor, sem precisar de permissão
// concedida em Permissões — diferente do resto do menu, que é opt-in por
// usuário. "Arquivos/Mídia" é assim de propósito (pedido do João,
// 2026-09-05: liberado pra todo mundo, só respeitando a empresa de cada
// um — que já é automático, cada usuário só enxerga o que é da própria
// empresa). Usado tanto aqui (pula a checagem de `minhasFeatures`) quanto
// em Permissoes.tsx (tira da lista de caixinhas — marcar/desmarcar não
// faria diferença nenhuma pra esses itens).
export const FEATURES_SEMPRE_LIBERADAS = new Set(['arquivos'])

// `feature` é a chave usada em permissoesAdmin/FEATURES_ADMIN (server) —
// controla quem vê cada item pra admins não-superAdmin.
export const ADMIN_LINKS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, feature: 'dashboard' },
  { to: '/admin/kanban', label: 'Kanban', icon: KanbanSquare, feature: 'kanban' },
  { to: '/admin/demandas', label: 'Demandas', icon: ClipboardList, feature: 'demandas' },
  { to: '/admin/pos-venda', label: 'Fila de Pós-venda', icon: Wrench, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'pos_venda' },
  { to: '/admin/calendario', label: 'Agenda', icon: CalendarDays, feature: 'agenda' },
  { to: '/admin/clientes', label: 'Clientes', icon: BookUser, feature: 'clientes' },
  { to: '/admin/prospeccao', label: 'Prospecção', icon: Search, ocultoEmpresa: SO_ODIN_COMPRESSORES, feature: 'prospeccao' },
  { to: '/admin/aprovacoes', label: 'Aprovações', icon: CheckSquare, feature: 'aprovacoes' },
  { to: '/admin/carteira', label: 'Carteira', icon: ArrowRightLeft, feature: 'carteira' },
  { to: '/admin/banco-clientes', label: 'Banco de Clientes', icon: Landmark, feature: 'banco_clientes' },
  { to: '/admin/relatorios', label: 'Relatórios', icon: BarChart3, feature: 'relatorios' },
  { to: '/admin/usuarios', label: 'Vendedores', icon: Users, feature: 'usuarios' },
  { to: '/admin/metas', label: 'Metas', icon: Target, feature: 'metas' },
  { to: '/admin/mensagens', label: 'Mensagens', icon: MessageSquareText, feature: 'mensagens' },
  { to: '/admin/caixa', label: 'Caixa', icon: Banknote, feature: 'caixa' },
  { to: '/admin/boletos', label: 'Boletos', icon: FileSpreadsheet, feature: 'boletos' },
  { to: '/admin/negociacoes', label: 'Negociações', icon: Handshake, feature: 'negociacoes' },
  // Relatório geral de gastos do cartão corporativo — era superAdmin-only
  // (pedido do João, 2026-09-15), virou delegável em 2026-09-22. Só faz
  // sentido pra Odin Compressores (é quem usa cartão corporativo hoje).
  { to: '/admin/cartao-relatorio', label: 'Cartão de Crédito (Relatório)', icon: ScrollText, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'cartao_credito_relatorio' },
  // Mesma tela/rota do VENDOR_LINKS abaixo — quem processa o faturamento da
  // Compretec Loja Física (Daniela) virou admin (função Financeiro) mas
  // continua precisando desse board. `funil.funilFaturamentoGeral` já é
  // adminOrFeatureProcedure, então admin passa; só faltava o link + a rota.
  { to: '/admin/faturamento-geral', label: 'Faturamento Geral', icon: Receipt, somenteEmpresa: SO_COMPRETEC_LOJA_FISICA, feature: 'faturamento_geral' },
  // Mesma tela/rota do VENDOR_LINKS abaixo — igual Faturamento Geral acima:
  // admin comum concedido (ex: Roberto) usa a versão dele pelo link daqui,
  // vendedor concedido usa a de VENDOR_LINKS. Pedido do João, 2026-09-23.
  { to: '/admin/cartao-credito', label: 'Cartão de Crédito', icon: CreditCard, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'cartao_credito' },
  { to: '/admin/compras', label: 'Compras', icon: Ship, feature: 'compras' },
  { to: '/admin/lixeira', label: 'Lixeira', icon: Trash2, feature: 'lixeira' },
  { to: '/admin/configuracoes', label: 'Configurações', icon: Settings, feature: 'configuracoes' },
  { to: '/admin/backup', label: 'Backup', icon: DatabaseBackup, feature: 'backup' },
  { to: '/admin/dashboard-odin', label: 'Dashboard Odin', icon: Gauge, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'dashboard_odin' },
  { to: '/admin/calendario-odin', label: 'Calendário Odin', icon: CalendarRange, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'dashboard_odin' },
  { to: '/admin/propostas', label: 'Propostas', icon: FileText, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'propostas_odin' },
  { to: '/admin/ordens', label: 'Pedidos', icon: Package, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'pedidos_odin' },
  { to: '/admin/garantias', label: 'Garantias', icon: BadgeCheck, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'garantias_odin' },
  { to: '/admin/revendas', label: 'Revendas', icon: Store, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'revendas_odin' },
  { to: '/admin/estoque', label: 'Almoxarifado', icon: Warehouse, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'estoque_odin' },
  { to: '/admin/visitas', label: 'Visitas de Campo', icon: MapPinned, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'visitas_odin' },
  { to: '/admin/prospeccao-odin', label: 'Prospecção', icon: Radar, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'prospeccao_odin' },
  { to: '/admin/demonstracoes', label: 'Controle de Demonstrações', icon: PackageSearch, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'demonstracoes_odin' },
  { to: '/admin/qualidade', label: 'Controle de Qualidade', icon: ClipboardCheck, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'qualidade_odin' },
  { to: '/admin/configuracoes-odin', label: 'Config. Odin', icon: Settings2, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'configuracoes_odin' },
  { to: '/admin/relatorios-odin', label: 'Relatórios Odin', icon: PieChart, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'relatorios_odin' },
  { to: '/admin/devolucoes', label: 'Devolução', icon: RotateCcw, feature: 'devolucoes' },
  { to: '/admin/devolucoes-mecanica', label: 'Mecânica (Devolução)', icon: Cog, feature: 'devolucoes_mecanica' },
  { to: '/admin/devolucoes-demonstracao', label: 'Demonstração', icon: PackageOpen, feature: 'devolucoes_demonstracao' },
  { to: '/admin/devolucoes-relatorios', label: 'Relatórios (Devolução)', icon: FileBarChart, feature: 'devolucoes' },
  { to: '/admin/devolucoes-ecommerce', label: 'Devolução E-commerce', icon: ShoppingCart, somenteEmpresa: SO_COMPRETEC_ECOMMERCE, feature: 'devolucoes_ecommerce' },
  // RH — vagas/candidatos/mensagens, portado do CRM-GRUPO-ODIN.
  { to: '/admin/vagas', label: 'Vagas', icon: Briefcase, feature: 'vagas' },
  { to: '/admin/candidatos', label: 'Candidatos', icon: Contact, feature: 'candidatos' },
  { to: '/admin/mensagens-rh', label: 'Mensagens (RH)', icon: MessageCircle, feature: 'mensagens_rh' },
  { to: '/admin/analytics', label: 'Analytics', icon: Activity, somenteEmpresas: EMPRESAS_ANALYTICS_MARKETING, feature: 'marketing_analytics' },
  // Módulo de Leads (site) — portado do CRM-GRUPO-ODIN, fase 1 do plano em
  // .claude/plans/stateful-soaring-moore.md.
  { to: '/admin/leads', label: 'Leads', icon: UserPlus, feature: 'leads' },
  { to: '/admin/leads/kanban', label: 'Kanban de Leads', icon: Columns3, feature: 'leads' },
  { to: '/admin/leads-desqualificados', label: 'Revisão de Leads', icon: UserX, feature: 'leads' },
  { to: '/admin/leads-relatorios', label: 'Relatórios de Leads', icon: TrendingUp, feature: 'leads' },
  { to: '/admin/campanhas', label: 'Campanhas', icon: Megaphone, feature: 'leads' },
  { to: '/admin/integracao-brevo', label: 'Integração Brevo', icon: Mail, feature: 'leads' },
  { to: '/admin/integracao-instagram', label: 'Integração Instagram', icon: Instagram, feature: 'leads' },
  // Arquivos/Mídia (Marketing) — pastas/fotos/vídeos/PDFs, todas as empresas.
  { to: '/admin/arquivos', label: 'Arquivos/Mídia', icon: Folder, feature: 'arquivos' },
  // "Solicitar Arte" pro admin — mesma tela de VENDOR_LINKS (trpc.design.*
  // já é protectedProcedure, sem distinção de role), só precisava do link +
  // rota. Concedido manualmente (não é livre igual 'arquivos').
  { to: '/admin/solicitar-design', label: 'Solicitar Arte', icon: Palette, feature: 'solicitar_design' },
  // Cross-empresa por design (mesmo padrão de painel_financeiro): quem tem
  // a permissão vê/lança pra TODAS as empresas do grupo, não só a ativa —
  // Financeiro/Compras precisa da visão do grupo inteiro. Pedido do João,
  // 2026-09-15.
  { to: '/admin/requisicao-posto', label: 'Requisição Posto', icon: Fuel, feature: 'requisicao_posto' },
  // Hub simples com atalhos pros painéis/telas "gerais do grupo" (Compras,
  // Painel Financeiro, relatórios etc.) — começa enxuto, pra ir ganhando
  // mais conteúdo conforme o João for definindo o que entra. Pedido do
  // João, 2026-09-15.
  // Escondido do menu (João 2026-10-19: "pode tirar, depois construímos") —
  // a tela /admin/grupo-odin continua existindo, só não aparece aqui.
  // { to: '/admin/grupo-odin', label: 'Grupo Odin', icon: Building2, feature: 'grupo_odin' },
  // Liberação de Crédito — cross-empresa igual os dois acima. Financeiro
  // (hoje a Rubia) registra quando um cliente de qualquer empresa do grupo
  // foi liberado pra comprar mesmo com pendência/limite estourado. Pedido
  // do João, 2026-09-24.
  { to: '/admin/liberacao-credito', label: 'Liberação de Crédito', icon: Unlock, feature: 'liberacao_credito' },
  // Fluxo completo pedido→resposta (diferente da Liberação de Crédito acima,
  // que é só um registro direto) — vendedor abre a solicitação, financeiro
  // responde. Cross-empresa também. Pedido do João, 2026-10-01.
  { to: '/admin/solicitacao-credito', label: 'Consulta/Solicitação de Crédito', icon: HandCoins, feature: 'solicitacao_credito' },
]

// Mesma ideia do ADMIN_LINKS acima — `feature` é a chave em permissoesAdmin,
// controla quem vê cada item. Reaproveita as MESMAS chaves do admin quando
// faz sentido (ex: 'banco_clientes') — a tabela não distingue role, só
// (userId, feature), então liberar 'banco_clientes' pra um vendedor dá
// acesso à mesma tela que o admin usa (rota própria, ver App.tsx).
export const VENDOR_LINKS = [
  { to: '/vendedor', label: 'Meu Painel', icon: LayoutDashboard, end: true, feature: 'meu_painel' },
  { to: '/vendedor/fila-hoje', label: 'Fila de Hoje', icon: ListChecks, feature: 'fila_hoje' },
  { to: '/vendedor/pos-venda', label: 'Fila de Pós-venda', icon: Wrench, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'pos_venda' },
  { to: '/vendedor/kanban', label: 'Kanban', icon: KanbanSquare, feature: 'kanban' },
  { to: '/vendedor/demandas', label: 'Demandas', icon: ClipboardList, feature: 'demandas' },
  { to: '/vendedor/calendario', label: 'Minha Agenda', icon: CalendarDays, feature: 'agenda' },
  { to: '/vendedor/clientes', label: 'Meus Clientes', icon: BookUser, feature: 'clientes' },
  { to: '/vendedor/prospeccao', label: 'Prospecção', icon: Search, ocultoEmpresa: SO_ODIN_COMPRESSORES, feature: 'prospeccao' },
  { to: '/vendedor/banco-clientes', label: 'Banco de Clientes', icon: Landmark, feature: 'banco_clientes' },
  {
    to: '/vendedor/faturamento-geral',
    label: 'Faturamento Geral',
    icon: Receipt,
    somenteEmpresa: SO_COMPRETEC_LOJA_FISICA,
    feature: 'faturamento_geral',
  },
  // Mesma chave 'relatorios' do admin (controla o link aparecer ou não) —
  // dentro da página, os relatorio_* controlam aba por aba, igual antes.
  { to: '/vendedor/relatorios', label: 'Relatórios', icon: BarChart3, feature: 'relatorios' },
  { to: '/vendedor/solicitar-design', label: 'Solicitar Arte', icon: Palette, feature: 'solicitar_design' },
  { to: '/vendedor/dashboard-odin', label: 'Dashboard Odin', icon: Gauge, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'dashboard_odin' },
  { to: '/vendedor/calendario-odin', label: 'Calendário Odin', icon: CalendarRange, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'dashboard_odin' },
  { to: '/vendedor/propostas', label: 'Propostas', icon: FileText, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'propostas_odin' },
  { to: '/vendedor/ordens', label: 'Pedidos', icon: Package, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'pedidos_odin' },
  { to: '/vendedor/garantias', label: 'Garantias', icon: BadgeCheck, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'garantias_odin' },
  { to: '/vendedor/revendas', label: 'Revendas', icon: Store, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'revendas_odin' },
  { to: '/vendedor/visitas', label: 'Visitas de Campo', icon: MapPinned, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'visitas_odin' },
  { to: '/vendedor/prospeccao-odin', label: 'Prospecção', icon: Radar, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'prospeccao_odin' },
  { to: '/vendedor/demonstracoes', label: 'Controle de Demonstrações', icon: PackageSearch, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'demonstracoes_odin' },
  // Gastos com cartão corporativo — pensado pro vendedor EXTERNO da Odin
  // Compressores (visita → proposta → venda), mas quem controla quem vê é
  // Permissões (mesmo espírito do resto do menu) — não trava aqui por
  // `canalVenda` de propósito, pra não duplicar a mesma regra em 2 lugares.
  // Pedido do João, 2026-09-15.
  { to: '/vendedor/cartao-credito', label: 'Cartão de Crédito', icon: CreditCard, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'cartao_credito' },
  // Pedir liberação de crédito pro Financeiro — todas as empresas, não só
  // Odin Compressores (diferente do Cartão de Crédito acima). Mesma chave
  // de ADMIN_LINKS (ver comentário lá). Pedido do João, 2026-10-01.
  { to: '/vendedor/solicitacao-credito', label: 'Consulta/Solicitação de Crédito', icon: HandCoins, feature: 'solicitacao_credito' },
  { to: '/vendedor/devolucoes', label: 'Devolução', icon: RotateCcw, feature: 'devolucoes' },
  { to: '/vendedor/devolucoes-mecanica', label: 'Mecânica (Devolução)', icon: Cog, feature: 'devolucoes_mecanica' },
  { to: '/vendedor/devolucoes-demonstracao', label: 'Demonstração', icon: PackageOpen, feature: 'devolucoes_demonstracao' },
  { to: '/vendedor/devolucoes-relatorios', label: 'Relatórios (Devolução)', icon: FileBarChart, feature: 'devolucoes' },
  { to: '/vendedor/devolucoes-ecommerce', label: 'Devolução E-commerce', icon: ShoppingCart, somenteEmpresa: SO_COMPRETEC_ECOMMERCE, feature: 'devolucoes_ecommerce' },
  { to: '/vendedor/leads', label: 'Leads', icon: UserPlus, feature: 'leads' },
  { to: '/vendedor/leads/kanban', label: 'Kanban de Leads', icon: Columns3, feature: 'leads' },
  { to: '/vendedor/arquivos', label: 'Arquivos/Mídia', icon: Folder, feature: 'arquivos' },
]

// Gestor (papel novo, 2026-09-30) — nasce só com isso, sem passar pelo
// filtro de features de VENDOR_LINKS/ADMIN_LINKS (o menu dele é fixo, quem
// controla o que ele PODE FAZER lá dentro é FEATURES_GESTOR em Permissões,
// não a visibilidade da tela). Lista de Leads igual o admin vê (todos os
// vendedores, com botão pra abrir o Kanban também), só os botões de
// transferir/excluir dependem do que foi liberado.
const GESTOR_LINKS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/vendedor/leads', label: 'Leads', icon: UserPlus },
]

// Paleta da sidebar colorida (pedido do João, 2026-10-20). Grupo sem cor
// escolhida em Grupos da Sidebar pega a cor pela posição dele na lista;
// itens soltos pegam pela posição deles. Tons médios de propósito — leem
// bem tanto no modo escuro quanto no claro.
export const PALETA_GRUPOS = ['#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#f97316', '#8b5cf6', '#14b8a6', '#6366f1', '#eab308', '#ef4444']

// Sidebar recolhida (só ícones) só existe no desktop — no mobile o menu
// continua sendo a gaveta de sempre, então as classes de "recolhido" são
// todas `md:` e os handlers checam a largura antes de agir.
function ehDesktop() {
  return window.matchMedia('(min-width: 768px)').matches
}

type Dica = { label: string; top: number; left: number } | null

// Uma linha da sidebar (link normal ou externo em nova aba) — usado tanto
// solto quanto dentro de um grupo aberto. `sub` = dentro de grupo (ícone
// sem quadradinho, entra animado em sequência via `atrasoMs`).
function SidebarItemLink({
  to,
  label,
  icon: Icon,
  end,
  external,
  cor,
  sub,
  atrasoMs,
  recolhido,
  onDica,
  onNavigate,
}: {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  external?: boolean
  cor: string
  sub?: boolean
  atrasoMs?: number
  recolhido: boolean
  onDica: (dica: Dica) => void
  // Fecha o menu no mobile depois de escolher um item — no desktop o
  // Sidebar é sempre visível, então isso não tem efeito nenhum lá.
  onNavigate?: () => void
}) {
  const classe = (ativo: boolean) =>
    `group/item relative flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-200 hover:translate-x-1 ${
      sub ? 'px-3 min-h-10 animate-[sidebar-entra_.3s_both]' : 'px-2.5 min-h-11'
    } ${recolhido ? 'md:hover:translate-x-0' : ''} ${ativo ? 'text-dark-50' : 'text-dark-300 hover:text-dark-100 hover:bg-dark-800'}`

  const conteudo = (ativo: boolean) => (
    <>
      <span className="absolute inset-0 rounded-xl transition-opacity duration-200" style={{ background: `${cor}24`, opacity: ativo ? 1 : 0 }} />
      <span
        className={`absolute ${sub ? '-left-[14px]' : '-left-3'} top-2 bottom-2 w-1 rounded-r transition-transform duration-200`}
        style={{ background: cor, transform: `scaleY(${ativo ? 1 : 0})` }}
      />
      {sub ? (
        <Icon size={17} className="relative shrink-0 transition-transform duration-200 group-hover/item:scale-115" style={{ color: cor }} />
      ) : (
        <span
          className="relative w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 transition-all duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] group-hover/item:scale-110 group-hover/item:-rotate-6"
          style={{ background: `${cor}${ativo ? '47' : '24'}`, color: cor, boxShadow: ativo ? `0 0 16px ${cor}73` : undefined }}
        >
          <Icon size={17} />
        </span>
      )}
      <span className={`relative flex-1 truncate transition-opacity duration-200 ${recolhido ? 'md:opacity-0' : ''}`}>{label}</span>
    </>
  )

  const eventos = {
    style: atrasoMs ? { animationDelay: `${atrasoMs}ms` } : undefined,
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      if (!recolhido || !ehDesktop()) return
      const r = e.currentTarget.getBoundingClientRect()
      onDica({ label, top: r.top + r.height / 2, left: r.right + 14 })
    },
    onMouseLeave: () => onDica(null),
  }

  if (external) {
    return (
      <a href={to} target="_blank" rel="noopener noreferrer" className={classe(false)} onClick={onNavigate} {...eventos}>
        {conteudo(false)}
      </a>
    )
  }
  return (
    <NavLink to={to} end={end} onClick={onNavigate} className={({ isActive }) => classe(isActive)} {...eventos}>
      {({ isActive }) => conteudo(isActive)}
    </NavLink>
  )
}

// `open`/`onClose` só controlam a gaveta no mobile (abaixo do breakpoint
// `md`) — no desktop o Sidebar continua sempre visível e fixo, exatamente
// como antes (pedido do João, 2026-08-31: não mexer em nada do desktop).
export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout, empresaAtivaId, trocarEmpresa, login } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  // Contas vinculadas (mesma pessoa, outra empresa — ex: Sergio em Joitec e
  // em Odin Tubos) — vem vazio pra quem não tem nenhuma, sem custo extra.
  const { data: contasVinculadas } = trpc.auth.minhasContasVinculadas.useQuery(undefined, { enabled: !!user && !user.superAdmin })
  const trocarContaMut = trpc.auth.trocarConta.useMutation({
    onSuccess(data) {
      login(data.token, data.user as any)
      window.location.reload()
    },
  })

  // Pra superAdmin devolve todas as empresas (seletor de troca); pra
  // qualquer outro usuário devolve só a própria (só pra mostrar o nome dela
  // aqui em cima, sem seletor).
  const { data: empresas } = trpc.empresas.list.useQuery(undefined, { enabled: !!user })
  const empresaAtiva = empresas?.find((e) => e.id === empresaAtivaId)
  const logoEmpresa = empresaAtiva ? LOGO_POR_EMPRESA[empresaAtiva.slug] : undefined

  // superAdmin sempre vê tudo, sem depender da query — evita a Sidebar
  // "piscar" vazia pro João enquanto minhasPermissoes ainda carrega.
  // Vendedor também usa essa query agora, só pra saber se ainda tem alguma
  // aba de relatório liberada (ver filtro de VENDOR_LINKS abaixo).
  const { data: minhasFeatures } = trpc.permissoes.minhasPermissoes.useQuery(undefined, {
    enabled: !!user && (user.role === 'vendor' || (user.role === 'admin' && !user.superAdmin)),
  })

  // Mesma regra pros dois papéis agora: superAdmin sempre vê tudo; qualquer
  // outro (admin ou vendedor) precisa ter a `feature` do item liberada em
  // Permissões. Gestor nem passa por esse filtro — o menu dele é fixo
  // (GESTOR_LINKS), não depende de feature liberada em Permissões.
  const links = user?.role === 'gestor' ? GESTOR_LINKS : (user?.role === 'admin' ? ADMIN_LINKS : VENDOR_LINKS).filter((l) => {
    const somenteEmpresas: string[] | undefined = 'somenteEmpresas' in l ? (l as { somenteEmpresas?: string[] }).somenteEmpresas : undefined
    return (
      (!l.somenteEmpresa || l.somenteEmpresa === empresaAtiva?.slug) &&
      (!somenteEmpresas || somenteEmpresas.includes(empresaAtiva?.slug ?? '')) &&
      (!l.ocultoEmpresa || l.ocultoEmpresa !== empresaAtiva?.slug) &&
      (user?.superAdmin || FEATURES_SEMPRE_LIBERADAS.has(l.feature) || !!minhasFeatures?.includes(l.feature))
    )
  })

  // Os 5 itens que sempre ficaram soltos, fora de ADMIN_LINKS/VENDOR_LINKS
  // (regra de visibilidade própria de cada um, não é `feature` normal) —
  // reunidos aqui numa forma comum (to/label/icon/external) pra poderem
  // entrar em "Grupos da Sidebar" igual qualquer outro item. "Marketing"
  // fica de fora de propósito (não tem `to` próprio, é sempre visível,
  // continua solto no fim como sempre foi).
  const extras: { to: string; label: string; icon: LucideIcon; external?: boolean; visivel: boolean }[] = [
    // Guia ilustrado do vendedor (página estática em client/public/guia/) —
    // pedido do João, 2026-10-20: disponível pra todo mundo, a qualquer hora.
    { to: '/guia/', label: 'Guia do CRM', icon: BookOpen, external: true, visivel: !!user },
    { to: '/painel-tv', label: 'Painel de TV', icon: Tv, external: true, visivel: user?.role === 'admin' && !!(user.superAdmin || minhasFeatures?.includes('painel_tv')) },
    { to: '/admin/permissoes', label: 'Permissões', icon: ShieldCheck, visivel: !!user?.superAdmin },
    { to: '/admin/funcoes', label: 'Funções', icon: UserCog, visivel: !!user?.superAdmin },
    { to: '/admin/leads-regioes', label: 'Regiões de Leads', icon: MapPin, visivel: !!user?.superAdmin },
    // Marketing — Geral e Painel de TV Marketing escondidos do menu (João
    // 2026-10-19: "pode tirar, depois construímos") — rotas continuam no App.tsx.
    // { to: '/admin/marketing-geral', label: 'Marketing — Geral', icon: BarChart3, visivel: !!user?.superAdmin },
    { to: '/admin/automacoes', label: 'Automações', icon: Zap, visivel: !!user?.superAdmin },
    { to: '/admin/sidebar-grupos', label: 'Grupos da Sidebar', icon: Layers, visivel: !!user?.superAdmin },
    // Histórico SAP fora do menu (João 2026-10-20: importação é feita por
    // script, não por tela) — rota /admin/historico-sap continua no App.tsx
    // só como saída de emergência pra desligar um lote.
    // { to: '/painel-tv-marketing', label: 'Painel de TV Marketing', icon: Tv, external: true, visivel: user?.role === 'admin' && !!(user.superAdmin || minhasFeatures?.includes('painel_tv_marketing')) },
    { to: '/painel-financeiro', label: 'Painel Financeiro', icon: Wallet, external: true, visivel: user?.role === 'admin' && !!(user.superAdmin || minhasFeatures?.includes('painel_financeiro')) },
    {
      // Sem trava de empresa aqui de propósito — a permissão concedida em
      // Permissões já decide quem vê (mesmo padrão de painel_tv/
      // painel_financeiro). O painel em si (dashboardOdin.ts) continua só
      // funcionando de verdade pra Odin Compressores hoje — outra empresa
      // com a permissão concedida vê o menu, mas o painel avisa que o
      // módulo ainda não está disponível pra ela.
      to: '/painel-tv-odin',
      label: 'Painel de TV Odin',
      icon: MonitorPlay,
      external: true,
      visivel: user?.role === 'admin' && !!(user.superAdmin || minhasFeatures?.includes('painel_tv_odin')),
    },
  ]

  // Lista combinada (links normais + extras visíveis) na forma comum que os
  // grupos usam pra saber o que agrupar. Ordem original preservada — quem
  // não entrar em nenhum grupo continua aparecendo solto nessa mesma ordem.
  const todosItensVisiveis: { to: string; label: string; icon: LucideIcon; end?: boolean; external?: boolean }[] = [
    ...links.map((l) => ({ to: l.to, label: l.label, icon: l.icon, end: 'end' in l ? l.end : undefined })),
    ...extras.filter((e) => e.visivel).map((e) => ({ to: e.to, label: e.label, icon: e.icon, external: e.external })),
  ]
  const itemPorTo = new Map(todosItensVisiveis.map((item) => [item.to, item]))

  // Grupos configurados em "Grupos da Sidebar" — globais, valem pra todo
  // mundo (não só quem configurou). Um grupo só aparece se sobrar pelo
  // menos 1 item visível pro usuário/empresa atual dentro dele.
  const { data: grupos } = trpc.sidebarGrupos.listar.useQuery(undefined, { enabled: !!user })
  const idsAgrupados = new Set(grupos?.flatMap((g) => g.itens) ?? [])

  // Só na Odin Compressores: a pasta CARTEIRA entra DENTRO da pasta ODIN
  // COMPRESSORES (como uma seção "Carteira"), em vez de ficar separada —
  // pedido do João, 2026-10-19: lá a equipe de peças (carteira) e a de
  // máquinas são a mesma empresa e ele quer tudo num lugar só. As pastas
  // em si são globais (Grupos da Sidebar) e continuam iguais pras outras
  // empresas; a junção é só na hora de desenhar. Achadas pelo nome.
  const grupoOdin = grupos?.find((g) => g.nome.trim().toUpperCase() === 'ODIN COMPRESSORES')
  const grupoCarteira = grupos?.find((g) => g.nome.trim().toUpperCase() === 'CARTEIRA')
  const juntarCarteiraNaOdin = empresaAtiva?.slug === SO_ODIN_COMPRESSORES && !!grupoOdin && !!grupoCarteira
  const gruposExibidos = juntarCarteiraNaOdin ? grupos?.filter((g) => g.id !== grupoCarteira!.id) : grupos
  const itensSoltos = todosItensVisiveis.filter((item) => !idsAgrupados.has(item.to))

  const [gruposAbertos, setGruposAbertos] = useState<Record<number, boolean>>({})
  function grupoEstaAberto(groupId: number) {
    if (groupId in gruposAbertos) return gruposAbertos[groupId]
    try {
      return localStorage.getItem(`sidebar_grupo_aberto_${groupId}`) === '1'
    } catch {
      return false
    }
  }
  function alternarGrupo(groupId: number) {
    const novoEstado = !grupoEstaAberto(groupId)
    setGruposAbertos((prev) => ({ ...prev, [groupId]: novoEstado }))
    try {
      localStorage.setItem(`sidebar_grupo_aberto_${groupId}`, novoEstado ? '1' : '0')
    } catch {
      // localStorage indisponível (modo privado etc.) — só não persiste entre sessões.
    }
  }

  function handleLogout() {
    logout()
    navigate('/login')
  }

  // Recolher/abrir a sidebar (desktop) — lembrado por navegador, igual os
  // grupos abertos acima.
  const [recolhido, setRecolhido] = useState(() => {
    try {
      return localStorage.getItem('sidebar_recolhida') === '1'
    } catch {
      return false
    }
  })
  function alternarRecolhido() {
    const novo = !recolhido
    setRecolhido(novo)
    setDica(null)
    try {
      localStorage.setItem('sidebar_recolhida', novo ? '1' : '0')
    } catch {
      // localStorage indisponível — só não persiste entre sessões.
    }
  }
  // Nome do item ao passar o mouse com a sidebar recolhida — desenhado num
  // portal no <body> porque a <nav> rola (overflow) e cortaria a dica.
  const [dica, setDica] = useState<Dica>(null)

  // Cor de cada item: a do grupo onde ele está, senão a da posição dele
  // entre os soltos — a busca usa o mesmo mapa pra não mudar de cor.
  const corPorTo = new Map<string, string>()
  grupos?.forEach((g, idx) => {
    const cor = g.cor ?? PALETA_GRUPOS[idx % PALETA_GRUPOS.length]
    g.itens.forEach((to) => corPorTo.set(to, cor))
  })
  if (juntarCarteiraNaOdin) {
    const corOdin = grupoOdin!.cor ?? PALETA_GRUPOS[grupos!.indexOf(grupoOdin!) % PALETA_GRUPOS.length]
    grupoCarteira!.itens.forEach((to) => corPorTo.set(to, corOdin))
  }
  itensSoltos.forEach((item, idx) => corPorTo.set(item.to, PALETA_GRUPOS[idx % PALETA_GRUPOS.length]))

  const { pathname } = useLocation()
  const itemAtivo = (to: string, end?: boolean) => pathname === to || (!end && pathname.startsWith(`${to}/`))
  const escondeSeRecolhido = recolhido ? 'md:hidden' : ''

  // Busca rápida — com a sidebar cheia de grupos, é mais fácil digitar um
  // pedaço do nome do que ficar abrindo grupo por grupo procurando. Enquanto
  // tem texto digitado, ignora a estrutura de grupos e mostra tudo que bateu
  // numa lista só (achar rápido é mais importante que manter a organização).
  // Bate tanto no nome do item quanto no nome do GRUPO — digitar "Marketing"
  // (nome do grupo) traz todos os itens de dentro dele, não só um item que
  // por acaso se chame igual.
  const [busca, setBusca] = useState('')
  const buscaNormalizada = busca.trim().toLowerCase()
  const gruposBatidos = grupos?.filter((g) => g.nome.toLowerCase().includes(buscaNormalizada)) ?? []
  const idsDeGruposBatidos = new Set(gruposBatidos.flatMap((g) => g.itens))
  const itensBuscados = buscaNormalizada
    ? todosItensVisiveis.filter((item) => item.label.toLowerCase().includes(buscaNormalizada) || idsDeGruposBatidos.has(item.to))
    : null

  return (
    <>
      {/* Fundo escurecido atrás da gaveta — só existe no mobile, some
          sozinho a partir do `md` porque o Sidebar nunca fica "aberto" lá. */}
      {open && <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 shrink-0 bg-dark-900 border-r border-dark-700 flex flex-col h-screen transform transition-[transform,width] duration-300 ease-out md:sticky md:top-0 md:translate-x-0 md:z-auto ${
          recolhido ? 'md:w-20' : ''
        } ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
      <button
        onClick={alternarRecolhido}
        aria-label={recolhido ? 'Abrir menu' : 'Recolher menu'}
        title={recolhido ? 'Abrir menu' : 'Recolher menu'}
        className="hidden md:flex absolute -right-4 top-7 z-30 w-8 h-8 rounded-full bg-gold-400 text-[#04121c] border-[3px] border-dark-950 items-center justify-center shadow-lg transition-transform duration-200 hover:scale-110"
      >
        <ChevronLeft size={16} strokeWidth={3} className={`transition-transform duration-300 ${recolhido ? 'rotate-180' : ''}`} />
      </button>

      <div className="px-4 py-4 border-b border-dark-700 flex items-start gap-2">
        <div className={`flex-1 min-w-0 ${escondeSeRecolhido}`}>
          {logoEmpresa ? (
            <div className="bg-white rounded-xl px-3 py-2.5 flex items-center justify-center">
              <img src={logoEmpresa} alt={empresaAtiva?.nome ?? 'Logo da empresa'} className="h-9 w-auto object-contain" />
            </div>
          ) : (
            <p className="font-heading text-gold-400 font-bold text-lg">CRM</p>
          )}
          <p className="text-xs text-dark-400 truncate mt-2 text-center">{empresaAtiva?.nome ?? '...'}</p>
        </div>
        <div
          className={`hidden w-12 h-12 mx-auto rounded-xl bg-white text-gold-600 font-heading font-bold text-xl items-center justify-center ${recolhido ? 'md:flex' : ''}`}
          title={empresaAtiva?.nome}
        >
          {empresaAtiva?.nome?.charAt(0).toUpperCase() ?? 'C'}
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-dark-400 hover:text-dark-100 hover:bg-dark-800 md:hidden shrink-0">
          <X size={18} />
        </button>
      </div>

      {/* superAdmin sempre vê o seletor (acessa qualquer empresa); admin
          comum só vê se tiver empresas extras concedidas (ver Permissões >
          Empresas extras) — nesse caso `empresas` já vem com mais de 1 linha
          da própria query, sem precisar de nenhum flag adicional aqui. */}
      {(user?.superAdmin || user?.role === 'admin') && empresas && empresas.length > 1 && (
        <div className={`px-4 pt-3 ${escondeSeRecolhido}`}>
          <label className="text-xs text-dark-500 block mb-1">Empresa</label>
          <select
            value={empresaAtivaId ?? ''}
            onChange={(e) => trocarEmpresa(Number(e.target.value))}
            className="w-full bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-100 px-2 py-1.5"
          >
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>
      )}

      {!user?.superAdmin && !!contasVinculadas?.length && (
        <div className={`px-4 pt-3 ${escondeSeRecolhido}`}>
          <label className="text-xs text-dark-500 block mb-1">Trocar empresa</label>
          <select
            value=""
            disabled={trocarContaMut.isPending}
            onChange={(e) => {
              const contaId = Number(e.target.value)
              if (contaId) trocarContaMut.mutate({ contaId })
            }}
            className="w-full bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-100 px-2 py-1.5"
          >
            <option value="">{empresaAtiva?.nome ?? '...'} (atual)</option>
            {contasVinculadas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.empresaNome}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={`px-3 pt-3 ${escondeSeRecolhido}`}>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar no menu..."
            className="w-full bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-100 placeholder-dark-500 pl-8 pr-2 py-1.5 focus:outline-none focus:border-gold-600"
          />
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden" onScroll={() => setDica(null)}>
        <div className="space-y-0.5">
          {itensBuscados && !recolhido ? (
            itensBuscados.length > 0 ? (
              itensBuscados.map((item) => (
                <SidebarItemLink
                  key={item.to}
                  {...item}
                  cor={corPorTo.get(item.to) ?? PALETA_GRUPOS[0]}
                  recolhido={recolhido}
                  onDica={setDica}
                  onNavigate={onClose}
                />
              ))
            ) : (
              <p className="text-xs text-dark-500 text-center py-4">Nada encontrado pra "{busca.trim()}"</p>
            )
          ) : (
            <>
              {gruposExibidos?.map((grupo) => {
                const itensDoGrupo = grupo.itens.map((to) => itemPorTo.get(to)).filter((i): i is NonNullable<typeof i> => !!i)
                const itensCarteira =
                  juntarCarteiraNaOdin && grupo.id === grupoOdin!.id
                    ? grupoCarteira!.itens
                        .filter((to) => !grupo.itens.includes(to))
                        .map((to) => itemPorTo.get(to))
                        .filter((i): i is NonNullable<typeof i> => !!i)
                    : []
                if (itensDoGrupo.length === 0 && itensCarteira.length === 0) return null
                const GrupoIcon = ICONES_GRUPO[grupo.icone] ?? Folder
                const aberto = grupoEstaAberto(grupo.id)
                const cor = grupo.cor ?? PALETA_GRUPOS[grupos!.indexOf(grupo) % PALETA_GRUPOS.length]
                const temAtivo = [...itensDoGrupo, ...itensCarteira].some((i) => !i.external && itemAtivo(i.to, i.end))
                return (
                  <div key={grupo.id}>
                    <button
                      onClick={() => {
                        // Recolhida: clicar no ícone do grupo reabre a
                        // sidebar já com esse grupo aberto.
                        if (recolhido && ehDesktop()) {
                          alternarRecolhido()
                          if (!aberto) alternarGrupo(grupo.id)
                          return
                        }
                        alternarGrupo(grupo.id)
                      }}
                      onMouseEnter={(e) => {
                        if (!recolhido || !ehDesktop()) return
                        const r = e.currentTarget.getBoundingClientRect()
                        setDica({ label: grupo.nome, top: r.top + r.height / 2, left: r.right + 14 })
                      }}
                      onMouseLeave={() => setDica(null)}
                      className={`group/item flex items-center gap-3 px-2.5 min-h-11 rounded-xl text-sm font-semibold transition-all duration-200 w-full hover:translate-x-1 hover:bg-dark-800 ${
                        recolhido ? 'md:hover:translate-x-0' : ''
                      } ${temAtivo ? 'text-dark-50' : 'text-dark-200 hover:text-dark-100'}`}
                    >
                      <span
                        className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 transition-all duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] group-hover/item:scale-110 group-hover/item:-rotate-6"
                        style={{ background: `${cor}${temAtivo ? '47' : '24'}`, color: cor, boxShadow: temAtivo ? `0 0 16px ${cor}66` : undefined }}
                      >
                        <GrupoIcon size={17} />
                      </span>
                      <span className={`flex-1 text-left truncate transition-opacity duration-200 ${recolhido ? 'md:opacity-0' : ''}`}>{grupo.nome}</span>
                      <ChevronDown
                        size={15}
                        style={{ color: cor }}
                        className={`shrink-0 transition-transform duration-300 ${aberto ? 'rotate-180' : ''} ${escondeSeRecolhido}`}
                      />
                    </button>
                    {aberto && (
                      <div className={`ml-[25px] pl-3 border-l-2 space-y-0.5 mt-0.5 mb-1.5 ${escondeSeRecolhido}`} style={{ borderColor: `${cor}4d` }}>
                        {itensDoGrupo.map((item, idx) => (
                          <SidebarItemLink
                            key={item.to}
                            {...item}
                            cor={cor}
                            sub
                            atrasoMs={idx * 35}
                            recolhido={recolhido}
                            onDica={setDica}
                            onNavigate={onClose}
                          />
                        ))}
                        {itensCarteira.length > 0 && (
                          <>
                            <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-dark-500">Carteira</p>
                            {itensCarteira.map((item, idx) => (
                              <SidebarItemLink
                                key={item.to}
                                {...item}
                                cor={cor}
                                sub
                                atrasoMs={(itensDoGrupo.length + idx) * 35}
                                recolhido={recolhido}
                                onDica={setDica}
                                onNavigate={onClose}
                              />
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {itensSoltos.map((item) => (
                <SidebarItemLink
                  key={item.to}
                  {...item}
                  cor={corPorTo.get(item.to) ?? PALETA_GRUPOS[0]}
                  recolhido={recolhido}
                  onDica={setDica}
                  onNavigate={onClose}
                />
              ))}
            </>
          )}
        </div>
      </nav>

      <div className="px-3 py-4 border-t border-dark-700">
        <div className={`flex items-center gap-3 px-2 py-2 mb-2 rounded-xl bg-dark-800/60 ${recolhido ? 'md:justify-center md:bg-transparent' : ''}`}>
          <div
            className="w-9 h-9 rounded-full bg-gold-700/30 border-2 border-gold-500/60 flex items-center justify-center text-gold-400 text-sm font-semibold shrink-0"
            title={recolhido ? user?.name : undefined}
          >
            {user?.name.charAt(0).toUpperCase()}
          </div>
          <div className={`flex-1 min-w-0 ${escondeSeRecolhido}`}>
            <div className="text-sm text-dark-100 font-medium truncate">{user?.name}</div>
            <div className="text-xs text-dark-400 capitalize">
              {user?.role === 'admin' ? 'Administrador' : user?.role === 'gestor' ? 'Gestor' : 'Vendedor'}
            </div>
          </div>
        </div>
        <button
          onClick={toggleTheme}
          title={recolhido ? (theme === 'dark' ? 'Modo claro' : 'Modo escuro') : undefined}
          className={`flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-dark-400 hover:text-gold-400 hover:bg-dark-800 transition-all mb-1 ${recolhido ? 'md:justify-center md:px-0' : ''}`}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <span className={escondeSeRecolhido}>{theme === 'dark' ? 'Modo claro' : 'Modo escuro'}</span>
        </button>
        <button
          onClick={handleLogout}
          title={recolhido ? 'Sair' : undefined}
          className={`flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-dark-400 hover:text-red-400 hover:bg-red-900/20 transition-all ${recolhido ? 'md:justify-center md:px-0' : ''}`}
        >
          <LogOut size={16} />
          <span className={escondeSeRecolhido}>Sair</span>
        </button>
      </div>
      </aside>
      {dica &&
        createPortal(
          <div
            className="fixed z-[100] -translate-y-1/2 px-3 py-1.5 rounded-lg bg-dark-700 text-dark-50 text-[13px] font-medium shadow-xl pointer-events-none whitespace-nowrap animate-[sidebar-entra_.15s_both]"
            style={{ top: dica.top, left: dica.left }}
          >
            {dica.label}
          </div>,
          document.body
        )}
    </>
  )
}
