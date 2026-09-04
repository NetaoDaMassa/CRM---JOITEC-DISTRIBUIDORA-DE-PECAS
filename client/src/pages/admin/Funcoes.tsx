import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import { ADMIN_LINKS, VENDOR_LINKS, FEATURES_SEMPRE_LIBERADAS } from '../../components/Sidebar'

// Painel Financeiro e Painel de TV não são itens do menu comum (ADMIN_LINKS)
// — mesma ressalva de Permissoes.tsx. Itens em FEATURES_SEMPRE_LIBERADAS
// (ex: Arquivos/Mídia) ficam de fora — já são visíveis pra todo mundo.
const FEATURES_ADMIN_UI = [
  ...ADMIN_LINKS.filter((l) => !FEATURES_SEMPRE_LIBERADAS.has(l.feature)).map((l) => ({ feature: l.feature, label: l.label })),
  { feature: 'painel_financeiro', label: 'Painel Financeiro' },
  { feature: 'painel_tv', label: 'Painel de TV' },
]
const FEATURES_VENDEDOR_UI = VENDOR_LINKS.filter((l) => !FEATURES_SEMPRE_LIBERADAS.has(l.feature)).map((l) => ({ feature: l.feature, label: l.label }))
const FEATURES_RELATORIOS_UI = [
  { feature: 'relatorio_visao_geral', label: 'Visão geral' },
  { feature: 'relatorio_contatos', label: 'Contatos & Ligações' },
  { feature: 'relatorio_orcamentos', label: 'Orçamentos & Vendas' },
  { feature: 'relatorio_alertas', label: 'Alertas' },
]

interface TemplateForm {
  nome: string
  role: 'admin' | 'vendor'
  features: string[]
}

const FORM_VAZIO: TemplateForm = { nome: '', role: 'admin', features: [] }

// Modelos de função usados na criação de usuário (Users.tsx) — cada um
// nasce com role + um conjunto de telas liberadas. Diferente de Permissões
// (que ajusta pessoa por pessoa), aqui o superAdmin cria/edita/apaga os
// próprios modelos — as 6 funções padrão (Vendedor/Administrador/Compras/
// RH/Financeiro/Marketing) só são o ponto de partida, dá pra mudar tudo.
export default function Funcoes() {
  const [selecionadoId, setSelecionadoId] = useState<number | 'novo' | null>(null)
  const [form, setForm] = useState<TemplateForm>(FORM_VAZIO)

  const utils = trpc.useUtils()
  const { data: templates, isLoading } = trpc.funcaoTemplates.listar.useQuery()

  useEffect(() => {
    if (selecionadoId === null && templates?.length) setSelecionadoId(templates[0].id)
  }, [templates, selecionadoId])

  useEffect(() => {
    if (selecionadoId === 'novo') {
      setForm(FORM_VAZIO)
      return
    }
    const alvo = templates?.find((t) => t.id === selecionadoId)
    if (alvo) setForm({ nome: alvo.nome, role: alvo.role, features: alvo.features })
  }, [selecionadoId, templates])

  const criarMut = trpc.funcaoTemplates.criar.useMutation({
    onSuccess(data) {
      toast.success('Função criada')
      utils.funcaoTemplates.listar.invalidate()
      setSelecionadoId(data.id)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const atualizarMut = trpc.funcaoTemplates.atualizar.useMutation({
    onSuccess() {
      toast.success('Função salva')
      utils.funcaoTemplates.listar.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const excluirMut = trpc.funcaoTemplates.excluir.useMutation({
    onSuccess() {
      toast.success('Função excluída')
      utils.funcaoTemplates.listar.invalidate()
      setSelecionadoId(null)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function toggleFeature(feature: string) {
    setForm((prev) => ({
      ...prev,
      features: prev.features.includes(feature) ? prev.features.filter((f) => f !== feature) : [...prev.features, feature],
    }))
  }

  function salvar() {
    const nome = form.nome.trim()
    if (!nome) return toast.error('Dê um nome pra essa função.')
    if (selecionadoId === 'novo') {
      criarMut.mutate({ nome, role: form.role, features: form.features as never })
    } else if (typeof selecionadoId === 'number') {
      atualizarMut.mutate({ id: selecionadoId, nome, role: form.role, features: form.features as never })
    }
  }

  const featuresDisponiveis = form.role === 'vendor' ? FEATURES_VENDEDOR_UI : FEATURES_ADMIN_UI

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Funções</h1>
        <p className="text-sm text-dark-400">
          Modelos usados na hora de criar um usuário — cada um já libera um conjunto de telas de cara. Crie, edite ou apague à vontade.
        </p>
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}

      {!isLoading && (
        <div className="grid grid-cols-[240px_1fr] gap-4">
          <div className="space-y-2 self-start">
            <Button size="sm" variant="secondary" className="w-full" onClick={() => setSelecionadoId('novo')}>
              <Plus size={14} />
              Nova função
            </Button>
            <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700 overflow-hidden">
              {templates?.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelecionadoId(t.id)}
                  className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                    selecionadoId === t.id ? 'bg-gold-600/20 text-gold-400' : 'text-dark-200 hover:bg-dark-700'
                  }`}
                >
                  <p className="font-medium truncate">{t.nome}</p>
                  <p className="text-xs text-dark-500">
                    {t.role === 'vendor' ? 'Vendedor' : 'Admin'} · {t.features.length} tela{t.features.length !== 1 ? 's' : ''}
                  </p>
                </button>
              ))}
              {!templates?.length && <p className="px-4 py-3 text-sm text-dark-500">Nenhuma função ainda.</p>}
            </div>
          </div>

          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-4 self-start">
            {selecionadoId == null ? (
              <p className="text-sm text-dark-400">Selecione uma função à esquerda ou crie uma nova.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Nome da função" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
                  <Select
                    label="Tipo de conta"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'vendor', features: [] })}
                    options={[
                      { value: 'admin', label: 'Administrador (telas de retaguarda)' },
                      { value: 'vendor', label: 'Vendedor (carteira/Kanban de vendas)' },
                    ]}
                  />
                </div>

                <div>
                  <p className="text-xs text-dark-500 mb-2">Telas liberadas pra essa função</p>
                  <div className="grid grid-cols-2 gap-2">
                    {featuresDisponiveis.map(({ feature, label }) => (
                      <label key={feature} className="flex items-center gap-2 text-sm text-dark-200 px-2 py-1.5 rounded-lg hover:bg-dark-700/50">
                        <input
                          type="checkbox"
                          className="accent-gold-500"
                          checked={form.features.includes(feature)}
                          onChange={() => toggleFeature(feature)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-dark-700">
                  <p className="text-xs text-dark-500 mb-2">
                    Abas dentro de Relatórios (só valem se "Relatórios" acima também estiver marcado)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {FEATURES_RELATORIOS_UI.map(({ feature, label }) => (
                      <label key={feature} className="flex items-center gap-2 text-sm text-dark-200 px-2 py-1.5 rounded-lg hover:bg-dark-700/50">
                        <input
                          type="checkbox"
                          className="accent-gold-500"
                          checked={form.features.includes(feature)}
                          onChange={() => toggleFeature(feature)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button loading={criarMut.isPending || atualizarMut.isPending} onClick={salvar}>
                    {selecionadoId === 'novo' ? 'Criar função' : 'Salvar alterações'}
                  </Button>
                  {typeof selecionadoId === 'number' && (
                    <Button
                      variant="danger"
                      loading={excluirMut.isPending}
                      onClick={() => {
                        if (confirm(`Excluir a função "${form.nome}"? Só dá se ninguém estiver usando ela.`)) {
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
