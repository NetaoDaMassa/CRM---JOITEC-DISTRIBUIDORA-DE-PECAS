import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import Select from '../ui/Select'
import { Badge } from '../ui/Badge'
import { formatDateTime } from '../../lib/utils'

type Cotacao = {
  id: number
  numeroSequencial: number
  numeroCotacaoTransportadora: string | null
  transportadora: string | null
  valor: number | null
  peso: number | null
  volume: number | null
  prazo: string | null
  tipoFrete: 'CIF' | 'FOB' | null
  observacoes: string | null
}

const COTACAO_VAZIA = { numeroCotacaoTransportadora: '', transportadora: '', valor: '', peso: '', volume: '', prazo: '', observacoes: '', tipoFrete: 'FOB' as 'CIF' | 'FOB' }

function formatarMoeda(v: number | null): string {
  return v != null ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'
}

export default function EtapaFrete({
  ordemId,
  isAdmin,
  readonly,
  vendedorWhatsapp,
  clienteNome,
}: {
  ordemId: number
  isAdmin: boolean
  readonly: boolean
  vendedorWhatsapp?: string | null
  clienteNome?: string | null
}) {
  const utils = trpc.useUtils()
  const { data: cotacoes } = trpc.ordens.frete.listarCotacoes.useQuery({ ordemId })
  const { data: aprovacao } = trpc.ordens.frete.obterAprovacao.useQuery({ ordemId })
  const { data: transportadoras } = trpc.configuracoesOdin.listarTransportadoras.useQuery(undefined, { retry: false })

  const [form, setForm] = useState(COTACAO_VAZIA)
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [retiradaEmpresa, setRetiradaEmpresa] = useState('')
  const [retiradaData, setRetiradaData] = useState('')
  const [semFreteObs, setSemFreteObs] = useState('')

  const podeEditar = isAdmin && !readonly

  function invalidar() {
    utils.ordens.frete.listarCotacoes.invalidate({ ordemId })
    utils.ordens.frete.obterAprovacao.invalidate({ ordemId })
  }
  const criarMut = trpc.ordens.frete.criarCotacao.useMutation({ onSuccess: () => { toast.success('Cotação criada'); invalidar(); setForm(COTACAO_VAZIA) }, onError: (e) => toast.error(e.message) })
  const atualizarMut = trpc.ordens.frete.atualizarCotacao.useMutation({ onSuccess: () => { toast.success('Cotação atualizada'); invalidar(); setEditandoId(null); setForm(COTACAO_VAZIA) }, onError: (e) => toast.error(e.message) })
  const excluirMut = trpc.ordens.frete.excluirCotacao.useMutation({ onSuccess: () => { toast.success('Cotação removida'); invalidar() }, onError: (e) => toast.error(e.message) })
  const aprovarMut = trpc.ordens.frete.aprovarCotacao.useMutation({ onSuccess: () => { toast.success('Cotação aprovada'); invalidar() }, onError: (e) => toast.error(e.message) })
  const semFreteMut = trpc.ordens.frete.definirSemFrete.useMutation({ onSuccess: () => { toast.success('Definido "sem frete"'); invalidar() }, onError: (e) => toast.error(e.message) })
  const retiradaMut = trpc.ordens.frete.definirRetiradaLocal.useMutation({ onSuccess: () => { toast.success('Definida retirada local'); invalidar() }, onError: (e) => toast.error(e.message) })
  const finalizarCotacaoMut = trpc.ordens.frete.finalizarCotacao.useMutation({ onSuccess: () => { toast.success('Atualizado'); invalidar(); utils.ordens.core.obterPorId.invalidate({ id: ordemId }) }, onError: (e) => toast.error(e.message) })

  const lista: Cotacao[] = cotacoes ?? []
  const melhorPreco = lista.reduce<number | null>((min, c) => (c.valor != null && (min === null || c.valor < min) ? c.valor : min), null)

  function abrirEdicao(c: Cotacao) {
    setEditandoId(c.id)
    setForm({
      numeroCotacaoTransportadora: c.numeroCotacaoTransportadora ?? '',
      transportadora: c.transportadora ?? '',
      valor: c.valor?.toString() ?? '',
      peso: c.peso?.toString() ?? '',
      volume: c.volume?.toString() ?? '',
      prazo: c.prazo ?? '',
      observacoes: c.observacoes ?? '',
      tipoFrete: c.tipoFrete ?? 'FOB',
    })
  }

  function salvarCotacao() {
    const values = {
      numeroCotacaoTransportadora: form.numeroCotacaoTransportadora || undefined,
      transportadora: form.transportadora || undefined,
      valor: form.valor ? Number(form.valor) : undefined,
      peso: form.peso ? Number(form.peso) : undefined,
      volume: form.volume ? Number(form.volume) : undefined,
      prazo: form.prazo || undefined,
      observacoes: form.observacoes || undefined,
      tipoFrete: form.tipoFrete,
    }
    if (editandoId) atualizarMut.mutate({ id: editandoId, ordemId, ...values })
    else criarMut.mutate({ ordemId, ...values })
  }

  // Texto pronto pra copiar/mandar no WhatsApp — pedido do João, 2026-09-01,
  // pra ficar igual ao que a Odin Compressores já manda pro cliente hoje
  // (cabeçalho com o cliente, opção numerada com o nº da cotação na
  // transportadora, selo de melhor preço, campos com emoji cada um numa
  // linha, observação só quando tem).
  function textoCotacoes() {
    const linhas = [`ODIN Compressores — Cotações de Frete`, `Cliente: ${clienteNome ?? '—'}`, '']
    lista.forEach((c, idx) => {
      const isMelhorPreco = c.valor != null && c.valor === melhorPreco
      linhas.push(`Opção ${idx + 1} — ${c.transportadora ?? '—'} [Nº ${c.numeroCotacaoTransportadora || '-'}]${isMelhorPreco ? ' ⭐ MELHOR PREÇO' : ''}`)
      linhas.push(`💰 Valor: ${formatarMoeda(c.valor)}`)
      linhas.push(`⏱️ Prazo: ${c.prazo ?? '—'}`)
      linhas.push(`📦 Tipo: ${c.tipoFrete ?? '—'}`)
      linhas.push(`⚖️ Peso: ${c.peso ? `${c.peso} kg` : '—'}`)
      if (c.observacoes) linhas.push(`📝 Obs: ${c.observacoes}`)
      linhas.push('')
    })
    linhas.push('Por favor, acesse o sistema para selecionar a opção desejada.')
    return linhas.join('\n')
  }
  function copiarCotacoes() {
    navigator.clipboard.writeText(textoCotacoes())
    toast.success('Cotações copiadas')
  }
  function enviarWhatsappVendedor() {
    if (!vendedorWhatsapp) { toast.error('Vendedor sem WhatsApp cadastrado'); return }
    const texto = encodeURIComponent(textoCotacoes())
    window.open(`https://wa.me/${vendedorWhatsapp.replace(/\D/g, '')}?text=${texto}`, '_blank')
  }

  return (
    <div className="space-y-5">
      {aprovacao?.cotacaoFinalizada ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-green-700/40 bg-green-900/10 px-3 py-2.5 text-sm">
          <span className="text-green-400 font-medium">✅ Cotação finalizada{aprovacao.cotacaoFinalizadaEm ? ` em ${formatDateTime(aprovacao.cotacaoFinalizadaEm)}` : ''}</span>
          {podeEditar && <button onClick={() => finalizarCotacaoMut.mutate({ ordemId, finalizado: false })} className="text-xs font-semibold text-green-400 underline hover:no-underline">desfazer</button>}
        </div>
      ) : (
        podeEditar && <Button size="sm" variant="secondary" loading={finalizarCotacaoMut.isPending} onClick={() => finalizarCotacaoMut.mutate({ ordemId, finalizado: true })}>🏁 Finalizar cotação</Button>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-dark-200">Cotações</h3>
          {lista.length > 0 && (
            <div className="flex gap-2">
              <button onClick={copiarCotacoes} className="text-xs text-dark-400 hover:text-gold-400">Copiar cotações</button>
              <button onClick={enviarWhatsappVendedor} className="text-xs text-dark-400 hover:text-green-400">Enviar pro WhatsApp do vendedor</button>
            </div>
          )}
        </div>
        <div className="space-y-2">
          {lista.map((c) => (
            <div key={c.id} className={`p-2.5 rounded-lg border text-sm ${aprovacao?.cotacaoSelecionadaId === c.id ? 'border-green-600/50 bg-green-900/10' : 'border-dark-600 bg-dark-800'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-dark-100">
                  #{c.numeroSequencial} {c.transportadora || '—'} {c.numeroCotacaoTransportadora ? <span className="text-dark-500">({c.numeroCotacaoTransportadora})</span> : null}
                  {melhorPreco !== null && c.valor === melhorPreco && <Badge className="ml-2 text-green-400 bg-green-900/20 border-green-700/40">MELHOR PREÇO</Badge>}
                </div>
                {podeEditar && (
                  <div className="flex items-center gap-2 shrink-0">
                    {aprovacao?.cotacaoSelecionadaId !== c.id && <Button size="sm" variant="secondary" onClick={() => aprovarMut.mutate({ ordemId, cotacaoId: c.id })}>Selecionar como frete</Button>}
                    <button onClick={() => abrirEdicao(c)} className="text-xs text-dark-400 hover:text-gold-400">editar</button>
                    <button onClick={() => excluirMut.mutate({ id: c.id, ordemId })} className="text-xs text-dark-400 hover:text-red-400">excluir</button>
                  </div>
                )}
              </div>
              <div className="text-dark-500 text-xs mt-1">
                R$ {c.valor ?? '—'} · {c.tipoFrete} {c.prazo ? `· Prazo: ${c.prazo}` : ''} {c.peso ? `· Peso: ${c.peso}kg` : ''} {c.volume ? `· Volume: ${c.volume}` : ''}
              </div>
              {c.observacoes && <div className="text-dark-500 text-xs mt-1">{c.observacoes}</div>}
            </div>
          ))}
          {lista.length === 0 && <p className="text-dark-500 text-sm">Nenhuma cotação ainda</p>}
        </div>

        {podeEditar && (
          <div className="mt-3 p-3 rounded-lg border border-dark-700 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Input placeholder="Transportadora" list="lista-transportadoras" value={form.transportadora} onChange={(e) => setForm({ ...form, transportadora: e.target.value })} />
                <datalist id="lista-transportadoras">{(transportadoras ?? []).map((t) => <option key={t.id} value={t.nome} />)}</datalist>
              </div>
              <Input placeholder="Nº da cotação" value={form.numeroCotacaoTransportadora} onChange={(e) => setForm({ ...form, numeroCotacaoTransportadora: e.target.value })} />
              <Input placeholder="Valor (R$)" type="number" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
              <Input placeholder="Prazo" value={form.prazo} onChange={(e) => setForm({ ...form, prazo: e.target.value })} />
              <Input placeholder="Peso (kg)" type="number" value={form.peso} onChange={(e) => setForm({ ...form, peso: e.target.value })} />
              <Input placeholder="Volume" type="number" value={form.volume} onChange={(e) => setForm({ ...form, volume: e.target.value })} />
              <Select value={form.tipoFrete} onChange={(e) => setForm({ ...form, tipoFrete: e.target.value as any })} options={[{ value: 'FOB', label: 'FOB' }, { value: 'CIF', label: 'CIF' }]} />
            </div>
            <Input placeholder="Observações" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
            <div className="flex gap-2">
              <Button size="sm" loading={criarMut.isPending || atualizarMut.isPending} onClick={salvarCotacao}>{editandoId ? 'Salvar cotação' : 'Adicionar cotação'}</Button>
              {editandoId && <Button size="sm" variant="secondary" onClick={() => { setEditandoId(null); setForm(COTACAO_VAZIA) }}>Cancelar edição</Button>}
            </div>
          </div>
        )}
      </div>

      {podeEditar && (
        <div className="space-y-2 p-3 rounded-lg border border-dark-700">
          <p className="text-xs text-dark-400">Ou defina outro método de frete:</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex gap-2">
              <Input placeholder="Empresa que retira" value={retiradaEmpresa} onChange={(e) => setRetiradaEmpresa(e.target.value)} />
              <Input placeholder="Data" type="date" value={retiradaData} onChange={(e) => setRetiradaData(e.target.value)} />
              <Button size="sm" variant="secondary" onClick={() => retiradaMut.mutate({ ordemId, retiradaEmpresa, retiradaData })}>Cliente Retira</Button>
            </div>
            <div className="flex gap-2">
              <Input placeholder="Observação" value={semFreteObs} onChange={(e) => setSemFreteObs(e.target.value)} />
              <Button size="sm" variant="secondary" onClick={() => semFreteMut.mutate({ ordemId, observacoes: semFreteObs })}>Sem Frete</Button>
            </div>
          </div>
          {aprovacao?.retiradaLocal && <p className="text-xs text-green-400">✅ Cliente retira: {aprovacao.retiradaEmpresa} {aprovacao.retiradaData ? `em ${aprovacao.retiradaData}` : ''}</p>}
          {aprovacao?.semFrete && <p className="text-xs text-green-400">✅ Sem frete: {aprovacao.semFreteObservacoes}</p>}
        </div>
      )}
    </div>
  )
}
