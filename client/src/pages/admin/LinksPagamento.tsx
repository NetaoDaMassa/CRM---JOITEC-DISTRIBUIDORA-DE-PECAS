import { useState } from 'react'
import { Copy } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'

type RouterOutputs = inferRouterOutputs<AppRouter>
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { formatDateTime } from '../../lib/utils'
import { formatarMoeda } from '../../lib/moeda'
import { BotoesLink, STATUS_LINK } from '../vendor/LinkPagamento'

// Links de pagamento — lado do financeiro (2026-11-13): vê os pedidos dos
// vendedores (todas as empresas), cria o link no beluíno e cola aqui.

type Aba = 'solicitado' | 'criado' | 'finalizado'

type Linha = RouterOutputs['linksPagamento']['listar'][number]

// Um campo com botão de copiar — o financeiro cola um por um no beluíno
// (João, 2026-11-16).
function Campo({ rotulo, valor, largo = false }: { rotulo: string; valor: string | number | null | undefined; largo?: boolean }) {
  const v = valor == null ? '' : String(valor)
  if (!v.trim()) return null
  return (
    <div className={`flex items-center gap-2 rounded-lg bg-dark-900/50 px-2 py-1 ${largo ? 'sm:col-span-2' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-dark-500">{rotulo}</p>
        <p className="text-xs text-dark-100 break-words whitespace-pre-wrap">{v}</p>
      </div>
      <button
        type="button"
        title={`Copiar ${rotulo}`}
        onClick={() => navigator.clipboard.writeText(v).then(() => toast.success(`${rotulo} copiado`))}
        className="shrink-0 rounded-md border border-dark-600 p-1.5 text-dark-300 hover:border-gold-500 hover:text-gold-300"
      >
        <Copy size={13} />
      </button>
    </div>
  )
}

const valorBeluino = (n: number) => n.toFixed(2).replace('.', ',')

// Tudo o que o financeiro precisa digitar no beluíno, na mesma ordem do
// formulário de lá, cada campo com botão de copiar.
function DadosBeluino({ l }: { l: Linha }) {
  const itens = (() => {
    try {
      return l.itens ? (JSON.parse(l.itens) as { produto: string; preco: number; qtd: number }[]) : []
    } catch {
      return []
    }
  })()
  const end = (() => {
    try {
      return l.enderecoEntrega ? (JSON.parse(l.enderecoEntrega) as { cep: string; numero: string; endereco: string; cidade: string; estado: string; complemento?: string }) : null
    } catch {
      return null
    }
  })()
  const titulo = (t: string) => <p className="sm:col-span-2 mt-1 text-[11px] font-semibold text-gold-400">{t}</p>
  return (
    <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {titulo('Dados do cliente')}
      <Campo rotulo="CPF/CNPJ" valor={l.documento} />
      <Campo rotulo="Nome" valor={l.clienteNome} />
      <Campo rotulo="E-mail" valor={l.emailCliente} />
      <Campo rotulo="Telefone fixo" valor={l.telefoneFixo} />
      <Campo rotulo="Celular" valor={l.telefoneCliente} />
      <Campo rotulo="Nº do pedido" valor={l.numeroPedido} />
      <Campo rotulo="Observação" valor={l.observacaoVendedor} largo />
      {titulo(`Endereço de entrega: ${end ? 'Sim' : 'Não'}`)}
      {end && (
        <>
          <Campo rotulo="CEP" valor={end.cep} />
          <Campo rotulo="Número" valor={end.numero} />
          <Campo rotulo="Endereço" valor={end.endereco} largo />
          <Campo rotulo="Cidade" valor={end.cidade} />
          <Campo rotulo="Estado" valor={end.estado} />
          <Campo rotulo="Complemento" valor={end.complemento} largo />
        </>
      )}
      {titulo('Produtos / serviço')}
      {itens.length > 0 ? (
        itens.map((i, k) => (
          <div key={k} className="sm:col-span-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            <Campo rotulo={`Produto ${itens.length > 1 ? k + 1 : ''}`.trim()} valor={i.produto} />
            <Campo rotulo="Preço un." valor={valorBeluino(i.preco)} />
            <Campo rotulo="Qtd" valor={i.qtd} />
          </div>
        ))
      ) : (
        <Campo rotulo="Descrição" valor={l.descricao} largo />
      )}
      <Campo rotulo="Valor total" valor={valorBeluino(l.valor)} />
      {titulo('Formas de pagamento')}
      <Campo rotulo="Cartão" valor={l.cartao ? `Sim — até ${l.parcelas}x` : 'Não'} />
      <Campo rotulo="Bandeira" valor={l.cartao ? l.bandeira : null} />
      <Campo rotulo="PIX" valor={l.pix ? 'Sim' : 'Não'} />
    </div>
  )
}

function Pedido({ l }: { l: Linha }) {
  const utils = trpc.useUtils()
  const recarregar = () => (utils.linksPagamento.listar.invalidate(), utils.linksPagamento.contagem.invalidate())
  const [link, setLink] = useState(l.link ?? '')
  const [obs, setObs] = useState('')
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const criar = trpc.linksPagamento.criarLink.useMutation({ onSuccess: () => (toast.success('Link enviado ao vendedor'), recarregar()), onError: (e) => toast.error(e.message) })
  const pago = trpc.linksPagamento.marcarPago.useMutation({ onSuccess: () => (toast.success('Marcado como pago'), recarregar()), onError: (e) => toast.error(e.message) })
  const cancelar = trpc.linksPagamento.cancelar.useMutation({ onSuccess: () => (toast.success('Cancelado'), recarregar()), onError: (e) => toast.error(e.message) })
  const reabrir = trpc.linksPagamento.reabrir.useMutation({ onSuccess: () => recarregar(), onError: (e) => toast.error(e.message) })

  return (
    <div className="rounded-xl border border-dark-600 bg-dark-800 p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-dark-100">
            {l.clienteNome} · <span className="text-gold-300">{formatarMoeda(l.valor)}</span>
            {l.parcelas > 1 && ` em ${l.parcelas}x`}
          </p>
          <p className="text-xs text-dark-400">
            {l.empresaNome} · 👤 {l.vendedorNome} · pedido em {formatDateTime(l.createdAt)}
          </p>
          <DadosBeluino l={l} />
        </div>
        <span className={`text-[11px] font-semibold rounded-lg border px-2 py-1 ${STATUS_LINK[l.status]?.cor}`}>{STATUS_LINK[l.status]?.texto ?? l.status}</span>
      </div>

      {l.status === 'solicitado' && (
        <div className="space-y-2 rounded-lg bg-dark-900/50 p-2">
          <Input label="Link de pagamento (criado no beluíno) *" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
          <Input label="Recado para o vendedor (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => criar.mutate({ id: l.id, link, observacao: obs })} loading={criar.isPending} disabled={!link.trim()}>
              Enviar link ao vendedor
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCancelando(!cancelando)}>
              Cancelar pedido
            </Button>
          </div>
        </div>
      )}

      {l.status === 'criado' && l.link && (
        <>
          <BotoesLink link={l.link} telefone={l.telefoneCliente} cliente={l.clienteNome} />
          <p className="text-[11px] text-dark-500">
            criado {l.criadoEm ? formatDateTime(l.criadoEm) : ''} {l.criadoPorNome ? `por ${l.criadoPorNome}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => pago.mutate({ id: l.id })} loading={pago.isPending}>
              ✓ Cliente pagou
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCancelando(!cancelando)}>
              Cancelar
            </Button>
          </div>
        </>
      )}

      {cancelando && (
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Motivo do cancelamento" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <Button size="sm" variant="danger" onClick={() => cancelar.mutate({ id: l.id, motivo })} loading={cancelar.isPending}>
            Confirmar cancelamento
          </Button>
        </div>
      )}

      {(l.status === 'pago' || l.status === 'cancelado') && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-dark-400">
          {l.link && (
            <a href={l.link} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline break-all">
              {l.link}
            </a>
          )}
          {l.status === 'pago' && l.pagoEm && <span>pago em {formatDateTime(l.pagoEm)}</span>}
          {l.status === 'cancelado' && <span>cancelado{l.motivoCancelamento ? ` — ${l.motivoCancelamento}` : ''}</span>}
          <button className="text-dark-500 hover:text-dark-200" onClick={() => reabrir.mutate({ id: l.id })}>
            reabrir
          </button>
        </div>
      )}
    </div>
  )
}

