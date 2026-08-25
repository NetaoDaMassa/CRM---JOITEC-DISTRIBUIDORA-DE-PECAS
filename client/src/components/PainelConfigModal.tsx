import { useEffect, useState } from 'react'
import Modal from './ui/Modal'
import { Input } from './ui/Input'
import Button from './ui/Button'

interface PainelConfigModalProps {
  open: boolean
  onClose: () => void
  segundosAtual: number
  autoplayAtual: boolean
  salvando: boolean
  onSalvar: (valores: { segundos: number; autoplay: boolean }) => void
}

// Modal de config compartilhado entre Painel de TV e Painel Financeiro —
// pausar/retomar o carrossel automático e ajustar quantos segundos cada
// slide fica na tela, direto pela própria tela do painel (pedido do João
// pra não precisar mexer em código nem ir em Configurações).
export default function PainelConfigModal({ open, onClose, segundosAtual, autoplayAtual, salvando, onSalvar }: PainelConfigModalProps) {
  const [segundos, setSegundos] = useState(String(segundosAtual))
  const [autoplay, setAutoplay] = useState(autoplayAtual)

  useEffect(() => {
    if (open) {
      setSegundos(String(segundosAtual))
      setAutoplay(autoplayAtual)
    }
  }, [open, segundosAtual, autoplayAtual])

  return (
    <Modal open={open} onClose={onClose} title="Configurar carrossel" size="sm">
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-dark-200 cursor-pointer">
          <input
            type="checkbox"
            className="accent-gold-500 w-4 h-4"
            checked={autoplay}
            onChange={(e) => setAutoplay(e.target.checked)}
          />
          Rotação automática ligada
        </label>
        <Input
          label="Segundos por slide"
          type="number"
          min={3}
          max={300}
          value={segundos}
          onChange={(e) => setSegundos(e.target.value)}
          disabled={!autoplay}
        />
        {!autoplay && <p className="text-xs text-dark-500">Com a rotação desligada, a tela fica parada — troque de slide pelos pontinhos.</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={salvando}
            onClick={() => onSalvar({ segundos: Math.min(300, Math.max(3, Number(segundos) || 3)), autoplay })}
          >
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
