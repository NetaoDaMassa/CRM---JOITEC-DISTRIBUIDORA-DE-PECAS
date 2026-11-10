import { useMemo, useState } from 'react'
import { Boxes, Clock, PackageX, Warehouse } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { hojeBrString } from '../../../lib/utils'
import { usePersistedState } from '../../../lib/usePersistedState'
import { Abas, Chips, KpiCard, moeda, numero } from '../../../components/relatorios/blocos'
import { formatarDataCurta } from '../../../components/relatorios/filtros'
import TabelaDados from '../../../components/relatorios/TabelaDados'
import type { Coluna } from '../../../components/relatorios/TabelaDados'
import type { PropsDetalhe } from './tipos'

// Abas de estoque do relatório "Itens do SAP" (pedido do João, 2026-11-10):
// itens que menos venderam, estoque sem venda há X dias e tempo de estoque.
// Dados do SAP de hora em hora (server/src/lib/sapEstoque.ts): estoque só
// dos depósitos de Revenda, vendas de todos os clientes da filial.

type Props = Pick<PropsDetalhe, 'simples' | 'mostrarResumo'>

const qtd = (v: number) => numero(Math.round(v * 100) / 100)
const classeCampo = 'h-9 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-2.5 focus:outline-none focus:border-gold-500'

function somarDias(dia: string, n: number) {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000)

type Situacao = { historicoAte: string | null; completo: boolean; fotoEm: string | null; inicioSap: string; temFilial: boolean }

