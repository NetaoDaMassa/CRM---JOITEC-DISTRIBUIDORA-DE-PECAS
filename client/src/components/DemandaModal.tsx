import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Paperclip, Trash2, X } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input, Textarea } from './ui/Input'

// Cria uma demanda nova (demandaId null) ou abre o detalhe de uma já
// existente — mesmo modal pros dois casos, igual LeadChangeStatusModal.
// Só admin cria/edita o conteúdo (título/prazo/pessoa/etc); qualquer um
// que veja o board pode comentar e anexar arquivo (colaboração no card),
// mover de fase é feito arrastando no board, não aqui.
export default function DemandaModal({
  open,
  onClose,
  demandaId,
  empresaIdInicial,
}: {
  open: boolean
  onClose: () => void
  demandaId: number | null
  empresaIdInicial: number
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const utils = trpc.useUtils()

  const [empresaId, setEmpresaId] = useState<number>(empresaIdInicial)
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [atribuidoParaId, setAtribuidoParaId] = useState<string>('')
  const [dataLimite, setDataLimite] = useState('')
  const [lembreteEm, setLembreteEm] = useState('')
  const [mostrarPainelFinanceiro, setMostrarPainelFinanceiro] = useState(false)
  const [comentario, setComentario] = useState('')
  const [enviandoArquivo, setEnviandoArquivo] = useState(false)

  const { data: detalhe } = trpc.demandas.detalhe.useQuery({ id: demandaId! }, { enabled: !!demandaId && open })
  const { data: empresasAlvo } = trpc.demandas.empresasAlvo.useQuery(undefined, { enabled: open && isAdmin })
  const { data: usuariosEmpresa } = trpc.demandas.usuariosDaEmpresa.useQuery({ empresaId }, { enabled: open && isAdmin && !!empresaId })

  useEffect(() => {
    if (!open) return
    if (detalhe) {
      setEmpresaId(detalhe.empresaId)
      setTitulo(detalhe.titulo)
      setDescricao(detalhe.descricao ?? '')
      setAtribuidoParaId(detalhe.atribuidoParaId ? String(detalhe.atribuidoParaId) : '')
      setDataLimite(detalhe.dataLimite ?? '')
      setLembreteEm(detalhe.lembreteEm ?? '')
      setMostrarPainelFinanceiro(detalhe.mostrarPainelFinanceiro)
    } else if (!demandaId) {
      setEmpresaId(empresaIdInicial)
      setTitulo('')
      setDescricao('')
      setAtribuidoParaId('')
      setDataLimite('')
      setLembreteEm('')
      setMostrarPainelFinanceiro(false)
    }
  }, [open, detalhe, demandaId, empresaIdInicial])

  function invalidarTudo() {
    utils.demandas.listar.invalidate()
    utils.demandas.painelFinanceiro.invalidate()
    if (demandaId) utils.demandas.detalhe.invalidate({ id: demandaId })
  }

  const criarMut = trpc.demandas.criar.useMutation({
    onSuccess() {
      toast.success('Demanda criada')
      invalidarTudo()
      onClose()
    },
    onError(e) {
      toast.error(e.message)
    },
  })

  const editarMut = trpc.demandas.editar.useMutation({
    onSuccess() {
      toast.success('Demanda atualizada')
      invalidarTudo()
    },
    onError(e) {
      toast.error(e.message)
    },
  })

  const excluirMut = trpc.demandas.excluir.useMutation({
    onSuccess() {
      toast.success('Demanda excluída')
      invalidarTudo()
      onClose()
    },
    onError(e) {
      toast.error(e.message)
    },
  })

  const comentarMut = trpc.demandas.comentar.useMutation({
    onSuccess() {
      setComentario('')
      if (demandaId) utils.demandas.detalhe.invalidate({ id: demandaId })
    },
    onError(e) {
      toast.error(e.message)
    },
  })

  const anexarMut = trpc.demandas.anexar.useMutation({
    onSuccess() {
      invalidarTudo()
    },
    onError(e) {
      toast.error(e.message)
    },
  })

  const excluirAnexoMut = trpc.demandas.excluirAnexo.useMutation({
    onSuccess() {
      invalidarTudo()
    },
  })

  function handleSalvar() {
    if (!titulo.trim()) return toast.error('Dê um título pra demanda')
    if (demandaId) {
      editarMut.mutate({
        id: demandaId,
        titulo,
        descricao,
        atribuidoParaId: atribuidoParaId ? Number(atribuidoParaId) : null,
        dataLimite: dataLimite || null,
        lembreteEm: lembreteEm || null,
        mostrarPainelFinanceiro,
      })
    } else {
      criarMut.mutate({
        empresaId,
        titulo,
        descricao: descricao || undefined,
        atribuidoParaId: atribuidoParaId ? Number(atribuidoParaId) : undefined,
        dataLimite: dataLimite || undefined,
        lembreteEm: lembreteEm || undefined,
        mostrarPainelFinanceiro,
      })
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !demandaId) return
    setEnviandoArquivo(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('odin_token')
      const resp = await fetch('/upload/demanda-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
      anexarMut.mutate({ demandaId, nomeArquivo: json.nome, path: json.path, tamanho: json.tamanho })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setEnviandoArquivo(false)
      e.target.value = ''
    }
  }

  const podeEditarConteudo = isAdmin

  return (
    <Modal open={open} onClose={onClose} title={demandaId ? 'Demanda' : 'Nova demanda'} size="lg">
      <div className="space-y-4">
        {podeEditarConteudo ? (
          <>
            {!demandaId && (
              <Select
                label="Empresa"
                value={empresaId}
                onChange={(e) => {
                  setEmpresaId(Number(e.target.value))
                  setAtribuidoParaId('')
                }}
                options={(empresasAlvo ?? []).map((e) => ({ value: e.id, label: e.nome }))}
              />
            )}
            <Input label="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="O que precisa ser feito" />
            <Textarea label="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} placeholder="Detalhes (opcional)" />
            <Select
              label="Atribuir para"
              value={atribuidoParaId}
              onChange={(e) => setAtribuidoParaId(e.target.value)}
              placeholder="Sem pessoa específica (empresa toda)"
              options={(usuariosEmpresa ?? []).map((u) => ({ value: u.id, label: u.name }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Prazo" type="date" value={dataLimite} onChange={(e) => setDataLimite(e.target.value)} />
              <Input label="Lembrete" type="datetime-local" value={lembreteEm} onChange={(e) => setLembreteEm(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-dark-200 cursor-pointer">
              <input
                type="checkbox"
                checked={mostrarPainelFinanceiro}
                onChange={(e) => setMostrarPainelFinanceiro(e.target.checked)}
                className="rounded border-dark-600"
              />
              Mostrar no Painel Financeiro
            </label>

            <div className="flex items-center justify-between pt-2">
              {demandaId ? (
                <Button variant="danger" size="sm" onClick={() => excluirMut.mutate({ id: demandaId })} loading={excluirMut.isPending}>
                  <Trash2 size={14} /> Excluir
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={onClose}>
                  Cancelar
                </Button>
                <Button onClick={handleSalvar} loading={criarMut.isPending || editarMut.isPending}>
                  {demandaId ? 'Salvar' : 'Criar demanda'}
                </Button>
              </div>
            </div>
          </>
        ) : (
          detalhe && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-dark-50">{detalhe.titulo}</h3>
              {detalhe.descricao && <p className="text-sm text-dark-300 whitespace-pre-wrap">{detalhe.descricao}</p>}
              <div className="flex flex-wrap gap-4 text-xs text-dark-400 pt-1">
                <span>Empresa: {detalhe.empresa.nome}</span>
                <span>Atribuído: {detalhe.atribuidoPara?.name ?? 'Empresa toda'}</span>
                {detalhe.dataLimite && <span>Prazo: {detalhe.dataLimite.slice(0, 10).split('-').reverse().join('/')}</span>}
              </div>
            </div>
          )
        )}

        {demandaId && detalhe && (
          <div className="border-t border-dark-700 pt-4 space-y-4">
            <div>
              <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold mb-2">Anexos</p>
              <div className="space-y-1.5">
                {detalhe.anexos.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm bg-dark-800 border border-dark-600 rounded-lg px-3 py-2">
                    <a href={a.path} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-dark-200 hover:text-gold-400 truncate">
                      <Paperclip size={13} /> {a.nomeArquivo}
                    </a>
                    <button onClick={() => excluirAnexoMut.mutate({ id: a.id })} className="text-dark-500 hover:text-red-400 shrink-0">
                      <X size={13} />
                    </button>
                  </div>
                ))}
                {detalhe.anexos.length === 0 && <p className="text-xs text-dark-500">Nenhum anexo ainda.</p>}
              </div>
              <label className="inline-block mt-2 px-3 py-1.5 text-xs rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 cursor-pointer">
                {enviandoArquivo ? 'Enviando...' : 'Anexar arquivo'}
                <input type="file" className="hidden" onChange={handleUpload} disabled={enviandoArquivo} />
              </label>
            </div>

            <div>
              <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold mb-2">Comentários</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {detalhe.comentarios.map((c) => (
                  <div key={c.id} className="text-sm bg-dark-800 border border-dark-600 rounded-lg px-3 py-2">
                    <p className="text-dark-200">{c.texto}</p>
                    <p className="text-[10px] text-dark-500 mt-1">{c.user.name}</p>
                  </div>
                ))}
                {detalhe.comentarios.length === 0 && <p className="text-xs text-dark-500">Nenhum comentário ainda.</p>}
              </div>
              <div className="flex gap-2 mt-2">
                <input
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && comentario.trim()) comentarMut.mutate({ demandaId, texto: comentario.trim() })
                  }}
                  placeholder="Escrever um comentário..."
                  className="flex-1 bg-dark-800 border border-dark-600 rounded-lg px-3 py-1.5 text-sm text-dark-100 placeholder-dark-400 focus:outline-none focus:border-gold-600"
                />
                <Button
                  size="sm"
                  disabled={!comentario.trim()}
                  loading={comentarMut.isPending}
                  onClick={() => comentario.trim() && comentarMut.mutate({ demandaId, texto: comentario.trim() })}
                >
                  Enviar
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
