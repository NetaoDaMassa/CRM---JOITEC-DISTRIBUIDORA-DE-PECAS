// Bloco "Equipes" do Dashboard Odin — pedido do João, 2026-10-19: cada
// equipe da Odin Compressores vende de um jeito, e o dashboard mostra o
// trabalho de cada vendedor do jeito dele:
//   Externos (máquinas): visitas → propostas → vendas
//   Internos leads:      leads → propostas → vendas
//   Internos peças:      contatos/ligações → atendimento/proposta → vendas
// Gestor vê as 3 equipes (abas); vendedor vê só o próprio funil.
// Regras de contagem no server (dashboardOdin.equipes).
import { useState } from 'react'
import { MapPin, FileText, Handshake, Inbox, Phone, MessageCircle, Users, Calculator, Truck, Package } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../../lib/trpc'
import { formatarMoeda } from '../../lib/moeda'
import AvatarMeta from '../ui/AvatarMeta'

type Equipes = inferRouterOutputs<AppRouter>['dashboardOdin']['equipes']
type Aba = 'externos' | 'leads' | 'pecas'

const ABAS: { key: Aba; label: string; sub: string; icon: React.ReactNode }[] = [
  { key: 'externos', label: 'Externos · Máquinas', sub: 'visitas → propostas → vendas', icon: <Truck size={15} /> },
  { key: 'leads', label: 'Internos · Leads', sub: 'leads → propostas → vendas', icon: <Inbox size={15} /> },
  { key: 'pecas', label: 'Internos · Peças', sub: 'contatos → atendimento/proposta → vendas', icon: <Package size={15} /> },
]

function money(v: number) {
  return formatarMoeda(v, { casas: 0 })
}

function Etapa({ label, valor, sub, icon, cor }: { label: string; valor: string | number; sub?: string; icon: React.ReactNode; cor: string }) {
  return (
    <div className="flex-1 min-w-[150px] bg-dark-900/60 border border-dark-600 rounded-xl p-3 flex items-center gap-3">
      <div className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center ${cor}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-dark-50 leading-tight font-mono tabular-nums">{valor}</p>
        <p className="text-xs text-dark-400 leading-tight">{label}</p>
        {sub && <p className="text-[11px] text-dark-500 truncate">{sub}</p>}
      </div>
    </div>
  )
}

function Seta() {
  return <span className="hidden md:block self-center text-dark-600 text-lg">→</span>
}

const COR = {
  visita: 'bg-indigo-900/40 text-indigo-300',
  lead: 'bg-violet-900/40 text-violet-300',
  contato: 'bg-amber-900/40 text-amber-300',
  atendimento: 'bg-sky-900/40 text-sky-300',
  proposta: 'bg-blue-900/40 text-blue-300',
  venda: 'bg-emerald-900/40 text-emerald-300',
}

function soma<T>(l: T[], f: (x: T) => number) {
  return l.reduce((a, x) => a + f(x), 0)
}

function FunilExternos({ l }: { l: Equipes['externos'] }) {
  return (
    <div className="flex gap-2 flex-wrap">
      <Etapa label="Visitas" valor={soma(l, (x) => x.visitas)} sub={`${soma(l, (x) => x.visitasGps)} com GPS · ${soma(l, (x) => x.visitasManual)} manual`} icon={<MapPin size={18} />} cor={COR.visita} />
      <Seta />
      <Etapa label="Propostas" valor={soma(l, (x) => x.propostas)} icon={<FileText size={18} />} cor={COR.proposta} />
      <Seta />
      <Etapa label="Vendas" valor={soma(l, (x) => x.vendas)} sub={money(soma(l, (x) => x.valorVendas))} icon={<Handshake size={18} />} cor={COR.venda} />
    </div>
  )
}

function FunilLeads({ l }: { l: Equipes['leads'] }) {
  return (
    <div className="flex gap-2 flex-wrap">
      <Etapa label="Leads recebidos" valor={soma(l, (x) => x.leadsRecebidos)} icon={<Inbox size={18} />} cor={COR.lead} />
      <Seta />
      <Etapa label="Propostas" valor={soma(l, (x) => x.propostas)} icon={<FileText size={18} />} cor={COR.proposta} />
      <Seta />
      <Etapa label="Vendas" valor={soma(l, (x) => x.vendas)} sub={money(soma(l, (x) => x.valorVendas))} icon={<Handshake size={18} />} cor={COR.venda} />
    </div>
  )
}

