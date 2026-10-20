import { useState } from 'react'
import type { ComponentType } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { BarraFiltros, useFiltrosRelatorio } from '../../components/relatorios/filtros'
import { baseRelatorios, relatoriosPermitidos, RELATORIOS_DETALHADOS } from '../../components/relatorios/catalogo'
import ExplicacaoMetricas from '../../components/relatorios/ExplicacaoMetricas'
import AdminReports from '../admin/Reports'
import { ClientesParados, CurvaAbc, Positivacao } from './detalhes/Carteira'
import { Orcamentos, Perdas, Produtos, TodasEmpresas, Vendas } from './detalhes/Vendas'
import { Contatos, Ligacoes } from './detalhes/Contatos'
import type { PropsDetalhe } from './detalhes/tipos'

const COMPONENTES: Record<string, ComponentType<PropsDetalhe>> = {
  positivacao: Positivacao,
  'curva-abc': CurvaAbc,
  vendas: Vendas,
  orcamentos: Orcamentos,
  produtos: Produtos,
  contatos: Contatos,
  ligacoes: Ligacoes,
  'clientes-parados': ClientesParados,
  perdas: Perdas,
  'todas-empresas': TodasEmpresas,
}

// Relatórios que olham a "foto de agora" (não usam o período).
const SEM_PERIODO = new Set(['clientes-parados'])

export default function DetalheRelatorio() {
  const { slug = '' } = useParams()
  const { user } = useAuth()
  const f = useFiltrosRelatorio()
  const { data: features, isLoading } = trpc.permissoes.minhasPermissoes.useQuery(undefined, { enabled: !!user && !user.superAdmin })
  const [mostrarResumo, setMostrarResumo] = useState(() => {
    try {
      return localStorage.getItem('relatorios:mostrarResumo') !== '0'
    } catch {
      return true
    }
  })
  const base = baseRelatorios(user?.role)

  // Tela antiga mantida por um tempo, pra comparar (só admin).
  if (slug === 'antigo' && user?.role === 'admin') return <AdminReports />

  const rel = RELATORIOS_DETALHADOS.find((r) => r.slug === slug)
  const Componente = COMPONENTES[slug]
  if (!rel || !Componente) return <Navigate to={base} replace />
  if (!user?.superAdmin && isLoading) return <p className="p-6 text-dark-400 text-sm">Carregando...</p>
  if (!relatoriosPermitidos(user, features).some((r) => r.slug === slug)) {
    return (
      <div className="p-6">
        <p className="text-dark-300">Você não tem acesso a esse relatório. Fale com o administrador.</p>
        <Link to={base} className="text-gold-500 text-sm hover:underline">
          Voltar pros relatórios
        </Link>
      </div>
    )
  }

  const simples = user?.role !== 'admin'
  const alternarResumo = () => {
    const novo = !mostrarResumo
    setMostrarResumo(novo)
    try {
      localStorage.setItem('relatorios:mostrarResumo', novo ? '1' : '0')
    } catch {
      // ignora
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px]">
      <div>
        <nav className="flex items-center gap-1 text-xs text-dark-400 mb-2">
          <Link to={base} className="hover:text-gold-400">
            Relatórios
          </Link>
          <ChevronRight size={12} />
          <span className="text-dark-300">{rel.titulo}</span>
        </nav>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${rel.cor}1f`, color: rel.cor }}>
              <rel.icone size={22} />
            </span>
            <div>
              <h1 className="font-heading text-2xl font-bold text-dark-50">{rel.titulo}</h1>
              <p className="text-sm text-dark-400">
                {rel.descricao}
                {simples ? ' Só os seus clientes.' : ''}
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-dark-200 cursor-pointer select-none mt-1">
            Mostrar resumo
            <button
              type="button"
              role="switch"
              aria-checked={mostrarResumo}
              onClick={alternarResumo}
              className={`relative w-11 h-6 rounded-full transition-colors ${mostrarResumo ? 'bg-gold-500' : 'bg-dark-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${mostrarResumo ? 'translate-x-5' : ''}`} />
            </button>
          </label>
        </div>
      </div>
      <BarraFiltros f={f} semPeriodo={SEM_PERIODO.has(slug)} semVendedor={slug === 'todas-empresas'} />
      <ExplicacaoMetricas chave={slug} />
      <Componente f={f} simples={simples} mostrarResumo={mostrarResumo} clientesBase={user?.role === 'admin' ? '/admin/clientes' : '/vendedor/clientes'} />
    </div>
  )
}
