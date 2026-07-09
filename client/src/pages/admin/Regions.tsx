import { useState } from 'react'
import { Plus, Trash2, RefreshCw, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'

export default function AdminRegions() {
  const [addDDDModal, setAddDDDModal] = useState<number | null>(null)
  const [addVendorModal, setAddVendorModal] = useState<number | null>(null)
  const [newDDD, setNewDDD] = useState('')
  const [newVendorId, setNewVendorId] = useState('')
  const [newRegionName, setNewRegionName] = useState('')
  const [createRegionModal, setCreateRegionModal] = useState(false)

  const utils = trpc.useUtils()
  const { data: regions, isLoading } = trpc.regions.list.useQuery()
  const { data: roundRobin } = trpc.regions.roundRobinStatus.useQuery()
  const { data: vendors } = trpc.users.vendors.useQuery()

  const addDDDMut = trpc.regions.addDDD.useMutation({
    onSuccess() {
      toast.success('DDD adicionado')
      utils.regions.list.invalidate()
      setAddDDDModal(null)
      setNewDDD('')
    },
    onError(err) { toast.error(err.message) },
  })

  const removeDDDMut = trpc.regions.removeDDD.useMutation({
    onSuccess() {
      toast.success('DDD removido')
      utils.regions.list.invalidate()
    },
  })

  const addVendorMut = trpc.regions.addVendor.useMutation({
    onSuccess() {
      toast.success('Vendedor adicionado à região')
      utils.regions.list.invalidate()
      utils.regions.roundRobinStatus.invalidate()
      setAddVendorModal(null)
      setNewVendorId('')
    },
    onError(err) { toast.error(err.message) },
  })

  const removeVendorMut = trpc.regions.removeVendor.useMutation({
    onSuccess() {
      toast.success('Vendedor removido da região')
      utils.regions.list.invalidate()
      utils.regions.roundRobinStatus.invalidate()
    },
  })

  const createRegionMut = trpc.regions.create.useMutation({
    onSuccess() {
      toast.success('Região criada')
      utils.regions.list.invalidate()
      setCreateRegionModal(false)
      setNewRegionName('')
    },
    onError(err) { toast.error(err.message) },
  })

  const vendorOptions = vendors?.map((v) => ({ value: v.id.toString(), label: v.name })) ?? []

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Regiões & Rodízio</h1>
          <p className="text-dark-400 text-sm">Configure DDDs, vendedores e acompanhe o estado do rodízio</p>
        </div>
        <Button onClick={() => setCreateRegionModal(true)}>
          <Plus size={16} />Nova Região
        </Button>
      </div>

      {/* Round-robin status */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw size={16} className="text-gold-400" />
          <h2 className="font-heading text-gold-400 font-semibold">Status do Rodízio</h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {roundRobin?.map((r) => (
            <div key={r.regionId} className="bg-dark-700/50 border border-dark-600 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <MapPin size={14} className="text-gold-400" />
                <span className="text-sm font-medium text-dark-200">{r.regionName}</span>
              </div>
              <div className="text-xs text-dark-400 mb-1">Próximo vendedor:</div>
              <div className="text-sm font-semibold text-gold-400">
                {r.nextVendor?.name ?? 'Nenhum vendedor'}
              </div>
              <div className="text-xs text-dark-500 mt-1">
                {r.vendors.length} vendedor{r.vendors.length !== 1 ? 'es' : ''} · #{r.nextIndex + 1}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Regions */}
      <div className="space-y-4">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 bg-dark-800 rounded-2xl animate-pulse" />
            ))
          : regions?.map((region) => (
              <div key={region.id} className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-heading text-gold-400 font-semibold text-lg">{region.name}</h3>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  {/* DDDs */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-dark-400 uppercase tracking-wide">DDDs</span>
                      <button
                        onClick={() => setAddDDDModal(region.id)}
                        className="text-xs text-gold-500 hover:text-gold-400 transition-colors flex items-center gap-1"
                      >
                        <Plus size={12} />Adicionar
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {region.ddds.map((d: any) => (
                        <span
                          key={d.id}
                          className="group flex items-center gap-1 px-2 py-0.5 bg-dark-700 border border-dark-600 rounded-lg text-xs text-dark-200 hover:border-red-600/50 transition-colors cursor-pointer"
                          onClick={() => removeDDDMut.mutate({ id: d.id })}
                          title="Clique para remover"
                        >
                          {d.ddd}
                          <span className="hidden group-hover:inline text-red-400">×</span>
                        </span>
                      ))}
                      {region.ddds.length === 0 && (
                        <span className="text-xs text-dark-500">Nenhum DDD configurado</span>
                      )}
                    </div>
                  </div>

                  {/* Vendors */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-dark-400 uppercase tracking-wide">Vendedores</span>
                      <button
                        onClick={() => setAddVendorModal(region.id)}
                        className="text-xs text-gold-500 hover:text-gold-400 transition-colors flex items-center gap-1"
                      >
                        <Plus size={12} />Adicionar
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {region.regionVendors.map((rv: any) => (
                        <div key={rv.id} className="flex items-center justify-between group">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-gold-700/30 border border-gold-600/30 flex items-center justify-center text-gold-400 text-xs font-semibold">
                              {rv.vendor.name.charAt(0)}
                            </div>
                            <span className="text-sm text-dark-200">{rv.vendor.name}</span>
                          </div>
                          <button
                            onClick={() => removeVendorMut.mutate({ regionId: region.id, vendorId: rv.vendorId })}
                            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                      {region.regionVendors.length === 0 && (
                        <span className="text-xs text-dark-500">Nenhum vendedor atribuído</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
      </div>

      {/* Add DDD Modal */}
      <Modal open={!!addDDDModal} onClose={() => setAddDDDModal(null)} title="Adicionar DDD" size="sm">
        <div className="space-y-4">
          <Input label="DDD" placeholder="ex: 47" type="number" value={newDDD} onChange={(e) => setNewDDD(e.target.value)} />
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setAddDDDModal(null)}>Cancelar</Button>
            <Button className="flex-1" loading={addDDDMut.isPending} disabled={!newDDD}
              onClick={() => addDDDModal && addDDDMut.mutate({ regionId: addDDDModal, ddd: parseInt(newDDD) })}>
              Adicionar
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Vendor Modal */}
      <Modal open={!!addVendorModal} onClose={() => setAddVendorModal(null)} title="Adicionar Vendedor à Região" size="sm">
        <div className="space-y-4">
          <Select label="Vendedor" options={vendorOptions} placeholder="Selecione..."
            value={newVendorId} onChange={(e) => setNewVendorId(e.target.value)} />
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setAddVendorModal(null)}>Cancelar</Button>
            <Button className="flex-1" loading={addVendorMut.isPending} disabled={!newVendorId}
              onClick={() => addVendorModal && newVendorId && addVendorMut.mutate({ regionId: addVendorModal, vendorId: parseInt(newVendorId) })}>
              Adicionar
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create Region Modal */}
      <Modal open={createRegionModal} onClose={() => setCreateRegionModal(false)} title="Nova Região" size="sm">
        <div className="space-y-4">
          <Input label="Nome da região" placeholder="ex: Sul, Nordeste..." value={newRegionName} onChange={(e) => setNewRegionName(e.target.value)} />
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setCreateRegionModal(false)}>Cancelar</Button>
            <Button className="flex-1" loading={createRegionMut.isPending} disabled={!newRegionName}
              onClick={() => createRegionMut.mutate({ name: newRegionName })}>
              Criar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
