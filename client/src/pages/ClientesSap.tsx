import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { UserPlus, RefreshCw, EyeOff, Undo2, Link2, Wand2, Save, Power, UserCheck } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { formatarMoeda } from '../lib/moeda'
import Button from '../components/ui/Button'
import ComoUsar from '../components/ui/ComoUsar'
import Modal from '../components/ui/Modal'

// Clientes do SAP pra cadastrar (pedido do João, 2026-11-01) — ver
// server/src/lib/sapClientes.ts. Gestor de cada empresa: quem tem venda no
// SAP e não está no CRM + cadastros novos do SAP que não entraram sozinhos.
// SuperAdmin: liga os vendedores do SAP aos do CRM e o cadastro automático.

type Aba = 'comVenda' | 'novos' | 'vendedoresNovos' | 'vendedores'

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 2)

const classeSelect = 'h-9 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-2 max-w-60 focus:outline-none focus:border-gold-500'

export default function ClientesSap() {
  const { user } = useAuth()
  const superAdmin = !!user?.superAdmin
  const [aba, setAba] = useState<Aba>('comVenda')
  const [verIgnorados, setVerIgnorados] = useState(false)
  const [escolha, setEscolha] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)

  const utils = trpc.useUtils()
  const comVenda = trpc.clientesSap.comVenda.useQuery(undefined, { staleTime: 5 * 60_000, retry: false })
  const novos = trpc.clientesSap.novos.useQuery(undefined, { staleTime: 5 * 60_000, retry: false })
  const vendedoresNovos = trpc.clientesSap.vendedoresNovos.useQuery(undefined, { staleTime: 60_000, retry: false })
  const { data: vendedores } = trpc.users.vendors.useQuery()

  const recarregar = () => {
    utils.clientesSap.comVenda.invalidate()
    utils.clientesSap.novos.invalidate()
  }
  const deuCerto = (texto: string) => {
    setAviso({ ok: true, texto })
    recarregar()
  }
  const deuErro = (e: { message: string }) => setAviso({ ok: false, texto: e.message })
  const cadastrar = trpc.clientesSap.cadastrar.useMutation({ onSuccess: (r) => deuCerto(`Cliente ${r.codigo} cadastrado. As notas e vendas dele entram em alguns minutos.`), onError: deuErro })
  const ligarCodigo = trpc.clientesSap.ligarCodigo.useMutation({ onSuccess: () => deuCerto('Código do SAP ligado ao cliente do CRM. As notas dele entram em alguns minutos.'), onError: deuErro })
  const ignorar = trpc.clientesSap.ignorar.useMutation({ onSuccess: (_r, v) => deuCerto(v.ignorar ? 'Tirado da lista.' : 'Voltou para a lista.'), onError: deuErro })
  const ocupado = cadastrar.isPending || ligarCodigo.isPending || ignorar.isPending

  const listaVenda = (comVenda.data?.lista ?? []).filter((c) => verIgnorados || !c.ignorado)
  const listaNovos = (novos.data?.lista ?? []).filter((c) => verIgnorados || !c.ignorado)
  const pendVenda = (comVenda.data?.lista ?? []).filter((c) => !c.ignorado)
  const pendNovos = (novos.data?.lista ?? []).filter((c) => !c.ignorado)
  const opcoesVendedor = (vendedores ?? []).filter((v) => (v as { canalVenda?: string }).canalVenda !== 'nenhum')

  const Linha = ({
    c,
  }: {
    c: {
      codigo: string
      nome: string
      cnpj: string | null
      cidade: string | null
      vendedorSapNome: string
      ignorado: boolean
      pareceSer: { id: number; razaoSocial: string; codigo: string; excluido: boolean } | null
      vendedorSugeridoId?: number | null
      notas?: number
      valor?: number
      ultima?: string
      criadoEm?: string | null
    }
  }) => {
    const valorSelect = escolha[c.codigo] ?? (c.vendedorSugeridoId ? String(c.vendedorSugeridoId) : '')
    return (
      <div className={`bg-dark-800 border rounded-2xl p-4 space-y-2 ${c.ignorado ? 'border-dark-700 opacity-60' : 'border-dark-600'}`}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-dark-100">{c.nome}</p>
            <p className="text-xs text-dark-500">
              {c.codigo}
              {c.cnpj ? ` · ${c.cnpj}` : ''}
              {c.cidade ? ` · ${c.cidade}` : ''} · vendedor no SAP: {c.vendedorSapNome}
            </p>
            {c.notas !== undefined ? (
              <p className="text-xs text-dark-400 mt-0.5">
                {c.notas} nota(s) desde abril · última em {dataBr(c.ultima ?? null)}
              </p>
            ) : (
              <p className="text-xs text-dark-400 mt-0.5">Cadastrado no SAP em {dataBr(c.criadoEm ?? null)}</p>
            )}
          </div>
          {c.valor !== undefined && <p className="text-base font-bold font-mono text-dark-50">{formatarMoeda(c.valor)}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            {c.ignorado ? (
              <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => ignorar.mutate({ codigo: c.codigo, ignorar: false })}>
                <Undo2 size={14} /> Voltar
              </Button>
            ) : (
              <>
                {!c.pareceSer && (
                  <>
                    <select value={valorSelect} onChange={(e) => setEscolha((s) => ({ ...s, [c.codigo]: e.target.value }))} className={classeSelect} aria-label="Vendedor">
                      <option value="">Sem vendedor (Banco de Clientes)</option>
                      {opcoesVendedor.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" disabled={ocupado} onClick={() => cadastrar.mutate({ codigo: c.codigo, vendedorId: valorSelect ? Number(valorSelect) : null })}>
                      <UserPlus size={14} /> Cadastrar
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => ignorar.mutate({ codigo: c.codigo, ignorar: true })}>
                  <EyeOff size={14} /> Ignorar
                </Button>
              </>
            )}
          </div>
        </div>
        {c.pareceSer && !c.ignorado && (
          <div className="border-t border-dark-700/70 pt-2 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-dark-300">
              Mesmo CNPJ de{' '}
              <Link to={`/admin/clientes/${c.pareceSer.id}`} className="text-gold-400 hover:underline">
                {c.pareceSer.razaoSocial}
              </Link>{' '}
              (código {c.pareceSer.codigo}){c.pareceSer.excluido ? ' — está excluído no CRM' : ''}.
            </span>
            {!c.pareceSer.excluido && (
              <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => ligarCodigo.mutate({ clienteId: c.pareceSer!.id, codigo: c.codigo })}>
                <Link2 size={14} /> É o mesmo — usar o código do SAP
              </Button>
            )}
          </div>
        )}
      </div>
    )
  }

  const ABAS: { id: Aba; label: string; n?: number; valor?: number }[] = [
    { id: 'comVenda', label: 'Têm venda no SAP e não estão no CRM', n: pendVenda.length, valor: pendVenda.reduce((s, c) => s + c.valor, 0) },
    { id: 'novos', label: 'Cadastros novos do SAP', n: pendNovos.length },
    { id: 'vendedoresNovos', label: 'Vendedores novos', n: (vendedoresNovos.data?.lista ?? []).filter((v) => !v.ignorado).length },
    ...(superAdmin ? [{ id: 'vendedores' as Aba, label: 'Vendedores SAP × CRM' }] : []),
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center">
            <UserPlus size={20} className="text-teal-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Clientes do SAP para cadastrar</h1>
            <p className="text-sm text-dark-400">Clientes que estão no SAP e ainda não estão no CRM desta empresa. Cadastre com um clique, os dados vêm do SAP.</p>
          </div>
        </div>
        <Button
          variant="secondary"
          loading={comVenda.isFetching || novos.isFetching}
          onClick={async () => {
            await utils.clientesSap.comVenda.fetch({ atualizar: true }, { staleTime: 0 })
            recarregar()
          }}
        >
          <RefreshCw size={15} /> Buscar no SAP
        </Button>
      </div>

      <ComoUsar
        chave="clientes_sap"
        titulo="Como usar"
        passos={[
          <>
            <b>Têm venda no SAP e não estão no CRM</b>: clientes com nota de venda desta empresa (desde abril) que não estão cadastrados aqui. Sem cadastro, as vendas e os itens deles ficam de fora dos relatórios.
          </>,
          <>
            Escolha o <b>vendedor</b> (já vem sugerido quem tirou a última nota, quando dá) e clique em <b>Cadastrar</b>. Nome, CNPJ, endereço e telefone vêm do SAP. As notas e vendas dele entram em alguns minutos.
          </>,
          <>
            Quando o CNPJ já existe no CRM com outro código, aparece <b>"É o mesmo"</b>: liga o código do SAP no cliente que já existe, sem criar outro.
          </>,
          <>
            Cliente que não é para a carteira (ex.: empresa do grupo, venda avulsa): <b>Ignorar</b>.
          </>,
        ]}
        dicas={[
          'Cliente que já está no CRM nunca é mexido: a carteira e a empresa continuam as do CRM.',
          'Vendedor novo no SAP aparece na aba "Vendedores novos" para criar a conta com um clique.',
          'Cadastros novos no SAP entram sozinhos na carteira do vendedor ligado. Os que não têm vendedor ligado aparecem na aba "Cadastros novos do SAP".',
        ]}
      />

      {aviso && (
        <div className={`rounded-xl border px-4 py-2 text-sm flex items-center justify-between gap-3 ${aviso.ok ? 'border-green-700/50 bg-green-900/20 text-green-200' : 'border-red-700/50 bg-red-900/20 text-red-200'}`}>
          <span>{aviso.texto}</span>
          <button type="button" className="text-xs opacity-70 hover:opacity-100" onClick={() => setAviso(null)}>
            fechar
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            className={`text-left rounded-xl border px-3 py-2 text-sm transition-colors ${aba === a.id ? 'border-gold-600 bg-gold-900/10 text-dark-100' : 'border-dark-600 bg-dark-800 text-dark-300 hover:border-dark-500'}`}
          >
            {a.label}
            {a.n !== undefined && <b className="ml-1">{a.n}</b>}
            {a.valor !== undefined && <span className="text-dark-500 font-mono"> · {formatarMoeda(a.valor, { casas: 0 })}</span>}
          </button>
        ))}
        {aba !== 'vendedores' && (
          <label className="ml-auto flex items-center gap-2 text-xs text-dark-400">
            <input type="checkbox" checked={verIgnorados} onChange={(e) => setVerIgnorados(e.target.checked)} /> mostrar ignorados
          </label>
        )}
      </div>

      {aba === 'comVenda' &&
        (comVenda.error ? (
          <p className="text-sm text-red-300 bg-dark-800 border border-dark-600 rounded-2xl p-5">{comVenda.error.message}</p>
        ) : comVenda.isLoading ? (
          <div className="h-40 rounded-2xl bg-dark-800 animate-pulse" />
        ) : !comVenda.data?.suportada ? (
          <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">Esta empresa ainda não puxa clientes do SAP.</p>
        ) : listaVenda.length === 0 ? (
          <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">Todo cliente com venda no SAP já está no CRM. 👍</p>
        ) : (
          <div className="space-y-3">
            {listaVenda.map((c) => (
              <Linha key={c.codigo} c={c} />
            ))}
          </div>
        ))}

      {aba === 'novos' &&
        (novos.error ? (
          <p className="text-sm text-red-300 bg-dark-800 border border-dark-600 rounded-2xl p-5">{novos.error.message}</p>
        ) : novos.isLoading ? (
          <div className="h-40 rounded-2xl bg-dark-800 animate-pulse" />
        ) : !novos.data?.ligado ? (
          <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">O cadastro automático de clientes novos do SAP ainda não foi ligado.</p>
        ) : listaNovos.length === 0 ? (
          <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">Nenhum cadastro novo esperando (desde {dataBr(novos.data.desde)}). 👍</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-dark-500">Clientes cadastrados no SAP desde {dataBr(novos.data.desde)} cujo vendedor do SAP não está ligado a ninguém do CRM — por isso não entraram sozinhos.</p>
            {listaNovos.map((c) => (
              <Linha key={c.codigo} c={c} />
            ))}
          </div>
        ))}

      {aba === 'vendedoresNovos' && <VendedoresNovos verIgnorados={verIgnorados} onAviso={setAviso} />}

      {aba === 'vendedores' && superAdmin && <Vendedores onAviso={setAviso} />}
    </div>
  )
}

