// Coluna "Agendamentos" do Kanban (Odin Compressores, entre Novo e
// Abordagem) — pedido do João, 2026-10-29. Cada card é um Agendamento de
// peças que nasceu de um pedido de máquina concluído: NF, modelos/séries,
// revenda e as datas de contato pra oferecer peças da preventiva. Não é um
// card do funil (não arrasta): abre o próprio modal.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { CalendarClock, FileText, MessageCircle, Phone, Store, Wrench } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import Select from '../ui/Select'
import { AvatarIniciais } from '../ui/Visual'
import { Estrelas } from '../posVenda/FormPesquisa'
import PassoAPasso from '../posVenda/PassoAPasso'

const COR = '#a855f7'

const TIPO_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', ligacao: 'Ligação', email: 'E-mail', visita: 'Visita', outro: 'Outro' }
const RESULTADO_LABEL: Record<string, string> = { venda: 'Vendeu peça', revenda: 'Encaminhado para a revenda', sem_interesse: 'Sem interesse', outro: 'Outro' }

function hojeBr() {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
}
const dataBr = (d: string | null) => (d ? d.split('-').reverse().join('/') : '')
const dataHoraBr = (v: string) => new Date(v.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

function BadgeData({ data }: { data: string | null }) {
  if (!data) return <span className="text-[11px] text-dark-500">Sem data marcada</span>
  const hoje = hojeBr()
  const cls = data < hoje ? 'bg-red-900/20 border-red-700/40 text-red-300' : data === hoje ? 'bg-gold-900/20 border-gold-600/40 text-gold-300' : 'bg-blue-900/20 border-blue-700/40 text-blue-300'
  const texto = data < hoje ? `Atrasado · era ${dataBr(data)}` : data === hoje ? 'Hoje' : dataBr(data)
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-lg px-2 py-0.5 border ${cls}`}>
      <CalendarClock size={12} /> {texto}
    </span>
  )
}

export default function ColunaAgendamentosPecas({ vendedorId, todos, busca }: { vendedorId?: number; todos?: boolean; busca: string }) {
  const { data } = trpc.posVendaOdin.agendamentosListar.useQuery({ vendedorId, todos })
  const [abertoId, setAbertoId] = useState<number | null>(null)
  if (!data?.mostrar) return null
  const itens = busca ? data.itens.filter((a) => a.clienteNome.toLowerCase().includes(busca) || a.modelos.some((m) => m.toLowerCase().includes(busca))) : data.itens
  const atrasados = itens.filter((a) => a.proximoContato && a.proximoContato < hojeBr()).length

  return (
    <div className="shrink-0 w-72">
      <div className="flex items-center gap-2 mb-3 rounded-xl bg-dark-800/70 border border-dark-700 px-3 py-2 border-t-[3px]" style={{ borderTopColor: COR }}>
        <span className="text-sm font-semibold text-dark-100">Agendamentos</span>
        <span className="text-[11px] font-semibold text-dark-300 bg-dark-700 rounded-full px-2 py-0.5">{itens.length}</span>
        {atrasados > 0 && <span className="ml-auto text-[11px] font-medium text-red-300">{atrasados} atrasado{atrasados > 1 ? 's' : ''}</span>}
      </div>
      <div className="space-y-2">
        {itens.map((a) => (
          <div
            key={a.id}
            onClick={() => setAbertoId(a.id)}
            className="bg-dark-800 border border-dark-600 border-l-4 rounded-xl p-3 cursor-pointer hover:border-gold-600/50 hover:-translate-y-0.5 transition-all"
            style={{ borderLeftColor: COR }}
          >
            <div className="flex items-start gap-2 mb-1.5">
              <AvatarIniciais nome={a.clienteNome} tamanho={30} />
              <div className="pt-0.5 min-w-0">
                <p className="text-sm font-medium text-dark-100 leading-tight">{a.clienteNome}</p>
                {todos && a.vendedorNome && <p className="text-[11px] text-dark-500 leading-tight">👤 {a.vendedorNome}</p>}
              </div>
            </div>
            <BadgeData data={a.proximoContato} />
            {a.modelos.length > 0 && (
              <p className="text-xs text-dark-300 mt-1.5 flex items-center gap-1"><Wrench size={12} className="text-dark-500" /> {a.modelos.join(', ')}</p>
            )}
            {a.revendaNome && <p className="text-xs text-dark-400 mt-0.5 flex items-center gap-1"><Store size={12} className="text-dark-500" /> {a.revendaNome}</p>}
            {a.ultimoContato && <p className="text-xs text-dark-500 mt-1.5 line-clamp-2">Último contato: {a.ultimoContato.observacao}</p>}
          </div>
        ))}
        {itens.length === 0 && (
          <div className="h-20 border-2 border-dashed border-dark-700 rounded-xl flex items-center justify-center text-dark-600 text-xs text-center px-3">
            Vazio — entra sozinho quando um pedido de máquina é concluído
          </div>
        )}
      </div>
      {abertoId && <ModalAgendamento id={abertoId} onClose={() => setAbertoId(null)} />}
    </div>
  )
}

function ModalAgendamento({ id, onClose }: { id: number; onClose: () => void }) {
  const { user } = useAuth()
  const utils = trpc.useUtils()
  const { data: ag, isLoading } = trpc.posVendaOdin.agendamentoObter.useQuery({ id })
  const [tipo, setTipo] = useState('whatsapp')
  const [obs, setObs] = useState('')
  const [encaminhamento, setEncaminhamento] = useState('')
  const [proximo, setProximo] = useState('')
  const [concluindo, setConcluindo] = useState(false)
  const [resultado, setResultado] = useState('')
  const [obsFinal, setObsFinal] = useState('')

  const invalidar = () => {
    utils.posVendaOdin.agendamentoObter.invalidate({ id })
    utils.posVendaOdin.agendamentosListar.invalidate()
  }
  const contatoMut = trpc.posVendaOdin.agendamentoRegistrarContato.useMutation({
    onSuccess: () => {
      toast.success('Contato registrado')
      setObs('')
      setEncaminhamento('')
      setProximo('')
      invalidar()
    },
    onError: (e) => toast.error(e.message),
  })
  const atualizarMut = trpc.posVendaOdin.agendamentoAtualizar.useMutation({ onSuccess: () => { toast.success('Data atualizada'); invalidar() }, onError: (e) => toast.error(e.message) })
  const concluirMut = trpc.posVendaOdin.agendamentoConcluir.useMutation({
    onSuccess: () => {
      toast.success('Agendamento concluído')
      invalidar()
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'
  const whats = ag?.cliente?.telefoneWhatsapp?.replace(/\D/g, '')
  const whatsRevenda = ag?.revenda?.telefoneContato?.replace(/\D/g, '')

  return (
    <Modal open onClose={onClose} title={ag?.cliente?.razaoSocial ?? 'Agendamento de peças'} size="lg">
      {isLoading || !ag ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <div className="space-y-4">
          <PassoAPasso
            chave="agendamento_pecas"
            titulo="Como funciona o Agendamento de peças"
            explicacao="Este cliente comprou uma máquina. Aqui você acompanha ele para oferecer as peças da manutenção preventiva, no tempo certo."
            passos={[
              <>Veja os <b>equipamentos vendidos</b> (modelo e número de série) e abra a <b>NF</b> se precisar conferir algo.</>,
              <>Veja qual <b>revenda</b> atende o cliente (já vem do pedido). Se a peça for pela revenda, fale com ela pelo botão do WhatsApp.</>,
              <>Preencha <b>Dados do agendamento</b>: revenda (se precisar trocar), venda de peça, data da 1ª preventiva e lembrete. Clique em <b>Salvar dados</b>. A data nova de preventiva (ou do lembrete) vira o próximo contato.</>,
              <>Na data marcada, entre em contato com o cliente (o card fica <b>vermelho</b> quando a data passou e <b>amarelo</b> no dia).</>,
              <>Depois de falar, preencha <b>Registrar contato</b>: como foi, o que conversou, o próximo passo e a <b>data do próximo contato</b>. Clique em <b>Salvar contato</b>.</>,
              <>Quando o assunto terminar, clique em <b>Concluir agendamento</b> e diga como terminou (vendeu peça, foi para a revenda, sem interesse).</>,
            ]}
            dicas={[
              'O card sai da coluna "Agendamentos" quando é concluído.',
              'Para só mudar a data, use "Mudar só a data do próximo contato".',
              'A pesquisa de satisfação do cliente aparece aqui: se a nota foi baixa, vale ter cuidado na conversa.',
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <BadgeData data={ag.proximoContato} />
            {ag.vendedor && <span className="text-xs text-dark-400">Responsável: {ag.vendedor.name}</span>}
            {whats && (
              <a href={`https://wa.me/${whats.length <= 11 ? `55${whats}` : whats}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-green-400 hover:underline">
                <MessageCircle size={13} /> WhatsApp do cliente
              </a>
            )}
            {ag.cliente?.cidade && <span className="text-xs text-dark-500">{ag.cliente.cidade}/{ag.cliente.estado}</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border border-dark-700 bg-dark-900/40">
              <p className="text-[11px] text-dark-500 uppercase tracking-wide mb-1">Venda da máquina</p>
              {ag.ordem ? (
                <>
                  <a href={`${basePath}/ordens/${ag.ordem.id}`} className="text-sm text-blue-400 hover:underline">
                    Pedido #{ag.ordem.id}
                    {ag.ordem.detalhes?.numeroPedido ? ` · Nº ${ag.ordem.detalhes.numeroPedido}` : ''}
                  </a>
                  <p className="text-xs text-dark-300 mt-1">
                    NF {ag.ordem.faturamento?.numeroNotaFiscal ?? '—'}
                    {ag.ordem.faturamento?.dataFaturamento ? ` · faturada em ${dataBr(ag.ordem.faturamento.dataFaturamento.slice(0, 10))}` : ''}
                  </p>
                  {ag.notasFiscais.map((n) => (
                    <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-blue-400 hover:underline mt-1">
                      <FileText size={12} /> {n.nome}
                    </a>
                  ))}
                  {ag.notasFiscais.length === 0 && <p className="text-xs text-amber-400 mt-1">NF não anexada no pedido</p>}
                </>
              ) : (
                <p className="text-sm text-dark-400">—</p>
              )}
            </div>
            <div className="p-3 rounded-lg border border-dark-700 bg-dark-900/40">
              <p className="text-[11px] text-dark-500 uppercase tracking-wide mb-1">Revenda responsável</p>
              {ag.revenda ? (
                <>
                  <p className="text-sm text-dark-200">{ag.revenda.nome}</p>
                  {(ag.revenda.nomeContato || ag.revenda.cidade) && (
                    <p className="text-xs text-dark-400">{[ag.revenda.nomeContato, ag.revenda.cidade && `${ag.revenda.cidade}/${ag.revenda.estado ?? ''}`].filter(Boolean).join(' · ')}</p>
                  )}
                  {whatsRevenda && (
                    <a href={`https://wa.me/${whatsRevenda.length <= 11 ? `55${whatsRevenda}` : whatsRevenda}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-green-400 hover:underline mt-1">
                      <MessageCircle size={12} /> WhatsApp da revenda
                    </a>
                  )}
                </>
              ) : (
                <p className="text-sm text-dark-400">Pedido sem revenda informada — escolha abaixo em Dados do agendamento</p>
              )}
            </div>
          </div>

          <div className="p-3 rounded-lg border border-dark-700 bg-dark-900/40">
            <p className="text-[11px] text-dark-500 uppercase tracking-wide mb-1">Equipamentos vendidos</p>
            {ag.maquinas.length === 0 ? (
              <p className="text-sm text-dark-400">Nenhuma máquina registrada no pedido</p>
            ) : (
              <ul className="text-sm text-dark-200 space-y-0.5">
                {ag.maquinas.map((m, i) => (
                  <li key={i}>
                    {m.modelo} <span className="text-dark-500">· série {m.numeroSerie || 'não informada'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DadosAgendamento
            key={`${ag.id}-${ag.updatedAt}`}
            id={id}
            aberto={ag.status === 'aberto'}
            revendaId={ag.revendaId}
            revendas={ag.revendasOpcoes}
            posVenda={ag.ordem?.posVenda ?? null}
            observacoes={ag.observacoes}
            onSalvo={invalidar}
          />

          {ag.pesquisa && (
            <div className="p-3 rounded-lg border border-dark-700 bg-dark-900/40 text-xs text-dark-300 flex flex-wrap gap-x-4 gap-y-1 items-center">
              <span className="text-[11px] text-dark-500 uppercase tracking-wide w-full">Pesquisa do pós-venda</span>
              <span>Odin <Estrelas nota={ag.pesquisa.notaOdin} tamanho={11} /></span>
              <span>Entrega <Estrelas nota={ag.pesquisa.notaTransportadora} tamanho={11} /></span>
              <span>Técnico <Estrelas nota={ag.pesquisa.notaTecnico} tamanho={11} /></span>
              {ag.pesquisa.comentario && <span className="w-full text-dark-400">“{ag.pesquisa.comentario}”</span>}
            </div>
          )}

          {ag.status === 'aberto' && (
            <div className="p-3 rounded-lg border border-dark-700 space-y-3">
              <p className="text-sm font-semibold text-dark-100 flex items-center gap-2"><Phone size={14} className="text-gold-400" /> Registrar contato</p>
              <div className="grid grid-cols-2 gap-2">
                <Select label="Como" value={tipo} onChange={(e) => setTipo(e.target.value)} options={Object.entries(TIPO_LABEL).map(([value, label]) => ({ value, label }))} />
                <Input label="Próximo contato (opcional)" type="date" value={proximo} onChange={(e) => setProximo(e.target.value)} />
              </div>
              <Textarea label="O que foi conversado" value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
              <Input label="Encaminhamento (opcional)" value={encaminhamento} onChange={(e) => setEncaminhamento(e.target.value)} placeholder="Ex.: mandar orçamento do kit de filtros" />
              <Button
                size="sm"
                disabled={!obs.trim()}
                loading={contatoMut.isPending}
                onClick={() => contatoMut.mutate({ id, tipo: tipo as 'whatsapp', observacao: obs, encaminhamento: encaminhamento || undefined, proximoContato: proximo || undefined })}
              >
                Salvar contato
              </Button>
              <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-dark-700">
                <Input label="Mudar só a data do próximo contato" type="date" defaultValue={ag.proximoContato ?? ''} onBlur={(e) => e.target.value && e.target.value !== ag.proximoContato && atualizarMut.mutate({ id, proximoContato: e.target.value })} />
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-semibold text-dark-100 mb-2">Histórico de contatos</p>
            {ag.contatos.length === 0 ? (
              <p className="text-sm text-dark-500">Nenhum contato registrado ainda.</p>
            ) : (
              <div className="space-y-2">
                {ag.contatos.map((c) => (
                  <div key={c.id} className="rounded-lg bg-dark-900/60 px-3 py-2">
                    <p className="text-[11px] text-dark-500">
                      {dataHoraBr(c.createdAt)} · {TIPO_LABEL[c.tipo] ?? c.tipo} · {c.user?.name ?? '—'}
                    </p>
                    <p className="text-sm text-dark-200 whitespace-pre-wrap">{c.observacao}</p>
                    {c.encaminhamento && <p className="text-xs text-gold-300 mt-0.5">➜ {c.encaminhamento}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {ag.status === 'aberto' ? (
            concluindo ? (
              <div className="p-3 rounded-lg border border-dark-700 space-y-2">
                <Select label="Como terminou?" value={resultado} onChange={(e) => setResultado(e.target.value)} placeholder="Escolha" options={Object.entries(RESULTADO_LABEL).map(([value, label]) => ({ value, label }))} />
                <Textarea label="Observação (opcional)" value={obsFinal} onChange={(e) => setObsFinal(e.target.value)} rows={2} />
                <div className="flex gap-2">
                  <Button size="sm" disabled={!resultado} loading={concluirMut.isPending} onClick={() => concluirMut.mutate({ id, resultado: resultado as 'venda', observacao: obsFinal || undefined })}>
                    Concluir agendamento
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConcluindo(false)}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setConcluindo(true)}>Concluir agendamento</Button>
            )
          ) : (
            <p className="text-sm text-dark-400">Concluído: {ag.resultado ? RESULTADO_LABEL[ag.resultado] : '—'}</p>
          )}
        </div>
      )}
    </Modal>
  )
}

// Venda de peça, 1ª preventiva e lembrete — preenchidos pela Bruna aqui no
// card (antes era a parte 5 do Pós-venda do pedido; João, 2026-10-29).
function DadosAgendamento({
  id,
  aberto,
  revendaId,
  revendas,
  posVenda,
  observacoes,
  onSalvo,
}: {
  id: number
  aberto: boolean
  revendaId: number | null
  revendas: { id: number; nome: string }[]
  posVenda: { vendaPeca: boolean; primeiraPreventiva: string | null; dataLembrete: string | null; notaLembrete: string | null } | null
  observacoes: string | null
  onSalvo: () => void
}) {
  const [revenda, setRevenda] = useState(revendaId ? String(revendaId) : '')
  const [vendaPeca, setVendaPeca] = useState(posVenda?.vendaPeca ?? false)
  const [preventiva, setPreventiva] = useState(posVenda?.primeiraPreventiva ?? '')
  const [dataLembrete, setDataLembrete] = useState(posVenda?.dataLembrete ?? '')
  const [notaLembrete, setNotaLembrete] = useState(posVenda?.notaLembrete ?? '')
  const salvarMut = trpc.posVendaOdin.agendamentoSalvarDados.useMutation({
    onSuccess: (r) => {
      toast.success(r.proximoContato ? `Dados salvos — próximo contato ${dataBr(r.proximoContato)}` : 'Dados salvos')
      onSalvo()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="p-3 rounded-lg border border-gold-600/30 bg-gold-900/10 space-y-3">
      <p className="text-sm font-semibold text-dark-100">Dados do agendamento</p>
      {observacoes && <p className="text-xs text-dark-400 whitespace-pre-line">{observacoes}</p>}
      <Select
        label="Revenda"
        value={revenda}
        onChange={(e) => setRevenda(e.target.value)}
        disabled={!aberto}
        options={[{ value: '', label: 'Sem revenda' }, ...revendas.map((r) => ({ value: String(r.id), label: r.nome }))]}
      />
      <label className="flex items-center gap-2 text-sm text-dark-200">
        <input type="checkbox" checked={vendaPeca} disabled={!aberto} onChange={(e) => setVendaPeca(e.target.checked)} /> Venda de Peça
      </label>
      <Input label="Data da primeira preventiva" type="date" value={preventiva} onChange={(e) => setPreventiva(e.target.value)} disabled={!aberto} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Input label="Lembrete — data" type="date" value={dataLembrete} onChange={(e) => setDataLembrete(e.target.value)} disabled={!aberto} />
        <Input label="Lembrete — nota" value={notaLembrete} onChange={(e) => setNotaLembrete(e.target.value)} disabled={!aberto} placeholder="Ex.: trocar filtro de ar" />
      </div>
      {aberto && (
        <Button
          size="sm"
          loading={salvarMut.isPending}
          onClick={() =>
            salvarMut.mutate({ id, revendaId: revenda ? Number(revenda) : null, vendaPeca, primeiraPreventiva: preventiva || null, dataLembrete: dataLembrete || null, notaLembrete })
          }
        >
          Salvar dados
        </Button>
      )}
    </div>
  )
}