function AvisoDados({ s }: { s: Situacao | undefined }) {
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

function Rodape({ s, extra }: { s: Situacao | undefined; extra: string }) {
  const foto = s?.fotoEm ? new Date(`${s.fotoEm.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null
  return (
    <p className="text-xs text-dark-500">
      {extra} Estoque só dos depósitos de Revenda; vendas de todos os clientes da filial (notas canceladas e devoluções não entram). O SAP começou em{' '}
      {formatarDataCurta(s?.inicioSap)}: antes disso não há histórico.{foto ? ` Estoque atualizado em ${foto}.` : ''}
    </p>
  )
}

const textoUltimaVenda = (v: string | null, inicio: string) => (v ? formatarDataCurta(v) : `nenhuma desde ${formatarDataCurta(inicio)}`)

// ── Itens que menos venderam ──────────────────────────────────────────────
type Periodo = '30' | '60' | '90' | 'pers'

export function MenosVendidos({ simples, mostrarResumo }: Props) {
  const hoje = hojeBrString()
  const [periodo, setPeriodo] = usePersistedState<Periodo>('rel:itensSap:menos:periodo', '30')
  const [dePers, setDePers] = useState(somarDias(hoje, -29))
  const [atePers, setAtePers] = useState(hoje)
  const [filtro, setFiltro] = useState<'com_estoque' | 'zerados' | null>(null)
  const de = periodo === 'pers' ? dePers : somarDias(hoje, -(Number(periodo) - 1))
  const ate = periodo === 'pers' ? atePers : hoje
  const valido = de <= ate
  const { data, isLoading } = trpc.reports.itensSapMenosVendidos.useQuery({ de, ate }, { enabled: valido })
  const linhas = data?.itens ?? []
  const zerados = linhas.filter((l) => l.quantidade === 0 && l.estoque > 0)
  const filtradas = filtro === 'com_estoque' ? linhas.filter((l) => l.estoque > 0) : filtro === 'zerados' ? zerados : linhas

  type L = (typeof linhas)[number]
  const colunas: Coluna<L>[] = [
    { id: 'codigo', rotulo: 'Código', valor: (l) => l.codigo, render: (l) => <span className="text-dark-400 text-xs">{l.codigo}</span> },
    { id: 'antigo', rotulo: 'Cód. antigo', valor: (l) => l.codigoAntigo, oculta: simples },
    { id: 'item', rotulo: 'Item', quebrar: true, valor: (l) => l.descricao, render: (l) => <span className="font-medium text-dark-50">{l.descricao}</span> },
    { id: 'quantidade', rotulo: 'Vendido (qtd)', valor: (l) => l.quantidade, formato: 'numero', somar: true, render: (l) => <span className={l.quantidade ? 'text-dark-100' : 'font-semibold text-red-500'}>{qtd(l.quantidade)}</span> },
    { id: 'valor', rotulo: 'Valor vendido', valor: (l) => l.valor, formato: 'moeda', somar: true },
    { id: 'notas', rotulo: 'Notas', valor: (l) => l.notas, formato: 'numero', oculta: simples },
    { id: 'estoque', rotulo: 'Estoque', valor: (l) => l.estoque, formato: 'numero', somar: true },
    { id: 'ultima', rotulo: 'Última venda', valor: (l) => l.ultimaVenda, formato: 'data', render: (l) => <span className="text-dark-300 text-xs">{textoUltimaVenda(l.ultimaVenda, data?.inicioSap ?? '')}</span> },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Abas<Periodo>
          valor={periodo}
          onChange={setPeriodo}
          opcoes={[
            { valor: '30', rotulo: 'Últimos 30 dias' },
            { valor: '60', rotulo: '60 dias' },
            { valor: '90', rotulo: '90 dias' },
            { valor: 'pers', rotulo: 'Personalizado' },
          ]}
        />
        {periodo === 'pers' && (
          <div className="flex items-center gap-2 text-sm text-dark-300">
            de <input type="date" value={dePers} min={data?.inicioSap} max={hoje} onChange={(e) => setDePers(e.target.value)} className={classeCampo} />
            até <input type="date" value={atePers} min={dePers} max={hoje} onChange={(e) => setAtePers(e.target.value)} className={classeCampo} />
          </div>
        )}
      </div>
      <AvisoDados s={data} />
      {!valido && <p className="text-sm text-red-400">A data inicial precisa ser antes da final.</p>}
      {mostrarResumo && data?.temFilial && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard titulo="Com estoque e nenhuma venda" icone={PackageX} cor="#e5534b" valor={numero(zerados.length)} detalhe={`de ${formatarDataCurta(de)} a ${formatarDataCurta(ate)}`} />
          <KpiCard titulo="Itens com estoque" icone={Boxes} cor="#0ea5a4" valor={numero(linhas.filter((l) => l.estoque > 0).length)} detalhe="Revenda, hoje" />
          <KpiCard titulo="Itens que venderam no período" icone={Warehouse} cor="#22a861" valor={numero(linhas.filter((l) => l.quantidade > 0).length)} />
        </div>
      )}
      <Chips<'com_estoque' | 'zerados'>
        valor={filtro}
        onChange={setFiltro}
        opcoes={[
          { valor: 'com_estoque', rotulo: 'Só os que têm estoque', cor: '#0ea5a4' },
          { valor: 'zerados', rotulo: `Com estoque e nenhuma venda (${zerados.length})`, cor: '#e5534b' },
        ]}
      />
      <TabelaDados
        id="itens-sap-menos-vendidos"
        linhas={filtradas}
        colunas={colunas}
        chave={(l) => l.codigo}
        buscaEm={(l) => `${l.codigo} ${l.codigoAntigo ?? ''} ${l.descricao}`}
        placeholderBusca="Buscar código ou nome do item..."
        nomeArquivo={`itens-menos-vendidos-${de}-a-${ate}.csv`}
        ordemInicial={{ coluna: 'quantidade', direcao: 'asc' }}
        simples={simples}
        carregando={isLoading}
        vazio="Nenhum item do SAP para esta empresa."
      />
      <Rodape s={data} extra="Do que menos vendeu para o que mais vendeu no período. Entram os itens com estoque hoje e os que venderam alguma vez desde a implantação do SAP." />
    </div>
  )
}

// ── Estoque sem venda há X dias ───────────────────────────────────────────
const LIMITES = ['60', '90', '120', '180'] as const

export function EstoqueSemVenda({ simples, mostrarResumo }: Props) {
  const hoje = hojeBrString()
  const [limite, setLimite] = usePersistedState<(typeof LIMITES)[number]>('rel:itensSap:semVenda:dias', '60')
  const { data, isLoading } = trpc.reports.itensSapEstoque.useQuery()
  const corte = somarDias(hoje, -Number(limite))
  const linhas = useMemo(
    () =>
      (data?.itens ?? [])
        .filter((l) => !l.ultimaVenda || l.ultimaVenda < corte)
        .map((l) => ({ ...l, diasSemVenda: diasEntre(l.ultimaVenda ?? data!.inicioSap, hoje) })),
    [data, corte, hoje]
  )
  const verValor = !!data?.verValor
  const valorParado = linhas.reduce((s, l) => s + (l.valor ?? 0), 0)

  type L = (typeof linhas)[number]
  const colunas: Coluna<L>[] = [
    { id: 'codigo', rotulo: 'Código', valor: (l) => l.codigo, render: (l) => <span className="text-dark-400 text-xs">{l.codigo}</span> },
    { id: 'antigo', rotulo: 'Cód. antigo', valor: (l) => l.codigoAntigo, oculta: simples },
    { id: 'item', rotulo: 'Item', quebrar: true, valor: (l) => l.descricao, render: (l) => <span className="font-medium text-dark-50">{l.descricao}</span> },
    { id: 'estoque', rotulo: 'Estoque', valor: (l) => l.estoque, formato: 'numero', somar: true },
    ...(verValor ? [{ id: 'valor', rotulo: 'Valor em estoque (custo)', valor: (l: L) => l.valor, formato: 'moeda' as const, somar: true }] : []),
    { id: 'ultima', rotulo: 'Última venda', valor: (l) => l.ultimaVenda, formato: 'data', render: (l) => <span className="text-dark-300 text-xs">{textoUltimaVenda(l.ultimaVenda, data?.inicioSap ?? '')}</span> },
    {
      id: 'dias',
      rotulo: 'Dias sem venda',
      valor: (l) => l.diasSemVenda,
      formato: 'numero',
      render: (l) => (
        <span className="font-semibold text-red-500">
          {l.ultimaVenda ? numero(l.diasSemVenda) : `${numero(l.diasSemVenda)}+`}
        </span>
      ),
    },
    { id: 'entrada', rotulo: 'Última entrada', valor: (l) => l.ultimaEntrada, formato: 'data', oculta: simples },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Abas<(typeof LIMITES)[number]> valor={limite} onChange={setLimite} opcoes={LIMITES.map((d) => ({ valor: d, rotulo: `Mais de ${d} dias sem venda` }))} />
      </div>
      <AvisoDados s={data} />
      {mostrarResumo && data?.temFilial && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard titulo={`Itens sem venda há +${limite} dias`} icone={PackageX} cor="#e5534b" valor={numero(linhas.length)} detalhe={`de ${numero(data.itens.length)} com estoque`} />
          <KpiCard titulo="Unidades paradas" icone={Boxes} cor="#f97316" valor={qtd(linhas.reduce((s, l) => s + l.estoque, 0))} />
          {verValor && <KpiCard titulo="Valor parado (custo)" icone={Warehouse} cor="#a855f7" valor={moeda(valorParado)} />}
        </div>
      )}
      <TabelaDados
        id="itens-sap-sem-venda"
        linhas={linhas}
        colunas={colunas}
        chave={(l) => l.codigo}
        buscaEm={(l) => `${l.codigo} ${l.codigoAntigo ?? ''} ${l.descricao}`}
        placeholderBusca="Buscar código ou nome do item..."
        nomeArquivo={`estoque-sem-venda-${limite}-dias.csv`}
        ordemInicial={{ coluna: 'dias', direcao: 'desc' }}
        simples={simples}
        carregando={isLoading}
        vazio={`Nenhum item com estoque parado há mais de ${limite} dias.`}
      />
      <Rodape s={data} extra={`Itens com estoque hoje e sem nenhuma venda há mais de ${limite} dias. "+" = nenhuma venda desde a implantação do SAP (pode ser mais).`} />
    </div>
  )
}

// ── Tempo de estoque ──────────────────────────────────────────────────────
export function TempoEstoque({ simples, mostrarResumo }: Props) {
  const { data, isLoading } = trpc.reports.itensSapEstoque.useQuery()
  const linhas = data?.itens ?? []
  const verValor = !!data?.verValor

  type L = (typeof linhas)[number]
  const meses = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const colunas: Coluna<L>[] = [
    { id: 'codigo', rotulo: 'Código', valor: (l) => l.codigo, render: (l) => <span className="text-dark-400 text-xs">{l.codigo}</span> },
    { id: 'antigo', rotulo: 'Cód. antigo', valor: (l) => l.codigoAntigo, oculta: simples },
    { id: 'item', rotulo: 'Item', quebrar: true, valor: (l) => l.descricao, render: (l) => <span className="font-medium text-dark-50">{l.descricao}</span> },
    { id: 'estoque', rotulo: 'Estoque', valor: (l) => l.estoque, formato: 'numero', somar: true },
    ...(verValor ? [{ id: 'valor', rotulo: 'Valor (custo)', valor: (l: L) => l.valor, formato: 'moeda' as const, somar: true }] : []),
    {
      id: 'desde',
      rotulo: 'Em estoque desde',
      valor: (l) => l.estoqueDesde,
      formato: 'data',
      render: (l) => <span className="text-dark-300 text-xs">{l.desdeImplantacao ? `antes de ${formatarDataCurta(l.estoqueDesde)}` : formatarDataCurta(l.estoqueDesde)}</span>,
    },
    {
      id: 'meses',
      rotulo: 'Meses parado',
      valor: (l) => l.mesesEmEstoque,
      render: (l) => (
        <span className={`font-semibold ${l.mesesEmEstoque >= 6 ? 'text-red-500' : l.mesesEmEstoque >= 3 ? 'text-orange-400' : 'text-dark-100'}`}>
          {meses(l.mesesEmEstoque)}
          {l.desdeImplantacao ? '+' : ''}
        </span>
      ),
    },
    { id: 'media', rotulo: 'Venda média/mês', valor: (l) => l.mediaMes, formato: 'numero' },
    {
      id: 'cobertura',
      rotulo: 'Estoque dá para (meses)',
      valor: (l) => l.coberturaMeses ?? 9999,
      render: (l) =>
        l.coberturaMeses === null ? (
          <span className="text-xs font-semibold text-red-500">sem venda em 90 dias</span>
        ) : (
          <span className={`font-semibold ${l.coberturaMeses >= 12 ? 'text-red-500' : l.coberturaMeses >= 6 ? 'text-orange-400' : 'text-dark-100'}`}>{l.coberturaMeses > 120 ? 'mais de 10 anos' : meses(l.coberturaMeses)}</span>
        ),
    },
    { id: 'ultima', rotulo: 'Última venda', valor: (l) => l.ultimaVenda, formato: 'data', oculta: simples, render: (l) => <span className="text-dark-300 text-xs">{textoUltimaVenda(l.ultimaVenda, data?.inicioSap ?? '')}</span> },
  ]

  return (
    <div className="space-y-5">
      <AvisoDados s={data} />
      {mostrarResumo && data?.temFilial && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard titulo="Itens com estoque" icone={Boxes} cor="#0ea5a4" valor={numero(linhas.length)} />
          <KpiCard titulo="Parados há 6 meses ou mais" icone={Clock} cor="#e5534b" valor={numero(linhas.filter((l) => l.mesesEmEstoque >= 6).length)} />
          <KpiCard titulo="Estoque para 12 meses ou mais" icone={PackageX} cor="#f97316" valor={numero(linhas.filter((l) => l.coberturaMeses === null || l.coberturaMeses >= 12).length)} detalhe="Inclui os sem venda em 90 dias" />
          {verValor && <KpiCard titulo="Valor em estoque (custo)" icone={Warehouse} cor="#a855f7" valor={moeda(linhas.reduce((s, l) => s + (l.valor ?? 0), 0))} />}
        </div>
      )}
      <TabelaDados
        id="itens-sap-tempo-estoque"
        linhas={linhas}
        colunas={colunas}
        chave={(l) => l.codigo}
        buscaEm={(l) => `${l.codigo} ${l.codigoAntigo ?? ''} ${l.descricao}`}
        placeholderBusca="Buscar código ou nome do item..."
        nomeArquivo="tempo-de-estoque.csv"
        ordemInicial={{ coluna: 'meses', direcao: 'desc' }}
        simples={simples}
        carregando={isLoading}
        vazio="Nenhum item com estoque de Revenda para esta empresa."
      />
      <Rodape
        s={data}
        extra='"Meses parado": desde a entrada da unidade mais antiga que ainda está no estoque (o que sai primeiro é o mais antigo); "+" = já estava no estoque na implantação do SAP. "Estoque dá para": estoque ÷ venda média por mês dos últimos 90 dias.'
      />
    </div>
  )
}
