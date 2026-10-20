import { useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useIsFetching } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChevronRight, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { downloadBase64Excel } from '../../lib/utils'
import { BarraFiltros, REGIOES, formatarDataCurta, useFiltrosRelatorio } from '../../components/relatorios/filtros'
import type { Filtros } from '../../components/relatorios/filtros'
import { baseRelatorios, relatoriosPermitidos } from '../../components/relatorios/catalogo'
import { ExportacaoContext, lerKpis } from '../../components/relatorios/exportacao'
import type { ContextoExportacao, TabelaExportada } from '../../components/relatorios/exportacao'
import { ResumoConteudo } from './Resumo'
import { ClientesParados, CurvaAbc, Positivacao } from './detalhes/Carteira'
import { Orcamentos, Perdas, Produtos, TodasEmpresas, Vendas } from './detalhes/Vendas'
import { Contatos, Ligacoes } from './detalhes/Contatos'
import type { PropsDetalhe } from './detalhes/tipos'

// Exportar relatórios (pedido do João, 2026-10-20): escolhe quais relatórios
// entram, usa os mesmos filtros da tela, e gera PDF (impressão do navegador,
// sai como documento claro, sem menu) ou Excel (uma aba por tabela + aba
// Resumo). A "folha" da direita é exatamente o que vai pro PDF.

const LOGO_POR_EMPRESA: Record<string, string> = {
  joitec: '/logos/joitec-sidebar.png',
  'joitec-automacao': '/logos/joitec-sidebar.png',
  'odin-tubos': '/logos/odin-tubos-sidebar.png',
}

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

const LIMITES = [
  { valor: 0, rotulo: 'Sem tabelas' },
  { valor: 30, rotulo: '30 linhas' },
  { valor: 100, rotulo: '100 linhas' },
  { valor: 1000, rotulo: 'Até 1.000' },
]

function ResumoComoDetalhe({ f }: PropsDetalhe) {
  return <ResumoConteudo f={f as Filtros} naExportacao />
}

