import { useEffect, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import toast from 'react-hot-toast'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import { timeAgo } from '../lib/utils'
import { useAuth } from '../contexts/AuthContext'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input, Textarea } from './ui/Input'
import ContatoButtons, { WhatsappButton } from './ui/ContatoButtons'
import EmailButton from './ui/EmailButton'
import TelefonesExtras from './ui/TelefonesExtras'
import EmailsExtras from './ui/EmailsExtras'
import { NovoCompromissoModal } from './CalendarBoard'
import HistoricoCliente from './HistoricoCliente'

const ETAPAS = [
  { value: 'novo', label: 'Novo' },
  { value: 'abordagem', label: 'Abordagem' },
  { value: 'interessado', label: 'Interessado' },
  { value: 'negociacao', label: 'Negociação' },
  { value: 'fechado', label: 'Fechado' },
  { value: 'perdido', label: 'Perdido' },
  { value: 'sem_contato', label: 'Sem contato' },
  { value: 'consumidor_final', label: 'Consumidor Final / Repassado' },
] as const

const ETAPA_LABEL: Record<string, string> = Object.fromEntries(ETAPAS.map((e) => [e.value, e.label]))

// Quantos contatos foram registrados desde que o card entrou na etapa atual
// (não é o total do mês) — é o número que importa pra decidir se já é hora
// de insistir mais ou mover o cliente pra negociação/perdido.
export function tentativasNaEtapaAtual(card: Card): number {
  return card.contatos.filter((c) => c.dataHora >= card.dataEntradaEtapa).length
}

