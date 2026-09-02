import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plus, Download, RefreshCw, CalendarRange, X, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import { Input } from '../components/ui/Input'
import OrdensBoard from '../components/OrdensBoard'
import OrdensDetail from './OrdensDetail'
import { ORDER_TYPE_VALUES, ORDER_TYPE_LABELS, STAGE_LABELS, type OrderType, type Stage } from '../lib/ordensShared'

// Atalho "Mês" — preenche De/Até com o mês inteiro de uma vez, igual ao
// filtro de data de criação do Kanban.tsx no odincrm original.
function monthToRange(mes: string): { from: string; to: string } {
  const [ano, m] = mes.split('-').map(Number)
  const ultimoDia = new Date(ano, m, 0).getDate()
  return { from: `${mes}-01`, to: `${mes}-${String(ultimoDia).padStart(2, '0')}` }
}

function baixarCsvPedidos(ordens: { id: number; stage: string; status: string; updatedAt: string; cliente: { razaoSocial: string } | null; vendedor: { name: string } | null }[]) {
  const linhas = ['ID,Cliente,Vendedor,Etapa,Status,Atualizado em']
  for (const o of ordens) {
    linhas.push([o.id, (o.cliente?.razaoSocial ?? '').replace(/,/g, ' '), o.vendedor?.name ?? '', STAGE_LABELS[o.stage as Stage] ?? o.stage, o.status, o.updatedAt].join(','))
  }
  const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pedidos_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function OrdensKanban() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const basePath = isAdmin ? '/admin/ordens' : '/vendedor/ordens'
  const { id } = useParams()
  const navigate = useNavigate()

  const [orderType, setOrderType] = useState<OrderType>('maquina')
  const [modalAberto, setModalAberto] = useState(false)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [novoOrderType, setNovoOrderType] = useState<OrderType>('maquina')
  const [vendedorId, setVendedorId] = useState('')
  const [mes, setMes] = useState('')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [busca, setBusca] = useState('')

  const utils = trpc.useUtils()
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: isAdmin })
  const { data: ordensTodas, isLoading } = trpc.ordens.core.listarKanban.useQuery({ orderType, vendedorId: vendedorId ? Number(vendedorId) : undefined })
  // Bolinha vermelha nos botões Máquina/Peça — quantos pedidos de cada tipo
  // estão parados na primeira etapa (liberação financeira / pedido), pra
  // quem cuida do despacho ver de cara sem precisar clicar em cada aba.
  const { data: etapaInicial } = trpc.ordens.core.contarEtapaInicial.useQuery(undefined, { refetchInterval: 60_000 })
  const BADGE_POR_TIPO: Record<OrderType, number | undefined> = { maquina: etapaInicial?.maquina, peca: etapaInicial?.peca }
  const { data: clientesResultado } = trpc.clientes.list.useQuery({ q: buscaCliente, pagina: 1 }, { enabled: buscaCliente.trim().length >= 2 })

  const temFiltroData = !!(dataDe || dataAte)
  const ordensPorData = temFiltroData
    ? (ordensTodas ?? []).filter((o) => {
        const dia = o.createdAt.slice(0, 10)
        if (dataDe && dia < dataDe) return false
        if (dataAte && dia > dataAte) return false
        return true
      })
    : ordensTodas

  const termo = busca.trim().toLowerCase()
  const termoDigitos = termo.replace(/\D/g, '')
  const ordens = termo
    ? (ordensPorData ?? []).filter(
        (o) =>
          String(o.id).includes(termo) ||
          o.cliente?.razaoSocial.toLowerCase().includes(termo) ||
          o.cliente?.codigo?.toLowerCase().includes(termo) ||
          o.vendedor?.name.toLowerCase().includes(termo) ||
          (termoDigitos && o.cliente?.telefoneWhatsapp?.replace(/\D/g, '').includes(termoDigitos))
      )
    : ordensPorData

  function aplicarMes(m: string) {
    setMes(m)
    if (m) {
      const { from, to } = monthToRange(m)
      setDataDe(from)
      setDataAte(to)
    } else {
      setDataDe('')
      setDataAte('')
    }
  }
  function alterarData(campo: 'de' | 'ate', valor: string) {
    if (campo === 'de') setDataDe(valor)
    else setDataAte(valor)
    setMes('')
  }

  const criarMut = trpc.ordens.core.criar.useMutation({
    onSuccess() {
      toast.success('Pedido criado')
      setModalAberto(false)
      setClienteId('')
      setBuscaCliente('')
      utils.ordens.core.listarKanban.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="font-heading text-2xl text-dark-50 font-bold">Pedidos</h1>
        <div className="flex items-center gap-3">
          <div className="flex bg-dark-800 border border-dark-600 rounded-lg p-1">
            {ORDER_TYPE_VALUES.map((t) => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                title={BADGE_POR_TIPO[t] ? `${BADGE_POR_TIPO[t]} pedido(s) aguardando em ${t === 'maquina' ? 'Liberação Financeira' : 'Pedido'}` : undefined}
                className={`relative px-3 py-1.5 text-sm rounded-md transition-colors ${orderType === t ? 'bg-gold-600 text-dark-950 font-semibold' : 'text-dark-300 hover:text-dark-100'}`}
              >
                {ORDER_TYPE_LABELS[t]}
                {!!BADGE_POR_TIPO[t] && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
                    {BADGE_POR_TIPO[t]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setModalAberto(true)}>
            <Plus size={14} className="mr-1" /> Novo Pedido
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente, código, telefone ou #pedido..."
              className="w-64 rounded-lg border border-dark-600 bg-dark-900 py-1.5 pl-8 pr-2 text-xs text-dark-100 placeholder-dark-500 focus:outline-none focus:border-gold-600"
            />
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-dark-600 px-2 py-1.5" title="Filtrar por data de criação do pedido">
            <CalendarRange size={13} className="text-dark-500 shrink-0" />
            <input
              type="month"
              value={mes}
              title="Atalho: preenche De/Até com o mês inteiro"
              onChange={(e) => aplicarMes(e.target.value)}
              className="bg-transparent text-xs py-0.5 px-1 w-[100px] text-dark-100 focus:outline-none"
            />
            <span className="text-dark-600">|</span>
            <input type="date" value={dataDe} onChange={(e) => alterarData('de', e.target.value)} className="bg-transparent text-xs py-0.5 px-1 w-[110px] text-dark-100 focus:outline-none" />
            <span className="text-dark-500 text-xs">até</span>
            <input type="date" value={dataAte} onChange={(e) => alterarData('ate', e.target.value)} className="bg-transparent text-xs py-0.5 px-1 w-[110px] text-dark-100 focus:outline-none" />
            {temFiltroData && (
              <button onClick={() => aplicarMes('')} className="text-dark-500 hover:text-dark-300 shrink-0"><X size={12} /></button>
            )}
          </div>
          {isAdmin && (
            <div className="w-52">
              <Select
                value={vendedorId}
                onChange={(e) => setVendedorId(e.target.value)}
                placeholder="Todos os vendedores"
                options={(vendedores ?? []).filter((v) => v.role === 'vendor').map((v) => ({ value: v.id, label: v.name }))}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => baixarCsvPedidos(ordens ?? [])}
            className="flex items-center gap-1.5 rounded-lg border border-dark-600 px-3 py-1.5 text-xs font-medium text-dark-300 hover:bg-dark-800 transition-colors"
          >
            <Download size={13} /> Exportar CSV
          </button>
          <button
            onClick={() => utils.ordens.core.listarKanban.invalidate()}
            className="flex items-center gap-1.5 text-xs text-dark-400 hover:text-gold-400 transition-colors"
          >
            <RefreshCw size={13} /> Atualizar
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <OrdensBoard ordens={ordens ?? []} orderType={orderType} basePath={basePath} />
      )}

      <Modal open={modalAberto} onClose={() => setModalAberto(false)} title="Novo Pedido" size="sm">
        <div className="p-5 space-y-4">
          <Select
            label="Tipo de pedido"
            value={novoOrderType}
            onChange={(e) => setNovoOrderType(e.target.value as OrderType)}
            options={ORDER_TYPE_VALUES.map((t) => ({ value: t, label: ORDER_TYPE_LABELS[t] }))}
          />
          <div>
            <Input label="Buscar cliente" value={buscaCliente} onChange={(e) => { setBuscaCliente(e.target.value); setClienteId('') }} placeholder="Nome ou código..." />
            {clientesResultado && clientesResultado.items.length > 0 && !clienteId && (
              <div className="mt-1 max-h-40 overflow-y-auto border border-dark-600 rounded-lg bg-dark-800">
                {clientesResultado.items.map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left px-3 py-2 text-sm text-dark-200 hover:bg-dark-700"
                    onClick={() => { setClienteId(String(c.id)); setBuscaCliente(c.razaoSocial) }}
                  >
                    {c.razaoSocial}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            className="w-full"
            disabled={!clienteId || criarMut.isPending}
            loading={criarMut.isPending}
            onClick={() => criarMut.mutate({ clienteId: Number(clienteId), orderType: novoOrderType })}
          >
            Criar pedido
          </Button>
        </div>
      </Modal>

      {id && <OrdensDetail ordemId={Number(id)} onClose={() => navigate(basePath)} />}
    </div>
  )
}