export default function ExportarRelatorios() {
  const { user, empresaAtivaId } = useAuth()
  const f = useFiltrosRelatorio()
  const ehAdmin = user?.role === 'admin'
  const base = baseRelatorios(user?.role)
  const [params] = useSearchParams()
  const { data: features } = trpc.permissoes.minhasPermissoes.useQuery(undefined, { enabled: !!user && !user.superAdmin })
  const { data: empresas } = trpc.empresas.list.useQuery(undefined, { enabled: !!user })
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: ehAdmin })
  const empresa = empresas?.find((e) => e.id === empresaAtivaId)

  const opcoes = useMemo(
    () => [
      { slug: 'resumo', titulo: 'Resumo geral', descricao: 'Números principais, carteira, vendas, rankings e alertas.', cor: '#24aff4' },
      ...relatoriosPermitidos(user, features).map((r) => ({ slug: r.slug, titulo: r.titulo, descricao: r.descricao, cor: r.cor })),
    ],
    [user, features]
  )
  const [marcados, setMarcados] = useState<string[]>(() => (params.get('r') ?? 'resumo').split(',').filter(Boolean))
  const [limite, setLimite] = useState(30)
  const selecionados = opcoes.filter((o) => marcados.includes(o.slug))

  // Tabelas registradas pelos relatórios renderizados na folha (ver
  // TabelaDados) — ref, não estado, pra não re-renderizar a cada registro.
  const tabelas = useRef(new Map<string, Map<string, TabelaExportada>>())
  const folha = useRef<HTMLDivElement>(null)
  const carregando = useIsFetching() > 0
  const excel = trpc.exportacao.excel.useMutation()

  const contexto = (secao: string): ContextoExportacao => ({
    secao,
    limiteLinhas: limite,
    registrar: (s, id, t) => {
      const mapa = tabelas.current.get(s) ?? new Map<string, TabelaExportada>()
      if (t) mapa.set(id, t)
      else mapa.delete(id)
      tabelas.current.set(s, mapa)
    },
  })
  // Um contexto estável por relatório (o TabelaDados usa como dependência).
  const contextos = useMemo(() => Object.fromEntries(opcoes.map((o) => [o.slug, contexto(o.slug)])), [opcoes, limite]) // eslint-disable-line react-hooks/exhaustive-deps

  const nomeVendedor = f.vendedorId ? vendedores?.find((v) => String(v.id) === f.vendedorId)?.name : null
  const nomeRegiao = f.regiao ? REGIOES.find((r) => r.valor === f.regiao)?.rotulo : null
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  const info = [
    `Empresa: ${empresa?.nome ?? ''}`,
    `Período: ${formatarDataCurta(f.inicio)} a ${formatarDataCurta(f.fim)}`,
    `Vendedor: ${ehAdmin ? (nomeVendedor ?? 'Todos') : (user?.name ?? '')}`,
    `Região: ${nomeRegiao ?? 'Todas'}`,
    `Gerado em ${agora} por ${user?.name ?? ''}`,
  ]
  const nomeArquivo = `relatorios-${(empresa?.nome ?? 'empresa').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-${f.inicio}_a_${f.fim}`

  function alternar(slug: string) {
    setMarcados((m) => (m.includes(slug) ? m.filter((s) => s !== slug) : [...m, slug]))
  }

  function baixarPdf() {
    const tituloAntes = document.title
    // O Chrome usa o título da página como nome do arquivo PDF.
    document.title = nomeArquivo
    const restaurar = () => {
      document.title = tituloAntes
      window.removeEventListener('afterprint', restaurar)
    }
    window.addEventListener('afterprint', restaurar)
    window.print()
  }

  async function baixarExcel() {
    if (!folha.current) return
    const resumo = selecionados.flatMap((o) => {
      const raiz = folha.current!.querySelector<HTMLElement>(`[data-secao="${o.slug}"]`)
      return raiz ? lerKpis(raiz).map((k) => ({ relatorio: o.titulo, ...k })) : []
    })
    const lista = selecionados.flatMap((o) => [...(tabelas.current.get(o.slug)?.values() ?? [])].map((t) => ({ relatorio: o.titulo, ...t })))
    try {
      const r = await excel.mutateAsync({ titulo: `Relatórios — ${empresa?.nome ?? ''}`, info, resumo, tabelas: lista })
      downloadBase64Excel(r.data, `${nomeArquivo}.xlsx`)
      toast.success('Excel baixado')
    } catch {
      toast.error('Não deu pra gerar o Excel — tente com menos relatórios ou um período menor.')
    }
  }

  const botao = 'h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] print:p-0 print:max-w-none print:space-y-0">
      <div className="print:hidden">
        <nav className="flex items-center gap-1 text-xs text-dark-400 mb-2">
          <Link to={base} className="hover:text-gold-400">
            Relatórios
          </Link>
          <ChevronRight size={12} />
          <span className="text-dark-300">Exportar</span>
        </nav>
        <h1 className="font-heading text-2xl font-bold text-dark-50">Exportar relatórios</h1>
        <p className="text-sm text-dark-400">Escolha os relatórios e os filtros. A folha à direita é exatamente o que sai no PDF; o Excel leva uma aba por tabela, com todas as linhas.</p>
      </div>
      <div className="print:hidden">
        <BarraFiltros f={f} />
      </div>

      <div className="grid lg:grid-cols-[300px_1fr] gap-5 items-start print:block">
        {/* Painel de escolha — não sai na impressão */}
        <aside className="space-y-4 lg:sticky lg:top-4 print:hidden">
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-dark-50">Relatórios ({selecionados.length})</p>
              <div className="flex gap-2 text-xs">
                <button type="button" className="text-gold-500 hover:text-gold-400" onClick={() => setMarcados(opcoes.map((o) => o.slug))}>
                  Todos
                </button>
                <button type="button" className="text-dark-400 hover:text-dark-200" onClick={() => setMarcados([])}>
                  Limpar
                </button>
              </div>
            </div>
            <ul className="space-y-1">
              {opcoes.map((o) => (
                <li key={o.slug}>
                  <label className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-dark-700 cursor-pointer">
                    <input type="checkbox" checked={marcados.includes(o.slug)} onChange={() => alternar(o.slug)} className="mt-0.5 accent-[#0d9de0]" />
                    <span>
                      <span className="flex items-center gap-1.5 text-sm text-dark-100">
                        <span className="w-2 h-2 rounded-full" style={{ background: o.cor }} />
                        {o.titulo}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <p className="text-sm font-semibold text-dark-50 mb-2">Tabelas no PDF</p>
            <div className="grid grid-cols-2 gap-1.5">
              {LIMITES.map((l) => (
                <button
                  key={l.valor}
                  type="button"
                  onClick={() => setLimite(l.valor)}
                  className={`h-8 rounded-lg text-xs font-medium border ${limite === l.valor ? 'bg-gold-500 border-gold-500 text-white' : 'border-dark-600 text-dark-300 hover:text-dark-100'}`}
                >
                  {l.rotulo}
                </button>
              ))}
            </div>
            <p className="text-xs text-dark-500 mt-2">Só muda o PDF. O Excel sempre leva todas as linhas.</p>
          </div>

          <div className="space-y-2">
            <button type="button" onClick={baixarPdf} disabled={!selecionados.length || carregando} className={`${botao} w-full bg-gold-500 hover:bg-gold-600 text-white`}>
              <FileText size={17} /> Baixar PDF
            </button>
            <button
              type="button"
              onClick={baixarExcel}
              disabled={!selecionados.length || carregando || excel.isPending}
              className={`${botao} w-full bg-emerald-600 hover:bg-emerald-700 text-white`}
            >
              {excel.isPending ? <Loader2 size={17} className="animate-spin" /> : <FileSpreadsheet size={17} />} Baixar Excel
            </button>
            {carregando && (
              <p className="text-xs text-dark-400 flex items-center gap-1.5">
                <Loader2 size={13} className="animate-spin" /> Carregando os dados…
              </p>
            )}
            <p className="text-xs text-dark-500">No PDF, escolha "Salvar como PDF" no destino da janela de impressão.</p>
          </div>
        </aside>

        {/* Folha — o que vai pro PDF */}
        <div ref={folha} className="doc-claro bg-dark-800 text-dark-100 rounded-2xl border border-dark-600 shadow-xl p-6 md:p-8 space-y-8 min-w-0 print:border-0 print:shadow-none print:rounded-none print:p-0">
          <header className="flex items-start justify-between gap-4 border-b border-dark-600 pb-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-dark-400">Relatórios</p>
              <h2 className="font-heading text-2xl font-bold text-dark-50">{empresa?.nome}</h2>
              <p className="text-sm text-dark-300 mt-1">
                {formatarDataCurta(f.inicio)} a {formatarDataCurta(f.fim)}
                {ehAdmin ? ` · ${nomeVendedor ?? 'Todos os vendedores'}` : ` · ${user?.name ?? ''}`}
                {nomeRegiao ? ` · Região ${nomeRegiao}` : ''}
              </p>
              <p className="text-xs text-dark-400 mt-0.5">
                Gerado em {agora} por {user?.name}
              </p>
            </div>
            {empresa && LOGO_POR_EMPRESA[empresa.slug] && <img src={LOGO_POR_EMPRESA[empresa.slug]} alt="" className="h-12 w-auto object-contain" />}
          </header>

          {!selecionados.length && <p className="text-sm text-dark-400">Marque pelo menos um relatório à esquerda.</p>}

          {selecionados.map((o, i) => {
            const Componente = o.slug === 'resumo' ? ResumoComoDetalhe : COMPONENTES[o.slug]
            if (!Componente) return null
            return (
              <section key={o.slug} data-secao={o.slug} className={i > 0 ? 'break-before-page' : ''}>
                <h2 className="font-heading text-xl font-bold text-dark-50 mb-1 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: o.cor }} />
                  {o.titulo}
                </h2>
                <p className="text-xs text-dark-400 mb-4">{o.descricao}</p>
                <ExportacaoContext.Provider value={contextos[o.slug]}>
                  <Componente f={f} simples={!ehAdmin} mostrarResumo clientesBase={ehAdmin ? '/admin/clientes' : '/vendedor/clientes'} />
                </ExportacaoContext.Provider>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
