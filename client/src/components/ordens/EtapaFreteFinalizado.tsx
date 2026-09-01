import { useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle2, Truck, DollarSign, Clock } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'

// Portado de odin-crm.duckdns.org (FreteFinalizadoStage.tsx) — pedido do
// João, 2026-09-01. Mostra a lista de cotações de novo aqui (não só na
// etapa "Cotação de Frete") pra dar pra trocar de cotação até a última
// hora, com o selo de "melhor preço" e destaque de qual está selecionada.
function formatarMoeda(v: number | null | undefined): string {
  return v != null ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'
}

export default function EtapaFreteFinalizado({ ordemId, isAdmin, readonly }: { ordemId: number; isAdmin: boolean; readonly: boolean }) {
  const utils = trpc.useUtils()
  const { data: aprovacao } = trpc.ordens.frete.obterAprovacao.useQuery({ ordemId })
  const { data: cotacoes } = trpc.ordens.frete.listarCotacoes.useQuery({ ordemId })
  const { data: finalizado } = trpc.ordens.frete.obterFreteFinalizado.useQuery({ ordemId })
  const [obs, setObs] = useState(finalizado?.observacoes ?? '')
  const [selecionandoId, setSelecionandoId] = useState<number | null>(null)
  const podeEditar = isAdmin && !readonly

  function invalidar() {
    utils.ordens.frete.obterAprovacao.invalidate({ ordemId })
    utils.ordens.frete.obterFreteFinalizado.invalidate({ ordemId })
  }
  const selecionarMut = trpc.ordens.frete.aprovarCotacao.useMutation({
    onSuccess: () => { toast.success('Cotação selecionada!'); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const confirmarMut = trpc.ordens.frete.confirmarFreteFinalizado.useMutation({
    onSuccess: () => { toast.success('Frete finalizado! ✅'); invalidar() },
    onError: (e) => toast.error(e.message),
  })

  function selecionar(cotacaoId: number) {
    setSelecionandoId(cotacaoId)
    selecionarMut.mutate({ ordemId, cotacaoId }, { onSettled: () => setSelecionandoId(null) })
  }

  const isConfirmado = !!finalizado?.confirmado
  const retiradaLocal = !!aprovacao?.retiradaLocal
  const semFrete = !!aprovacao?.semFrete
  const listaCotacoes = cotacoes ?? []
  const maisBarataId = retiradaLocal
    ? null
    : listaCotacoes.reduce<(typeof listaCotacoes)[number] | null>((melhor, c) => (c.valor != null && (!melhor || c.valor < (melhor.valor ?? Infinity)) ? c : melhor), null)?.id
  const metodoDefinido = !!aprovacao?.cotacaoSelecionadaId || retiradaLocal || semFrete
  const podeConfirmar = metodoDefinido

  return (
    <div className="space-y-4">
      {/* Seleção da cotação — segue disponível mesmo com Retirada Local/Sem
          Frete ativos; escolher uma aqui substitui automaticamente o método
          atual (só um dos três vale por vez). */}
      <div>
        <p className="text-sm font-semibold text-dark-200 mb-2 flex items-center gap-2 flex-wrap">
          Selecionar Cotação de Frete
          {(retiradaLocal || semFrete) && listaCotacoes.length > 0 && <span className="text-xs font-normal text-amber-400">(substitui o método atual)</span>}
        </p>

        {listaCotacoes.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-dark-600 py-8 text-center">
            <Truck size={22} className="mx-auto text-dark-600 mb-2" />
            <p className="text-sm text-dark-500">Nenhuma cotação cadastrada na etapa anterior</p>
          </div>
        ) : (
          <div className="space-y-2">
            {listaCotacoes.map((c, idx) => {
              const isSelecionada = aprovacao?.cotacaoSelecionadaId === c.id
              const isMaisBarata = c.id === maisBarataId && listaCotacoes.length > 1
              return (
                <div key={c.id} className={`rounded-xl border-2 p-3 transition-colors ${isSelecionada ? 'border-green-600 bg-green-900/10' : 'border-dark-600'}`}>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Truck size={14} className={isSelecionada ? 'text-green-400' : 'text-dark-500'} />
                    {c.numeroCotacaoTransportadora && (
                      <span className="rounded-full bg-blue-900/30 px-2 py-0.5 text-[10px] font-bold text-blue-300">Nº {c.numeroCotacaoTransportadora}</span>
                    )}
                    <p className="font-semibold text-sm text-dark-100">{c.transportadora || `Cotação ${idx + 1}`}</p>
                    {isMaisBarata && <span className="rounded-full bg-green-900/30 px-2 py-0.5 text-[10px] font-bold text-green-400">MELHOR PREÇO</span>}
                    {isSelecionada && (
                      <span className="flex items-center gap-1 rounded-full bg-green-900/30 px-2 py-0.5 text-[10px] font-bold text-green-400">
                        <CheckCircle2 size={10} /> SELECIONADA
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-sm mb-2">
                    <div className="flex items-center gap-1.5">
                      <DollarSign size={12} className="text-dark-500" />
                      <div>
                        <p className="text-[10px] text-dark-500">Valor</p>
                        <p className="font-semibold text-dark-200">{formatarMoeda(c.valor)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock size={12} className="text-dark-500" />
                      <div>
                        <p className="text-[10px] text-dark-500">Prazo</p>
                        <p className="font-semibold text-dark-200">{c.prazo || '—'}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-dark-500">Tipo</p>
                      <p className="font-semibold text-dark-200">{c.tipoFrete || '—'}</p>
                    </div>
                  </div>

                  {!isSelecionada && podeEditar && (
                    <button
                      onClick={() => selecionar(c.id)}
                      disabled={selecionandoId === c.id}
                      className="w-full rounded-lg border-2 border-gold-600 py-1.5 text-sm font-semibold text-gold-400 hover:bg-gold-600 hover:text-dark-950 transition-colors disabled:opacity-50"
                    >
                      {selecionandoId === c.id ? 'Selecionando...' : 'Selecionar esta cotação'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {retiradaLocal && (
        <p className="text-xs text-blue-400">
          🏭 Retirada local {aprovacao?.retiradaEmpresa ? `— ${aprovacao.retiradaEmpresa}` : ''} {aprovacao?.retiradaData ? `em ${aprovacao.retiradaData}` : ''}
        </p>
      )}
      {semFrete && <p className="text-xs text-blue-400">🚫 Sem frete {aprovacao?.semFreteObservacoes ? `— ${aprovacao.semFreteObservacoes}` : ''}</p>}

      {!isConfirmado ? (
        podeEditar && <Input label="Observações" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Instruções especiais, horário de coleta, etc." />
      ) : (
        finalizado?.observacoes && (
          <div className="rounded-lg bg-dark-800 px-3 py-2.5 text-sm text-dark-300">
            <span className="font-medium text-dark-200">Obs.: </span>
            {finalizado.observacoes}
          </div>
        )
      )}

      {isConfirmado ? (
        <div className="flex items-center gap-3 rounded-xl border border-green-700/50 bg-green-900/20 px-4 py-3">
          <CheckCircle2 size={20} className="text-green-400 shrink-0" />
          <p className="text-sm font-semibold text-green-400">Frete Finalizado — OK ✅</p>
        </div>
      ) : podeEditar ? (
        <Button
          className="w-full"
          disabled={!podeConfirmar}
          title={!podeConfirmar ? 'Selecione uma cotação, retirada local ou "sem frete" antes de confirmar' : undefined}
          loading={confirmarMut.isPending}
          onClick={() => confirmarMut.mutate({ ordemId, observacoes: obs })}
        >
          <CheckCircle2 size={16} className="mr-1" /> Frete Finalizado — OK
        </Button>
      ) : (
        !metodoDefinido && <p className="text-xs text-center text-amber-400">Selecione uma cotação acima para liberar a confirmação pelo gestor.</p>
      )}
    </div>
  )
}
