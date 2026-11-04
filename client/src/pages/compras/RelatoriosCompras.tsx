import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FileBarChart, AlertTriangle } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Select from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import { Abas, KpiCard, Secao, moeda } from '../../components/relatorios/blocos'
import TabelaDados, { type Coluna } from '../../components/relatorios/TabelaDados'
import { EtapaBadge, TipoBadge } from '../../components/compras/ui'
import { TIPO_INFO, dataBr, rotuloMes, useBaseCompras } from '../../lib/comprasShared'
import { hojeBrString } from '../../lib/utils'
import { usePersistedState } from '../../lib/usePersistedState'

type Aba = 'mes' | 'fornecedor' | 'categoria' | 'empresa' | 'compras' | 'pendencias'

type Grupo = { chave: string; nome: string; qtd: number; revenda: number; usoConsumo: number; total: number; economia: number }

function colunasGrupo(rotulo: string, ehMes = false): Coluna<Grupo>[] {
  return [
    { id: 'nome', rotulo, valor: (g) => (ehMes ? g.chave : g.nome), render: ehMes ? (g) => rotuloMes(g.chave) : undefined },
    { id: 'qtd', rotulo: 'Compras', valor: (g) => g.qtd, formato: 'numero', somar: true },
    { id: 'revenda', rotulo: 'Revenda', valor: (g) => g.revenda, formato: 'moeda', somar: true },
    { id: 'usoConsumo', rotulo: 'Uso e Consumo', valor: (g) => g.usoConsumo, formato: 'moeda', somar: true },
    { id: 'total', rotulo: 'Total', valor: (g) => g.total, formato: 'moeda', somar: true },
    { id: 'ticket', rotulo: 'Ticket médio', valor: (g) => (g.qtd ? g.total / g.qtd : null), formato: 'moeda' },
    { id: 'economia', rotulo: 'Economia negociando', valor: (g) => g.economia, formato: 'moeda', somar: true },
  ]
}

function mesesAtras(n: number) {
  const [a, m] = hojeBrString().slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(a, m - 1 - n, 1)).toISOString().slice(0, 7)
}

