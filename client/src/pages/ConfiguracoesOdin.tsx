import { useState } from 'react'
import { Plus, Pencil, Trash2, Settings2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { Input } from '../components/ui/Input'

type TabKey = 'condicoes' | 'transportadoras' | 'emails'
const TAB_LABELS: Record<TabKey, string> = { condicoes: 'Condições de Pagamento', transportadoras: 'Transportadoras', emails: 'Modelos de E-mail' }

export default function ConfiguracoesOdin() {
  const [tab, setTab] = useState<TabKey>('condicoes')
  return (
    <div className="p-6">
      <h1 className="font-heading text-2xl text-dark-50 font-bold mb-4 flex items-center gap-2"><Settings2 size={22} /> Configurações</h1>
      <div className="flex gap-1 border-b border-dark-700 mb-5">
        {(Object.keys(TAB_LABELS) as TabKey[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm border-b-2 transition-colors ${tab === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {tab === 'condicoes' && <AbaCondicoes />}
      {tab === 'transportadoras' && <AbaTransportadoras />}
      {tab === 'emails' && <AbaEmails />}
    </div>
  )
}

function AbaCondicoes() {
  const [nome, setNome] = useState('')
  const [excluindo, setExcluindo] = useState<{ id: number; nome: string } | null>(null)
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.configuracoesOdin.listarCondicoes.useQuery()
  const criarMut = trpc.configuracoesOdin.criarCondicao.useMutation({ onSuccess: () => { toast.success('Adicionada'); setNome(''); utils.configuracoesOdin.listarCondicoes.invalidate() }, onError: (e) => toast.error(e.message) })
  const excluirMut = trpc.configuracoesOdin.excluirCondicao.useMutation({ onSuccess: () => { toast.success('Removida'); setExcluindo(null); utils.configuracoesOdin.listarCondicoes.invalidate() }, onError: (e) => toast.error(e.message) })

  return (
    <div>
      <div className="flex gap-2 mb-4 max-w-md">
        <Input placeholder="Nova condição de pagamento..." value={nome} onChange={(e) => setNome(e.target.value)} className="flex-1" />
        <Button disabled={!nome.trim()} loading={criarMut.isPending} onClick={() => criarMut.mutate({ nome })}><Plus size={14} className="mr-1" /> Adicionar</Button>
      </div>
      {isLoading ? <p className="text-dark-400 text-sm">Carregando...</p> : (
        <div className="space-y-1.5 max-w-md">
          {(data ?? []).map((c) => (
            <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-dark-600 bg-dark-800 text-sm">
              <span className="text-dark-200">{c.nome}</span>
              <button onClick={() => setExcluindo({ id: c.id, nome: c.nome })} className="text-dark-400 hover:text-red-400"><Trash2 size={14} /></button>
            </div>
          ))}
          {(!data || data.length === 0) && <p className="text-dark-500 text-sm">Nenhuma condição cadastrada</p>}
        </div>
      )}
      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Remover condição" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Remover "{excluindo?.nome}"?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExcluindo(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={excluirMut.isPending} onClick={() => excluindo && excluirMut.mutate({ id: excluindo.id })}>Remover</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

type TransportadoraForm = { nome: string; telefoneContato: string; observacoes: string }
const TRANSPORTADORA_VAZIA: TransportadoraForm = { nome: '', telefoneContato: '', observacoes: '' }

function AbaTransportadoras() {
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [form, setForm] = useState<TransportadoraForm>(TRANSPORTADORA_VAZIA)
  const [excluindo, setExcluindo] = useState<{ id: number; nome: string } | null>(null)
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.configuracoesOdin.listarTransportadoras.useQuery()
  const criarMut = trpc.configuracoesOdin.criarTransportadora.useMutation({ onSuccess: () => { toast.success('Adicionada'); fechar(); utils.configuracoesOdin.listarTransportadoras.invalidate() }, onError: (e) => toast.error(e.message) })
  const atualizarMut = trpc.configuracoesOdin.atualizarTransportadora.useMutation({ onSuccess: () => { toast.success('Salvo'); fechar(); utils.configuracoesOdin.listarTransportadoras.invalidate() }, onError: (e) => toast.error(e.message) })
  const excluirMut = trpc.configuracoesOdin.excluirTransportadora.useMutation({ onSuccess: () => { toast.success('Removida'); setExcluindo(null); utils.configuracoesOdin.listarTransportadoras.invalidate() }, onError: (e) => toast.error(e.message) })

  function fechar() { setModalAberto(false); setEditando(null); setForm(TRANSPORTADORA_VAZIA) }
  function abrirEdicao(t: NonNullable<typeof data>[number]) {
    setEditando(t.id)
    setForm({ nome: t.nome, telefoneContato: t.telefoneContato ?? '', observacoes: t.observacoes ?? '' })
    setModalAberto(true)
  }
  function salvar() {
    if (!form.nome.trim()) return
    if (editando) atualizarMut.mutate({ id: editando, ...form })
    else criarMut.mutate(form)
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setModalAberto(true)}><Plus size={14} className="mr-1" /> Nova Transportadora</Button>
      </div>
      {isLoading ? <p className="text-dark-400 text-sm">Carregando...</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(data ?? []).map((t) => (
            <div key={t.id} className="bg-dark-800 border border-dark-600 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-dark-100">{t.nome}</h3>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => abrirEdicao(t)} className="text-dark-400 hover:text-gold-400"><Pencil size={14} /></button>
                  <button onClick={() => setExcluindo({ id: t.id, nome: t.nome })} className="text-dark-400 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              </div>
              {t.telefoneContato && <div className="text-xs text-dark-400">{t.telefoneContato}</div>}
              {t.observacoes && <div className="text-xs text-dark-500 mt-1">{t.observacoes}</div>}
            </div>
          ))}
          {(!data || data.length === 0) && <p className="text-dark-500 text-sm col-span-full">Nenhuma transportadora cadastrada</p>}
        </div>
      )}
      <Modal open={modalAberto} onClose={fechar} title={editando ? 'Editar Transportadora' : 'Nova Transportadora'} size="sm">
        <div className="p-5 space-y-4">
          <Input label="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          <Input label="Telefone" value={form.telefoneContato} onChange={(e) => setForm({ ...form, telefoneContato: e.target.value })} />
          <Input label="Observações" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          <Button className="w-full" disabled={!form.nome.trim()} loading={criarMut.isPending || atualizarMut.isPending} onClick={salvar}>{editando ? 'Salvar' : 'Adicionar'}</Button>
        </div>
      </Modal>
      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Remover transportadora" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Remover "{excluindo?.nome}"?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExcluindo(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={excluirMut.isPending} onClick={() => excluindo && excluirMut.mutate({ id: excluindo.id })}>Remover</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

type EmailForm = { nome: string; assunto: string; mensagem: string; etapa: string }
const EMAIL_VAZIO: EmailForm = { nome: '', assunto: '', mensagem: '', etapa: '' }

function AbaEmails() {
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [form, setForm] = useState<EmailForm>(EMAIL_VAZIO)
  const [excluindo, setExcluindo] = useState<{ id: number; nome: string } | null>(null)
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.configuracoesOdin.listarModelosEmail.useQuery()
  const criarMut = trpc.configuracoesOdin.criarModeloEmail.useMutation({ onSuccess: () => { toast.success('Adicionado'); fechar(); utils.configuracoesOdin.listarModelosEmail.invalidate() }, onError: (e) => toast.error(e.message) })
  const atualizarMut = trpc.configuracoesOdin.atualizarModeloEmail.useMutation({ onSuccess: () => { toast.success('Salvo'); fechar(); utils.configuracoesOdin.listarModelosEmail.invalidate() }, onError: (e) => toast.error(e.message) })
  const excluirMut = trpc.configuracoesOdin.excluirModeloEmail.useMutation({ onSuccess: () => { toast.success('Removido'); setExcluindo(null); utils.configuracoesOdin.listarModelosEmail.invalidate() }, onError: (e) => toast.error(e.message) })

  function fechar() { setModalAberto(false); setEditando(null); setForm(EMAIL_VAZIO) }
  function abrirEdicao(m: NonNullable<typeof data>[number]) {
    setEditando(m.id)
    setForm({ nome: m.nome, assunto: m.assunto, mensagem: m.mensagem, etapa: m.etapa ?? '' })
    setModalAberto(true)
  }
  function salvar() {
    if (!form.nome.trim() || !form.assunto.trim() || !form.mensagem.trim()) return
    if (editando) atualizarMut.mutate({ id: editando, ...form })
    else criarMut.mutate(form)
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setModalAberto(true)}><Plus size={14} className="mr-1" /> Novo Modelo</Button>
      </div>
      {isLoading ? <p className="text-dark-400 text-sm">Carregando...</p> : (
        <div className="space-y-2">
          {(data ?? []).map((m) => (
            <div key={m.id} className="p-3 rounded-lg border border-dark-600 bg-dark-800 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-dark-100 font-medium">{m.nome}</div>
                  <div className="text-dark-500 text-xs mt-0.5">{m.assunto}{m.etapa ? ` · ${m.etapa}` : ''}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => abrirEdicao(m)} className="text-dark-400 hover:text-gold-400"><Pencil size={14} /></button>
                  <button onClick={() => setExcluindo({ id: m.id, nome: m.nome })} className="text-dark-400 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
          {(!data || data.length === 0) && <p className="text-dark-500 text-sm">Nenhum modelo cadastrado</p>}
        </div>
      )}
      <Modal open={modalAberto} onClose={fechar} title={editando ? 'Editar Modelo' : 'Novo Modelo de E-mail'} size="md">
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            <Input label="Etapa (opcional)" value={form.etapa} onChange={(e) => setForm({ ...form, etapa: e.target.value })} />
          </div>
          <Input label="Assunto" value={form.assunto} onChange={(e) => setForm({ ...form, assunto: e.target.value })} />
          <Input label="Mensagem" value={form.mensagem} onChange={(e) => setForm({ ...form, mensagem: e.target.value })} />
          <Button className="w-full" disabled={!form.nome.trim() || !form.assunto.trim() || !form.mensagem.trim()} loading={criarMut.isPending || atualizarMut.isPending} onClick={salvar}>{editando ? 'Salvar' : 'Adicionar'}</Button>
        </div>
      </Modal>
      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Remover modelo" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Remover "{excluindo?.nome}"?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExcluindo(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={excluirMut.isPending} onClick={() => excluindo && excluirMut.mutate({ id: excluindo.id })}>Remover</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