const TIPO_LABEL: Record<string, string> = { ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', visita: 'Visita' }
const TIPO_ICONE: Record<string, string> = { ligacao: '📞', whatsapp: '💬', email: '📧', visita: '🚗' }
const RESULTADO_LABEL: Record<string, string> = {
  respondeu: 'Respondeu',
  nao_respondeu: 'Não respondeu',
  numero_errado: 'Número errado',
  caixa_postal: 'Caixa postal',
}

function formatarMoeda(v: number | null): string {
  if (v === null || v === undefined) return ''
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Campos de valor usam `type="text"` (não "number") porque o input nativo
// number só aceita ponto decimal e barra a vírgula — no formato brasileiro
// ("1.250,50", ponto de milhar + vírgula decimal) isso travava o vendedor
// no meio da digitação. Aqui aceita os dois formatos: tira ponto de milhar
// e troca vírgula por ponto antes de converter pra número.
function parseValorBr(v: string): number {
  return Number(v.replace(/\./g, '').replace(',', '.'))
}

// Inverso do parseValorBr — usado só pra pré-preencher um campo (ex: valor
// orçado já salvo) com o mesmo formato que o input agora espera de volta.
function formatarValorInput(v: number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  return partes.length > 1 ? (partes[0][0] + partes[1][0]).toUpperCase() : nome.slice(0, 2).toUpperCase()
}

// Cor do "dias sem contato" segue o mesmo critério de urgência do alerta
// automático (bloco 8) — vermelho quando já passou do limite configurável,
// mas usa faixas fixas aqui pro card não precisar buscar a configuração.
export function corUrgencia(dias: number | null): string {
  if (dias === null) return 'text-dark-500'
  if (dias >= 7) return 'text-red-400'
  if (dias >= 3) return 'text-amber-400'
  return 'text-green-400'
}

const ETAPAS_ABERTAS_SUGESTAO = ['novo', 'abordagem', 'interessado', 'negociacao', 'sem_contato']

// Roteiro simples pro vendedor não ter que decidir sozinho "o que eu faço com
// esse cliente agora": olha o resultado do último contato, quantas
// tentativas já rolaram nesta etapa e há quantos dias está parado, e devolve
// uma frase com a próxima ação. Não se aplica a etapas terminais (fechado,
// perdido, consumidor_final) — lá não tem "próximo passo".
export function sugestaoProximoPasso(card: Card): string | null {
  if (!ETAPAS_ABERTAS_SUGESTAO.includes(card.etapa)) return null

  const ultimo = card.contatos[0]
  if (!ultimo) return '📞 Fazer o primeiro contato'
  if (!ultimo.resultado) return `⏳ Confirmar se o ${TIPO_LABEL[ultimo.tipo].toLowerCase()} foi respondido`

  if (card.diasSemContato !== null && card.diasSemContato >= 7) {
    return `🔴 ${card.diasSemContato} dias sem contato — retomar com urgência`
  }

  if (ultimo.resultado === 'numero_errado') return '⚠️ Telefone errado — atualizar cadastro do cliente'

  if (ultimo.resultado === 'nao_respondeu' || ultimo.resultado === 'caixa_postal') {
    if (tentativasNaEtapaAtual(card) >= 3) {
      return '🤔 Várias tentativas sem resposta — considerar mover pra Perdido ou Sem contato'
    }
    return ultimo.tipo === 'ligacao' ? '💬 Tentar pelo WhatsApp' : '📞 Tentar ligar'
  }

  if (ultimo.resultado === 'respondeu') {
    return card.etapa === 'negociacao' ? '🤝 Dar seguimento à negociação' : '✅ Respondeu — avaliar avançar pra Negociação'
  }

  return null
}

type RouterOutputs = inferRouterOutputs<AppRouter>
export type Card = RouterOutputs['funil']['meuFunil'][number]

// Board de Kanban compartilhado entre o vendedor vendo o próprio funil
// (`/vendedor/kanban`) e o admin vendo o funil de um vendedor específico
// (`/admin/kanban`) — mesmo card, mesmo modal, só muda de onde os dados vêm.
export default function FunilBoard({ cards }: { cards: Card[] }) {
  const utils = trpc.useUtils()
  // Guarda só o id, não o objeto — assim, quando uma mutação invalida a
  // query e `cards` chega atualizado (ex: edição de um contato, ou o clique
  // no WhatsApp registrando um contato pendente), o modal aberto reflete o
  // dado novo em vez de continuar mostrando o snapshot de quando abriu.
  const [cardAbertoId, setCardAbertoId] = useState<number | null>(null)
  const cardAberto = cards.find((c) => c.funilMensalId === cardAbertoId) ?? null
  const [busca, setBusca] = useState('')
  const [ordenacao, setOrdenacao] = useState('padrao')

  function invalidarTudo() {
    utils.funil.meuFunil.invalidate()
    utils.funil.funilPorVendedor.invalidate()
  }

  const termo = busca.trim().toLowerCase()
  const termoDigitos = termo.replace(/\D/g, '')
  const cardsFiltrados = termo
    ? cards.filter(
        (c) =>
          c.razaoSocial.toLowerCase().includes(termo) ||
          c.codigo?.toLowerCase().includes(termo) ||
          (c.email && c.email.toLowerCase().includes(termo)) ||
          c.emailsExtras.some((e) => e.email.toLowerCase().includes(termo)) ||
          (c.inscricaoEstadual && c.inscricaoEstadual.toLowerCase().includes(termo)) ||
          (c.nomeContato && c.nomeContato.toLowerCase().includes(termo)) ||
          (termoDigitos &&
            ((c.telefoneWhatsapp && c.telefoneWhatsapp.replace(/\D/g, '').includes(termoDigitos)) ||
              c.telefonesExtras.some((t) => t.numero.replace(/\D/g, '').includes(termoDigitos)) ||
              (c.cnpj && c.cnpj.includes(termoDigitos))))
      )
    : cards

  // Ordenação dentro de cada coluna — "padrão" mantém a ordem que já vem do
  // backend (mais antigo sem contato primeiro, ver buscarFunilDoVendedor).
  // As demais opções reordenam só a visualização, não mudam nada no banco.
  const cardsOrdenados = [...cardsFiltrados].sort((a, b) => {
    switch (ordenacao) {
      case 'nome':
        return a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR')
      case 'mais_dias_sem_contato':
        // Nunca contatado (null) é o caso mais urgente — mesma convenção já
        // usada na "Fila de hoje" (server/src/router/funil.ts).
        return (b.diasSemContato ?? Infinity) - (a.diasSemContato ?? Infinity)
      case 'mais_contatos':
        return b.contatos.length - a.contatos.length
      case 'mais_venda':
        return b.valorFechadoTotal - a.valorFechadoTotal
      default:
        return 0
    }
  })

  // Com muitas colunas/cards o board fica bem alto, e a barra de rolagem
  // horizontal nativa (embaixo do board) só aparece depois de rolar a
  // página inteira — essa barra duplicada fica sempre visível em cima,
  // sincronizada com o scroll de verdade do board logo abaixo.
  const boardRef = useRef<HTMLDivElement>(null)
  const topScrollRef = useRef<HTMLDivElement>(null)
  const [boardWidth, setBoardWidth] = useState(0)
  const sincronizando = useRef(false)

  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const atualizar = () => setBoardWidth(el.scrollWidth)
    atualizar()
    const observer = new ResizeObserver(atualizar)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  function sincronizarDoTopo() {
    if (sincronizando.current || !boardRef.current || !topScrollRef.current) return
    sincronizando.current = true
    boardRef.current.scrollLeft = topScrollRef.current.scrollLeft
    sincronizando.current = false
  }

  function sincronizarDoBoard() {
    if (sincronizando.current || !boardRef.current || !topScrollRef.current) return
    sincronizando.current = true
    topScrollRef.current.scrollLeft = boardRef.current.scrollLeft
    sincronizando.current = false
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="max-w-sm flex-1 min-w-[220px]">
          <Input placeholder="Buscar cliente por nome, código ou telefone..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="w-56">
          <Select
            label="Ordenar por"
            value={ordenacao}
            onChange={(e) => setOrdenacao(e.target.value)}
            options={[
              { value: 'padrao', label: 'Padrão' },
              { value: 'nome', label: 'Nome (A-Z)' },
              { value: 'mais_dias_sem_contato', label: 'Mais dias sem contato' },
              { value: 'mais_contatos', label: 'Mais contatos' },
              { value: 'mais_venda', label: 'Maior valor fechado' },
            ]}
          />
        </div>
      </div>

      <div ref={topScrollRef} onScroll={sincronizarDoTopo} className="overflow-x-auto overflow-y-hidden h-4 mb-1">
        <div style={{ width: boardWidth, height: 1 }} />
      </div>

      <div ref={boardRef} onScroll={sincronizarDoBoard} className="flex gap-4 overflow-x-auto pb-4">
        {ETAPAS.map((etapa) => {
          const colCards = cardsOrdenados.filter((c) => c.etapa === etapa.value)
          return (
            <div key={etapa.value} className="shrink-0 w-72">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold text-dark-200">{etapa.label}</span>
                <span className="text-dark-500 text-xs">{colCards.length}</span>
              </div>
              <div className="space-y-2">
                {colCards.map((card) => {
                  const ultimoContato = card.contatos[0]
                  const pendente = !!ultimoContato && !ultimoContato.resultado
                  const sugestao = sugestaoProximoPasso(card)
                  return (
                    <div
                      key={card.funilMensalId}
                      onClick={() => setCardAbertoId(card.funilMensalId)}
                      className="bg-dark-800 border border-dark-600 rounded-xl p-3 cursor-pointer hover:border-gold-600/50 transition-all"
                    >
                      <div className="flex items-start gap-2 mb-1">
                        <div className="w-7 h-7 rounded-full bg-dark-700 text-dark-300 text-xs font-bold flex items-center justify-center shrink-0">
                          {iniciais(card.razaoSocial)}
                        </div>
                        <div className="pt-1">
                          <p className="text-sm font-medium text-dark-100 leading-tight">{card.razaoSocial}</p>
                          {card.orcamentoLabel && (
                            <p className="text-xs text-gold-400 font-medium">{card.orcamentoLabel}</p>
                          )}
                        </div>
                      </div>
                      {card.carregadoMesAnterior && (
                        <p className="text-xs text-amber-500 mb-1">Carregado do mês anterior</p>
                      )}

                      {ultimoContato && (
                        <div className="bg-dark-900/60 rounded-lg px-2 py-1.5 mt-2 mb-2">
                          <div className="flex items-center gap-1 text-xs text-dark-400">
                            <span>{TIPO_ICONE[ultimoContato.tipo]}</span>
                            <span>{timeAgo(ultimoContato.dataHora)}</span>
                            {pendente && (
                              <span className="text-amber-400 font-medium">· ⏳ aguardando confirmação</span>
                            )}
                          </div>
                          <p className="text-xs text-dark-300 line-clamp-2 mt-0.5">{ultimoContato.observacao}</p>
                        </div>
                      )}

                      <p className={`text-xs ${corUrgencia(card.diasSemContato)}`}>
                        {card.diasSemContato === null ? 'Nunca contatado' : `${card.diasSemContato} dia(s) sem contato`}
                      </p>
                      <p className="text-xs text-dark-400">{tentativasNaEtapaAtual(card)} tentativa(s) nesta etapa</p>
                      {sugestao && (
                        <p className="text-xs text-gold-300 bg-gold-900/10 border border-gold-700/30 rounded-lg px-2 py-1 mt-2">{sugestao}</p>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <div>
                          {card.valorOrcado != null && <p className="text-xs text-dark-400">Orçado: {formatarMoeda(card.valorOrcado)}</p>}
                          {card.valorFechadoTotal > 0 && (
                            <p className="text-xs text-green-400">
                              Fechado: {formatarMoeda(card.valorFechadoTotal)}
                              {card.vendas.length > 1 && ` (${card.vendas.length} vendas)`}
                            </p>
                          )}
                        </div>
                        <ContatoButtons
                          telefone={card.telefoneWhatsapp}
                          telefonesExtras={card.telefonesExtras}
                          email={card.email}
                          emailsExtras={card.emailsExtras}
                          clienteId={card.clienteId}
                          funilMensalId={card.funilMensalId}
                        />
                      </div>
                    </div>
                  )
                })}
                {colCards.length === 0 && (
                  <div className="h-20 border-2 border-dashed border-dark-700 rounded-xl flex items-center justify-center text-dark-600 text-xs">
                    Vazio
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {cardAberto && (
        <CardModal
          key={cardAberto.funilMensalId}
          card={cardAberto}
          onClose={() => setCardAbertoId(null)}
          onChanged={() => {
            invalidarTudo()
            setCardAbertoId(null)
          }}
        />
      )}
    </div>
  )
}

// Botão de anexar PDF bem visível (antes era só o `<input type="file">` cru
// do navegador, discreto e fácil de passar batido) — pedido direto do João.
function AnexoPdfInput({
  label,
  nomeArquivo,
  onSelecionar,
}: {
  label: string
  nomeArquivo?: string
  onSelecionar: (arquivo: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-dark-200 font-medium">{label}</label>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        onChange={(e) => onSelecionar(e.target.files?.[0] ?? null)}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 border-2 border-dashed border-gold-600/50 hover:border-gold-500 hover:bg-gold-900/10 rounded-xl px-4 py-3 text-sm text-gold-300 font-medium transition-all"
      >
        <Paperclip size={18} />
        {nomeArquivo ? `📎 ${nomeArquivo}` : 'Clique para anexar o PDF'}
      </button>
    </div>
  )
}

function ItensPedidoEditor({
  itens,
  onChange,
}: {
  itens: { descricao: string; quantidade: string; valorUnitario: string }[]
  onChange: (itens: { descricao: string; quantidade: string; valorUnitario: string }[]) => void
}) {
  const { data: catalogo } = trpc.maquinas.listaCatalogoItens.useQuery()

  function atualizarItem(indice: number, campo: 'descricao' | 'quantidade' | 'valorUnitario', valor: string) {
    onChange(itens.map((item, i) => (i === indice ? { ...item, [campo]: valor } : item)))
  }

  return (
    <div className="space-y-2">
      <label className="text-sm text-dark-200 font-medium">Itens do pedido (opcional)</label>
      {!!catalogo?.length && (
        <datalist id="catalogo-itens-pedido">
          {catalogo.map((c) => (
            <option key={c.id} value={c.modelo}>
              {c.categoria ?? c.linha ?? ''}
            </option>
          ))}
        </datalist>
      )}
      {itens.map((item, i) => (
        <div key={i} className="grid grid-cols-[1fr_70px_90px_auto] gap-1.5 items-center">
          <Input
            placeholder="Descrição"
            value={item.descricao}
            onChange={(e) => atualizarItem(i, 'descricao', e.target.value)}
            list={catalogo?.length ? 'catalogo-itens-pedido' : undefined}
          />
          <Input placeholder="Qtd" type="text" inputMode="decimal" value={item.quantidade} onChange={(e) => atualizarItem(i, 'quantidade', e.target.value)} />
          <Input
            placeholder="1.250,50"
            type="text"
            inputMode="decimal"
            value={item.valorUnitario}
            onChange={(e) => atualizarItem(i, 'valorUnitario', e.target.value)}
          />
          <button type="button" onClick={() => onChange(itens.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-300 text-xs">
            Remover
          </button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => onChange([...itens, { descricao: '', quantidade: '', valorUnitario: '' }])}
      >
        + Adicionar item
      </Button>
      <p className="text-xs text-dark-500">
        Não precisa listar tudo — os itens informados aqui alimentam o relatório de produtos mais vendidos.
        {!!catalogo?.length && ' Comece a digitar pra puxar do catálogo cadastrado.'}
      </p>
    </div>
  )
}

function CardModal({ card, onClose, onChanged }: { card: Card; onClose: () => void; onChanged: () => void }) {
  const utils = trpc.useUtils()
  const [tipo, setTipo] = useState('ligacao')
  const [resultado, setResultado] = useState('')
  const [observacao, setObservacao] = useState('')
  const [etapaSelecionada, setEtapaSelecionada] = useState(card.etapa)
  const [valorOrcado, setValorOrcado] = useState(formatarValorInput(card.valorOrcado))
  const [valorFechado, setValorFechado] = useState('')
  const [condicaoPagamento, setCondicaoPagamento] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfPathEnviado, setPdfPathEnviado] = useState<string | null>(null)
  const [novaVendaAberta, setNovaVendaAberta] = useState(false)
  const [motivoCategoria, setMotivoCategoria] = useState('')
  const [motivoOpcao, setMotivoOpcao] = useState('')
  const [motivoItem, setMotivoItem] = useState('')
  const [motivoObs, setMotivoObs] = useState('')
  const [empresaRepasse, setEmpresaRepasse] = useState('')
  const [motivoRepasseObs, setMotivoRepasseObs] = useState('')
  const [agendarAberto, setAgendarAberto] = useState(false)
  const [itensPedido, setItensPedido] = useState<{ descricao: string; quantidade: string; valorUnitario: string }[]>([])
  const [clienteIdFaturamento, setClienteIdFaturamento] = useState(card.clienteId)
  const [historicoAberto, setHistoricoAberto] = useState(false)

  function invalidarTudo() {
    utils.funil.meuFunil.invalidate()
    utils.funil.funilPorVendedor.invalidate()
    utils.compromissos.listar.invalidate()
  }

  const registrarMut = trpc.contatos.registrar.useMutation({
    onSuccess() {
      invalidarTudo()
      onChanged()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const moverMut = trpc.funil.moverEtapa.useMutation({
    onSuccess() {
      invalidarTudo()
      onChanged()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const criarOrcamentoMut = trpc.funil.criarOrcamento.useMutation({
    onSuccess() {
      toast.success('Novo orçamento aberto — já aparece como um card separado no Kanban.')
      invalidarTudo()
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  // Sobe o PDF pro disco (sempre um upload novo — usado quando o vendedor
  // acabou de escolher o arquivo).
  async function enviarPdf(arquivo: File): Promise<string> {
    const token = localStorage.getItem('odin_token')
    const form = new FormData()
    form.append('file', arquivo)
    const res = await fetch('/upload/pedido', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
    if (!res.ok) throw new Error('Falha ao enviar o PDF.')
    const data = await res.json()
    setPdfPathEnviado(data.path)
    return data.path
  }

  // Reaproveita o path já enviado (evita subir o mesmo arquivo duas vezes ao
  // extrair itens e depois submeter o formulário).
  async function obterPdfPath(): Promise<string> {
    if (pdfPathEnviado) return pdfPathEnviado
    return enviarPdf(pdfFile!)
  }

  const extrairItensMut = trpc.pedidos.extrairItens.useMutation({
    onSuccess(data) {
      if (data.itens.length === 0) {
        toast.error('Não encontrei itens nesse PDF — preencha manualmente.')
        return
      }
      setItensPedido(
        data.itens.map((item) => ({
          descricao: item.descricao,
          quantidade: item.quantidade != null ? String(item.quantidade) : '',
          valorUnitario: item.valorUnitario != null ? String(item.valorUnitario) : '',
        }))
      )
      // Na Negociação ainda não existe uma venda pra gravar os itens de
      // verdade (a tabela de itens exige uma venda fechada) — o PDF serve só
      // pra sugerir o valor orçado automaticamente. Só preenche se o
      // vendedor ainda não tinha digitado nada, pra não sobrescrever à toa.
      if (etapaSelecionada === 'negociacao' && !valorOrcado) {
        const soma = data.itens.reduce((acc, item) => acc + (item.quantidade ?? 1) * (item.valorUnitario ?? 0), 0)
        if (soma > 0) setValorOrcado(String(soma))
      }
      // Fora de Negociação é fechamento de verdade — sugere condição de
      // pagamento e valor total lidos do PDF, sempre revisável antes de
      // salvar. Só preenche o que o vendedor ainda não tinha digitado.
      if (etapaSelecionada !== 'negociacao') {
        if (data.condicaoPagamento && !condicaoPagamento) setCondicaoPagamento(data.condicaoPagamento)
        if (data.valorTotal != null && !valorFechado) setValorFechado(formatarValorInput(data.valorTotal))
      }
      toast.success(`${data.itens.length} item(ns) extraído(s) do PDF — confira antes de salvar.`)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const anexarPropostaMut = trpc.funil.anexarProposta.useMutation({
    onSuccess() {
      toast.success('PDF anexado e salvo.')
      invalidarTudo()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  // Dispara sozinho assim que o vendedor anexa o PDF — não precisa clicar em
  // nada, só conferir o resultado antes de salvar. `persistirComoProposta`
  // só é true no anexo da etapa Negociação: salva o caminho na hora (em vez
  // de esperar o "Salvar etapa"), porque um card que já está em Negociação
  // não necessariamente dispara nenhum submit depois do anexo.
  async function handleArquivoSelecionado(arquivo: File | null, persistirComoProposta = false) {
    setPdfFile(arquivo)
    setPdfPathEnviado(null)
    if (!arquivo) return
    try {
      const caminho = await enviarPdf(arquivo)
      extrairItensMut.mutate({ path: caminho })
      if (persistirComoProposta) {
        anexarPropostaMut.mutate({ funilMensalId: card.funilMensalId, pdfPropostaPath: caminho })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar o PDF.')
    }
  }

  async function handleExtrairItens() {
    if (!pdfFile) return toast.error('Selecione o PDF do pedido primeiro.')
    try {
      const caminho = await obterPdfPath()
      extrairItensMut.mutate({ path: caminho })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar o PDF.')
    }
  }

  const editarContatoMut = trpc.contatos.editar.useMutation({
    onSuccess() {
      invalidarTudo()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const excluirContatoMut = trpc.contatos.excluir.useMutation({
    onSuccess() {
      invalidarTudo()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function handleRegistrar(e: React.FormEvent) {
    e.preventDefault()
    if (!observacao.trim()) return toast.error('A observação é obrigatória.')
    registrarMut.mutate({
      funilMensalId: card.funilMensalId,
      tipo: tipo as any,
      resultado: (resultado || undefined) as any,
      observacao,
    })
  }

  // Em Novo/Abordagem o vendedor tinha que abrir o card 2x: uma pra
  // registrar o contato, outra pra mover a etapa. Esse botão junta os dois
  // num clique só — só existe pra essas duas etapas porque as seguintes
  // (fechado, perdido, consumidor final) exigem campo extra obrigatório que
  // não cabe nesse formulário simples.
  const PROXIMA_ETAPA_RAPIDA: Record<string, string> = { novo: 'abordagem', abordagem: 'interessado' }
  async function handleRegistrarEAvancar() {
    if (!observacao.trim()) return toast.error('A observação é obrigatória.')
    const proxima = PROXIMA_ETAPA_RAPIDA[card.etapa]
    if (!proxima) return
    try {
      await registrarMut.mutateAsync({
        funilMensalId: card.funilMensalId,
        tipo: tipo as any,
        resultado: (resultado || undefined) as any,
        observacao,
      })
      moverMut.mutate({ funilMensalId: card.funilMensalId, versao: card.versao, etapa: proxima as any })
    } catch {
      // erro já mostrado pelo onError do registrarMut
    }
  }

  async function handleMover(e: React.FormEvent) {
    e.preventDefault()
    let pdfPedidoPath: string | undefined
    let pdfPropostaPath: string | undefined

    if (etapaSelecionada === 'fechado') {
      if (!valorFechado) return toast.error('Informe o valor fechado.')
      if (!pdfFile) return toast.error('Anexe o PDF do pedido/nota.')
      try {
        pdfPedidoPath = await obterPdfPath()
      } catch {
        return toast.error('Falha ao enviar o PDF.')
      }
    }

    // Anexo de proposta é opcional, e opcional só faz sentido salvar quando
    // o vendedor de fato escolheu um arquivo — sem isso, moverMut mandaria
    // pdfPropostaPath undefined e o backend simplesmente não sobrescreve.
    if (etapaSelecionada === 'negociacao' && pdfFile) {
      try {
        pdfPropostaPath = await obterPdfPath()
      } catch {
        return toast.error('Falha ao enviar o PDF.')
      }
    }

    if (etapaSelecionada === 'perdido') {
      if (!motivoCategoria || !motivoObs.trim()) {
        return toast.error('Informe a categoria e a observação do motivo de perda.')
      }
    }

    if (etapaSelecionada === 'consumidor_final' && !empresaRepasse) {
      return toast.error('Informe para qual empresa este cliente foi repassado.')
    }

    moverMut.mutate({
      funilMensalId: card.funilMensalId,
      versao: card.versao,
      etapa: etapaSelecionada as any,
      valorOrcado: valorOrcado ? parseValorBr(valorOrcado) : undefined,
      valorFechado: valorFechado ? parseValorBr(valorFechado) : undefined,
      condicaoPagamento: condicaoPagamento || undefined,
      pdfPedidoPath,
      pdfPropostaPath,
      motivoPerdaCategoria: (motivoCategoria || undefined) as any,
      motivoPerdaOpcao: motivoOpcao || undefined,
      motivoPerdaItem: motivoItem || undefined,
      motivoPerdaObservacao: motivoObs || undefined,
      empresaRepasse: (empresaRepasse || undefined) as any,
      motivoRepasseObservacao: motivoRepasseObs || undefined,
      clienteIdFaturamento: card.cnpjsDisponiveis.length > 1 ? clienteIdFaturamento : undefined,
      itens: itensPedido
        .filter((i) => i.descricao.trim())
        .map((i) => ({
          descricao: i.descricao.trim(),
          quantidade: i.quantidade ? parseValorBr(i.quantidade) : undefined,
          valorUnitario: i.valorUnitario ? parseValorBr(i.valorUnitario) : undefined,
        })),
    })
  }

  const registrarVendaMut = trpc.vendas.registrar.useMutation({
    onSuccess() {
      toast.success('Venda registrada!')
      invalidarTudo()
      setNovaVendaAberta(false)
      setValorFechado('')
      setCondicaoPagamento('')
      setPdfFile(null)
      setPdfPathEnviado(null)
      setItensPedido([])
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  // Cliente que já fechou esse mês e comprou de novo — não passa por "Mover
  // etapa" (o card já está "Fechado" e continua), só soma mais uma venda.
  async function handleRegistrarVenda(e: React.FormEvent) {
    e.preventDefault()
    if (!valorFechado) return toast.error('Informe o valor da venda.')
    if (!pdfFile) return toast.error('Anexe o PDF do pedido/nota.')

    let pdfPedidoPath: string
    try {
      pdfPedidoPath = await obterPdfPath()
    } catch {
      return toast.error('Falha ao enviar o PDF.')
    }

    registrarVendaMut.mutate({
      funilMensalId: card.funilMensalId,
      valorFechado: parseValorBr(valorFechado),
      condicaoPagamento: condicaoPagamento || undefined,
      pdfPedidoPath,
      clienteIdFaturamento: card.cnpjsDisponiveis.length > 1 ? clienteIdFaturamento : undefined,
      itens: itensPedido
        .filter((i) => i.descricao.trim())
        .map((i) => ({
          descricao: i.descricao.trim(),
          quantidade: i.quantidade ? parseValorBr(i.quantidade) : undefined,
          valorUnitario: i.valorUnitario ? parseValorBr(i.valorUnitario) : undefined,
        })),
    })
  }

  const [vendaEditandoId, setVendaEditandoId] = useState<number | null>(null)
  const [vendaEditValor, setVendaEditValor] = useState('')
  const [vendaEditCondicao, setVendaEditCondicao] = useState('')

  const editarVendaMut = trpc.vendas.editar.useMutation({
    onSuccess() {
      toast.success('Venda atualizada')
      invalidarTudo()
      setVendaEditandoId(null)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function abrirEdicaoVenda(v: Card['vendas'][number]) {
    setVendaEditandoId(v.id)
    setVendaEditValor(formatarValorInput(v.valorFechado))
    setVendaEditCondicao(v.condicaoPagamento ?? '')
  }

  function handleSalvarEdicaoVenda(e: React.FormEvent) {
    e.preventDefault()
    if (!vendaEditandoId) return
    if (!vendaEditValor) return toast.error('Informe o valor.')
    editarVendaMut.mutate({
      vendaId: vendaEditandoId,
      valorFechado: parseValorBr(vendaEditValor),
      condicaoPagamento: vendaEditCondicao || undefined,
    })
  }

  return (
    <Modal open onClose={onClose} title={card.orcamentoLabel ? `${card.razaoSocial} — ${card.orcamentoLabel}` : card.razaoSocial} size="lg">
      <div className="space-y-5">
        {sugestaoProximoPasso(card) && (
          <div className="text-sm text-gold-300 bg-gold-900/10 border border-gold-700/30 rounded-xl px-3 py-2">
            <span className="font-semibold">Sugestão: </span>
            {sugestaoProximoPasso(card)}
          </div>
        )}
        <ClienteInfoEditavel card={card} />

        <div>
          <button
            type="button"
            onClick={() => setHistoricoAberto((v) => !v)}
            className="text-xs text-gold-400 hover:underline"
          >
            {historicoAberto ? '▾' : '▸'} Ver histórico completo do cliente (vendas, itens, contatos de todos os meses)
          </button>
          {historicoAberto && (
            <div className="mt-2">
              <HistoricoCliente clienteId={card.clienteId} />
            </div>
          )}
        </div>

        <SolicitarAcaoCarteira card={card} />

        {(card.etapa === 'negociacao' || card.etapa === 'fechado') && (
          <button
            type="button"
            onClick={() => criarOrcamentoMut.mutate({ funilMensalId: card.funilMensalId })}
            disabled={criarOrcamentoMut.isPending}
            className="text-xs text-gold-400 hover:underline disabled:opacity-50"
          >
            + Abrir {card.etapa === 'fechado' ? 'uma nova negociação' : 'outro orçamento'} pra este cliente
          </button>
        )}

        {card.pdfPropostaPath && (
          <a
            href={card.pdfPropostaPath.startsWith('/uploads/') ? card.pdfPropostaPath : `/uploads/${card.pdfPropostaPath}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs text-gold-400 hover:underline"
          >
            📄 Ver proposta/orçamento anexado
          </a>
        )}

        {card.etapa === 'fechado' && (
          <div className="border-t border-dark-700 pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-dark-100">
              💰 Vendas do mês ({formatarMoeda(card.valorFechadoTotal)} no total)
            </h3>
            <div className="space-y-1.5">
              {card.vendas.map((v) =>
                vendaEditandoId === v.id ? (
                  <form
                    key={v.id}
                    onSubmit={handleSalvarEdicaoVenda}
                    className="space-y-2 bg-dark-900/60 border border-gold-700/30 rounded-lg p-2"
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        label="Valor (R$)"
                        type="text"
                        inputMode="decimal"
                        value={vendaEditValor}
                        onChange={(e) => setVendaEditValor(e.target.value)}
                      />
                      <Input
                        label="Condição de pagamento"
                        value={vendaEditCondicao}
                        onChange={(e) => setVendaEditCondicao(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" loading={editarVendaMut.isPending}>
                        Salvar
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setVendaEditandoId(null)}>
                        Cancelar
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div key={v.id} className="flex items-center justify-between text-sm bg-dark-900/40 rounded-lg px-3 py-1.5">
                    <span className="text-dark-100">{formatarMoeda(v.valorFechado)}</span>
                    <span className="text-xs text-dark-400">{v.condicaoPagamento || '—'}</span>
                    <span className="text-xs text-dark-500">{timeAgo(v.dataFechamento)}</span>
                    {v.pdfPedidoPath && (
                      <a
                        href={v.pdfPedidoPath.startsWith('/uploads/') ? v.pdfPedidoPath : `/uploads/${v.pdfPedidoPath}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-gold-400 hover:underline"
                      >
                        📄 Ver PDF
                      </a>
                    )}
                    <button type="button" onClick={() => abrirEdicaoVenda(v)} className="text-xs text-gold-400 hover:underline">
                      Editar
                    </button>
                  </div>
                )
              )}
            </div>

            {!novaVendaAberta ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => setNovaVendaAberta(true)}>
                + Registrar nova venda
              </Button>
            ) : (
              <form onSubmit={handleRegistrarVenda} className="space-y-2 bg-dark-900/40 border border-dark-700 rounded-2xl p-3">
                {card.cnpjsDisponiveis.length > 1 && (
                  <Select
                    label="Faturar em qual CNPJ?"
                    value={String(clienteIdFaturamento)}
                    onChange={(e) => setClienteIdFaturamento(Number(e.target.value))}
                    options={card.cnpjsDisponiveis.map((c) => ({
                      value: String(c.clienteId),
                      label: `${c.razaoSocial} — ${c.cnpj ?? 'sem CNPJ'}`,
                    }))}
                  />
                )}
                <Input
                  label="Valor da venda (R$) — obrigatório"
                  type="text"
                  inputMode="decimal"
                  placeholder="1.250,50"
                  value={valorFechado}
                  onChange={(e) => setValorFechado(e.target.value)}
                />
                <Input
                  label="Condição de pagamento"
                  value={condicaoPagamento}
                  onChange={(e) => setCondicaoPagamento(e.target.value)}
                  placeholder="À vista, boleto 30/60..."
                />
                <div className="flex flex-col gap-1">
                  <AnexoPdfInput
                    label="PDF do pedido/nota — obrigatório"
                    nomeArquivo={pdfFile?.name}
                    onSelecionar={handleArquivoSelecionado}
                  />
                  {extrairItensMut.isPending && <p className="text-xs text-gold-400">🤖 Analisando o PDF com IA, aguarde...</p>}
                  {pdfFile && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      loading={extrairItensMut.isPending}
                      onClick={handleExtrairItens}
                    >
                      🔄 Extrair itens de novo
                    </Button>
                  )}
                </div>
                <ItensPedidoEditor itens={itensPedido} onChange={setItensPedido} />
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setNovaVendaAberta(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" size="sm" loading={registrarVendaMut.isPending}>
                    Salvar venda
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-dark-700 pt-4">
          <ContatoButtons
            telefone={card.telefoneWhatsapp}
            telefonesExtras={card.telefonesExtras}
            email={card.email}
            emailsExtras={card.emailsExtras}
            clienteId={card.clienteId}
            funilMensalId={card.funilMensalId}
            size="md"
          />
          <Button size="sm" variant="secondary" onClick={() => setAgendarAberto(true)}>
            📅 Agendar
          </Button>
        </div>

        <SugestaoMensagem
          nome={card.razaoSocial}
          telefone={card.telefoneWhatsapp}
          email={card.email}
          clienteId={card.clienteId}
          funilMensalId={card.funilMensalId}
          cidade={card.cidade}
          diasSemContato={card.diasSemContato}
          ultimoContato={card.contatos[0] ? `${TIPO_LABEL[card.contatos[0].tipo]} ${timeAgo(card.contatos[0].dataHora)}` : null}
        />

        {card.contatos.length > 0 && (
          <div className="space-y-2 border-t border-dark-700 pt-4">
            <h3 className="text-sm font-semibold text-dark-100">Histórico de contatos</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {card.contatos.map((c) => (
                <ContatoItem
                  key={c.id}
                  contato={c}
                  onEditar={(observacao, resultado) => editarContatoMut.mutate({ id: c.id, observacao, resultado: resultado as any })}
                  onExcluir={() => excluirContatoMut.mutate({ id: c.id })}
                />
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleRegistrar} className="space-y-2 border-t border-dark-700 pt-4">
          <h3 className="text-sm font-semibold text-dark-100">Registrar contato</h3>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              options={[
                { value: 'ligacao', label: 'Ligação' },
                { value: 'whatsapp', label: 'WhatsApp' },
                { value: 'email', label: 'E-mail' },
                { value: 'visita', label: 'Visita' },
              ]}
            />
            <Select
              value={resultado}
              onChange={(e) => setResultado(e.target.value)}
              placeholder="Resultado (opcional)"
              options={[
                { value: 'respondeu', label: 'Respondeu' },
                { value: 'nao_respondeu', label: 'Não respondeu' },
                { value: 'numero_errado', label: 'Número errado' },
                { value: 'caixa_postal', label: 'Caixa postal' },
              ]}
            />
          </div>
          <Textarea
            placeholder="O que foi conversado (obrigatório)"
            rows={2}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={registrarMut.isPending && !moverMut.isPending}>
              Salvar contato
            </Button>
            {PROXIMA_ETAPA_RAPIDA[card.etapa] && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={registrarMut.isPending || moverMut.isPending}
                onClick={handleRegistrarEAvancar}
              >
                Salvar e mover para {ETAPA_LABEL[PROXIMA_ETAPA_RAPIDA[card.etapa]]}
              </Button>
            )}
          </div>
        </form>

        <form onSubmit={handleMover} className="space-y-3 border-t border-dark-700 pt-4">
          <h3 className="text-sm font-semibold text-dark-100">Mover etapa</h3>

          <div className="space-y-2">
            <p className="text-xs font-bold text-gold-400 uppercase tracking-wide">Status</p>
            <div className="bg-dark-900/40 border border-dark-700 rounded-2xl p-2 space-y-1">
              {ETAPAS.map((etapa) => {
                const selecionada = etapaSelecionada === etapa.value
                const atual = card.etapa === etapa.value
                return (
                  <button
                    key={etapa.value}
                    type="button"
                    onClick={() => setEtapaSelecionada(etapa.value)}
                    className={`w-full text-left px-4 py-3 rounded-2xl text-sm transition-colors border ${
                      selecionada
                        ? 'border-gold-400 bg-gold-900/20 text-gold-300 font-medium'
                        : atual
                          ? 'border-transparent bg-dark-800 text-dark-200'
                          : 'border-transparent text-dark-400 hover:bg-dark-800/60'
                    }`}
                  >
                    {etapa.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="bg-dark-900/40 border border-dark-700 rounded-2xl p-4">
            <p className="text-xs text-dark-500">Tentativas na etapa atual ({ETAPA_LABEL[card.etapa]})</p>
            <p className="text-2xl font-bold text-dark-50 mt-1">{tentativasNaEtapaAtual(card)}</p>
            <p className="text-xs text-dark-500 mt-1">{card.qtdTentativasContato} no total do mês</p>
          </div>

          <Input
            label="Valor orçado (R$)"
            type="text"
            inputMode="decimal"
            placeholder="1.250,50"
            value={valorOrcado}
            onChange={(e) => setValorOrcado(e.target.value)}
          />

          {etapaSelecionada === 'negociacao' && (
            <div className="flex flex-col gap-1">
              <AnexoPdfInput
                label="Anexar proposta/orçamento (opcional)"
                nomeArquivo={pdfFile?.name}
                onSelecionar={(arquivo) => handleArquivoSelecionado(arquivo, true)}
              />
              {anexarPropostaMut.isPending && <p className="text-xs text-gold-400">Salvando anexo...</p>}
              {extrairItensMut.isPending && <p className="text-xs text-gold-400">🤖 Analisando o PDF com IA, aguarde...</p>}
              {pdfFile && (
                <Button type="button" size="sm" variant="secondary" loading={extrairItensMut.isPending} onClick={handleExtrairItens}>
                  🔄 Extrair itens de novo
                </Button>
              )}
              {(pdfFile || itensPedido.length > 0) && <ItensPedidoEditor itens={itensPedido} onChange={setItensPedido} />}
              <p className="text-xs text-dark-500">
                A IA lê o PDF e sugere o valor orçado e os itens automaticamente — confira antes de salvar. Os itens só
                ficam registrados de vez quando o pedido for fechado de verdade.
              </p>
            </div>
          )}

          {etapaSelecionada === 'fechado' && card.etapa === 'fechado' && (
            <p className="text-xs text-dark-500 bg-dark-900/40 rounded-lg px-3 py-2">
              Esse cliente já está fechado esse mês — pra lançar outro pedido, use "Registrar nova venda" lá em cima,
              não precisa mover a etapa de novo.
            </p>
          )}

          {etapaSelecionada === 'fechado' && card.etapa !== 'fechado' && (
            <>
              {card.cnpjsDisponiveis.length > 1 && (
                <Select
                  label="Faturar em qual CNPJ?"
                  value={String(clienteIdFaturamento)}
                  onChange={(e) => setClienteIdFaturamento(Number(e.target.value))}
                  options={card.cnpjsDisponiveis.map((c) => ({
                    value: String(c.clienteId),
                    label: `${c.razaoSocial} — ${c.cnpj ?? 'sem CNPJ'}`,
                  }))}
                />
              )}
              <Input
                label="Valor fechado (R$) — obrigatório"
                type="text"
                inputMode="decimal"
                placeholder="1.250,50"
                value={valorFechado}
                onChange={(e) => setValorFechado(e.target.value)}
              />
              <Input
                label="Condição de pagamento"
                value={condicaoPagamento}
                onChange={(e) => setCondicaoPagamento(e.target.value)}
                placeholder="À vista, boleto 30/60..."
              />
              <div className="flex flex-col gap-1">
                <AnexoPdfInput
                  label="PDF do pedido/nota — obrigatório"
                  nomeArquivo={pdfFile?.name}
                  onSelecionar={handleArquivoSelecionado}
                />
                {extrairItensMut.isPending && <p className="text-xs text-gold-400">🤖 Analisando o PDF com IA, aguarde...</p>}
                {pdfFile && (
                  <Button type="button" size="sm" variant="secondary" loading={extrairItensMut.isPending} onClick={handleExtrairItens}>
                    🔄 Extrair itens de novo
                  </Button>
                )}
              </div>
              <ItensPedidoEditor itens={itensPedido} onChange={setItensPedido} />
            </>
          )}

          {etapaSelecionada === 'perdido' && (
            <>
              <Select
                label="Categoria do motivo — obrigatório"
                value={motivoCategoria}
                onChange={(e) => setMotivoCategoria(e.target.value)}
                placeholder="Selecione..."
                options={[
                  { value: 'estoque', label: 'Estoque' },
                  { value: 'financeiro', label: 'Financeiro' },
                  { value: 'compras', label: 'Compras' },
                ]}
              />
              <Input label="Opção específica (opcional)" value={motivoOpcao} onChange={(e) => setMotivoOpcao(e.target.value)} />
              <Input label="Peça/item perdido (opcional)" value={motivoItem} onChange={(e) => setMotivoItem(e.target.value)} />
              <Textarea
                label="Observação — obrigatória"
                rows={2}
                value={motivoObs}
                onChange={(e) => setMotivoObs(e.target.value)}
              />
            </>
          )}

          {etapaSelecionada === 'consumidor_final' && (
            <>
              <Select
                label="Repassado para — obrigatório"
                value={empresaRepasse}
                onChange={(e) => setEmpresaRepasse(e.target.value)}
                placeholder="Selecione a empresa..."
                options={[
                  { value: 'tubos_conexoes', label: 'Tubos e Conexões' },
                  { value: 'compressores', label: 'Compressores' },
                  { value: 'outra', label: 'Outra' },
                ]}
              />
              <Textarea
                label="Observação (opcional)"
                rows={2}
                value={motivoRepasseObs}
                onChange={(e) => setMotivoRepasseObs(e.target.value)}
                placeholder="Ex: cliente pessoa física, procurava produto no varejo..."
              />
            </>
          )}

          <Button type="submit" loading={moverMut.isPending}>
            Salvar etapa
          </Button>
        </form>
      </div>

      {agendarAberto && (
        <NovoCompromissoModal
          diaSelecionado={new Date().toISOString().slice(0, 10)}
          vendedorId={card.vendedorId}
          clienteIdFixo={card.clienteId}
          clienteNomeFixo={card.razaoSocial}
          onClose={() => setAgendarAberto(false)}
          onCriado={() => {
            invalidarTudo()
            setAgendarAberto(false)
          }}
        />
      )}
    </Modal>
  )
}

// Mostrado no topo do modal do card — pensado pra clientes importados sem
// CNPJ/e-mail/cidade preenchidos (boa parte da carteira real), pro vendedor
// completar o cadastro sem sair do Kanban.
function ClienteInfoEditavel({ card }: { card: Card }) {
  const { user } = useAuth()
  const utils = trpc.useUtils()
  const [editando, setEditando] = useState(false)
  const [cnpj, setCnpj] = useState(card.cnpj ?? '')
  const [inscricaoEstadual, setInscricaoEstadual] = useState(card.inscricaoEstadual ?? '')
  const [cidade, setCidade] = useState(card.cidade ?? '')
  const [estado, setEstado] = useState(card.estado ?? '')
  const [telefoneWhatsapp, setTelefoneWhatsapp] = useState(card.telefoneWhatsapp ?? '')
  const [email, setEmail] = useState(card.email ?? '')
  const [nomeContato, setNomeContato] = useState(card.nomeContato ?? '')
  const [statusFiscal, setStatusFiscal] = useState(card.statusFiscal ?? '')
  const [observacoes, setObservacoes] = useState(card.observacoes ?? '')

  const atualizarMut = trpc.clientes.update.useMutation({
    onSuccess() {
      toast.success('Dados do cliente atualizados')
      utils.funil.meuFunil.invalidate()
      utils.funil.funilPorVendedor.invalidate()
      setEditando(false)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const faltandoAlgo = !card.cnpj || !card.email || !card.cidade || !card.estado || !card.inscricaoEstadual || !card.nomeContato

  if (!editando) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-dark-100">Dados do cliente</h3>
          <button onClick={() => setEditando(true)} className="text-xs text-gold-400 hover:underline">
            {faltandoAlgo ? 'Completar cadastro →' : 'Editar'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
          <p className="text-dark-500">
            Código: <span className="text-dark-300">{card.codigo}</span>
          </p>
          <p className="text-dark-500">
            CNPJ: <span className={card.cnpj ? 'text-dark-300' : 'text-amber-400'}>{card.cnpj ?? 'não informado'}</span>
          </p>
          <p className="text-dark-500">
            Cidade/UF:{' '}
            <span className={card.cidade ? 'text-dark-300' : 'text-amber-400'}>
              {card.cidade ? `${card.cidade}/${card.estado ?? '?'}` : 'não informado'}
            </span>
          </p>
          <p className="text-dark-500">
            Insc. Estadual: <span className={card.inscricaoEstadual ? 'text-dark-300' : 'text-amber-400'}>{card.inscricaoEstadual ?? 'não informado'}</span>
          </p>
          <p className="text-dark-500">
            Telefone: <span className={card.telefoneWhatsapp ? 'text-dark-300' : 'text-amber-400'}>{card.telefoneWhatsapp ?? 'não informado'}</span>
          </p>
          <p className="text-dark-500">
            E-mail: <span className={card.email ? 'text-dark-300' : 'text-amber-400'}>{card.email ?? 'não informado'}</span>
          </p>
          <p className="text-dark-500">
            Nome do contato: <span className={card.nomeContato ? 'text-dark-300' : 'text-amber-400'}>{card.nomeContato ?? 'não informado'}</span>
          </p>
          <p className="text-dark-500">
            Status fiscal:{' '}
            <span className={card.statusFiscal ? 'text-dark-300' : 'text-amber-400'}>
              {card.statusFiscal === 'isento'
                ? 'Isento'
                : card.statusFiscal === 'normal'
                ? 'Normal'
                : card.statusFiscal === 'consumidor_final'
                ? 'Consumidor Final'
                : 'não informado'}
            </span>
          </p>
        </div>
        {card.observacoes && (
          <p className="text-xs text-dark-500 mt-2 whitespace-pre-wrap">
            <span className="font-medium text-dark-400">Anotações: </span>
            {card.observacoes}
          </p>
        )}
        {!!card.telefonesExtras.length && (
          <p className="text-xs text-dark-500 mt-1">
            Outros telefones:{' '}
            <span className="text-dark-300">
              {card.telefonesExtras.map((t) => t.rotulo ? `${t.numero} (${t.rotulo})` : t.numero).join(', ')}
            </span>
          </p>
        )}
        {!!card.emailsExtras.length && (
          <p className="text-xs text-dark-500 mt-1">
            Outros e-mails:{' '}
            <span className="text-dark-300">
              {card.emailsExtras.map((e) => e.rotulo ? `${e.email} (${e.rotulo})` : e.email).join(', ')}
            </span>
          </p>
        )}
        {!!card.clientesVinculados.length && (
          <div className="mt-2 text-xs bg-amber-900/10 border border-amber-700/30 rounded-lg px-3 py-2 space-y-1">
            <p className="text-amber-400 font-medium">🔗 Este cliente tem outro(s) CNPJ vinculado(s):</p>
            {card.clientesVinculados.map((v) => (
              <p key={v.id} className="text-dark-300">
                {v.razaoSocial} — Cód. {v.codigo}
                {v.cnpj ? ` · CNPJ ${v.cnpj}` : ' · sem CNPJ cadastrado'}
              </p>
            ))}
            <p className="text-dark-500">Confira qual CNPJ usar antes de fechar o pedido.</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        atualizarMut.mutate({
          id: card.clienteId,
          versao: card.clienteVersao,
          cnpj: cnpj || undefined,
          inscricaoEstadual: inscricaoEstadual || undefined,
          cidade: cidade || undefined,
          estado: estado || undefined,
          telefoneWhatsapp: telefoneWhatsapp || undefined,
          email: email || undefined,
          nomeContato: nomeContato || undefined,
          statusFiscal: (statusFiscal || undefined) as 'isento' | 'normal' | 'consumidor_final' | undefined,
          observacoes: observacoes || undefined,
        })
      }}
      className="space-y-2"
    >
      <h3 className="text-sm font-semibold text-dark-100">Completar dados do cliente</h3>
      <div className="grid grid-cols-2 gap-2">
        <Input label="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
        <Input label="Inscrição Estadual" value={inscricaoEstadual} onChange={(e) => setInscricaoEstadual(e.target.value)} />
        <Input label="Cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} />
        <Input label="Estado (UF)" value={estado} onChange={(e) => setEstado(e.target.value.toUpperCase())} maxLength={2} />
        <Input label="Telefone/WhatsApp" value={telefoneWhatsapp} onChange={(e) => setTelefoneWhatsapp(e.target.value)} />
        <Input label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
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
      </div>
      <Textarea
        label="Anotações sobre o cliente"
        rows={2}
        value={observacoes}
        onChange={(e) => setObservacoes(e.target.value)}
        placeholder="Contexto livre — indicação, preferências, histórico relevante..."
      />
      <TelefonesExtras
        clienteId={card.clienteId}
        telefones={card.telefonesExtras}
        onChanged={() => {
          utils.funil.meuFunil.invalidate()
          utils.funil.funilPorVendedor.invalidate()
        }}
      />
      <EmailsExtras
        clienteId={card.clienteId}
        emails={card.emailsExtras}
        onChanged={() => {
          utils.funil.meuFunil.invalidate()
          utils.funil.funilPorVendedor.invalidate()
        }}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={atualizarMut.isPending}>
          Salvar
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditando(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

// Vendedor pede pro admin descartar (excluir) ou transferir esse cliente da
// própria carteira — fica pendente até alguém aprovar/recusar na aba de
// Aprovações (o card continua normal aqui, só ganha essa etiqueta).
function SolicitarAcaoCarteira({ card }: { card: Card }) {
  const utils = trpc.useUtils()
  const [aberto, setAberto] = useState<'descartar' | 'transferir' | null>(null)
  const [motivo, setMotivo] = useState('')
  const [comprovante, setComprovante] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)

  function invalidar() {
    utils.funil.meuFunil.invalidate()
    utils.funil.funilPorVendedor.invalidate()
  }

  const solicitarMut = trpc.aprovacoes.solicitar.useMutation({
    onSuccess() {
      toast.success('Pedido enviado pro admin aprovar.')
      setAberto(null)
      setMotivo('')
      setComprovante(null)
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!aberto) return
    if (!motivo.trim()) return toast.error('Explique o motivo do pedido.')
    if (aberto === 'descartar' && !comprovante) return toast.error('Anexe o print/imagem comprovando o motivo.')

    setEnviando(true)
    try {
      let comprovantePath: string | undefined
      if (aberto === 'descartar' && comprovante) {
        const token = localStorage.getItem('odin_token')
        const form = new FormData()
        form.append('file', comprovante)
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
        comprovantePath = data.path
      }
      solicitarMut.mutate({ clienteId: card.clienteId, tipo: aberto, motivo: motivo.trim(), comprovantePath })
    } finally {
      setEnviando(false)
    }
  }

  if (card.pedidoPendente) {
    return (
      <div className="text-xs text-amber-400 bg-amber-900/10 border border-amber-700/30 rounded-xl px-3 py-2">
        ⏳ Pedido de {card.pedidoPendente === 'descartar' ? 'descarte' : 'transferência de carteira'} pendente de aprovação.
      </div>
    )
  }

  if (!aberto) {
    return (
      <div className="flex gap-3">
        <button type="button" onClick={() => setAberto('transferir')} className="text-xs text-dark-400 hover:text-gold-400 hover:underline">
          Pedir transferência de carteira
        </button>
        <button type="button" onClick={() => setAberto('descartar')} className="text-xs text-dark-400 hover:text-red-400 hover:underline">
          Pedir descarte deste cliente
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 bg-dark-900/40 border border-dark-700 rounded-xl p-3">
      <h4 className="text-sm font-semibold text-dark-100">
        {aberto === 'descartar' ? 'Pedir descarte deste cliente' : 'Pedir transferência de carteira'}
      </h4>
      <Textarea label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} required />
      {aberto === 'descartar' && (
        <div>
          <label className="text-xs text-dark-400 mb-1 block">Comprovante (print/imagem) *</label>
          <input type="file" accept="image/*" onChange={(e) => setComprovante(e.target.files?.[0] ?? null)} className="text-xs text-dark-300" />
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={solicitarMut.isPending || enviando}>
          Enviar pedido
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setAberto(null)}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

interface VariaveisMensagem {
  nome: string
  cidade?: string | null
  diasSemContato?: number | null
  ultimoContato?: string | null
}

function interpolarMensagem(texto: string, vars: VariaveisMensagem): string {
  return texto
    .replaceAll('{{nome}}', vars.nome)
    .replaceAll('{{cidade}}', vars.cidade || 'sua região')
    .replaceAll('{{dias_sem_contato}}', vars.diasSemContato != null ? String(vars.diasSemContato) : '—')
    .replaceAll('{{ultimo_contato}}', vars.ultimoContato ?? 'ainda não tivemos contato')
}

// Deixa o vendedor escolher um dos modelos cadastrados em
// /admin/mensagens antes de abrir o WhatsApp/e-mail — o texto já sai com o
// nome do cliente (e cidade/dias sem contato/último contato) interpolados,
// junto dos próprios botões de envio.
function SugestaoMensagem({
  nome,
  telefone,
  email,
  clienteId,
  funilMensalId,
  cidade,
  diasSemContato,
  ultimoContato,
}: {
  nome: string
  telefone?: string | null
  email?: string | null
  clienteId: number
  funilMensalId?: number
  cidade?: string | null
  diasSemContato?: number | null
  ultimoContato?: string | null
}) {
  const { data: templates = [] } = trpc.messageTemplates.list.useQuery()
  const [selecionadoId, setSelecionadoId] = useState('')
  const selecionado = templates.find((t) => String(t.id) === selecionadoId)
  const vars: VariaveisMensagem = { nome, cidade, diasSemContato, ultimoContato }

  if (!templates.length) return null

  return (
    <div className="border-t border-dark-700 pt-4 space-y-2">
      <h3 className="text-sm font-semibold text-dark-100">💬 Sugestão de mensagem</h3>
      <Select
        value={selecionadoId}
        onChange={(e) => setSelecionadoId(e.target.value)}
        placeholder="Escolher modelo..."
        options={templates.map((t) => ({ value: String(t.id), label: t.label }))}
      />
      {selecionado && (
        <div className="bg-dark-900/50 rounded-lg p-3 space-y-2">
          <p className="text-xs text-dark-300 whitespace-pre-wrap">{interpolarMensagem(selecionado.whatsappText, vars)}</p>
          <div className="flex items-center gap-2">
            {telefone && (
              <WhatsappButton telefone={telefone} clienteId={clienteId} funilMensalId={funilMensalId} mensagem={interpolarMensagem(selecionado.whatsappText, vars)} size="md" />
            )}
            {email && (
              <EmailButton
                email={email}
                size="md"
                subject={interpolarMensagem(selecionado.emailSubject, vars)}
                body={interpolarMensagem(selecionado.emailBody, vars)}
              />
            )}
            {!telefone && !email && <p className="text-xs text-dark-500">Cliente sem telefone/e-mail cadastrado.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function ContatoItem({
  contato,
  onEditar,
  onExcluir,
}: {
  contato: Card['contatos'][number]
  onEditar: (observacao: string, resultado?: string) => void
  onExcluir: () => void
}) {
  const [editando, setEditando] = useState(false)
  const [observacao, setObservacao] = useState(contato.observacao)
  const [resultado, setResultado] = useState(contato.resultado ?? '')

  const dataFormatada = new Date(contato.dataHora.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })

  if (editando) {
    return (
      <div className="rounded-lg border border-dark-600 p-2 text-sm space-y-2">
        <Select
          value={resultado}
          onChange={(e) => setResultado(e.target.value)}
          placeholder="Resultado (opcional)"
          options={[
            { value: 'respondeu', label: 'Respondeu' },
            { value: 'nao_respondeu', label: 'Não respondeu' },
            { value: 'numero_errado', label: 'Número errado' },
            { value: 'caixa_postal', label: 'Caixa postal' },
          ]}
        />
        <Textarea rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              onEditar(observacao, resultado || undefined)
              setEditando(false)
            }}
          >
            Salvar
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditando(false)}>
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-dark-700 p-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-dark-400">
          {TIPO_ICONE[contato.tipo]} {TIPO_LABEL[contato.tipo]}
          {contato.resultado ? ` · ${RESULTADO_LABEL[contato.resultado]}` : ' · ⏳ aguardando confirmação'} · {dataFormatada}
        </p>
        {contato.editavel && (
          <div className="flex shrink-0 gap-2 text-xs">
            <button onClick={() => setEditando(true)} className="text-dark-400 hover:text-dark-100">
              Editar
            </button>
            <button onClick={onExcluir} className="text-red-400 hover:text-red-300">
              Excluir
            </button>
          </div>
        )}
      </div>
      <p className="text-dark-100">{contato.observacao}</p>
    </div>
  )
}