export default function RelatoriosCompras() {
  const base = useBaseCompras()
  const [params, setParams] = useSearchParams()
  const aba = (params.get('aba') as Aba) || 'mes'
  const setAba = (a: Aba) => setParams({ aba: a }, { replace: true })
  const [de, setDe] = usePersistedState('compras:rel:de', mesesAtras(5))
  const [ate, setAte] = usePersistedState('compras:rel:ate', hojeBrString().slice(0, 7))
  const [empresaId, setEmpresaId] = usePersistedState<number | ''>('compras:rel:empresa', '')
  const [tipo, setTipo] = usePersistedState<'' | 'revenda' | 'uso_consumo'>('compras:rel:tipo', '')
  const [fornecedorId, setFornecedorId] = useState<number | ''>('')
  const [categoriaId, setCategoriaId] = useState<number | ''>('')

  const { data: aux } = trpc.comprasProcesso.auxiliares.useQuery()
  const { data: r, isLoading } = trpc.comprasProcesso.relatorio.useQuery({
    de: de <= ate ? de : ate,
    ate: de <= ate ? ate : de,
    empresaId: empresaId || undefined,
    tipo: tipo || undefined,
    fornecedorId: fornecedorId || undefined,
    categoriaId: categoriaId || undefined,
  })
  const { data: pend, isLoading: carregandoPend } = trpc.comprasProcesso.pendencias.useQuery(undefined, { enabled: aba === 'pendencias' })

  type Compra = NonNullable<typeof r>['compras'][number]
  const colunasCompras: Coluna<Compra>[] = [
    { id: 'id', rotulo: '#', valor: (c) => c.id, formato: 'numero', largura: 'w-14' },
    { id: 'dataPedido', rotulo: 'Data do pedido', valor: (c) => c.dataPedido, formato: 'data' },
    { id: 'titulo', rotulo: 'Compra', valor: (c) => c.titulo, quebrar: true },
    { id: 'tipo', rotulo: 'Tipo', valor: (c) => TIPO_INFO[c.tipo].label, render: (c) => <TipoBadge tipo={c.tipo} /> },
    { id: 'empresa', rotulo: 'Empresa', valor: (c) => c.empresaNome },
    { id: 'categoria', rotulo: 'Categoria', valor: (c) => c.categoriaNome },
    { id: 'fornecedor', rotulo: 'Fornecedor', valor: (c) => c.fornecedorNome },
    { id: 'solicitante', rotulo: 'Pedido por', valor: (c) => c.solicitanteNome, oculta: true },
    { id: 'numeroPedido', rotulo: 'Nº pedido', valor: (c) => c.numeroPedido, oculta: true },
    { id: 'etapa', rotulo: 'Situação', valor: (c) => c.etapa, render: (c) => <EtapaBadge etapa={c.etapa} /> },
    { id: 'recebido', rotulo: 'Recebido em', valor: (c) => c.dataRecebimento, formato: 'data', oculta: true },
    { id: 'valorInicial', rotulo: 'Preço cotado', valor: (c) => c.valorInicial, formato: 'moeda', oculta: true },
    { id: 'valorFinal', rotulo: 'Valor', valor: (c) => c.valorFinal, formato: 'moeda', somar: true },
  ]

  type Pend = NonNullable<typeof pend>['entregas'][number]
  const colunasPend = (tipoPend: 'aprovacao' | 'pedido' | 'entrega'): Coluna<Pend>[] => [
    { id: 'id', rotulo: '#', valor: (c) => c.id, formato: 'numero', largura: 'w-14' },
    { id: 'titulo', rotulo: 'Compra', valor: (c) => c.titulo, quebrar: true },
    { id: 'empresa', rotulo: 'Empresa', valor: (c) => c.empresaNome },
    { id: 'fornecedor', rotulo: 'Fornecedor', valor: (c) => c.fornecedorNome },
    { id: 'tipo', rotulo: 'Tipo', valor: (c) => TIPO_INFO[c.tipo].label },
    { id: 'valor', rotulo: 'Valor', valor: (c) => c.valorFinal, formato: 'moeda', somar: true },
    ...(tipoPend === 'entrega'
      ? ([
          { id: 'numeroPedido', rotulo: 'Nº pedido', valor: (c) => c.numeroPedido },
          { id: 'dataPedido', rotulo: 'Pedido em', valor: (c) => c.dataPedido, formato: 'data' },
          {
            id: 'previsao',
            rotulo: 'Entrega prevista',
            valor: (c) => c.previsaoEntrega,
            render: (c) => (
              <span className={c.entregaAtrasada ? 'text-red-400 font-medium inline-flex items-center gap-1' : ''}>
                {c.entregaAtrasada && <AlertTriangle size={13} />}
                {dataBr(c.previsaoEntrega)}
                {c.entregaAtrasada ? ` (${c.diasAtraso}d)` : ''}
              </span>
            ),
          },
        ] as Coluna<Pend>[])
      : ([{ id: 'dias', rotulo: 'Esperando há (dias)', valor: (c) => c.diasNaEtapa, formato: 'numero' }] as Coluna<Pend>[])),
  ]

  const filtros = (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-36">
        <Input label="De" type="month" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} />
      </div>
      <div className="w-36">
        <Input label="Até" type="month" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} />
      </div>
      <div className="w-52">
        <Select label="Empresa" value={empresaId} onChange={(e) => setEmpresaId(e.target.value ? Number(e.target.value) : '')} options={(aux?.empresas ?? []).map((e) => ({ value: e.id, label: e.nome }))} placeholder="Todas" />
      </div>
      <div className="w-44">
        <Select
          label="Tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as '' | 'revenda' | 'uso_consumo')}
          options={[
            { value: 'revenda', label: 'Revenda' },
            { value: 'uso_consumo', label: 'Uso e Consumo' },
          ]}
          placeholder="Os dois"
        />
      </div>
      <div className="w-52">
        <Select label="Fornecedor" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value ? Number(e.target.value) : '')} options={(aux?.fornecedores ?? []).map((f) => ({ value: f.id, label: f.nome }))} placeholder="Todos" />
      </div>
      <div className="w-52">
        <Select label="Categoria" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : '')} options={(aux?.categorias ?? []).map((c) => ({ value: c.id, label: c.nome }))} placeholder="Todas" />
      </div>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <FileBarChart size={20} className="text-gold-400" />
        <div>
          <h1 className="font-heading text-xl text-dark-50">Relatórios de Compras</h1>
          <p className="text-sm text-dark-400">Por mês, fornecedor e categoria — conta a compra no mês da data do pedido, pelo valor final. Exporta pra Excel.</p>
        </div>
      </div>

      <Abas<Aba>
        valor={aba}
        onChange={setAba}
        opcoes={[
          { valor: 'mes', rotulo: 'Por mês' },
          { valor: 'fornecedor', rotulo: 'Por fornecedor' },
          { valor: 'categoria', rotulo: 'Por categoria' },
          { valor: 'empresa', rotulo: 'Por empresa' },
          { valor: 'compras', rotulo: 'Compra a compra' },
          { valor: 'pendencias', rotulo: 'Pendências' },
        ]}
      />

      {aba !== 'pendencias' && (
        <>
          {filtros}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard titulo="Total no período" valor={moeda((r?.totais.revenda ?? 0) + (r?.totais.usoConsumo ?? 0))} detalhe={`${r?.totais.qtd ?? 0} compra(s)`} />
            <KpiCard titulo="Revenda" cor={TIPO_INFO.revenda.cor} valor={moeda(r?.totais.revenda)} />
            <KpiCard titulo="Uso e Consumo" cor={TIPO_INFO.uso_consumo.cor} valor={moeda(r?.totais.usoConsumo)} />
            <KpiCard titulo="Economia negociando" cor="#22a861" valor={moeda(r?.totais.economia)} />
          </div>
        </>
      )}

      {aba === 'mes' && (
        <TabelaDados id="compras-por-mes" linhas={r?.porMes} colunas={colunasGrupo('Mês', true)} chave={(g) => g.chave} nomeArquivo="compras-por-mes.csv" ordemInicial={{ coluna: 'nome', direcao: 'asc' }} carregando={isLoading} />
      )}
      {aba === 'fornecedor' && (
        <TabelaDados
          id="compras-por-fornecedor"
          linhas={r?.porFornecedor}
          colunas={colunasGrupo('Fornecedor')}
          chave={(g) => g.chave}
          buscaEm={(g) => g.nome}
          nomeArquivo="compras-por-fornecedor.csv"
          ordemInicial={{ coluna: 'total', direcao: 'desc' }}
          carregando={isLoading}
        />
      )}
      {aba === 'categoria' && (
        <TabelaDados
          id="compras-por-categoria"
          linhas={r?.porCategoria}
          colunas={colunasGrupo('Categoria')}
          chave={(g) => g.chave}
          buscaEm={(g) => g.nome}
          nomeArquivo="compras-por-categoria.csv"
          ordemInicial={{ coluna: 'total', direcao: 'desc' }}
          carregando={isLoading}
        />
      )}
      {aba === 'empresa' && (
        <TabelaDados id="compras-por-empresa" linhas={r?.porEmpresa} colunas={colunasGrupo('Empresa')} chave={(g) => g.chave} nomeArquivo="compras-por-empresa.csv" ordemInicial={{ coluna: 'total', direcao: 'desc' }} carregando={isLoading} />
      )}
      {aba === 'compras' && (
        <TabelaDados
          id="compras-lista"
          linhas={r?.compras}
          colunas={colunasCompras}
          chave={(c) => c.id}
          buscaEm={(c) => `${c.id} ${c.titulo} ${c.fornecedorNome ?? ''} ${c.categoriaNome ?? ''} ${c.numeroPedido ?? ''} ${c.solicitanteNome}`}
          nomeArquivo="compras-lista.csv"
          link={(c) => `${base}/compras/${c.id}`}
          ordemInicial={{ coluna: 'dataPedido', direcao: 'desc' }}
          carregando={isLoading}
        />
      )}
      {aba === 'pendencias' && (
        <div className="space-y-4">
          <Secao titulo={`Aprovações pendentes (${pend?.aprovacoes.length ?? 0})`} acoes={<Link to={`${base}/compras-aprovar`} className="text-xs text-gold-400 hover:underline">Abrir aprovações</Link>}>
            <TabelaDados id="compras-pend-aprov" linhas={pend?.aprovacoes} colunas={colunasPend('aprovacao')} chave={(c) => c.id} nomeArquivo="compras-aprovacoes-pendentes.csv" link={(c) => `${base}/compras/${c.id}`} simples carregando={carregandoPend} vazio="Nada esperando aprovação." />
          </Secao>
          <Secao titulo={`Aprovadas, falta emitir o pedido (${pend?.pedidosAEmitir.length ?? 0})`}>
            <TabelaDados id="compras-pend-pedido" linhas={pend?.pedidosAEmitir} colunas={colunasPend('pedido')} chave={(c) => c.id} nomeArquivo="compras-pedidos-a-emitir.csv" link={(c) => `${base}/compras/${c.id}`} simples carregando={carregandoPend} vazio="Nenhuma." />
          </Secao>
          <Secao titulo={`Entregas pendentes (${pend?.entregas.length ?? 0})`} subtitulo={pend?.entregas.some((e) => e.entregaAtrasada) ? `${pend.entregas.filter((e) => e.entregaAtrasada).length} atrasada(s)` : undefined}>
            <TabelaDados id="compras-pend-entregas" linhas={pend?.entregas} colunas={colunasPend('entrega')} chave={(c) => c.id} nomeArquivo="compras-entregas-pendentes.csv" link={(c) => `${base}/compras/${c.id}`} simples carregando={carregandoPend} vazio="Nenhuma entrega pendente." />
          </Secao>
        </div>
      )}
    </div>
  )
}
