import { useState } from 'react'
import toast from 'react-hot-toast'
import { ShoppingCart, Package, Search, Clock, MapPin, Link2, Copy, ChevronDown, ChevronRight, Globe, ExternalLink, MessageCircle } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { formatarMoeda } from '../lib/moeda'

// Ficha do lead → tudo o que ele fez na loja virtual nova (Compretec):
// carrinho com o link que devolve o carrinho pronto, pedidos com produtos,
// frete e pagamento, produtos que viu, o que buscou e cada visita, página
// por página. Pedido do João, 2026-11-10. Dados: leads.lojaVirtual
// (server/src/lib/lojaLeadHistorico.ts). Não aparece se o lead nunca foi à loja.

const quando = (utc: string) =>
  new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const hora = (utc: string) => new Date(`${utc.replace(' ', 'T')}Z`).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
function tempo(msx: number | null | undefined) {
  if (!msx) return null
  const s = Math.round(msx / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}min${s % 60 ? ` ${s % 60}s` : ''}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

const COR_SITUACAO: Record<string, string> = {
  Pago: 'bg-green-500/15 text-green-300 border-green-500/30',
  'Aguardando pagamento': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'Pagamento não concluído': 'bg-red-500/15 text-red-300 border-red-500/30',
}

const COR_EVENTO: Record<string, string> = {
  purchase: 'bg-green-400',
  begin_checkout: 'bg-amber-400',
  payment_failed: 'bg-red-400',
  cart_abandoned: 'bg-red-400',
  add_to_cart: 'bg-orange-400',
  lead: 'bg-cyan-400',
  signup: 'bg-cyan-400',
  whatsapp_click: 'bg-emerald-400',
  product_view: 'bg-blue-400',
  search: 'bg-purple-400',
}

function Mini({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-dark-700/50 px-3 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-dark-500">{rotulo}</p>
      <p className="text-sm font-semibold text-dark-100 truncate">{valor}</p>
    </div>
  )
}

export default function LojaVirtualLead({ leadId }: { leadId: number }) {
  const { data } = trpc.leads.lojaVirtual.useQuery({ id: leadId })
  const [aberta, setAberta] = useState<number | null>(0)
  if (!data) return null
  const { resumo, carrinho, pedidos, produtos, buscas, sessoes } = data
  const copiar = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success('Link copiado — cole no WhatsApp do cliente'))

  return (
    <div className="bg-dark-800 border border-orange-500/30 rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-dark-100 flex items-center gap-2">
          <ShoppingCart size={16} className="text-orange-300" /> Na loja virtual
        </p>
        <p className="text-xs text-dark-400">
          Última visita {quando(resumo.ultimaVisita)} · desde {quando(resumo.primeiraVisita)}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Mini rotulo="Visitas" valor={resumo.sessoes} />
        <Mini rotulo="Páginas vistas" valor={resumo.paginas} />
        <Mini rotulo="Tempo na loja" valor={tempo(resumo.tempoTotalMs) ?? '—'} />
        <Mini rotulo="Chegou por" valor={<span title={resumo.origemPrimeira}>{resumo.origemPrimeira}</span>} />
        <Mini rotulo="Cliques no WhatsApp" valor={resumo.cliquesWhatsapp} />
        <Mini rotulo="Já comprou" valor={resumo.totalComprado ? formatarMoeda(resumo.totalComprado) : 'Nada ainda'} />
      </div>
      {resumo.campanhas.length > 0 && <p className="text-xs text-dark-400">Campanhas: {resumo.campanhas.join(', ')}</p>}

      {carrinho && !carrinho.comprouDepois && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-red-200">🛒 Carrinho abandonado · {quando(carrinho.quando)}</p>
            {carrinho.valor ? <p className="font-mono font-bold text-red-100">{formatarMoeda(carrinho.valor)}</p> : null}
          </div>
          <ul className="text-sm text-dark-200 space-y-0.5">
            {carrinho.itens.map((i, k) => (
              <li key={k} className="flex justify-between gap-3">
                <span className="min-w-0">
                  {i.quantidade}x {i.nome} {i.sku && <span className="text-xs text-dark-500">{i.sku}</span>}
                </span>
                {i.preco != null && <span className="font-mono text-dark-300 shrink-0">{formatarMoeda(i.preco * i.quantidade)}</span>}
              </li>
            ))}
          </ul>
          {carrinho.link && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => copiar(carrinho.link!)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-500/30"
              >
                <Copy size={13} /> Copiar link do carrinho
              </button>
              <span className="text-xs text-dark-400 flex items-center gap-1">
                <Link2 size={12} /> abre o carrinho pronto no celular do cliente, direto no pagamento
              </span>
            </div>
          )}
        </div>
      )}

      {pedidos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-dark-400 flex items-center gap-1.5">
            <Package size={13} /> Pedidos
          </p>
          {pedidos.map((p) => (
            <div key={p.numero} className="rounded-xl bg-dark-700/40 border border-dark-600 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-dark-100">
                  Pedido {p.numero} <span className="text-xs font-normal text-dark-400">· {quando(p.quando)}</span>
                </p>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${COR_SITUACAO[p.situacao] ?? 'bg-dark-700 text-dark-300 border-dark-600'}`}>{p.situacao}</span>
              </div>
              <ul className="text-sm text-dark-200 space-y-0.5">
                {p.itens.map((i, k) => (
                  <li key={k} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      {i.quantidade}x {i.nome} {i.sku && <span className="text-xs text-dark-500">{i.sku}</span>}
                    </span>
                    {i.preco != null && <span className="font-mono text-dark-300 shrink-0">{formatarMoeda(i.preco * i.quantidade)}</span>}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-dark-400 border-t border-dark-600 pt-2">
                {p.total != null && (
                  <span>
                    Total <b className="text-dark-100 font-mono">{formatarMoeda(p.total)}</b>
                  </span>
                )}
                {p.frete != null && <span>Frete {formatarMoeda(p.frete)}{p.transportadora ? ` (${p.transportadora})` : ''}</span>}
                {!!p.desconto && <span>Desconto {formatarMoeda(p.desconto)}{p.cupom ? ` · cupom ${p.cupom}` : ''}</span>}
                {p.pagamento && <span>{p.pagamento}{p.parcelas && p.parcelas > 1 ? ` em ${p.parcelas}x` : ''}</span>}
                {p.cidade && (
                  <span className="flex items-center gap-1">
                    <MapPin size={11} /> {p.bairro ? `${p.bairro}, ` : ''}
                    {p.cidade}/{p.uf} {p.cep && `· CEP ${p.cep}`}
                  </span>
                )}
                {p.tipoDocumento && <span>Comprou com {p.tipoDocumento}{p.tipoDocumento === 'CNPJ' ? ' (empresa)' : ''}</span>}
                {p.linkAdmin && (
                  <a href={p.linkAdmin} target="_blank" rel="noreferrer" className="text-gold-400 hover:underline flex items-center gap-1">
                    Abrir na loja <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {produtos.length > 0 && (
          <div className="space-y-1.5 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-dark-400">Produtos que olhou</p>
            <ul className="space-y-1">
              {produtos.map((p) => (
                <li key={p.sku ?? p.nome} className="flex items-center justify-between gap-2 text-sm bg-dark-700/40 rounded-lg px-2.5 py-1.5">
                  <span className="min-w-0 truncate text-dark-200" title={p.nome}>
                    {p.nome}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0 text-[11px]">
                    {p.comprou && <span className="px-1.5 rounded bg-green-500/20 text-green-300">comprou</span>}
                    {!p.comprou && p.noCarrinho && <span className="px-1.5 rounded bg-orange-500/20 text-orange-300">no carrinho</span>}
                    {p.vistas > 0 && <span className="text-dark-400">{p.vistas}x</span>}
                    {tempo(p.tempoMs) && <span className="text-dark-500">{tempo(p.tempoMs)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {buscas.length > 0 && (
          <div className="space-y-1.5 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-dark-400 flex items-center gap-1.5">
              <Search size={12} /> O que buscou
            </p>
            <div className="flex flex-wrap gap-1.5">
              {buscas.map((b) => (
                <span key={b} className="text-xs px-2 py-1 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-200">
                  {b}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-dark-400 flex items-center gap-1.5">
          <Clock size={12} /> Visitas, passo a passo
        </p>
        {sessoes.map((s, idx) => (
          <div key={s.inicio + idx} className="rounded-xl border border-dark-600 overflow-hidden">
            <button type="button" onClick={() => setAberta(aberta === idx ? null : idx)} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left bg-dark-700/40 hover:bg-dark-700/70">
              <span className="text-sm text-dark-200 flex items-center gap-2 min-w-0">
                {aberta === idx ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="truncate">
                  {quando(s.inicio)} · {s.paginas} página{s.paginas === 1 ? '' : 's'}
                  {tempo(s.duracaoMs) ? ` · ${tempo(s.duracaoMs)}` : ''}
                </span>
              </span>
              <span className="text-xs text-dark-400 flex items-center gap-1 shrink-0 max-w-[45%] truncate">
                <Globe size={11} /> {s.origem}
              </span>
            </button>
            {aberta === idx && (
              <ol className="px-3 py-2 space-y-1.5 max-h-80 overflow-y-auto">
                {s.eventos.map((e, k) => (
                  <li key={k} className="flex gap-2.5 text-xs">
                    <span className="text-dark-500 font-mono w-10 shrink-0 pt-0.5">{hora(e.quando)}</span>
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${COR_EVENTO[e.tipo] ?? 'bg-dark-500'}`} />
                    <div className="min-w-0">
                      <p className="text-dark-200">
                        {e.tipo === 'whatsapp_click' && <MessageCircle size={11} className="inline mr-1 text-emerald-400" />}
                        {e.rotulo}
                        {e.produto ? <b className="font-medium"> · {e.produto}</b> : e.titulo && e.tipo === 'page_view' ? ` · ${e.titulo}` : ''}
                        {e.valor ? <span className="font-mono text-dark-300"> · {formatarMoeda(e.valor)}</span> : null}
                      </p>
                      {(e.detalhe || e.tempoMs || (e.tipo === 'page_view' && e.pagina)) && (
                        <p className="text-dark-500 truncate">
                          {[e.detalhe, e.tipo === 'page_view' ? e.pagina : null, tempo(e.tempoMs) ? `ficou ${tempo(e.tempoMs)}` : null].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
