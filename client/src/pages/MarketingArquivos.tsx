import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Folder, FolderPlus, Upload, Download, Trash2, ChevronRight, Home,
  FileImage, FileVideo, FileText, File as FileIcon, Users, Pencil, Eye, EyeOff, Lock,
} from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { formatDateTime } from '../lib/utils'

function formatarTamanho(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function IconeArquivo({ tipo }: { tipo: string | null | undefined }) {
  if (tipo?.startsWith('image/')) return <FileImage size={22} className="text-cyan-400" />
  if (tipo?.startsWith('video/')) return <FileVideo size={22} className="text-purple-400" />
  if (tipo === 'application/pdf') return <FileText size={22} className="text-red-400" />
  return <FileIcon size={22} className="text-dark-400" />
}

async function uploadArquivoMarketing(file: File): Promise<{ path: string; nome: string; tipo: string; tamanho: number }> {
  const token = localStorage.getItem('odin_token')
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/upload/marketing-arquivo', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Falha ao enviar o arquivo')
  return { path: data.path, nome: data.nome, tipo: data.tipo, tamanho: data.tamanho }
}

// Modal de visualização — usada pra arquivo "somente visualização": busca o
// conteúdo pela rota autenticada (o front nunca fica sabendo o nome real em
// disco desse arquivo) e mostra sem oferecer link de download nenhum.
// Não é uma trava perfeita: quem está vendo sempre pode tirar print ou
// salvar pelo DevTools — só tira o "baixar com 1 clique".
function ModalVisualizarArquivo({ arquivo, onClose }: { arquivo: { id: number; nomeOriginal: string; tipoArquivo: string | null } | null; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!arquivo) return
    let urlCriada: string | null = null
    setBlobUrl(null)
    setErro(null)
    const token = localStorage.getItem('odin_token')
    fetch(`/marketing-arquivo/${arquivo.id}/conteudo`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error('Não foi possível carregar o arquivo')
        const blob = await res.blob()
        urlCriada = URL.createObjectURL(blob)
        setBlobUrl(urlCriada)
      })
      .catch((e) => setErro(e.message))
    return () => {
      if (urlCriada) URL.revokeObjectURL(urlCriada)
    }
  }, [arquivo?.id])

  return (
    <Modal open={!!arquivo} onClose={onClose} title={arquivo?.nomeOriginal ?? ''} size="lg">
      <div className="flex items-center justify-center min-h-[300px]" onContextMenu={(e) => e.preventDefault()}>
        {erro && <p className="text-red-400 text-sm">{erro}</p>}
        {!erro && !blobUrl && <p className="text-dark-400 text-sm">Carregando...</p>}
        {blobUrl && arquivo?.tipoArquivo?.startsWith('image/') && (
          <img src={blobUrl} alt={arquivo.nomeOriginal} className="max-h-[70vh] max-w-full rounded-lg select-none" draggable={false} />
        )}
        {blobUrl && arquivo?.tipoArquivo?.startsWith('video/') && (
          <video src={blobUrl} controls controlsList="nodownload" className="max-h-[70vh] max-w-full rounded-lg" />
        )}
        {blobUrl && arquivo?.tipoArquivo === 'application/pdf' && (
          // `#toolbar=0&navpanes=0` some com a barra do visualizador nativo
          // de PDF do navegador — sem isso, o Chrome/Edge/Firefox desenham
          // o próprio ícone de "baixar" em cima do PDF, furando a trava de
          // visualização mesmo com o blob vindo da rota autenticada (achado
          // do João, 2026-09-04: PDF continuava baixável mesmo marcado
          // como "somente visualização").
          <iframe src={`${blobUrl}#toolbar=0&navpanes=0`} title={arquivo.nomeOriginal} className="w-full h-[70vh] rounded-lg border border-dark-700" />
        )}
        {blobUrl && arquivo?.tipoArquivo && !arquivo.tipoArquivo.startsWith('image/') && !arquivo.tipoArquivo.startsWith('video/') && arquivo.tipoArquivo !== 'application/pdf' && (
          <p className="text-dark-400 text-sm">Esse tipo de arquivo não tem prévia — peça pro admin liberar o download.</p>
        )}
      </div>
    </Modal>
  )
}

