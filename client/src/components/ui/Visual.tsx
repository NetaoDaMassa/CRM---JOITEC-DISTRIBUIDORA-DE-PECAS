import type { ReactNode } from 'react'

// Peças visuais compartilhadas do "design novo" (teste, 2026-10-22): anel de
// progresso, esqueleto de carregamento, avatar colorido, saudação e confete.

// Cor estável por nome — o mesmo cliente/vendedor sempre ganha a mesma cor
// no avatar, o que ajuda a reconhecer de relance no Kanban.
const CORES_AVATAR = ['#3987e5', '#0ea5a4', '#8b5cf6', '#e5534b', '#e8a33a', '#22a861', '#d6409f', '#5b6cf0', '#c2691a', '#2f9fd8']

export function corDoNome(nome: string): string {
  let h = 0
  for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return CORES_AVATAR[h % CORES_AVATAR.length]
}

export function iniciaisDe(nome: string): string {
  const partes = nome
    .replace(/^[\d./-]+\s*/, '')
    .split(/\s+/)
    .filter((p) => p.length > 1 && !/^(ltda|me|eireli|epp|s\/a|sa|da|de|do|dos|das|e)$/i.test(p))
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || '?'
}

export function AvatarIniciais({ nome, tamanho = 28 }: { nome: string; tamanho?: number }) {
  const cor = corDoNome(nome)
  return (
    <div
      className="rounded-full font-bold flex items-center justify-center shrink-0 select-none"
      style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.38, background: `${cor}26`, color: cor, boxShadow: `inset 0 0 0 1px ${cor}55` }}
      aria-hidden
    >
      {iniciaisDe(nome)}
    </div>
  )
}

export function saudacao(): string {
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }))
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

export function primeiroNome(nome: string | undefined | null): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? ''
}

// Anel de progresso (meta do mês). `marcador` = onde deveria estar hoje.
export function AnelProgresso({
  percentual,
  marcador,
  tamanho = 148,
  espessura = 12,
  cor,
  children,
}: {
  percentual: number
  marcador?: number
  tamanho?: number
  espessura?: number
  cor: string
  children?: ReactNode
}) {
  const r = (tamanho - espessura) / 2
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, percentual))
  const angMarcador = marcador != null ? (Math.max(0, Math.min(100, marcador)) / 100) * 360 - 90 : null
  return (
    <div className="relative shrink-0" style={{ width: tamanho, height: tamanho }}>
      <svg width={tamanho} height={tamanho} className="-rotate-90">
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke="var(--color-dark-700)" strokeWidth={espessura} />
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={r}
          fill="none"
          stroke={cor}
          strokeWidth={espessura}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p / 100)}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      {angMarcador != null && (
        <div
          className="absolute left-1/2 top-1/2 h-0.5 bg-dark-50 rounded-full"
          style={{ width: espessura + 6, transformOrigin: '0 50%', transform: `rotate(${angMarcador}deg) translateX(${r - espessura / 2 - 3}px)` }}
          title={`Ideal pra hoje: ${marcador}%`}
        />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}

// Bloco cinza piscando no formato do conteúdo, no lugar da tela em branco.
export function Esqueleto({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-dark-700/70 ${className}`} />
}

export function EsqueletoCards({ quantidade = 4, className = 'h-24' }: { quantidade?: number; className?: string }) {
  return (
    <>
      {Array.from({ length: quantidade }, (_, i) => (
        <Esqueleto key={i} className={`rounded-2xl ${className}`} />
      ))}
    </>
  )
}

// Confete discreto (sem biblioteca): ~70 papeizinhos caindo do topo por
// ~2,5s. Chamado quando um card vai pra Fechado/Ganho.
export function dispararConfete() {
  if (typeof document === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const cores = ['#24aff4', '#22a861', '#e8c440', '#e5534b', '#8b5cf6', '#ffffff']
  const camada = document.createElement('div')
  camada.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden'
  for (let i = 0; i < 70; i++) {
    const peca = document.createElement('i')
    const tam = 6 + Math.random() * 6
    const x = Math.random() * 100
    const dur = 1600 + Math.random() * 1200
    peca.style.cssText = `position:absolute;top:-16px;left:${x}vw;width:${tam}px;height:${tam * 0.45}px;background:${cores[i % cores.length]};border-radius:2px;opacity:.95`
    camada.appendChild(peca)
    peca.animate(
      [
        { transform: `translate(0,0) rotate(0deg)` },
        { transform: `translate(${(Math.random() - 0.5) * 240}px, ${window.innerHeight + 40}px) rotate(${(Math.random() - 0.5) * 900}deg)` },
      ],
      { duration: dur, delay: Math.random() * 300, easing: 'cubic-bezier(.25,.6,.4,1)', fill: 'forwards' }
    )
  }
  document.body.appendChild(camada)
  setTimeout(() => camada.remove(), 3200)
}
