import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Search, Trash2, X, Download } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import { Input, Textarea } from '../components/ui/Input'
import { paraCsv, baixarCsv } from '../lib/csv'

const STATUS = [
  { value: 'em_demonstracao', label: 'Em demonstração', cor: 'text-blue-400 bg-blue-900/20 border-blue-700/40' },
  { value: 'aguardando_nf', label: 'Aguardando NF', cor: 'text-amber-400 bg-amber-900/20 border-amber-700/40' },
  { value: 'vendido', label: 'Vendido', cor: 'text-green-400 bg-green-900/20 border-green-700/40' },
  { value: 'retorno_solicitado', label: 'Retorno solicitado', cor: 'text-orange-400 bg-orange-900/20 border-orange-700/40' },
  { value: 'retornado', label: 'Retornado', cor: 'text-dark-300 bg-dark-700/50 border-dark-600' },
] as const

type StatusItem = (typeof STATUS)[number]['value']
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS.map((s) => [s.value, s.label]))
const STATUS_COR: Record<string, string> = Object.fromEntries(STATUS.map((s) => [s.value, s.cor]))

// Máquina que já saiu do radar não é "atrasada" nem entra na conta de quem
// ainda está na rua. Não basta olhar o status: 'aguardando_nf' cobre tanto
// venda quanto retorno sem documento fiscal — se a data de retorno efetivo
// está preenchida, a máquina voltou fisicamente e só falta papelada, então
// não pode aparecer como atrasada.
const STATUS_ENCERRADOS: string[] = ['vendido', 'retornado']
function aindaNaRua(l: { status: string; retornoEfetivoEm: string | null }): boolean {
  return !STATUS_ENCERRADOS.includes(l.status) && !l.retornoEfetivoEm
}

