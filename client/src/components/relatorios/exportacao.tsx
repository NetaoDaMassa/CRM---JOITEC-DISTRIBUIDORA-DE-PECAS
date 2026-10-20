import { createContext, useContext } from 'react'

// Exportação dos relatórios (PDF + Excel) — pedido do João, 2026-10-20.
// A tela de exportação renderiza os MESMOS componentes dos relatórios (pra
// os números nunca divergirem da tela) dentro deste contexto:
//  - TabelaDados mostra as linhas sem paginação/barra de busca (limitado a
//    `limiteLinhas` no PDF) e entrega TODAS as linhas pro coletor do Excel;
//  - KpiCard/MiniNumero levam `data-kpi*` no HTML, lidos na hora de montar a
//    aba "Resumo" do Excel.

export type FormatoExportacao = 'texto' | 'moeda' | 'numero' | 'pct' | 'data'

export type TabelaExportada = {
  titulo: string
  colunas: { rotulo: string; formato: FormatoExportacao }[]
  linhas: (string | number | null)[][]
}

export type ContextoExportacao = {
  // Relatório (slug) que está sendo renderizado — agrupa as tabelas.
  secao: string
  limiteLinhas: number
  registrar: (secao: string, id: string, tabela: TabelaExportada | null) => void
}

export const ExportacaoContext = createContext<ContextoExportacao | null>(null)

export const useExportacao = () => useContext(ExportacaoContext)

// Nome da aba do Excel a partir do nome do CSV que a tabela já tinha.
const TITULOS: Record<string, string> = {
  'cobertura-por-vendedor': 'Cobertura por vendedor',
  'contatos-por-cliente': 'Contatos por cliente',
  'contatos-por-dia': 'Contatos por dia',
  'positivacao-por-vendedor': 'Positivação por vendedor',
  'vendas-por-vendedor': 'Vendas por vendedor',
  'vendas-por-dia': 'Vendas por dia',
  'atividade-da-carteira': 'Clientes (atividade)',
  'ligacoes-por-vendedor': 'Ligações por vendedor',
  'ligacoes-por-cliente': 'Ligações por cliente',
  'ligacoes-detalhado': 'Ligações uma a uma',
  'curva-abc': 'Curva ABC',
  'orcamentos-no-periodo': 'Orçamentos feitos',
  'orcamentos-em-aberto': 'Orçamentos em aberto',
  'orcamentos-por-vendedor': 'Orçamentos por vendedor',
  'clientes-parados-contato': 'Sem contato',
  'clientes-parados-orcamento': 'Sem orçamento',
  'clientes-parados-venda': 'Sem compra',
  'clientes-parados-intocados': 'Sem contato e orçamento',
  'itens-mais-comprados': 'Itens mais comprados',
  'mix-por-vendedor': 'Mix por vendedor',
  'motivos-de-perda': 'Motivos de perda',
  'todas-as-empresas': 'Todas as empresas',
}

export function tituloDoArquivo(nomeArquivo: string) {
  const base = nomeArquivo.replace(/\.csv$/i, '')
  if (TITULOS[base]) return TITULOS[base]
  const texto = base.replace(/[-_]+/g, ' ').trim()
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

// Lê os números grandes (KpiCard/MiniNumero) de um bloco já renderizado.
export function lerKpis(raiz: HTMLElement) {
  return [...raiz.querySelectorAll<HTMLElement>('[data-kpi]')].map((el) => ({
    metrica: el.querySelector('[data-kpi-titulo]')?.textContent?.trim() ?? '',
    valor: el.querySelector('[data-kpi-valor]')?.textContent?.trim() ?? '',
    detalhe: el.querySelector('[data-kpi-detalhe]')?.textContent?.trim() ?? '',
  }))
}