// Vendedor novo no SAP → conta no CRM (server/src/lib/sapVendedoresNovos.ts).
function VendedoresNovos({ verIgnorados, onAviso }: { verIgnorados: boolean; onAviso: (a: { ok: boolean; texto: string }) => void }) {
  const utils = trpc.useUtils()
  const { data, isLoading, error } = trpc.clientesSap.vendedoresNovos.useQuery(undefined, { staleTime: 60_000, retry: false })
  const [criando, setCriando] = useState<{ codigo: number; nome: string; username: string } | null>(null)
  const [senha, setSenha] = useState<{ username: string; senha: string } | null>(null)
  const recarregar = () => {
    utils.clientesSap.vendedoresNovos.invalidate()
    utils.users.vendors.invalidate()
  }
  const erro = (e: { message: string }) => onAviso({ ok: false, texto: e.message })
  const criar = trpc.clientesSap.criarContaVendedor.useMutation({
    onSuccess: (r) => {
      setCriando(null)
      setSenha({ username: r.username, senha: r.senhaTemporaria })
      recarregar()
    },
    onError: erro,
  })
  const ligar = trpc.clientesSap.ligarContaVendedor.useMutation({
    onSuccess: () => {
      onAviso({ ok: true, texto: 'Vendedor do SAP ligado à conta que já existe.' })
      recarregar()
    },
    onError: erro,
  })
  const ignorar = trpc.clientesSap.ignorarVendedor.useMutation({ onSuccess: recarregar, onError: erro })

  if (error) return <p className="text-sm text-red-300 bg-dark-800 border border-dark-600 rounded-2xl p-5">{error.message}</p>
  if (isLoading) return <div className="h-40 rounded-2xl bg-dark-800 animate-pulse" />
  if (!data?.suportada) return <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">Esta empresa não puxa vendedores do SAP.</p>
  const lista = data.lista.filter((v) => verIgnorados || !v.ignorado)

  return (
    <div className="space-y-3">
      <p className="text-xs text-dark-500">Vendedores cadastrados no SAP que ainda não têm conta no CRM. A conta é criada em {data.empresa}, com a função Vendedor e a meta padrão do mês.</p>
      {lista.length === 0 ? (
        <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">Nenhum vendedor novo esperando. 👍</p>
      ) : (
        lista.map((v) => (
          <div key={v.codigo} className={`flex flex-wrap items-center gap-3 bg-dark-800 border border-dark-600 rounded-2xl px-4 py-3 ${v.ignorado ? 'opacity-60' : ''}`}>
            <div className="flex-1 min-w-48">
              <p className="text-sm font-semibold text-dark-100">{v.nome}</p>
              <p className="text-xs text-dark-500">
                código {v.codigo} · visto em {dataBr(v.vistoEm)} · {v.pedidos === 0 ? 'ainda sem pedido, confira se é desta empresa' : `${v.pedidos} pedido${v.pedidos > 1 ? 's' : ''} no SAP`}
              </p>
            </div>
            {v.ignorado ? (
              <Button variant="ghost" onClick={() => ignorar.mutate({ codigo: v.codigo, ignorar: false })}>
                <Undo2 size={15} /> Voltar para a lista
              </Button>
            ) : (
              <>
                {v.parecidos.map((u) => (
                  <Button key={u.id} variant="secondary" loading={ligar.isPending} onClick={() => ligar.mutate({ codigo: v.codigo, userId: u.id })}>
                    <Link2 size={15} /> É {u.nome}
                  </Button>
                ))}
                <Button onClick={() => setCriando({ codigo: v.codigo, nome: v.nomeSugerido, username: v.usernameSugerido })}>
                  <UserCheck size={15} /> Criar conta
                </Button>
                <Button variant="ghost" onClick={() => ignorar.mutate({ codigo: v.codigo, ignorar: true })}>
                  <EyeOff size={15} /> Ignorar
                </Button>
              </>
            )}
          </div>
        ))
      )}

      <Modal open={!!criando} onClose={() => setCriando(null)} title="Criar conta do vendedor" size="sm">
        {criando && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              criar.mutate(criando)
            }}
          >
            <label className="block text-sm text-dark-300">
              Nome
              <input value={criando.nome} onChange={(e) => setCriando({ ...criando, nome: e.target.value })} className="mt-1 w-full h-10 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-3 focus:outline-none focus:border-gold-500" />
            </label>
            <label className="block text-sm text-dark-300">
              Usuário de login
              <input value={criando.username} onChange={(e) => setCriando({ ...criando, username: e.target.value })} className="mt-1 w-full h-10 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-3 focus:outline-none focus:border-gold-500" />
            </label>
            <Button type="submit" loading={criar.isPending} className="w-full">
              Criar conta
            </Button>
          </form>
        )}
      </Modal>

      <Modal open={!!senha} onClose={() => setSenha(null)} title="Conta criada" size="sm">
        <p className="text-sm text-dark-300">
          Passe ao vendedor. O usuário <strong className="text-dark-100">{senha?.username}</strong> troca a senha no primeiro login. Esta senha não aparece de novo.
        </p>
        <p className="mt-3 font-mono text-lg text-center text-gold-400 bg-dark-900 border border-dark-600 rounded-lg py-3 select-all">{senha?.senha}</p>
      </Modal>
    </div>
  )
}