export default function MarketingArquivos() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const utils = trpc.useUtils()

  const [pastaAtualId, setPastaAtualId] = useState<number | null>(null)
  const [modalNovaPasta, setModalNovaPasta] = useState(false)
  const [nomeNovaPasta, setNomeNovaPasta] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [verDownloadsDe, setVerDownloadsDe] = useState<{ id: number; nome: string } | null>(null)
  const [renomeando, setRenomeando] = useState<{ id: number; nome: string } | null>(null)
  const [somenteVisualizacaoUpload, setSomenteVisualizacaoUpload] = useState(false)
  const [visualizando, setVisualizando] = useState<{ id: number; nomeOriginal: string; tipoArquivo: string | null } | null>(null)

  const argPasta = { pastaId: pastaAtualId ?? undefined }
  const { data: pastas, isLoading: carregandoPastas } = trpc.marketing.listarPastas.useQuery(argPasta)
  const { data: arquivos, isLoading: carregandoArquivos } = trpc.marketing.listarArquivos.useQuery(argPasta)
  const { data: trilha } = trpc.marketing.caminhoPasta.useQuery({ pastaId: pastaAtualId! }, { enabled: pastaAtualId != null })

  function invalidarLista() {
    utils.marketing.listarPastas.invalidate(argPasta)
    utils.marketing.listarArquivos.invalidate(argPasta)
  }

  const criarPastaMut = trpc.marketing.criarPasta.useMutation({
    onSuccess() {
      toast.success('Pasta criada')
      setModalNovaPasta(false)
      setNomeNovaPasta('')
      invalidarLista()
    },
    onError: (e) => toast.error(e.message),
  })
  const renomearPastaMut = trpc.marketing.renomearPasta.useMutation({
    onSuccess() {
      toast.success('Pasta renomeada')
      setRenomeando(null)
      invalidarLista()
    },
    onError: (e) => toast.error(e.message),
  })
  const excluirPastaMut = trpc.marketing.excluirPasta.useMutation({
    onSuccess() {
      toast.success('Pasta excluída')
      invalidarLista()
    },
    onError: (e) => toast.error(e.message),
  })
  const registrarArquivoMut = trpc.marketing.registrarArquivo.useMutation()
  const alternarVisualizacaoMut = trpc.marketing.alternarVisualizacao.useMutation({
    onSuccess() {
      invalidarLista()
    },
    onError: (e) => toast.error(e.message),
  })
  const excluirArquivoMut = trpc.marketing.excluirArquivo.useMutation({
    onSuccess() {
      toast.success('Arquivo excluído')
      invalidarLista()
    },
    onError: (e) => toast.error(e.message),
  })
  const registrarDownloadMut = trpc.marketing.registrarDownload.useMutation()
  const { data: downloadsDoArquivo } = trpc.marketing.listarDownloads.useQuery(
    { arquivoId: verDownloadsDe?.id ?? 0 },
    { enabled: !!verDownloadsDe }
  )

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivosSelecionados = Array.from(e.target.files ?? [])
    if (!arquivosSelecionados.length) return
    setEnviando(true)
    for (const file of arquivosSelecionados) {
      try {
        const up = await uploadArquivoMarketing(file)
        await registrarArquivoMut.mutateAsync({
          pastaId: pastaAtualId ?? undefined,
          nomeOriginal: up.nome,
          nomeArmazenado: up.path.replace('/uploads/', ''),
          tipoArquivo: up.tipo,
          tamanhoBytes: up.tamanho,
          somenteVisualizacao: somenteVisualizacaoUpload,
        })
      } catch (err: any) {
        toast.error(`Falha ao enviar "${file.name}": ${err.message}`)
      }
    }
    setEnviando(false)
    e.target.value = ''
    toast.success('Upload concluído')
    invalidarLista()
  }

  function baixar(arquivo: { id: number; nomeArmazenado: string | null }) {
    if (!arquivo.nomeArmazenado) return
    registrarDownloadMut.mutate({ arquivoId: arquivo.id })
    window.open(`/uploads/${arquivo.nomeArmazenado}`, '_blank')
  }

  const carregando = carregandoPastas || carregandoArquivos

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
        <h1 className="font-heading text-2xl text-dark-50 font-bold">Arquivos/Mídia</h1>
        {isAdmin && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-dark-400 cursor-pointer select-none" title="Quem não é admin só vai poder visualizar, sem botão de baixar">
              <input type="checkbox" checked={somenteVisualizacaoUpload} onChange={(e) => setSomenteVisualizacaoUpload(e.target.checked)} className="accent-gold-600" />
              Somente visualização
            </label>
            <Button size="sm" variant="secondary" onClick={() => setModalNovaPasta(true)}>
              <FolderPlus size={14} className="mr-1" /> Nova pasta
            </Button>
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gold-600 hover:bg-gold-700 text-dark-950 font-medium cursor-pointer transition-colors">
              <Upload size={14} /> {enviando ? 'Enviando...' : 'Enviar arquivo'}
              <input type="file" multiple className="hidden" onChange={handleUpload} disabled={enviando} />
            </label>
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-dark-400 mb-5 flex-wrap">
        <button onClick={() => setPastaAtualId(null)} className="flex items-center gap-1 hover:text-gold-400 transition-colors">
          <Home size={13} /> Raiz
        </button>
        {trilha?.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5">
            <ChevronRight size={13} />
            <button onClick={() => setPastaAtualId(p.id)} className="hover:text-gold-400 transition-colors">
              {p.nome}
            </button>
          </span>
        ))}
      </div>

      {carregando ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {pastas?.map((pasta) => (
            <div
              key={pasta.id}
              className="bg-dark-800 border border-dark-600 rounded-xl p-4 flex items-center gap-3 hover:border-gold-600/40 transition-colors cursor-pointer group"
              onClick={() => setPastaAtualId(pasta.id)}
            >
              <Folder size={26} className="text-gold-400 shrink-0" />
              <span className="text-sm text-dark-100 font-medium truncate flex-1">{pasta.nome}</span>
              {isAdmin && (
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => setRenomeando({ id: pasta.id, nome: pasta.nome })} className="text-dark-400 hover:text-gold-400">
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Excluir a pasta "${pasta.nome}"? Isso apaga também tudo que estiver dentro dela.`)) excluirPastaMut.mutate({ id: pasta.id })
                    }}
                    className="text-dark-400 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}

          {arquivos?.map((arquivo) => (
            <div key={arquivo.id} className="bg-dark-800 border border-dark-600 rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <IconeArquivo tipo={arquivo.tipoArquivo} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-dark-100 font-medium truncate" title={arquivo.nomeOriginal}>{arquivo.nomeOriginal}</p>
                  <p className="text-xs text-dark-500">{formatarTamanho(arquivo.tamanhoBytes)}</p>
                </div>
              </div>
              <p className="text-xs text-dark-500">
                Enviado por {arquivo.enviadoPorUser?.name ?? '—'} · {formatDateTime(arquivo.createdAt)}
              </p>
              {arquivo.somenteVisualizacao && (
                <span className="flex items-center gap-1 text-[11px] text-amber-400 w-fit">
                  <Lock size={11} /> Somente visualização
                </span>
              )}
              <div className="flex items-center justify-between gap-2 mt-1">
                {arquivo.somenteVisualizacao && !isAdmin ? (
                  <button
                    onClick={() => setVisualizando({ id: arquivo.id, nomeOriginal: arquivo.nomeOriginal, tipoArquivo: arquivo.tipoArquivo })}
                    className="flex items-center gap-1 text-xs font-semibold text-gold-400 hover:text-gold-300"
                  >
                    <Eye size={13} /> Visualizar
                  </button>
                ) : (
                  <button onClick={() => baixar(arquivo)} className="flex items-center gap-1 text-xs font-semibold text-gold-400 hover:text-gold-300">
                    <Download size={13} /> Baixar
                  </button>
                )}
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <button
                      onClick={() => alternarVisualizacaoMut.mutate({ id: arquivo.id, somenteVisualizacao: !arquivo.somenteVisualizacao })}
                      className="text-dark-400 hover:text-amber-400"
                      title={arquivo.somenteVisualizacao ? 'Liberar download' : 'Bloquear download (somente visualização)'}
                    >
                      {arquivo.somenteVisualizacao ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => setVerDownloadsDe({ id: arquivo.id, nome: arquivo.nomeOriginal })}
                      className="flex items-center gap-1 text-xs text-dark-400 hover:text-dark-200"
                      title="Ver quem baixou"
                    >
                      <Users size={13} /> {arquivo.totalDownloads}
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => {
                        if (confirm(`Excluir o arquivo "${arquivo.nomeOriginal}"?`)) excluirArquivoMut.mutate({ id: arquivo.id })
                      }}
                      className="text-dark-400 hover:text-red-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {pastas?.length === 0 && arquivos?.length === 0 && (
            <p className="text-dark-500 text-sm col-span-full py-8 text-center">
              {isAdmin ? 'Nada aqui ainda — crie uma pasta ou envie um arquivo.' : 'Nada aqui ainda.'}
            </p>
          )}
        </div>
      )}

      <Modal open={modalNovaPasta} onClose={() => setModalNovaPasta(false)} title="Nova pasta" size="sm">
        <div className="space-y-4">
          <Input label="Nome da pasta" value={nomeNovaPasta} onChange={(e) => setNomeNovaPasta(e.target.value)} autoFocus />
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setModalNovaPasta(false)}>Cancelar</Button>
            <Button
              className="flex-1"
              loading={criarPastaMut.isPending}
              disabled={!nomeNovaPasta.trim()}
              onClick={() => criarPastaMut.mutate({ nome: nomeNovaPasta.trim(), pastaPaiId: pastaAtualId ?? undefined })}
            >
              Criar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!renomeando} onClose={() => setRenomeando(null)} title="Renomear pasta" size="sm">
        {renomeando && (
          <div className="space-y-4">
            <Input label="Nome da pasta" value={renomeando.nome} onChange={(e) => setRenomeando({ ...renomeando, nome: e.target.value })} autoFocus />
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setRenomeando(null)}>Cancelar</Button>
              <Button
                className="flex-1"
                loading={renomearPastaMut.isPending}
                disabled={!renomeando.nome.trim()}
                onClick={() => renomearPastaMut.mutate({ id: renomeando.id, nome: renomeando.nome.trim() })}
              >
                Salvar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!verDownloadsDe} onClose={() => setVerDownloadsDe(null)} title={`Quem baixou "${verDownloadsDe?.nome ?? ''}"`} size="sm">
        <div className="space-y-2">
          {downloadsDoArquivo?.length ? (
            downloadsDoArquivo.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-sm border-b border-dark-700 pb-2">
                <span className="text-dark-100">{d.user?.name ?? 'Usuário removido'}</span>
                <span className="text-dark-500 text-xs">{formatDateTime(d.baixadoEm)}</span>
              </div>
            ))
          ) : (
            <p className="text-dark-500 text-sm">Ninguém baixou esse arquivo ainda.</p>
          )}
        </div>
      </Modal>

      <ModalVisualizarArquivo arquivo={visualizando} onClose={() => setVisualizando(null)} />
    </div>
  )
}
