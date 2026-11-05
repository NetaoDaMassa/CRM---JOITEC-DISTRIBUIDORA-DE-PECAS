// Prospecção nova (João, 2026-11-05) — Joitec, Odin Tubos, Odin Automação,
// Compretec. Funil do prospect (Novo → Tentando → Conversando → Orçamento →
// Virou cliente / Perdido / Desqualificado), "Meu dia" com próximo contato
// obrigatório, botões Ligar/WhatsApp/E-mail com confirmação (igual card da
// carteira), sugestões do SAP por região e relatório. Servidor:
// server/src/router/prospeccao.ts + lib/prospeccaoNova.ts.
import { useMemo, useState } from 'react'
import { Mail, Phone, Plus, RefreshCw, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { usePersistedState } from '../lib/usePersistedState'
import { Input, Textarea } from '../components/ui/Input'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { soDigitos, usePabxDiscar } from '../components/ui/ContatoButtons'
import { hojeBrString, primeiroDiaMesString, timeAgo } from '../lib/utils'

type Etapa = 'novo' | 'tentando' | 'conversando' | 'orcamento' | 'ganho' | 'perdido' | 'desqualificado'
const ETAPAS: { id: Etapa; nome: string; dica: string }[] = [
  { id: 'novo', nome: 'Novo', dica: 'Ainda não tentou contato' },
  { id: 'tentando', nome: 'Tentando contato', dica: 'Tentou, sem conversa ainda' },
  { id: 'conversando', nome: 'Conversando', dica: 'Já falou com quem decide' },
  { id: 'orcamento', nome: 'Orçamento enviado', dica: 'Esperando resposta' },
  { id: 'ganho', nome: 'Virou cliente', dica: 'Envie pra carteira' },
  { id: 'perdido', nome: 'Perdido', dica: 'Era perfil, não fechou' },
  { id: 'desqualificado', nome: 'Desqualificado', dica: 'Não é perfil pra nós' },
]
const ABERTAS: Etapa[] = ['novo', 'tentando', 'conversando', 'orcamento']
const NOME_ETAPA = Object.fromEntries(ETAPAS.map((e) => [e.id, e.nome])) as Record<Etapa, string>

const ORIGEM_LABEL: Record<string, string> = {
  manual: 'Cadastro manual',
  banco: 'Banco de clientes',
  sap_grupo: 'Cliente do grupo (SAP)',
  sap_parou: 'Parou de comprar (SAP)',
  crm_parou: 'Parou de comprar',
}
const CANAL_LABELS: Record<string, string> = {
  google: 'Google',
  indicacao: 'Indicação',
  redes_sociais: 'Redes sociais',
  porta_a_porta: 'Porta a porta',
  outro: 'Outro',
}
const MOTIVOS_PERDA = ['Sem interesse', 'Já tem fornecedor', 'Preço', 'Prazo de entrega', 'Não consegui contato (5+ tentativas)', 'Outro']
const MOTIVOS_DESQ = ['Não é nosso perfil de cliente', 'Não usa nossos produtos', 'Fora da região que atendemos', 'Telefone/contato inválido', 'Empresa fechou', 'Cadastro duplicado', 'Outro']
const TIPO_LABEL: Record<string, string> = { ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', visita: 'Visita', nota: 'Anotação' }
const TIPO_ICONE: Record<string, string> = { ligacao: '📞', whatsapp: '💬', email: '✉️', visita: '🚗', nota: '📝' }
const REGIAO_LABEL: Record<string, string> = { norte: 'Norte', nordeste: 'Nordeste', centro_oeste: 'Centro-Oeste', sudeste: 'Sudeste', sul: 'Sul' }

// Próximo dia útil a partir de hoje + n (pula sábado/domingo).
function diaUtilMais(n: number): string {
  const d = new Date(`${hojeBrString()}T12:00:00`)
  let faltam = n
  while (faltam > 0) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) faltam--
  }
  return d.toISOString().slice(0, 10)
}
const fmtDia = (ymd: string | null | undefined) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : '—')
function diasAte(ymd: string | null | undefined): number | null {
  if (!ymd) return null
  const hoje = new Date(`${hojeBrString()}T12:00:00`).getTime()
  return Math.round((new Date(`${ymd}T12:00:00`).getTime() - hoje) / 864e5)
}

type Prospect = inferRouterOutputs<AppRouter>['prospeccao']['quadro'][number]

function ProximoPill({ p }: { p: Prospect }) {
  if (!ABERTAS.includes(p.prospeccaoEtapa as Etapa)) return null
  const d = diasAte(p.prospeccaoProximoContato)
  if (d === null) return <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-semibold">Sem próximo contato</span>
  if (d < 0) return <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-semibold">Atrasado {-d}d</span>
  if (d === 0) return <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-semibold">Hoje</span>
  return <span className="text-[11px] px-2 py-0.5 rounded-full bg-dark-700 text-dark-300">{fmtDia(p.prospeccaoProximoContato)}</span>
}

function origemTexto(p: Prospect) {
  const base = ORIGEM_LABEL[p.prospeccaoOrigem ?? ''] ?? '—'
  if (p.prospeccaoOrigem === 'banco' && p.origemBanco) return `${base} · ${p.origemBanco}`
  if (p.prospeccaoOrigem === 'manual' && p.canalOrigem) return `${base} · ${CANAL_LABELS[p.canalOrigem] ?? p.canalOrigem}`
  return base
}

