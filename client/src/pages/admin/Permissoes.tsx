import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { ADMIN_LINKS, VENDOR_LINKS } from '../../components/Sidebar'

// Painel Financeiro e Painel de TV não são itens do menu comum (ADMIN_LINKS)
// — são links à parte no Sidebar, renderizados fora do links.map(). Somados
// aqui na mão pra aparecerem junto no checklist de permissões.
const FEATURES = [
  ...ADMIN_LINKS.map((l) => ({ feature: l.feature, label: l.label })),
  { feature: 'painel_financeiro', label: 'Painel Financeiro' },
  { feature: 'painel_tv', label: 'Painel de TV' },
]

const FEATURES_VENDEDOR = VENDOR_LINKS.map((l) => ({ feature: l.feature, label: l.label }))

const FEATURES_RELATORIOS = [
  { feature: 'relatorio_visao_geral', label: 'Visão geral' },
  { feature: 'relatorio_contatos', label: 'Contatos & Ligações' },
  { feature: 'relatorio_orcamentos', label: 'Orçamentos & Vendas' },
  { feature: 'relatorio_alertas', label: 'Alertas' },
]

// Tela do superAdmin pra controlar, pessoa por pessoa, quais itens do menu
// (admin) e quais abas de Relatórios (admin e vendedor) cada um enxerga.
// Presença de uma feature na lista = acesso liberado; quem é superAdmin
// nunca aparece aqui (sempre vê tudo, sem depender dessa tabela).
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
    <div className="p-6 max-w-4xl space-y-8">
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

                <div className="pt-2 border-t border-dark-700">
                  <p className="text-xs text-dark-500 mb-2">
                    Abas dentro de Relatórios (só valem se "Relatórios" acima também estiver marcado)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {FEATURES_RELATORIOS.map(({ feature, label }) => (
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
                </div>

                <Button loading={atualizarMut.isPending} onClick={salvar}>
                  Salvar permissões de {adminAtual.name}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      )}

      <PermissoesVendedor />

      <VinculoContas />
    </div>
  )
}