function FunilPecas({ l }: { l: Equipes['pecas'] }) {
  return (
    <div className="flex gap-2 flex-wrap">
      <Etapa label="Contatos" valor={soma(l, (x) => x.contatos)} sub={`${soma(l, (x) => x.ligacoes)} ligações · ${soma(l, (x) => x.whatsapp)} WhatsApp`} icon={<Phone size={18} />} cor={COR.contato} />
      <Seta />
      <Etapa label="Clientes atendidos" valor={soma(l, (x) => x.clientesAtendidos)} icon={<Users size={18} />} cor={COR.atendimento} />
      <Etapa label="Propostas" valor={soma(l, (x) => x.propostas)} icon={<FileText size={18} />} cor={COR.proposta} />
      <Etapa
        label="Orçamentos em aberto"
        valor={soma(l, (x) => x.orcamentosAbertos)}
        sub={`${money(soma(l, (x) => x.valorOrcamentosAbertos))} · agora`}
        icon={<Calculator size={18} />}
        cor={COR.atendimento}
      />
      <Seta />
      <Etapa label="Vendas" valor={soma(l, (x) => x.vendas)} sub={money(soma(l, (x) => x.valorVendas))} icon={<Handshake size={18} />} cor={COR.venda} />
    </div>
  )
}

function Th({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return <th className={`${left ? 'text-left px-4' : 'text-right px-3'} py-2.5 font-semibold`}>{children}</th>
}
function Td({ children, cor = 'text-dark-100', left }: { children: React.ReactNode; cor?: string; left?: boolean }) {
  return <td className={`${left ? 'text-left px-4' : 'text-right px-3'} py-2.5 font-mono tabular-nums ${cor}`}>{children}</td>
}
function Vendedor({ nome, fotoUrl }: { nome: string; fotoUrl: string | null }) {
  return (
    <td className="px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <AvatarMeta nome={nome} fotoUrl={fotoUrl} size="sm" />
        <span className="font-medium text-dark-100">{nome}</span>
      </div>
    </td>
  )
}

function Tabela({ aba, data }: { aba: Aba; data: Equipes }) {
  const head = 'border-b border-dark-600 text-dark-400 text-[11px] uppercase tracking-wide'
  if (aba === 'externos') {
    return (
      <table className="w-full text-sm min-w-[720px]">
        <thead><tr className={head}><Th left>Vendedor</Th><Th>Visitas</Th><Th>Com GPS</Th><Th>Manual</Th><Th>Propostas</Th><Th>Vendas</Th><Th>Valor vendido</Th></tr></thead>
        <tbody className="divide-y divide-dark-700/60">
          {data.externos.map((v) => (
            <tr key={v.id}>
              <Vendedor nome={v.nome} fotoUrl={v.fotoUrl} />
              <Td cor="text-dark-50 font-semibold">{v.visitas}</Td>
              <Td cor="text-green-400">{v.visitasGps}</Td>
              <Td cor="text-amber-400">{v.visitasManual}</Td>
              <Td cor="text-dark-50 font-semibold">{v.propostas}</Td>
              <Td cor="text-emerald-400 font-semibold">{v.vendas}</Td>
              <Td>{money(v.valorVendas)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (aba === 'leads') {
    return (
      <table className="w-full text-sm min-w-[600px]">
        <thead><tr className={head}><Th left>Vendedor</Th><Th>Leads recebidos</Th><Th>Propostas</Th><Th>Vendas</Th><Th>Valor vendido</Th></tr></thead>
        <tbody className="divide-y divide-dark-700/60">
          {data.leads.map((v) => (
            <tr key={v.id}>
              <Vendedor nome={v.nome} fotoUrl={v.fotoUrl} />
              <Td cor="text-dark-50 font-semibold">{v.leadsRecebidos}</Td>
              <Td cor="text-dark-50 font-semibold">{v.propostas}</Td>
              <Td cor="text-emerald-400 font-semibold">{v.vendas}</Td>
              <Td>{money(v.valorVendas)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return (
    <table className="w-full text-sm min-w-[860px]">
      <thead><tr className={head}><Th left>Vendedor</Th><Th>Contatos</Th><Th>Ligações</Th><Th>WhatsApp</Th><Th>Clientes atendidos</Th><Th>Propostas</Th><Th>Orçamentos abertos</Th><Th>Vendas</Th><Th>Valor vendido</Th></tr></thead>
      <tbody className="divide-y divide-dark-700/60">
        {data.pecas.map((v) => (
          <tr key={v.id}>
            <Vendedor nome={v.nome} fotoUrl={v.fotoUrl} />
            <Td cor="text-dark-50 font-semibold">{v.contatos}</Td>
            <Td cor="text-dark-300">{v.ligacoes}</Td>
            <Td cor="text-dark-300">{v.whatsapp}</Td>
            <Td cor="text-dark-50 font-semibold">{v.clientesAtendidos}</Td>
            <Td cor="text-dark-50 font-semibold">{v.propostas}</Td>
            <Td cor="text-dark-300">{v.orcamentosAbertos} · {money(v.valorOrcamentosAbertos)}</Td>
            <Td cor="text-emerald-400 font-semibold">{v.vendas}</Td>
            <Td>{money(v.valorVendas)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function EquipesOdin({ dataDe, dataAte, isAdmin }: { dataDe?: string; dataAte?: string; isAdmin: boolean }) {
  const { data, isLoading } = trpc.dashboardOdin.equipes.useQuery({ dataDe, dataAte })
  const [aba, setAba] = useState<Aba>('externos')

  if (isLoading || !data) return null
  const periodo = `${data.dataDe.split('-').reverse().join('/')} a ${data.dataAte.split('-').reverse().join('/')}`

  // Vendedor: só o próprio funil, do jeito da equipe dele.
  if (!isAdmin) {
    const minha: Aba | null = data.externos.length ? 'externos' : data.leads.length ? 'leads' : data.pecas.length ? 'pecas' : null
    if (!minha) return null
    const info = ABAS.find((a) => a.key === minha)!
    return (
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h2 className="text-sm font-semibold text-gold-400 flex items-center gap-2">{info.icon} Meu trabalho · {info.label}</h2>
          <span className="text-xs text-dark-500">{periodo}</span>
        </div>
        {minha === 'externos' && <FunilExternos l={data.externos} />}
        {minha === 'leads' && <FunilLeads l={data.leads} />}
        {minha === 'pecas' && <FunilPecas l={data.pecas} />}
      </div>
    )
  }

  const qtd: Record<Aba, number> = { externos: data.externos.length, leads: data.leads.length, pecas: data.pecas.length }
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gold-400 flex items-center gap-2"><Users size={16} /> Equipes de venda</h2>
        <span className="text-xs text-dark-500">{periodo}</span>
      </div>

      <div className="flex gap-1 rounded-xl bg-dark-900 border border-dark-600 p-1 w-fit flex-wrap">
        {ABAS.map((a) => (
          <button
            key={a.key}
            onClick={() => setAba(a.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${
              aba === a.key ? 'bg-gold-600 text-dark-950' : 'text-dark-400 hover:text-dark-200'
            }`}
          >
            {a.icon} {a.label} <span className={`text-[11px] ${aba === a.key ? 'text-dark-900' : 'text-dark-500'}`}>({qtd[a.key]})</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-dark-500 -mt-2">{ABAS.find((a) => a.key === aba)!.sub}</p>

      {aba === 'externos' && <FunilExternos l={data.externos} />}
      {aba === 'leads' && <FunilLeads l={data.leads} />}
      {aba === 'pecas' && <FunilPecas l={data.pecas} />}

      <div className="overflow-x-auto border border-dark-600 rounded-xl">
        <Tabela aba={aba} data={data} />
      </div>
      <p className="text-[11px] text-dark-500">
        Equipe de cada pessoa = "Canal de venda (equipe)" em Usuários. Vendas de externos/leads = pedidos criados no período (não cancelados); vendas de peças = vendas
        registradas no Kanban. Orçamentos em aberto = cards em Negociação agora.
      </p>
    </div>
  )
}
