import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, AlertCircle } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import Select from '../../components/ui/Select'
import { Input, Textarea } from '../../components/ui/Input'

const CANAL_OPTIONS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'google', label: 'Google' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'site', label: 'Site' },
  { value: 'indicacao', label: 'Indicação' },
  { value: 'outro', label: 'Outro' },
]
const CANAL_LABEL: Record<string, string> = Object.fromEntries(CANAL_OPTIONS.map((c) => [c.value, c.label]))

function CampanhaModal({ open, onClose, nomeInicial }: { open: boolean; onClose: () => void; nomeInicial?: string }) {
  const utils = trpc.useUtils()
  const [name, setName] = useState(nomeInicial ?? '')
  const [channel, setChannel] = useState('outro')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (open) setName(nomeInicial ?? '')
  }, [open, nomeInicial])

  const criarMut = trpc.leadCampaigns.criar.useMutation({
    onSuccess() {
      toast.success('Campanha criada')
      utils.leadCampaigns.listar.invalidate()
      utils.leadCampaigns.naoVinculados.invalidate()
      setName('')
      setDescription('')
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Nova campanha">
      <div className="space-y-4">
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Promo-Compressores-Ago" />
        <p className="text-xs text-dark-500 -mt-2">Tem que ser IGUAL ao utm_campaign configurado no anúncio pra vincular sozinho.</p>
        <Select label="Canal" value={channel} onChange={(e) => setChannel(e.target.value)} options={CANAL_OPTIONS} />
        <Textarea label="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            loading={criarMut.isPending}
            onClick={() => {
              if (!name.trim()) return toast.error('Dê um nome pra campanha')
              criarMut.mutate({ name, channel: channel as any, description: description || undefined })
            }}
          >
            Criar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Marketing > Campanhas — vincula lead que chega do site (via utm_campaign,
// já capturado desde sempre no rastreamento, só nunca usado) com a campanha
// que o gerou. Casamento é automático por nome exato; o que não bate fica
// na lista "Não vinculados" pra alguém decidir cadastrar.
export default function Campanhas() {
  const { data: campanhas } = trpc.leadCampaigns.listar.useQuery()
  const { data: naoVinculados } = trpc.leadCampaigns.naoVinculados.useQuery()
  const utils = trpc.useUtils()
  const [modalAberto, setModalAberto] = useState(false)
  const [nomeSugerido, setNomeSugerido] = useState<string | undefined>(undefined)

  const atualizarMut = trpc.leadCampaigns.atualizar.useMutation({
    onSuccess: () => {
      utils.leadCampaigns.listar.invalidate()
      utils.leadCampaigns.naoVinculados.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.leadCampaigns.excluir.useMutation({
    onSuccess: () => {
      toast.success('Campanha excluída')
      utils.leadCampaigns.listar.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  function abrirComNome(nome: string) {
    setNomeSugerido(nome)
    setModalAberto(true)
  }

  if (!campanhas) return <div className="p-6 text-dark-500">Carregando...</div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl text-dark-50 font-bold">Campanhas</h1>
          <p className="text-sm text-dark-400 mt-0.5">Campanhas de marketing vinculadas aos leads que chegam pelo site.</p>
        </div>
        <Button
          onClick={() => {
            setNomeSugerido(undefined)
            setModalAberto(true)
          }}
        >
          <Plus size={16} /> Nova campanha
        </Button>
      </div>

      {!!naoVinculados?.length && (
        <div className="bg-orange-900/10 border border-orange-700/30 rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={16} className="text-orange-400" />
            <p className="text-sm font-semibold text-orange-300">Chegaram de anúncio mas não têm campanha cadastrada</p>
          </div>
          <div className="space-y-1.5">
            {naoVinculados.map((n) => (
              <div key={n.nome} className="flex items-center justify-between text-sm bg-dark-800 border border-dark-600 rounded-lg px-3 py-2">
                <span className="text-dark-200 font-mono">{n.nome}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-dark-500">
                    {n.visitantes} visitante{n.visitantes !== 1 ? 's' : ''} · {n.leads} lead{n.leads !== 1 ? 's' : ''}
                  </span>
                  <button onClick={() => abrirComNome(n.nome)} className="text-xs text-gold-400 hover:text-gold-300 font-medium">
                    Cadastrar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700 text-left text-xs text-dark-500 uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Canal</th>
                <th className="px-4 py-3 font-medium">Leads</th>
                <th className="px-4 py-3 font-medium">Ganho</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {campanhas.map((c) => (
                <tr key={c.id} className="border-b border-dark-700 last:border-0 hover:bg-dark-700/40">
                  <td className="px-4 py-3 text-dark-100 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-dark-400">{CANAL_LABEL[c.channel] ?? c.channel}</td>
                  <td className="px-4 py-3 text-dark-400 font-mono">{c.totalLeads}</td>
                  <td className="px-4 py-3 text-green-400 font-mono">{c.leadsGanhos}</td>
                  <td className="px-4 py-3">
                    <Badge className={c.isActive ? 'text-green-400 bg-green-900/20 border-green-700/40' : 'text-dark-400 bg-dark-700/40 border-dark-600'}>
                      {c.isActive ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button onClick={() => atualizarMut.mutate({ id: c.id, isActive: !c.isActive })} className="text-xs text-dark-400 hover:text-gold-400">
                      {c.isActive ? 'Desativar' : 'Ativar'}
                    </button>
                    <button onClick={() => excluirMut.mutate({ id: c.id })} className="text-xs text-dark-600 hover:text-red-400">
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
              {campanhas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-dark-500">
                    Nenhuma campanha cadastrada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CampanhaModal open={modalAberto} onClose={() => setModalAberto(false)} nomeInicial={nomeSugerido} />
    </div>
  )
}
