interface Props {
  email: string
  size?: 'sm' | 'md'
  subject?: string
  body?: string
}

function mailtoUrl(email: string, subject?: string, body?: string): string {
  const params = new URLSearchParams()
  if (subject) params.set('subject', subject)
  if (body) params.set('body', body)
  const query = params.toString()
  return `mailto:${email}${query ? `?${query}` : ''}`
}

export default function EmailButton({ email, size = 'sm', subject, body }: Props) {
  return (
    <a
      href={mailtoUrl(email, subject, body)}
      onClick={(e) => e.stopPropagation()}
      title={`Enviar email — ${email}`}
      className={`
        inline-flex items-center justify-center rounded-lg
        bg-blue-600/20 hover:bg-blue-600/40
        text-blue-400 hover:text-blue-300
        border border-blue-600/30 hover:border-blue-500/60
        transition-all shrink-0
        ${size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'}
      `}
    >
      {/* Mail SVG icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'}
      >
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
    </a>
  )
}
