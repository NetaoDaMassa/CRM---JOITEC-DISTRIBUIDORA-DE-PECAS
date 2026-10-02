import { useEffect, useRef, useState } from 'react'
import { X, RotateCcw } from 'lucide-react'

// Tira foto com a câmera de verdade (celular OU webcam do notebook) direto
// dentro do chat, via getUserMedia — não é um atalho de input de arquivo
// (que só abre a câmera em alguns celulares e nunca no notebook). Pedido do
// João, 2026-10-03: "é a câmera do celular ou do notebook?" — as duas.
// `facingMode: { ideal: 'environment' }` pede a câmera traseira quando
// existe (celular); num notebook, que só tem uma câmera, o navegador
// ignora essa preferência e usa a que tem, sem dar erro.
export default function CameraCapture({ onClose, onFoto }: { onClose: () => void; onFoto: (blob: Blob) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [fotoBlob, setFotoBlob] = useState<Blob | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch(() => setErro('Não consegui acessar a câmera — verifique a permissão do navegador.'))
    return () => {
      cancelado = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function tirarFoto() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        setFotoBlob(blob)
        setFotoUrl(URL.createObjectURL(blob))
      },
      'image/jpeg',
      0.9
    )
  }

  function tirarDeNovo() {
    if (fotoUrl) URL.revokeObjectURL(fotoUrl)
    setFotoUrl(null)
    setFotoBlob(null)
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col">
      <div className="flex items-center justify-between p-3 shrink-0">
        <p className="text-sm font-medium text-white">Tirar foto</p>
        <button onClick={onClose} className="text-white/80 hover:text-white">
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center">
        {erro ? (
          <p className="text-sm text-red-400 px-6 text-center">{erro}</p>
        ) : fotoUrl ? (
          <img src={fotoUrl} alt="Foto tirada" className="max-h-full max-w-full object-contain" />
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className="max-h-full max-w-full object-contain" />
        )}
      </div>
      <div className="p-4 flex items-center justify-center gap-6 shrink-0">
        {!erro &&
          (fotoUrl ? (
            <>
              <button onClick={tirarDeNovo} className="flex items-center gap-1.5 text-sm text-white/80 hover:text-white">
                <RotateCcw size={16} /> Tirar de novo
              </button>
              <button
                onClick={() => fotoBlob && onFoto(fotoBlob)}
                className="bg-gold-600 hover:bg-gold-500 text-dark-950 font-medium rounded-full px-6 py-2.5 text-sm"
              >
                Enviar foto
              </button>
            </>
          ) : (
            <button onClick={tirarFoto} className="w-16 h-16 rounded-full bg-white border-4 border-white/30 active:scale-95 transition-transform" />
          ))}
      </div>
    </div>
  )
}
