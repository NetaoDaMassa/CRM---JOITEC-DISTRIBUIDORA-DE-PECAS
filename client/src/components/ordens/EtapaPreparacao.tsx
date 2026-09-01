import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import { Badge } from '../ui/Badge'
import { formatarDataHora, type OrderType } from '../../lib/ordensShared'

// Mesma regra de server/src/router/ordens/preparacao.ts (categoriasObrigatorias)
// — duplicada aqui só pra desenhar o checklist, a validação real é sempre no
// backend (aprovarPreparacao rejeita se faltar foto).
function categoriasObrigatorias(modelo: string): string[] {
  const prefixo = modelo.trim().toUpperCase()
  if (prefixo.startsWith('OD')) return ['placa_vaso_pressao', 'placa_compressor', 'vaso_pressao', 'valvula_seguranca']
  if (prefixo.startsWith('SEC') || prefixo.startsWith('SEP')) return ['placa']
  return []
}
const CATEGORIA_LABEL: Record<string, string> = {
  placa_vaso_pressao: 'Placa do Vaso de Pressão',
  placa_compressor: 'Placa do Compressor',
  vaso_pressao: 'Vaso de Pressão',
  valvula_seguranca: 'Válvula de Segurança',
  placa: 'Placa',
}

async function enviarArquivo(file: File, ordemId: number, stage: string, fileCategory: string, registrar: (v: any) => void) {
  const formData = new FormData()
  formData.append('file', file)
  const token = localStorage.getItem('odin_token')
  const resp = await fetch('/upload/ordem-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
  const json = await resp.json()
  if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
  registrar({ ordemId, stage, fileCategory, nomeOriginal: json.nome, nomeArmazenado: json.path.replace('/uploads/', ''), tipoArquivo: json.tipo, tamanhoBytes: json.tamanho })
}

export default function EtapaPreparacao({ ordemId, isAdmin, readonly, orderType, atualizadoEm }: { ordemId: number; isAdmin: boolean; readonly: boolean; orderType: OrderType; atualizadoEm?: string }) {
  const utils = trpc.useUtils()
  const { data: prep } = trpc.ordens.preparacao.obterPreparacao.useQuery({ ordemId })
  const { data: maquinas } = trpc.ordens.preparacao.listarMaquinas.useQuery({ ordemId })
  const { data: anexos } = trpc.ordens.anexos.listar.useQuery({ ordemId, stage: 'preparacao' })
  const [modelo, setModelo] = useState('')
  const [serie, setSerie] = useState('')
  const [obs, setObs] = useState('')
  const [enviandoId, setEnviandoId] = useState<string | null>(null)
  const prepAny = prep as { observacoes?: string | null; obsTravadaEm?: string | null; operadorFinalizou?: boolean; operadorFinalizouEm?: string | null } | null | undefined
  const travada = !!prepAny?.obsTravadaEm
  const podeEditar = isAdmin && !readonly
  const isPeca = orderType === 'peca'

  function invalidar() {
    utils.ordens.preparacao.obterPreparacao.invalidate({ ordemId })
    utils.ordens.preparacao.listarMaquinas.invalidate({ ordemId })
    utils.ordens.anexos.listar.invalidate({ ordemId, stage: 'preparacao' })
    utils.ordens.core.obterPorId.invalidate({ id: ordemId })
  }
  const criarMaquinaMut = trpc.ordens.preparacao.criarMaquina.useMutation({ onSuccess: () => { toast.success('Máquina adicionada'); invalidar(); setModelo(''); setSerie('') }, onError: (e) => toast.error(e.message) })
  const excluirMaquinaMut = trpc.ordens.preparacao.excluirMaquina.useMutation({ onSuccess: () => { toast.success('Removida'); invalidar() }, onError: (e) => toast.error(e.message) })
  const aprovarMut = trpc.ordens.preparacao.aprovarPreparacao.useMutation({ onSuccess: () => { toast.success('Preparação aprovada'); invalidar() }, onError: (e) => toast.error(e.message) })
  const salvarObsMut = trpc.ordens.preparacao.atualizarPreparacao.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const finalizarMut = trpc.ordens.preparacao.finalizarPreparacao.useMutation({ onSuccess: () => { toast.success('Atualizado'); invalidar() }, onError: (e) => toast.error(e.message) })
  const registrarMut = trpc.ordens.anexos.registrar.useMutation({ onSuccess: () => invalidar(), onError: (e) => toast.error(e.message) })

  const diasParado = atualizadoEm ? Math.floor((Date.now() - new Date(atualizadoEm.replace(' ', 'T') + 'Z').getTime()) / 86400000) : 0

  function fotosDe(maquinaId: number, categoria: string) {
    return (anexos ?? []).filter((a) => a.fileCategory === `${categoria}__${maquinaId}`)
  }

  async function handleUploadCategoria(e: React.ChangeEvent<HTMLInputElement>, maquinaId: number, categoria: string) {
    const file = e.target.files?.[0]
    if (!file) return
    const chave = `${maquinaId}-${categoria}`
    setEnviandoId(chave)
    try {
      await enviarArquivo(file, ordemId, 'preparacao', `${categoria}__${maquinaId}`, registrarMut.mutate)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setEnviandoId(null)
      e.target.value = ''
    }
  }
  async function handleUploadGeral(e: React.ChangeEvent<HTMLInputElement>, categoria: 'foto_extra' | 'video') {
    const file = e.target.files?.[0]
    if (!file) return
    setEnviandoId(categoria)
    try {
      await enviarArquivo(file, ordemId, 'preparacao', categoria, registrarMut.mutate)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setEnviandoId(null)
      e.target.value = ''
    }
  }

  const listaMaquinas = maquinas ?? []
  const todasCompletas = listaMaquinas.length > 0 && listaMaquinas.every((m) => categoriasObrigatorias(m.modelo).every((cat) => fotosDe(m.id, cat).length > 0))

  return (
    <div className="space-y-5">
      {diasParado > 3 && !prepAny?.operadorFinalizou && (
        <p className="text-xs text-yellow-500">⚠️ Pedido parado nesta etapa há {diasParado} dias</p>
      )}

      <div>
        <Input
          label={`Observações da preparação${travada ? ` 🔒 travada em ${formatarDataHora(prepAny?.obsTravadaEm)}` : ''}`}
          value={travada ? (prepAny?.observacoes ?? '') : obs}
          defaultValue={travada ? undefined : (prepAny?.observacoes ?? '')}
          onChange={(e) => setObs(e.target.value)}
          disabled={!podeEditar || travada}
        />
        {podeEditar && (
          travada ? (
            <button onClick={() => salvarObsMut.mutate({ ordemId, travar: false })} className="mt-1.5 text-xs font-semibold text-gold-400 hover:text-gold-300">Editar observação</button>
          ) : (
            <Button size="sm" variant="secondary" className="mt-1.5" loading={salvarObsMut.isPending} onClick={() => salvarObsMut.mutate({ ordemId, observacoes: obs || (prepAny?.observacoes ?? ''), travar: true })}>Salvar observação</Button>
          )
        )}
      </div>

      {prepAny?.operadorFinalizou ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-green-700/40 bg-green-900/10 px-3 py-2.5 text-sm">
          <span className="text-green-400 font-medium">✅ Preparação finalizada{prepAny.operadorFinalizouEm ? ` em ${formatarDataHora(prepAny.operadorFinalizouEm)}` : ''}</span>
          {!readonly && <button onClick={() => finalizarMut.mutate({ ordemId, finalizado: false })} className="text-xs font-semibold text-green-400 underline hover:no-underline">desfazer</button>}
        </div>
      ) : (
        !readonly && <Button size="sm" variant="secondary" loading={finalizarMut.isPending} onClick={() => finalizarMut.mutate({ ordemId, finalizado: true })}>🏁 Finalizar preparação</Button>
      )}

      {!isPeca && (
        <div>
          <h3 className="text-sm font-semibold text-dark-200 mb-2">Máquinas do pedido</h3>
          <div className="space-y-3">
            {listaMaquinas.map((m) => {
              const categorias = categoriasObrigatorias(m.modelo)
              return (
                <div key={m.id} className="p-3 rounded-lg border border-dark-600 bg-dark-800 text-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-dark-100">{m.modelo} <span className="text-dark-500">{m.numeroSerie ?? 's/ nº série'}</span></span>
                    {podeEditar && <button onClick={() => excluirMaquinaMut.mutate({ id: m.id, ordemId })} className="text-red-400 text-xs hover:underline">remover</button>}
                  </div>
                  {categorias.length === 0 && <p className="text-xs text-yellow-500">Prefixo do modelo não reconhecido (esperado OD*, SEC* ou SEP*)</p>}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {categorias.map((cat) => {
                      const fotos = fotosDe(m.id, cat)
                      const chave = `${m.id}-${cat}`
                      return (
                        <div key={cat} className={`rounded-lg border p-2 text-xs ${fotos.length > 0 ? 'border-green-700/40 bg-green-900/10' : 'border-dark-600'}`}>
                          <p className="text-dark-300">{fotos.length > 0 ? '✅' : '⬜'} {CATEGORIA_LABEL[cat] ?? cat}</p>
                          {podeEditar && (
                            <label className="mt-1 inline-block text-gold-400 hover:text-gold-300 cursor-pointer">
                              {enviandoId === chave ? 'Enviando...' : 'Anexar foto'}
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadCategoria(e, m.id, cat)} disabled={enviandoId === chave} />
                            </label>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          {podeEditar && (
            <div className="flex gap-2 mt-3">
              <Input placeholder="Modelo (ex: OD-100, SEC-50)" value={modelo} onChange={(e) => setModelo(e.target.value)} />
              <Input placeholder="Nº de série" value={serie} onChange={(e) => setSerie(e.target.value)} />
              <Button size="sm" loading={criarMaquinaMut.isPending} onClick={() => criarMaquinaMut.mutate({ ordemId, modelo, numeroSerie: serie || undefined })}>Adicionar</Button>
            </div>
          )}
        </div>
      )}

      {podeEditar && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-dark-400 mb-1 block">{isPeca ? 'Fotos da peça separada/embalada' : 'Fotos extra'}</label>
            <label className="inline-block text-xs px-3 py-1.5 rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 cursor-pointer">
              {enviandoId === 'foto_extra' ? 'Enviando...' : 'Escolher foto'}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadGeral(e, 'foto_extra')} disabled={enviandoId === 'foto_extra'} />
            </label>
          </div>
          <div>
            <label className="text-xs text-dark-400 mb-1 block">Vídeo</label>
            <label className="inline-block text-xs px-3 py-1.5 rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 cursor-pointer">
              {enviandoId === 'video' ? 'Enviando...' : 'Escolher vídeo'}
              <input type="file" accept="video/*" className="hidden" onChange={(e) => handleUploadGeral(e, 'video')} disabled={enviandoId === 'video'} />
            </label>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-dark-200 mb-2">Aprovação</h3>
        {prep?.aprovadoGestor ? (
          <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Aprovada</Badge>
        ) : podeEditar ? (
          <Button size="sm" disabled={isPeca ? false : !todasCompletas} loading={aprovarMut.isPending} onClick={() => aprovarMut.mutate({ ordemId })}>PREPARAÇÃO — OK</Button>
        ) : (
          <p className="text-dark-500 text-sm">Ainda não aprovada</p>
        )}
      </div>
    </div>
  )
}
