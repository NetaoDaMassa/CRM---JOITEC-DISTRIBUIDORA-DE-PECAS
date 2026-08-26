import { useState } from 'react'
import { Plus, Download, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import { Input } from '../components/ui/Input'
import PropostasBoard from '../components/PropostasBoard'
import { PROPOSTA_STAGE_LABELS, type PropostaStage } from '../lib/propostasShared'

function baixarCsvPropostas(propostas: { id: number; stage: string; clienteNome: string; vendedor: { name: string } | null; updatedAt: string }[]) {
  const linhas = ['ID,Cliente,Vendedor,Etapa,Atualizado em']
  for (const p of propostas) {
    linhas.push([p.id, p.clienteNome.replace(/,/g, ' '), p.vendedor?.name ?? '', PROPOSTA_STAGE_LABELS[p.stage as PropostaStage] ?? p.stage, p.updatedAt].join(','))
  }
  const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `propostas_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function PropostasKanban() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const basePath = isAdmin ? '/admin/propostas' : '/vendedor/propostas'

  const [modalAberto, setModalAberto] = useState(false)
  const [clienteNome, setClienteNome] = useState('')
  const [clienteWhatsapp, setClienteWhatsapp] = useState('')
  const [produtosDescricao, setProdutosDescricao] = useState('')
  const [vendedorId, setVendedorId] = useState('')

  const utils = trpc.useUtils()
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: isAdmin })
  const { data: propostas, isLoading } = trpc.propostas.listar.useQuery({ vendedorId: vendedorId ? Number(vendedorId) : undefined })

  const criarMut = trpc.propostas.criar.useMutation({
    onSuccess() {
      toast.success('Proposta criada')
      setModalAberto(false)
      setClienteNome('')
      setClienteWhatsapp('')
      setProdutosDescricao('')
      utils.propostas.listar.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="font-heading text-2xl text-dark-50 font-bold">Propostas</h1>
        <Button size="sm" onClick={() => setModalAberto(true)}>
          <Plus size={14} className="mr-1" /> Nova Proposta
        </Button>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        {isAdmin ? (
          <div className="w-56">
            <Select
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value)}
              placeholder="Todos os vendedores"
              options={(vendedores ?? []).filter((v) => v.role === 'vendor').map((v) => ({ value: v.id, label: v.name }))}
            />
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => baixarCsvPropostas(propostas ?? [])}
            className="flex items-center gap-1.5 rounded-lg border border-dark-600 px-3 py-1.5 text-xs font-medium text-dark-300 hover:bg-dark-800 transition-colors"
          >
            <Download size={13} /> Exportar CSV
          </button>
          <button
            onClick={() => utils.propostas.listar.invalidate()}
            className="flex items-center gap-1.5 text-xs text-dark-400 hover:text-gold-400 transition-colors"
          >
            <RefreshCw size={13} /> Atualizar
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <PropostasBoard propostas={propostas ?? []} basePath={basePath} mostrarVendedor={isAdmin} />
      )}

      <Modal open={modalAberto} onClose={() => setModalAberto(false)} title="Nova Proposta" size="sm">
        <div className="p-5 space-y-4">
          <Input label="Nome do cliente" value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} />
          <Input label="WhatsApp do cliente" value={clienteWhatsapp} onChange={(e) => setClienteWhatsapp(e.target.value)} />
          <Input label="Produtos/Serviços" value={produtosDescricao} onChange={(e) => setProdutosDescricao(e.target.value)} />
          <Button
            className="w-full"
            disabled={!clienteNome || criarMut.isPending}
            loading={criarMut.isPending}
            onClick={() => criarMut.mutate({ clienteNome, clienteWhatsapp: clienteWhatsapp || undefined, produtosDescricao: produtosDescricao || undefined })}
          >
            Criar proposta
          </Button>
        </div>
      </Modal>
    </div>
  )
}
