import type { Filtros } from '../../../components/relatorios/filtros'

export type PropsDetalhe = {
  f: Filtros
  // Versão do vendedor: só os dados dele, menos colunas e sem ranking.
  simples: boolean
  // "Mostrar resumo" ligado = números grandes e gráficos acima da tabela.
  mostrarResumo: boolean
  clientesBase: string
}
