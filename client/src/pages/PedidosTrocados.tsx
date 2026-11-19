import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Shuffle, RefreshCw, Check, Undo2, ArrowRight, Package, MoveRight } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { formatarMoeda } from '../lib/moeda'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import ComoUsar from '../components/ui/ComoUsar'

// Pedidos × clientes trocados (SAP × CRM) — pedido do João, 2026-11-19:
// "clientes e pedidos trocados – SAP, pedidos da expedição que estão
// trocados… um agente pra ver isso". Tela só de REVISÃO, do grupo todo: o
// CRM revisa sozinho de 30 em 30 min (lib/pedidosTrocados.ts) e avisa no
// sininho quando aparece caso novo.

type Tipo = 'venda_outro_cliente' | 'numero_outro_cliente' | 'cadastro_outro_nome'

const TIPOS: { id: Tipo; label: string; explica: string }[] = [
  { id: 'venda_outro_cliente', label: 'Venda no cliente errado', explica: 'A venda está ligada a um pedido do SAP que é de OUTRO cliente. O pedido (e a expedição dele) aparece no card errado.' },
  { id: 'numero_outro_cliente', label: 'Nº de pedido de outro cliente', explica: 'Venda digitada com um nº de pedido que, no SAP, é de outro cliente.' },
  { id: 'cadastro_outro_nome', label: 'Cadastro com código de outro cliente', explica: 'O cadastro no CRM tem o código do SAP de outro cliente (nome diferente). Tudo desse código cai neste cadastro.' },
]

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function PedidosTrocados() {
  const { empresaAtivaId } = useAuth()
  const [tipo, setTipo] = useState<Tipo>('venda_outro_cliente')
  const [empresa, setEmpresa] = useState('')
  const [verCertos, setVerCertos] = useState(false)
  const [marcar, setMarcar] = useState<{ chave: string; titulo: string } | null>(null)
  const [mover, setMover] = useState<{ chave: string; vendaId: number; pedido: string | null; de: string; para: string } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)

  const utils = trpc.useUtils()
  const { data, isLoading, error } = trpc.pedidosTrocados.obter.useQuery(undefined, { staleTime: 60_000, retry: false })
  const recarregar = () => utils.pedidosTrocados.obter.invalidate()
  const deuErro = (e: { message: string }) => setAviso({ ok: false, texto: e.message })
  const revisar = trpc.pedidosTrocados.revisarAgora.useMutation({
    onSuccess: (r) => {
      setAviso({ ok: true, texto: r.total ? `Revisão feita: ${r.total} caso(s).` : 'Revisão feita: nada trocado. 👍' })
      recarregar()
    },
    onError: deuErro,
  })
  const certo = trpc.pedidosTrocados.marcarCerto.useMutation({
    onSuccess: () => {
      setAviso({ ok: true, texto: 'Marcado como "está certo".' })
      setMarcar(null)
      setMotivo('')
      recarregar()
    },
    onError: deuErro,
  })
  const desfazer = trpc.pedidosTrocados.desfazerCerto.useMutation({ onSuccess: () => recarregar(), onError: deuErro })
  const moverMut = trpc.pedidosTrocados.moverParaCerto.useMutation({
    onSuccess: (r) => {
      setAviso({
        ok: true,
        texto: `Pedido ${r.docNum} movido para ${r.para}.${r.cardVoltouPara === 'card removido' ? ' O card errado (criado pelo SAP) saiu.' : r.cardVoltouPara ? ` O card errado voltou para "${r.cardVoltouPara}".` : ''}`,
      })
      setMover(null)
      recarregar()
    },
    onError: (e) => {
      setMover(null)
      deuErro(e)
    },
  })

  const todos = data?.itens ?? []
  const empresas = [...new Map(todos.map((i) => [i.empresaId, i.empresa])).entries()]
  const pendentes = (t: Tipo) => todos.filter((i) => i.tipo === t && !i.ignorado && (!empresa || String(i.empresaId) === empresa))
  const lista = todos.filter((i) => i.tipo === tipo && (verCertos || !i.ignorado) && (!empresa || String(i.empresaId) === empresa))
  const explica = TIPOS.find((t) => t.id === tipo)!.explica

  const fichaCliente = (id: number, empresaId: number, texto: string) =>
    empresaId === empresaAtivaId ? (
      <Link to={`/admin/clientes/${id}`} className="hover:underline">
        {texto}
      </Link>
    ) : (
      <span title="Troque para a empresa desse cliente para abrir a ficha">{texto}</span>
    )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <Shuffle size={20} className="text-amber-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Pedidos trocados (SAP × CRM)</h1>
            <p className="text-sm text-dark-400">Pedido do SAP que no CRM está em outro cliente. O CRM revisa sozinho de 30 em 30 min.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {empresas.length > 1 && (
            <label className="text-sm text-dark-300">
              <span className="block mb-1">Empresa</span>
              <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-dark-100">
                <option value="">Todas</option>
                {empresas.map(([id, nome]) => (
                  <option key={id} value={String(id)}>
                    {nome}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button variant="secondary" onClick={() => revisar.mutate()} loading={revisar.isPending}>
            <RefreshCw size={15} /> Revisar agora
          </Button>
        </div>
      </div>

      <ComoUsar
        chave="pedidos_trocados"
        titulo="Como usar"
        passos={[
          <>Cada linha mostra <b>como está no CRM</b> e <b>como está no SAP</b>. Se os dois clientes são diferentes, o pedido está no lugar errado.</>,
          <>Quando o CRM acha o <b>cadastro certo</b> (o do código do SAP), ele aparece embaixo — é pra lá que a venda deveria ir.</>,
          <>Se na verdade está certo (ex.: o mesmo cliente com dois nomes), clique em <b>Está certo</b> e escreva o porquê — sai da lista.</>,
          <>
            Regra do CRM: pedido do SAP só entra no cadastro com <b>o mesmo código do SAP</b>, na empresa da filial. Cliente sem cadastro com o código fica em{' '}
            <Link to="/admin/clientes-sap" className="text-gold-400 hover:underline">Clientes do SAP p/ cadastrar</Link> (Cadastrar ou Ligar a um cadastro).
          </>,
          <>Venda no cliente errado com o cadastro certo achado: clique em <b>Mover para o cadastro certo</b>. Nada muda sozinho — só quando alguém clica.</>,
        ]}
      />

      {data && (
        <p className="text-xs text-dark-500">
          Última revisão: {dataHora(data.rodadoEm)} · {data.pedidosLidos} pedidos dos últimos 60 dias{' '}
          {data.fonte === 'crm' ? '(SAP fora do ar — usou os dados do SAP que o CRM já tinha guardado)' : 'lidos do SAP'}
        </p>
      )}

      {aviso && (
        <div className={`rounded-xl border px-4 py-2 text-sm ${aviso.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-red-500/40 bg-red-500/10 text-red-200'}`}>
          {aviso.texto}
        </div>
      )}

      {isLoading && <p className="text-sm text-dark-400">Revisando… (a primeira vez lê os pedidos do SAP, pode levar um minuto)</p>}
      {error && <p className="text-sm text-red-300">{error.message}</p>}

      {data && (
        <>
          <div className="flex flex-wrap gap-2">
            {TIPOS.map((t) => {
              const n = pendentes(t.id).length
              return (
                <button
                  key={t.id}
                  onClick={() => setTipo(t.id)}
                  className={`px-3 py-2 rounded-xl border text-sm ${tipo === t.id ? 'bg-amber-500/15 border-amber-500/50 text-amber-100' : 'bg-dark-800 border-dark-600 text-dark-300 hover:text-dark-100'}`}
                >
                  {t.label} <span className={`ml-1 font-bold ${n ? 'text-amber-300' : 'text-dark-500'}`}>{n}</span>
                </button>
              )
            })}
            <label className="flex items-center gap-2 text-sm text-dark-400 ml-auto">
              <input type="checkbox" checked={verCertos} onChange={(e) => setVerCertos(e.target.checked)} /> mostrar os marcados "está certo"
            </label>
          </div>

          <p className="text-sm text-dark-400">{explica}</p>

          {lista.length === 0 ? (
            <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">Nenhum. 👍</p>
          ) : (
            <div className="space-y-3">
              {lista.map((i) => (
                <div key={i.chave} className={`bg-dark-800 border rounded-2xl p-4 space-y-3 ${i.ignorado ? 'border-dark-700 opacity-60' : 'border-amber-500/30'}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    {i.pedido && <span className="font-mono font-bold text-dark-100">Pedido {i.pedido}</span>}
                    <span className="text-dark-400">{dataBr(i.data)}</span>
                    {i.valor != null && <span className="font-mono text-dark-200">{formatarMoeda(i.valor)}</span>}
                    <span className="text-xs px-2 py-0.5 rounded-full bg-dark-700 text-dark-300">{i.empresa}</span>
                    {i.vendedor && <span className="text-dark-400">vendedor: {i.vendedor}</span>}
                    {i.vendaAutomatica != null && <span className="text-xs text-dark-500">{i.vendaAutomatica ? 'venda criada pelo SAP' : 'venda digitada'}</span>}
                    {i.naExpedicao && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-200 inline-flex items-center gap-1">
                        <Package size={12} /> expedição: {i.naExpedicao}
                      </span>
                    )}
                  </div>

                  <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr] items-center">
                    <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2">
                      <p className="text-xs text-red-300">No CRM está em</p>
                      <p className="text-sm text-dark-100 font-semibold">{fichaCliente(i.clienteId, i.empresaId, `${i.clienteCodigo} · ${i.clienteNome}`)}</p>
                    </div>
                    <ArrowRight size={16} className="text-dark-500 hidden md:block" />
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2">
                      <p className="text-xs text-emerald-300">No SAP é de</p>
                      <p className="text-sm text-dark-100 font-semibold">
                        {i.sapCodigo} · {i.sapNome}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-dark-400">{i.detalhe}</p>
                  {i.certoId && (
                    <p className="text-sm text-emerald-200">
                      Cadastro certo no CRM: {fichaCliente(i.certoId, i.empresaId, i.certoNome ?? '')}
                    </p>
                  )}
                  {!i.certoId && i.tipo !== 'cadastro_outro_nome' && <p className="text-xs text-amber-200">O cliente do SAP não está cadastrado nesta empresa do CRM.</p>}

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {i.ignorado ? (
                      <>
                        <span className="text-xs text-dark-400">
                          Está certo — {i.ignorado.motivo} ({i.ignorado.por})
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => desfazer.mutate({ chave: i.chave })} loading={desfazer.isPending}>
                          <Undo2 size={14} /> Voltar pra lista
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setMarcar({ chave: i.chave, titulo: `Pedido ${i.pedido ?? ''} — está certo?` })}>
                          <Check size={14} /> Está certo
                        </Button>
                        {i.tipo === 'venda_outro_cliente' && i.vendaId && i.certoId && (
                          <Button size="sm" onClick={() => setMover({ chave: i.chave, vendaId: i.vendaId!, pedido: i.pedido, de: i.clienteNome, para: i.certoNome ?? i.sapNome })}>
                            <MoveRight size={14} /> Mover para o cadastro certo
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={!!mover} onClose={() => setMover(null)} title={`Mover o pedido ${mover?.pedido ?? ''}`} size="md">
        <div className="space-y-3 text-sm text-dark-300">
          <p>
            A venda sai de <b className="text-red-200">{mover?.de}</b> e entra em <b className="text-emerald-200">{mover?.para}</b>, no card do mês de quem fez o
            pedido (ou do dono do cliente), igual à venda automática.
          </p>
          <p>O card errado volta para a etapa de antes do Fechado (ou some, se foi criado só pra essa venda). Fica tudo no histórico.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMover(null)}>
              Cancelar
            </Button>
            <Button loading={moverMut.isPending} onClick={() => mover && moverMut.mutate({ chave: mover.chave, vendaId: mover.vendaId })}>
              Mover
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!marcar} onClose={() => setMarcar(null)} title={marcar?.titulo ?? ''} size="md">
        <div className="space-y-3">
          <p className="text-sm text-dark-300">Sai da lista de revisão (não muda nada na venda). Dá pra desfazer em "mostrar os marcados".</p>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            placeholder="Ex.: é o mesmo cliente, cadastro com nome fantasia"
            className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMarcar(null)}>
              Cancelar
            </Button>
            <Button disabled={motivo.trim().length < 3} loading={certo.isPending} onClick={() => marcar && certo.mutate({ chave: marcar.chave, motivo })}>
              Está certo
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
