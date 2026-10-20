import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Clock, Inbox, Repeat } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { Input } from '../../../components/ui/Input'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { formatarDataCurta } from '../../../components/relatorios/filtros'
import { Abas, Etiqueta, KpiCard, MiniNumero, Ranking, Secao, numero, pct } from '../../../components/relatorios/blocos'
import TabelaDados from '../../../components/relatorios/TabelaDados'
import type { Coluna } from '../../../components/relatorios/TabelaDados'
import { horasUteis } from './base'
import type { FiltrosLeads, Metricas } from './base'

// ── Metas do mês ────────────────────────────────────────────────────────
// Mesma tabela de metas de antes (metas_marketing, também usada no Painel
// de TV), comparada com os números do relatório novo.
export function MetasDoMes({ f, m }: { f: FiltrosLeads; m: Metricas }) {
  const [editar, setEditar] = useState(false)
  const mesmoMes = f.inicio.slice(0, 7) === f.fim.slice(0, 7)
  const mesReferencia = `${f.inicio.slice(0, 7)}-01`
  const { data: meta } = trpc.leadsRelatorios.metaGeral.useQuery({ mesReferencia }, { enabled: mesmoMes })
  if (!mesmoMes) return null

  const itens = [
    { rotulo: 'Taxa de conversão', atual: m.conversao, meta: meta?.metaTaxaConversaoPct, fmt: (v: number) => pct(v), maior: true },
    { rotulo: 'Tempo até o 1º contato', atual: m.primeiroContatoHoras, meta: meta?.metaAtendimentoRapidoHoras, fmt: (v: number) => horasUteis(v), maior: false },
    { rotulo: 'Clientes ganhos', atual: m.qtdVendas, meta: meta?.metaClientesAbertos, fmt: (v: number) => numero(Math.round(v)), maior: true },
  ]
  const [ano, mes] = f.inicio.split('-')

  return (
    <Secao
      titulo={`Metas de ${mes}/${ano}`}
      subtitulo="Comparadas com os números acima (com todos os filtros aplicados)"
      acoes={
        <button type="button" className="text-sm text-gold-500 hover:text-gold-400 print:hidden" onClick={() => setEditar(true)}>
          {meta ? 'Editar metas' : 'Definir metas'}
        </button>
      }
    >
      <div className="grid sm:grid-cols-3 gap-3">
        {itens.map((i) => {
          const bateu = i.meta == null ? null : i.maior ? i.atual >= i.meta : i.atual <= i.meta
          return (
            <KpiCard
              key={i.rotulo}
              titulo={i.rotulo}
              valor={i.fmt(i.atual)}
              destaque={bateu === null ? undefined : bateu ? 'bom' : 'ruim'}
              detalhe={i.meta == null ? 'Meta não definida' : `${bateu ? '✅ Bateu a' : '⚠️ Abaixo da'} meta de ${i.fmt(i.meta)}`}
            />
          )
        })}
      </div>
      {editar && <EditarMetaModal onClose={() => setEditar(false)} mesReferencia={mesReferencia} metaAtual={meta ?? null} />}
    </Secao>
  )
}