// Mesma ideia da seção de admin acima, agora com os itens de menu do
// vendedor (VENDOR_LINKS) + as abas de Relatórios juntos numa tela só.
function PermissoesVendedor() {
  const [userIdSelecionado, setUserIdSelecionado] = useState<number | null>(null)
  const [featuresSelecionadas, setFeaturesSelecionadas] = useState<string[]>([])

  const utils = trpc.useUtils()
  const { data: vendedores, isLoading } = trpc.permissoes.listarVendedores.useQuery()

  const vendedorAtual = vendedores?.find((v) => v.id === userIdSelecionado) ?? vendedores?.[0]

  useEffect(() => {
    if (vendedorAtual && userIdSelecionado === null) setUserIdSelecionado(vendedorAtual.id)
  }, [vendedorAtual, userIdSelecionado])

  useEffect(() => {
    if (vendedorAtual) setFeaturesSelecionadas(vendedorAtual.features)
  }, [vendedorAtual?.id])

  const atualizarMut = trpc.permissoes.atualizar.useMutation({
    onSuccess() {
      toast.success('Permissões salvas')
      utils.permissoes.listarVendedores.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function toggleFeature(feature: string) {
    setFeaturesSelecionadas((prev) => (prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature]))
  }

  function salvar() {
    if (!vendedorAtual) return
    atualizarMut.mutate({ userId: vendedorAtual.id, features: featuresSelecionadas as never })
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-heading text-lg text-dark-50">Permissões do vendedor</h2>
        <p className="text-sm text-dark-400">Escolha quais itens do menu e quais abas de Relatórios cada vendedor enxerga.</p>
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}
      {!isLoading && !vendedores?.length && <p className="text-dark-400 text-sm">Nenhum vendedor cadastrado.</p>}

      {!!vendedores?.length && (
        <div className="grid grid-cols-[240px_1fr] gap-4">
          <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700 overflow-hidden self-start max-h-96 overflow-y-auto">
            {vendedores.map((v) => (
              <button
                key={v.id}
                onClick={() => setUserIdSelecionado(v.id)}
                className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                  vendedorAtual?.id === v.id ? 'bg-gold-600/20 text-gold-400' : 'text-dark-200 hover:bg-dark-700'
                }`}
              >
                <p className="font-medium truncate">{v.name}</p>
                <p className="text-xs text-dark-500 truncate">
                  @{v.username}
                  {!v.isActive ? ' · inativo' : ''}
                </p>
              </button>
            ))}
          </div>

          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-4 self-start">
            {vendedorAtual ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {FEATURES_VENDEDOR.map(({ feature, label }) => (
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

                <div className="pt-2 border-t border-dark-700">
                  <p className="text-xs text-dark-500 mb-2">
                    Abas dentro de Relatórios (só valem se "Relatórios" acima também estiver marcado)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {FEATURES_RELATORIOS.map(({ feature, label }) => (
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
                </div>

                <Button loading={atualizarMut.isPending} onClick={salvar}>
                  Salvar permissões de {vendedorAtual.name}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

// Pra gente com mais de uma conta (mesma pessoa, empresa diferente — ex:
// Sergio vende em Joitec e em Odin Tubos, contas separadas porque a
// carteira é da empresa). Vinculando aqui, a pessoa ganha um seletor
// "trocar empresa" no Sidebar, igual o do superAdmin, sem precisar
// digitar senha de novo pra entrar na outra conta.
function VinculoContas() {
  const [userIdSelecionado, setUserIdSelecionado] = useState<number | null>(null)
  const [busca, setBusca] = useState('')
  const [selecionadas, setSelecionadas] = useState<number[]>([])

  const utils = trpc.useUtils()
  const { data: usuarios, isLoading } = trpc.contasVinculadas.listarUsuarios.useQuery()

  const usuarioAtual = usuarios?.find((u) => u.id === userIdSelecionado)

  useEffect(() => {
    if (usuarioAtual) setSelecionadas(usuarioAtual.contasVinculadas)
  }, [usuarioAtual?.id])

  const atualizarMut = trpc.contasVinculadas.atualizar.useMutation({
    onSuccess() {
      toast.success('Vínculo salvo')
      utils.contasVinculadas.listarUsuarios.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function toggleConta(id: number) {
    setSelecionadas((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  const usuariosFiltrados = usuarios?.filter((u) => u.name.toLowerCase().includes(busca.toLowerCase()))
  const candidatos = usuarios?.filter((u) => u.id !== userIdSelecionado)

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-heading text-lg text-dark-50">Vincular contas (troca rápida de empresa)</h2>
        <p className="text-sm text-dark-400">
          Pra quem tem mais de um login (mesma pessoa em empresas diferentes) — vincule as contas pra aparecer um
          seletor de "trocar empresa" sem precisar digitar senha de novo.
        </p>
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}

      {!!usuarios?.length && (
        <div className="grid grid-cols-[280px_1fr] gap-4">
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Buscar por nome..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full bg-dark-900 border border-dark-700 rounded-lg text-sm text-dark-100 px-3 py-2"
            />
            <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700 overflow-hidden max-h-96 overflow-y-auto">
              {usuariosFiltrados?.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setUserIdSelecionado(u.id)}
                  className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                    userIdSelecionado === u.id ? 'bg-gold-600/20 text-gold-400' : 'text-dark-200 hover:bg-dark-700'
                  }`}
                >
                  <p className="font-medium truncate">{u.name}</p>
                  <p className="text-xs text-dark-500 truncate">
                    @{u.username} · {u.empresaNome} · {u.role === 'admin' ? 'admin' : 'vendedor'}
                    {u.contasVinculadas.length > 0 ? ` · ${u.contasVinculadas.length} vínculo(s)` : ''}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-4 self-start">
            {usuarioAtual ? (
              <>
                <p className="text-sm text-dark-300">
                  Contas que <strong className="text-dark-100">{usuarioAtual.name}</strong> ({usuarioAtual.empresaNome}) pode
                  trocar sem senha:
                </p>
                <div className="max-h-80 overflow-y-auto space-y-1">
                  {candidatos?.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm text-dark-200 px-2 py-1.5 rounded-lg hover:bg-dark-700/50">
                      <input
                        type="checkbox"
                        className="accent-gold-500"
                        checked={selecionadas.includes(c.id)}
                        onChange={() => toggleConta(c.id)}
                      />
                      {c.name} <span className="text-dark-500">— {c.empresaNome} (@{c.username})</span>
                    </label>
                  ))}
                </div>
                <Button
                  loading={atualizarMut.isPending}
                  onClick={() => atualizarMut.mutate({ userId: usuarioAtual.id, contasVinculadasIds: selecionadas })}
                >
                  Salvar vínculos de {usuarioAtual.name}
                </Button>
              </>
            ) : (
              <p className="text-sm text-dark-400">Escolha uma pessoa na lista à esquerda.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