function formatarData(v: string | null): string {
  if (!v) return '—'
  const [ano, mes, dia] = v.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

function hojeIso(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function diasAte(dataIso: string | null): number | null {
  if (!dataIso) return null
  const alvo = new Date(`${dataIso.slice(0, 10)}T00:00:00`)
  const hoje = new Date(`${hojeIso()}T00:00:00`)
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000)
}

type Linha = {
  itemId: number
  demonstracaoId: number
  dataSaida: string
  numeroNotaSaida: string | null
  clienteNome: string
  clienteCidade: string | null
  clienteEstado: string | null
  vendedorId: number | null
  vendedorNome: string | null
  observacao: string | null
  produto: string
  numeroSerie: string | null
  status: string
  retornoPrevistoEm: string | null
  retornoEfetivoEm: string | null
  numeroNotaRetorno: string | null
  dataVenda: string | null
  numeroNotaVenda: string | null
  clienteVenda: string | null
}

// ── Cadastro em 2 etapas ────────────────────────────────────────────────────
function NovaDemonstracaoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data: vendedores } = trpc.demonstracoes.vendedores.useQuery(undefined, { enabled: open && isAdmin })

  const [etapa, setEtapa] = useState<1 | 2>(1)
  const [clienteNome, setClienteNome] = useState('')
  const [clienteCidade, setClienteCidade] = useState('')
  const [clienteEstado, setClienteEstado] = useState('')
  const [vendedorId, setVendedorId] = useState('')
  const [dataSaida, setDataSaida] = useState(hojeIso())
  const [numeroNotaSaida, setNumeroNotaSaida] = useState('')
  const [retornoPrevistoEm, setRetornoPrevistoEm] = useState('')
  const [observacao, setObservacao] = useState('')
  const [itens, setItens] = useState([{ produto: '', numeroSerie: '' }])

  const criarMut = trpc.demonstracoes.criar.useMutation({
    onSuccess() {
      toast.success('Demonstração registrada')
      utils.demonstracoes.listar.invalidate()
      fechar()
    },
    onError: (err) => toast.error(err.message),
  })

  function fechar() {
    setEtapa(1)
    setClienteNome('')
    setClienteCidade('')
    setClienteEstado('')
    setVendedorId('')
    setDataSaida(hojeIso())
    setNumeroNotaSaida('')
    setRetornoPrevistoEm('')
    setObservacao('')
    setItens([{ produto: '', numeroSerie: '' }])
    onClose()
  }

  function irParaProdutos() {
    if (clienteNome.trim().length < 2) return toast.error('Informe o cliente.')
    if (!dataSaida) return toast.error('Informe a data de saída.')
    setEtapa(2)
  }

  function salvar() {
    const validos = itens.filter((i) => i.produto.trim())
    if (!validos.length) return toast.error('Adicione pelo menos um produto.')
    criarMut.mutate({
      clienteNome: clienteNome.trim(),
      clienteCidade: clienteCidade.trim() || undefined,
      clienteEstado: clienteEstado.trim() || undefined,
      vendedorId: isAdmin && vendedorId ? Number(vendedorId) : undefined,
      dataSaida,
      numeroNotaSaida: numeroNotaSaida.trim() || undefined,
      retornoPrevistoEm: retornoPrevistoEm || undefined,
      observacao: observacao.trim() || undefined,
      itens: validos.map((i) => ({ produto: i.produto.trim(), numeroSerie: i.numeroSerie.trim() || undefined })),
    })
  }

  return (
    <Modal open={open} onClose={fechar} title="Nova demonstração" size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs">
          {([1, 2] as const).map((n) => (
            <div key={n} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${etapa === n ? 'border-gold-500 text-gold-400' : 'border-dark-600 text-dark-500'}`}>
              <span className="font-bold">{n}</span>
              {n === 1 ? 'Dados gerais' : 'Produtos enviados'}
            </div>
          ))}
        </div>

        {etapa === 1 ? (
          <div className="space-y-3">
            <Input label="Cliente / revenda" value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} />
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Input label="Cidade" value={clienteCidade} onChange={(e) => setClienteCidade(e.target.value)} />
              </div>
              <Input label="UF" maxLength={2} value={clienteEstado} onChange={(e) => setClienteEstado(e.target.value.toUpperCase())} />
            </div>
            {isAdmin && (
              <Select
                label="Vendedor responsável"
                value={vendedorId}
                onChange={(e) => setVendedorId(e.target.value)}
                placeholder="Eu mesmo"
                options={(vendedores ?? []).map((v) => ({ value: v.id, label: v.name }))}
              />
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Data de saída" type="date" value={dataSaida} onChange={(e) => setDataSaida(e.target.value)} />
              <Input label="NF de saída" value={numeroNotaSaida} onChange={(e) => setNumeroNotaSaida(e.target.value)} />
            </div>
            <Input
              label="Retorno previsto (vale pras máquinas todas)"
              type="date"
              value={retornoPrevistoEm}
              onChange={(e) => setRetornoPrevistoEm(e.target.value)}
            />
            <Textarea label="Observação (opcional)" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            <Button className="w-full" onClick={irParaProdutos}>
              Continuar
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-dark-400">
              Cada produto vira um registro próprio, com status e prazo individuais — todos vinculados à mesma nota
              {numeroNotaSaida ? ` (NF ${numeroNotaSaida})` : ''}.
            </p>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {itens.map((item, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input
                      label={i === 0 ? 'Produto / modelo' : undefined}
                      placeholder="Ex: OD10S"
                      value={item.produto}
                      onChange={(e) => setItens((prev) => prev.map((it, idx) => (idx === i ? { ...it, produto: e.target.value } : it)))}
                    />
                  </div>
                  <div className="flex-1">
                    <Input
                      label={i === 0 ? 'Nº de série' : undefined}
                      placeholder="Ex: 20251016"
                      value={item.numeroSerie}
                      onChange={(e) => setItens((prev) => prev.map((it, idx) => (idx === i ? { ...it, numeroSerie: e.target.value } : it)))}
                    />
                  </div>
                  <button
                    onClick={() => setItens((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)))}
                    disabled={itens.length === 1}
                    className="p-2 mb-0.5 rounded-lg text-dark-500 hover:text-red-400 disabled:opacity-30"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setItens((prev) => [...prev, { produto: '', numeroSerie: '' }])}
              className="text-xs text-gold-400 hover:text-gold-300"
            >
              + Adicionar outro produto
            </button>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" onClick={() => setEtapa(1)}>
                Voltar
              </Button>
              <Button className="flex-1" loading={criarMut.isPending} onClick={salvar}>
                Salvar
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Ficha da máquina (ações individuais + histórico) ────────────────────────
function FichaItemModal({ linha, onClose }: { linha: Linha | null; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data: historico } = trpc.demonstracoes.historicoItem.useQuery({ itemId: linha?.itemId ?? 0 }, { enabled: !!linha })
  const [acao, setAcao] = useState<'venda' | 'retorno' | 'prazo' | null>(null)
  const [conclusao, setConclusao] = useState('')
  // Campos das ações
  const [dataVenda, setDataVenda] = useState(hojeIso())
  const [notaVenda, setNotaVenda] = useState('')
  const [clienteVenda, setClienteVenda] = useState('')
  const [dataRetorno, setDataRetorno] = useState(hojeIso())
  const [notaRetorno, setNotaRetorno] = useState('')
  const [novoPrazo, setNovoPrazo] = useState('')

  function aoConcluir(msg: string) {
    toast.success(msg)
    utils.demonstracoes.listar.invalidate()
    if (linha) utils.demonstracoes.historicoItem.invalidate({ itemId: linha.itemId })
    setAcao(null)
    setNotaVenda('')
    setClienteVenda('')
    setNotaRetorno('')
    setNovoPrazo('')
  }

  const vendaMut = trpc.demonstracoes.registrarVenda.useMutation({
    onSuccess: () => aoConcluir('Venda registrada'),
    onError: (e) => toast.error(e.message),
  })
  const retornoMut = trpc.demonstracoes.registrarRetorno.useMutation({
    onSuccess: () => aoConcluir('Retorno registrado'),
    onError: (e) => toast.error(e.message),
  })
  const prazoMut = trpc.demonstracoes.alterarPrazo.useMutation({
    onSuccess: () => aoConcluir('Prazo alterado'),
    onError: (e) => toast.error(e.message),
  })
  const statusMut = trpc.demonstracoes.alterarStatus.useMutation({
    onSuccess: () => aoConcluir('Status alterado'),
    onError: (e) => toast.error(e.message),
  })
  const conclusaoMut = trpc.demonstracoes.adicionarConclusao.useMutation({
    onSuccess() {
      setConclusao('')
      aoConcluir('Conclusão adicionada')
    },
    onError: (e) => toast.error(e.message),
  })

  if (!linha) return null

  return (
    <Modal open onClose={onClose} title={`${linha.produto}${linha.numeroSerie ? ` · Série ${linha.numeroSerie}` : ''}`} size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_COR[linha.status] ?? ''}`}>
            {STATUS_LABEL[linha.status] ?? linha.status}
          </span>
          <span className="text-xs text-dark-400">
            NF saída {linha.numeroNotaSaida ?? '—'} · {linha.clienteNome}
            {linha.clienteCidade ? ` · ${linha.clienteCidade}/${linha.clienteEstado ?? ''}` : ''}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs bg-dark-900/50 border border-dark-700 rounded-xl p-3">
          <div>
            <p className="text-dark-500">Saiu em</p>
            <p className="text-dark-200">{formatarData(linha.dataSaida)}</p>
          </div>
          <div>
            <p className="text-dark-500">Retorno previsto</p>
            <p className="text-dark-200">{formatarData(linha.retornoPrevistoEm)}</p>
          </div>
          <div>
            <p className="text-dark-500">Retorno efetivo</p>
            <p className="text-dark-200">
              {formatarData(linha.retornoEfetivoEm)}
              {linha.numeroNotaRetorno ? ` · NF ${linha.numeroNotaRetorno}` : ''}
            </p>
          </div>
          <div>
            <p className="text-dark-500">Venda</p>
            <p className="text-dark-200">
              {linha.dataVenda ? formatarData(linha.dataVenda) : '—'}
              {linha.numeroNotaVenda ? ` · NF ${linha.numeroNotaVenda}` : ''}
              {linha.clienteVenda ? ` · ${linha.clienteVenda}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={acao === 'venda' ? 'primary' : 'secondary'} onClick={() => setAcao(acao === 'venda' ? null : 'venda')}>
            Registrar venda
          </Button>
          <Button size="sm" variant={acao === 'retorno' ? 'primary' : 'secondary'} onClick={() => setAcao(acao === 'retorno' ? null : 'retorno')}>
            Registrar retorno
          </Button>
          <Button size="sm" variant={acao === 'prazo' ? 'primary' : 'secondary'} onClick={() => setAcao(acao === 'prazo' ? null : 'prazo')}>
            Alterar prazo
          </Button>
          <div className="w-44">
            <Select
              value={linha.status}
              onChange={(e) => statusMut.mutate({ itemId: linha.itemId, status: e.target.value as StatusItem })}
              options={STATUS.map((s) => ({ value: s.value, label: s.label }))}
            />
          </div>
        </div>

        {acao === 'venda' && (
          <div className="space-y-3 bg-dark-900/50 border border-dark-700 rounded-xl p-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Data da venda" type="date" value={dataVenda} onChange={(e) => setDataVenda(e.target.value)} />
              <Input label="NF de venda (opcional)" value={notaVenda} onChange={(e) => setNotaVenda(e.target.value)} />
            </div>
            <Input label="Cliente final (se for outro)" value={clienteVenda} onChange={(e) => setClienteVenda(e.target.value)} />
            <p className="text-xs text-dark-500">Sem a nota fiscal, a máquina fica como "Aguardando NF".</p>
            <Button
              size="sm"
              loading={vendaMut.isPending}
              onClick={() =>
                vendaMut.mutate({
                  itemId: linha.itemId,
                  dataVenda,
                  numeroNotaVenda: notaVenda.trim() || undefined,
                  clienteVenda: clienteVenda.trim() || undefined,
                })
              }
            >
              Salvar venda
            </Button>
          </div>
        )}

        {acao === 'retorno' && (
          <div className="space-y-3 bg-dark-900/50 border border-dark-700 rounded-xl p-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Data do retorno" type="date" value={dataRetorno} onChange={(e) => setDataRetorno(e.target.value)} />
              <Input label="NF de retorno (opcional)" value={notaRetorno} onChange={(e) => setNotaRetorno(e.target.value)} />
            </div>
            <p className="text-xs text-dark-500">Sem a nota fiscal, a máquina fica como "Aguardando NF".</p>
            <Button
              size="sm"
              loading={retornoMut.isPending}
              onClick={() =>
                retornoMut.mutate({ itemId: linha.itemId, retornoEfetivoEm: dataRetorno, numeroNotaRetorno: notaRetorno.trim() || undefined })
              }
            >
              Salvar retorno
            </Button>
          </div>
        )}

        {acao === 'prazo' && (
          <div className="space-y-3 bg-dark-900/50 border border-dark-700 rounded-xl p-3">
            <Input label="Novo retorno previsto" type="date" value={novoPrazo} onChange={(e) => setNovoPrazo(e.target.value)} />
            <Button
              size="sm"
              loading={prazoMut.isPending}
              disabled={!novoPrazo}
              onClick={() => prazoMut.mutate({ itemId: linha.itemId, retornoPrevistoEm: novoPrazo })}
            >
              Salvar prazo
            </Button>
          </div>
        )}

        <div className="border-t border-dark-700 pt-3">
          <p className="text-sm font-semibold text-dark-100 mb-2">Conclusão / histórico</p>
          <div className="flex gap-2 mb-3">
            <input
              value={conclusao}
              onChange={(e) => setConclusao(e.target.value)}
              placeholder="Ex: cliente pediu mais 15 dias..."
              className="flex-1 bg-dark-900 border border-dark-700 rounded-lg text-sm text-dark-100 px-3 py-2"
            />
            <Button
              size="sm"
              loading={conclusaoMut.isPending}
              disabled={!conclusao.trim()}
              onClick={() => conclusaoMut.mutate({ itemId: linha.itemId, texto: conclusao.trim() })}
            >
              Adicionar
            </Button>
          </div>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {historico?.map((h) => (
              <div key={h.id} className="flex items-start gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-dark-500 shrink-0 mt-1.5" />
                <div>
                  <p className="text-dark-200">{h.texto}</p>
                  <p className="text-dark-500">
                    {formatarData(h.createdAt)} · {h.userNome}
                  </p>
                </div>
              </div>
            ))}
            {!historico?.length && <p className="text-xs text-dark-500">Sem registros ainda.</p>}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── Tela ────────────────────────────────────────────────────────────────────
export default function Demonstracoes() {
  const utils = trpc.useUtils()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data: linhas, isLoading } = trpc.demonstracoes.listar.useQuery()
  const { data: vendedores } = trpc.demonstracoes.vendedores.useQuery(undefined, { enabled: isAdmin })

  const [criarAberto, setCriarAberto] = useState(false)
  const [itemAberto, setItemAberto] = useState<number | null>(null)
  const [busca, setBusca] = useState('')
  const [status, setStatus] = useState('')
  const [vendedorId, setVendedorId] = useState('')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [prazo, setPrazo] = useState('')

  const excluirMut = trpc.demonstracoes.excluirItem.useMutation({
    onSuccess() {
      toast.success('Registro excluído')
      utils.demonstracoes.listar.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (linhas ?? []).filter((l) => {
      if (termo) {
        const alvo = [l.clienteNome, l.numeroNotaSaida, l.produto, l.numeroSerie, l.numeroNotaVenda, l.numeroNotaRetorno]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!alvo.includes(termo)) return false
      }
      if (status && l.status !== status) return false
      if (vendedorId && String(l.vendedorId ?? '') !== vendedorId) return false
      if (dataDe && l.dataSaida < dataDe) return false
      if (dataAte && l.dataSaida > dataAte) return false
      if (prazo) {
        const dias = diasAte(l.retornoPrevistoEm)
        const naRua = aindaNaRua(l)
        if (prazo === 'atrasado' && !(dias !== null && dias < 0 && naRua)) return false
        if (prazo === 'proximos7' && !(dias !== null && dias >= 0 && dias <= 7 && naRua)) return false
        if (prazo === 'sem_prazo' && l.retornoPrevistoEm) return false
      }
      return true
    })
  }, [linhas, busca, status, vendedorId, dataDe, dataAte, prazo])

  const linhaAberta = (linhas ?? []).find((l) => l.itemId === itemAberto) ?? null
  const naRua = filtradas.filter(aindaNaRua).length
  const atrasadas = filtradas.filter((l) => {
    const dias = diasAte(l.retornoPrevistoEm)
    return dias !== null && dias < 0 && aindaNaRua(l)
  }).length

  function exportar() {
    baixarCsv(
      'demonstracoes.csv',
      paraCsv(
        [
          { chave: 'dataSaida', rotulo: 'Data saída' },
          { chave: 'numeroNotaSaida', rotulo: 'NF saída' },
          { chave: 'clienteNome', rotulo: 'Cliente' },
          { chave: 'localizacao', rotulo: 'Cidade/UF' },
          { chave: 'produto', rotulo: 'Produto' },
          { chave: 'numeroSerie', rotulo: 'Nº série' },
          { chave: 'retornoPrevistoEm', rotulo: 'Retorno previsto' },
          { chave: 'retornoEfetivoEm', rotulo: 'Retorno efetivo' },
          { chave: 'numeroNotaRetorno', rotulo: 'NF retorno' },
          { chave: 'statusLabel', rotulo: 'Status' },
          { chave: 'vendedorNome', rotulo: 'Vendedor' },
        ],
        filtradas.map((l) => ({
          dataSaida: formatarData(l.dataSaida),
          numeroNotaSaida: l.numeroNotaSaida ?? '',
          clienteNome: l.clienteNome,
          localizacao: l.clienteCidade ? `${l.clienteCidade}/${l.clienteEstado ?? ''}` : '',
          produto: l.produto,
          numeroSerie: l.numeroSerie ?? '',
          retornoPrevistoEm: formatarData(l.retornoPrevistoEm),
          retornoEfetivoEm: formatarData(l.retornoEfetivoEm),
          numeroNotaRetorno: l.numeroNotaRetorno ?? '',
          statusLabel: STATUS_LABEL[l.status] ?? l.status,
          vendedorNome: l.vendedorNome ?? '',
        }))
      )
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl text-dark-50 font-bold">Controle de Demonstrações</h1>
          <p className="text-sm text-dark-400 mt-0.5">Acompanhamento de máquinas enviadas aos clientes.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={exportar}>
            <Download size={16} /> Exportar CSV
          </Button>
          <Button onClick={() => setCriarAberto(true)}>
            <Plus size={16} /> Nova demonstração
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl px-4 py-2.5">
          <p className="text-xs text-dark-500">Na rua</p>
          <p className="text-xl font-bold text-dark-50">{naRua}</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl px-4 py-2.5">
          <p className="text-xs text-dark-500">Atrasadas</p>
          <p className={`text-xl font-bold ${atrasadas > 0 ? 'text-red-400' : 'text-dark-50'}`}>{atrasadas}</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl px-4 py-2.5">
          <p className="text-xs text-dark-500">Máquinas listadas</p>
          <p className="text-xl font-bold text-dark-50">{filtradas.length}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="w-72">
          <Input
            icon={<Search size={14} />}
            label="Buscar"
            placeholder="Cliente, NF, produto ou nº de série..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="w-48">
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="Todos os status"
            options={STATUS.map((s) => ({ value: s.value, label: s.label }))}
          />
        </div>
        {isAdmin && (
          <div className="w-48">
            <Select
              label="Vendedor"
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value)}
              placeholder="Todos"
              options={(vendedores ?? []).map((v) => ({ value: v.id, label: v.name }))}
            />
          </div>
        )}
        <Input label="Saída de" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
        <Input label="Saída até" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
        <div className="w-44">
          <Select
            label="Prazo de retorno"
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
            placeholder="Todos"
            options={[
              { value: 'atrasado', label: 'Atrasadas' },
              { value: 'proximos7', label: 'Vencem em 7 dias' },
              { value: 'sem_prazo', label: 'Sem prazo' },
            ]}
          />
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700 text-left text-xs text-dark-500 uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Data saída</th>
                <th className="px-4 py-3 font-medium">NF saída</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Produto</th>
                <th className="px-4 py-3 font-medium">Retorno previsto</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {isAdmin && <th className="px-4 py-3 font-medium">Vendedor</th>}
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-dark-500">
                    Carregando...
                  </td>
                </tr>
              )}
              {!isLoading &&
                filtradas.map((l) => {
                  const dias = diasAte(l.retornoPrevistoEm)
                  const atrasada = dias !== null && dias < 0 && aindaNaRua(l)
                  return (
                    <tr
                      key={l.itemId}
                      onClick={() => setItemAberto(l.itemId)}
                      className="border-b border-dark-700 last:border-0 hover:bg-dark-700/40 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-dark-400 font-mono">{formatarData(l.dataSaida)}</td>
                      <td className="px-4 py-3 text-dark-400 font-mono">{l.numeroNotaSaida ?? '—'}</td>
                      <td className="px-4 py-3">
                        <p className="text-dark-100 font-medium">{l.clienteNome}</p>
                        {l.clienteCidade && (
                          <p className="text-xs text-dark-500">
                            {l.clienteCidade}
                            {l.clienteEstado ? `/${l.clienteEstado}` : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-dark-200">{l.produto}</p>
                        {l.numeroSerie && <p className="text-xs text-dark-500 font-mono">{l.numeroSerie}</p>}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        <span className={atrasada ? 'text-red-400' : 'text-dark-400'}>{formatarData(l.retornoPrevistoEm)}</span>
                        {atrasada && <p className="text-[11px] text-red-400">{Math.abs(dias!)} dia(s) atrasada</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_COR[l.status] ?? ''}`}>
                          {STATUS_LABEL[l.status] ?? l.status}
                        </span>
                      </td>
                      {isAdmin && <td className="px-4 py-3 text-dark-400">{l.vendedorNome ?? '—'}</td>}
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => confirm(`Excluir ${l.produto} dessa demonstração?`) && excluirMut.mutate({ itemId: l.itemId })}
                          className="text-dark-600 hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              {!isLoading && filtradas.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-dark-500">
                    Nenhuma máquina encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <NovaDemonstracaoModal open={criarAberto} onClose={() => setCriarAberto(false)} />
      <FichaItemModal linha={linhaAberta} onClose={() => setItemAberto(null)} />
    </div>
  )
}
