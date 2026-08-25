import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import { Input, Textarea } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { buildClientContactWaLink, buildClientFeedbackWaLink, buildVendorNotificationWaLink } from '../lib/devolucaoWhatsapp'

const STATUS_LABEL: Record<string, string> = {
  novo: 'Novo',
  em_andamento: 'Em andamento',
  analise: 'Análise',
  nota_fiscal_devolucao: 'Nota fiscal devolução',
  chegada_materiais: 'Chegada materiais',
  preparacao_envio: 'Preparação e envio',
  rastreio_transportadora: 'Rastreio transportadora',
  finalizado: 'Finalizado',
}

// Todas as empresas veem as 8 colunas — "preparação e envio"/"rastreio
// transportadora" nasceram do fluxo da Odin Compressores, mas qualquer
// chamado pode passar por elas (não é uma restrição de negócio real).
const STATUS_COLUNAS = [
  'novo',
  'em_andamento',
  'analise',
  'nota_fiscal_devolucao',
  'chegada_materiais',
  'preparacao_envio',
  'rastreio_transportadora',
  'finalizado',
]

const OCORRENCIA_LABEL: Record<string, string> = {
  envio_errado: 'Envio errado',
  falta_materiais: 'Falta de materiais',
  produto_defeito: 'Produto com defeito',
  outro: 'Outro',
}

function formatarData(v: string | null | undefined): string {
  if (!v) return '—'
  return new Date(v.replace(' ', 'T')).toLocaleString('pt-BR')
}

async function uploadAnexo(file: File): Promise<{ path: string; nome: string; tipo: string }> {
  const token = localStorage.getItem('odin_token')
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/upload/devolucao-anexo', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Falha ao enviar o arquivo')
  return { path: data.path, nome: data.nome, tipo: data.tipo }
}

