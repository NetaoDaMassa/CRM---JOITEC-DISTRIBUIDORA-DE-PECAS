// Etiquetas pra impressora térmica (pedido do João, 2026-10-29) — item na
// conferência e volume na embalagem. Uma etiqueta por página, com @page no
// tamanho da etiqueta (em mm), preto e branco, código de barras CODE128
// (JsBarcode). Cada computador lembra o tamanho escolhido (localStorage).

// 80 × 40 mm = etiqueta padrão do estoque (João, 2026-11-16).
export const TAMANHOS_ETIQUETA = [
  { id: '80x40', w: 80, h: 40, label: '80 × 40 mm (padrão)' },
  { id: '100x50', w: 100, h: 50, label: '100 × 50 mm' },
  { id: '100x75', w: 100, h: 75, label: '100 × 75 mm' },
  { id: '100x100', w: 100, h: 100, label: '100 × 100 mm' },
  { id: '100x150', w: 100, h: 150, label: '100 × 150 mm' },
  { id: '60x40', w: 60, h: 40, label: '60 × 40 mm' },
  { id: '50x30', w: 50, h: 30, label: '50 × 30 mm' },
] as const
export type TamanhoEtiqueta = (typeof TAMANHOS_ETIQUETA)[number]

const PADRAO: Record<'item' | 'volume', string> = { item: '80x40', volume: '80x40' }

export function lerTamanho(tipo: 'item' | 'volume'): TamanhoEtiqueta {
  let id = PADRAO[tipo]
  try {
    id = localStorage.getItem(`etiqueta_${tipo}_tamanho`) ?? id
  } catch {
    /* sem localStorage: usa o padrão */
  }
  return TAMANHOS_ETIQUETA.find((t) => t.id === id) ?? TAMANHOS_ETIQUETA[0]
}

