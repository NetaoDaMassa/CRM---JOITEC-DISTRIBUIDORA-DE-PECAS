import { useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle2, AlertTriangle, Boxes, PackageCheck, MessageSquareWarning, Lock, Pencil } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import Select from '../ui/Select'
import { formatDateTime } from '../../lib/utils'

// Portado de odin-crm.duckdns.org (ConferenceStage.tsx) pra ficar igual —
// pedido do João, 2026-09-01. Mesma lista fixa de quem embala (não é um
// campo livre nem lista de usuários do sistema).
const EMBALADORES = ['RAFAEL', 'MARCUS', 'EDUARDO']
const ITEM_CHECKLIST: { campo: 'placaOk' | 'adesivoOk' | 'fichaTecnicaOk' | 'voltagemOk' | 'kitOk'; label: string }[] = [
  { campo: 'placaOk', label: 'Placa' },
  { campo: 'adesivoOk', label: 'Adesivo' },
  { campo: 'fichaTecnicaOk', label: 'Ficha Técnica' },
  { campo: 'voltagemOk', label: 'Voltagem' },
  { campo: 'kitOk', label: 'Kit' },
]

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors text-xs ${
        checked ? 'border-green-700/50 bg-green-900/10 text-green-300' : 'border-dark-600 text-dark-300'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      {label}
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-green-600" />
    </label>
  )
}

