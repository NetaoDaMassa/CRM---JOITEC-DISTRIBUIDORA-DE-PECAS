import { useMemo } from 'react'
import { Boxes, Clock, Warehouse } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { hojeBrString } from '../../../lib/utils'
import { usePersistedState } from '../../../lib/usePersistedState'
import { Abas, KpiCard, moeda, numero } from '../../../components/relatorios/blocos'
import { ComoCalcula, Pergunta, moedaCurta } from './itensSapComum'
import { formatarDataCurta } from '../../../components/relatorios/filtros'
import TabelaDados from '../../../components/relatorios/TabelaDados'
import type { Coluna } from '../../../components/relatorios/TabelaDados'
import type { PropsDetalhe } from './tipos'

// Aba "Estoque parado" do relatório Itens do SAP. Junta as antigas "Estoque
// sem venda" e "Tempo de estoque" (João, 2026-11-10; redesenho 2026-11-19).
// Dados do SAP de hora em hora (server/src/lib/sapEstoque.ts): estoque só
// dos depósitos de Revenda, vendas de todos os clientes da filial.

type Props = Pick<PropsDetalhe, 'simples' | 'mostrarResumo'>

const qtd = (v: number) => numero(Math.round(v * 100) / 100)

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000)

type Situacao = { historicoAte: string | null; completo: boolean; fotoEm: string | null; inicioSap: string; temFilial: boolean }

export function AvisoDados({ s }: { s: Situacao | undefined }) {
  if (!s) return null
  if (!s.temFilial) return <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-4">Esta empresa não tem estoque próprio no SAP.</p>
  if (!s.fotoEm)
    return <p className="text-sm text-amber-200 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">⏳ O estoque ainda não foi puxado do SAP. Ele chega na próxima rodada (de 15 em 15 minutos).</p>
  if (!s.completo)
    return (
      <p className="text-sm text-amber-200 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
        ⏳ O histórico de vendas e entradas está sendo carregado do SAP, 15 dias por vez
        {s.historicoAte ? ` (já tem até ${formatarDataCurta(s.historicoAte)})` : ''}. Até terminar, "sem venda" e "tempo de estoque" podem aparecer maiores do que são.
      </p>
    )
  return null
}

const textoUltimaVenda = (v: string | null, inicio: string) => (v ? formatarDataCurta(v) : `nenhuma desde ${formatarDataCurta(inicio)}`)

