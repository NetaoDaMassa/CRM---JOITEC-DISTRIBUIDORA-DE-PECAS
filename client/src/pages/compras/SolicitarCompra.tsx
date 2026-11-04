import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingBag, Plus, ChevronRight } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import ComoUsar from '../../components/ui/ComoUsar'
import FormSolicitacao from '../../components/compras/FormSolicitacao'
import { EtapaBadge, PrioridadeBadge, TipoBadge, TrilhaEtapas } from '../../components/compras/ui'
import { dataBr, useBaseCompras } from '../../lib/comprasShared'
import { formatarMoeda } from '../../lib/moeda'

// Tela de quem PEDE a compra: abre a solicitação e acompanha em que etapa
// cada pedido está. Pedido do João, 2026-11-04.
export default function SolicitarCompra() {
  const base = useBaseCompras()
  const [abrindo, setAbrindo] = useState(false)
  const { data: minhas, isLoading } = trpc.comprasProcesso.minhas.useQuery()

  const abertas = (minhas ?? []).filter((m) => !['finalizado', 'reprovado', 'cancelado'].includes(m.etapa))
  const encerradas = (minhas ?? []).filter((m) => ['finalizado', 'reprovado', 'cancelado'].includes(m.etapa))

  return (
    <div className="p-4 sm:p-6 max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShoppingBag size={20} className="text-gold-400" />
          <div>
            <h1 className="font-heading text-xl text-dark-50">Solicitar compra</h1>
            <p className="text-sm text-dark-400">Peça o que precisa comprar e acompanhe cada etapa até chegar.</p>
          </div>
        </div>
        {!abrindo && (
          <Button onClick={() => setAbrindo(true)}>
            <Plus size={16} /> Nova solicitação
          </Button>
        )}
      </div>

      <ComoUsar
        chave="compras_solicitar"
        titulo="Como funciona"
        passos={[
          <>Clique em <b>Nova solicitação</b>, diga se é <b>Revenda</b> (mercadoria pra vender) ou <b>Uso e Consumo</b> (usado aqui dentro) e liste os itens.</>,
          <>O <b>Compras</b> cota com os fornecedores, negocia e manda pra <b>aprovação</b>.</>,
          <>Depois de aprovada, o Compras emite o <b>pedido</b> e você acompanha até o <b>recebimento</b>. Você recebe um aviso no sininho a cada passo.</>,
        ]}
        dicas={[<>Dá pra editar ou cancelar enquanto o Compras ainda não começou a cotar.</>]}
      />

      {abrindo && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 sm:p-5">
          <p className="font-heading text-gold-400 mb-3">Nova solicitação de compra</p>
          <FormSolicitacao onPronto={() => setAbrindo(false)} onCancelar={() => setAbrindo(false)} />
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium text-dark-200">Em andamento ({abertas.length})</p>
        {isLoading && <p className="text-sm text-dark-400">Carregando...</p>}
        {!isLoading && !abertas.length && <p className="text-sm text-dark-400 bg-dark-800 border border-dark-700 rounded-xl p-4">Nenhuma solicitação em andamento.</p>}
        {abertas.map((m) => (
          <Link key={m.id} to={`${base}/compras/${m.id}`} className="block bg-dark-800 border border-dark-600 hover:border-dark-500 rounded-2xl p-4 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-dark-50 font-medium truncate">
                  <span className="text-dark-500 mr-1.5">#{m.id}</span>
                  {m.titulo}
                </p>
                <p className="text-xs text-dark-400 truncate">
                  {m.empresaNome} · {m.qtdItens} {m.qtdItens === 1 ? 'item' : 'itens'}: {m.resumoItens}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <PrioridadeBadge prioridade={m.prioridade} />
                <TipoBadge tipo={m.tipo} />
                <ChevronRight size={16} className="text-dark-500" />
              </div>
            </div>
            <div className="mt-3">
              <TrilhaEtapas etapa={m.etapa} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-dark-400">
              <span>Aberta em {dataBr(m.createdAt)}</span>
              {m.dataNecessidade && <span>Precisa até {dataBr(m.dataNecessidade)}</span>}
              {m.fornecedorNome && <span>Fornecedor: {m.fornecedorNome}</span>}
              {m.valorFinal != null && <span>Valor: {formatarMoeda(m.valorFinal)}</span>}
              {m.previsaoEntrega && <span className={m.entregaAtrasada ? 'text-red-400 font-medium' : ''}>Entrega prevista {dataBr(m.previsaoEntrega)}{m.entregaAtrasada ? ` (atrasada ${m.diasAtraso}d)` : ''}</span>}
            </div>
          </Link>
        ))}
      </div>

      {encerradas.length > 0 && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
          <p className="px-4 pt-4 pb-2 text-sm font-medium text-dark-200">Encerradas</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {encerradas.map((m) => (
                  <tr key={m.id} className="border-t border-dark-700 hover:bg-dark-700/40">
                    <td className="px-4 py-2 text-dark-500">#{m.id}</td>
                    <td className="px-2 py-2">
                      <Link to={`${base}/compras/${m.id}`} className="text-dark-100 hover:text-gold-400">
                        {m.titulo}
                      </Link>
                    </td>
                    <td className="px-2 py-2">
                      <EtapaBadge etapa={m.etapa} />
                    </td>
                    <td className="px-2 py-2 text-dark-400 whitespace-nowrap">{m.valorFinal != null ? formatarMoeda(m.valorFinal) : '—'}</td>
                    <td className="px-4 py-2 text-dark-400 whitespace-nowrap">{dataBr(m.dataRecebimento ?? m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
