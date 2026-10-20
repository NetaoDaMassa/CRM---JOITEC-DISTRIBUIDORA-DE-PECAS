import { useMemo } from 'react'
import { TrendingUp } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { usePersistedState } from '../../lib/usePersistedState'
import ExplicacaoMetricas from '../../components/relatorios/ExplicacaoMetricas'
import BotaoImprimir from '../../components/relatorios/BotaoImprimir'
import { Abas, Carregando } from '../../components/relatorios/blocos'
import { calcular, passaFiltros, useFiltrosLeads } from '../relatorios/leads/base'
import FiltrosLeadsBarra from '../relatorios/leads/Filtros'
import { Lista, Origem, Perdas, Regioes, Vendedores, VisaoGeral } from '../relatorios/leads/Paineis'
import { AtendimentoAgora, MetasDoMes, Transferencias } from '../relatorios/leads/Atendimento'

type Aba = 'geral' | 'origem' | 'vendedores' | 'regioes' | 'perdas' | 'lista' | 'sla' | 'transferencias'

const ABAS: { valor: Aba; rotulo: string }[] = [
  { valor: 'geral', rotulo: 'Visão geral' },
  { valor: 'origem', rotulo: 'Origem e campanhas' },
  { valor: 'vendedores', rotulo: 'Vendedores' },
  { valor: 'regioes', rotulo: 'Regiões e segmentos' },
  { valor: 'perdas', rotulo: 'Perdas' },
  { valor: 'lista', rotulo: 'Lista de leads' },
  { valor: 'sla', rotulo: 'Atendimento agora' },
  { valor: 'transferencias', rotulo: 'Transferências' },
]

// Relatório de Leads refeito no padrão dos relatórios novos (pedido do
// João, 2026-10-20: "muito incompleto e raso"). Uma busca só no servidor
// (leadsRelatorios.painel, período + período anterior) e todo o resto é
// calculado aqui, então os filtros valem na hora em todas as abas.
// "Atendimento agora" e "Transferências" continuam usando slaOverview /
// transferHistory.
export default function LeadsRelatorios() {
  const f = useFiltrosLeads()
  const [aba, setAba] = usePersistedState<Aba>('relLeads:aba', 'geral')
  const { data, isLoading } = trpc.leadsRelatorios.painel.useQuery({ desde: f.anterior.inicio, ate: f.fim })

  const { m, ant } = useMemo(() => {
    const filtradas = (data ?? []).filter((l) => passaFiltros(l, f))
    return { m: calcular(filtradas, f.inicio, f.fim), ant: calcular(filtradas, f.anterior.inicio, f.anterior.fim) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, f.inicio, f.fim, f.anterior.inicio, f.anterior.fim, f.canal, f.campanha, f.vendedor, f.regiao, f.uf, f.segmento, f.etapa])

  const leadsBase = '/admin/leads'
  const props = { f, m, ant }
  const usaPeriodo = aba !== 'sla'

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-[#ec48991f] text-[#ec4899]">
            <TrendingUp size={22} />
          </span>
          <div>
            <h1 className="font-heading text-2xl font-bold text-dark-50">Relatório de Leads</h1>
            <p className="text-sm text-dark-400">De onde vêm os leads, quanto vira venda, quem atende rápido e por que se perde.</p>
          </div>
        </div>
        <BotaoImprimir nomeArquivo={`relatorio-leads-${aba}`} />
      </div>

      {usaPeriodo && <FiltrosLeadsBarra f={f} linhas={data} />}

      <Abas<Aba> valor={aba} onChange={setAba} opcoes={ABAS} />

      <ExplicacaoMetricas chave={`leads-${aba}`} />

      {aba === 'sla' ? (
        <AtendimentoAgora />
      ) : aba === 'transferencias' ? (
        <Transferencias f={f} leadsBase={leadsBase} />
      ) : isLoading || !data ? (
        <Carregando />
      ) : (
        <>
          {aba === 'geral' && (
            <>
              <VisaoGeral {...props} />
              <MetasDoMes f={f} m={m} />
            </>
          )}
          {aba === 'origem' && <Origem {...props} />}
          {aba === 'vendedores' && <Vendedores {...props} />}
          {aba === 'regioes' && <Regioes {...props} />}
          {aba === 'perdas' && <Perdas {...props} leadsBase={leadsBase} />}
          {aba === 'lista' && <Lista {...props} leadsBase={leadsBase} />}
        </>
      )}
    </div>
  )
}
