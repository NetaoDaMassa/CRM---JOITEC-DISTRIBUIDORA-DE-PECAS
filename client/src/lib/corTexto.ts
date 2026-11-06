// Cor de TEXTO que vem do código (style={{ color }}): etapas, selos, status.
// Essas cores são vivas pra aparecer no fundo escuro; no tema claro ficam
// fracas. Aqui ela escurece só no claro (--escurecer-texto em index.css, 0% no
// escuro, onde a cor fica igual). Fundo e barra continuam com a cor original.
export function corTexto(cor: string | null | undefined): string | undefined {
  if (!cor) return undefined
  return `color-mix(in oklab, ${cor} calc(100% - var(--escurecer-texto, 0%)), black)`
}
