// Coluna "Pós-venda" do Kanban da Compretec Loja Física (antes de Perdido) —
// pedido do João, 2026-11-27: loja de varejo vende compressor pistão/parafuso
// e o cliente não volta a comprar sozinho, então o vendedor marca a
// manutenção. Cada item é um compressor vendido: 1º contato 30 dias depois da
// venda; depois, cada nova compra do cliente marca o próximo para +90 dias.
// Não é card do funil (a venda continua em Fechado/Faturamento).
import { useState } from 'react'
import toast from 'react-hot-toast'
import { CalendarClock, MessageCircle, Wrench } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import Select from '../ui/Select'
import { AvatarIniciais } from '../ui/Visual'

const COR = '#14b8a6'
const TIPOS = [
  { value: 'pistao', label: 'Pistão' },
  { value: 'parafuso', label: 'Parafuso' },
  { value: 'outro', label: 'Outro' },
]
const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.value, t.label]))
const CONTATO = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'ligacao', label: 'Ligação' },
  { value: 'visita', label: 'Visita' },
  { value: 'outro', label: 'Outro' },
]
const MOTIVO: Record<string, string> = { venda_maquina: '30 dias da venda', nova_compra: '90 dias da última compra', contato: 'marcado no último contato', manual: 'data escolhida' }

const hojeBr = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
const somarDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const dataBr = (d: string | null | undefined) => (d ? d.split('-').reverse().join('/') : '')

