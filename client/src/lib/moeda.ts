// Formatação de valores em R$ — existia reescrita em 18 arquivos
// diferentes, cada um com sua própria função `formatarMoeda`, algumas
// arredondando pro real fechado e outras mostrando centavos, e cada uma
// tratando valor nulo/indefinido de um jeito (retornava '—', 'R$ 0,00',
// '' ou quebrava). Consolidado aqui em 2026-09-30 (pedido do João após a
// revisão geral de bugs visuais) pra próxima correção de comportamento
// não precisar ser feita em 18 lugares — cada tela mantém o `casas`/`vazio`
// que já usava antes, só a implementação virou uma só.
export function formatarMoeda(v: number | null | undefined, opts?: { casas?: 0 | 2; vazio?: string }): string {
  if (v == null || Number.isNaN(v)) return opts?.vazio ?? '—'
  const casas = opts?.casas ?? 2
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
}
