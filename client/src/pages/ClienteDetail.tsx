import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { Input, Textarea } from '../components/ui/Input'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import ContatoButtons from '../components/ui/ContatoButtons'
import TelefonesExtras from '../components/ui/TelefonesExtras'
import EmailsExtras from '../components/ui/EmailsExtras'
import HistoricoCliente from '../components/HistoricoCliente'

function formatarDataSimples(iso: string | null): string {
  if (!iso) return '—'
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

type ItemStatus =
  | { itemId: number; nome: string; intervaloHoras: number; semLeitura: true }
  | {
      itemId: number
      nome: string
      intervaloHoras: number
      semLeitura: false
      horasNaReferencia: number
      dataReferencia: string
      diasRestantes: number | null
      dataProjetada: string | null
      vencido: boolean
    }

// Item sem leitura inicial ainda: pede a "primeira preventiva" (leitura de
// horas de verdade da peça hoje, não necessariamente 0 — a máquina pode já
// estar em uso). Com leitura registrada: mostra a projeção e o botão de
// marcar troca, igual antes.
function ItemManutencaoStatus({ maquinaId, item }: { maquinaId: number; item: ItemStatus }) {
  const utils = trpc.useUtils()
  const [registrando, setRegistrando] = useState(false)
  const [horasAtuais, setHorasAtuais] = useState('')

  function invalidar() {
    utils.maquinas.listaPorCliente.invalidate()
  }

  const registrarMut = trpc.maquinas.registrarLeituraInicial.useMutation({
    onSuccess() {
      toast.success('Primeira preventiva registrada')
      setRegistrando(false)
      setHorasAtuais('')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const trocarMut = trpc.maquinas.marcarTrocaItem.useMutation({
    onSuccess() {
      toast.success('Troca registrada — contagem reiniciada')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  if (item.semLeitura) {
    return (
      <div className="py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-dark-200">
            {item.nome} <span className="text-dark-500">— a cada {item.intervaloHoras.toLocaleString('pt-BR')}h</span>
          </span>
          {!registrando && (
            <Button size="sm" variant="secondary" onClick={() => setRegistrando(true)}>
              Registrar primeira preventiva
            </Button>
          )}
        </div>
        {registrando && (
          <div className="flex items-end gap-2 mt-2">
            <Input
              label="Horas de uso da peça hoje"
              type="number"
              min="0"
              value={horasAtuais}
              onChange={(e) => setHorasAtuais(e.target.value)}
              placeholder="Ex: 350"
              className="w-40"
            />
            <Button
              size="sm"
              loading={registrarMut.isPending}
              onClick={() =>
                registrarMut.mutate({
                  maquinaId,
                  itemId: item.itemId,
                  horasAtuais: Number(horasAtuais) || 0,
                  data: new Date().toISOString().slice(0, 10),
                })
              }
            >
              Salvar
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setRegistrando(false)}>
              Cancelar
            </Button>
          </div>
        )}
      </div>
    )
  }

  const cor = item.vencido ? 'text-red-400' : (item.diasRestantes ?? 999) <= 15 ? 'text-amber-400' : 'text-dark-300'
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="text-sm">
        <span className="text-dark-200">{item.nome}: </span>
        <span className={cor}>
          {item.diasRestantes === null
            ? 'sem estimativa de horas/dia'
            : item.vencido
              ? `venceu há ${Math.abs(item.diasRestantes)} dia(s)`
              : `em ${item.diasRestantes} dia(s)`}
          {item.dataProjetada ? ` (${formatarDataSimples(item.dataProjetada)})` : ''}
        </span>
      </div>
      <Button size="sm" variant="secondary" loading={trocarMut.isPending} onClick={() => trocarMut.mutate({ maquinaId, itemId: item.itemId })}>
        Marcar troca feita
      </Button>
    </div>
  )
}

const OUTRO_MODELO = '__outro__'

function MaquinasCliente({ clienteId }: { clienteId: number }) {
  const utils = trpc.useUtils()
  const { data: maquinas, isLoading } = trpc.maquinas.listaPorCliente.useQuery({ clienteId })
  const { data: catalogo } = trpc.maquinas.listaCatalogo.useQuery()
  const { data: itensManutencao } = trpc.maquinas.listaItensManutencao.useQuery()
  const [mostrarForm, setMostrarForm] = useState(false)
  const [modeloSelecionado, setModeloSelecionado] = useState('')
  const [modeloLivre, setModeloLivre] = useState('')
  const [quantidade, setQuantidade] = useState('1')
  const [dataInstalacao, setDataInstalacao] = useState(() => new Date().toISOString().slice(0, 10))
  const [horasUsoDia, setHorasUsoDia] = useState('8')
  const [consumidorFinalNome, setConsumidorFinalNome] = useState('')
  const [consumidorFinalTelefone, setConsumidorFinalTelefone] = useState('')

  const temCatalogo = !!catalogo?.length
  const usarModeloLivre = !temCatalogo || modeloSelecionado === OUTRO_MODELO
  const modelo = usarModeloLivre ? modeloLivre : modeloSelecionado

  const invalidar = () => utils.maquinas.listaPorCliente.invalidate({ clienteId })

  const criarMut = trpc.maquinas.criar.useMutation({
    onSuccess() {
      toast.success('Máquina cadastrada')
      invalidar()
      setMostrarForm(false)
      setModeloSelecionado('')
      setModeloLivre('')
      setQuantidade('1')
      setHorasUsoDia('8')
      setConsumidorFinalNome('')
      setConsumidorFinalTelefone('')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const removerMut = trpc.maquinas.remover.useMutation({
    onSuccess() {
      toast.success('Máquina removida')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function handleCriar(e: React.FormEvent) {
    e.preventDefault()
    if (!modelo.trim()) return toast.error('Informe o modelo do compressor')
    if (!horasUsoDia || Number(horasUsoDia) <= 0) return toast.error('Informe uma estimativa de horas de uso por dia')
    criarMut.mutate({
      clienteId,
      modelo: modelo.trim(),
      quantidade: Number(quantidade) || 1,
      dataInstalacao,
      horasUsoDia: Number(horasUsoDia),
      consumidorFinalNome: consumidorFinalNome.trim() || undefined,
      consumidorFinalTelefone: consumidorFinalTelefone.trim() || undefined,
    })
  }

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-dark-100">🔧 Máquinas vendidas</h2>
        <Button size="sm" variant="secondary" onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? 'Cancelar' : '+ Nova máquina'}
        </Button>
      </div>

      {mostrarForm && (
        <form onSubmit={handleCriar} className="space-y-3 bg-dark-900/60 border border-dark-700 rounded-xl p-3">
          {temCatalogo && (
            <Select
              label="Modelo do compressor"
              value={modeloSelecionado}
              onChange={(e) => setModeloSelecionado(e.target.value)}
              placeholder="Selecione..."
              options={[
                ...catalogo!.map((c) => ({ value: c.modelo, label: c.linha ? `${c.modelo} — ${c.linha}` : c.modelo })),
                { value: OUTRO_MODELO, label: 'Outro (digitar manualmente)' },
              ]}
            />
          )}
          {usarModeloLivre && (
            <Input
              label={temCatalogo ? 'Digite o modelo' : 'Modelo do compressor'}
              value={modeloLivre}
              onChange={(e) => setModeloLivre(e.target.value)}
              placeholder="Ex: Odin OD-20 20PCM"
            />
          )}
          <div className="grid grid-cols-3 gap-3">
            <Input label="Quantidade" type="number" min="1" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
            <Input label="Data da venda/instalação" type="date" value={dataInstalacao} onChange={(e) => setDataInstalacao(e.target.value)} />
            <Input label="Horas de uso/dia (estim.)" type="number" min="0" step="0.5" value={horasUsoDia} onChange={(e) => setHorasUsoDia(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-dark-700">
            <Input
              label="Consumidor final — nome (se essa venda foi pra uma revenda)"
              value={consumidorFinalNome}
              onChange={(e) => setConsumidorFinalNome(e.target.value)}
              placeholder="Opcional"
            />
            <Input
              label="Consumidor final — telefone"
              value={consumidorFinalTelefone}
              onChange={(e) => setConsumidorFinalTelefone(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          {!!itensManutencao?.length && (
            <p className="text-xs text-dark-500">
              Depois de cadastrar, registre a "primeira preventiva" de cada item ({itensManutencao.map((i) => i.nome).join(', ')})
              com a leitura real de horas da máquina hoje.
            </p>
          )}
          <Button type="submit" size="sm" loading={criarMut.isPending}>
            Cadastrar máquina
          </Button>
        </form>
      )}

      {isLoading && <p className="text-sm text-dark-500">Carregando...</p>}
      {!isLoading && !maquinas?.length && <p className="text-sm text-dark-500">Nenhuma máquina cadastrada ainda.</p>}

      <div className="divide-y divide-dark-700">
        {maquinas?.map((m) => (
          <div key={m.id} className="py-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-dark-100">
                  {m.modelo} {m.quantidade > 1 ? `× ${m.quantidade}` : ''}
                </p>
                <p className="text-xs text-dark-500">
                  Instalado em {formatarDataSimples(m.dataInstalacao)} · ~{m.horasUsoDia}h/dia
                </p>
                {m.consumidorFinalNome && (
                  <p className="text-xs text-dark-500">
                    Revendido pra {m.consumidorFinalNome}
                    {m.consumidorFinalTelefone ? ` · ${m.consumidorFinalTelefone}` : ''}
                  </p>
                )}
              </div>
              <button
                onClick={() => removerMut.mutate({ id: m.id })}
                className="text-xs text-dark-500 hover:text-red-400"
                disabled={removerMut.isPending}
              >
                Remover
              </button>
            </div>
            <div className="mt-2">
              {!itensManutencao?.length && (
                <p className="text-xs text-dark-500">
                  Nenhum item de manutenção configurado ainda — cadastre em Configurações.
                </p>
              )}
              {m.itensStatus.map((item) => (
                <ItemManutencaoStatus key={item.itemId} maquinaId={m.id} item={item} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Liga cadastros que são, na prática, o mesmo cliente/empresa com CNPJ
// diferente (matriz/filial, ou duplicidade de cadastro) — só informativo,
// não mistura carteira/funil/histórico dos dois. Pedido direto do João.
function ClientesVinculados({ clienteId, basePath }: { clienteId: number; basePath: string }) {
  const utils = trpc.useUtils()
  const { data: vinculados, isLoading } = trpc.vinculos.listar.useQuery({ clienteId })
  const [buscaAberta, setBuscaAberta] = useState(false)
  const [busca, setBusca] = useState('')
  const buscaValida = busca.trim().length >= 2
  const { data: resultados } = trpc.clientes.list.useQuery({ q: busca, pagina: 1 }, { enabled: buscaValida })

  function invalidar() {
    utils.vinculos.listar.invalidate({ clienteId })
  }

  const vincularMut = trpc.vinculos.vincular.useMutation({
    onSuccess() {
      toast.success('Clientes vinculados')
      setBusca('')
      setBuscaAberta(false)
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const desvincularMut = trpc.vinculos.desvincular.useMutation({
    onSuccess() {
      toast.success('Vínculo removido')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const idsJaVinculados = new Set(vinculados?.map((v) => v.id) ?? [])

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-dark-100">🔗 Clientes vinculados</h2>
        <button onClick={() => setBuscaAberta((v) => !v)} className="text-xs text-gold-400 hover:underline">
          {buscaAberta ? 'Cancelar' : '+ Vincular a outro cliente'}
        </button>
      </div>
      <p className="text-xs text-dark-500">
        Pra ligar cadastros que são o mesmo cliente/empresa com CNPJ diferente (matriz e filial, por exemplo).
      </p>

      {buscaAberta && (
        <div className="space-y-2">
          <Input placeholder="Buscar por nome, código ou CNPJ..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          {buscaValida && (
            <div className="max-h-48 overflow-y-auto border border-dark-700 rounded-lg divide-y divide-dark-700">
              {resultados?.items
                .filter((c) => c.id !== clienteId && !idsJaVinculados.has(c.id))
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => vincularMut.mutate({ clienteId, clienteVinculadoId: c.id })}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-700/40"
                  >
                    <p className="text-dark-100">{c.razaoSocial}</p>
                    <p className="text-xs text-dark-500">
                      Cód. {c.codigo}
                      {c.cnpj ? ` · ${c.cnpj}` : ''}
                    </p>
                  </button>
                ))}
              {resultados && resultados.items.length === 0 && (
                <p className="px-3 py-2 text-xs text-dark-500">Nenhum cliente encontrado.</p>
              )}
            </div>
          )}
        </div>
      )}

      {isLoading && <p className="text-xs text-dark-500">Carregando...</p>}
      {!isLoading && !vinculados?.length && <p className="text-xs text-dark-500">Nenhum cliente vinculado ainda.</p>}
      {vinculados?.map((v) => (
        <div key={v.vinculoId} className="flex items-center justify-between text-sm bg-dark-900/40 rounded-lg px-3 py-2">
          <Link to={`${basePath}/clientes/${v.id}`} className="text-dark-100 hover:text-gold-400">
            {v.razaoSocial} <span className="text-xs text-dark-500">— Cód. {v.codigo}{v.cnpj ? ` · ${v.cnpj}` : ''}</span>
          </Link>
          <button onClick={() => desvincularMut.mutate({ vinculoId: v.vinculoId })} className="text-red-400 hover:text-red-300 text-xs">
            Desvincular
          </button>
        </div>
      ))}
    </div>
  )
}

export default function ClienteDetail() {
  const { id } = useParams()
  const { user, empresaAtivaId } = useAuth()
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'
  // Pós-venda por horas de filtro (ar/óleo) só faz sentido pro modelo de
  // negócio da Odin Compressores — mesma regra do link no Sidebar.
  const { data: empresas } = trpc.empresas.list.useQuery()
  const empresaAtiva = empresas?.find((e) => e.id === empresaAtivaId)
  const ehOdinCompressores = empresaAtiva?.slug === 'odin-compressores'

  const { data: cliente, isLoading } = trpc.clientes.get.useQuery({ id: Number(id) })
  const [confirmando, setConfirmando] = useState(false)
  const [motivoExclusao, setMotivoExclusao] = useState('')
  const [comprovanteExclusao, setComprovanteExclusao] = useState<File | null>(null)
  const [enviandoExclusao, setEnviandoExclusao] = useState(false)

  const [razaoSocial, setRazaoSocial] = useState('')
  const [codigo, setCodigo] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [telefoneWhatsapp, setTelefoneWhatsapp] = useState('')
  const [email, setEmail] = useState('')
  const [nomeContato, setNomeContato] = useState('')
  const [statusFiscal, setStatusFiscal] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [ticketMedio, setTicketMedio] = useState('')
  const [carregado, setCarregado] = useState(false)

  if (cliente && !carregado) {
    setRazaoSocial(cliente.razaoSocial)
    setCodigo(cliente.codigo ?? '')
    setCnpj(cliente.cnpj ?? '')
    setTelefoneWhatsapp(cliente.telefoneWhatsapp ?? '')
    setEmail(cliente.email ?? '')
    setNomeContato(cliente.nomeContato ?? '')
    setStatusFiscal(cliente.statusFiscal ?? '')
    setObservacoes(cliente.observacoes ?? '')
    setTicketMedio(cliente.ticketMedioHistorico?.toString() ?? '')
    setCarregado(true)
  }

  const updateMut = trpc.clientes.update.useMutation({
    onSuccess() {
      toast.success('Cliente atualizado')
      utils.clientes.get.invalidate({ id: Number(id) })
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const softDeleteMut = trpc.clientes.softDelete.useMutation({
    onSuccess() {
      toast.success('Cliente movido para a lixeira')
      navigate(`${basePath}/lixeira`)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  async function handleExcluir() {
    if (!cliente) return
    if (!motivoExclusao.trim()) return toast.error('Informe o motivo da exclusão.')
    if (!comprovanteExclusao) return toast.error('Anexe um print/imagem comprovando o motivo.')

    setEnviandoExclusao(true)
    try {
      const token = localStorage.getItem('odin_token')
      const form = new FormData()
      form.append('file', comprovanteExclusao)
      const res = await fetch('/upload/comprovante-exclusao', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) {
        const erro = await res.json().catch(() => null)
        toast.error(erro?.error ?? 'Falha ao enviar o comprovante.')
        return
      }
      const data = await res.json()
      softDeleteMut.mutate({ id: cliente.id, motivo: motivoExclusao.trim(), comprovantePath: data.path })
    } finally {
      setEnviandoExclusao(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!cliente) return
    updateMut.mutate({
      id: cliente.id,
      versao: cliente.versao,
      razaoSocial,
      codigo,
      cnpj,
      telefoneWhatsapp,
      email,
      nomeContato,
      statusFiscal: (statusFiscal || undefined) as 'isento' | 'normal' | 'consumidor_final' | undefined,
      observacoes: observacoes || undefined,
      ticketMedioHistorico: ticketMedio ? Number(ticketMedio.replace(',', '.')) : undefined,
    })
  }

  if (isLoading) return <div className="p-6 text-dark-400">Carregando...</div>
  if (!cliente) return <div className="p-6 text-dark-400">Cliente não encontrado.</div>

  return (
    <div className="p-6 max-w-xl space-y-4">
      <div>
        <h1 className="font-heading text-xl text-dark-50">{cliente.razaoSocial}</h1>
        <p className="text-sm text-dark-400">
          {cliente.qtdContatos} registro(s) de contato · {cliente.qtdPedidos} pedido(s)
        </p>
        <div className="mt-2">
          <ContatoButtons
            telefone={cliente.telefoneWhatsapp}
            telefonesExtras={cliente.telefonesExtras}
            email={cliente.email}
            emailsExtras={cliente.emailsExtras}
            clienteId={cliente.id}
            size="md"
          />
        </div>
      </div>

      {ehOdinCompressores && <MaquinasCliente clienteId={cliente.id} />}

      <form onSubmit={handleSubmit} className="space-y-4 bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <Input label="Razão social" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} />
        <Input label="Código (SAP)" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        <Input label="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="WhatsApp" value={telefoneWhatsapp} onChange={(e) => setTelefoneWhatsapp(e.target.value)} />
          <Input label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Input label="Nome do contato" value={nomeContato} onChange={(e) => setNomeContato(e.target.value)} />
        <Select
          label="Status fiscal"
          value={statusFiscal}
          onChange={(e) => setStatusFiscal(e.target.value)}
          placeholder="Selecione..."
          options={[
            { value: 'isento', label: 'Isento' },
            { value: 'normal', label: 'Normal' },
            { value: 'consumidor_final', label: 'Consumidor Final' },
          ]}
        />
        <Textarea
          label="Anotações sobre o cliente"
          rows={3}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Contexto livre — indicação, preferências, histórico relevante..."
        />
        <TelefonesExtras
          clienteId={cliente.id}
          telefones={cliente.telefonesExtras}
          onChanged={() => utils.clientes.get.invalidate({ id: Number(id) })}
        />
        <EmailsExtras
          clienteId={cliente.id}
          emails={cliente.emailsExtras}
          onChanged={() => utils.clientes.get.invalidate({ id: Number(id) })}
        />
        <Input label="Ticket médio histórico (R$)" type="number" step="0.01" value={ticketMedio} onChange={(e) => setTicketMedio(e.target.value)} />
        {user?.role === 'admin' && (
          <p className="text-xs text-dark-500">
            Trocar o vendedor responsável se faz em{' '}
            <Link to="/admin/carteira" className="underline">
              Atribuição de carteira
            </Link>
            .
          </p>
        )}
        <Button type="submit" loading={updateMut.isPending}>
          Salvar alterações
        </Button>
      </form>

      <ClientesVinculados clienteId={cliente.id} basePath={basePath} />

      <HistoricoCliente clienteId={cliente.id} />

      {user?.role === 'admin' && (
        <div className="bg-dark-800 border border-red-900/40 rounded-2xl p-5">
          {!confirmando ? (
            <Button variant="danger" onClick={() => setConfirmando(true)}>
              Excluir cliente
            </Button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-dark-200">
                Este cliente tem <strong>{cliente.qtdContatos}</strong> registro(s) de contato e{' '}
                <strong>{cliente.qtdPedidos}</strong> pedido(s). Nada disso é apagado — o cliente vai para a lixeira e
                pode ser restaurado depois. Motivo e comprovante (print/imagem) são obrigatórios.
              </p>
              <div>
                <label className="text-xs text-dark-400 mb-1 block">Motivo da exclusão *</label>
                <textarea
                  value={motivoExclusao}
                  onChange={(e) => setMotivoExclusao(e.target.value)}
                  rows={2}
                  className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100"
                  placeholder="Ex: cliente duplicado, pediu remoção, etc."
                />
              </div>
              <div>
                <label className="text-xs text-dark-400 mb-1 block">Comprovante (print/imagem) *</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setComprovanteExclusao(e.target.files?.[0] ?? null)}
                  className="text-sm text-dark-300"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="danger" loading={softDeleteMut.isPending || enviandoExclusao} onClick={handleExcluir}>
                  Sim, excluir
                </Button>
                <Button variant="secondary" onClick={() => setConfirmando(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