function NovoChamadoModal({ onClose, souAdmin }: { onClose: () => void; souAdmin: boolean }) {
  const utils = trpc.useUtils()
  const [clienteNome, setClienteNome] = useState('')
  const [clienteCnpj, setClienteCnpj] = useState('')
  const [clienteWhatsapp, setClienteWhatsapp] = useState('')
  const [clienteEmail, setClienteEmail] = useState('')
  const [clienteCodigo, setClienteCodigo] = useState('')
  const [numeroNotaFiscal, setNumeroNotaFiscal] = useState('')
  const [numeroNotaFiscalVenda, setNumeroNotaFiscalVenda] = useState('')
  const [numeroPedidoVenda, setNumeroPedidoVenda] = useState('')
  const [descricao, setDescricao] = useState('')
  const [observacao, setObservacao] = useState('')
  const [vendedorId, setVendedorId] = useState('')
  const [ocorrencias, setOcorrencias] = useState<string[]>([])
  const [materiais, setMateriais] = useState([{ codigoItem: '', descricaoItem: '', quantidade: 1 }])

  const { data: vendedoresDisponiveis } = trpc.users.vendors.useQuery(undefined, { enabled: souAdmin })

  const criarMut = trpc.devolucoes.criar.useMutation({
    onSuccess(data) {
      toast.success(`Chamado ${data.protocolo} aberto`)
      utils.devolucoes.listar.invalidate()
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function toggleOcorrencia(tipo: string) {
    setOcorrencias((prev) => (prev.includes(tipo) ? prev.filter((t) => t !== tipo) : [...prev, tipo]))
  }

  function atualizarMaterial(i: number, campo: string, valor: string | number) {
    setMateriais((prev) => prev.map((m, idx) => (idx === i ? { ...m, [campo]: valor } : m)))
  }

  function enviar() {
    if (!clienteNome.trim()) return toast.error('Informe o nome do cliente')
    if (!descricao.trim()) return toast.error('Descreva o que aconteceu')
    if (!ocorrencias.length) return toast.error('Marque ao menos um tipo de ocorrência')
    criarMut.mutate({
      clienteNome,
      clienteCnpj: clienteCnpj || undefined,
      clienteWhatsapp: clienteWhatsapp || undefined,
      clienteEmail: clienteEmail || undefined,
      clienteCodigo: clienteCodigo || undefined,
      numeroNotaFiscal: numeroNotaFiscal || undefined,
      numeroNotaFiscalVenda: numeroNotaFiscalVenda || undefined,
      numeroPedidoVenda: numeroPedidoVenda || undefined,
      descricao,
      observacao: observacao || undefined,
      vendedorId: souAdmin && vendedorId ? Number(vendedorId) : undefined,
      ocorrencias: ocorrencias.map((tipo) => ({ tipo: tipo as any })),
      materiais: materiais.filter((m) => m.descricaoItem.trim()),
    })
  }

  return (
    <Modal open onClose={onClose} title="Abrir chamado de devolução" size="lg">
      <div className="space-y-4">
        <Input label="Nome do cliente" value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} required />
        <div className="grid grid-cols-2 gap-4">
          <Input label="CNPJ (se tiver)" value={clienteCnpj} onChange={(e) => setClienteCnpj(e.target.value)} />
          <Input label="Código do cliente" value={clienteCodigo} onChange={(e) => setClienteCodigo(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="WhatsApp" value={clienteWhatsapp} onChange={(e) => setClienteWhatsapp(e.target.value)} />
          <Input label="E-mail" value={clienteEmail} onChange={(e) => setClienteEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Input label="Nota fiscal (devolução)" value={numeroNotaFiscal} onChange={(e) => setNumeroNotaFiscal(e.target.value)} />
          <Input label="Nota fiscal de venda" value={numeroNotaFiscalVenda} onChange={(e) => setNumeroNotaFiscalVenda(e.target.value)} />
          <Input label="Pedido de venda" value={numeroPedidoVenda} onChange={(e) => setNumeroPedidoVenda(e.target.value)} />
        </div>
        {souAdmin && (
          <Select
            label="Vendedor responsável"
            value={vendedorId}
            onChange={(e) => setVendedorId(e.target.value)}
            placeholder="Sem vendedor definido"
            options={(vendedoresDisponiveis ?? []).map((v: any) => ({ value: String(v.id), label: v.name }))}
          />
        )}
        <div>
          <p className="text-sm text-dark-200 font-medium mb-1.5">Tipo de ocorrência</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(OCORRENCIA_LABEL).map(([valor, label]) => (
              <button
                key={valor}
                type="button"
                onClick={() => toggleOcorrencia(valor)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  ocorrencias.includes(valor)
                    ? 'border-gold-400 bg-gold-900/20 text-gold-300'
                    : 'border-dark-600 text-dark-300 hover:bg-dark-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Textarea label="O que aconteceu" rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)} required />
        <Textarea label="Observação (opcional)" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />

        <div>
          <p className="text-sm text-dark-200 font-medium mb-2">Materiais (opcional)</p>
          <div className="space-y-2">
            {materiais.map((m, i) => (
              <div key={i} className="grid grid-cols-[100px_1fr_70px] gap-2">
                <Input placeholder="Código" value={m.codigoItem} onChange={(e) => atualizarMaterial(i, 'codigoItem', e.target.value)} />
                <Input placeholder="Descrição" value={m.descricaoItem} onChange={(e) => atualizarMaterial(i, 'descricaoItem', e.target.value)} />
                <Input type="number" min={1} value={m.quantidade} onChange={(e) => atualizarMaterial(i, 'quantidade', Number(e.target.value))} />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="text-xs text-gold-400 underline mt-2"
            onClick={() => setMateriais((prev) => [...prev, { codigoItem: '', descricaoItem: '', quantidade: 1 }])}
          >
            + Adicionar material
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={criarMut.isPending} onClick={enviar}>
            Abrir chamado
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function AnaliseForm({ chamadoId, onSalvo }: { chamadoId: number; onSalvo: () => void }) {
  const [resultado, setResultado] = useState<'positivo' | 'negativo'>('positivo')
  const [motivoNegativa, setMotivoNegativa] = useState('')
  const [quemErrou, setQuemErrou] = useState('')
  const [tipoResolucao, setTipoResolucao] = useState('')
  const [impactaComissao, setImpactaComissao] = useState(false)
  const [valorImpactoComissao, setValorImpactoComissao] = useState('')

  const mut = trpc.devolucoes.registrarAnalise.useMutation({
    onSuccess() {
      toast.success('Análise registrada')
      onSalvo()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function enviar() {
    if (resultado === 'negativo' && !motivoNegativa.trim()) return toast.error('Motivo da negativa é obrigatório')
    if (impactaComissao && !valorImpactoComissao) return toast.error('Informe o valor do impacto na comissão')
    mut.mutate({
      chamadoId,
      resultado,
      motivoNegativa: motivoNegativa || undefined,
      quemErrou: (quemErrou || undefined) as any,
      tipoResolucao: (tipoResolucao || undefined) as any,
      impactaComissao,
      valorImpactoComissao: valorImpactoComissao ? Number(valorImpactoComissao) : undefined,
    })
  }

  return (
    <div className="bg-dark-900/40 border border-dark-700 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-semibold text-dark-100">Registrar análise</p>
      <Select
        label="Resultado"
        value={resultado}
        onChange={(e) => setResultado(e.target.value as any)}
        options={[
          { value: 'positivo', label: 'Positivo' },
          { value: 'negativo', label: 'Negativo' },
        ]}
      />
      {resultado === 'negativo' && (
        <Textarea label="Motivo da negativa" rows={2} value={motivoNegativa} onChange={(e) => setMotivoNegativa(e.target.value)} />
      )}
      <Select
        label="Quem errou"
        value={quemErrou}
        onChange={(e) => setQuemErrou(e.target.value)}
        placeholder="Não informado"
        options={[
          { value: 'cliente', label: 'Cliente' },
          { value: 'estoque', label: 'Estoque' },
          { value: 'transportadora', label: 'Transportadora' },
          { value: 'vendedor', label: 'Vendedor' },
          { value: 'defeito', label: 'Defeito de fábrica' },
        ]}
      />
      <Select
        label="Tipo de resolução"
        value={tipoResolucao}
        onChange={(e) => setTipoResolucao(e.target.value)}
        placeholder="Não informado"
        options={[
          { value: 'saldo_credito', label: 'Saldo em crédito' },
          { value: 'troca_produto', label: 'Troca de produto' },
          { value: 'abatimento_boleto', label: 'Abatimento no boleto' },
          { value: 'dinheiro_volta', label: 'Dinheiro de volta' },
          { value: 'envio_materiais', label: 'Envio de materiais' },
        ]}
      />
      <label className="flex items-center gap-2 text-sm text-dark-200">
        <input type="checkbox" checked={impactaComissao} onChange={(e) => setImpactaComissao(e.target.checked)} />
        Impacta a comissão do vendedor
      </label>
      {impactaComissao && (
        <Input
          label="Valor do impacto (R$)"
          type="number"
          step="0.01"
          value={valorImpactoComissao}
          onChange={(e) => setValorImpactoComissao(e.target.value)}
        />
      )}
      <Button size="sm" loading={mut.isPending} onClick={enviar}>
        Salvar análise
      </Button>
    </div>
  )
}

function ServicosForm({ chamadoId, onSalvo }: { chamadoId: number; onSalvo: () => void }) {
  const [teveServico, setTeveServico] = useState(false)
  const [valorCobrado, setValorCobrado] = useState('')
  const [horasTrabalhadas, setHorasTrabalhadas] = useState('')
  const [executadoPor, setExecutadoPor] = useState('')
  const [statusPagamento, setStatusPagamento] = useState('')
  const [valorFinal, setValorFinal] = useState('')

  const mut = trpc.devolucoes.registrarServico.useMutation({
    onSuccess() {
      toast.success('Serviço registrado')
      onSalvo()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function enviar() {
    mut.mutate({
      chamadoId,
      teveServico,
      valorCobrado: valorCobrado ? Number(valorCobrado) : undefined,
      horasTrabalhadas: horasTrabalhadas ? Number(horasTrabalhadas) : undefined,
      executadoPor: executadoPor || undefined,
      statusPagamento: (statusPagamento || undefined) as any,
      valorFinal: valorFinal ? Number(valorFinal) : undefined,
    })
  }

  return (
    <div className="bg-dark-900/40 border border-dark-700 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-semibold text-dark-100">Registrar serviço</p>
      <label className="flex items-center gap-2 text-sm text-dark-200">
        <input type="checkbox" checked={teveServico} onChange={(e) => setTeveServico(e.target.checked)} />
        Teve serviço/mão de obra envolvida
      </label>
      {teveServico && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Valor cobrado (R$)" type="number" step="0.01" value={valorCobrado} onChange={(e) => setValorCobrado(e.target.value)} />
            <Input label="Horas trabalhadas" type="number" step="0.5" value={horasTrabalhadas} onChange={(e) => setHorasTrabalhadas(e.target.value)} />
          </div>
          <Input label="Executado por" value={executadoPor} onChange={(e) => setExecutadoPor(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Status do pagamento"
              value={statusPagamento}
              onChange={(e) => setStatusPagamento(e.target.value)}
              placeholder="Não informado"
              options={[
                { value: 'credito', label: 'Em crédito' },
                { value: 'pago', label: 'Pago' },
              ]}
            />
            <Input label="Valor final (R$)" type="number" step="0.01" value={valorFinal} onChange={(e) => setValorFinal(e.target.value)} />
          </div>
        </>
      )}
      <Button size="sm" loading={mut.isPending} onClick={enviar}>
        Salvar serviço
      </Button>
    </div>
  )
}

function formatarMoeda(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function LogisticaForm({
  chamadoId,
  atual,
  onSalvo,
}: {
  chamadoId: number
  atual: {
    transportadoraNome: string | null
    dataChegadaPrevista: string | null
    freteChegadaValor: number | null
    dataSaidaPrevista: string | null
    freteEnvioValor: number | null
  }
  onSalvo: () => void
}) {
  const [transportadoraNome, setTransportadoraNome] = useState(atual.transportadoraNome ?? '')
  const [dataChegadaPrevista, setDataChegadaPrevista] = useState(atual.dataChegadaPrevista?.slice(0, 10) ?? '')
  const [freteChegadaValor, setFreteChegadaValor] = useState(atual.freteChegadaValor != null ? String(atual.freteChegadaValor) : '')
  const [dataSaidaPrevista, setDataSaidaPrevista] = useState(atual.dataSaidaPrevista?.slice(0, 10) ?? '')
  const [freteEnvioValor, setFreteEnvioValor] = useState(atual.freteEnvioValor != null ? String(atual.freteEnvioValor) : '')

  const mut = trpc.devolucoes.atualizarLogistica.useMutation({
    onSuccess() {
      toast.success('Logística salva')
      onSalvo()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function enviar() {
    mut.mutate({
      id: chamadoId,
      transportadoraNome: transportadoraNome || undefined,
      dataChegadaPrevista: dataChegadaPrevista || undefined,
      freteChegadaValor: freteChegadaValor ? Number(freteChegadaValor) : undefined,
      dataSaidaPrevista: dataSaidaPrevista || undefined,
      freteEnvioValor: freteEnvioValor ? Number(freteEnvioValor) : undefined,
    })
  }

  return (
    <div className="bg-dark-900/40 border border-dark-700 rounded-2xl p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-dark-100 mb-2">Chegada dos materiais</p>
        <div className="grid grid-cols-3 gap-3">
          <Input label="Transportadora" value={transportadoraNome} onChange={(e) => setTransportadoraNome(e.target.value)} />
          <Input label="Previsão de chegada" type="date" value={dataChegadaPrevista} onChange={(e) => setDataChegadaPrevista(e.target.value)} />
          <Input label="Frete de chegada (R$)" type="number" step="0.01" value={freteChegadaValor} onChange={(e) => setFreteChegadaValor(e.target.value)} />
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-dark-100 mb-2">Preparação e envio</p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Previsão de saída" type="date" value={dataSaidaPrevista} onChange={(e) => setDataSaidaPrevista(e.target.value)} />
          <Input label="Frete de envio (R$)" type="number" step="0.01" value={freteEnvioValor} onChange={(e) => setFreteEnvioValor(e.target.value)} />
        </div>
      </div>
      <Button size="sm" loading={mut.isPending} onClick={enviar}>
        Salvar logística
      </Button>
    </div>
  )
}

function DetalheChamadoModal({
  id,
  souAdmin,
  possoExcluir,
  onClose,
  onExcluido,
}: {
  id: number
  souAdmin: boolean
  possoExcluir: boolean
  onClose: () => void
  onExcluido: () => void
}) {
  const utils = trpc.useUtils()
  const { data: chamado, isLoading } = trpc.devolucoes.detalhe.useQuery({ id })
  const [mensagem, setMensagem] = useState('')
  const [enviandoArquivo, setEnviandoArquivo] = useState(false)
  const [mostrarAnalise, setMostrarAnalise] = useState(false)
  const [mostrarServicos, setMostrarServicos] = useState(false)
  const [mostrarLogistica, setMostrarLogistica] = useState(false)

  function invalidar() {
    utils.devolucoes.detalhe.invalidate({ id })
    utils.devolucoes.listar.invalidate()
  }

  const statusMut = trpc.devolucoes.atualizarStatus.useMutation({
    onSuccess() {
      toast.success('Status atualizado')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const comentarMut = trpc.devolucoes.adicionarAtualizacao.useMutation({
    onSuccess() {
      setMensagem('')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const anexarMut = trpc.devolucoes.anexarArquivo.useMutation({
    onSuccess() {
      toast.success('Arquivo anexado')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const enviarMecanicaMut = trpc.devolucoes.enviarParaMecanica.useMutation({
    onSuccess() {
      toast.success('Enviado pra Mecânica')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  // Vendedores da empresa DO CHAMADO, não da empresa ativa na sessão — quem
  // tem visão global (Amanda) pode estar com outra empresa selecionada no
  // topo e abrir um chamado de empresa diferente.
  const { data: vendedoresDisponiveis } = trpc.devolucoes.vendedoresDaEmpresa.useQuery(
    { empresaId: chamado?.empresaId ?? 0 },
    { enabled: souAdmin && !!chamado }
  )
  const atribuirVendedorMut = trpc.devolucoes.atribuirVendedor.useMutation({
    onSuccess() {
      toast.success('Vendedor atribuído')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const excluirMut = trpc.devolucoes.excluir.useMutation({
    onSuccess() {
      toast.success('Chamado excluído')
      onExcluido()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setEnviandoArquivo(true)
    try {
      const up = await uploadAnexo(file)
      anexarMut.mutate({ chamadoId: id, contexto: 'abertura', urlArquivo: up.path, nomeArquivo: up.nome, tipoArquivo: up.tipo })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setEnviandoArquivo(false)
      e.target.value = ''
    }
  }

  if (isLoading || !chamado) {
    return (
      <Modal open onClose={onClose} title="Chamado" size="lg">
        <p className="text-dark-400 text-sm">Carregando...</p>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title={`${chamado.protocolo} — ${chamado.clienteNome}`} size="xl">
      <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-gold-900/20 text-gold-400 border-gold-700/40">{STATUS_LABEL[chamado.status]}</Badge>
            {(chamado as any).ocorrencias?.map((o: any) => (
              <Badge key={o.id} className="bg-dark-800 text-dark-300 border-dark-600">
                {OCORRENCIA_LABEL[o.tipo]}
                {o.rotuloCustom ? `: ${o.rotuloCustom}` : ''}
              </Badge>
            ))}
          </div>
          {possoExcluir && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Excluir o chamado ${chamado.protocolo}? Essa ação não pode ser desfeita.`)) {
                  excluirMut.mutate({ id: chamado.id })
                }
              }}
              disabled={excluirMut.isPending}
              className="text-xs px-3 py-1.5 rounded-full border border-red-700/40 bg-red-900/20 text-red-400 hover:bg-red-900/30 disabled:opacity-50"
            >
              🗑 Excluir chamado
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-dark-500 text-xs uppercase tracking-wide">Cliente</p>
            <p className="text-dark-100">{chamado.clienteNome}</p>
          </div>
          <div>
            <p className="text-dark-500 text-xs uppercase tracking-wide">CNPJ</p>
            <p className="text-dark-100">{chamado.clienteCnpj ?? '—'}</p>
          </div>
          <div>
            <p className="text-dark-500 text-xs uppercase tracking-wide">Nota fiscal</p>
            <p className="text-dark-100">{chamado.numeroNotaFiscal ?? '—'}</p>
          </div>
          <div>
            <p className="text-dark-500 text-xs uppercase tracking-wide">Vendedor</p>
            {souAdmin ? (
              <Select
                value={String((chamado as any).vendedorId ?? '')}
                onChange={(e) => atribuirVendedorMut.mutate({ id: chamado.id, vendedorId: e.target.value ? Number(e.target.value) : null })}
                placeholder="Sem vendedor"
                options={(vendedoresDisponiveis ?? []).map((v: any) => ({ value: String(v.id), label: v.name }))}
                className="mt-0.5"
              />
            ) : (
              <p className="text-dark-100">{(chamado as any).vendedor?.name ?? '—'}</p>
            )}
          </div>
          <div>
            <p className="text-dark-500 text-xs uppercase tracking-wide">Empresa</p>
            <p className="text-dark-100">{(chamado as any).empresa?.nome ?? '—'}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(chamado as any).vendedor?.whatsapp && (
            <a
              href={buildVendorNotificationWaLink((chamado as any).vendedor.whatsapp, chamado.protocolo, chamado.status, chamado.clienteNome ?? '')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-full border border-green-700/40 bg-green-900/20 text-green-400 hover:bg-green-900/30"
            >
              📲 Notificar vendedor
            </a>
          )}
          {chamado.clienteWhatsapp && (
            <a
              href={buildClientContactWaLink(chamado.clienteWhatsapp, chamado.clienteNome ?? '', chamado.protocolo)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-full border border-dark-600 text-dark-300 hover:bg-dark-800"
            >
              📲 Falar com cliente
            </a>
          )}
          {chamado.clienteWhatsapp && chamado.status === 'finalizado' && (
            <a
              href={buildClientFeedbackWaLink(chamado.clienteWhatsapp, chamado.clienteNome ?? '', chamado.protocolo)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-full border border-gold-700/40 bg-gold-900/20 text-gold-400 hover:bg-gold-900/30"
            >
              📲 Pedir feedback
            </a>
          )}
        </div>

        <div>
          <p className="text-dark-500 text-xs uppercase tracking-wide mb-1">Descrição</p>
          <p className="text-dark-200 text-sm whitespace-pre-wrap">{chamado.descricao}</p>
        </div>

        {!!(chamado as any).materiais?.length && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-dark-500 text-xs uppercase tracking-wide">Materiais</p>
              {souAdmin && (
                <button
                  className="text-xs text-gold-400 underline disabled:opacity-40"
                  disabled={enviarMecanicaMut.isPending}
                  onClick={() =>
                    enviarMecanicaMut.mutate({
                      chamadoId: id,
                      itens: (chamado as any).materiais.map((m: any) => ({
                        codigoItem: m.codigoItem,
                        descricaoItem: m.descricaoItem,
                        quantidade: m.quantidade,
                      })),
                    })
                  }
                >
                  Enviar pra mecânica
                </button>
              )}
            </div>
            <div className="text-sm text-dark-200 space-y-0.5">
              {(chamado as any).materiais.map((m: any) => (
                <p key={m.id}>
                  {m.codigoItem ? `${m.codigoItem} — ` : ''}
                  {m.descricaoItem} × {m.quantidade}
                </p>
              ))}
            </div>
          </div>
        )}

        {souAdmin && (
          <div className="bg-dark-900/40 border border-dark-700 rounded-2xl p-3">
            <p className="text-xs font-bold text-gold-400 uppercase tracking-wide mb-2">Mudar status</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(STATUS_LABEL).map(([valor, label]) => (
                <button
                  key={valor}
                  type="button"
                  disabled={statusMut.isPending}
                  onClick={() => statusMut.mutate({ id, status: valor as any })}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                    chamado.status === valor
                      ? 'border-gold-400 bg-gold-900/20 text-gold-300 font-medium'
                      : 'border-dark-600 text-dark-300 hover:bg-dark-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {souAdmin && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-gold-400 uppercase tracking-wide">Chegada dos materiais / Preparação e envio</p>
              <button className="text-xs text-gold-400 underline" onClick={() => setMostrarLogistica((v) => !v)}>
                {mostrarLogistica ? 'Fechar' : 'Editar'}
              </button>
            </div>
            {!mostrarLogistica && (
              <div className="text-sm text-dark-200 space-y-1 bg-dark-900/40 border border-dark-700 rounded-2xl p-3">
                <p>Transportadora: {(chamado as any).transportadoraNome ?? '—'}</p>
                <p>Previsão de chegada: {formatarData((chamado as any).dataChegadaPrevista)}</p>
                <p>Frete de chegada: {formatarMoeda((chamado as any).freteChegadaValor)}</p>
                <p>Previsão de saída: {formatarData((chamado as any).dataSaidaPrevista)}</p>
                <p>Frete de envio: {formatarMoeda((chamado as any).freteEnvioValor)}</p>
              </div>
            )}
            {mostrarLogistica && (
              <LogisticaForm
                chamadoId={id}
                atual={{
                  transportadoraNome: (chamado as any).transportadoraNome ?? null,
                  dataChegadaPrevista: (chamado as any).dataChegadaPrevista ?? null,
                  freteChegadaValor: (chamado as any).freteChegadaValor ?? null,
                  dataSaidaPrevista: (chamado as any).dataSaidaPrevista ?? null,
                  freteEnvioValor: (chamado as any).freteEnvioValor ?? null,
                }}
                onSalvo={() => { setMostrarLogistica(false); invalidar() }}
              />
            )}
          </div>
        )}

        <div>
          <p className="text-xs font-bold text-gold-400 uppercase tracking-wide mb-2">Histórico</p>
          <div className="space-y-1">
            {(chamado as any).historicoStatus?.map((h: any) => (
              <p key={h.id} className="text-xs text-dark-400">
                {formatarData(h.alteradoEm)} — {STATUS_LABEL[h.statusNovo] ?? h.statusNovo}
                {h.nota ? ` (${h.nota})` : ''}
              </p>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-gold-400 uppercase tracking-wide">Análise</p>
            {souAdmin && (
              <button className="text-xs text-gold-400 underline" onClick={() => setMostrarAnalise((v) => !v)}>
                {(chamado as any).analise ? 'Editar' : 'Registrar'}
              </button>
            )}
          </div>
          {(chamado as any).analise && !mostrarAnalise && (
            <div className="text-sm text-dark-200 space-y-1 bg-dark-900/40 border border-dark-700 rounded-2xl p-3">
              <p>Resultado: <span className="font-medium">{(chamado as any).analise.resultado}</span></p>
              {'quemErrou' in (chamado as any).analise && (chamado as any).analise.quemErrou && (
                <p>Quem errou: {(chamado as any).analise.quemErrou}</p>
              )}
              {(chamado as any).analise.tipoResolucao && <p>Resolução: {(chamado as any).analise.tipoResolucao}</p>}
              {'impactaComissao' in (chamado as any).analise && (chamado as any).analise.impactaComissao && (
                <p className="text-amber-400">Impacta comissão: R$ {(chamado as any).analise.valorImpactoComissao}</p>
              )}
            </div>
          )}
          {souAdmin && (mostrarAnalise || !(chamado as any).analise) && (
            <AnaliseForm chamadoId={id} onSalvo={() => { setMostrarAnalise(false); invalidar() }} />
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-gold-400 uppercase tracking-wide">Serviços</p>
            {souAdmin && (
              <button className="text-xs text-gold-400 underline" onClick={() => setMostrarServicos((v) => !v)}>
                {(chamado as any).servicos ? 'Editar' : 'Registrar'}
              </button>
            )}
          </div>
          {(chamado as any).servicos && !mostrarServicos && (
            <div className="text-sm text-dark-200 space-y-1 bg-dark-900/40 border border-dark-700 rounded-2xl p-3">
              <p>Teve serviço: <span className="font-medium">{(chamado as any).servicos.teveServico ? 'Sim' : 'Não'}</span></p>
              {(chamado as any).servicos.valorCobrado != null && <p>Valor cobrado: R$ {(chamado as any).servicos.valorCobrado}</p>}
              {(chamado as any).servicos.executadoPor && <p>Executado por: {(chamado as any).servicos.executadoPor}</p>}
              {(chamado as any).servicos.statusPagamento && <p>Pagamento: {(chamado as any).servicos.statusPagamento}</p>}
            </div>
          )}
          {souAdmin && (mostrarServicos || !(chamado as any).servicos) && (
            <ServicosForm chamadoId={id} onSalvo={() => { setMostrarServicos(false); invalidar() }} />
          )}
        </div>

        <div>
          <p className="text-xs font-bold text-gold-400 uppercase tracking-wide mb-2">Anexos</p>
          <div className="space-y-1 mb-2">
            {(chamado as any).anexos?.map((a: any) => (
              <a key={a.id} href={a.urlArquivo} target="_blank" rel="noopener noreferrer" className="block text-xs text-blue-400 underline">
                {a.nomeArquivo}
              </a>
            ))}
            {!(chamado as any).anexos?.length && <p className="text-xs text-dark-500">Nenhum anexo.</p>}
          </div>
          <label className="text-xs text-gold-400 underline cursor-pointer">
            {enviandoArquivo ? 'Enviando...' : '+ Anexar arquivo'}
            <input type="file" className="hidden" onChange={handleUpload} disabled={enviandoArquivo} />
          </label>
        </div>

        <div>
          <p className="text-xs font-bold text-gold-400 uppercase tracking-wide mb-2">Atualizações</p>
          <div className="space-y-2 mb-2">
            {(chamado as any).atualizacoes?.map((a: any) => (
              <div key={a.id} className="text-sm bg-dark-900/40 border border-dark-700 rounded-xl p-2.5">
                <p className="text-dark-200">{a.mensagem}</p>
                <p className="text-[10px] text-dark-500 mt-1">{a.autor?.name} · {formatarData(a.createdAt)}</p>
              </div>
            ))}
            {!(chamado as any).atualizacoes?.length && <p className="text-xs text-dark-500">Nenhuma atualização ainda.</p>}
          </div>
          <div className="flex gap-2">
            <Input value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Escreva uma atualização..." className="flex-1" />
            <Button
              size="sm"
              loading={comentarMut.isPending}
              onClick={() => mensagem.trim() && comentarMut.mutate({ chamadoId: id, mensagem })}
            >
              Enviar
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// Kanban de chamados de Devolução — reaproveitado igual pra admin e
// vendedor (mesma tela em /admin/devolucoes e /vendedor/devolucoes), a
// diferença de escopo (vê tudo x só o próprio) já acontece no backend.
export default function Devolucoes() {
  const { user } = useAuth()
  const [modalNovo, setModalNovo] = useState(false)
  const [chamadoAberto, setChamadoAberto] = useState<number | null>(null)
  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')

  const souAdmin = user?.role === 'admin'
  const utils = trpc.useUtils()

  // Filtro de empresa/período só faz sentido pra quem enxerga mais de uma
  // empresa de uma vez (visão global — hoje só a Amanda). Pra todo mundo
  // que só vê a própria empresa, a barra de filtro nem aparece.
  // Também usada pro botão de excluir chamado: exclusão é um "poder
  // especial" (equivalente à Amanda no sistema novo, Paola/Andreia no
  // antigo) — nem todo admin tem, mas superAdmin sempre tem (minhasPermissoes
  // já bypassa pra superAdmin, igual o backend faz agora).
  const { data: minhasFeatures } = trpc.permissoes.minhasPermissoes.useQuery(undefined, {
    enabled: souAdmin,
  })
  const temVisaoGlobal = !!user?.superAdmin || !!minhasFeatures?.includes('devolucoes_visao_global')
  const possoExcluir = !!minhasFeatures?.includes('devolucoes_excluir_chamado')
  const { data: empresasDevolucao } = trpc.devolucoes.listarEmpresasPublico.useQuery(undefined, { enabled: temVisaoGlobal })

  const { data: chamados, isLoading } = trpc.devolucoes.listar.useQuery({
    empresaId: empresaFiltro ? Number(empresaFiltro) : undefined,
    dataInicio: dataInicio || undefined,
    dataFim: dataFim || undefined,
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Devolução</h1>
          <p className="text-dark-400 text-sm">Chamados de devolução de peças/materiais.</p>
        </div>
        <Button onClick={() => setModalNovo(true)}>+ Abrir chamado</Button>
      </div>

      {temVisaoGlobal && (
        <div className="flex flex-wrap items-end gap-3 bg-dark-900/40 border border-dark-700 rounded-2xl p-3">
          <Select
            label="Empresa"
            value={empresaFiltro}
            onChange={(e) => setEmpresaFiltro(e.target.value)}
            placeholder="Todas as empresas"
            options={(empresasDevolucao ?? []).map((e) => ({ value: e.id, label: e.nome }))}
            className="w-56"
          />
          <Input label="De" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          <Input label="Até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          {(empresaFiltro || dataInicio || dataFim) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEmpresaFiltro('')
                setDataInicio('')
                setDataFim('')
              }}
            >
              Limpar filtros
            </Button>
          )}
        </div>
      )}

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}

      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${STATUS_COLUNAS.length}, minmax(240px, 1fr))` }}>
        {STATUS_COLUNAS.map((status) => {
          const cards = (chamados ?? []).filter((c) => c.status === status)
          return (
            <div key={status} className="bg-dark-900/40 border border-dark-700 rounded-2xl p-3 min-h-[200px]">
              <p className="text-xs font-bold text-dark-300 uppercase tracking-wide mb-3">
                {STATUS_LABEL[status]} <span className="text-dark-500 font-normal">({cards.length})</span>
              </p>
              <div className="space-y-2">
                {cards.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setChamadoAberto(c.id)}
                    className="w-full text-left bg-dark-800 border border-dark-600 hover:border-gold-600/50 rounded-xl p-3 transition-colors"
                  >
                    <p className="text-sm font-medium text-dark-100">{c.protocolo}</p>
                    <p className="text-xs text-dark-400 truncate">{c.clienteNome}</p>
                    {(c as any).vendedor?.name && <p className="text-[10px] text-dark-500 mt-1">{(c as any).vendedor.name}</p>}
                    {(c as any).empresa?.nome && <p className="text-[10px] text-gold-500/70 mt-0.5">{(c as any).empresa.nome}</p>}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {modalNovo && <NovoChamadoModal onClose={() => setModalNovo(false)} souAdmin={souAdmin} />}
      {chamadoAberto !== null && (
        <DetalheChamadoModal
          id={chamadoAberto}
          souAdmin={souAdmin}
          possoExcluir={possoExcluir}
          onClose={() => setChamadoAberto(null)}
          onExcluido={() => {
            setChamadoAberto(null)
            utils.devolucoes.listar.invalidate()
          }}
        />
      )}
    </div>
  )
}
