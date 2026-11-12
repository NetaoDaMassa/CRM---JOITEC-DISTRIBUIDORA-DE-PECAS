import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { UserCheck, CheckCircle2, Undo2, ArrowLeft } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import { STATUS, contatosDe, dataHora, indicadoresDoGrupo, type Dados } from '../CadastroClientesSap'

// Aprovação de cadastros de cliente feitos no CRM (Izabelly do financeiro,
// 2026-11-12). Igual ela faz hoje no SAP: confere os dados, corrige o fiscal
// se precisar e aprova — o CRM ativa o cliente no SAP, marca todas as formas
// de pagamento e avisa o vendedor. Ou devolve com o motivo.

export default function AprovacaoCadastros() {
  const [ver, setVer] = useState<'aguardando' | 'todos'>('aguardando')
  const [aberto, setAberto] = useState<number | null>(null)
  const { data, isLoading } = trpc.cadastrosClientes.fila.useQuery({ ver })
  if (aberto) return <Detalhe id={aberto} onFechar={() => setAberto(null)} />
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <UserCheck size={20} className="text-emerald-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Aprovação de cadastros</h1>
            <p className="text-sm text-dark-400">Clientes cadastrados pelos vendedores no CRM — já estão no SAP como inativos esperando você</p>
          </div>
        </div>
        <div className="flex gap-1">
          {([
            { v: 'aguardando', l: 'Esperando aprovação' },
            { v: 'todos', l: 'Todos' },
          ] as const).map((x) => (
            <button
              key={x.v}
              type="button"
              onClick={() => setVer(x.v)}
              className={`text-sm rounded-lg px-3 py-2 border ${ver === x.v ? 'border-gold-600 text-gold-300' : 'border-dark-600 text-dark-300 hover:bg-dark-800'}`}
            >
              {x.l}
            </button>
          ))}
        </div>
      </div>
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 overflow-x-auto">
        {isLoading ? (
          <div className="h-32 animate-pulse" />
        ) : !data?.length ? (
          <p className="text-sm text-dark-400">{ver === 'aguardando' ? 'Nenhum cadastro esperando aprovação. 🎉' : 'Nenhum cadastro ainda.'}</p>
        ) : (
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="text-xs text-dark-400 text-left">
                <th className="py-2 pr-3 font-medium">Situação</th>
                <th className="py-2 pr-3 font-medium">Cliente</th>
                <th className="py-2 pr-3 font-medium">Código SAP</th>
                <th className="py-2 pr-3 font-medium">Empresa</th>
                <th className="py-2 pr-3 font-medium">Vendedor</th>
                <th className="py-2 pr-3 font-medium">Cidade</th>
                <th className="py-2 font-medium">Enviado</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-t border-dark-700/70 cursor-pointer hover:bg-dark-700/40" onClick={() => setAberto(c.id)}>
                  <td className="py-2 pr-3">
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS[c.status].cls}`}>{STATUS[c.status].l}</span>
                  </td>
                  <td className="py-2 pr-3 text-dark-100">
                    {c.nome}
                    <span className="block text-xs text-dark-500">{c.documento}</span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-dark-200">{c.cardCode ?? '—'}</td>
                  <td className="py-2 pr-3 text-dark-300">{c.empresa}</td>
                  <td className="py-2 pr-3 text-dark-300">{c.vendedor}</td>
                  <td className="py-2 pr-3 text-dark-300">{c.cidade}</td>
                  <td className="py-2 text-dark-400 whitespace-nowrap">{dataHora(c.enviadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Linha({ l, v }: { l: string; v: string | null | undefined }) {
  return (
    <div className="flex gap-2 text-sm py-1 border-b border-dark-700/50">
      <span className="w-44 shrink-0 text-dark-400">{l}</span>
      <span className="text-dark-100 break-words">{v || '—'}</span>
    </div>
  )
}

function Detalhe({ id, onFechar }: { id: number; onFechar: () => void }) {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.cadastrosClientes.detalheAprovacao.useQuery({ id })
  const [aj, setAj] = useState<{ grupoTributario: string; indicadorIE: string; indicadorConsumidor: string; grupoCliente: number; prazoCodigo: number; listaPreco: number; limiteCredito: number; filiais: number[] } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [devolvendo, setDevolvendo] = useState(false)
  useEffect(() => {
    if (data && !aj) {
      const d = data.dados as Dados
      setAj({
        grupoTributario: d.grupoTributario,
        indicadorIE: d.indicadorIE,
        indicadorConsumidor: d.indicadorConsumidor,
        grupoCliente: d.grupoCliente,
        prazoCodigo: d.prazoCodigo,
        listaPreco: d.listaPreco,
        limiteCredito: d.limiteCredito ?? 0,
        filiais: d.filiais?.length ? d.filiais : data.opcoes.filiais.map((f) => f.v),
      })
    }
  }, [data, aj])
  // A aprovação de verdade é no SAP (João, 2026-11-12): aqui só confere.
  const conferir = trpc.cadastrosClientes.conferirNoSap.useMutation({
    onSuccess: (r) => {
      if (r.aprovado) {
        toast.success(`${r.cardCode} está Ativo no SAP — marcado como aprovado e o vendedor foi avisado.`, { duration: 6000 })
        utils.cadastrosClientes.invalidate()
        onFechar()
      } else toast.error(`${r.cardCode} ainda está Inativo no SAP. Ative lá (Ativo + boletos em Execução do pagamento) e confira de novo.`, { duration: 8000 })
    },
    onError: (e) => toast.error(e.message, { duration: 8000 }),
  })
  const devolver = trpc.cadastrosClientes.devolver.useMutation({
    onSuccess: () => {
      toast.success('Devolvido ao vendedor')
      utils.cadastrosClientes.invalidate()
      onFechar()
    },
    onError: (e) => toast.error(e.message),
  })
  if (isLoading || !data || !aj) return <div className="h-60 animate-pulse bg-dark-800 rounded-2xl" />
  const d = data.dados as Dados
  const op = data.opcoes
  const nomeDe = <T extends { v: string | number; l: string }>(lista: readonly T[], v: string | number) => lista.find((x) => String(x.v) === String(v))?.l ?? String(v)
  const endTxt = (e: Dados['cobranca']) => [`${e.tipoLogradouro} ${e.rua}, ${e.numero}`, e.complemento, e.bairro, `${e.cidade} / ${e.uf}`, `CEP ${e.cep}`].filter((x) => x && x.trim()).join(' · ')
  const fone = (ddd: string, n: string) => (n ? `(${ddd}) ${n}` : '')
  const aguardando = data.status === 'aguardando'
  const trocarGrupo = (g: string) => setAj((x) => (x ? { ...x, grupoTributario: g, ...(indicadoresDoGrupo(g, d.ieIsento) ?? {}) } : x))

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onFechar} className="p-2 rounded-lg hover:bg-dark-800 text-dark-300" aria-label="Voltar">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-dark-100">{d.nome}</h1>
          <p className="text-sm text-dark-400">
            <span className={`text-xs font-semibold rounded-full px-2 py-0.5 mr-2 ${STATUS[data.status].cls}`}>{STATUS[data.status].l}</span>
            <span className="font-mono text-dark-200">{data.cardCode}</span> · {data.empresa} · vendedor {data.vendedor} · enviado {dataHora(data.enviadoEm)}
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-200 mb-2">Dados do cliente</h2>
          <Linha l={d.pessoa === 'juridica' ? 'CNPJ' : 'CPF'} v={d.pessoa === 'juridica' ? d.cnpj : d.cpf} />
          {d.pessoa === 'juridica' && <Linha l="Inscrição estadual" v={d.ieIsento ? 'ISENTO' : d.ie} />}
          <Linha l="Nome fantasia" v={d.fantasia} />
          <Linha l="Telefone" v={fone(d.ddd, d.telefone)} />
          <Linha l="Celular" v={fone(d.dddCelular, d.celular)} />
          <Linha l="E-mail" v={d.email} />
          <Linha l="Site" v={d.site} />
          {contatosDe(d).map((c, i) => (
            <Linha key={i} l={i === 0 ? 'Contato principal' : `Contato ${i + 1}`} v={[c.nome, c.cargo, c.telefone, c.celular, c.email].filter(Boolean).join(' · ')} />
          ))}
          <Linha l="Resp. comercial" v={d.respComercial != null ? nomeDe(op.vendedores, d.respComercial) : ''} />
          <Linha l="Uso principal" v={nomeDe(op.usosPrincipais, d.usoPrincipal ?? 10)} />
          <Linha l="Segmento" v={d.segmento != null ? nomeDe(op.segmentos, d.segmento) : ''} />
          <Linha l="Território" v={d.territorio != null ? nomeDe(op.territorios, d.territorio) : ''} />
          <Linha l="Formas de pagamento" v={(d.formasPagamento ?? op.formas.map((f) => f.codigo)).map((c) => op.formas.find((f) => f.codigo === c)?.nome ?? c).join(' · ')} />
          <Linha l="SUFRAMA" v={[d.suframa, d.regiaoSuframa !== '0' ? nomeDe(op.regioesSuframa, d.regiaoSuframa) : ''].filter(Boolean).join(' · ')} />
          <Linha l="Última consulta Serasa" v={d.ultimaConsultaSerasa ? d.ultimaConsultaSerasa.split('-').reverse().join('/') : ''} />
          <Linha l="Endereço de cobrança" v={endTxt(d.cobranca)} />
          <Linha l="Endereço de entrega" v={d.entregaIgual ? 'Mesmo da cobrança' : endTxt(d.entrega)} />
          <Linha l="Observações" v={d.observacoes} />
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-dark-200">Fiscal e comercial <span className="text-dark-500 font-normal">— como o vendedor mandou ao SAP</span></h2>
          <Select label="Grupo tributário" value={aj.grupoTributario} disabled onChange={(e) => trocarGrupo(e.target.value)} options={op.gruposTributarios.map((g) => ({ value: g.v, label: g.l }))} />
          <Select label="Indicador da IE" value={aj.indicadorIE} disabled onChange={(e) => setAj({ ...aj, indicadorIE: e.target.value })} options={op.indicadoresIE.map((g) => ({ value: g.v, label: g.l }))} />
          <Select label="Indicador de op. consumidor" value={aj.indicadorConsumidor} disabled onChange={(e) => setAj({ ...aj, indicadorConsumidor: e.target.value })} options={op.indicadoresConsumidor.map((g) => ({ value: g.v, label: g.l }))} />
          <Select label="Grupo do cliente" value={aj.grupoCliente} disabled onChange={(e) => setAj({ ...aj, grupoCliente: Number(e.target.value) })} options={op.gruposCliente.map((g) => ({ value: g.v, label: g.l }))} />
          <Select label="Condição de pagamento" value={aj.prazoCodigo} disabled onChange={(e) => setAj({ ...aj, prazoCodigo: Number(e.target.value) })} options={op.prazos.map((g) => ({ value: g.v, label: g.l }))} />
          <Select label="Lista de preço" value={aj.listaPreco} disabled onChange={(e) => setAj({ ...aj, listaPreco: Number(e.target.value) })} options={op.listas.map((g) => ({ value: g.v, label: g.l }))} />
          <Input
            label="Limite de crédito (R$)"
            type="number"
            min={0}
            step="0.01"
            value={aj.limiteCredito || ''}
            disabled
            onChange={(e) => setAj({ ...aj, limiteCredito: Math.max(0, Number(e.target.value) || 0) })}
          />
          <div>
            <p className="text-sm text-dark-300 mb-1.5">Atribuição de filial</p>
            <div className="flex flex-wrap gap-2">
              {op.filiais.map((f) => (
                <label key={f.v} className="flex items-center gap-2 text-sm text-dark-200 rounded-lg px-3 py-1.5 border border-dark-600">
                  <input
                    type="checkbox"
                    className="accent-gold-500"
                    disabled
                    checked={aj.filiais.includes(f.v)}
                    onChange={(e) => setAj({ ...aj, filiais: e.target.checked ? [...aj.filiais, f.v] : aj.filiais.filter((x) => x !== f.v) })}
                  />
                  {f.l}
                </label>
              ))}
            </div>
          </div>
          <p className="text-xs text-dark-500">
            A aprovação é no SAP: abra o {data.cardCode} no SAP, corrija o que precisar, marque os boletos e deixe Ativo. O CRM percebe sozinho (de 10 em 10 min) e avisa o vendedor — ou clique em "Já ativei no SAP" pra conferir na hora. Se tiver erro do vendedor, use "Devolver para corrigir".
          </p>
        </div>
      </div>

      {aguardando && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
          {devolvendo ? (
            <>
              <Textarea label="O que o vendedor precisa corrigir?" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: inscrição estadual não confere com a SEFAZ" />
              <div className="flex gap-2">
                <Button variant="danger" loading={devolver.isPending} onClick={() => devolver.mutate({ id, motivo })}>
                  <Undo2 size={15} /> Devolver ao vendedor
                </Button>
                <Button variant="ghost" onClick={() => setDevolvendo(false)}>
                  Cancelar
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button loading={conferir.isPending} onClick={() => conferir.mutate({ id })}>
                <CheckCircle2 size={15} /> Já ativei no SAP — conferir
              </Button>
              <Button variant="danger" onClick={() => setDevolvendo(true)}>
                <Undo2 size={15} /> Devolver para corrigir
              </Button>
            </div>
          )}
        </div>
      )}

      {data.historico.length > 0 && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-200 mb-2">Histórico</h2>
          <ul className="space-y-1 text-xs text-dark-300">
            {[...data.historico].reverse().map((h, i) => (
              <li key={i}>
                <span className="text-dark-500">{dataHora(h.em)}</span> · <b className="text-dark-100">{h.por}</b> — {h.acao}
                {h.detalhe ? <span className="text-dark-400"> · {h.detalhe}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
