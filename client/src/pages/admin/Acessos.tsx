import { useEffect, useMemo, useState } from 'react'
import { Copy, KeyRound, MessageCircle, Plus, Search, Trash2, Undo2, UserCheck, UserX, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'
import { textoContem } from '../../lib/utils'

// Funções e permissões (funções vivas, 2026-11-09). Só o superAdmin.
// - Funções: o que cada função libera, por área e nível. Mudar aqui muda
//   pra todo mundo da função.
// - Pessoas: o grupo inteiro numa lista; função + exceções de cada um,
//   senha, ativo e Painel de TV.
// Backend: server/src/router/acessos.ts.

type Camada = 'grupo' | 'empresa'
type TipoConta = 'admin' | 'vendor' | 'gestor'
const TIPO_LABEL: Record<TipoConta, string> = { admin: 'Administrativo', vendor: 'Vendedor (tem carteira e meta)', gestor: 'Gestor' }

interface FuncaoForm {
  id?: number
  nome: string
  descricao: string
  camada: Camada
  tipoConta: TipoConta
  itens: Record<string, number>
}

const soDigitos = (s: string) => s.replace(/\D/g, '')

function BotoesNivel({
  niveis,
  valor,
  rotulos,
  onChange,
  destaque,
}: {
  niveis: number[]
  valor: number
  rotulos: Record<number, string>
  onChange: (n: number) => void
  destaque?: boolean
}) {
  const opcoes = [0, ...niveis]
  return (
    <div role="group" className={`flex gap-0.5 rounded-lg p-0.5 ${destaque ? 'bg-orange-500/15 ring-1 ring-orange-400/60' : 'bg-dark-900'}`}>
      {opcoes.map((n) => {
        const ativo = n === valor
        const cor = !ativo ? 'text-dark-300 hover:bg-dark-700' : n === 0 ? 'bg-dark-600 text-dark-50' : n === 1 ? 'bg-sky-500/25 text-sky-200' : n === 2 ? 'bg-sky-600 text-white' : 'bg-indigo-700 text-white'
        return (
          <button key={n} type="button" aria-pressed={ativo} onClick={() => onChange(n)} className={`min-h-[34px] rounded-md px-2.5 text-xs font-medium transition-colors ${cor}`}>
            {rotulos[n]}
          </button>
        )
      })}
    </div>
  )
}

export default function Acessos() {
  const [aba, setAba] = useState<'funcoes' | 'pessoas'>('funcoes')
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-dark-50">Funções e permissões</h1>
          <p className="text-sm text-dark-400">Cada pessoa fica ligada a uma função. Mudou a função, muda pra todo mundo dela. O que alguém tiver de diferente aparece como exceção.</p>
        </div>
        <nav className="flex gap-1 rounded-xl bg-dark-800 p-1">
          {(['funcoes', 'pessoas'] as const).map((a) => (
            <button key={a} type="button" onClick={() => setAba(a)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${aba === a ? 'bg-dark-600 text-dark-50' : 'text-dark-300 hover:text-dark-100'}`}>
              {a === 'funcoes' ? 'Funções' : 'Pessoas'}
            </button>
          ))}
        </nav>
      </div>
      {aba === 'funcoes' ? <AbaFuncoes /> : <AbaPessoas />}
    </div>
  )
}

// ───────────────────────────── Funções ─────────────────────────────

function AbaFuncoes() {
  const utils = trpc.useUtils()
  const { data: catalogo } = trpc.acessos.catalogo.useQuery()
  const { data: funcoes, isLoading } = trpc.acessos.funcoes.useQuery()
  const [selId, setSelId] = useState<number | 'nova' | null>(null)
  const [form, setForm] = useState<FuncaoForm | null>(null)
  const [original, setOriginal] = useState<string>('')

  const atual = funcoes?.find((f) => f.id === selId)
  useEffect(() => {
    if (selId === null && funcoes?.length) setSelId(funcoes[0].id)
  }, [funcoes, selId])
  useEffect(() => {
    if (selId === 'nova') {
      const f: FuncaoForm = { nome: '', descricao: '', camada: 'empresa', tipoConta: 'admin', itens: {} }
      setForm(f)
      setOriginal(JSON.stringify(f))
    } else if (atual) {
      const f: FuncaoForm = { id: atual.id, nome: atual.nome, descricao: atual.descricao ?? '', camada: atual.camada, tipoConta: atual.tipoConta, itens: atual.itens }
      setForm(f)
      setOriginal(JSON.stringify(f))
    }
  }, [selId, atual?.id, atual?.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const salvarMut = trpc.acessos.salvarFuncao.useMutation({
    onSuccess(r) {
      toast.success(r.afetadas ? `Salvo — atualizado para ${r.afetadas} pessoa(s)` : 'Função salva')
      utils.acessos.funcoes.invalidate()
      utils.acessos.pessoas.invalidate()
      setSelId(r.id)
    },
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.acessos.excluirFuncao.useMutation({
    onSuccess() {
      toast.success('Função excluída')
      setSelId(null)
      utils.acessos.funcoes.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  const sujo = !!form && JSON.stringify(form) !== original
  const porArea = useMemo(() => {
    if (!catalogo) return []
    return catalogo.areas.map((area) => ({ area, itens: catalogo.itens.filter((i) => i.area === area) })).filter((a) => a.itens.length)
  }, [catalogo])

  function trocar(id: number | 'nova') {
    if (sujo && !window.confirm('Você tem alterações não salvas nesta função. Descartar?')) return
    setSelId(id)
  }

  if (isLoading || !catalogo) return <p className="text-sm text-dark-400">Carregando...</p>

  const grupos: { titulo: string; dica: string; camada: Camada }[] = [
    { titulo: 'Setores do grupo', dica: 'Atendem todas as empresas: trocam de empresa pelo seletor no topo, sempre só nas telas da função.', camada: 'grupo' },
    { titulo: 'Em cada empresa', dica: 'A pessoa só enxerga a empresa dela.', camada: 'empresa' },
  ]

  return (
    <div className="flex flex-wrap items-start gap-6">
      <aside className="flex w-full flex-col gap-5 rounded-2xl border border-dark-600 bg-dark-800 p-4 lg:w-72">
        {grupos.map((g) => (
          <div key={g.camada} className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-dark-400">{g.titulo}</p>
            <p className="text-xs text-dark-500">{g.dica}</p>
            {funcoes
              ?.filter((f) => f.camada === g.camada)
              .map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => trocar(f.id)}
                  className={`flex min-h-[44px] items-center justify-between gap-2 rounded-xl border px-3 text-left text-sm ${selId === f.id ? 'border-gold-500 bg-gold-600/15 font-semibold text-gold-300' : 'border-dark-600 text-dark-100 hover:bg-dark-700'}`}
                >
                  <span>{f.nome}</span>
                  <span className="flex items-center gap-1 text-xs text-dark-400">
                    <Users size={12} />
                    {f.pessoas}
                  </span>
                </button>
              ))}
          </div>
        ))}
        <Button variant="outline" onClick={() => trocar('nova')}>
          <Plus size={14} /> Nova função
        </Button>
      </aside>

      {form && (
        <main className="min-w-0 flex-1 basis-[560px] space-y-4">
          <section className="space-y-4 rounded-2xl border border-dark-600 bg-dark-800 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Nome da função" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              <Input label="Descrição (opcional)" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
              <Select
                label="Onde trabalha"
                value={form.camada}
                onChange={(e) => setForm({ ...form, camada: e.target.value as Camada })}
                options={[
                  { value: 'empresa', label: 'Em uma empresa (Gerente, Vendedor, Estoque...)' },
                  { value: 'grupo', label: 'Setor do grupo — troca de empresa pelo seletor (Financeiro, Compras, RH...)' },
                ]}
              />
              <Select
                label="Tipo de conta de quem for criado nesta função"
                value={form.tipoConta}
                onChange={(e) => setForm({ ...form, tipoConta: e.target.value as TipoConta })}
                options={(Object.keys(TIPO_LABEL) as TipoConta[]).map((t) => ({ value: t, label: TIPO_LABEL[t] }))}
              />
            </div>
            {atual && (
              <p className="rounded-xl bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                Mudar aqui muda para <strong>todas as {atual.pessoas} pessoa(s)</strong> da função {atual.nome}. Ajuste de uma pessoa só é feito na aba Pessoas, como exceção.
              </p>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2 text-xs text-dark-300">
            <span className="font-semibold text-dark-100">Níveis:</span>
            <span className="rounded-md bg-dark-600 px-2 py-1">Não vê</span>
            <span className="rounded-md bg-sky-500/25 px-2 py-1 text-sky-200">Vê — só olha</span>
            <span className="rounded-md bg-sky-600 px-2 py-1 text-white">Usa — trabalha na tela</span>
            <span className="rounded-md bg-indigo-700 px-2 py-1 text-white">Gerencia — poderes a mais (passe o mouse no item)</span>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {porArea.map(({ area, itens }) => {
              const lib = itens.filter((i) => (form.itens[i.id] ?? 0) > 0).length
              return (
                <section key={area} className="rounded-2xl border border-dark-600 bg-dark-800 p-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <h3 className="font-semibold text-dark-50">{area}</h3>
                    <span className="text-xs text-dark-400">{lib ? `${lib} de ${itens.length} liberados` : 'nada liberado'}</span>
                  </div>
                  {itens.map((i) => (
                    <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-dark-700 py-2">
                      <span className={`text-sm ${(form.itens[i.id] ?? 0) > 0 ? 'text-dark-50' : 'text-dark-400'}`} title={i.dica ?? undefined}>
                        {i.nome}
                        {i.empresas.length > 0 && <span className="ml-1 text-[11px] text-dark-500">(só {i.empresas.join(', ')})</span>}
                      </span>
                      <BotoesNivel
                        niveis={i.niveis}
                        valor={form.itens[i.id] ?? 0}
                        rotulos={catalogo.niveis}
                        onChange={(n) => {
                          const itens2 = { ...form.itens }
                          if (n === 0) delete itens2[i.id]
                          else itens2[i.id] = n
                          setForm({ ...form, itens: itens2 })
                        }}
                      />
                    </div>
                  ))}
                </section>
              )
            })}
          </div>

          <div className={`sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 ${sujo ? 'bg-indigo-900 text-white shadow-lg' : 'bg-dark-800 text-dark-300'}`}>
            <span className="text-sm">{sujo ? (atual ? `Alterações ainda não salvas. Vão valer para as ${atual.pessoas} pessoa(s) de ${atual.nome}.` : 'Função nova, ainda não salva.') : 'Tudo salvo.'}</span>
            <div className="flex gap-2">
              {atual && atual.pessoas === 0 && (
                <Button variant="danger" onClick={() => window.confirm(`Excluir a função ${atual.nome}?`) && excluirMut.mutate({ id: atual.id })}>
                  <Trash2 size={14} /> Excluir função
                </Button>
              )}
              {sujo && (
                <Button variant="ghost" onClick={() => setForm(JSON.parse(original))}>
                  Descartar
                </Button>
              )}
              <Button disabled={!sujo || form.nome.trim().length < 2} loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ...form, descricao: form.descricao || undefined })}>
                Salvar
              </Button>
            </div>
          </div>
        </main>
      )}
    </div>
  )
}

// ───────────────────────────── Pessoas ─────────────────────────────

function AbaPessoas() {
  const utils = trpc.useUtils()
  const { data: pessoas, isLoading } = trpc.acessos.pessoas.useQuery()
  const { data: funcoes } = trpc.acessos.funcoes.useQuery()
  const { data: empresas } = trpc.acessos.empresas.useQuery()
  const [busca, setBusca] = useState('')
  const [empresaId, setEmpresaId] = useState('')
  const [funcaoId, setFuncaoId] = useState('')
  const [situacao, setSituacao] = useState<'ativos' | 'inativos'>('ativos')
  const [aberta, setAberta] = useState<number | null>(null)
  const [senha, setSenha] = useState<{ senhaTemporaria: string; nome: string; username: string; whatsapp: string | null } | null>(null)
  const [criando, setCriando] = useState(false)

  const atualizarMut = trpc.acessos.atualizarPessoa.useMutation({
    onSuccess: () => utils.acessos.pessoas.invalidate(),
    onError: (e) => toast.error(e.message),
  })
  const senhaMut = trpc.acessos.redefinirSenha.useMutation({ onSuccess: (r) => setSenha(r), onError: (e) => toast.error(e.message) })

  const nomeFuncao = new Map((funcoes ?? []).map((f) => [f.id, f.nome]))
  const camadaFuncao = new Map((funcoes ?? []).map((f) => [f.id, f.camada]))
  const lista = (pessoas ?? []).filter((p) => {
    if (situacao === 'ativos' ? !p.isActive : p.isActive) return false
    if (empresaId && String(p.empresaId) !== empresaId) return false
    if (funcaoId === 'sem' ? p.funcaoId !== null : funcaoId && String(p.funcaoId) !== funcaoId) return false
    return textoContem(`${p.name} ${p.username}`, busca)
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Input icon={<Search size={14} />} placeholder="Buscar por nome ou login" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} options={[{ value: '', label: 'Todas as empresas' }, ...(empresas ?? []).map((e) => ({ value: e.id, label: e.nome }))]} />
        <Select value={funcaoId} onChange={(e) => setFuncaoId(e.target.value)} options={[{ value: '', label: 'Todas as funções' }, { value: 'sem', label: 'Sem função' }, ...(funcoes ?? []).map((f) => ({ value: f.id, label: f.nome }))]} />
        <Select value={situacao} onChange={(e) => setSituacao(e.target.value as 'ativos' | 'inativos')} options={[{ value: 'ativos', label: 'Ativos' }, { value: 'inativos', label: 'Desativados' }]} />
        <Button onClick={() => setCriando(true)}>
          <Plus size={14} /> Nova pessoa
        </Button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-dark-600 bg-dark-800">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-dark-900/60 text-left text-xs uppercase tracking-wide text-dark-400">
            <tr>
              <th className="px-4 py-3">Pessoa</th>
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3">Função</th>
              <th className="px-4 py-3">Na TV</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-dark-400">Carregando...</td>
              </tr>
            )}
            {lista.map((p) => (
              <tr key={p.id} className="border-t border-dark-700">
                <td className="px-4 py-3">
                  <button type="button" className="text-left" onClick={() => setAberta(p.id)}>
                    <span className="block font-semibold text-dark-50 hover:underline">{p.name}</span>
                    <span className="text-xs text-dark-400">@{p.username}{p.role === 'vendor' ? ' · vendedor' : ''}</span>
                  </button>
                </td>
                <td className="px-4 py-3 text-dark-200">
                  {p.funcaoId && camadaFuncao.get(p.funcaoId) === 'grupo' ? (
                    <span title={`Cadastro na ${p.empresaNome}; troca de empresa pelo seletor`} className="rounded-md bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-200">Todas as empresas</span>
                  ) : (
                    p.empresaNome
                  )}
                </td>
                <td className="px-4 py-3">
                  {p.superAdmin ? (
                    <span className="text-gold-300">Admin principal · vê tudo</span>
                  ) : p.funcaoId ? (
                    <span className="text-dark-100">
                      {nomeFuncao.get(p.funcaoId)}
                      {p.excecoes > 0 && <span className="ml-2 rounded bg-orange-500/20 px-1.5 py-0.5 text-xs font-semibold text-orange-300">+{p.excecoes} exceç{p.excecoes > 1 ? 'ões' : 'ão'}</span>}
                    </span>
                  ) : (
                    <span className="text-dark-500">sem função</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    aria-pressed={!p.ocultoPainelTv}
                    aria-label={`Aparece no Painel de TV: ${p.name}`}
                    onClick={() => atualizarMut.mutate({ id: p.id, ocultoPainelTv: !p.ocultoPainelTv })}
                    className={`flex h-7 w-12 items-center rounded-full p-0.5 transition-colors ${!p.ocultoPainelTv ? 'justify-end bg-sky-600' : 'justify-start bg-dark-600'}`}
                  >
                    <span className="h-6 w-6 rounded-full bg-white" />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => setAberta(p.id)}>
                      Permissões
                    </Button>
                    <Button size="sm" variant="secondary" loading={senhaMut.isPending && senhaMut.variables?.id === p.id} onClick={() => window.confirm(`Gerar uma senha nova para ${p.name}? A senha atual deixa de funcionar.`) && senhaMut.mutate({ id: p.id })}>
                      <KeyRound size={13} /> Senha
                    </Button>
                    {!p.superAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => window.confirm(`${p.isActive ? 'Desativar' : 'Reativar'} ${p.name}?`) && atualizarMut.mutate({ id: p.id, isActive: !p.isActive })}>
                        {p.isActive ? <UserX size={13} /> : <UserCheck size={13} />} {p.isActive ? 'Desativar' : 'Reativar'}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && !lista.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-dark-400">Ninguém encontrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {aberta !== null && <PessoaModal id={aberta} onClose={() => setAberta(null)} />}
      {criando && <NovaPessoaModal onClose={() => setCriando(false)} onCriada={(r) => { setCriando(false); setSenha(r) }} />}
      <SenhaModal senha={senha} onClose={() => setSenha(null)} />
    </div>
  )
}

function SenhaModal({ senha, onClose }: { senha: { senhaTemporaria: string; nome: string; username: string; whatsapp: string | null } | null; onClose: () => void }) {
  if (!senha) return null
  const msg = `Olá, ${senha.nome}! Seu acesso ao CRM: usuário ${senha.username} e senha temporária ${senha.senhaTemporaria} — no primeiro acesso o sistema vai pedir para você criar a sua senha. https://joitec-crm.duckdns.org`
  const tel = senha.whatsapp ? soDigitos(senha.whatsapp) : ''
  const wa = tel ? `https://wa.me/${tel.length <= 11 ? '55' + tel : tel}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`
  return (
    <Modal open onClose={onClose} title={`Senha de ${senha.nome}`} size="sm">
      <div className="space-y-4">
        <div>
          <p className="text-xs text-dark-400">Usuário</p>
          <p className="font-mono text-dark-50">{senha.username}</p>
        </div>
        <div>
          <p className="text-xs text-dark-400">Senha temporária (vale para um acesso)</p>
          <p className="select-all rounded-lg bg-dark-900 px-3 py-2 font-mono text-xl font-bold tracking-wider text-dark-50">{senha.senhaTemporaria}</p>
        </div>
        <p className="text-xs text-dark-400">No primeiro login o CRM pede para a pessoa criar a senha dela. Anote ou envie agora: esta senha não aparece de novo.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigator.clipboard.writeText(senha.senhaTemporaria).then(() => toast.success('Senha copiada'))}>
            <Copy size={14} /> Copiar senha
          </Button>
          <a href={wa} target="_blank" rel="noreferrer" className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-green-700 px-4 text-sm font-semibold text-white hover:bg-green-600">
            <MessageCircle size={14} /> {tel ? 'Enviar no WhatsApp dela' : 'Enviar no WhatsApp'}
          </a>
        </div>
      </div>
    </Modal>
  )
}

function NovaPessoaModal({ onClose, onCriada }: { onClose: () => void; onCriada: (r: { senhaTemporaria: string; nome: string; username: string; whatsapp: string | null }) => void }) {
  const utils = trpc.useUtils()
  const { data: funcoes } = trpc.acessos.funcoes.useQuery()
  const { data: empresas } = trpc.acessos.empresas.useQuery()
  const [f, setF] = useState({ empresaId: '', name: '', username: '', funcaoId: '', whatsapp: '' })
  const criarMut = trpc.acessos.criarPessoa.useMutation({
    onSuccess(r) {
      utils.acessos.pessoas.invalidate()
      utils.acessos.funcoes.invalidate()
      onCriada({ senhaTemporaria: r.senhaTemporaria, nome: f.name, username: f.username.trim().toLowerCase(), whatsapp: f.whatsapp || null })
    },
    onError: (e) => toast.error(e.message),
  })
  const funcao = funcoes?.find((x) => String(x.id) === f.funcaoId)
  return (
    <Modal open onClose={onClose} title="Nova pessoa" size="md">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          criarMut.mutate({ empresaId: Number(f.empresaId), name: f.name, username: f.username, funcaoId: Number(f.funcaoId), whatsapp: f.whatsapp || undefined })
        }}
      >
        <Input label="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <Input label="Login" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
        <Select label="Função" value={f.funcaoId} onChange={(e) => setF({ ...f, funcaoId: e.target.value })} placeholder="Escolha" options={(funcoes ?? []).map((x) => ({ value: x.id, label: x.nome }))} required />
        <Select
          label={funcao?.camada === 'grupo' ? 'Empresa de cadastro (setor do grupo)' : 'Empresa'}
          value={f.empresaId}
          onChange={(e) => setF({ ...f, empresaId: e.target.value })}
          placeholder="Escolha"
          options={(empresas ?? []).map((x) => ({ value: x.id, label: x.nome }))}
          required
        />
        <Input label="WhatsApp (opcional, pra mandar a senha)" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} />
        {funcao && <p className="text-xs text-dark-400">Já nasce com tudo o que a função {funcao.nome} libera{funcao.tipoConta === 'vendor' ? ', como vendedor (com carteira e meta do mês)' : ''}.</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={criarMut.isPending}>
            Criar e gerar senha
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function PessoaModal({ id, onClose }: { id: number; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data: p, isLoading } = trpc.acessos.pessoa.useQuery({ id })
  const { data: funcoes } = trpc.acessos.funcoes.useQuery()
  const { data: catalogo } = trpc.acessos.catalogo.useQuery()
  const [novaFuncao, setNovaFuncao] = useState('')
  const [manter, setManter] = useState(true)

  const invalidar = () => {
    utils.acessos.pessoa.invalidate({ id })
    utils.acessos.pessoas.invalidate()
    utils.acessos.funcoes.invalidate()
  }
  const funcaoMut = trpc.acessos.definirFuncao.useMutation({ onSuccess: () => { toast.success('Função alterada'); setNovaFuncao(''); invalidar() }, onError: (e) => toast.error(e.message) })
  const nivelMut = trpc.acessos.definirNivel.useMutation({ onSuccess: invalidar, onError: (e) => toast.error(e.message) })
  const igualarMut = trpc.acessos.igualarAFuncao.useMutation({ onSuccess: () => { toast.success('Agora igual à função'); invalidar() }, onError: (e) => toast.error(e.message) })

  const titulo = p ? `${p.name} · ${p.empresaNome}` : 'Pessoa'
  const excecoes = p?.itens.filter((i) => i.excecao) ?? []
  const nomeFuncao = funcoes?.find((f) => f.id === p?.funcaoId)?.nome

  return (
    <Modal open onClose={onClose} title={titulo} size="xl">
      {isLoading || !p || !catalogo ? (
        <p className="text-sm text-dark-400">Carregando...</p>
      ) : p.superAdmin ? (
        <p className="text-sm text-dark-300">Admin principal: sempre vê tudo, não usa função.</p>
      ) : (
        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          <section className="space-y-3 rounded-xl border border-dark-600 p-4">
            <p className="text-sm text-dark-200">
              Função: <strong className="text-dark-50">{nomeFuncao ?? 'nenhuma'}</strong>
              {!p.funcaoId && <span className="text-dark-400"> — esta pessoa ainda está no jeito antigo (permissões soltas).</span>}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Select value={novaFuncao} onChange={(e) => setNovaFuncao(e.target.value)} placeholder="Mudar para a função..." options={(funcoes ?? []).filter((f) => f.id !== p.funcaoId).map((f) => ({ value: f.id, label: f.nome }))} />
              <label className="flex items-center gap-2 text-sm text-dark-200">
                <input type="checkbox" className="accent-gold-500" checked={manter} onChange={(e) => setManter(e.target.checked)} />
                Manter o acesso de hoje (o que for diferente vira exceção)
              </label>
              <Button disabled={!novaFuncao} loading={funcaoMut.isPending} onClick={() => funcaoMut.mutate({ userId: p.id, funcaoId: Number(novaFuncao), manterAcesso: manter })}>
                Mudar função
              </Button>
            </div>
          </section>

          {p.funcaoId && (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-orange-500/10 px-4 py-3">
              <span className="text-sm text-orange-100">
                {excecoes.length ? `${excecoes.length} item(ns) diferente(s) da função — marcados em laranja abaixo.` : 'Nenhuma exceção: igual à função.'}
              </span>
              {excecoes.length > 0 && (
                <Button size="sm" variant="secondary" loading={igualarMut.isPending} onClick={() => window.confirm(`Tirar todas as exceções de ${p.name}? Ela fica exatamente igual à função ${nomeFuncao}.`) && igualarMut.mutate({ userId: p.id })}>
                  <Undo2 size={13} /> Deixar igual à função
                </Button>
              )}
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {catalogo.areas.map((area) => {
              const itens = p.itens.filter((i) => i.area === area)
              if (!itens.length) return null
              return (
                <section key={area} className="rounded-xl border border-dark-600 p-3">
                  <h3 className="mb-1 font-semibold text-dark-50">{area}</h3>
                  {itens.map((i) => (
                    <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-dark-700 py-2">
                      <span className="text-sm text-dark-100" title={i.dica ?? undefined}>
                        {i.nome}
                        {i.excecao && (
                          <span className="ml-1 text-[11px] text-orange-300">
                            (função: {catalogo.niveis[i.nivelFuncao as 0]}
                            {!i.exato ? ', acesso parcial' : ''})
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <BotoesNivel
                          niveis={i.niveis}
                          valor={i.nivel}
                          rotulos={catalogo.niveis}
                          destaque={i.excecao}
                          onChange={(n) => (p.funcaoId ? nivelMut.mutate({ userId: p.id, item: i.id, nivel: n }) : toast.error('Coloque a pessoa numa função primeiro'))}
                        />
                        {i.excecao && (
                          <button type="button" title="Voltar a seguir a função" aria-label={`Voltar ${i.nome} para o nível da função`} onClick={() => nivelMut.mutate({ userId: p.id, item: i.id, nivel: null })} className="rounded-md p-1.5 text-orange-300 hover:bg-dark-700">
                            <Undo2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </section>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}
