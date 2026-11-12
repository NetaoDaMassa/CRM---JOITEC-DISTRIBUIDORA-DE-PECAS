// Texto dos volumes de um pedido da Expedição. Odin Tubos embala em packs
// (tubos), sacos e caixas (conexões) — volumes = soma (João 2026-11-12).
export function textoVolumes(p: { volumes?: number | null; packs?: number | null; sacos?: number | null; caixas?: number | null }): string | null {
  const partes = [
    p.packs ? `${p.packs} pack${p.packs > 1 ? 's' : ''}` : null,
    p.sacos ? `${p.sacos} saco${p.sacos > 1 ? 's' : ''}` : null,
    p.caixas ? `${p.caixas} caixa${p.caixas > 1 ? 's' : ''}` : null,
  ].filter(Boolean)
  if (p.volumes == null && !partes.length) return null
  const total = p.volumes ?? 0
  return `${total} volume${total === 1 ? '' : 's'}${partes.length ? ` (${partes.join(' · ')})` : ''}`
}
