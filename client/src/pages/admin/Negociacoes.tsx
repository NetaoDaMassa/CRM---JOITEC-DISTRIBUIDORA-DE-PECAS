import { useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Download, MessageCircle, Phone, Mail } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import CobrancaModal from '../../components/CobrancaModal'
import NegociacaoStatusModal from '../../components/NegociacaoStatusModal'
import { paraCsv, baixarCsv } from '../../lib/csv'

function formatarMoeda(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(d: string): string {
  const [data] = d.replace(' ', 'T').split('T')
  const [ano, mes, dia] = data.split('-')
  return `${dia}/${mes}/${ano}`
}

const CANAL_ICONE: Record<string, typeof MessageCircle> = { whatsapp: MessageCircle, ligacao: Phone, email: Mail }
const CANAL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', ligacao: 'Ligação', email: 'E-mail' }

const ABAS = [
  { id: 'cobrancas', label: 'Cobrança do dia' },
  { id: 'cartorio', label: 'Cartório' },
  { id: 'rc', label: 'Enviados à RC' },
] as const
type Aba = (typeof ABAS)[number]['id']

const STATUS_CARTORIO = [
  { value: 'aguardando', label: 'Aguardando cartório', cor: 'text-dark-400 bg-dark-700/40 border-dark-600' },
  { value: 'voltou_cobrar', label: 'Voltou — cobrar', cor: 'text-red-400 bg-red-900/20 border-red-700/40' },
  { value: 'cobranca_feita', label: 'Cobrança feita', cor: 'text-green-400 bg-green-900/20 border-green-700/40' },
]

const STATUS_RC = [
  { value: 'em_negociacao', label: 'Em negociação', cor: 'text-orange-400 bg-orange-900/20 border-orange-700/40' },
  { value: 'acordo_fechado', label: 'Acordo fechado', cor: 'text-green-400 bg-green-900/20 border-green-700/40' },
  { value: 'nao_fechou', label: 'Não fechou', cor: 'text-red-400 bg-red-900/20 border-red-700/40' },
]

function SeletorAba({ aba, onChange }: { aba: Aba; onChange: (a: Aba) => void }) {
  return (
    <div className="inline-flex bg-dark-800 border border-dark-600 rounded-xl p-1 gap-1">
      {ABAS.map((a) => (
        <button
          key={a.id}
          onClick={() => onChange(a.id)}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            aba === a.id ? 'bg-gold-600 text-dark-950' : 'text-dark-300 hover:text-dark-100'
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

function AbaCobrancas() {
  const { data } = trpc.negociacoes.cobrancasListar.useQuery()
  const [modalAberto, setModalAberto] = useState(false)
  const utils = trpc.useUtils()
  const excluirMut = trpc.negociacoes.cobrancaExcluir.useMutation({
    onSuccess: () => utils.negociacoes.cobrancasListar.invalidate(),
    onError: (e) => toast.error(e.message),
  })

  function exportarCsv() {
    if (!data) return
    baixarCsv(
      'cobrancas.csv',
      paraCsv(
        [
          { chave: 'data', rotulo: 'Data/hora' },
          { chave: 'cliente', rotulo: 'Cliente' },
          { chave: 'canal', rotulo: 'Canal' },
          { chave: 'retorno', rotulo: 'Retorno do cliente' },
        ],
        data.map((c) => ({ data: c.createdAt, cliente: c.cliente.razaoSocial, canal: CANAL_LABEL[c.canal], retorno: c.retornoCliente }))
      )
    )
  }

  if (!data) return <p className="text-dark-500">Carregando...</p>

  return (
    <div>
      <div className="flex justify-end gap-2 mb-4">
        <Button variant="secondary" onClick={exportarCsv}>
          <Download size={16} /> Exportar CSV
        </Button>
        <Button onClick={() => setModalAberto(true)}>
          <Plus size={16} /> Nova cobrança
        </Button>
      </div>
      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700 text-left text-xs text-dark-500 uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Data/hora</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Canal</th>
                <th className="px-4 py-3 font-medium">Retorno do cliente</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => {
                const Icone = CANAL_ICONE[c.canal]
                return (
                  <tr key={c.id} className="border-b border-dark-700 last:border-0 hover:bg-dark-700/40">
                    <td className="px-4 py-3 text-dark-400 font-mono whitespace-nowrap">{formatarData(c.createdAt)}</td>
                    <td className="px-4 py-3 text-dark-100 font-medium">{c.cliente.razaoSocial}</td>
                    <td className="px-4 py-3 text-dark-300">
                      <span className="inline-flex items-center gap-1.5">
                        <Icone size={13} /> {CANAL_LABEL[c.canal]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-dark-300">{c.retornoCliente}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => excluirMut.mutate({ id: c.id })} className="text-dark-600 hover:text-red-400 text-xs">
                        Excluir
                      </button>
                    </td>
                  </tr>
                )
              })}
              {data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-dark-500">
                    Nenhuma cobrança registrada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <CobrancaModal open={modalAberto} onClose={() => setModalAberto(false)} />
    </div>
  )
}

type LinhaStatus = { id: number; valor: number | null; enviadoEm: string; status: string; cliente: { id: number; razaoSocial: string } }
type StatusOpcao = { value: string; label: string; cor: string }

// Visual compartilhado por Cartório e RC (mesma forma de dado, só muda o
// enum de status) — cada aba concreta abaixo chama seus próprios hooks
// tipados e passa callbacks já resolvidos, evitando misturar dois tipos de
// mutation num hook só (o union quebra a inferência do `.mutate`).
function TabelaStatus({
  titulo,
  rotuloEnviado,
  statusConfig,
  dados,
  criando,
  onCriar,
  onAtualizarStatus,
  onExcluir,
  onExportar,
}: {
  titulo: string
  rotuloEnviado: string
  statusConfig: StatusOpcao[]
  dados: LinhaStatus[]
  criando: boolean
  onCriar: (input: { clienteId: number; valor?: number; enviadoEm: string; observacoes?: string }, aoTerminar: () => void) => void
  onAtualizarStatus: (id: number, status: string) => void
  onExcluir: (id: number) => void
  onExportar: () => void
}) {
  const [modalAberto, setModalAberto] = useState(false)

  return (
    <div>
      <div className="flex justify-end gap-2 mb-4">
        <Button variant="secondary" onClick={onExportar}>
          <Download size={16} /> Exportar CSV
        </Button>
        <Button onClick={() => setModalAberto(true)}>
          <Plus size={16} /> Novo
        </Button>
      </div>
      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700 text-left text-xs text-dark-500 uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Valor</th>
                <th className="px-4 py-3 font-medium">{rotuloEnviado}</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {dados.map((r) => (
                <tr key={r.id} className="border-b border-dark-700 last:border-0 hover:bg-dark-700/40">
                  <td className="px-4 py-3 text-dark-100 font-medium">{r.cliente.razaoSocial}</td>
                  <td className="px-4 py-3 text-dark-400 font-mono">{formatarMoeda(r.valor)}</td>
                  <td className="px-4 py-3 text-dark-400 font-mono">{formatarData(r.enviadoEm)}</td>
                  <td className="px-4 py-3">
                    <select
                      value={r.status}
                      onChange={(e) => onAtualizarStatus(r.id, e.target.value)}
                      className={`text-xs font-semibold rounded-full px-2.5 py-1 border cursor-pointer focus:outline-none ${
                        statusConfig.find((s) => s.value === r.status)?.cor
                      }`}
                    >
                      {statusConfig.map((s) => (
                        <option key={s.value} value={s.value} className="bg-dark-800 text-dark-100">
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => onExcluir(r.id)} className="text-dark-600 hover:text-red-400 text-xs">
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
              {dados.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-dark-500">
                    Nenhum cliente cadastrado aqui ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <NegociacaoStatusModal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        titulo={titulo}
        criando={criando}
        onCriar={(input) => onCriar(input, () => setModalAberto(false))}
      />
    </div>
  )
}

function exportarNegociacaoCsv(nomeArquivo: string, rotuloEnviado: string, statusConfig: StatusOpcao[], dados: LinhaStatus[]) {
  baixarCsv(
    nomeArquivo,
    paraCsv(
      [
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'valor', rotulo: 'Valor' },
        { chave: 'enviadoEm', rotulo: rotuloEnviado },
        { chave: 'status', rotulo: 'Status' },
      ],
      dados.map((r) => ({
        cliente: r.cliente.razaoSocial,
        valor: r.valor ?? '',
        enviadoEm: formatarData(r.enviadoEm),
        status: statusConfig.find((s) => s.value === r.status)?.label ?? r.status,
      }))
    )
  )
}

function AbaCartorio() {
  const utils = trpc.useUtils()
  const { data } = trpc.negociacoes.cartorioListar.useQuery()
  const criarMut = trpc.negociacoes.cartorioCriar.useMutation()
  const atualizarStatusMut = trpc.negociacoes.cartorioAtualizarStatus.useMutation()
  const excluirMut = trpc.negociacoes.cartorioExcluir.useMutation()
  const invalidar = () => utils.negociacoes.cartorioListar.invalidate()

  if (!data) return <p className="text-dark-500">Carregando...</p>

  return (
    <TabelaStatus
      titulo="Cliente no Cartório"
      rotuloEnviado="Enviado ao cartório"
      statusConfig={STATUS_CARTORIO}
      dados={data}
      criando={criarMut.isPending}
      onExportar={() => exportarNegociacaoCsv('cartorio.csv', 'Enviado ao cartório', STATUS_CARTORIO, data)}
      onCriar={(input, aoTerminar) =>
        criarMut.mutate(input, {
          onSuccess() {
            toast.success('Registrado')
            invalidar()
            aoTerminar()
          },
          onError: (e) => toast.error(e.message),
        })
      }
      onAtualizarStatus={(id, status) =>
        atualizarStatusMut.mutate(
          { id, status: status as 'aguardando' | 'voltou_cobrar' | 'cobranca_feita' },
          { onSuccess: invalidar, onError: (err) => toast.error(err.message) }
        )
      }
      onExcluir={(id) => excluirMut.mutate({ id }, { onSuccess: invalidar, onError: (err) => toast.error(err.message) })}
    />
  )
}

function AbaRc() {
  const utils = trpc.useUtils()
  const { data } = trpc.negociacoes.rcListar.useQuery()
  const criarMut = trpc.negociacoes.rcCriar.useMutation()
  const atualizarStatusMut = trpc.negociacoes.rcAtualizarStatus.useMutation()
  const excluirMut = trpc.negociacoes.rcExcluir.useMutation()
  const invalidar = () => utils.negociacoes.rcListar.invalidate()

  if (!data) return <p className="text-dark-500">Carregando...</p>

  return (
    <TabelaStatus
      titulo="Cliente enviado à RC"
      rotuloEnviado="Enviado à RC"
      statusConfig={STATUS_RC}
      dados={data}
      criando={criarMut.isPending}
      onExportar={() => exportarNegociacaoCsv('rc.csv', 'Enviado à RC', STATUS_RC, data)}
      onCriar={(input, aoTerminar) =>
        criarMut.mutate(input, {
          onSuccess() {
            toast.success('Registrado')
            invalidar()
            aoTerminar()
          },
          onError: (e) => toast.error(e.message),
        })
      }
      onAtualizarStatus={(id, status) =>
        atualizarStatusMut.mutate(
          { id, status: status as 'em_negociacao' | 'acordo_fechado' | 'nao_fechou' },
          { onSuccess: invalidar, onError: (err) => toast.error(err.message) }
        )
      }
      onExcluir={(id) => excluirMut.mutate({ id }, { onSuccess: invalidar, onError: (err) => toast.error(err.message) })}
    />
  )
}

// Financeiro > Negociações — 3 planilhas do dia a dia de cobrança, pedido
// do João: log de quem foi cobrado (WhatsApp/ligação/e-mail), clientes no
// Cartório (pra lembrar de cobrar quando voltarem) e clientes enviados pra
// assessoria RC (até fechar acordo ou não). Todas em formato de planilha —
// decidido depois de comparar com Kanban.
export default function Negociacoes() {
  const [aba, setAba] = useState<Aba>('cobrancas')

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="font-heading text-2xl text-dark-50 font-bold">Negociações</h1>
        <p className="text-sm text-dark-400 mt-0.5">Cobrança do dia a dia, clientes no Cartório e enviados à RC.</p>
      </div>

      <div className="mb-5">
        <SeletorAba aba={aba} onChange={setAba} />
      </div>

      {aba === 'cobrancas' && <AbaCobrancas />}
      {aba === 'cartorio' && <AbaCartorio />}
      {aba === 'rc' && <AbaRc />}
    </div>
  )
}