function BadgeData({ data }: { data: string | null }) {
  if (!data) return <span className="text-[11px] text-dark-500">Sem data marcada</span>
  const hoje = hojeBr()
  const cls = data < hoje ? 'bg-red-900/20 border-red-700/40 text-red-300' : data === hoje ? 'bg-gold-900/20 border-gold-600/40 text-gold-300' : 'bg-blue-900/20 border-blue-700/40 text-blue-300'
  const texto = data < hoje ? `Atrasado · era ${dataBr(data)}` : data === hoje ? 'Ligar hoje' : `Contato em ${dataBr(data)}`
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-lg px-2 py-0.5 border ${cls}`}>
      <CalendarClock size={12} /> {texto}
    </span>
  )
}

export default function ColunaPosVendaLoja({ vendedorId, todos, busca }: { vendedorId?: number; todos?: boolean; busca: string }) {
  const { data } = trpc.posVendaLoja.listar.useQuery({ vendedorId, todos })
  const [abertoId, setAbertoId] = useState<number | null>(null)
  if (!data?.mostrar) return null
  const itens = busca ? data.itens.filter((m) => m.clienteNome.toLowerCase().includes(busca) || m.modelo.toLowerCase().includes(busca) || (m.numeroSerie ?? '').toLowerCase().includes(busca)) : data.itens
  const hoje = hojeBr()
  const praLigar = itens.filter((m) => m.proximoContato && m.proximoContato <= hoje).length

  return (
    <div className="shrink-0 w-72">
      <div className="flex items-center gap-2 mb-3 rounded-xl bg-dark-800/70 border border-dark-700 px-3 py-2 border-t-[3px]" style={{ borderTopColor: COR }}>
        <span className="text-sm font-semibold text-dark-100">Pós-venda</span>
        <span className="text-[11px] font-semibold text-dark-300 bg-dark-700 rounded-full px-2 py-0.5">{itens.length}</span>
        {praLigar > 0 && <span className="ml-auto text-[11px] font-medium text-red-300">{praLigar} pra ligar</span>}
      </div>
      <div className="space-y-2">
        {itens.map((m) => (
          <div
            key={m.id}
            onClick={() => setAbertoId(m.id)}
            className="bg-dark-800 border border-dark-600 border-l-4 rounded-xl p-3 cursor-pointer hover:border-gold-600/50 hover:-translate-y-0.5 transition-all"
            style={{ borderLeftColor: COR }}
          >
            <div className="flex items-start gap-2 mb-1.5">
              <AvatarIniciais nome={m.clienteNome} tamanho={30} />
              <div className="pt-0.5 min-w-0">
                <p className="text-sm font-medium text-dark-100 leading-tight">{m.clienteNome}</p>
                {todos && m.vendedorNome && <p className="text-[11px] text-dark-500 leading-tight">👤 {m.vendedorNome}</p>}
              </div>
            </div>
            <BadgeData data={m.proximoContato} />
            <p className="text-xs text-dark-300 mt-1.5 flex items-center gap-1">
              <Wrench size={12} className="text-dark-500" /> {TIPO_LABEL[m.tipo]} · {m.modelo}
            </p>
            <p className="text-[11px] text-dark-500 mt-0.5">Vendido em {dataBr(m.dataVenda)}{m.primeiroContato ? ' · 1º contato' : ''}</p>
            {m.ultimoContato && <p className="text-xs text-dark-500 mt-1.5 line-clamp-2">Último contato: {m.ultimoContato.observacao}</p>}
          </div>
        ))}
        {itens.length === 0 && (
          <div className="min-h-20 py-3 border-2 border-dashed border-dark-700 rounded-xl flex items-center justify-center text-dark-600 text-xs text-center px-3">
            Vazio — no card vendido (Fechado/Faturamento) clique em “🔧 Cadastrar máquina”
          </div>
        )}
      </div>
      {abertoId && <ModalMaquina id={abertoId} onClose={() => setAbertoId(null)} />}
    </div>
  )
}

function ModalMaquina({ id, onClose }: { id: number; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data: m, isLoading } = trpc.posVendaLoja.obter.useQuery({ id })
  const [tipo, setTipo] = useState('whatsapp')
  const [obs, setObs] = useState('')
  const [proximo, setProximo] = useState(somarDias(hojeBr(), 90))
  const [encerrando, setEncerrando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const invalidar = () => { utils.posVendaLoja.obter.invalidate({ id }); utils.posVendaLoja.listar.invalidate(); utils.funil.invalidate() }
  const contatoMut = trpc.posVendaLoja.registrarContato.useMutation({ onSuccess: () => { toast.success('Contato registrado e próximo agendado'); setObs(''); invalidar() }, onError: (e) => toast.error(e.message) })
  const atualizarMut = trpc.posVendaLoja.atualizar.useMutation({ onSuccess: () => { toast.success('Data atualizada'); invalidar() }, onError: (e) => toast.error(e.message) })
  const encerrarMut = trpc.posVendaLoja.encerrar.useMutation({ onSuccess: () => { toast.success('Pós-venda encerrado'); invalidar(); onClose() }, onError: (e) => toast.error(e.message) })
  const whats = m?.cliente?.telefoneWhatsapp?.replace(/\D/g, '')
  const msg = m ? `Olá${m.cliente?.nomeContato ? `, ${m.cliente.nomeContato.split(' ')[0]}` : ''}! Aqui é da Compretec. Tudo certo com o seu compressor ${m.modelo}? Já está na hora da revisão/manutenção — quer que a gente agende?` : ''

  return (
    <Modal open onClose={onClose} title={m?.cliente?.razaoSocial ?? 'Pós-venda'} size="lg">
      {isLoading || !m ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-dark-900/60 border border-dark-700 p-3 text-sm space-y-1">
            <p className="text-dark-100 font-medium flex items-center gap-1.5"><Wrench size={14} className="text-teal-400" /> Compressor {TIPO_LABEL[m.tipo]?.toLowerCase()} · {m.modelo}{m.numeroSerie ? ` · série ${m.numeroSerie}` : ''}</p>
            <p className="text-dark-400">Vendido em {dataBr(m.dataVenda)}{m.vendedor ? ` · vendedor ${m.vendedor.name}` : ''}{m.cliente?.cidade ? ` · ${m.cliente.cidade}` : ''}</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <BadgeData data={m.proximoContato} />
              {m.baseMotivo && <span className="text-[11px] text-dark-500">({MOTIVO[m.baseMotivo]})</span>}
            </div>
            {m.observacoes && <p className="text-dark-400 text-xs pt-1">{m.observacoes}</p>}
          </div>

          {whats && (
            <a href={`https://wa.me/${whats.length <= 11 ? `55${whats}` : whats}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-600/40 hover:bg-emerald-600/30">
              <MessageCircle size={15} /> Chamar no WhatsApp (mensagem pronta)
            </a>
          )}

          <div className="rounded-xl border border-dark-600 p-3 space-y-3">
            <p className="text-sm font-semibold text-dark-100">Registrar contato</p>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Como" value={tipo} onChange={(e) => setTipo(e.target.value)} options={CONTATO} />
              <Input label="Próximo contato" type="date" value={proximo} onChange={(e) => setProximo(e.target.value)} />
            </div>
            <Textarea label="O que foi conversado" value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Ex.: agendou troca de óleo/filtro para dia 10" />
            <p className="text-[11px] text-dark-500">O próximo já vem em +90 dias. Se o cliente comprar algo (peça, serviço, material), o CRM remarca sozinho para 90 dias depois da compra.</p>
            <Button size="sm" disabled={obs.trim().length < 3 || !proximo} loading={contatoMut.isPending} onClick={() => contatoMut.mutate({ id, tipo: tipo as 'whatsapp', observacao: obs, proximoContato: proximo })}>
              Salvar contato
            </Button>
          </div>

          <Input key={m.proximoContato ?? "sem"} label="Mudar só a data do próximo contato" type="date" defaultValue={m.proximoContato ?? ''} onBlur={(e) => e.target.value && e.target.value !== m.proximoContato && atualizarMut.mutate({ id, proximoContato: e.target.value })} />

          {m.comprasDepois.length > 0 && (
            <div className="text-xs text-dark-400">
              <p className="font-semibold text-dark-300 mb-1">Compras depois da máquina</p>
              {m.comprasDepois.map((v) => <p key={v.id}>{dataBr(v.dia)} · R$ {Number(v.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}{v.numeroPedido ? ` · pedido ${v.numeroPedido}` : ''}</p>)}
            </div>
          )}

          <div>
            <p className="text-sm font-semibold text-dark-100 mb-1">Histórico</p>
            {!m.contatos.length && <p className="text-xs text-dark-500">Nenhum contato ainda — este é o 1º (30 dias depois da venda).</p>}
            <div className="space-y-1.5">
              {m.contatos.map((c) => (
                <div key={c.id} className="text-xs bg-dark-900/50 rounded-lg px-2.5 py-1.5">
                  <span className="text-dark-500">{new Date(c.createdAt.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })} · {CONTATO.find((x) => x.value === c.tipo)?.label}{c.user ? ` · ${c.user.name}` : ''}</span>
                  <p className="text-dark-200">{c.observacao}</p>
                </div>
              ))}
            </div>
          </div>

          {encerrando ? (
            <div className="rounded-xl border border-red-700/40 p-3 space-y-2">
              <Textarea label="Por que encerrar o pós-venda desta máquina?" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ex.: cliente vendeu o compressor / fechou a oficina" />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={motivo.trim().length < 3} loading={encerrarMut.isPending} onClick={() => encerrarMut.mutate({ id, motivo })}>Encerrar</Button>
                <Button size="sm" variant="ghost" onClick={() => setEncerrando(false)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <button onClick={() => setEncerrando(true)} className="text-xs text-dark-500 hover:text-red-300">Encerrar pós-venda desta máquina</button>
          )}
        </div>
      )}
    </Modal>
  )
}