// ── Estoque parado ────────────────────────────────────────────────────────
type Corte = '60' | '90' | '180' | 'todos'
const mesesFmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function EstoqueParado({ simples, mostrarResumo }: Props) {
  const hoje = hojeBrString()
  const [corte, setCorte] = usePersistedState<Corte>('rel:itensSap:parado', '90')
  const { data, isLoading } = trpc.reports.itensSapEstoque.useQuery()
  const todos = useMemo(() => (data?.itens ?? []).map((l) => ({ ...l, diasSemVenda: diasEntre(l.ultimaVenda ?? data!.inicioSap, hoje) })), [data, hoje])
  const linhas = corte === 'todos' ? todos : todos.filter((l) => l.diasSemVenda >= Number(corte))
  const verValor = !!data?.verValor
  const valorParado = linhas.reduce((s, l) => s + (l.valor ?? 0), 0)
  const valorTotal = todos.reduce((s, l) => s + (l.valor ?? 0), 0)
  const paraUmAno = todos.filter((l) => l.coberturaMeses === null || l.coberturaMeses >= 12)

  type L = (typeof todos)[number]
  const colunas: Coluna<L>[] = [
    {
      id: 'item',
      rotulo: 'Item',
      quebrar: true,
      valor: (l) => l.descricao,
      render: (l) => (
        <span>
          <span className="font-medium text-dark-50">{l.descricao}</span>
          <span className="block text-[11px] text-dark-500">{l.codigo}{l.codigoAntigo ? ` · ${l.codigoAntigo}` : ''}</span>
        </span>
      ),
    },
    { id: 'codigo', rotulo: 'Código', valor: (l) => l.codigo, oculta: true },
    { id: 'antigo', rotulo: 'Cód. antigo', valor: (l) => l.codigoAntigo, oculta: true },
    { id: 'estoque', rotulo: 'Estoque (un)', valor: (l) => l.estoque, formato: 'numero', somar: true },
    ...(verValor ? [{ id: 'valor', rotulo: 'Valor parado (custo)', valor: (l: L) => l.valor, formato: 'moeda' as const, somar: true }] : []),
    { id: 'ultima', rotulo: 'Última venda', valor: (l) => l.ultimaVenda, formato: 'data', render: (l) => <span className="text-dark-300 text-xs">{textoUltimaVenda(l.ultimaVenda, data?.inicioSap ?? '')}</span> },
    {
      id: 'dias',
      rotulo: 'Dias sem vender',
      valor: (l) => l.diasSemVenda,
      formato: 'numero',
      render: (l) => (
        <span className={`font-semibold ${l.diasSemVenda >= 180 ? 'text-red-400' : l.diasSemVenda >= 90 ? 'text-orange-400' : 'text-dark-100'}`}>
          {numero(l.diasSemVenda)}
          {l.ultimaVenda ? '' : '+'}
        </span>
      ),
    },
    {
      id: 'cobertura',
      rotulo: 'Estoque dá para',
      valor: (l) => l.coberturaMeses ?? 9999,
      render: (l) =>
        l.coberturaMeses === null ? (
          <span className="text-xs font-semibold text-red-400">não vendeu em 90 dias</span>
        ) : (
          <span className={`font-semibold ${l.coberturaMeses >= 12 ? 'text-red-400' : l.coberturaMeses >= 6 ? 'text-orange-400' : 'text-dark-100'}`}>
            {l.coberturaMeses > 120 ? 'mais de 10 anos' : `${mesesFmt(l.coberturaMeses)} meses`}
          </span>
        ),
    },
    { id: 'media', rotulo: 'Vende por mês (un)', valor: (l) => l.mediaMes, formato: 'numero', oculta: true },
    {
      id: 'idade',
      rotulo: 'Idade do estoque (meses)',
      valor: (l) => l.mesesEmEstoque,
      oculta: true,
      render: (l) => <span className="text-dark-300">{mesesFmt(l.mesesEmEstoque)}{l.desdeImplantacao ? '+' : ''}</span>,
    },
    { id: 'entrada', rotulo: 'Última entrada', valor: (l) => l.ultimaEntrada, formato: 'data', oculta: true },
  ]

  return (
    <div className="space-y-5">
      <Pergunta titulo="Quais itens estão parados no estoque?" apoio="Itens com estoque de revenda hoje, do que está parado há mais tempo para o mais recente.">
        <Abas<Corte>
          valor={corte}
          onChange={setCorte}
          opcoes={[
            { valor: '60', rotulo: '+60 dias sem vender' },
            { valor: '90', rotulo: '+90 dias' },
            { valor: '180', rotulo: '+6 meses' },
            { valor: 'todos', rotulo: 'Todo o estoque' },
          ]}
        />
      </Pergunta>
      <AvisoDados s={data} />
      {mostrarResumo && data?.temFilial && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard
            titulo={corte === 'todos' ? 'Itens com estoque' : `Itens sem vender há +${corte === '180' ? '6 meses' : `${corte} dias`}`}
            icone={Clock}
            cor="#e5534b"
            valor={numero(linhas.length)}
            detalhe={`de ${numero(todos.length)} itens com estoque`}
          />
          {verValor ? (
            <KpiCard titulo="Dinheiro parado nesses itens" icone={Warehouse} cor="#a855f7" valor={moedaCurta(valorParado)} detalhe={`custo · ${valorTotal ? `${Math.round((valorParado / valorTotal) * 100)}% do estoque` : ''}`} />
          ) : (
            <KpiCard titulo="Unidades paradas" icone={Warehouse} cor="#a855f7" valor={numero(Math.round(linhas.reduce((s, l) => s + l.estoque, 0)))} />
          )}
          <KpiCard titulo="Estoque para 1 ano ou mais" icone={Boxes} cor="#f97316" valor={numero(paraUmAno.length)} detalhe={`de ${numero(todos.length)} itens com estoque: no ritmo atual, levam 12+ meses para acabar`} />
        </div>
      )}
      <TabelaDados
        key={verValor ? "valor" : "un"}
        id={`itens-sap-estoque-parado-${verValor ? "valor" : "un"}`}
        linhas={linhas}
        colunas={colunas}
        chave={(l) => l.codigo}
        buscaEm={(l) => `${l.codigo} ${l.codigoAntigo ?? ''} ${l.descricao}`}
        placeholderBusca="Buscar código ou nome do item..."
        nomeArquivo={`estoque-parado-${corte}.csv`}
        ordemInicial={verValor ? { coluna: 'valor', direcao: 'desc' } : { coluna: 'dias', direcao: 'desc' }}
        simples={simples}
        carregando={isLoading}
        vazio="Nenhum item parado com esse corte."
      />
      <ComoCalcula
        itens={[
          'Estoque só dos depósitos de Revenda (1-REV, 2-REV, 3-REV, 4-REV), só itens "Mercadoria para Revenda" no SAP; itens usados para montar outros ficam de fora.',
          'Na Joitec e na Automação os tubos e conexões de PPR não aparecem (são da Odin Tubos).',
          '"Dias sem vender": desde a última nota de venda. "+" = nenhuma venda desde que o SAP começou (31/03/2026) — pode ser mais.',
          '"Estoque dá para": estoque ÷ média vendida por mês nos últimos 90 dias (já sem devoluções).',
          'Valor = custo do estoque no SAP (só administradores veem).',
          data?.fotoEm ? `Estoque atualizado em ${new Date(`${data.fotoEm.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} (o SAP é consultado de hora em hora).` : 'O estoque é consultado no SAP de hora em hora.',
        ]}
      />
    </div>
  )
}
