import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ChevronRight, Download, Eye, Folder, FolderPlus, Pencil, Trash2, Undo2, Upload, Lock } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { formatDateTime } from '../../lib/utils'

// Arquivos para contabilidade (Suy, contas a pagar, 2026-11-13) — parecido
// com Arquivos/Mídia, só pro financeiro. O arquivo só abre por aqui (com
// login e permissão); excluir vai pra lixeira.

function tamanho(b: number | null) {
  if (!b) return ''
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

async function abrirArquivo(id: number, baixar: boolean, nome: string) {
  const r = await fetch(`/contabilidade-arquivo/${id}${baixar ? '?baixar=1' : ''}`, { headers: { Authorization: `Bearer ${localStorage.getItem('odin_token')}` } })
  if (!r.ok) return toast.error('Não foi possível abrir o arquivo')
  const url = URL.createObjectURL(await r.blob())
  if (baixar) {
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    a.click()
  } else window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export default function ArquivosContabilidade() {
  const utils = trpc.useUtils()
  const { data: inicio } = trpc.arquivosContabilidade.inicio.useQuery()
  const [empresaId, setEmpresaId] = useState<number | null>(null)
  const [pastaId, setPastaId] = useState<number | null>(null)
  const [novaPasta, setNovaPasta] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [verLixeira, setVerLixeira] = useState(false)
  useEffect(() => {
    if (inicio && empresaId == null) setEmpresaId(inicio.empresas[0]?.id ?? null)
  }, [inicio, empresaId])

  const { data } = trpc.arquivosContabilidade.listar.useQuery({ empresaId: empresaId ?? 0, pastaId }, { enabled: !!empresaId })
  const { data: lixeira } = trpc.arquivosContabilidade.lixeira.useQuery({ empresaId: empresaId ?? 0 }, { enabled: !!empresaId && verLixeira && !!inicio?.podeGerenciar })
  const recarregar = () => utils.arquivosContabilidade.invalidate()
  const erro = (e: { message: string }) => toast.error(e.message)
  const criarPasta = trpc.arquivosContabilidade.criarPasta.useMutation({ onSuccess: () => (setNovaPasta(''), recarregar()), onError: erro })
  const renomear = trpc.arquivosContabilidade.renomearPasta.useMutation({ onSuccess: recarregar, onError: erro })
  const excluirPasta = trpc.arquivosContabilidade.excluirPasta.useMutation({ onSuccess: recarregar, onError: erro })
  const registrar = trpc.arquivosContabilidade.registrarArquivo.useMutation({ onError: erro })
  const excluirArquivo = trpc.arquivosContabilidade.excluirArquivo.useMutation({ onSuccess: () => (toast.success('Foi para a lixeira'), recarregar()), onError: erro })
  const restaurar = trpc.arquivosContabilidade.restaurar.useMutation({ onSuccess: recarregar, onError: erro })

  const enviar = async (arquivos: FileList | null) => {
    if (!arquivos?.length || !empresaId) return
    setEnviando(true)
    try {
      for (const f of Array.from(arquivos)) {
        const form = new FormData()
        form.append('file', f)
        const r = await fetch('/upload/contabilidade-arquivo', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('odin_token')}` }, body: form })
        if (!r.ok) throw new Error(`Falha ao enviar ${f.name}`)
        const j = (await r.json()) as { nomeArmazenado: string; nome: string; tipo: string; tamanho: number }
        await registrar.mutateAsync({ empresaId, pastaId, nomeArmazenado: j.nomeArmazenado, nome: j.nome || f.name, tipo: j.tipo, tamanho: j.tamanho })
      }
      toast.success('Arquivo(s) enviado(s)')
      recarregar()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const podeGerenciar = !!inicio?.podeGerenciar

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl text-dark-50 flex items-center gap-2">
            Arquivos para contabilidade <Lock size={16} className="text-dark-400" />
          </h1>
          <p className="text-sm text-dark-400 mt-1">Só o financeiro vê. Os arquivos não abrem por link direto e o que for excluído vai para a lixeira.</p>
        </div>
        <select
          value={empresaId ?? ''}
          onChange={(e) => (setEmpresaId(Number(e.target.value)), setPastaId(null))}
          className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-sm text-dark-100"
          aria-label="Empresa"
        >
          {inicio?.empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-sm">
        <button className={pastaId ? 'text-gold-400 hover:underline' : 'text-dark-100 font-medium'} onClick={() => setPastaId(null)}>
          Início
        </button>
        {data?.trilha.map((t) => (
          <span key={t.id} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-dark-500" />
            <button className={t.id === pastaId ? 'text-dark-100 font-medium' : 'text-gold-400 hover:underline'} onClick={() => setPastaId(t.id)}>
              {t.nome}
            </button>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-gold-500 px-3 py-2 text-sm font-medium text-dark-900 hover:bg-gold-400">
          <Upload size={15} /> {enviando ? 'Enviando…' : 'Enviar arquivos'}
          <input type="file" multiple className="hidden" disabled={enviando} onChange={(e) => (enviar(e.target.files), (e.target.value = ''))} />
        </label>
        <div className="flex items-end gap-2">
          <Input placeholder="Nova pasta (ex.: 2026-11 Notas de entrada)" value={novaPasta} onChange={(e) => setNovaPasta(e.target.value)} />
          <Button variant="secondary" size="sm" disabled={!novaPasta.trim() || !empresaId} onClick={() => empresaId && criarPasta.mutate({ empresaId, pastaPaiId: pastaId, nome: novaPasta })}>
            <FolderPlus size={14} className="mr-1" /> Criar pasta
          </Button>
        </div>
        {podeGerenciar && (
          <Button variant="ghost" size="sm" onClick={() => setVerLixeira(!verLixeira)}>
            <Trash2 size={14} className="mr-1" /> {verLixeira ? 'Esconder lixeira' : 'Lixeira'}
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-dark-700 divide-y divide-dark-700">
        {data && data.pastas.length === 0 && data.arquivos.length === 0 && <p className="px-3 py-4 text-sm text-dark-400">Pasta vazia.</p>}
        {data?.pastas.map((p) => (
          <div key={`p${p.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-dark-800/60">
            <button className="flex flex-1 items-center gap-2 text-left text-sm text-dark-100" onClick={() => setPastaId(p.id)}>
              <Folder size={16} className="text-gold-400" /> {p.nome}
            </button>
            {podeGerenciar && (
              <>
                <button
                  aria-label="Renomear pasta"
                  className="text-dark-500 hover:text-dark-200"
                  onClick={() => {
                    const nome = window.prompt('Novo nome da pasta', p.nome)
                    if (nome && nome.trim()) renomear.mutate({ id: p.id, nome })
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button aria-label="Apagar pasta" className="text-dark-500 hover:text-red-400" onClick={() => excluirPasta.mutate({ id: p.id })}>
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        ))}
        {data?.arquivos.map((a) => (
          <div key={`a${a.id}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-dark-100 truncate">📄 {a.nome}</p>
              <p className="text-[11px] text-dark-500">
                {formatDateTime(a.createdAt)} · {a.enviadoPor ?? '—'} {a.tamanho ? `· ${tamanho(a.tamanho)}` : ''}
              </p>
            </div>
            <button aria-label="Ver" className="text-dark-400 hover:text-dark-100" onClick={() => abrirArquivo(a.id, false, a.nome)}>
              <Eye size={15} />
            </button>
            <button aria-label="Baixar" className="text-dark-400 hover:text-dark-100" onClick={() => abrirArquivo(a.id, true, a.nome)}>
              <Download size={15} />
            </button>
            <button aria-label="Excluir" className="text-dark-500 hover:text-red-400" onClick={() => excluirArquivo.mutate({ id: a.id })}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      {verLixeira && podeGerenciar && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-dark-200">Lixeira</h2>
          {lixeira?.length === 0 && <p className="text-sm text-dark-400">Vazia.</p>}
          {lixeira?.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 text-dark-300">
                {a.nome} <span className="text-[11px] text-dark-500">({a.pasta ?? 'Início'} · excluído {a.excluidoEm ? formatDateTime(a.excluidoEm) : ''} por {a.excluidoPor ?? '—'})</span>
              </span>
              <button className="text-xs text-gold-400 hover:underline inline-flex items-center gap-1" onClick={() => restaurar.mutate({ id: a.id })}>
                <Undo2 size={12} /> restaurar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
