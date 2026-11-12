import { useState } from 'react'
import toast from 'react-hot-toast'
import { Users, Plus } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'

// Equipe do estoque (pedido do João, 2026-10-29) — quem aparece pra escolher
// na tela Expedição e o limite de erro de cada um (aba "Orientações" da
// planilha). Cada empresa tem a própria equipe.

type Colaborador = inferRouterOutputs<AppRouter>['expedicao']['colaboradores'][number]
const CARGOS = [
  { value: 'separador', label: 'Separador' },
  { value: 'conferente', label: 'Conferente' },
  { value: 'embalador', label: 'Embalador' },
  { value: 'conferente_embalador', label: 'Confere e embala' },
  { value: 'expedicao', label: 'Expedição' },
  { value: 'geral', label: 'Faz tudo (separa, confere e embala)' },
]

export default function ExpedicaoEquipe() {
  const { data = [] } = trpc.expedicao.colaboradores.useQuery()
  const [novo, setNovo] = useState(false)
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center">
            <Users size={20} className="text-teal-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Equipe do estoque</h1>
            <p className="text-sm text-dark-400">Quem separa, confere e embala nesta empresa, e o limite de erro de cada um</p>
          </div>
        </div>
        <Button onClick={() => setNovo(true)}>
          <Plus size={14} className="mr-1 inline" /> Adicionar pessoa
        </Button>
      </div>
      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {novo && <Linha onPronto={() => setNovo(false)} />}
        {data.map((c) => (
          <Linha key={c.id} colaborador={c} />
        ))}
        {data.length === 0 && !novo && <p className="p-4 text-sm text-dark-400">Ninguém cadastrado ainda.</p>}
      </div>
    </div>
  )
}

function Linha({ colaborador: c, onPronto }: { colaborador?: Colaborador; onPronto?: () => void }) {
  const utils = trpc.useUtils()
  const [nome, setNome] = useState(c?.nome ?? '')
  const [cargo, setCargo] = useState<Colaborador['cargo']>(c?.cargo ?? 'separador')
  const [limite, setLimite] = useState(String(Math.round((c?.limiteErro ?? 0.01) * 1000) / 10))
  const [ativo, setAtivo] = useState(c?.ativo ?? true)
  const salvar = trpc.expedicao.salvarColaborador.useMutation({
    onSuccess() {
      toast.success('Salvo')
      utils.expedicao.colaboradores.invalidate()
      onPronto?.()
    },
    onError: (e) => toast.error(e.message),
  })
  const mudou = !c || nome !== c.nome || cargo !== c.cargo || Number(limite) / 100 !== c.limiteErro || ativo !== c.ativo
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-[1.5fr_1fr_110px_auto_auto] gap-2 items-end p-3 ${ativo ? '' : 'opacity-60'}`}>
      <Input label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      <Select label="Cargo" value={cargo} onChange={(e) => setCargo(e.target.value as Colaborador['cargo'])} options={CARGOS} />
      <Input label="Limite de erro (%)" type="number" step="0.5" min={0} value={limite} onChange={(e) => setLimite(e.target.value)} />
      <label className="flex items-center gap-2 text-sm text-dark-300 pb-2">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo
      </label>
      <Button
        size="sm"
        disabled={!mudou || !nome.trim()}
        loading={salvar.isPending}
        onClick={() => salvar.mutate({ id: c?.id, nome, cargo, limiteErro: (Number(limite) || 0) / 100, ativo })}
      >
        Salvar
      </Button>
    </div>
  )
}
