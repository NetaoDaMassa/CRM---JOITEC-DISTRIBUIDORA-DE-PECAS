import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { ADMIN_LINKS } from '../../components/Sidebar'

const FEATURES = ADMIN_LINKS.map((l) => ({ feature: l.feature, label: l.label }))

// Tela do superAdmin pra controlar, admin por admin, quais itens do menu
// ele enxerga. Presença de uma feature na lista = acesso liberado; quem é
// superAdmin nunca aparece aqui (sempre vê tudo, sem depender dessa tabela).
export default function Permissoes() {
  const [userIdSelecionado, setUserIdSelecionado] = useState<number | null>(null)
  const [featuresSelecionadas, setFeaturesSelecionadas] = useState<string[]>([])

  const utils = trpc.useUtils()
  const { data: admins, isLoading } = trpc.permissoes.listarAdmins.useQuery()

  const adminAtual = admins?.find((a) => a.id === userIdSelecionado) ?? admins?.[0]

  useEffect(() => {
    if (adminAtual && userIdSelecionado === null) setUserIdSelecionado(adminAtual.id)
  }, [adminAtual, userIdSelecionado])

  useEffect(() => {
    if (adminAtual) setFeaturesSelecionadas(adminAtual.features)
  }, [adminAtual?.id])

  const atualizarMut = trpc.permissoes.atualizar.useMutation({
    onSuccess() {
      toast.success('Permissões salvas')
      utils.permissoes.listarAdmins.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function toggleFeature(feature: string) {
    setFeaturesSelecionadas((prev) => (prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature]))
  }

  function salvar() {
    if (!adminAtual) return
    atualizarMut.mutate({ userId: adminAtual.id, features: featuresSelecionadas as never })
  }

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Permissões de acesso</h1>
        <p className="text-sm text-dark-400">Escolha quais itens do menu cada administrador enxerga. Você (admin principal) sempre vê tudo.</p>
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}
      {!isLoading && !admins?.length && <p className="text-dark-400 text-sm">Nenhum administrador cadastrado.</p>}

      {!!admins?.length && (
        <div className="grid grid-cols-[240px_1fr] gap-4">
          <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700 overflow-hidden self-start">
            {admins.map((a) => (
              <button
                key={a.id}
                onClick={() => setUserIdSelecionado(a.id)}
                className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                  adminAtual?.id === a.id ? 'bg-gold-600/20 text-gold-400' : 'text-dark-200 hover:bg-dark-700'
                }`}
              >
                <p className="font-medium truncate">{a.name}</p>
                <p className="text-xs text-dark-500 truncate">
                  {a.superAdmin ? 'Admin principal · acesso total' : `@${a.username}`}
                  {!a.isActive ? ' · inativo' : ''}
                </p>
              </button>
            ))}
          </div>

          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-4">
            {adminAtual?.superAdmin ? (
              <p className="text-sm text-dark-400">{adminAtual.name} é admin principal e sempre tem acesso a todos os itens — não precisa configurar.</p>
            ) : adminAtual ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {FEATURES.map(({ feature, label }) => (
                    <label key={feature} className="flex items-center gap-2 text-sm text-dark-200 px-2 py-1.5 rounded-lg hover:bg-dark-700/50">
                      <input
                        type="checkbox"
                        className="accent-gold-500"
                        checked={featuresSelecionadas.includes(feature)}
                        onChange={() => toggleFeature(feature)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <Button loading={atualizarMut.isPending} onClick={salvar}>
                  Salvar permissões de {adminAtual.name}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
