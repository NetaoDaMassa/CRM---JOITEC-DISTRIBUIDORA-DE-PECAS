import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Scale, RefreshCw, Link2, Trash2, EyeOff, Plus, Undo2, ArrowDownToLine, Check } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { formatarMoeda } from '../lib/moeda'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import ComoUsar from '../components/ui/ComoUsar'

// Conferência SAP × CRM (pedido do João, 2026-10-30) — vendas digitadas no
// CRM sem pedido no SAP e pedidos do SAP sem venda no CRM, com a pista do
// pedido provável. O vendedor vê as dele e pode ligar; o admin também exclui,
// cria a venda do pedido e marca como "ignorar".

type Aba = 'semPedido' | 'semVenda' | 'outraEmpresa' | 'valorDiferente' | 'outroMes'
type Acao = { tipo: 'excluir' | 'ignorarVenda' | 'ignorarPedido'; ref: number; titulo: string }

function dataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function mesAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function ConferenciaSap() {
  const { user } = useAuth()
  const admin = user?.role === 'admin'
  const [mes, setMes] = useState(mesAtual())
  const [vendedorId, setVendedorId] = useState('')
  const [aba, setAba] = useState<Aba>('semPedido')
  const [verIgnorados, setVerIgnorados] = useState(false)
  const [acao, setAcao] = useState<Acao | null>(null)
  const [motivo, setMotivo] = useState('')
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)

  const utils = trpc.useUtils()
  const input = { mes, vendedorId: vendedorId ? Number(vendedorId) : undefined }
  const { data, isLoading, isFetching, error } = trpc.conferenciaSap.obter.useQuery(input, { staleTime: 60_000, retry: false })
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: admin })

  const recarregar = () => utils.conferenciaSap.obter.invalidate()
  const deuCerto = (texto: string) => {
    setAviso({ ok: true, texto })
    setAcao(null)
    setMotivo('')
    recarregar()
  }
  const deuErro = (e: { message: string }) => setAviso({ ok: false, texto: e.message })
  const ligar = trpc.conferenciaSap.ligar.useMutation({ onSuccess: (r) => deuCerto(`Venda ligada ao pedido ${r.docNum} (${formatarMoeda(r.valor)}).`), onError: deuErro })
  const excluir = trpc.conferenciaSap.excluirVenda.useMutation({
    onSuccess: (r) =>
      deuCerto(`Venda excluída.${r.cardVoltouPara === 'card removido' ? ' O card (criado pelo SAP) saiu.' : r.cardVoltouPara ? ` O card voltou para "${r.cardVoltouPara}".` : ''}`),
    onError: deuErro,
  })
  const criar = trpc.conferenciaSap.criarVenda.useMutation({ onSuccess: (r) => deuCerto(r.criada ? 'Venda criada a partir do pedido.' : 'Pedido ligado à venda que já existia.'), onError: deuErro })
  const usarValor = trpc.conferenciaSap.usarValorSap.useMutation({ onSuccess: (r) => deuCerto(`Valor atualizado para ${formatarMoeda(r.valor)}.`), onError: deuErro })
  const trazer = trpc.conferenciaSap.trazerParaEmpresa.useMutation({
    onSuccess: (r) => deuCerto(`Pedido ${r.docNum} trazido para esta empresa${r.criada ? ' (venda criada no card do dono do cliente)' : ' (ligado à venda que já existia aqui)'}.`),
    onError: deuErro,
  })
  const ignorar = trpc.conferenciaSap.ignorar.useMutation({ onSuccess: () => deuCerto('Marcado como ignorado.'), onError: deuErro })
  const desfazer = trpc.conferenciaSap.desfazerIgnorar.useMutation({ onSuccess: () => deuCerto('Voltou para a lista de pendências.'), onError: deuErro })
  const atualizarSap = async () => {
    await utils.conferenciaSap.obter.fetch({ ...input, atualizar: true }, { staleTime: 0 })
    recarregar()
  }

  const confirmarAcao = () => {
    if (!acao) return
    if (acao.tipo === 'excluir') excluir.mutate({ vendaId: acao.ref, motivo })
    else ignorar.mutate({ tipo: acao.tipo === 'ignorarVenda' ? 'venda' : 'pedido', referencia: acao.ref, motivo })
  }

  const semPedido = (data?.semPedido ?? []).filter((v) => verIgnorados || !v.ignorado)
  const semVenda = (data?.semVenda ?? []).filter((p) => verIgnorados || !p.ignorado)
  const pendSemPedido = (data?.semPedido ?? []).filter((v) => !v.ignorado)
  const pendSemVenda = (data?.semVenda ?? []).filter((p) => !p.ignorado)
  const soma = (l: { valor: number }[]) => l.reduce((s, x) => s + x.valor, 0)
  const baseCliente = admin ? '/admin/clientes' : '/vendedor/clientes'
  const ocupado = usarValor.isPending || trazer.isPending || ligar.isPending || excluir.isPending || criar.isPending || ignorar.isPending || desfazer.isPending

  const ABAS: { id: Aba; label: string; n: number; valor: number }[] = [
    { id: 'semPedido' as Aba, label: 'Vendas no CRM sem pedido no SAP', n: pendSemPedido.length, valor: soma(pendSemPedido) },
    { id: 'semVenda' as Aba, label: 'Pedidos do SAP sem venda no CRM', n: pendSemVenda.length, valor: soma(pendSemVenda) },
    ...(admin ? [{ id: 'outraEmpresa' as Aba, label: 'Pedido desta empresa com venda em outra', n: data?.outraEmpresa.length ?? 0, valor: soma(data?.outraEmpresa ?? []) }] : []),
    { id: 'valorDiferente' as Aba, label: 'Valor diferente do SAP', n: data?.valorDiferente.length ?? 0, valor: soma(data?.valorDiferente ?? []) },
    { id: 'outroMes' as Aba, label: 'Pedido do mês com venda em outro mês', n: data?.outroMes.length ?? 0, valor: soma(data?.outroMes ?? []) },
  ].filter((a) => a.n > 0 || a.id === 'semPedido' || a.id === 'semVenda')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
            <Scale size={20} className="text-sky-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Conferência SAP × CRM</h1>
            <p className="text-sm text-dark-400">O que foi vendido no SAP e no CRM bate? Aqui aparecem as diferenças, uma a uma.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {admin && (
            <div className="w-56">
              <Select
                label="Vendedor"
                value={vendedorId}
                onChange={(e) => setVendedorId(e.target.value)}
                options={[{ value: '', label: 'Todos os vendedores' }, ...(vendedores ?? []).map((v) => ({ value: String(v.id), label: v.name }))]}
              />
            </div>
          )}
          <label className="text-sm text-dark-300">
            <span className="block mb-1">Mês</span>
            <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-dark-100" />
          </label>
          <Button variant="secondary" onClick={atualizarSap} loading={isFetching}>
            <RefreshCw size={15} /> Buscar no SAP
          </Button>
        </div>
      </div>

      <ComoUsar
        chave="conferencia_sap"
        titulo="Como usar"
        passos={[
          <>
            <b>Vendas no CRM sem pedido no SAP</b>: venda digitada que não está ligada a nenhum pedido. Embaixo de cada uma aparece o <b>pedido provável</b> (mesmo valor, mesmo cliente ou mesmo nº).
          </>,
          <>
            Se o pedido certo aparece e está livre, clique em <b>Ligar a este pedido</b> — o valor passa a ser o do SAP.
          </>,
          <>
            Se o pedido já está <b>ligado a outra venda</b>, a venda digitada é duplicada. Se é pedido de outro mês ou foi cancelado, ela também não deveria contar — o admin <b>exclui</b>.
          </>,
          <>
            <b>Pedidos do SAP sem venda no CRM</b>: o admin clica em <b>Criar venda</b> (vai pro card do mês do dono do cliente). Se o cliente não está cadastrado, cadastre primeiro.
          </>,
          <>
            Venda de verdade que não passa pelo SAP (ou pedido que não é venda, como troca/garantia): <b>Ignorar</b> com o motivo.
          </>,
        ]}
        dicas={[
          'O SAP conta pedidos (com impostos e frete), sem as vendas para empresas do grupo. Pedido de vendedora da Odin Tubos tirado pela filial Joitec conta na Odin Tubos.',
          'Os pedidos do SAP são lidos na hora e guardados por 5 minutos. "Buscar no SAP" lê de novo.',
        ]}
      />

      {aviso && (
        <div className={`rounded-xl border px-4 py-2 text-sm flex items-center justify-between gap-3 ${aviso.ok ? 'border-green-700/50 bg-green-900/20 text-green-200' : 'border-red-700/50 bg-red-900/20 text-red-200'}`}>
          <span>{aviso.texto}</span>
          <button type="button" className="text-xs opacity-70 hover:opacity-100" onClick={() => setAviso(null)}>
            fechar
          </button>
        </div>
      )}

      {error ? (
        <p className="text-sm text-red-300 bg-dark-800 border border-dark-600 rounded-2xl p-5">{error.message}</p>
      ) : isLoading || !data ? (
        <div className="h-40 rounded-2xl bg-dark-800 animate-pulse" />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-dark-600 bg-dark-800 p-3">
              <p className="text-xs text-dark-400">Vendido no SAP (pedidos)</p>
              <p className="text-lg font-bold font-mono text-dark-50">{formatarMoeda(data.totais.sap)}</p>
              <p className="text-xs text-dark-500">{data.totais.sapPedidos} pedido(s) · {data.empresa}</p>
            </div>
            <div className="rounded-2xl border border-dark-600 bg-dark-800 p-3">
              <p className="text-xs text-dark-400">Vendido no CRM</p>
              <p className="text-lg font-bold font-mono text-dark-50">{formatarMoeda(data.totais.crm)}</p>
              <p className="text-xs text-dark-500">{data.totais.crmVendas} venda(s)</p>
            </div>
            <div className={`rounded-2xl border p-3 ${Math.abs(data.totais.diferenca) < 1 ? 'border-green-700/50 bg-green-900/10' : 'border-amber-700/50 bg-amber-900/10'}`}>
              <p className="text-xs text-dark-400">Diferença (CRM − SAP)</p>
              <p className={`text-lg font-bold font-mono ${Math.abs(data.totais.diferenca) < 1 ? 'text-green-300' : 'text-amber-200'}`}>{formatarMoeda(data.totais.diferenca)}</p>
              <p className="text-xs text-dark-500">{Math.abs(data.totais.diferenca) < 1 ? 'bate ✅' : 'veja as listas abaixo'}</p>
            </div>
            <div className="rounded-2xl border border-dark-600 bg-dark-800 p-3">
              <p className="text-xs text-dark-400">No CRM ligado a pedido do SAP</p>
              <p className="text-lg font-bold font-mono text-dark-50">{formatarMoeda(data.totais.ligado)}</p>
              <p className="text-xs text-dark-500">esta parte bate no centavo</p>
            </div>
          </div>
          {admin && vendedorId && <p className="text-xs text-dark-500 -mt-2">Os totais acima são da empresa toda; as listas abaixo são só do vendedor escolhido.</p>}

          <div className="flex flex-wrap items-center gap-2">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAba(a.id)}
                className={`text-left rounded-xl border px-3 py-2 text-sm transition-colors ${aba === a.id ? 'border-gold-600 bg-gold-900/10 text-dark-100' : 'border-dark-600 bg-dark-800 text-dark-300 hover:border-dark-500'}`}
              >
                {a.label} <b className="ml-1">{a.n}</b> <span className="text-dark-500 font-mono">· {formatarMoeda(a.valor, { casas: 0 })}</span>
              </button>
            ))}
            {(aba === 'semPedido' || aba === 'semVenda') && (
              <label className="ml-auto flex items-center gap-2 text-xs text-dark-400">
                <input type="checkbox" checked={verIgnorados} onChange={(e) => setVerIgnorados(e.target.checked)} /> mostrar ignorados
              </label>
            )}
          </div>

          {aba === 'semPedido' &&
            (semPedido.length === 0 ? (
              <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">Nenhuma venda sem pedido. 👍</p>
            ) : (
              <div className="space-y-3">
                {semPedido.map((v) => (
                  <div key={v.vendaId} className={`bg-dark-800 border rounded-2xl p-4 space-y-2 ${v.ignorado ? 'border-dark-700 opacity-60' : 'border-dark-600'}`}>
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <Link to={`${baseCliente}/${v.clienteId}`} className="text-sm font-semibold text-dark-100 hover:underline">
                          {v.cliente}
                        </Link>
                        <p className="text-xs text-dark-500">
                          {v.codigo} · venda {v.vendaId} de {dataBr(v.data)} · {v.vendedor ?? '—'}
                          {v.numeroPedido ? ` · nº pedido digitado: ${v.numeroPedido}` : ''}
                        </p>
                        {v.ignorado && <p className="text-xs text-dark-400 mt-1">Ignorado: {v.ignorado.motivo}</p>}
                      </div>
                      <p className="text-base font-bold font-mono text-dark-50">{formatarMoeda(v.valor)}</p>
                      {admin && (
                        <div className="flex gap-1.5">
                          {v.ignorado ? (
                            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => desfazer.mutate({ tipo: 'venda', referencia: v.vendaId })}>
                              <Undo2 size={14} /> Voltar
                            </Button>
                          ) : (
                            <>
                              <Button size="sm" variant="danger" disabled={ocupado} onClick={() => setAcao({ tipo: 'excluir', ref: v.vendaId, titulo: `Excluir a venda ${v.vendaId} (${v.cliente}, ${formatarMoeda(v.valor)})` })}>
                                <Trash2 size={14} /> Excluir
                              </Button>
                              <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setAcao({ tipo: 'ignorarVenda', ref: v.vendaId, titulo: `Ignorar a venda ${v.vendaId} (${v.cliente})` })}>
                                <EyeOff size={14} /> Ignorar
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {v.pistas.length === 0 ? (
                      <p className="text-xs text-dark-400 border-t border-dark-700/70 pt-2">Nenhum pedido no SAP com esse cliente, esse valor ou esse nº (neste mês e no anterior). Confira com o vendedor.</p>
                    ) : (
                      <div className="border-t border-dark-700/70 pt-2 space-y-1.5">
                        <p className="text-xs text-dark-500">Pedido provável no SAP:</p>
                        {v.pistas.map((p) => (
                          <div key={p.docEntry} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <span className="font-mono text-dark-200">pedido {p.docNum}</span>
                            <span className="font-mono">{formatarMoeda(p.valor)}</span>
                            <span className="text-dark-400">{dataBr(p.data)}</span>
                            <span className="text-dark-300 truncate max-w-[18rem]">{p.clienteSap}</span>
                            <span className="text-xs text-dark-500">
                              filial {p.filial}
                              {p.vendedorSap ? ` · ${p.vendedorSap}` : ''}
                            </span>
                            <span className="text-xs rounded-full px-2 py-0.5 bg-dark-700 text-dark-300">{p.motivos.join(' + ')}</span>
                            {p.cancelado ? (
                              <span className="text-xs rounded-full px-2 py-0.5 bg-red-900/30 text-red-300">cancelado no SAP</span>
                            ) : p.ligadoA ? (
                              <span className="text-xs rounded-full px-2 py-0.5 bg-amber-900/30 text-amber-200">
                                já é a venda {p.ligadoA.vendaId} ({p.ligadoA.empresa}{p.ligadoA.vendedor ? ` · ${p.ligadoA.vendedor}` : ''})
                              </span>
                            ) : (
                              !v.ignorado && (
                                <Button size="sm" variant="outline" disabled={ocupado} onClick={() => ligar.mutate({ vendaId: v.vendaId, docEntry: p.docEntry })}>
                                  <Link2 size={14} /> Ligar a este pedido
                                </Button>
                              )
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}

          {aba === 'semVenda' &&
            (semVenda.length === 0 ? (
              <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">Todos os pedidos do mês estão no CRM. 👍</p>
            ) : (
              <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-dark-500">
                      <th className="pb-2 pr-3">Pedido</th>
                      <th className="pb-2 pr-3">Data</th>
                      <th className="pb-2 pr-3">Cliente no SAP</th>
                      <th className="pb-2 pr-3">Vendedor no SAP</th>
                      <th className="pb-2 pr-3 text-right">Valor</th>
                      <th className="pb-2 pr-3">Por que não entrou</th>
                      {admin && <th className="pb-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {semVenda.map((p) => (
                      <tr key={p.docEntry} className={`border-t border-dark-700/70 align-top ${p.ignorado ? 'opacity-60' : ''}`}>
                        <td className="py-2 pr-3 font-mono whitespace-nowrap">
                          {p.docNum}
                          <span className="block text-xs text-dark-500 font-sans">filial {p.filial}</span>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">{dataBr(p.data)}</td>
                        <td className="py-2 pr-3">
                          {p.cliente ? (
                            <Link to={`${baseCliente}/${p.cliente.id}`} className="hover:underline">
                              {p.clienteSap}
                            </Link>
                          ) : (
                            p.clienteSap
                          )}
                        </td>
                        <td className="py-2 pr-3 text-dark-300">{p.vendedorSap ?? '—'}</td>
                        <td className="py-2 pr-3 text-right font-mono whitespace-nowrap">{formatarMoeda(p.valor)}</td>
                        <td className="py-2 pr-3 text-xs text-dark-400">{p.ignorado ? `Ignorado: ${p.ignorado.motivo}` : (p.motivo ?? 'Pode criar a venda')}</td>
                        {admin && (
                          <td className="py-2 whitespace-nowrap text-right space-x-1.5">
                            {p.ignorado ? (
                              <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => desfazer.mutate({ tipo: 'pedido', referencia: p.docEntry })}>
                                <Undo2 size={14} /> Voltar
                              </Button>
                            ) : (
                              <>
                                {!p.motivo && (
                                  <Button size="sm" variant="outline" disabled={ocupado} onClick={() => criar.mutate({ docEntry: p.docEntry })}>
                                    <Plus size={14} /> Criar venda
                                  </Button>
                                )}
                                <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setAcao({ tipo: 'ignorarPedido', ref: p.docEntry, titulo: `Ignorar o pedido ${p.docNum} (${p.clienteSap})` })}>
                                  <EyeOff size={14} /> Ignorar
                                </Button>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {aba === 'outraEmpresa' && data.outraEmpresa.length > 0 && (
            <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-2 text-sm">
              <p className="text-xs text-dark-500">
                Pelo SAP (filial e vendedor) estes pedidos são de {data.empresa}, mas no CRM estão como venda de outra empresa. <b>Trazer para cá</b> tira a venda de lá e cria aqui
                (no card do dono do cliente, ou ligada a uma venda parecida que já exista aqui).
              </p>
              {data.outraEmpresa.map((p) => (
                <div key={p.docEntry} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dark-700/70 pt-2">
                  <span className="font-mono">pedido {p.docNum}</span>
                  <span>{dataBr(p.data)}</span>
                  <span className="font-mono">{formatarMoeda(p.valor)}</span>
                  <span className="text-dark-300 truncate max-w-[18rem]">{p.clienteSap}</span>
                  <span className="text-xs text-dark-500">
                    filial {p.filial}
                    {p.vendedorSap ? ` · ${p.vendedorSap}` : ''}
                  </span>
                  <span className="text-xs rounded-full px-2 py-0.5 bg-amber-900/30 text-amber-200">
                    hoje: venda {p.ligadoA?.vendaId} na {p.ligadoA?.empresa}
                    {p.ligadoA?.vendedor ? ` · ${p.ligadoA.vendedor}` : ''}
                  </span>
                  <Button size="sm" variant="outline" disabled={ocupado} onClick={() => trazer.mutate({ docEntry: p.docEntry })}>
                    <ArrowDownToLine size={14} /> Trazer para cá
                  </Button>
                </div>
              ))}
            </div>
          )}

          {aba === 'valorDiferente' && data.valorDiferente.length > 0 && (
            <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-2 text-sm">
              <p className="text-xs text-dark-500">Pedidos alterados no SAP depois de virar venda. A venda automática já corrige os dos últimos 7 dias; os mais antigos, corrija aqui.</p>
              {data.valorDiferente.map((p) => (
                <div key={p.docEntry} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dark-700/70 pt-2">
                  <span className="font-mono">pedido {p.docNum}</span>
                  <span>{dataBr(p.data)}</span>
                  <span className="text-dark-300 truncate max-w-[18rem]">{p.clienteSap}</span>
                  <span>
                    SAP <b className="font-mono">{formatarMoeda(p.valor)}</b> × CRM <b className="font-mono">{formatarMoeda(p.valorCrm)}</b>
                  </span>
                  {p.ligadoA && (
                    <Button size="sm" variant="outline" disabled={ocupado} onClick={() => usarValor.mutate({ vendaId: p.ligadoA!.vendaId })}>
                      <Check size={14} /> Usar valor do SAP
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {aba === 'outroMes' &&
            (data.outroMes.length === 0 ? (
              <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">Nenhum. 👍</p>
            ) : (
              <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-1.5 text-sm">
                <p className="text-xs text-dark-500 mb-2">Pedidos deste mês que estão contando como venda de outro mês no CRM.</p>
                {data.outroMes.map((p) => (
                  <div key={p.docEntry} className="flex flex-wrap gap-x-3">
                    <span className="font-mono">pedido {p.docNum}</span>
                    <span>{dataBr(p.data)}</span>
                    <span className="font-mono">{formatarMoeda(p.valor)}</span>
                    <span className="text-dark-300">{p.clienteSap}</span>
                    <span className="text-amber-200">venda {p.ligadoA?.vendaId} conta em {p.mesVenda.split('-').reverse().join('/')}</span>
                  </div>
                ))}
              </div>
            ))}
        </>
      )}

      <Modal open={!!acao} onClose={() => setAcao(null)} title={acao?.titulo ?? ''} size="md">
        <div className="space-y-3">
          <p className="text-sm text-dark-300">
            {acao?.tipo === 'excluir'
              ? 'A venda sai do faturamento e dos relatórios (fica no histórico). Se o card ficar sem venda, ele volta para a etapa de antes do Fechado.'
              : 'Deixa de aparecer como pendência. Dá pra desfazer marcando "mostrar ignorados".'}
          </p>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            placeholder={acao?.tipo === 'excluir' ? 'Ex.: duplicada do pedido 8525' : 'Ex.: venda no balcão sem pedido no SAP'}
            className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAcao(null)}>
              Cancelar
            </Button>
            <Button variant={acao?.tipo === 'excluir' ? 'danger' : 'primary'} disabled={motivo.trim().length < 3} loading={excluir.isPending || ignorar.isPending} onClick={confirmarAcao}>
              {acao?.tipo === 'excluir' ? 'Excluir venda' : 'Ignorar'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
