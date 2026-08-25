import { useEffect, useState } from 'react'
import { Plus, Trash2, RotateCcw, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'

// Controle de regiões/DDDs/vendedores-por-região/rodízio do módulo de Leads
// — só o superAdmin ("admin principal") acessa (backend usa
// superAdminProcedure, e a rota ganha SuperAdminGuard igual a
// Permissoes.tsx/Funcoes.tsx). Fase 2 do plano (Bloco F).
export default function LeadsRegioes() {
  const [regiaoSelecionadaId, setRegiaoSelecionadaId] = useState<number | null>(null)
  const [novaRegiaoNome, setNovaRegiaoNome] = useState('')
  const [novoDdd, setNovoDdd] = useState('')
  const [novoVendorId, setNovoVendorId] = useState('')

  const utils = trpc.useUtils()
  const { data: regioes, isLoading } = trpc.leadsRegioes.listarRegioes.useQuery()
  const { data: vendedoresDisponiveis } = trpc.leadsRegioes.listarVendedoresDisponiveis.useQuery()

  useEffect(() => {
    if (regiaoSelecionadaId === null && regioes?.length) setRegiaoSelecionadaId(regioes[0].id)
  }, [regioes, regiaoSelecionadaId])

  const regiaoSelecionada = regioes?.find((r) => r.id === regiaoSelecionadaId)

  function invalidar() {
    utils.leadsRegioes.listarRegioes.invalidate()
  }

  const criarRegiaoMut = trpc.leadsRegioes.criarRegiao.useMutation({
    onSuccess(data) {
      toast.success('Região criada')
      setNovaRegiaoNome('')
      invalidar()
      setRegiaoSelecionadaId(data.id)
    },
    onError: (err) => toast.error(err.message),
  })

  const excluirRegiaoMut = trpc.leadsRegioes.excluirRegiao.useMutation({
    onSuccess() {
      toast.success('Região excluída')
      setRegiaoSelecionadaId(null)
      invalidar()
    },
    onError: (err) => toast.error(err.message),
  })

  const adicionarDddMut = trpc.leadsRegioes.adicionarDdd.useMutation({
    onSuccess() {
      setNovoDdd('')
      invalidar()
    },
    onError: (err) => toast.error(err.message),
  })

  const removerDddMut = trpc.leadsRegioes.removerDdd.useMutation({
    onSuccess: invalidar,
    onError: (err) => toast.error(err.message),
  })

  const adicionarVendedorMut = trpc.leadsRegioes.adicionarVendedorRegiao.useMutation({
    onSuccess() {
      setNovoVendorId('')
      invalidar()
    },
    onError: (err) => toast.error(err.message),
  })

  const removerVendedorMut = trpc.leadsRegioes.removerVendedorRegiao.useMutation({
    onSuccess: invalidar,
    onError: (err) => toast.error(err.message),
  })

  const resetarRodizioMut = trpc.leadsRegioes.resetarRodizio.useMutation({
    onSuccess() {
      toast.success('Rodízio zerado — próximo lead começa do primeiro vendedor da lista')
      invalidar()
    },
    onError: (err) => toast.error(err.message),
  })

  const vendedoresForaDaRegiao = vendedoresDisponiveis?.filter(
    (v) => !regiaoSelecionada?.vendedores.some((rv) => rv.vendorId === v.id)
  )

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Regiões e Rodízio de Leads</h1>
        <p className="text-sm text-dark-400">
          Controla quais DDDs pertencem a cada região e quais vendedores recebem leads dela por rodízio. Só o admin principal
          vê essa tela.
        </p>
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}

      {!isLoading && (
        <div className="grid grid-cols-[260px_1fr] gap-4">
          <div className="space-y-2 self-start">
            <div className="flex gap-2">
              <Input
                placeholder="Nome da nova região"
                value={novaRegiaoNome}
                onChange={(e) => setNovaRegiaoNome(e.target.value)}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="secondary"
                loading={criarRegiaoMut.isPending}
                onClick={() => {
                  if (!novaRegiaoNome.trim()) return toast.error('Dê um nome pra região')
                  criarRegiaoMut.mutate({ nome: novaRegiaoNome })
                }}
              >
                <Plus size={14} />
              </Button>
            </div>

            <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700 overflow-hidden">
              {regioes?.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRegiaoSelecionadaId(r.id)}
                  className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2 ${
                    regiaoSelecionadaId === r.id ? 'bg-gold-600/20 text-gold-400' : 'text-dark-200 hover:bg-dark-700'
                  }`}
                >
                  <MapPin size={14} className="shrink-0 opacity-60" />
                  <span className="flex-1 min-w-0">
                    <p className="font-medium truncate">{r.name}</p>
                    <p className="text-xs text-dark-500">
                      {r.ddds.length} DDD{r.ddds.length !== 1 ? 's' : ''} · {r.vendedores.length} vendedor
                      {r.vendedores.length !== 1 ? 'es' : ''}
                    </p>
                  </span>
                </button>
              ))}
              {!regioes?.length && <p className="px-4 py-3 text-sm text-dark-500">Nenhuma região ainda.</p>}
            </div>
          </div>

          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-5 self-start">
            {!regiaoSelecionada ? (
              <p className="text-sm text-dark-400">Selecione uma região à esquerda ou crie uma nova.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-dark-100">{regiaoSelecionada.name}</h2>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={excluirRegiaoMut.isPending}
                    onClick={() => {
                      if (confirm(`Excluir a região "${regiaoSelecionada.name}"? Os DDDs e vínculos de vendedor dela somem junto.`)) {
                        excluirRegiaoMut.mutate({ id: regiaoSelecionada.id })
                      }
                    }}
                  >
                    <Trash2 size={14} />
                    Excluir região
                  </Button>
                </div>

                <div>
                  <p className="text-xs text-dark-500 mb-2">DDDs desta região</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {regiaoSelecionada.ddds.map((d) => (
                      <span
                        key={d.id}
                        className="inline-flex items-center gap-1.5 bg-dark-700 border border-dark-600 rounded-full pl-3 pr-1.5 py-1 text-xs text-dark-200"
                      >
                        {d.ddd}
                        <button
                          onClick={() => removerDddMut.mutate({ dddId: d.id })}
                          className="text-dark-500 hover:text-red-400 rounded-full p-0.5"
                          title="Remover DDD"
                        >
                          <Trash2 size={11} />
                        </button>
                      </span>
                    ))}
                    {!regiaoSelecionada.ddds.length && <span className="text-xs text-dark-500">Nenhum DDD vinculado.</span>}
                  </div>
                  <div className="flex gap-2 max-w-xs">
                    <Input
                      placeholder="DDD (ex: 11)"
                      value={novoDdd}
                      onChange={(e) => setNovoDdd(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={adicionarDddMut.isPending}
                      onClick={() => {
                        const ddd = Number(novoDdd)
                        if (!ddd || ddd < 11 || ddd > 99) return toast.error('DDD inválido')
                        adicionarDddMut.mutate({ regionId: regiaoSelecionada.id, ddd })
                      }}
                    >
                      <Plus size={14} />
                    </Button>
                  </div>
                </div>

                <div className="pt-3 border-t border-dark-700">
                  <p className="text-xs text-dark-500 mb-2">Vendedores que recebem leads desta região (ordem do rodízio)</p>
                  <div className="space-y-1.5 mb-3">
                    {regiaoSelecionada.vendedores.map((v) => (
                      <div
                        key={v.id}
                        className="flex items-center justify-between bg-dark-700/60 border border-dark-600 rounded-lg px-3 py-1.5 text-sm text-dark-200"
                      >
                        {v.nome}
                        <button
                          onClick={() => removerVendedorMut.mutate({ vinculoId: v.id })}
                          className="text-dark-500 hover:text-red-400"
                          title="Remover da região"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    {!regiaoSelecionada.vendedores.length && (
                      <p className="text-xs text-dark-500">Nenhum vendedor vinculado — o rodízio não tem pra quem distribuir.</p>
                    )}
                  </div>
                  <div className="flex gap-2 max-w-sm">
                    <Select
                      value={novoVendorId}
                      onChange={(e) => setNovoVendorId(e.target.value)}
                      placeholder="Adicionar vendedor..."
                      className="flex-1"
                      options={(vendedoresForaDaRegiao ?? []).map((v) => ({
                        value: v.id,
                        label: v.isActive ? v.name : `${v.name} (inativo)`,
                      }))}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={adicionarVendedorMut.isPending}
                      onClick={() => {
                        if (!novoVendorId) return
                        adicionarVendedorMut.mutate({ regionId: regiaoSelecionada.id, vendorId: Number(novoVendorId) })
                      }}
                    >
                      <Plus size={14} />
                    </Button>
                  </div>
                </div>

                <div className="pt-3 border-t border-dark-700 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-dark-500">Cursor atual do rodízio</p>
                    <p className="text-sm text-dark-200 font-mono tabular-nums">
                      {regiaoSelecionada.rodizio
                        ? `posição ${regiaoSelecionada.rodizio.nextIndex % Math.max(regiaoSelecionada.vendedores.length, 1)} de ${regiaoSelecionada.vendedores.length || 0}`
                        : 'ainda não rodou nenhum lead nessa região'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={resetarRodizioMut.isPending}
                    onClick={() => {
                      if (confirm('Zerar o rodízio dessa região? O próximo lead vai pro primeiro vendedor da lista.')) {
                        resetarRodizioMut.mutate({ regionId: regiaoSelecionada.id })
                      }
                    }}
                  >
                    <RotateCcw size={14} />
                    Resetar
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