function Vendedores({ onAviso }: { onAviso: (a: { ok: boolean; texto: string }) => void }) {
  const utils = trpc.useUtils()
  const { data, isLoading, error } = trpc.clientesSap.vendedores.useQuery(undefined, { retry: false })
  const [ligados, setLigados] = useState<Record<string, number>>({})
  const [soAtivos, setSoAtivos] = useState(true)
  useEffect(() => {
    if (data) setLigados(data.ligados)
  }, [data])
  const salvar = trpc.clientesSap.salvarVendedores.useMutation({
    onSuccess: () => {
      onAviso({ ok: true, texto: 'Vendedores salvos.' })
      utils.clientesSap.invalidate()
    },
    onError: (e) => onAviso({ ok: false, texto: e.message }),
  })
  const ligar = trpc.clientesSap.ligarAutomatico.useMutation({
    onSuccess: (r) => {
      onAviso({ ok: true, texto: r.autoDesde ? `Cadastro automático ligado: clientes cadastrados no SAP a partir de ${dataBr(r.autoDesde)} entram sozinhos.` : 'Cadastro automático desligado.' })
      utils.clientesSap.invalidate()
    },
    onError: (e) => onAviso({ ok: false, texto: e.message }),
  })

  const lista = useMemo(() => (data?.sap ?? []).filter((v) => !soAtivos || v.ativo || ligados[String(v.codigo)]).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [data, soAtivos, ligados])

  // Sugestão pelo nome: todas as palavras do nome do CRM aparecem no nome do
  // SAP (ex.: "Luana Silva" ↔ "LUANA SILVA - ODIN TUBOS"). Só preenche os vazios.
  const sugerir = () => {
    if (!data) return
    const novo = { ...ligados }
    let n = 0
    for (const v of data.sap) {
      if (novo[String(v.codigo)]) continue
      const palavrasSap = new Set(normalizar(v.nome))
      const candidatos = data.crm.filter((u) => {
        const p = normalizar(u.nome)
        return p.length > 0 && p.every((x) => palavrasSap.has(x))
      })
      if (candidatos.length === 1) {
        novo[String(v.codigo)] = candidatos[0].id
        n++
      }
    }
    setLigados(novo)
    onAviso({ ok: true, texto: n ? `${n} sugestão(ões) pelo nome — confira e clique em Salvar.` : 'Nenhuma sugestão nova pelo nome.' })
  }

  if (error) return <p className="text-sm text-red-300 bg-dark-800 border border-dark-600 rounded-2xl p-5">{error.message}</p>
  if (isLoading || !data) return <div className="h-40 rounded-2xl bg-dark-800 animate-pulse" />

  const mudou = JSON.stringify(ligados) !== JSON.stringify(data.ligados)
  return (
    <div className="space-y-4">
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <Power size={18} className={data.autoDesde ? 'text-green-400' : 'text-dark-500'} />
        <div className="flex-1 min-w-60">
          <p className="text-sm font-semibold text-dark-100">Cadastro automático de clientes novos do SAP: {data.autoDesde ? `ligado desde ${dataBr(data.autoDesde)}` : 'desligado'}</p>
          <p className="text-xs text-dark-400">Ligado, todo cliente cadastrado no SAP daqui pra frente entra sozinho (de 10 em 10 min) na carteira do vendedor do CRM ligado abaixo. Os cadastros antigos do SAP não entram.</p>
        </div>
        <Button variant={data.autoDesde ? 'ghost' : 'primary'} loading={ligar.isPending} onClick={() => ligar.mutate({ ligado: !data.autoDesde })}>
          {data.autoDesde ? 'Desligar' : 'Ligar agora'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={sugerir}>
          <Wand2 size={15} /> Sugerir pelo nome
        </Button>
        <Button disabled={!mudou} loading={salvar.isPending} onClick={() => salvar.mutate({ ligados })}>
          <Save size={15} /> Salvar
        </Button>
        <label className="ml-auto flex items-center gap-2 text-xs text-dark-400">
          <input type="checkbox" checked={soAtivos} onChange={(e) => setSoAtivos(e.target.checked)} /> só vendedores ativos no SAP
        </label>
      </div>
      <p className="text-xs text-dark-500">
        Deixe em branco o vendedor do SAP que não é confiável (ex.: cadastro do SAP com vendedor errado) — aí o cliente novo dele não entra sozinho e fica na lista para o gestor escolher.
      </p>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {lista.map((v) => (
          <div key={v.codigo} className="flex flex-wrap items-center gap-3 px-4 py-2">
            <div className="flex-1 min-w-48">
              <p className="text-sm text-dark-100">{v.nome}</p>
              <p className="text-xs text-dark-500">
                código {v.codigo}
                {!v.ativo ? ' · inativo no SAP' : ''}
              </p>
            </div>
            <select
              value={ligados[String(v.codigo)] ?? ''}
              onChange={(e) =>
                setLigados((s) => {
                  const n = { ...s }
                  if (e.target.value) n[String(v.codigo)] = Number(e.target.value)
                  else delete n[String(v.codigo)]
                  return n
                })
              }
              className={`${classeSelect} max-w-80`}
              aria-label={`Vendedor do CRM para ${v.nome}`}
            >
              <option value="">— não entra sozinho —</option>
              {data.crm.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome} · {u.empresa}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}