// ── Botões de contato (clique fica pendente até confirmar) ─────────────────
function BotoesContato({ p, onConfirmar }: { p: Prospect; onConfirmar: (registroId: number, tipo: string) => void }) {
  const utils = trpc.useUtils()
  const pabx = usePabxDiscar()
  const cliqueMut = trpc.prospeccao.registrarClique.useMutation({
    onSuccess: () => utils.prospeccao.quadro.invalidate(),
    onError: (e) => toast.error(e.message),
  })
  const tel = p.telefoneWhatsapp || p.telefonesExtras?.[0]?.numero || ''
  const parar = (e: React.MouseEvent) => e.stopPropagation()
  return (
    <div className="flex flex-col gap-2" onClick={parar}>
      <div className="flex flex-wrap gap-1.5">
        {tel && (
          <a
            href={`tel:0${soDigitos(tel)}`}
            onClick={(e) => {
              if (pabx.ativo) {
                e.preventDefault()
                pabx.discar(tel) // registrada sozinha pelo PABX
              } else cliqueMut.mutate({ clienteId: p.id, tipo: 'ligacao' })
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-gold-600/20 hover:bg-gold-600/40 text-gold-400 border border-gold-600/30"
          >
            <Phone size={12} /> Ligar
          </a>
        )}
        {tel && (
          <a
            href={`https://wa.me/55${soDigitos(tel)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => cliqueMut.mutate({ clienteId: p.id, tipo: 'whatsapp' })}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-green-600/20 hover:bg-green-600/40 text-green-400 border border-green-600/30"
          >
            💬 WhatsApp
          </a>
        )}
        {p.email && (
          <a
            href={`mailto:${p.email}`}
            onClick={() => cliqueMut.mutate({ clienteId: p.id, tipo: 'email' })}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-dark-700 hover:bg-dark-600 text-dark-200 border border-dark-600"
          >
            <Mail size={12} /> E-mail
          </a>
        )}
        {!tel && !p.email && <span className="text-xs text-dark-500">Sem telefone/e-mail</span>}
      </div>
      {p.pendentes.map((r) => (
        <div key={r.id} className="rounded-lg bg-gold-600/10 border border-gold-600/30 px-2 py-1.5 text-xs text-gold-300 flex flex-wrap items-center gap-2">
          <span>
            Confirmar {TIPO_LABEL[r.tipo]?.toLowerCase()} ({timeAgo(r.em)}): como foi?
          </span>
          <button className="px-2 py-0.5 rounded bg-gold-600 text-white font-semibold" onClick={() => onConfirmar(r.id, r.tipo)}>
            Confirmar
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Confirmar clique ───────────────────────────────────────────────────────
function ConfirmarModal({ alvo, onClose }: { alvo: { registroId: number; tipo: string; aberto: boolean } | null; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [respondeu, setRespondeu] = useState<boolean | null>(null)
  const [obs, setObs] = useState('')
  const [prox, setProx] = useState(diaUtilMais(2))
  const confirmarMut = trpc.prospeccao.confirmarContato.useMutation({
    onSuccess: () => {
      toast.success('Contato confirmado')
      utils.prospeccao.quadro.invalidate()
      utils.prospeccao.listarRegistros.invalidate()
      fechar()
    },
    onError: (e) => toast.error(e.message),
  })
  const descartarMut = trpc.prospeccao.descartarClique.useMutation({
    onSuccess: () => {
      utils.prospeccao.quadro.invalidate()
      fechar()
    },
  })
  function fechar() {
    setRespondeu(null)
    setObs('')
    setProx(diaUtilMais(2))
    onClose()
  }
  if (!alvo) return null
  return (
    <Modal open onClose={fechar} title={`Como foi o ${TIPO_LABEL[alvo.tipo]?.toLowerCase()}?`} size="sm">
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button variant={respondeu === true ? 'primary' : 'outline'} onClick={() => setRespondeu(true)} className="flex-1">
            Respondeu
          </Button>
          <Button variant={respondeu === false ? 'primary' : 'outline'} onClick={() => setRespondeu(false)} className="flex-1">
            Não respondeu
          </Button>
        </div>
        <Textarea label="O que aconteceu (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
        {alvo.aberto && <Input label="Próximo contato (obrigatório)" type="date" value={prox} onChange={(e) => setProx(e.target.value)} />}
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => descartarMut.mutate({ registroId: alvo.registroId })}>
            Não cheguei a contatar
          </Button>
          <Button
            disabled={respondeu === null}
            loading={confirmarMut.isPending}
            onClick={() =>
              confirmarMut.mutate({ registroId: alvo.registroId, respondeu: !!respondeu, observacao: obs || undefined, proximoContato: alvo.aberto ? prox : undefined })
            }
          >
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Motivo (Perdido / Desqualificado) ──────────────────────────────────────
function MotivoModal({ alvo, onClose }: { alvo: { p: Prospect; etapa: 'perdido' | 'desqualificado' } | null; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [motivo, setMotivo] = useState('')
  const [outro, setOutro] = useState('')
  const moverMut = trpc.prospeccao.moverEtapa.useMutation({
    onSuccess: (r) => {
      toast.success(r.voltouProBanco ? 'Voltou pro Banco de Clientes' : 'Atualizado')
      utils.prospeccao.quadro.invalidate()
      setMotivo('')
      setOutro('')
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })
  if (!alvo) return null
  const lista = alvo.etapa === 'perdido' ? MOTIVOS_PERDA : MOTIVOS_DESQ
  const doBanco = alvo.p.prospeccaoOrigem !== 'manual'
  const final = motivo === 'Outro' ? outro.trim() : motivo
  return (
    <Modal open onClose={onClose} title={alvo.etapa === 'perdido' ? 'Marcar como perdido' : 'Desqualificar'} size="sm">
      <div className="space-y-3">
        <p className="text-sm text-dark-300">
          <b className="text-dark-100">{alvo.p.razaoSocial}</b>
          {alvo.etapa === 'perdido'
            ? doBanco
              ? ' volta pro Banco de Clientes (outro vendedor pode tentar depois).'
              : ' fica na coluna Perdido.'
            : doBanco
              ? ' volta pro Banco de Clientes marcado como desqualificado (escondido da lista) e não aparece mais nas sugestões.'
              : ' fica na coluna Desqualificado.'}
        </p>
        <Select label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Escolha..." options={lista.map((m) => ({ value: m, label: m }))} />
        {motivo === 'Outro' && <Input label="Qual?" value={outro} onChange={(e) => setOutro(e.target.value)} />}
        <div className="flex justify-end">
          <Button variant="danger" disabled={!final} loading={moverMut.isPending} onClick={() => moverMut.mutate({ id: alvo.p.id, etapa: alvo.etapa, motivo: final })}>
            Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Ficha do prospect ──────────────────────────────────────────────────────
function FichaProspect({
  p,
  onClose,
  onMotivo,
  onConfirmar,
}: {
  p: Prospect
  onClose: () => void
  onMotivo: (etapa: 'perdido' | 'desqualificado') => void
  onConfirmar: (registroId: number, tipo: string) => void
}) {
  const utils = trpc.useUtils()
  const aberto = ABERTAS.includes(p.prospeccaoEtapa as Etapa)
  const { data: registros } = trpc.prospeccao.listarRegistros.useQuery({ clienteId: p.id })
  const [tipo, setTipo] = useState('ligacao')
  const [resultado, setResultado] = useState('')
  const [obs, setObs] = useState('')
  const [prox, setProx] = useState(diaUtilMais(2))
  const [editando, setEditando] = useState(false)
  const [tel, setTel] = useState(p.telefoneWhatsapp ?? '')
  const [email, setEmail] = useState(p.email ?? '')
  const [contato, setContato] = useState(p.nomeContato ?? '')
  const invalidar = () => {
    utils.prospeccao.quadro.invalidate()
    utils.prospeccao.listarRegistros.invalidate({ clienteId: p.id })
  }
  const tentativaMut = trpc.prospeccao.registrarTentativa.useMutation({
    onSuccess: () => {
      toast.success('Tentativa salva')
      setObs('')
      setResultado('')
      invalidar()
    },
    onError: (e) => toast.error(e.message),
  })
  const moverMut = trpc.prospeccao.moverEtapa.useMutation({ onSuccess: invalidar, onError: (e) => toast.error(e.message) })
  const editarMut = trpc.prospeccao.editarProspect.useMutation({
    onSuccess: () => {
      toast.success('Salvo')
      setEditando(false)
      invalidar()
    },
    onError: (e) => toast.error(e.message),
  })
  const carteiraMut = trpc.prospeccao.enviarParaCarteira.useMutation({
    onSuccess: () => {
      toast.success('Enviado pra carteira — já aparece no seu Kanban do mês')
      utils.prospeccao.quadro.invalidate()
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Modal open onClose={onClose} title={p.razaoSocial} size="lg">
      <div className="space-y-4">
        <div className="text-xs text-dark-400 flex flex-wrap gap-x-3 gap-y-1">
          {(p.cidade || p.estado) && <span>{[p.cidade, p.estado].filter(Boolean).join('/')}</span>}
          {(p.cnpj || p.cpf) && <span>Doc. {p.cnpj || p.cpf}</span>}
          <span>Cód. {p.codigo}</span>
          <span>{origemTexto(p)}</span>
          {p.vendedorNome && <span>Vendedor: {p.vendedorNome}</span>}
        </div>
        {p.prospeccaoInfo && p.prospeccaoOrigem !== 'banco' && (
          <div className="text-xs rounded-lg bg-gold-600/10 border border-gold-600/30 text-gold-300 px-3 py-2">{p.prospeccaoInfo}</div>
        )}

        {editando ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input label="Telefone/WhatsApp" value={tel} onChange={(e) => setTel(e.target.value)} />
            <Input label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input label="Contato (pessoa)" value={contato} onChange={(e) => setContato(e.target.value)} />
            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditando(false)}>
                Cancelar
              </Button>
              <Button size="sm" loading={editarMut.isPending} onClick={() => editarMut.mutate({ id: p.id, telefoneWhatsapp: tel || null, email: email || null, nomeContato: contato || null })}>
                Salvar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-dark-200">
              {p.nomeContato && <span className="mr-3">👤 {p.nomeContato}</span>}
              {p.telefoneWhatsapp && <span className="mr-3">📱 {p.telefoneWhatsapp}</span>}
              {p.email && <span>✉️ {p.email}</span>}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditando(true)}>
              Editar contato
            </Button>
          </div>
        )}

        <BotoesContato p={p} onConfirmar={onConfirmar} />

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <Select
              label="Etapa"
              value={p.prospeccaoEtapa ?? 'novo'}
              onChange={(e) => {
                const v = e.target.value as Etapa
                if (v === 'perdido' || v === 'desqualificado') onMotivo(v)
                else moverMut.mutate({ id: p.id, etapa: v })
              }}
              options={ETAPAS.map((e) => ({ value: e.id, label: e.nome }))}
            />
          </div>
          <Button loading={carteiraMut.isPending} onClick={() => carteiraMut.mutate({ id: p.id })} variant={p.prospeccaoEtapa === 'ganho' ? 'primary' : 'outline'}>
            Enviar pra carteira
          </Button>
        </div>
        {p.prospeccaoMotivo && !aberto && <p className="text-xs text-red-300">Motivo: {p.prospeccaoMotivo}</p>}

        {aberto && (
          <form
            className="rounded-xl border border-dark-600 bg-dark-900/40 p-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!obs.trim()) return toast.error('Escreva o que aconteceu.')
              if (tipo !== 'nota' && !resultado) return toast.error('Diga se respondeu ou não.')
              tentativaMut.mutate({
                clienteId: p.id,
                tipo: tipo as 'ligacao',
                resultado: tipo === 'nota' ? undefined : (resultado as 'respondeu'),
                observacao: obs.trim(),
                proximoContato: prox,
              })
            }}
          >
            <p className="text-sm font-semibold text-dark-100">Registrar tentativa</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Select label="Como" value={tipo} onChange={(e) => setTipo(e.target.value)} options={Object.entries(TIPO_LABEL).map(([value, label]) => ({ value, label }))} />
              {tipo !== 'nota' ? (
                <Select
                  label="Resultado"
                  value={resultado}
                  onChange={(e) => setResultado(e.target.value)}
                  placeholder="Escolha..."
                  options={[
                    { value: 'respondeu', label: 'Respondeu / conversamos' },
                    { value: 'nao_respondeu', label: 'Não respondeu' },
                  ]}
                />
              ) : (
                <div />
              )}
              <Input label="Próximo contato" type="date" value={prox} onChange={(e) => setProx(e.target.value)} />
            </div>
            <Textarea placeholder="Ex.: falei com o comprador, pediu tabela de preço" value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
            <div className="flex justify-end">
              <Button type="submit" size="sm" loading={tentativaMut.isPending}>
                Salvar tentativa
              </Button>
            </div>
            {p.tentativas >= 5 && ['novo', 'tentando'].includes(p.prospeccaoEtapa ?? '') && (
              <p className="text-xs text-amber-400">Já são {p.tentativas} tentativas sem conversa — se não tiver jeito, marque como Perdido.</p>
            )}
          </form>
        )}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-dark-400 mb-2">Histórico</p>
          {!registros?.length ? (
            <p className="text-sm text-dark-500">Nenhum contato ainda.</p>
          ) : (
            <div className="border-l-2 border-dark-600 pl-3 space-y-2 max-h-72 overflow-y-auto">
              {registros.map((r) => (
                <div key={r.id} className="text-sm">
                  <span className="mr-1">{TIPO_ICONE[r.tipo]}</span>
                  <b className="text-dark-100">{TIPO_LABEL[r.tipo]}</b>
                  {r.pendente ? <span className="ml-1 text-gold-400">· esperando confirmar</span> : r.resultado ? <span className="ml-1 text-dark-400">· {r.resultado === 'respondeu' ? 'respondeu' : 'não respondeu'}</span> : null}
                  <span className="text-dark-300"> — {r.observacao}</span>
                  <span className="block text-[11px] text-dark-500">
                    {timeAgo(r.createdAt)} · {r.registradoPor?.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ── Novo prospect ──────────────────────────────────────────────────────────
function NovoProspectModal({ open, onClose, vendedores }: { open: boolean; onClose: () => void; vendedores: { id: number; name: string }[] | null }) {
  const utils = trpc.useUtils()
  const vazio = { documento: '', razaoSocial: '', telefone: '', email: '', contato: '', cidade: '', estado: '', endereco: '', bairro: '', cep: '', canal: '', obs: '', prox: hojeBrString(), vendedorId: '' }
  const [f, setF] = useState(vazio)
  const set = (p: Partial<typeof vazio>) => setF((x) => ({ ...x, ...p }))
  const verificarMut = trpc.prospeccao.verificarDocumento.useMutation({
    onSuccess: (r) => {
      if (r.receita)
        set({
          razaoSocial: r.receita.razaoSocial || f.razaoSocial,
          cidade: r.receita.municipio || f.cidade,
          estado: r.receita.uf || f.estado,
          telefone: f.telefone || r.receita.telefone || '',
          email: f.email || r.receita.email || '',
          endereco: [r.receita.logradouro, r.receita.numero].filter(Boolean).join(', '),
          bairro: r.receita.bairro ?? '',
          cep: r.receita.cep ?? '',
        })
    },
    onError: (e) => toast.error(e.message),
  })
  const criarMut = trpc.prospeccao.criar.useMutation({
    onSuccess: (r) => {
      toast.success(r.puxouDoBanco ? 'Já existia no Banco de Clientes — foi puxado pra sua prospecção' : 'Prospect cadastrado')
      utils.prospeccao.quadro.invalidate()
      setF(vazio)
      verificarMut.reset()
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })
  const existentes = verificarMut.data?.existentes ?? []
  const bloqueado = existentes.some((e) => e.aqui && !e.semDono)
  return (
    <Modal open={open} onClose={onClose} title="Novo prospect" size="lg">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!f.razaoSocial.trim()) return toast.error('Preencha o nome.')
          if (!f.canal) return toast.error('Escolha de onde veio.')
          criarMut.mutate({
            razaoSocial: f.razaoSocial,
            documento: f.documento || undefined,
            telefoneWhatsapp: f.telefone || undefined,
            email: f.email || undefined,
            nomeContato: f.contato || undefined,
            cidade: f.cidade || undefined,
            estado: f.estado || undefined,
            endereco: f.endereco || undefined,
            bairro: f.bairro || undefined,
            cep: f.cep || undefined,
            canalOrigem: f.canal as 'google',
            observacoes: f.obs || undefined,
            proximoContato: f.prox,
            vendedorId: f.vendedorId ? Number(f.vendedorId) : undefined,
          })
        }}
      >
        <p className="text-xs text-dark-400">Digite o CNPJ e clique em Buscar: o CRM preenche pela Receita e confere se já existe em alguma empresa do grupo.</p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input label="CNPJ ou CPF (opcional)" value={f.documento} onChange={(e) => set({ documento: e.target.value })} placeholder="00.000.000/0000-00" />
          </div>
          <Button type="button" variant="outline" loading={verificarMut.isPending} onClick={() => verificarMut.mutate({ documento: f.documento })}>
            <Search size={14} /> Buscar
          </Button>
        </div>
        {verificarMut.data && (
          <div className="space-y-1">
            {existentes.length === 0 ? (
              <div className="text-sm rounded-lg bg-green-500/10 text-green-400 px-3 py-2">Não existe em nenhuma empresa do grupo. Pode cadastrar.</div>
            ) : (
              existentes.map((e) => (
                <div key={e.id} className={`text-sm rounded-lg px-3 py-2 ${e.aqui && !e.semDono ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}>
                  <b>{e.empresa}:</b> {e.razaoSocial} — {e.situacao}
                  {e.aqui && e.semDono && ' · ao cadastrar, esse cadastro é puxado pra sua prospecção (sem duplicar).'}
                </div>
              ))
            )}
            {verificarMut.data.receita?.situacao && verificarMut.data.receita.situacao.toUpperCase() !== 'ATIVA' && (
              <div className="text-sm rounded-lg bg-red-500/10 text-red-300 px-3 py-2">Situação na Receita: {verificarMut.data.receita.situacao}</div>
            )}
          </div>
        )}
        <Input label="Nome / Razão social" value={f.razaoSocial} onChange={(e) => set({ razaoSocial: e.target.value })} required />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input label="Telefone/WhatsApp" value={f.telefone} onChange={(e) => set({ telefone: e.target.value })} />
          <Input label="E-mail" value={f.email} onChange={(e) => set({ email: e.target.value })} />
          <Input label="Contato (pessoa)" value={f.contato} onChange={(e) => set({ contato: e.target.value })} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <Input label="Cidade" value={f.cidade} onChange={(e) => set({ cidade: e.target.value })} />
          </div>
          <Input label="UF" value={f.estado} maxLength={2} onChange={(e) => set({ estado: e.target.value.toUpperCase() })} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Select label="De onde veio" value={f.canal} onChange={(e) => set({ canal: e.target.value })} placeholder="Escolha..." options={Object.entries(CANAL_LABELS).map(([value, label]) => ({ value, label }))} />
          <Input label="Primeiro contato em" type="date" value={f.prox} onChange={(e) => set({ prox: e.target.value })} />
          {vendedores && (
            <Select label="Vendedor" value={f.vendedorId} onChange={(e) => set({ vendedorId: e.target.value })} placeholder="Eu mesmo" options={vendedores.map((v) => ({ value: v.id, label: v.name }))} />
          )}
        </div>
        <Textarea label="Observações (opcional)" value={f.obs} onChange={(e) => set({ obs: e.target.value })} rows={2} />
        <div className="flex justify-end">
          <Button type="submit" disabled={bloqueado} loading={criarMut.isPending}>
            Cadastrar prospect
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ── Sugestões ──────────────────────────────────────────────────────────────
function Sugestoes({ ehAdmin }: { ehAdmin: boolean }) {
  const utils = trpc.useUtils()
  const [regiao, setRegiao] = usePersistedState<string>('prosp_sug_regiao', '')
  const { data, isLoading, refetch, isFetching } = trpc.prospeccao.sugestoes.useQuery({ regiao: regiao || null })
  const addMut = trpc.prospeccao.adicionarSugestao.useMutation({
    onSuccess: () => {
      toast.success('Entrou na sua prospecção como "Novo", pra contatar hoje')
      utils.prospeccao.sugestoes.invalidate()
      utils.prospeccao.quadro.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const Lista = ({ itens, vazio }: { itens: NonNullable<typeof data>['grupo']; vazio: string }) =>
    !itens.length ? (
      <p className="text-sm text-dark-500 px-1">{vazio}</p>
    ) : (
      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {itens.map((s) => (
          <div key={s.chave} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-dark-100 text-sm">{s.razaoSocial}</p>
              <p className="text-xs text-dark-400">
                {[s.cidade, s.estado].filter(Boolean).join('/') || 'Sem cidade'}
                {s.regiao ? ` · ${REGIAO_LABEL[s.regiao]}` : ''} · {s.info}
              </p>
            </div>
            <Button size="sm" loading={addMut.isPending && addMut.variables?.chave === s.chave} onClick={() => addMut.mutate({ chave: s.chave })}>
              Adicionar à minha prospecção
            </Button>
          </div>
        ))}
      </div>
    )
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm text-dark-400 max-w-3xl">
          {ehAdmin ? 'Todas as regiões (filtre se quiser). ' : `Só clientes da sua região${data?.regiao ? ` (${REGIAO_LABEL[data.regiao] ?? data.regiao})` : ''}. `}
          Quem já tem vendedor nesta empresa não aparece. Ao adicionar, a sugestão some pros outros.
        </p>
        <div className="flex items-end gap-2">
          {ehAdmin && (
            <Select value={regiao} onChange={(e) => setRegiao(e.target.value)} placeholder="Todas as regiões" options={Object.entries(REGIAO_LABEL).map(([value, label]) => ({ value, label }))} />
          )}
          <Button variant="ghost" size="sm" onClick={() => refetch()} loading={isFetching}>
            <RefreshCw size={14} />
          </Button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-sm text-dark-500">Calculando sugestões...</p>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-dark-100">
              Compram de outra empresa do grupo, mas não desta <span className="text-dark-500 font-normal">({data?.totalGrupo ?? 0} no total)</span>
            </h2>
            <p className="text-xs text-dark-500">Notas do SAP dos últimos 12 meses, comparadas pelo CNPJ/código. Ordenado por quanto compram.</p>
            <Lista itens={data?.grupo ?? []} vazio="Nenhuma sugestão aqui (essa lista só existe pras empresas do SAP: Joitec, Odin Tubos e Odin Automação)." />
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-dark-100">
              Pararam de comprar há mais de 6 meses <span className="text-dark-500 font-normal">({data?.totalParou ?? 0} no total)</span>
            </h2>
            <p className="text-xs text-dark-500">Clientes do Banco de Clientes desta empresa. O histórico de compras no CRM começa em abril/2026, então essa lista cresce com o tempo.</p>
            <Lista itens={data?.parou ?? []} vazio="Ninguém nessa situação por enquanto." />
          </section>
        </>
      )}
    </div>
  )
}

// ── Relatório ──────────────────────────────────────────────────────────────
function Relatorio({ vendedores }: { vendedores: { id: number; name: string }[] | null }) {
  const [de, setDe] = useState(primeiroDiaMesString())
  const [ate, setAte] = useState(hojeBrString())
  const [vend, setVend] = useState('')
  const { data, isLoading } = trpc.prospeccao.relatorio.useQuery({ de, ate, vendedorId: vend ? Number(vend) : null })
  const t = data?.totais
  const conv = t && t.ganhos + t.perdidos > 0 ? Math.round((t.ganhos / (t.ganhos + t.perdidos)) * 100) : 0
  const Barras = ({ titulo, dados, rotulo }: { titulo: string; dados: Record<string, number>; rotulo?: (k: string) => string }) => {
    const linhas = Object.entries(dados).sort((a, b) => b[1] - a[1])
    const max = Math.max(1, ...linhas.map((l) => l[1]))
    return (
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-2">
        <h3 className="text-sm font-semibold text-dark-100">{titulo}</h3>
        {!linhas.length && <p className="text-xs text-dark-500">Nada no período.</p>}
        {linhas.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-2 text-xs">
            <span className="text-dark-300 truncate">{rotulo ? rotulo(k) : k}</span>
            <span className="h-3 rounded bg-dark-700 overflow-hidden">
              <span className="block h-full bg-gold-500 rounded" style={{ width: `${(v / max) * 100}%` }} />
            </span>
            <b className="text-right text-dark-100 tabular-nums">{v}</b>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input label="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        <Input label="Até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        {vendedores && <Select label="Vendedor" value={vend} onChange={(e) => setVend(e.target.value)} placeholder="Todos" options={vendedores.map((v) => ({ value: v.id, label: v.name }))} />}
      </div>
      {isLoading || !t ? (
        <p className="text-sm text-dark-500">Carregando...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ['Tentativas de contato', t.tentativas],
              ['Responderam', t.responderam],
              ['Entraram na prospecção', t.entraram],
              ['Viraram cliente', t.ganhos],
              ['Conversão (ganhos ÷ ganhos+perdidos)', `${conv}%`],
            ].map(([k, v]) => (
              <div key={String(k)} className="bg-dark-800 border border-dark-600 rounded-2xl px-4 py-3">
                <p className="text-2xl font-bold text-dark-100 tabular-nums">{v}</p>
                <p className="text-xs text-dark-400">{k}</p>
              </div>
            ))}
          </div>
          <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-dark-400 text-left">
                <tr>
                  {['Vendedor', 'Tentativas', 'Responderam', 'Entraram', 'Viraram cliente', 'Perdidos', 'Desqualificados'].map((h) => (
                    <th key={h} className="px-4 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {data.vendedores.map((v) => (
                  <tr key={v.vendedorId} className="tabular-nums">
                    <td className="px-4 py-2 text-dark-100">{v.nome}</td>
                    <td className="px-4 py-2">{v.tentativas}</td>
                    <td className="px-4 py-2">{v.responderam}</td>
                    <td className="px-4 py-2">{v.entraram}</td>
                    <td className="px-4 py-2 text-green-400">{v.ganhos}</td>
                    <td className="px-4 py-2">{v.perdidos}</td>
                    <td className="px-4 py-2">{v.desqualificados}</td>
                  </tr>
                ))}
                {!data.vendedores.length && (
                  <tr>
                    <td className="px-4 py-3 text-dark-500" colSpan={7}>
                      Nada no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Barras titulo="De onde vieram" dados={data.origens} rotulo={(k) => ORIGEM_LABEL[k] ?? k} />
            <Barras titulo="Por que perdemos" dados={data.motivosPerda} />
            <Barras titulo="Por que desqualificamos" dados={data.motivosDesq} />
          </div>
        </>
      )}
    </div>
  )
}

// ── Página ─────────────────────────────────────────────────────────────────
export default function Prospeccao() {
  const { user } = useAuth()
  const ehAdmin = user?.role !== 'vendor'
  const [aba, setAba] = usePersistedState<'dia' | 'quadro' | 'sugestoes' | 'relatorio'>('prosp_aba', 'dia')
  const [vendedorId, setVendedorId] = usePersistedState<string>('prosp_vend', '')
  const [origem, setOrigem] = usePersistedState<string>('prosp_origem', '')
  const [busca, setBusca] = usePersistedState<string>('prosp_busca', '')
  const [novoAberto, setNovoAberto] = useState(false)
  const [fichaId, setFichaId] = useState<number | null>(null)
  const [motivo, setMotivo] = useState<{ p: Prospect; etapa: 'perdido' | 'desqualificado' } | null>(null)
  const [confirmar, setConfirmar] = useState<{ registroId: number; tipo: string; aberto: boolean } | null>(null)
  const [arrastando, setArrastando] = useState<number | null>(null)
  const [sobre, setSobre] = useState<Etapa | null>(null)

  const utils = trpc.useUtils()
  const { data: vendedoresTodos } = trpc.users.vendors.useQuery(undefined, { enabled: ehAdmin })
  const vendedores = ehAdmin ? (vendedoresTodos ?? []).map((v) => ({ id: v.id, name: v.name })) : null
  const { data: lista, isLoading } = trpc.prospeccao.quadro.useQuery({ vendedorId: vendedorId ? Number(vendedorId) : null })
  const moverMut = trpc.prospeccao.moverEtapa.useMutation({
    onSuccess: () => utils.prospeccao.quadro.invalidate(),
    onError: (e) => toast.error(e.message),
  })

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (lista ?? []).filter(
      (p) =>
        (!origem || p.prospeccaoOrigem === origem) &&
        (!termo || `${p.razaoSocial} ${p.cidade ?? ''} ${p.codigo} ${p.cnpj ?? ''} ${p.nomeContato ?? ''}`.toLowerCase().includes(termo))
    )
  }, [lista, origem, busca])
  const abertos = filtrados.filter((p) => ABERTAS.includes(p.prospeccaoEtapa as Etapa))
  const atrasados = abertos.filter((p) => (diasAte(p.prospeccaoProximoContato) ?? -1) < 0)
  const hoje = abertos.filter((p) => diasAte(p.prospeccaoProximoContato) === 0)
  const pendentes = abertos.filter((p) => p.pendentes.length)
  const ficha = fichaId ? (lista ?? []).find((p) => p.id === fichaId) ?? null : null

  const abrirConfirmar = (p: Prospect) => (registroId: number, tipo: string) =>
    setConfirmar({ registroId, tipo, aberto: ABERTAS.includes(p.prospeccaoEtapa as Etapa) })

  function soltar(etapa: Etapa) {
    const p = (lista ?? []).find((x) => x.id === arrastando)
    setArrastando(null)
    setSobre(null)
    if (!p || p.prospeccaoEtapa === etapa) return
    if (etapa === 'perdido' || etapa === 'desqualificado') setMotivo({ p, etapa })
    else moverMut.mutate({ id: p.id, etapa })
  }

  const Linha = ({ p }: { p: Prospect }) => (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3">
      <button className="min-w-0 flex-1 text-left" onClick={() => setFichaId(p.id)}>
        <p className="font-medium text-dark-100 text-sm flex flex-wrap items-center gap-2">
          {p.razaoSocial} <ProximoPill p={p} />
        </p>
        <p className="text-xs text-dark-400">
          {[p.cidade, p.estado].filter(Boolean).join('/') || 'Sem cidade'} · {origemTexto(p)} · {NOME_ETAPA[p.prospeccaoEtapa as Etapa]} · {p.tentativas} tentativa(s)
          {ehAdmin && p.vendedorNome ? ` · ${p.vendedorNome}` : ''}
          {p.ultimoContato ? ` · último: ${p.ultimoContato.observacao}` : ''}
        </p>
      </button>
      <div className="flex flex-col items-end gap-2">
        <BotoesContato p={p} onConfirmar={abrirConfirmar(p)} />
        <Button size="sm" onClick={() => setFichaId(p.id)}>
          Registrar tentativa
        </Button>
      </div>
    </div>
  )

  const Bloco = ({ titulo, itens, vazio }: { titulo: string; itens: Prospect[]; vazio?: string }) =>
    itens.length || vazio ? (
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-dark-400">
          {titulo} ({itens.length})
        </h2>
        {itens.length ? (
          <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
            {itens.map((p) => (
              <Linha key={p.id} p={p} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-green-400">{vazio}</p>
        )}
      </section>
    ) : null

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Prospecção</h1>
          <p className="text-sm text-dark-400">Clientes que você está indo atrás. Quando fechar, envie pra carteira.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {vendedores && (
            <Select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} placeholder="Todos os vendedores" options={vendedores.map((v) => ({ value: v.id, label: v.name }))} />
          )}
          <Button onClick={() => setNovoAberto(true)}>
            <Plus size={16} /> Novo prospect
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-dark-600 overflow-x-auto">
        {(
          [
            ['dia', 'Meu dia', atrasados.length],
            ['quadro', 'Quadro', 0],
            ['sugestoes', 'Sugestões do SAP', 0],
            ['relatorio', 'Relatório', 0],
          ] as const
        ).map(([id, nome, n]) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${aba === id ? 'border-gold-400 text-gold-400 font-semibold' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
          >
            {nome}
            {n > 0 && <span className="ml-1.5 text-[11px] px-1.5 rounded-full bg-red-500/20 text-red-400">{n}</span>}
          </button>
        ))}
      </div>

      {(aba === 'dia' || aba === 'quadro') && (
        <div className="flex flex-wrap items-end gap-2">
          <Select value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="Todas as origens" options={Object.entries(ORIGEM_LABEL).map(([value, label]) => ({ value, label }))} />
          <div className="w-64 max-w-full">
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome, cidade, CNPJ..." />
          </div>
          {(origem || busca) && (
            <Button variant="ghost" size="sm" onClick={() => (setOrigem(''), setBusca(''))}>
              Limpar filtro
            </Button>
          )}
        </div>
      )}

      {isLoading && (aba === 'dia' || aba === 'quadro') && <p className="text-sm text-dark-500">Carregando...</p>}

      {aba === 'dia' && lista && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ['Atrasados — ligar primeiro', atrasados.length, 'text-red-400'],
              ['Pra contatar hoje', hoje.length, 'text-amber-400'],
              ['Contatos pra confirmar', pendentes.length, 'text-gold-400'],
              ['Prospects em aberto', abertos.length, 'text-dark-100'],
              ['Viraram cliente (na tela)', filtrados.filter((p) => p.prospeccaoEtapa === 'ganho').length, 'text-green-400'],
            ].map(([k, v, cor]) => (
              <div key={String(k)} className="bg-dark-800 border border-dark-600 rounded-2xl px-4 py-3">
                <p className={`text-2xl font-bold tabular-nums ${cor}`}>{v}</p>
                <p className="text-xs text-dark-400">{k}</p>
              </div>
            ))}
          </div>
          <Bloco titulo="Contatos pra confirmar" itens={pendentes} />
          <Bloco titulo="Atrasados" itens={atrasados} />
          <Bloco titulo="Hoje" itens={hoje} vazio="Tudo em dia por hoje 👏" />
          {!abertos.length && <p className="text-sm text-dark-500">Nenhum prospect em aberto. Cadastre um, pegue do Banco de Clientes ou veja as Sugestões do SAP.</p>}
        </div>
      )}

      {aba === 'quadro' && lista && (
        <>
          <p className="text-xs text-dark-500">Arraste o card pra mudar de etapa, ou clique pra abrir. Borda vermelha = atrasado, amarela = hoje.</p>
          <div className="overflow-x-auto pb-2">
            <div className="grid grid-flow-col auto-cols-[minmax(230px,1fr)] gap-3 min-w-max">
              {ETAPAS.map((e) => {
                const cards = filtrados.filter((p) => p.prospeccaoEtapa === e.id)
                return (
                  <div
                    key={e.id}
                    onDragOver={(ev) => {
                      ev.preventDefault()
                      setSobre(e.id)
                    }}
                    onDragLeave={() => setSobre(null)}
                    onDrop={(ev) => {
                      ev.preventDefault()
                      soltar(e.id)
                    }}
                    className={`w-[250px] bg-dark-900/50 border rounded-2xl p-2.5 flex flex-col gap-2 min-h-[320px] ${sobre === e.id ? 'border-gold-400 border-dashed' : 'border-dark-600'}`}
                  >
                    <div>
                      <p className="text-sm font-semibold text-dark-100 flex justify-between">
                        {e.nome} <span className="text-dark-500 font-normal">{cards.length}</span>
                      </p>
                      <p className="text-[11px] text-dark-500">{e.dica}</p>
                    </div>
                    {cards.map((p) => {
                      const d = diasAte(p.prospeccaoProximoContato)
                      const borda = ABERTAS.includes(p.prospeccaoEtapa as Etapa) ? (d === null || d < 0 ? 'border-l-red-500' : d === 0 ? 'border-l-amber-400' : 'border-l-dark-600') : 'border-l-dark-600'
                      return (
                        <div
                          key={p.id}
                          draggable
                          onDragStart={() => setArrastando(p.id)}
                          onClick={() => setFichaId(p.id)}
                          className={`cursor-grab bg-dark-800 border border-dark-600 border-l-4 ${borda} rounded-xl p-2.5 space-y-1.5 hover:border-dark-500`}
                        >
                          <p className="text-sm font-medium text-dark-100 leading-tight">{p.razaoSocial}</p>
                          <p className="text-[11px] text-dark-400">
                            {[p.cidade, p.estado].filter(Boolean).join('/') || 'Sem cidade'}
                            {ehAdmin && p.vendedorNome ? ` · ${p.vendedorNome}` : ''}
                          </p>
                          <p className="text-[11px] text-gold-400">{origemTexto(p)}</p>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[11px] text-dark-400">{p.tentativas} tentativa(s)</span>
                            {p.prospeccaoMotivo && !ABERTAS.includes(p.prospeccaoEtapa as Etapa) ? <span className="text-[11px] text-dark-400 truncate">{p.prospeccaoMotivo}</span> : <ProximoPill p={p} />}
                          </div>
                          {ABERTAS.includes(p.prospeccaoEtapa as Etapa) && <BotoesContato p={p} onConfirmar={abrirConfirmar(p)} />}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {aba === 'sugestoes' && <Sugestoes ehAdmin={ehAdmin} />}
      {aba === 'relatorio' && <Relatorio vendedores={vendedores} />}

      <NovoProspectModal open={novoAberto} onClose={() => setNovoAberto(false)} vendedores={vendedores} />
      {ficha && (
        <FichaProspect
          p={ficha}
          onClose={() => setFichaId(null)}
          onMotivo={(etapa) => setMotivo({ p: ficha, etapa })}
          onConfirmar={abrirConfirmar(ficha)}
        />
      )}
      <MotivoModal alvo={motivo} onClose={() => setMotivo(null)} />
      <ConfirmarModal alvo={confirmar} onClose={() => setConfirmar(null)} />
    </div>
  )
}
