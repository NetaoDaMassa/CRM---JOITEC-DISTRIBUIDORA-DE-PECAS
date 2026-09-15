import { Link } from 'react-router-dom'
import { Building2, Wallet, Ship, Tv, BarChart3, Folder, Fuel } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// Hub simples com atalhos pras coisas "gerais do grupo" (não de uma empresa
// específica) — Financeiro, Compras, Marketing, relatórios, etc. Pedido do
// João, 2026-09-15, ainda em construção: começa só com o que já existe no
// CRM; ele vai definir com calma o resto (painéis por empresa, Power BI)
// pra ir entrando aqui depois.
const ATALHOS: { to: string; label: string; description: string; icon: LucideIcon; external?: boolean }[] = [
  { to: '/painel-financeiro', label: 'Painel Financeiro', description: 'Visão consolidada de faturamento de todas as empresas.', icon: Wallet, external: true },
  { to: '/admin/requisicao-posto', label: 'Requisição Posto', description: 'Controle de abastecimento do grupo.', icon: Fuel },
  { to: '/admin/compras', label: 'Compras', description: 'Pedidos e fornecedores.', icon: Ship },
  { to: '/admin/arquivos', label: 'Arquivos/Mídia (Marketing)', description: 'Material de marketing de todas as empresas.', icon: Folder },
  { to: '/admin/relatorios', label: 'Relatórios', description: 'Relatórios gerais de vendas e atendimento.', icon: BarChart3 },
  { to: '/painel-tv', label: 'Painel de TV', description: 'Ranking e indicadores pro telão.', icon: Tv, external: true },
]

function CardAtalho({ item }: { item: (typeof ATALHOS)[number] }) {
  const Icon = item.icon
  const conteudo = (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 flex items-start gap-3 hover:border-gold-600/50 transition-colors h-full">
      <Icon size={20} className="text-gold-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-dark-100">{item.label}</p>
        <p className="text-xs text-dark-400 mt-0.5">{item.description}</p>
      </div>
    </div>
  )
  return item.external ? (
    <a href={item.to} target="_blank" rel="noopener noreferrer">
      {conteudo}
    </a>
  ) : (
    <Link to={item.to}>{conteudo}</Link>
  )
}

export default function GrupoOdin() {
  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <Building2 size={20} className="text-gold-400" />
        <div>
          <h1 className="font-heading text-xl text-dark-50">Grupo Odin</h1>
          <p className="text-sm text-dark-400">Atalhos pro que é geral do grupo, sem precisar trocar de empresa. Em construção.</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {ATALHOS.map((item) => (
          <CardAtalho key={item.to} item={item} />
        ))}
      </div>

      <p className="text-xs text-dark-500">
        Ainda vem por aí: painéis separados por empresa e Power BI do grupo — assim que definir exatamente o que entra, é só pedir pra eu adicionar aqui.
      </p>
    </div>
  )
}
