// "Gerar proposta" (Odin Compressores) — pedido do João, 2026-11-17. Monta
// o PDF da proposta a partir dos PowerPoints modelo da Odin: escolhe o
// conjunto, confere cliente/itens/valores/pagamento e gera. O que for
// digitado fica salvo na proposta (próxima versão já vem preenchida).
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowDown, ArrowUp, FileDown, FileText, Plus, Search, Trash2, AlertTriangle } from 'lucide-react'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { Input } from './ui/Input'
import Select from './ui/Select'
import { parseValorBr, formatarValorInput } from '../lib/valorBr'
import { formatarDocumento } from '../lib/documentoCliente'

type Item = { ficha: string | null; descricao: string; qtd: string; valor: string; valor2: string }
type TipoPg = 'normal' | 'dupla' | 'credito'
type Cliente = { razao: string; cnpj: string; ie: string; endereco: string; bairro: string; cidade: string; contato: string; email: string; telefone: string }

const CLIENTE_VAZIO: Cliente = { razao: '', cnpj: '', ie: '', endereco: '', bairro: '', cidade: '', contato: '', email: '', telefone: '' }
const FAMILIAS: Record<string, string> = { compressor: 'Compressores', secador: 'Secadores', separador: 'Separadores de condensado', filtro: 'Filtros', outro: 'Outros' }
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function GerarPropostaModal({ propostaId, open, onClose }: { propostaId: number; open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data: modelos, isLoading: carregandoModelos } = trpc.propostas.gerador.modelos.useQuery(undefined, { enabled: open })
  const { data: dados, isLoading: carregandoDados } = trpc.propostas.gerador.dados.useQuery({ propostaId }, { enabled: open })

  const [carregado, setCarregado] = useState(false)
  const [conjunto, setConjunto] = useState('')
  const [numero, setNumero] = useState('')
  const [data, setData] = useState('')
  const [cliente, setCliente] = useState<Cliente>(CLIENTE_VAZIO)
  const [itens, setItens] = useState<Item[]>([])
  const [tipoPg, setTipoPg] = useState<TipoPg>('normal')
  const [condicao, setCondicao] = useState('1 + 5x')
  const [entrega, setEntrega] = useState('A Pronta Entrega')
  const [frete, setFrete] = useState('FOB')
  const [validade, setValidade] = useState('15 DIAS')
  const [credito, setCredito] = useState('')
  const [assinatura, setAssinatura] = useState<string[]>(['', ''])
  const [cnpjBusca, setCnpjBusca] = useState('')
  const [novaFicha, setNovaFicha] = useState('')

  // Preenche uma vez quando abre: o que já foi salvo, senão a sugestão do card.
  useEffect(() => {
    if (!open) {
      setCarregado(false)
      return
    }
    if (carregado || !dados || !modelos) return
    const s = dados.salvos
    if (s) {
      setConjunto(s.conjunto ?? '')
      setNumero(s.numero ?? '')
      setData(s.data || dados.sugestao.data)
      setCliente({ ...CLIENTE_VAZIO, ...(s.cliente ?? {}), cnpj: s.cliente?.cnpj || formatarDocumento(dados.sugestao.cnpj) })
      setItens((s.itens ?? []).map((it) => ({ ficha: it.ficha, descricao: it.descricao, qtd: String(it.qtd), valor: formatarValorInput(it.valor), valor2: it.valor2 != null ? formatarValorInput(it.valor2) : '' })))
      if (s.pagamento) {
        setTipoPg(s.pagamento.tipo)
        setCondicao(s.pagamento.condicao)
        setEntrega(s.pagamento.entrega)
        setFrete(s.pagamento.frete)
        setValidade(s.pagamento.validade)
        setCredito(s.pagamento.credito ? formatarValorInput(s.pagamento.credito) : '')
      }
      setAssinatura([...(s.assinatura ?? []), '', ''].slice(0, 2))
    } else {
      setNumero(dados.sugestao.numero)
      setData(dados.sugestao.data)
      setCliente({ ...CLIENTE_VAZIO, razao: dados.sugestao.clienteNome, telefone: dados.sugestao.clienteWhatsapp, cnpj: formatarDocumento(dados.sugestao.cnpj) })
      setAssinatura([...dados.sugestao.assinatura, '', ''].slice(0, 2))
    }
    setCarregado(true)
  }, [open, dados, modelos, carregado])

  const fichasPorId = useMemo(() => new Map((modelos?.fichas ?? []).map((f) => [f.id, f])), [modelos])
  const conjuntoAtual = modelos?.conjuntos.find((c) => c.id === conjunto)

  function escolherConjunto(id: string) {
    const c = modelos?.conjuntos.find((x) => x.id === id)
    setConjunto(id)
    if (!c) return
    const temValor = itens.some((it) => it.valor.trim())
    if (itens.length && temValor && !window.confirm('Trocar o conjunto troca a lista de itens pela do novo conjunto (os valores digitados saem). Continuar?')) return
    setItens(c.itens.map((it) => ({ ficha: it.ficha, descricao: it.descricao, qtd: String(it.qtd), valor: '', valor2: '' })))
  }

  function mudarItem(i: number, campo: keyof Item, v: string) {
    setItens((prev) => prev.map((it, k) => (k === i ? { ...it, [campo]: v } : it)))
  }
  function moverItem(i: number, d: -1 | 1) {
    setItens((prev) => {
      const j = i + d
      if (j < 0 || j >= prev.length) return prev
      const n = [...prev]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
  }
  function adicionarItem() {
    if (novaFicha === '__sem__') setItens((p) => [...p, { ficha: null, descricao: '', qtd: '1', valor: '', valor2: '' }])
    else {
      const f = fichasPorId.get(novaFicha)
      if (!f) return toast.error('Escolha o item que vai entrar')
      setItens((p) => [...p, { ficha: f.id, descricao: f.descricao, qtd: '1', valor: '', valor2: '' }])
    }
    setNovaFicha('')
  }

  const cnpjQuery = trpc.clientes.cnpjLookup.useQuery({ cnpj: cnpjBusca }, { enabled: !!cnpjBusca, retry: false })
  useEffect(() => {
    if (!cnpjBusca || cnpjQuery.isFetching) return
    if (cnpjQuery.error) toast.error(cnpjQuery.error.message)
    else if (cnpjQuery.data === null) toast.error('CNPJ não encontrado na Receita')
    else if (cnpjQuery.data) {
      const r = cnpjQuery.data
      setCliente((c) => ({
        ...c,
        razao: r.razaoSocial || c.razao,
        ie: r.inscricaoEstadual || c.ie,
        endereco: [r.endereco, r.numero].filter(Boolean).join(', ') || c.endereco,
        bairro: r.bairro || c.bairro,
        cidade: r.cidade ? `${r.cidade}/${r.estado}${r.cep ? `, ${r.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : ''}` : c.cidade,
        email: c.email || r.email || '',
        telefone: c.telefone || r.telefone || '',
      }))
      toast.success('Dados do CNPJ preenchidos — confira')
    }
    setCnpjBusca('')
  }, [cnpjBusca, cnpjQuery.isFetching, cnpjQuery.data, cnpjQuery.error])

  const total = itens.reduce((s, it) => s + (parseValorBr(it.valor) || 0), 0)
  const total2 = itens.reduce((s, it) => s + (parseValorBr(it.valor2) || 0), 0)
  const valorCredito = parseValorBr(credito) || 0

  function montarDados() {
    return {
      conjunto,
      numero: numero.trim(),
      data: data.trim(),
      cliente,
      itens: itens.map((it) => ({
        ficha: it.ficha,
        descricao: it.descricao.trim(),
        qtd: Math.max(1, Math.round(Number(it.qtd) || 1)),
        valor: parseValorBr(it.valor) || 0,
        valor2: tipoPg === 'dupla' ? parseValorBr(it.valor2) || 0 : null,
      })),
      pagamento: { tipo: tipoPg, condicao, entrega, frete, validade, credito: tipoPg === 'credito' ? valorCredito : null },
      assinatura: assinatura.map((l) => l.trim()).filter(Boolean),
    }
  }

  const salvarMut = trpc.propostas.gerador.salvar.useMutation({
    onSuccess: () => {
      toast.success('Rascunho salvo')
      utils.propostas.gerador.dados.invalidate({ propostaId })
    },
    onError: (e) => toast.error(e.message),
  })
  const gerarMut = trpc.propostas.gerador.gerar.useMutation({
    onSuccess: (r) => {
      utils.propostas.gerador.dados.invalidate({ propostaId })
      if (r.formato === 'pptx') {
        const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }))
        const a = document.createElement('a')
        a.href = url
        a.download = r.nome
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
        toast.success('PowerPoint baixado')
        return
      }
      toast.success('Proposta gerada e anexada')
      utils.propostas.listarArquivos.invalidate({ propostaId })
      utils.propostas.listar.invalidate()
      window.open(`/proposta-arquivo/${r.nomeArmazenado}`, '_blank')
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  function gerar(formato: 'pdf' | 'pptx') {
    if (!conjunto) return toast.error('Escolha o conjunto (modelo da proposta)')
    if (!cliente.razao.trim()) return toast.error('Informe a razão social do cliente')
    if (!itens.length) return toast.error('A proposta precisa de pelo menos 1 item')
    if (itens.some((it) => !it.descricao.trim())) return toast.error('Todo item precisa de descrição')
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data.trim())) return toast.error('Data no formato dd/mm/aaaa')
    gerarMut.mutate({ propostaId, dados: montarDados(), formato })
  }

  const fichasAgrupadas = useMemo(() => {
    const g = new Map<string, { value: string; label: string }[]>()
    for (const f of modelos?.fichas ?? []) {
      const k = FAMILIAS[f.familia] ?? 'Outros'
      g.set(k, [...(g.get(k) ?? []), { value: f.id, label: `${f.titulo}${f.codigo && f.codigo !== '-' ? ` (${f.codigo})` : ''}` }])
    }
    return [...g.entries()].map(([k, v]) => [k, v.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true }))] as const)
  }, [modelos])

  const carregando = carregandoModelos || carregandoDados || !carregado
  const sec = 'rounded-xl border border-dark-600 p-4 space-y-3'
  const tit = 'text-xs font-semibold text-dark-400 uppercase tracking-wide'

  return (
    <Modal open={open} onClose={onClose} title="Gerar proposta" size="xl">
      <div className="p-5 space-y-4 max-h-[78vh] overflow-y-auto">
        {modelos && !modelos.disponivel ? (
          <p className="text-sm text-amber-400">Os modelos de proposta ainda não foram carregados no servidor.</p>
        ) : carregando ? (
          <p className="text-sm text-dark-400">Carregando…</p>
        ) : (
          <>
            <div className={sec}>
              <p className={tit}>Modelo da proposta</p>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_130px] gap-3">
                <Select
                  label="Conjunto (capa e itens padrão)"
                  value={conjunto}
                  onChange={(e) => escolherConjunto(e.target.value)}
                  placeholder="Escolha…"
                  options={(modelos?.conjuntos ?? []).map((c) => ({ value: c.id, label: c.nome }))}
                />
                <Input label="Nº da proposta" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="D.C012599" />
                <Input label="Data" value={data} onChange={(e) => setData(e.target.value)} placeholder="dd/mm/aaaa" />
              </div>
              {(dados?.sugestao.produtosCard || dados?.sugestao.formaPagamentoCard) && (
                <p className="text-xs text-dark-500">
                  No card: {dados?.sugestao.produtosCard ? <span className="text-dark-300">{resumoProdutos(dados.sugestao.produtosCard)}</span> : null}
                  {dados?.sugestao.formaPagamentoCard ? <> · pagamento: <span className="text-dark-300">{dados.sugestao.formaPagamentoCard}</span></> : null}
                </p>
              )}
            </div>

            <div className={sec}>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input label="CNPJ" value={cliente.cnpj} onChange={(e) => setCliente({ ...cliente, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
                </div>
                <Button size="sm" variant="secondary" loading={cnpjQuery.isFetching} onClick={() => (cliente.cnpj.replace(/\D/g, '').length === 14 ? setCnpjBusca(cliente.cnpj) : toast.error('Digite o CNPJ completo'))}>
                  <Search size={13} className="mr-1" /> Buscar dados
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Razão social *" value={cliente.razao} onChange={(e) => setCliente({ ...cliente, razao: e.target.value })} />
                <Input label="I.E" value={cliente.ie} onChange={(e) => setCliente({ ...cliente, ie: e.target.value })} />
                <Input label="Endereço" value={cliente.endereco} onChange={(e) => setCliente({ ...cliente, endereco: e.target.value })} placeholder="Rua, número" />
                <Input label="Bairro" value={cliente.bairro} onChange={(e) => setCliente({ ...cliente, bairro: e.target.value })} />
                <Input label="Cidade/UF, CEP" value={cliente.cidade} onChange={(e) => setCliente({ ...cliente, cidade: e.target.value })} placeholder="Joinville/SC, 89200-000" />
                <Input label="Aos cuidados (nome)" value={cliente.contato} onChange={(e) => setCliente({ ...cliente, contato: e.target.value })} />
                <Input label="E-mail" value={cliente.email} onChange={(e) => setCliente({ ...cliente, email: e.target.value })} />
                <Input label="Telefone" value={cliente.telefone} onChange={(e) => setCliente({ ...cliente, telefone: e.target.value })} />
              </div>
              <p className="text-[11px] text-dark-500">Campo vazio sai como "(não informado)", igual nos modelos.</p>
            </div>

            <div className={sec}>
              <div className="flex items-center justify-between">
                <p className={tit}>Itens</p>
                <p className="text-xs text-dark-500">Cada item com ficha técnica ganha uma página (ITEM 01, 02…)</p>
              </div>
              {itens.length === 0 && <p className="text-xs text-dark-500 text-center py-2">Escolha o conjunto acima pra trazer os itens</p>}
              {itens.map((it, i) => {
                const f = it.ficha ? fichasPorId.get(it.ficha) : null
                return (
                  <div key={i} className="rounded-lg bg-dark-900 p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-dark-400 w-6">{String(i + 1).padStart(2, '0')}</span>
                      <input
                        value={it.descricao}
                        onChange={(e) => mudarItem(i, 'descricao', e.target.value)}
                        placeholder="Descrição na tabela de condições"
                        className="flex-1 min-w-0 bg-dark-800 border border-dark-600 rounded-lg px-2.5 py-1.5 text-sm text-dark-100 focus:outline-none focus:border-gold-600"
                      />
                      <button onClick={() => moverItem(i, -1)} className="text-dark-500 hover:text-dark-200 p-1" title="Subir"><ArrowUp size={14} /></button>
                      <button onClick={() => moverItem(i, 1)} className="text-dark-500 hover:text-dark-200 p-1" title="Descer"><ArrowDown size={14} /></button>
                      <button onClick={() => setItens((p) => p.filter((_x, k) => k !== i))} className="text-dark-500 hover:text-red-400 p-1" title="Tirar item"><Trash2 size={14} /></button>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap pl-8">
                      <label className="text-xs text-dark-400">Qtd</label>
                      <input value={it.qtd} onChange={(e) => mudarItem(i, 'qtd', e.target.value.replace(/\D/g, ''))} className="w-14 bg-dark-800 border border-dark-600 rounded-lg px-2 py-1 text-sm text-dark-100 text-center" />
                      <label className="text-xs text-dark-400 ml-2">{tipoPg === 'dupla' ? 'Valor 1+5' : 'Valor'} R$</label>
                      <input value={it.valor} onChange={(e) => mudarItem(i, 'valor', e.target.value)} inputMode="decimal" placeholder="0,00" className="w-32 bg-dark-800 border border-dark-600 rounded-lg px-2 py-1 text-sm text-dark-100 text-right" />
                      {tipoPg === 'dupla' && (
                        <>
                          <label className="text-xs text-dark-400 ml-2">Valor 1+9 R$</label>
                          <input value={it.valor2} onChange={(e) => mudarItem(i, 'valor2', e.target.value)} inputMode="decimal" placeholder="0,00" className="w-32 bg-dark-800 border border-dark-600 rounded-lg px-2 py-1 text-sm text-dark-100 text-right" />
                        </>
                      )}
                      <span className={`text-[11px] ml-auto ${f ? 'text-dark-500' : 'text-amber-500'}`}>{f ? `Ficha: ${f.titulo}${f.codigo && f.codigo !== '-' ? ` · ${f.codigo}` : ''}` : 'Sem ficha técnica (só na tabela)'}</span>
                    </div>
                  </div>
                )
              })}
              <div className="flex items-center gap-2 pt-1">
                <select value={novaFicha} onChange={(e) => setNovaFicha(e.target.value)} className="flex-1 min-w-0 bg-dark-800 border border-dark-600 rounded-lg px-2.5 py-1.5 text-sm text-dark-100">
                  <option value="">Acrescentar item…</option>
                  <option value="__sem__">Item sem ficha técnica (ex.: dreno, boia, instalação)</option>
                  {fichasAgrupadas.map(([g, ops]) => (
                    <optgroup key={g} label={g}>
                      {ops.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Button size="sm" variant="secondary" onClick={adicionarItem} disabled={!novaFicha}>
                  <Plus size={13} className="mr-1" /> Acrescentar
                </Button>
              </div>
            </div>

            <div className={sec}>
              <p className={tit}>Condições comerciais</p>
              <div className="flex gap-2 flex-wrap">
                {([
                  ['normal', 'Um valor'],
                  ['dupla', '1+5 e 1+9 lado a lado'],
                  ['credito', 'Com crédito (desconto)'],
                ] as [TipoPg, string][])
                  .filter(([t]) => t === 'normal' || (t === 'dupla' ? modelos?.temDupla : modelos?.temCredito))
                  .map(([t, l]) => (
                    <button
                      key={t}
                      onClick={() => setTipoPg(t)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${tipoPg === t ? 'bg-gold-600 text-dark-950 border-gold-600 font-medium' : 'bg-dark-800 text-dark-300 border-dark-600 hover:bg-dark-700'}`}
                    >
                      {l}
                    </button>
                  ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Input label="Condição de pagamento" value={condicao} onChange={(e) => setCondicao(e.target.value)} />
                <Input label="Previsão de entrega" value={entrega} onChange={(e) => setEntrega(e.target.value)} />
                <Input label="Frete" value={frete} onChange={(e) => setFrete(e.target.value)} />
                <Input label="Validade" value={validade} onChange={(e) => setValidade(e.target.value)} />
              </div>
              {tipoPg === 'credito' && (
                <div className="w-48">
                  <Input label="Crédito ref. compressor (R$)" value={credito} onChange={(e) => setCredito(e.target.value)} inputMode="decimal" placeholder="0,00" />
                </div>
              )}
              <div className="rounded-lg bg-dark-900 px-3 py-2 text-sm flex flex-wrap gap-x-6 gap-y-1">
                <span className="text-dark-400">
                  Total{tipoPg === 'dupla' ? ' 1+5' : ''}: <strong className="text-dark-100">{brl(total)}</strong>
                </span>
                {tipoPg === 'dupla' && (
                  <span className="text-dark-400">
                    Total 1+9: <strong className="text-dark-100">{brl(total2)}</strong>
                  </span>
                )}
                {tipoPg === 'credito' && (
                  <span className="text-dark-400">
                    Total final: <strong className="text-gold-400">{brl(total - valorCredito)}</strong>
                  </span>
                )}
              </div>
            </div>

            <div className={sec}>
              <p className={tit}>Assinatura (página da garantia)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Linha 1" value={assinatura[0]} onChange={(e) => setAssinatura([e.target.value, assinatura[1]])} placeholder="Nome – telefone" />
                <Input label="Linha 2 (opcional)" value={assinatura[1]} onChange={(e) => setAssinatura([assinatura[0], e.target.value])} placeholder="Distribuidor: …" />
              </div>
            </div>

            {conjuntoAtual && (modelos?.avisos?.length ?? 0) > 0 && <AvisosModelos avisos={modelos!.avisos} />}
          </>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 flex-wrap border-t border-dark-700 px-5 py-3">
        <Button size="sm" variant="ghost" onClick={() => salvarMut.mutate({ propostaId, dados: montarDados() })} loading={salvarMut.isPending} disabled={carregando}>
          Salvar rascunho
        </Button>
        <Button size="sm" variant="secondary" onClick={() => gerar('pptx')} loading={gerarMut.isPending && gerarMut.variables?.formato === 'pptx'} disabled={carregando || gerarMut.isPending}>
          <FileDown size={14} className="mr-1" /> Baixar PowerPoint
        </Button>
        <Button size="sm" onClick={() => gerar('pdf')} loading={gerarMut.isPending && gerarMut.variables?.formato === 'pdf'} disabled={carregando || gerarMut.isPending}>
          <FileText size={14} className="mr-1" /> Gerar PDF e anexar
        </Button>
      </div>
    </Modal>
  )
}

function resumoProdutos(json: string) {
  try {
    const l = JSON.parse(json) as { modelo: string; qtd: number; voltagem?: string }[]
    return l.map((p) => `${p.qtd}x ${p.modelo}${p.voltagem ? ` ${p.voltagem}` : ''}`).join(', ')
  } catch {
    return ''
  }
}

function AvisosModelos({ avisos }: { avisos: string[] }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className="rounded-lg border border-amber-700/40 bg-amber-900/10 px-3 py-2 text-xs">
      <button onClick={() => setAberto(!aberto)} className="flex items-center gap-1.5 text-amber-400 font-medium">
        <AlertTriangle size={13} /> {avisos.length} pontos a conferir nos modelos PowerPoint {aberto ? '▲' : '▼'}
      </button>
      {aberto && (
        <ul className="mt-2 space-y-0.5 text-dark-300 list-disc pl-5">
          {avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
