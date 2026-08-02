import { useState } from 'react'
import toast from 'react-hot-toast'
import Button from '../../components/ui/Button'

interface ImportRowError {
  linha: number
  motivo: string
}

interface ImportFileResult {
  arquivo: string
  sucesso: number
  erros: ImportRowError[]
}

export default function AdminImportar() {
  const [files, setFiles] = useState<FileList | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [resultados, setResultados] = useState<ImportFileResult[] | null>(null)

  async function handleImportar() {
    if (!files || files.length === 0) return toast.error('Selecione ao menos um arquivo.')

    setEnviando(true)
    setResultados(null)
    try {
      const token = localStorage.getItem('odin_token')
      const form = new FormData()
      for (const file of Array.from(files)) form.append('files', file)

      const res = await fetch('/upload/clientes-csv', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      const data = await res.json()
      if (!res.ok) return toast.error(data.error ?? 'Falha na importação.')

      setResultados(data.resultados)
      const totalSucesso = data.resultados.reduce((acc: number, r: ImportFileResult) => acc + r.sucesso, 0)
      toast.success(`${totalSucesso} cliente(s) importado(s) com sucesso.`)
    } catch {
      toast.error('Falha ao enviar os arquivos.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-4">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Importar clientes</h1>
        <p className="text-dark-400 text-sm mt-1">
          Envie um ou mais arquivos Excel/CSV de carteira. Cada linha precisa ter "Código" (identificador único),
          "Nome do Cliente" e "Estado". O CNPJ é opcional. Se a coluna "Vendedor" tiver um nome que bate com um
          vendedor cadastrado, o cliente já é atribuído a ele automaticamente.
        </p>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          onChange={(e) => setFiles(e.target.files)}
          className="text-sm text-dark-300"
        />
        <Button onClick={handleImportar} loading={enviando}>
          Importar
        </Button>
      </div>

      {resultados && (
        <div className="space-y-3">
          {resultados.map((r) => (
            <div key={r.arquivo} className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
              <p className="text-sm font-medium text-dark-100">
                {r.arquivo} — <span className="text-green-400">{r.sucesso} importado(s)</span>
                {r.erros.length > 0 && <span className="text-red-400"> · {r.erros.length} erro(s)</span>}
              </p>
              {r.erros.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-dark-400">
                  {r.erros.map((e, i) => (
                    <li key={i}>
                      Linha {e.linha}: {e.motivo}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