export default function LinksPagamento() {
  const [aba, setAba] = useState<Aba>('solicitado')
  const { data, isLoading } = trpc.linksPagamento.listar.useQuery({ aba })
  const { data: cont } = trpc.linksPagamento.contagem.useQuery()
  const rotulo: Record<Aba, string> = {
    solicitado: `Para criar${cont?.solicitados ? ` (${cont.solicitados})` : ''}`,
    criado: `Link enviado${cont?.criados ? ` (${cont.criados})` : ''}`,
    finalizado: 'Pagos / cancelados',
  }
  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Links de pagamento</h1>
        <p className="text-sm text-dark-400 mt-1">
          Os vendedores pedem o link pelo CRM. O financeiro cria o link no beluíno, cola aqui e o vendedor recebe na hora para mandar ao cliente. Vale para todas as empresas.
        </p>
      </div>
      <div className="flex gap-1 border-b border-dark-700">
        {(['solicitado', 'criado', 'finalizado'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAba(t)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${aba === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
          >
            {rotulo[t]}
          </button>
        ))}
      </div>
      {isLoading && <p className="text-sm text-dark-400">Carregando…</p>}
      {data?.length === 0 && <p className="text-sm text-dark-400">Nada aqui.</p>}
      <div className="space-y-2">
        {data?.map((l) => (
          <Pedido key={`${l.id}-${l.status}`} l={l} />
        ))}
      </div>
    </div>
  )
}