export function salvarTamanho(tipo: 'item' | 'volume', id: string) {
  try {
    localStorage.setItem(`etiqueta_${tipo}_tamanho`, id)
  } catch {
    /* sem localStorage: só não lembra */
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export interface EtiquetaItem {
  codigo: string | null
  descricao: string
  pedido: string
  localizacao?: string | null
  // Odin Tubos (João, 2026-11-17): código antigo (POD05…) em destaque e
  // "PACOTE: 5 UNIDADES" — quantidade digitada na hora de imprimir.
  codigoAntigo?: string | null
  pacote?: number | null
}

// Unidades por pacote: cada computador lembra o último valor de cada item.
export function lerPacote(codigo: string | null): string {
  if (!codigo) return ''
  try { return localStorage.getItem(`etiqueta_pacote_${codigo}`) ?? '' } catch { return '' }
}
export function salvarPacote(codigo: string | null, valor: string) {
  if (!codigo) return
  try { if (Number(valor) > 0) localStorage.setItem(`etiqueta_pacote_${codigo}`, String(Number(valor))); else localStorage.removeItem(`etiqueta_pacote_${codigo}`) } catch { /* sem storage */ }
}

export interface EtiquetaVolume {
  numero: number
  total: number
  cliente: string
  endereco: string | null
  transportadora: string | null
  nf: string | null
  pedido: string
  remetente: string
}

export function htmlEtiquetaItem(e: EtiquetaItem, t: TamanhoEtiqueta): string {
  const pequena = t.h <= 40
  const pacote = e.pacote && e.pacote > 0 ? e.pacote : null
  // Com código antigo: ele vem grande e o do SAP pequeno ao lado do pedido.
  const principal = e.codigoAntigo || e.codigo || ''
  const lateral = e.codigoAntigo && e.codigo ? `${esc(e.codigo)} · Pedido ${esc(e.pedido)}` : `Pedido ${esc(e.pedido)}`
  const barra = pacote ? (pequena ? 0.22 : 0.27) : pequena ? 0.28 : 0.32
  return `<div class="et">
    <div class="desc" style="font-size:${pequena ? 2.6 : 3.6}mm">${esc(e.descricao)}</div>
    <div class="linha"><b style="font-size:${pequena ? 3.4 : 5}mm">${esc(principal)}</b><span>${lateral}</span></div>
    ${pacote ? `<div style="font-size:${pequena ? 3.4 : 4.6}mm;font-weight:800;text-align:center;border:0.3mm solid #000;border-radius:1mm;padding:0.2mm 0">PACOTE: ${pacote} ${pacote === 1 ? 'UNIDADE' : 'UNIDADES'}</div>` : ''}
    ${e.codigo ? `<svg class="bc" data-v="${esc(e.codigo)}" data-h="${Math.round(t.h * barra)}"></svg>` : ''}
  </div>`
}

// Código de barras do volume: "V<pedido>-<nº do volume>" — o leitor da coleta
// conta volume por volume (João, 2026-11-13). Antes era o nº da NF (igual em
// todos os volumes); etiqueta antiga ainda é aceita pelo leitor (acha o pedido).
export const codigoEtiquetaVolume = (pedidosSap: string, volume: number) => `V${pedidosSap.split(',')[0].trim()}-${volume}`

export function htmlEtiquetaVolume(e: EtiquetaVolume, t: TamanhoEtiqueta): string {
  if (t.h <= 50) return htmlEtiquetaVolumeCompacta(e, t)
  const k = t.h / 100 // escala pela altura (base 100 mm)
  const f = (mm: number) => `${Math.max(2.2, mm * k).toFixed(1)}mm`
  return `<div class="et vol">
    <div class="topo"><span style="font-size:${f(4)}">${esc(e.remetente)}</span><b style="font-size:${f(9)}">VOL ${e.numero}/${e.total}</b></div>
    <div class="rot" style="font-size:${f(3)}">DESTINATÁRIO</div>
    <div style="font-size:${f(5.5)};font-weight:700;line-height:1.1">${esc(e.cliente)}</div>
    ${e.endereco ? `<div style="font-size:${f(3.6)}">${esc(e.endereco)}</div>` : ''}
    <div class="grade">
      <div><div class="rot" style="font-size:${f(3)}">TRANSPORTADORA</div><b style="font-size:${f(5)}">${esc(e.transportadora || '________________')}</b></div>
      <div><div class="rot" style="font-size:${f(3)}">NF</div><b style="font-size:${f(6)}">${esc(e.nf || '________')}</b></div>
      <div><div class="rot" style="font-size:${f(3)}">PEDIDO</div><b style="font-size:${f(5)}">${esc(e.pedido)}</b></div>
    </div>
    <svg class="bc" data-v="${esc(codigoEtiquetaVolume(e.pedido, e.numero))}" data-h="${Math.round(t.h * 0.16)}"></svg>
  </div>`
}

// Etiqueta baixa (80 × 40, 60 × 40, 50 × 30…): uma linha por informação,
// cliente e endereço cortados em 1 linha, código de barras embaixo.
function htmlEtiquetaVolumeCompacta(e: EtiquetaVolume, t: TamanhoEtiqueta): string {
  const k = t.h / 40 // base 40 mm
  const f = (mm: number) => `${Math.max(1.8, mm * k).toFixed(2)}mm`
  const umaLinha = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
  return `<div class="et vol" style="padding:1.5mm 2mm;gap:0.5mm">
    <div class="topo" style="padding-bottom:0.4mm"><span style="font-size:${f(2.4)};${umaLinha};max-width:60%">${esc(e.remetente)}</span><b style="font-size:${f(4.6)}">VOL ${e.numero}/${e.total}</b></div>
    <div style="font-size:${f(3.3)};font-weight:700;line-height:1.1;${umaLinha}">${esc(e.cliente)}</div>
    ${e.endereco ? `<div style="font-size:${f(2.3)};line-height:1.1;${umaLinha}">${esc(e.endereco)}</div>` : ''}
    <div style="display:flex;gap:2.5mm;font-size:${f(2.6)};line-height:1.15;white-space:nowrap;overflow:hidden">
      <span>NF <b style="font-size:${f(3.4)}">${esc(e.nf || '______')}</b></span>
      <span>PED <b style="font-size:${f(3.4)}">${esc(e.pedido)}</b></span>
      <span style="overflow:hidden;text-overflow:ellipsis">${esc(e.transportadora || '')}</span>
    </div>
    <svg class="bc" data-v="${esc(codigoEtiquetaVolume(e.pedido, e.numero))}" data-h="${Math.round(t.h * 0.2)}"></svg>
  </div>`
}

// Abre a janela de impressão com uma etiqueta por página no tamanho escolhido.
export function imprimirEtiquetas(etiquetas: string[], t: TamanhoEtiqueta, titulo: string): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
@page{size:${t.w}mm ${t.h}mm;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
.et{width:${t.w}mm;height:${t.h}mm;padding:2.5mm 3mm;overflow:hidden;page-break-after:always;break-after:page;display:flex;flex-direction:column;gap:1mm}
.et:last-child{page-break-after:auto;break-after:auto}
.desc{font-weight:700;line-height:1.15;max-height:45%;overflow:hidden}
.linha{display:flex;justify-content:space-between;align-items:baseline;gap:2mm;font-size:3mm}
.bc{width:100%;margin-top:auto}
.vol .topo{display:flex;justify-content:space-between;align-items:baseline;border-bottom:0.4mm solid #000;padding-bottom:1mm}
.rot{letter-spacing:.05em;color:#000}
.grade{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:2mm;border-top:0.4mm solid #000;padding-top:1mm;margin-top:1mm}
@media screen{body{background:#ddd}.et{background:#fff;margin:6px auto;outline:1px dashed #999}}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></script>
</head><body>${etiquetas.join('')}
<script>
window.onload = function () {
  try {
    document.querySelectorAll('svg.bc').forEach(function (el) {
      JsBarcode(el, el.getAttribute('data-v'), { format: 'CODE128', displayValue: true, height: Number(el.getAttribute('data-h')) * 3.78, margin: 0, fontSize: 12 })
    })
  } catch (e) { /* sem código de barras: imprime o resto */ }
  setTimeout(function () { window.print() }, 300)
}
</script></body></html>`)
  w.document.close()
  return true
}