function EditarMetaModal({
  onClose,
  mesReferencia,
  metaAtual,
}: {
  onClose: () => void
  mesReferencia: string
  metaAtual: { metaTaxaConversaoPct: number | null; metaAtendimentoRapidoHoras: number | null; metaClientesAbertos: number | null } | null
}) {
  const utils = trpc.useUtils()
  const [taxaConversao, setTaxaConversao] = useState(metaAtual?.metaTaxaConversaoPct?.toString() ?? '')
  const [atendimentoRapido, setAtendimentoRapido] = useState(metaAtual?.metaAtendimentoRapidoHoras?.toString() ?? '')
  const [clientes, setClientes] = useState(metaAtual?.metaClientesAbertos?.toString() ?? '')
  const mut = trpc.leadsRelatorios.definirMetaGeral.useMutation({
    onSuccess() {
      toast.success('Meta salva')
      utils.leadsRelatorios.metaGeral.invalidate()
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })
  return (
    <Modal open onClose={onClose} title="Metas de marketing do mês" size="sm">
      <div className="space-y-4">
        <Input label="Taxa de conversão (%)" type="number" step="0.1" value={taxaConversao} onChange={(e) => setTaxaConversao(e.target.value)} />
        <Input label="Atendimento rápido — até quantas horas úteis" type="number" step="0.5" value={atendimentoRapido} onChange={(e) => setAtendimentoRapido(e.target.value)} />
        <Input label="Clientes ganhos no mês (leads fechados)" type="number" step="1" value={clientes} onChange={(e) => setClientes(e.target.value)} />
        <Button
          className="w-full"
          loading={mut.isPending}
          onClick={() =>
            mut.mutate({
              mesReferencia,
              metaTaxaConversaoPct: taxaConversao ? Number(taxaConversao) : undefined,
              metaAtendimentoRapidoHoras: atendimentoRapido ? Number(atendimentoRapido) : undefined,
              metaClientesAbertos: clientes ? Number(clientes) : undefined,
            })
          }
        >
          Salvar metas
        </Button>
      </div>
    </Modal>
  )
}

// ── Atendimento agora (antigo "SLA") ────────────────────────────────────
// Foto do momento — não depende do período nem dos filtros.
export function AtendimentoAgora() {
  const { data, isLoading } = trpc.leadsRelatorios.slaOverview.useQuery(undefined, { refetchInterval: 30000 })
  if (isLoading || !data) return <div className="h-64 bg-dark-800 rounded-2xl animate-pulse" />
  const emRisco = data.overdueByVendor.reduce((s, v) => s + v.emRisco, 0)
  const critico = data.overdueByVendor.reduce((s, v) => s + v.critico, 0)
  return (
    <div className="space-y-5">
      <p className="text-xs text-dark-400">Foto de agora — não muda com as datas nem com os filtros. Atualiza sozinho a cada 30 segundos.</p>
      {data.criticalAlertVendors.map((v) => (
        <div key={v.vendorId ?? v.name} className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          <AlertTriangle size={16} /> {v.name} tem {v.critico} leads críticos ao mesmo tempo
        </div>
      ))}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiniNumero icone={AlertTriangle} cor="#e5534b" valor={numero(critico)} rotulo="Leads críticos" ajuda="Já passaram do prazo de atendimento." />
        <MiniNumero icone={Clock} cor="#f2a516" valor={numero(emRisco)} rotulo="Leads em risco" ajuda="Estão quase estourando o prazo." />
        <MiniNumero icone={Inbox} cor="#0ea5a4" valor={horasUteis(data.avgTimeStuckByStage.overallHours)} rotulo="Tempo médio em Abordagem" ajuda="Horas úteis que os leads em Abordagem estão parados nessa etapa." />
        <MiniNumero icone={Repeat} cor="#8b5cf6" valor={numero(data.reassignmentHistory.reduce((s, v) => s + v.received, 0))} rotulo="Trocas de vendedor (total)" ajuda="Transferências manuais + reatribuições automáticas, desde o início." />
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <Secao titulo="Leads atrasados por vendedor">
          {data.overdueByVendor.length === 0 ? (
            <p className="text-sm text-dark-500">Nenhum lead em risco ou crítico agora. 👏</p>
          ) : (
            <ul className="divide-y divide-dark-700">
              {data.overdueByVendor.map((v) => (
                <li key={v.vendorId ?? v.name} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-100">{v.name}</span>
                  <span className="flex gap-1.5">
                    {v.emRisco > 0 && <Etiqueta cor="#f2a516">{v.emRisco} em risco</Etiqueta>}
                    {v.critico > 0 && <Etiqueta cor="#e5534b">{v.critico} crítico</Etiqueta>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
        <Secao titulo="Tempo parado em Abordagem" subtitulo="Média por vendedor, em horas úteis">
          <Ranking
            itens={[...data.avgTimeStuckByStage.byVendor].sort((a, b) => b.avgHours - a.avgHours).map((v) => ({ rotulo: v.name, valor: v.avgHours }))}
            formatar={(v) => horasUteis(v)}
            cor="#f2a516"
            vazio="Nenhum lead em Abordagem agora."
          />
        </Secao>
      </div>
      <Secao titulo="Trocas de vendedor" subtitulo="Recebeu = lead passado pra ele · Perdeu = lead dele passado pra outro">
        <TabelaDados
          id="leads-trocas-vendedor"
          linhas={data.reassignmentHistory}
          colunas={[
            { id: 'name', rotulo: 'Vendedor', valor: (v) => v.name, render: (v) => <span className="font-medium text-dark-50">{v.name}</span> },
            { id: 'received', rotulo: 'Recebeu', valor: (v) => v.received, formato: 'numero', somar: true },
            { id: 'lost', rotulo: 'Perdeu', valor: (v) => v.lost, formato: 'numero', somar: true },
          ]}
          chave={(v) => v.vendorId ?? v.name}
          nomeArquivo="leads-trocas-vendedor"
          ordemInicial={{ coluna: 'received', direcao: 'desc' }}
          simples
        />
      </Secao>
    </div>
  )
}

// ── Transferências ──────────────────────────────────────────────────────
const ACAO: Record<string, { rotulo: string; cor: string }> = {
  transferido: { rotulo: 'Transferido', cor: '#3b82f6' },
  reatribuicao_automatica: { rotulo: 'Reatribuição automática', cor: '#f2a516' },
  excluido: { rotulo: 'Excluído', cor: '#e5534b' },
}

export function Transferencias({ f, leadsBase }: { f: FiltrosLeads; leadsBase: string }) {
  const { data, isLoading } = trpc.leadsRelatorios.transferHistory.useQuery()
  const [acao, setAcao] = useState<'todos' | 'transferido' | 'reatribuicao_automatica' | 'excluido'>('todos')

  const linhas = useMemo(() => {
    const autoPorLead = new Map<number, number>()
    for (const h of data ?? []) if (h.action === 'reatribuicao_automatica') autoPorLead.set(h.leadId, (autoPorLead.get(h.leadId) ?? 0) + 1)
    return (data ?? [])
      .map((h) => {
        const quando = new Date(h.createdAt.replace(' ', 'T') + 'Z')
        const dataLocal = new Date(quando.getTime() - 3 * 3600000).toISOString().slice(0, 10)
        return { ...h, quando, dataLocal, voltas: autoPorLead.get(h.leadId) ?? 0 }
      })
      .filter((h) => h.dataLocal >= f.inicio && h.dataLocal <= f.fim)
  }, [data, f.inicio, f.fim])
  type L = (typeof linhas)[number]
  const visiveis = linhas.filter((h) => acao === 'todos' || h.action === acao)
  const contar = (a: string) => linhas.filter((h) => h.action === a).length

  const colunas: Coluna<L>[] = [
    { id: 'quando', rotulo: 'Quando', valor: (h) => h.quando.toISOString(), render: (h) => h.quando.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) },
    { id: 'acao', rotulo: 'O que aconteceu', valor: (h) => ACAO[h.action]?.rotulo ?? h.action, render: (h) => <Etiqueta cor={ACAO[h.action]?.cor ?? '#94a3b8'}>{ACAO[h.action]?.rotulo ?? h.action}</Etiqueta> },
    {
      id: 'lead',
      rotulo: 'Lead',
      valor: (h) => h.lead?.name ?? `Lead #${h.leadId}`,
      render: (h) => (
        <span className="text-dark-50">
          {h.lead?.name ?? `Lead #${h.leadId}`}
          {h.voltas >= 2 && (
            <span title={`Reatribuído automaticamente ${h.voltas}x — pode ser problema no rodízio`} className="ml-1.5">
              <Etiqueta cor="#e5534b">⚠️ {h.voltas}x</Etiqueta>
            </span>
          )}
        </span>
      ),
    },
    { id: 'de', rotulo: 'De', valor: (h) => h.fromVendor?.name ?? '—' },
    { id: 'para', rotulo: 'Para', valor: (h) => h.toVendor?.name ?? '—' },
    { id: 'quem', rotulo: 'Quem fez', valor: (h) => h.user?.name ?? 'Sistema (automático)' },
  ]

  return (
    <div className="space-y-4">
      <p className="text-xs text-dark-400">
        Trocas de vendedor entre {formatarDataCurta(f.inicio)} e {formatarDataCurta(f.fim)}. ⚠️ = lead que já voltou pro rodízio 2 vezes ou mais.
      </p>
      <Abas
        valor={acao}
        onChange={setAcao}
        opcoes={[
          { valor: 'todos', rotulo: 'Todos', contagem: linhas.length },
          { valor: 'reatribuicao_automatica', rotulo: 'Automáticas', contagem: contar('reatribuicao_automatica') },
          { valor: 'transferido', rotulo: 'Manuais', contagem: contar('transferido') },
          { valor: 'excluido', rotulo: 'Excluídos', contagem: contar('excluido') },
        ]}
      />
      <Secao titulo="Histórico">
        <TabelaDados
          id="leads-transferencias"
          linhas={visiveis}
          colunas={colunas}
          chave={(h) => h.id}
          buscaEm={(h) => `${h.lead?.name ?? ''} ${h.fromVendor?.name ?? ''} ${h.toVendor?.name ?? ''}`}
          placeholderBusca="Buscar lead ou vendedor..."
          nomeArquivo="leads-transferencias"
          link={(h) => (h.action !== 'excluido' ? `${leadsBase}/${h.leadId}` : undefined)}
          ordemInicial={{ coluna: 'quando', direcao: 'desc' }}
          carregando={isLoading}
        />
      </Secao>
    </div>
  )
}
