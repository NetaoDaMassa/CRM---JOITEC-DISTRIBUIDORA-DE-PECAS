import type { Celebracao } from '../../lib/useCelebrarMeta'

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export default function CelebracaoPopup({ celebracao, onFechar }: { celebracao: Celebracao | null; onFechar: () => void }) {
  if (!celebracao) return null

  return (
    <div
      className="popup-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-6"
      onClick={onFechar}
    >
      <div
        className="popup-card bg-dark-800 border-4 border-gold-400 rounded-3xl px-12 py-10 md:px-20 md:py-14 text-center shadow-2xl max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-36 h-36 md:w-48 md:h-48 rounded-full overflow-hidden mx-auto ring-8 ring-gold-400 bg-dark-700 flex items-center justify-center text-6xl font-bold text-gold-300 shadow-lg">
          {celebracao.fotoUrl ? (
            <img src={celebracao.fotoUrl} alt={celebracao.nome} className="w-full h-full object-cover" />
          ) : (
            celebracao.nome.charAt(0).toUpperCase()
          )}
        </div>
        <p className="text-2xl md:text-4xl font-bold text-dark-50 mt-6">{celebracao.nome}</p>
        <p className="text-lg md:text-2xl font-semibold text-gold-400 mt-2">
          {celebracao.tipo === 'mes' ? '🏆 Bateu a meta do mês!' : '🎯 Bateu a meta do dia!'}
        </p>
        <p className="text-2xl md:text-3xl font-bold text-green-400 font-mono tabular-nums mt-4">
          {formatarMoeda(celebracao.valorFechadoMes)}
          {celebracao.metaFaturamento != null && (
            <span className="text-dark-400 text-base md:text-lg font-normal"> / {formatarMoeda(celebracao.metaFaturamento)}</span>
          )}
        </p>
        <button
          onClick={onFechar}
          className="mt-8 text-sm text-dark-400 hover:text-dark-200 underline"
        >
          Fechar
        </button>
      </div>
    </div>
  )
}
