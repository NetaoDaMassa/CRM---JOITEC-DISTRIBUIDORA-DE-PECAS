import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import Select from '../ui/Select'
import { Badge } from '../ui/Badge'

const EMBALADORES = ['RAFAEL', 'MARCUS', 'EDUARDO']
const ITEM_CHECKLIST: { campo: 'placaOk' | 'adesivoOk' | 'fichaTecnicaOk' | 'voltagemOk' | 'kitOk'; label: string }[] = [
  { campo: 'placaOk', label: 'Placa' },
  { campo: 'adesivoOk', label: 'Adesivo' },
  { campo: 'fichaTecnicaOk', label: 'Ficha Técnica' },
  { campo: 'voltagemOk', label: 'Voltagem' },
  { campo: 'kitOk', label: 'Kit' },
]

export default function EtapaConferencia({ ordemId, isAdmin, readonly }: { ordemId: number; isAdmin: boolean; readonly: boolean }) {
  const utils = trpc.useUtils()
  const { data: conf } = trpc.ordens.conferencia.obter.useQuery({ ordemId })
  const { data: itens } = trpc.ordens.conferencia.listarItens.useQuery({ ordemId })
  const podeEditar = isAdmin && !readonly

  function invalidar() {
    utils.ordens.conferencia.obter.invalidate({ ordemId })
    utils.ordens.conferencia.listarItens.invalidate({ ordemId })
  }
  const atualizarMut = trpc.ordens.conferencia.atualizar.useMutation({ onSuccess: () => invalidar(), onError: (e) => toast.error(e.message) })
  const salvarObsMut = trpc.ordens.conferencia.atualizar.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const itemMut = trpc.ordens.conferencia.atualizarItem.useMutation({ onSuccess: () => invalidar(), onError: (e) => toast.error(e.message) })
  const confirmarMut = trpc.ordens.conferencia.confirmar.useMutation({ onSuccess: () => { toast.success('Conferência confirmada'); invalidar() }, onError: (e) => toast.error(e.message) })

  const confAny = conf as { embalagemPor?: string | null; observacoes?: string | null; observacoesGerais?: string | null; obsTravadaEm?: string | null } | null | undefined
  const notasTravadas = !!confAny?.obsTravadaEm
  const [obsGerais, setObsGerais] = useState('')
  const [obsEmbal, setObsEmbal] = useState('')

  return (
    <div className="space-y-5">
      <label className="flex items-center gap-2 text-sm text-dark-200">
        <input type="checkbox" checked={!!conf?.embalagemOk} disabled={!podeEditar} onChange={(e) => atualizarMut.mutate({ ordemId, embalagemOk: e.target.checked })} />
        Embalagem OK
      </label>

      <div>
        <label className="text-xs text-dark-400 mb-1 block">Quem embalou</label>
        <Select
          value={confAny?.embalagemPor ?? ''}
          disabled={!podeEditar || !!conf?.embalagemOk}
          onChange={(e) => atualizarMut.mutate({ ordemId, embalagemPor: e.target.value })}
          options={EMBALADORES.map((n) => ({ value: n, label: n }))}
          placeholder="Selecione..."
        />
      </div>

      <div className="space-y-2 rounded-lg border border-dark-600 p-3">
        <Input label={`Situação do pedido no checklist${notasTravadas ? ' 🔒' : ''}`} defaultValue={confAny?.observacoesGerais ?? ''} onChange={(e) => setObsGerais(e.target.value)} disabled={!podeEditar || notasTravadas} />
        <Input label="Instrução do conferente para quem for embalar" defaultValue={confAny?.observacoes ?? ''} onChange={(e) => setObsEmbal(e.target.value)} disabled={!podeEditar || notasTravadas} />
        {podeEditar && (
          notasTravadas ? (
            <button onClick={() => salvarObsMut.mutate({ ordemId, travar: false })} className="text-xs font-semibold text-gold-400 hover:text-gold-300">Editar observações</button>
          ) : (
            <Button size="sm" variant="secondary" loading={salvarObsMut.isPending} onClick={() => salvarObsMut.mutate({ ordemId, observacoesGerais: obsGerais || (confAny?.observacoesGerais ?? ''), observacoes: obsEmbal || (confAny?.observacoes ?? ''), travar: true })}>Salvar observações da conferência</Button>
          )
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-dark-200 mb-2">Checklist por máquina</h3>
        <div className="space-y-2">
          {(itens ?? []).map((item) => (
            <div key={item.id} className="p-2.5 rounded-lg border border-dark-600 bg-dark-800 text-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-dark-100">{item.maquina?.modelo} <span className="text-dark-500">(id {item.maquinaId})</span></span>
                <label className="flex items-center gap-1.5 text-xs text-dark-300">
                  <input type="checkbox" checked={!!item.naoAplicavel} disabled={!podeEditar} onChange={(e) => itemMut.mutate({ ordemId, maquinaId: item.maquinaId, naoAplicavel: e.target.checked })} /> Checklist não necessário
                </label>
              </div>
              {!item.naoAplicavel && (
                <>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                    {ITEM_CHECKLIST.map(({ campo, label }) => (
                      <label key={campo} className="flex items-center gap-1.5 text-xs text-dark-300">
                        <input type="checkbox" checked={!!item[campo]} disabled={!podeEditar} onChange={(e) => itemMut.mutate({ ordemId, maquinaId: item.maquinaId, [campo]: e.target.checked })} /> {label}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 text-xs text-dark-300">
                      <input type="radio" checked={item.inspecaoVisualAvaria === true} disabled={!podeEditar} onChange={() => itemMut.mutate({ ordemId, maquinaId: item.maquinaId, inspecaoVisualAvaria: true })} /> Avaria encontrada
                    </label>
                    <label className="flex items-center gap-2 text-xs text-dark-300">
                      <input type="radio" checked={item.inspecaoVisualAvaria === false} disabled={!podeEditar} onChange={() => itemMut.mutate({ ordemId, maquinaId: item.maquinaId, inspecaoVisualAvaria: false })} /> Sem avaria
                    </label>
                  </div>
                  {item.inspecaoVisualAvaria && <p className="text-xs text-yellow-500">Anexe a foto da avaria em "Anexos" com categoria avaria__{item.maquinaId}</p>}
                </>
              )}
            </div>
          ))}
          {(!itens || itens.length === 0) && <p className="text-dark-500 text-sm">Vincule máquinas na aba Preparação primeiro</p>}
        </div>
      </div>

      {conf?.confirmado ? (
        <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Confirmada</Badge>
      ) : podeEditar ? (
        <Button size="sm" loading={confirmarMut.isPending} onClick={() => confirmarMut.mutate({ ordemId })}>Confirmar conferência</Button>
      ) : null}
    </div>
  )
}
