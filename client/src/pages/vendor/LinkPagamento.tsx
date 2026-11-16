import { useState } from 'react'
import toast from 'react-hot-toast'
import { Copy, MessageCircle } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import { formatDateTime } from '../../lib/utils'
import { formatarMoeda } from '../../lib/moeda'
import { parseValorBr } from '../../lib/valorBr'

// Solicitação de link de pagamento — lado do vendedor (financeiro, 2026-11-13).

export const STATUS_LINK: Record<string, { texto: string; cor: string }> = {
  solicitado: { texto: '⏳ Esperando o financeiro criar o link', cor: 'text-amber-200 bg-amber-900/25 border-amber-700/50' },
  criado: { texto: '🔗 Link pronto', cor: 'text-sky-200 bg-sky-900/25 border-sky-700/50' },
  pago: { texto: '✓ Pago', cor: 'text-green-300 bg-green-900/20 border-green-700/40' },
  cancelado: { texto: 'Cancelado', cor: 'text-dark-400 bg-dark-800 border-dark-600' },
}

function soDigitos(s: string) {
  return s.replace(/\D/g, '')
}

export function BotoesLink({ link, telefone, cliente }: { link: string; telefone?: string | null; cliente: string }) {
  const tel = soDigitos(telefone ?? '')
  const texto = `Olá! Segue o link para pagamento${cliente ? ` (${cliente})` : ''}: ${link}`
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={link} target="_blank" rel="noreferrer" className="text-sm text-sky-300 hover:underline break-all">
        {link}
      </a>
      <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Link copiado'))}>
        <Copy size={13} className="mr-1" /> Copiar
      </Button>
      {tel.length >= 10 && (
        <a
          href={`https://wa.me/${tel.length <= 11 ? `55${tel}` : tel}?text=${encodeURIComponent(texto)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-lg bg-green-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-600"
        >
          <MessageCircle size={13} /> WhatsApp
        </a>
      )}
    </div>
  )
}

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')
const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'American Express', 'Hipercard', 'Diners']
type Item = { produto: string; preco: string; qtd: string }
const VAZIO = {
  documento: '',
  clienteNome: '',
  emailCliente: '',
  telefoneFixo: '',
  telefoneCliente: '',
  observacaoVendedor: '',
  numeroPedido: '',
  informarEndereco: true,
  cep: '',
  numero: '',
  endereco: '',
  cidade: '',
  estado: '',
  complemento: '',
  cartao: true,
  parcelas: '1',
  bandeira: '',
  pix: false,
}
const ITEM_VAZIO: Item = { produto: '', preco: '', qtd: '1' }

export default function LinkPagamento() {
  const utils = trpc.useUtils()
  const { data: meus } = trpc.linksPagamento.meus.useQuery()
  const [f, setF] = useState(VAZIO)
  const [itens, setItens] = useState<Item[]>([ITEM_VAZIO])
  const [aberto, setAberto] = useState(false)
  const solicitar = trpc.linksPagamento.solicitar.useMutation({
    onSuccess: () => {
      toast.success('Pedido enviado ao financeiro')
      setF(VAZIO)
      setItens([ITEM_VAZIO])
      setAberto(false)
      utils.linksPagamento.meus.invalidate()
    },
    onError: (e) => {
      // Mostra a primeira mensagem de validação, não o JSON inteiro.
      try {
        const lista = JSON.parse(e.message) as { message: string }[]
        toast.error(lista[0]?.message ?? e.message)
      } catch {
        toast.error(e.message)
      }
    },
  })
  const cancelar = trpc.linksPagamento.cancelarMeu.useMutation({ onSuccess: () => utils.linksPagamento.meus.invalidate(), onError: (e) => toast.error(e.message) })
  const set = (k: keyof typeof VAZIO) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const total = itens.reduce((s, i) => s + (parseValorBr(i.preco) || 0) * (Number(i.qtd.replace(',', '.')) || 0), 0)

  const trocarCep = async (cep: string) => {
    setF((x) => ({ ...x, cep }))
    if (cep.replace(/\D/g, '').length !== 8) return
    try {
      const r = await utils.linksPagamento.buscarCep.fetch({ cep })
      if (r) setF((x) => ({ ...x, endereco: [r.rua, r.bairro].filter(Boolean).join(' - ') || x.endereco, cidade: r.cidade, estado: r.uf }))
      else toast.error('CEP não encontrado — preencha o endereço')
    } catch {
      /* preenche à mão */
    }
  }

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    solicitar.mutate({
      documento: f.documento,
      clienteNome: f.clienteNome,
      emailCliente: f.emailCliente,
      telefoneFixo: f.telefoneFixo,
      telefoneCliente: f.telefoneCliente,
      observacaoVendedor: f.observacaoVendedor,
      numeroPedido: f.numeroPedido,
      endereco: f.informarEndereco ? { cep: f.cep, numero: f.numero, endereco: f.endereco, cidade: f.cidade, estado: f.estado, complemento: f.complemento } : null,
      itens: itens.map((i) => ({ produto: i.produto, preco: parseValorBr(i.preco) || 0, qtd: Number(i.qtd.replace(',', '.')) || 0 })),
      cartao: f.cartao,
      parcelas: Number(f.parcelas) || 1,
      bandeira: f.bandeira,
      pix: f.pix,
    })
  }

  const Toggle = ({ ligado, onClick, label }: { ligado: boolean; onClick: () => void; label: string }) => (
    <button type="button" onClick={onClick} className="flex items-center gap-3 text-sm text-dark-100" aria-pressed={ligado}>
      <span className="w-14">{label}</span>
      <span className={`relative h-6 w-11 rounded-full transition-colors ${ligado ? 'bg-sky-600' : 'bg-dark-600'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${ligado ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Link de pagamento</h1>
        <p className="text-sm text-dark-400 mt-1">Peça aqui o link de pagamento do cliente. O financeiro cria o link e ele aparece nesta tela para você copiar ou mandar pelo WhatsApp.</p>
      </div>

      {!aberto ? (
        <Button onClick={() => setAberto(true)}>+ Pedir link de pagamento</Button>
      ) : (
        <form onSubmit={enviar} className="space-y-5 rounded-2xl border border-dark-700 bg-dark-800/60 p-4">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-dark-100">Dados do cliente</h3>
              <Input label="CPF/CNPJ *" value={f.documento} onChange={set('documento')} placeholder="000.000.000-00" />
              <Input label="Nome do cliente *" value={f.clienteNome} onChange={set('clienteNome')} placeholder="Nome Sobrenome / Razão social" />
              <Input label="E-mail *" value={f.emailCliente} onChange={set('emailCliente')} placeholder="cliente@email.com.br" />
              <Input label="Telefone fixo" value={f.telefoneFixo} onChange={set('telefoneFixo')} placeholder="(00) 0000-0000" />
              <Input label="Celular" value={f.telefoneCliente} onChange={set('telefoneCliente')} placeholder="(00) 00000-0000" />
              <Input label="Nº do pedido / cotação" value={f.numeroPedido} onChange={set('numeroPedido')} />
              <Textarea label="Observação" value={f.observacaoVendedor} onChange={set('observacaoVendedor')} rows={3} />
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-dark-100">Endereço de entrega</h3>
              <div className="flex items-center gap-4 text-sm text-dark-200">
                <span>Deseja informar o endereço de entrega?</span>
                <label className="flex items-center gap-1">
                  <input type="radio" checked={f.informarEndereco} onChange={() => setF({ ...f, informarEndereco: true })} /> Sim
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" checked={!f.informarEndereco} onChange={() => setF({ ...f, informarEndereco: false })} /> Não
                </label>
              </div>
              {f.informarEndereco && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="CEP *" value={f.cep} onChange={(e) => trocarCep(e.target.value)} placeholder="00000-000" />
                    <Input label="Número *" value={f.numero} onChange={set('numero')} />
                  </div>
                  <Input label="Endereço *" value={f.endereco} onChange={set('endereco')} placeholder="preenche pelo CEP" />
                  <div className="grid grid-cols-[1fr_6rem] gap-2">
                    <Input label="Cidade *" value={f.cidade} onChange={set('cidade')} />
                    <label className="block text-sm">
                      <span className="mb-1 block text-dark-300">Estado *</span>
                      <select value={f.estado} onChange={set('estado')} className="w-full rounded-lg border border-dark-600 bg-dark-900 px-2 py-2 text-dark-100">
                        <option value="">UF</option>
                        {UFS.map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <Input label="Complemento" value={f.complemento} onChange={set('complemento')} />
                </>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-dark-100">Produtos / serviço</h3>
              {itens.map((it, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_6rem_4rem_auto] items-end gap-2">
                  <Input label={idx === 0 ? 'Produto/serviço *' : undefined} value={it.produto} onChange={(e) => setItens(itens.map((x, j) => (j === idx ? { ...x, produto: e.target.value } : x)))} />
                  <Input label={idx === 0 ? 'Preço un. *' : undefined} value={it.preco} inputMode="decimal" placeholder="R$ 1,00" onChange={(e) => setItens(itens.map((x, j) => (j === idx ? { ...x, preco: e.target.value } : x)))} />
                  <Input label={idx === 0 ? 'Qtd *' : undefined} value={it.qtd} inputMode="decimal" onChange={(e) => setItens(itens.map((x, j) => (j === idx ? { ...x, qtd: e.target.value } : x)))} />
                  <button
                    type="button"
                    aria-label="Tirar item"
                    disabled={itens.length === 1}
                    onClick={() => setItens(itens.filter((_, j) => j !== idx))}
                    className="mb-1 rounded-lg bg-red-900/40 px-2 py-2 text-red-300 hover:bg-red-800/50 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button type="button" size="sm" variant="secondary" onClick={() => setItens([...itens, ITEM_VAZIO])}>
                  + Item
                </Button>
                <p className="text-sm text-dark-300">
                  Valor total: <b className="text-dark-50">{formatarMoeda(total)}</b>
                </p>
              </div>

              <h3 className="pt-2 text-sm font-semibold text-dark-100">Formas de pagamento</h3>
              <Toggle label="Cartão" ligado={f.cartao} onClick={() => setF({ ...f, cartao: !f.cartao })} />
              {f.cartao && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-dark-300">Nº de parcelas</span>
                    <select value={f.parcelas} onChange={set('parcelas')} className="w-full rounded-lg border border-dark-600 bg-dark-900 px-2 py-2 text-dark-100">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}x
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-dark-300">Bandeira</span>
                    <select value={f.bandeira} onChange={set('bandeira')} className="w-full rounded-lg border border-dark-600 bg-dark-900 px-2 py-2 text-dark-100">
                      <option value="">Qualquer</option>
                      {BANDEIRAS.map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <Toggle label="PIX" ligado={f.pix} onClick={() => setF({ ...f, pix: !f.pix })} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" loading={solicitar.isPending}>
              Enviar pedido ao financeiro
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-dark-200">Meus pedidos</h2>
        {meus?.length === 0 && <p className="text-sm text-dark-400">Nenhum pedido ainda.</p>}
        {meus?.map((l) => (
          <div key={l.id} className="rounded-xl border border-dark-600 bg-dark-800 p-3 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-dark-100">
                  {l.clienteNome} · {formatarMoeda(l.valor)}
                  {l.parcelas > 1 && ` em ${l.parcelas}x`}
                </p>
                <p className="text-xs text-dark-400">
                  pedido em {formatDateTime(l.createdAt)}
                  {l.numeroPedido && ` · nº ${l.numeroPedido}`}
                </p>
              </div>
              <span className={`text-[11px] font-semibold rounded-lg border px-2 py-1 ${STATUS_LINK[l.status]?.cor}`}>{STATUS_LINK[l.status]?.texto ?? l.status}</span>
            </div>
            {l.link && l.status !== 'cancelado' && <BotoesLink link={l.link} telefone={l.telefoneCliente} cliente={l.clienteNome} />}
            {l.observacaoFinanceiro && <p className="text-xs text-dark-300">💬 Financeiro: {l.observacaoFinanceiro}</p>}
            {l.status === 'cancelado' && l.motivoCancelamento && <p className="text-xs text-dark-500">Motivo: {l.motivoCancelamento}</p>}
            {l.status === 'solicitado' && (
              <button className="text-xs text-dark-500 hover:text-red-400" onClick={() => cancelar.mutate({ id: l.id })}>
                Cancelar pedido
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
