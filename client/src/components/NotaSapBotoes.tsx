import { useState } from 'react'
import toast from 'react-hot-toast'
import { FileDown, FileText } from 'lucide-react'

// DANFE (PDF) e XML de uma NF do SAP — o CRM busca na hora o anexo que o
// TaxPlus põe na nota (com login). `endereco`: /expedicao-nota/:id (pedido da
// Expedição) ou /venda-nota/:id (venda do card do cliente).
// Notas emitidas antes de 09/11/2026 não têm anexo: o servidor avisa.
export default function NotaSapBotoes({ endereco, compacto = false }: { endereco: string; compacto?: boolean }) {
  const [carregando, setCarregando] = useState<'pdf' | 'xml' | null>(null)
  const baixar = async (formato: 'pdf' | 'xml') => {
    // Abre a aba já no clique (o navegador bloqueia janela aberta depois do await).
    const aba = formato === 'pdf' ? window.open('', '_blank') : null
    setCarregando(formato)
    try {
      const token = localStorage.getItem('odin_token')
      const empresa = localStorage.getItem('empresa_ativa_id')
      const r = await fetch(`${endereco}?formato=${formato}`, {
        headers: { Authorization: `Bearer ${token}`, ...(empresa ? { 'x-empresa-id': empresa } : {}) },
      })
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `erro ${r.status}`)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const nome = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `nota.${formato}`
      if (aba) {
        aba.location.href = url
      } else {
        const a = document.createElement('a')
        a.href = url
        a.download = nome
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      aba?.close()
      toast.error((e as Error).message)
    } finally {
      setCarregando(null)
    }
  }
  const classe = `inline-flex items-center gap-1.5 rounded-lg border border-dark-600 bg-dark-800 font-semibold text-dark-100 hover:bg-dark-700 disabled:opacity-50 ${
    compacto ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1.5 text-xs'
  }`
  return (
    <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={classe} disabled={!!carregando} onClick={() => baixar('pdf')}>
        <FileText className="h-3.5 w-3.5" /> {carregando === 'pdf' ? 'Buscando no SAP…' : 'DANFE (PDF)'}
      </button>
      <button type="button" className={classe} disabled={!!carregando} onClick={() => baixar('xml')}>
        <FileDown className="h-3.5 w-3.5" /> {carregando === 'xml' ? 'Buscando no SAP…' : 'XML'}
      </button>
    </div>
  )
}