export default function EtapaConferencia({ ordemId, isAdmin, readonly }: { ordemId: number; isAdmin: boolean; readonly: boolean }) {
  const utils = trpc.useUtils()
  const { data: conf } = trpc.ordens.conferencia.obter.useQuery({ ordemId })
  const { data: itens } = trpc.ordens.conferencia.listarItens.useQuery({ ordemId })
  const { data: anexos } = trpc.ordens.anexos.listar.useQuery({ ordemId, stage: 'conferencia' })
  const [enviandoId, setEnviandoId] = useState<number | null>(null)
  // Uma vez confirmada, TUDO trava (checklist, "não aplicável", embalagem,
  // desfazer) — igual ao sistema antigo (readonly || isConfirmed em cada
  // controle). Antes só as observações travavam sozinhas, o resto continuava
  // editável mesmo com a conferência já confirmada (achado do João,
  // 2026-09-01 — "tá muito distante do que é de fato").
  const jaConfirmada = !!(conf as { confirmado?: boolean } | null | undefined)?.confirmado
  const podeEditar = isAdmin && !readonly && !jaConfirmada

  function invalidar() {
    utils.ordens.conferencia.obter.invalidate({ ordemId })
    utils.ordens.conferencia.listarItens.invalidate({ ordemId })
    utils.ordens.anexos.listar.invalidate({ ordemId, stage: 'conferencia' })
  }
  const atualizarMut = trpc.ordens.conferencia.atualizar.useMutation({ onSuccess: () => invalidar(), onError: (e) => toast.error(e.message) })
  const salvarObsMut = trpc.ordens.conferencia.atualizar.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const itemMut = trpc.ordens.conferencia.atualizarItem.useMutation({ onSuccess: () => invalidar(), onError: (e) => toast.error(e.message) })
  const confirmarMut = trpc.ordens.conferencia.confirmar.useMutation({ onSuccess: () => { toast.success('Conferência confirmada! ✅'); invalidar() }, onError: (e) => toast.error(e.message) })
  const registrarMut = trpc.ordens.anexos.registrar.useMutation({ onSuccess: () => invalidar(), onError: (e) => toast.error(e.message) })

  function fotosAvariaDe(maquinaId: number) {
    return (anexos ?? []).filter((a) => a.fileCategory === `avaria__${maquinaId}`)
  }
  async function handleUploadAvaria(e: React.ChangeEvent<HTMLInputElement>, maquinaId: number) {
    const file = e.target.files?.[0]
    if (!file) return
    setEnviandoId(maquinaId)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('odin_token')
      const resp = await fetch('/upload/ordem-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
      registrarMut.mutate({ ordemId, stage: 'conferencia', fileCategory: `avaria__${maquinaId}`, nomeOriginal: json.nome, nomeArmazenado: json.path.replace('/uploads/', ''), tipoArquivo: json.tipo, tamanhoBytes: json.tamanho })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setEnviandoId(null)
      e.target.value = ''
    }
  }

  const confAny = conf as
    | { embalagemOk?: boolean; embalagemPor?: string | null; embalagemConfirmadoEm?: string | null; observacoes?: string | null; observacoesGerais?: string | null; obsTravadaEm?: string | null; confirmado?: boolean }
    | null
    | undefined
  const notasTravadas = !!confAny?.obsTravadaEm
  const [obsGerais, setObsGerais] = useState('')
  const [obsEmbal, setObsEmbal] = useState('')

  const maquinasList = itens ?? []
  // Mesma regra de server/src/router/ordens/conferencia.ts (confirmar) —
  // calculado aqui só pra desabilitar o botão com o motivo certo, o
  // servidor valida de novo (não dá pra contornar chamando a mutation direto).
  function maquinaCompleta(item: NonNullable<typeof itens>[number]): boolean {
    if (item.naoAplicavel) return true
    if (item.inspecaoVisualAvaria === null || item.inspecaoVisualAvaria === undefined) return false
    if (item.inspecaoVisualAvaria) return fotosAvariaDe(item.maquinaId).length > 0
    return true
  }
  const todasMaquinasCompletas = maquinasList.length > 0 && maquinasList.every(maquinaCompleta)
  const podeConfirmar = todasMaquinasCompletas && !!confAny?.embalagemOk

  return (
    <div className="space-y-4">
      {maquinasList.length === 0 ? (
        <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
          <AlertTriangle size={13} /> Nenhuma máquina vinculada ao pedido — vincule na etapa de Preparação antes de conferir
        </p>
      ) : (
        <div className="space-y-3">
          {maquinasList.map((item) => (
            <div key={item.id} className="rounded-xl border border-dark-600 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-dark-100 flex items-center gap-2">
                  <Boxes size={14} className="text-gold-400" />
                  {item.maquina?.numeroSerie || `#${item.maquinaId}`}
                  <span className="text-xs font-normal text-dark-500">{item.maquina?.modelo || 'sem modelo'}</span>
                </p>
                <button
                  onClick={() => itemMut.mutate({ ordemId, maquinaId: item.maquinaId, naoAplicavel: !item.naoAplicavel })}
                  disabled={!podeEditar}
                  className={`shrink-0 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-60 ${
                    item.naoAplicavel ? 'border-amber-500/50 bg-amber-900/20 text-amber-400' : 'border-dark-600 text-dark-400 hover:border-amber-500/50'
                  }`}
                >
                  {item.naoAplicavel ? '✓ Checklist não necessário' : 'Checklist não necessário'}
                </button>
              </div>

              {item.naoAplicavel ? (
                <p className="text-xs text-amber-400">Esta máquina foi marcada como dispensada do checklist de conferência.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                    {ITEM_CHECKLIST.map(({ campo, label }) => (
                      <Toggle key={campo} label={label} checked={!!item[campo]} disabled={!podeEditar} onChange={(v) => itemMut.mutate({ ordemId, maquinaId: item.maquinaId, [campo]: v })} />
                    ))}
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold text-dark-400 mb-1.5">Inspeção Visual — há avaria?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => itemMut.mutate({ ordemId, maquinaId: item.maquinaId, inspecaoVisualAvaria: false })}
                        disabled={!podeEditar}
                        className={`flex-1 rounded-lg border-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                          item.inspecaoVisualAvaria === false ? 'border-green-500 bg-green-900/20 text-green-400' : 'border-dark-600 text-dark-400'
                        }`}
                      >
                        Não — OK
                      </button>
                      <button
                        onClick={() => itemMut.mutate({ ordemId, maquinaId: item.maquinaId, inspecaoVisualAvaria: true })}
                        disabled={!podeEditar}
                        className={`flex-1 rounded-lg border-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                          item.inspecaoVisualAvaria === true ? 'border-red-500 bg-red-900/20 text-red-400' : 'border-dark-600 text-dark-400'
                        }`}
                      >
                        Sim — há avaria
                      </button>
                    </div>

                    {item.inspecaoVisualAvaria && (
                      <div className="mt-2 rounded-lg border border-yellow-700/40 bg-yellow-900/10 p-2 space-y-1.5">
                        <p className="text-[11px] text-yellow-500">Foto da avaria (obrigatória pra confirmar a conferência)</p>
                        <div className="flex flex-wrap gap-2">
                          {fotosAvariaDe(item.maquinaId).map((f) => (
                            <a key={f.id} href={`/uploads/${f.nomeArmazenado}`} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">
                              {f.nomeOriginal}
                            </a>
                          ))}
                        </div>
                        {fotosAvariaDe(item.maquinaId).length === 0 && <p className="text-[11px] font-semibold text-amber-400">⚠️ Anexe ao menos uma foto da avaria</p>}
                        {podeEditar && (
                          <label className="inline-block text-xs text-gold-400 hover:text-gold-300 cursor-pointer">
                            {enviandoId === item.maquinaId ? 'Enviando...' : 'Anexar foto da avaria'}
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadAvaria(e, item.maquinaId)} disabled={enviandoId === item.maquinaId} />
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Observações da Conferência + instrução de embalagem — um "Salvar" que trava */}
      <div className="rounded-xl border border-dark-600 p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-dark-200 flex items-center gap-2">
            <MessageSquareWarning size={14} /> Observações da Conferência
          </p>
          {notasTravadas && (
            <span className="flex items-center gap-1 text-[11px] text-dark-500">
              <Lock size={11} /> salvo {confAny?.obsTravadaEm ? formatDateTime(confAny.obsTravadaEm) : ''}
            </span>
          )}
        </div>
        <Input label="Situação do pedido no checklist de conferência" defaultValue={confAny?.observacoesGerais ?? ''} onChange={(e) => setObsGerais(e.target.value)} disabled={!podeEditar || notasTravadas} />
        <Input label="Instrução do conferente para quem for embalar" defaultValue={confAny?.observacoes ?? ''} onChange={(e) => setObsEmbal(e.target.value)} disabled={!podeEditar || notasTravadas} />
        {podeEditar &&
          (notasTravadas ? (
            <button onClick={() => salvarObsMut.mutate({ ordemId, travar: false })} className="flex items-center gap-1 text-xs font-semibold text-gold-400 hover:text-gold-300">
              <Pencil size={12} /> Editar observações
            </button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              loading={salvarObsMut.isPending}
              onClick={() => salvarObsMut.mutate({ ordemId, observacoesGerais: obsGerais || (confAny?.observacoesGerais ?? ''), observacoes: obsEmbal || (confAny?.observacoes ?? ''), travar: true })}
            >
              Salvar observações da conferência
            </Button>
          ))}
      </div>

      {/* Embalagem — quem embalou + confirmação */}
      <div className="rounded-xl border border-dark-600 p-3 space-y-2.5">
        <p className="text-sm font-semibold text-dark-200 flex items-center gap-2">
          <PackageCheck size={14} /> Embalagem
        </p>
        <div>
          <label className="text-xs text-dark-400 mb-1 block">Quem embalou</label>
          <Select
            value={confAny?.embalagemPor ?? ''}
            disabled={!podeEditar || !!confAny?.embalagemOk}
            onChange={(e) => atualizarMut.mutate({ ordemId, embalagemPor: e.target.value })}
            options={EMBALADORES.map((n) => ({ value: n, label: n }))}
            placeholder="Selecione..."
          />
        </div>

        {confAny?.embalagemOk ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-green-700/50 bg-green-900/10 px-3 py-2">
            <p className="text-sm font-medium text-green-400 flex items-center gap-2">
              <CheckCircle2 size={16} />
              Embalagem confirmada{confAny.embalagemPor ? ` por ${confAny.embalagemPor}` : ''}
              {confAny.embalagemConfirmadoEm ? ` em ${formatDateTime(confAny.embalagemConfirmadoEm)}` : ''}
            </p>
            {podeEditar && (
              <button onClick={() => atualizarMut.mutate({ ordemId, embalagemOk: false })} className="shrink-0 text-xs font-semibold text-green-400 underline hover:no-underline">
                desfazer
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => atualizarMut.mutate({ ordemId, embalagemOk: true })}
            disabled={!podeEditar || !confAny?.embalagemPor}
            title={!confAny?.embalagemPor ? 'Selecione quem embalou antes de confirmar' : undefined}
            className="w-full rounded-lg border-2 border-dashed border-dark-600 py-2 text-sm font-semibold text-dark-300 hover:border-green-600/60 hover:text-green-400 transition-colors disabled:opacity-60"
          >
            Confirmar embalagem feita — conforme instrução acima
          </button>
        )}
      </div>

      {/* Confirmação do gestor */}
      {confAny?.confirmado ? (
        <div className="flex items-center gap-3 rounded-xl border border-green-700/50 bg-green-900/20 px-4 py-3">
          <CheckCircle2 size={20} className="text-green-400 shrink-0" />
          <p className="text-sm font-semibold text-green-400">Conferência confirmada ✅</p>
        </div>
      ) : podeEditar ? (
        <Button
          className="w-full"
          disabled={!podeConfirmar}
          title={!podeConfirmar ? 'Informe a inspeção visual de todas as máquinas e marque a embalagem antes de confirmar' : undefined}
          loading={confirmarMut.isPending}
          onClick={() => confirmarMut.mutate({ ordemId })}
        >
          <CheckCircle2 size={16} className="mr-1" /> Conferência — OK
        </Button>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-900/10 px-3 py-2.5">
          <AlertTriangle size={15} className="text-amber-400 shrink-0" />
          <p className="text-sm text-amber-400">Aguardando confirmação do gestor</p>
        </div>
      )}
    </div>
  )
}
