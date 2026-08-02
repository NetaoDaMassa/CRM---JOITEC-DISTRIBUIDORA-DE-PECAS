const PARTICULAS = ['🎉', '✨', '🎊', '⭐']
const POSICOES = [
  { left: '-10%', top: '-12%' },
  { left: '72%', top: '-10%' },
  { left: '-12%', top: '78%' },
  { left: '78%', top: '80%' },
]

interface AvatarMetaProps {
  nome: string
  fotoUrl?: string | null
  /** Bateu a meta do mês — anel dourado de destaque. */
  destaque?: boolean
  /** Bateu a meta do dia — halo verde pulsante + confete ao redor da foto. */
  festa?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export default function AvatarMeta({ nome, fotoUrl, destaque, festa, size = 'md' }: AvatarMetaProps) {
  const dimensao = size === 'sm' ? 'w-9 h-9 text-sm' : size === 'lg' ? 'w-14 h-14 text-xl' : 'w-12 h-12 text-lg'

  return (
    <div className="relative shrink-0">
      <div
        className={`${dimensao} rounded-full flex items-center justify-center font-bold overflow-hidden transition-shadow ${
          destaque ? 'ring-4 ring-gold-400 bg-gold-700/40 text-gold-300' : 'bg-dark-700 text-dark-300'
        } ${festa ? 'festa-ring' : ''}`}
      >
        {fotoUrl ? <img src={fotoUrl} alt={nome} className="w-full h-full object-cover" /> : nome.charAt(0).toUpperCase()}
      </div>
      {festa && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {PARTICULAS.map((particula, i) => (
            <span
              key={particula}
              className="festa-particula absolute text-xs leading-none"
              style={{ ...POSICOES[i], animationDelay: `${i * 0.25}s` }}
            >
              {particula}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
