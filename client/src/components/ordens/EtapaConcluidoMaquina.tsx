// "Concluído" do pedido de máquina — fim do fluxo (pós-venda já feito).
// Mostra o Agendamento de peças que nasceu daqui.
import { trpc } from '../../lib/trpc'

export default function EtapaConcluidoMaquina({ ordemId }: { ordemId: number }) {
  const { data: ag, isLoading } = trpc.posVendaOdin.agendamentoDaOrdem.useQuery({ ordemId })
  return (
    <div className="text-center py-6 space-y-2">
      <p className="text-sm text-dark-200">✅ Pedido concluído — fluxo da máquina encerrado.</p>
      {!isLoading && ag && (
        <p className="text-sm text-dark-400">
          Agendamento de peças {ag.status === 'aberto' ? 'em aberto' : ag.status === 'concluido' ? 'concluído' : 'cancelado'}
          {ag.vendedorNome && <> com <span className="text-dark-200">{ag.vendedorNome}</span></>}
          {ag.status === 'aberto' && ag.proximoContato && <> · próximo contato {ag.proximoContato.split('-').reverse().join('/')}</>}
        </p>
      )}
      {!isLoading && !ag && <p className="text-xs text-dark-500">Sem agendamento de peças para este pedido.</p>}
    </div>
  )
}
