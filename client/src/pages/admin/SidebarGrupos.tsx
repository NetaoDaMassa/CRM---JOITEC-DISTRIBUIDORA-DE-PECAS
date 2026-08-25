import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import { ADMIN_LINKS, VENDOR_LINKS, NOMES_ICONES_GRUPO } from '../../components/Sidebar'

// Mesma lista de itens agrupáveis validada no backend (server/src/router/sidebarGrupos.ts)
// — rotulados (admin)/(vendedor) porque um grupo pode conter a versão de
// cada papel do mesmo conceito (ex: "Leads" admin e vendedor no mesmo
// grupo "Marketing") — cada usuário só vê a que existe pro papel dele.
const ITENS_ADMIN = ADMIN_LINKS.map((l) => ({ to: l.to, label: `${l.label} (admin)` }))
const ITENS_VENDEDOR = VENDOR_LINKS.map((l) => ({ to: l.to, label: `${l.label} (vendedor)` }))
const ITENS_EXTRAS = [
  { to: '/painel-tv', label: 'Painel de TV' },
  { to: '/admin/permissoes', label: 'Permissões' },
  { to: '/admin/funcoes', label: 'Funções' },
  { to: '/admin/leads-regioes', label: 'Regiões de Leads' },
  { to: '/admin/sidebar-grupos', label: 'Grupos da Sidebar' },
  { to: '/painel-financeiro', label: 'Painel Financeiro' },
]
const TODOS_ITENS = [...ITENS_ADMIN, ...ITENS_VENDEDOR, ...ITENS_EXTRAS]

interface GrupoForm {
  nome: string
  icone: string
  itens: string[]
}

const FORM_VAZIO: GrupoForm = { nome: '', icone: 'Folder', itens: [] }

// Grupos colapsáveis da sidebar (ex: "Marketing" juntando Leads/Kanban de
// Leads/Solicitar Arte) — vale pra todo mundo que usa o sistema, não só
// pra quem configura aqui. Item que não está em nenhum grupo continua
// aparecendo solto na sidebar, igual sempre foi.
export default function SidebarGrupos() {
  const [selecionadoId, setSelecionadoId] = useState<number | 'novo' | null>(null)
  const [form, setForm] = useState<GrupoForm>(FORM_VAZIO)

  const utils = trpc.useUtils()
  const { data: grupos, isLoading } = trpc.sidebarGrupos.listar.useQuery()

  useEffect(() => {
    if (selecionadoId === null && grupos?.length) setSelecionadoId(grupos[0].id)
  }, [grupos, selecionadoId])

  useEffect(() => {
    if (selecionadoId === 'novo') {
      setForm(FORM_VAZIO)
      return
    }
    const alvo = grupos?.find((g) => g.id === selecionadoId)
    if (alvo) setForm({ nome: alvo.nome, icone: alvo.icone, itens: alvo.itens })
  }, [selecionadoId, grupos])

  const criarMut = trpc.sidebarGrupos.criar.useMutation({
    onSuccess(data) {
      toast.success('Grupo criado')
      utils.sidebarGrupos.listar.invalidate()
      setSelecionadoId(data.id)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const atualizarMut = trpc.sidebarGrupos.atualizar.useMutation({
    onSuccess() {
      toast.success('Grupo salvo')
      utils.sidebarGrupos.listar.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const excluirMut = trpc.sidebarGrupos.excluir.useMutation({
    onSuccess() {
      toast.success('Grupo excluído')
      utils.sidebarGrupos.listar.invalidate()
      setSelecionadoId(null)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function toggleItem(to: string) {
    setForm((prev) => ({
      ...prev,
      itens: prev.itens.includes(to) ? prev.itens.filter((i) => i !== to) : [...prev.itens, to],
    }))
  }

  function salvar() {
    const nome = form.nome.trim()
    if (!nome) return toast.error('Dê um nome pro grupo.')
    if (selecionadoId === 'novo') {
      criarMut.mutate({ nome, icone: form.icone, itens: form.itens as never })
    } else if (typeof selecionadoId === 'number') {
      atualizarMut.mutate({ id: selecionadoId, nome, icone: form.icone, itens: form.itens as never })
    }
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Grupos da Sidebar</h1>
        <p className="text-sm text-dark-400">
          Junte itens do menu em grupos que abrem/fecham (ex: "Marketing" com Leads, Kanban de Leads, Solicitar Arte) — deixa o menu mais
          enxuto pra todo mundo. Item fora de qualquer grupo continua aparecendo solto, igual sempre.
        </p>
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}

      {!isLoading && (
        <div className="grid grid-cols-[240px_1fr] gap-4">
          <div className="space-y-2 self-start">
            <Button size="sm" variant="secondary" className="w-full" onClick={() => setSelecionadoId('novo')}>
              <Plus size={14} />
              Novo grupo
            </Button>
            <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700 overflow-hidden">
              {grupos?.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setSelecionadoId(g.id)}
                  className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                    selecionadoId === g.id ? 'bg-gold-600/20 text-gold-400' : 'text-dark-200 hover:bg-dark-700'
                  }`}
                >
                  <p className="font-medium truncate">{g.nome}</p>
                  <p className="text-xs text-dark-500">
                    {g.itens.length} ite{g.itens.length !== 1 ? 'ns' : 'm'}
                  </p>
                </button>
              ))}
              {!grupos?.length && <p className="px-4 py-3 text-sm text-dark-500">Nenhum grupo ainda.</p>}
            </div>
          </div>

          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-4 self-start">
            {selecionadoId == null ? (
              <p className="text-sm text-dark-400">Selecione um grupo à esquerda ou crie um novo.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Nome do grupo" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
                  <Select
                    label="Ícone"
                    value={form.icone}
                    onChange={(e) => setForm({ ...form, icone: e.target.value })}
                    options={NOMES_ICONES_GRUPO.map((nome) => ({ value: nome, label: nome }))}
                  />
                </div>

                <div>
                  <p className="text-xs text-dark-500 mb-2">Itens dentro desse grupo</p>
                  <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                    {TODOS_ITENS.map(({ to, label }) => (
                      <label key={to} className="flex items-center gap-2 text-sm text-dark-200 px-2 py-1.5 rounded-lg hover:bg-dark-700/50">
                        <input type="checkbox" className="accent-gold-500" checked={form.itens.includes(to)} onChange={() => toggleItem(to)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button loading={criarMut.isPending || atualizarMut.isPending} onClick={salvar}>
                    {selecionadoId === 'novo' ? 'Criar grupo' : 'Salvar alterações'}
                  </Button>
                  {typeof selecionadoId === 'number' && (
                    <Button
                      variant="danger"
                      loading={excluirMut.isPending}
                      onClick={() => {
                        if (confirm(`Excluir o grupo "${form.nome}"? Os itens dele voltam a aparecer soltos.`)) {
                          excluirMut.mutate({ id: selecionadoId })
                        }
                      }}
                    >
                      <Trash2 size={14} />
                      Excluir
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
