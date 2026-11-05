import { useEffect, useState } from 'react'

// Player da gravação: o áudio passa pelo CRM (/pabx-gravacao/:id, com login),
// porque o link da PABXONE360 tem o token da gravação e certificado que o
// navegador recusa. Só baixa quando a pessoa clica em ouvir.
export default function GravacaoLigacao({ ligacaoId, partes }: { ligacaoId: number; partes: number }) {
  const [urls, setUrls] = useState<string[] | null>(null)
  const [ext, setExt] = useState('mp3')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => () => urls?.forEach((u) => URL.revokeObjectURL(u)), [urls])
  const ouvir = async () => {
    setCarregando(true)
    setErro(null)
    try {
      const token = localStorage.getItem('odin_token')
      const empresa = localStorage.getItem('empresa_ativa_id')
      const lista: string[] = []
      for (let i = 0; i < Math.max(1, partes); i++) {
        const r = await fetch(`/pabx-gravacao/${ligacaoId}${i ? `?parte=${i}` : ''}`, {
          headers: { Authorization: `Bearer ${token}`, ...(empresa ? { 'x-empresa-id': empresa } : {}) },
        })
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `erro ${r.status}`)
        const audio = await r.blob()
        if (!audio.type.startsWith('audio')) throw new Error('O servidor não devolveu o áudio — avise o suporte do CRM')
        setExt(audio.type.includes('wav') ? 'wav' : audio.type.includes('ogg') ? 'ogg' : 'mp3')
        lista.push(URL.createObjectURL(audio))
      }
      setUrls(lista)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }
  if (urls)
    return (
      <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
        {urls.map((u, i) => (
          <div key={u} className="flex items-center gap-2">
            {urls.length > 1 && <span className="text-xs text-dark-400">Parte {i + 1}</span>}
            <audio controls autoPlay={i === 0} src={u} className="h-9 w-full max-w-md" />
            <a href={u} download={`ligacao-${ligacaoId}${urls.length > 1 ? `-${i + 1}` : ''}.${ext}`} className="text-xs text-gold-400 hover:underline whitespace-nowrap">
              baixar
            </a>
          </div>
        ))}
      </div>
    )
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={ouvir} disabled={carregando} className="text-gold-400 hover:underline disabled:opacity-60">
        {carregando ? 'Carregando gravação…' : '▶ Ouvir gravação'}
      </button>
      {erro && <p className="text-xs text-red-300 mt-1">{erro}</p>}
    </div>
  )
}