// Aberto pelo botão "🔧 Cadastrar máquina" do card vendido (Fechado/Faturamento).
export function ModalCadastrarMaquina({ clienteId, clienteNome, funilMensalId, venda, onClose }: { clienteId: number; clienteNome: string; funilMensalId?: number; venda?: { id: number; dataFechamento?: string | null }; onClose: () => void }) {
  const utils = trpc.useUtils()
  const jaTem = trpc.posVendaLoja.doCliente.useQuery({ clienteId })
  const diaVenda = venda?.dataFechamento ? new Date(venda.dataFechamento.replace(' ', 'T') + 'Z').toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : hojeBr()
  const [tipo, setTipo] = useState('pistao')
  const [modelo, setModelo] = useState('')
  const [serie, setSerie] = useState('')
  const [dataVenda, setDataVenda] = useState(diaVenda)
  const [proximo, setProximo] = useState(somarDias(diaVenda, 30))
  const [obs, setObs] = useState('')
  const mut = trpc.posVendaLoja.cadastrar.useMutation({
    onSuccess: (r) => { toast.success(`Máquina cadastrada — contato marcado para ${dataBr(r.proximoContato)}`); utils.posVendaLoja.invalidate(); utils.funil.invalidate(); onClose() },
    onError: (e) => toast.error(e.message),
  })
  return (
    <Modal open onClose={onClose} title={`🔧 Compressor vendido — ${clienteNome}`}>
      <div className="space-y-3">
        <p className="text-xs text-dark-400">O CRM marca o 1º contato de pós-venda para <b>30 dias</b> depois da venda (você pode mudar). Ele vai para a coluna <b>Pós-venda</b> e para a sua agenda.</p>
        {(jaTem.data?.length ?? 0) > 0 && (
          <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
            Este cliente já tem: {jaTem.data!.map((x) => `${TIPO_LABEL[x.tipo]} ${x.modelo}${x.status === 'encerrado' ? ' (encerrado)' : ''}`).join(', ')}. Só cadastre de novo se for outra máquina.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Select label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} options={TIPOS} />
          <Input label="Modelo" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Ex.: CSL 10BR / SRP 3010" />
          <Input label="Nº de série (opcional)" value={serie} onChange={(e) => setSerie(e.target.value)} />
          <Input label="Data da venda" type="date" value={dataVenda} onChange={(e) => { setDataVenda(e.target.value); if (e.target.value) setProximo(somarDias(e.target.value, 30)) }} />
          <Input label="1º contato de pós-venda" type="date" value={proximo} onChange={(e) => setProximo(e.target.value)} />
        </div>
        <Textarea label="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Ex.: usa na oficina 8h por dia" />
        <div className="flex gap-2">
          <Button
            disabled={modelo.trim().length < 2 || !dataVenda || !proximo}
            loading={mut.isPending}
            onClick={() => mut.mutate({ clienteId, funilMensalId, vendaId: venda?.id, tipo: tipo as 'pistao', modelo, numeroSerie: serie || undefined, dataVenda, proximoContato: proximo === somarDias(dataVenda, 30) ? undefined : proximo, observacoes: obs || undefined })}
          >
            Salvar e agendar
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </Modal>
  )
}
