import { trpc } from '../lib/trpc'

const ETAPA_LABEL: Record<string, string> = {
  novo: 'Novo',
  abordagem: 'Abordagem',
  negociacao: 'Negociação',
  fechado: 'Fechado',
  perdido: 'Perdido',
  sem_contato: 'Sem contato',
  consumidor_final: 'Consumidor Final / Repassado',
  consumidor_final_loja: 'Consumidor Final',
}
const ETAPA_COR: Record<string, string> = {
  novo: 'text-dark-400',
  abordagem: 'text-blue-400',
  negociacao: 'text-amber-400',
  fechado: 'text-green-400',
  perdido: 'text-red-400',
  sem_contato: 'text-dark-500',
  consumidor_final: 'text-purple-400',
  consumidor_final_loja: 'text-cyan-400',
}
const TIPO_ICONE: Record<string, string> = { ligacao: '📞', whatsapp: '💬', email: '📧', visita: '🚗' }
const EMPRESA_REPASSE_LABEL: Record<string, string> = {
  tubos_conexoes: 'Tubos e Conexões',
  compressores: 'Compressores',
  outra: 'Outra empresa',
}

function formatarMoedaHist(v: number | null): string {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarMes(mesReferencia: string): string {
  const [ano, mes] = mesReferencia.split('-')
  return new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

// Histórico completo do cliente atravessando todos os meses (funil só
// mostra o mês corrente) — usado tanto na tela cheia de detalhes do
// cliente quanto direto no card do Kanban, pra "TUDO" ficar visível pro
// vendedor sem precisar sair do card: etapa/venda de cada mês, todos os
// itens já comprados e o histórico de contatos inteiro, não só do mês.
export default function HistoricoCliente({ clienteId }: { clienteId: number }) {
  const { data, isLoading } = trpc.clientes.historico.useQuery({ id: clienteId })

  if (isLoading) return <p className="text-xs text-dark-500">Carregando histórico...</p>
  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-dark-100 mb-3">📅 Histórico por mês</h2>
        <div className="divide-y divide-dark-700">
          {data.funis.map((f) => (
            <div key={f.id} className="py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-dark-200 capitalize">{formatarMes(f.mesReferencia)}</span>
                <span className={`text-xs font-medium ${ETAPA_COR[f.etapa]}`}>{ETAPA_LABEL[f.etapa]}</span>
              </div>
              {f.etapa === 'fechado' && f.vendas.length > 0 ? (
                <div className="mt-1 space-y-0.5">
                  {f.vendas.map((v) => (
                    <div key={v.id} className="flex items-center justify-between text-xs text-dark-400">
                      <span>
                        Fechado: {formatarMoedaHist(v.valorFechado)}
                        {v.condicaoPagamento ? ` · ${v.condicaoPagamento}` : ''}
                      </span>
                      <span>{f.vendedorNome}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-between text-xs text-dark-400 mt-0.5">
                  <span>
                    {f.etapa === 'perdido' && `Motivo: ${f.motivoPerdaObservacao ?? '—'}`}
                    {f.etapa === 'consumidor_final' &&
                      `Repassado para: ${f.empresaRepasse ? EMPRESA_REPASSE_LABEL[f.empresaRepasse] : '—'}${f.motivoRepasseObservacao ? ` · ${f.motivoRepasseObservacao}` : ''}`}
                    {f.valorOrcado != null && f.etapa !== 'fechado' && `Orçado: ${formatarMoedaHist(f.valorOrcado)}`}
                  </span>
                  <span>{f.vendedorNome}</span>
                </div>
              )}
            </div>
          ))}
          {!data.funis.length && <p className="text-sm text-dark-500 py-2">Nenhum funil registrado ainda.</p>}
        </div>
      </div>

      {data.itens.length > 0 && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-dark-100 mb-3">📦 Itens comprados</h2>
          <div className="divide-y divide-dark-700">
            {data.itens.map((i) => (
              <div key={i.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-dark-200">{i.descricao}</span>
                <span className="text-xs text-dark-400">
                  {i.quantidade != null ? `${i.quantidade} un. · ` : ''}
                  {formatarMoedaHist(i.valorTotal)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-dark-100 mb-3">🗒️ Histórico de contatos</h2>
        <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto">
          {data.contatos.map((c) => (
            <div key={c.id} className="py-2 text-sm">
              <p className="text-xs text-dark-400">
                {TIPO_ICONE[c.tipo]} {new Date(c.dataHora.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                {c.resultado
                  ? ` · ${
                      c.resultado === 'respondeu'
                        ? 'Respondeu'
                        : c.resultado === 'nao_respondeu'
                        ? 'Não respondeu'
                        : c.resultado === 'caixa_postal'
                        ? 'Caixa postal'
                        : 'Número errado'
                    }`
                  : ''}
              </p>
              <p className="text-dark-200">{c.observacao}</p>
            </div>
          ))}
          {!data.contatos.length && <p className="text-sm text-dark-500 py-2">Nenhum contato registrado ainda.</p>}
        </div>
      </div>
    </div>
  )
}
