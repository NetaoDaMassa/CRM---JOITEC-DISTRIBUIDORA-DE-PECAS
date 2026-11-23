// Base de conhecimento ("second brain") — João, 2026-11-23: playbook,
// catálogos, descrição da empresa, informações fiscais… A IA do marketing lê
// tudo daqui (roteiros, legendas, nota, ideias, adaptar brainstorm, persona).
// PDF e texto têm o conteúdo lido no navegador; o arquivo vai para
// Arquivos/Mídia → Marketing → Base de conhecimento.
import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { BookOpen, Paperclip } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { cls, dataHora, extrairTexto, fmtN, subirArquivo } from './comum'

type Item = { id: number; empresaId: number | null; categoria: string; titulo: string; texto: string; arquivoNome: string | null; arquivoPath: string | null; updatedAt: string }
type Form = { id?: number; empresaId: number | null; categoria: string; titulo: string; texto: string; arquivo?: { path: string; nome: string; tipo: string; tamanho: number } }

function Editor({ f0, categorias, nomeMarca, empresaId, onClose }: { f0: Form; categorias: readonly string[]; nomeMarca: string; empresaId: number; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [f, setF] = useState<Form>(f0)
  const [lendo, setLendo] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const salvar = trpc.marketingModulo.salvarConhecimento.useMutation({ onSuccess: () => { utils.marketingModulo.conhecimento.invalidate(); toast.success('Salvo — a IA já usa'); onClose() }, onError: (e) => toast.error(e.message) })
  const arquivo = async (file?: File) => {
    if (!file) return
    setLendo(true)
    try {
      const [texto, up] = await Promise.all([extrairTexto(file).catch(() => null), subirArquivo(file)])
      setF((o) => ({ ...o, arquivo: up, titulo: o.titulo || file.name.replace(/\.[^.]+$/, ''), texto: texto ? (o.texto ? o.texto + '\n\n' : '') + texto : o.texto }))
      if (texto) toast.success(`Li ${fmtN(texto.length)} caracteres do arquivo`)
      else toast('Não consigo ler esse tipo de arquivo. Ele fica guardado, mas cole abaixo o texto principal para a IA usar.', { duration: 9000, icon: 'ℹ️' })
    } catch (e) { toast.error((e as Error).message) }
    setLendo(false)
    if (input.current) input.current.value = ''
  }
  const campo = (rot: string, el: React.ReactNode) => <label className="block space-y-1"><span className={cls.rotulo}>{rot}</span>{el}</label>
  return (
    <Modal open onClose={onClose} title={f.id ? 'Editar documento' : 'Novo documento na base'} size="xl">
      <div className="space-y-3">
        <div className="grid md:grid-cols-[1.5fr_1fr_1fr] gap-3">
          {campo('Título', <input className={cls.input} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Catálogo de compressores 2026" />)}
          {campo('Categoria', <select className={cls.input} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}>{categorias.map((c) => <option key={c}>{c}</option>)}</select>)}
          {campo('Vale para', <select className={cls.input} value={f.empresaId === null ? 'grupo' : 'marca'} onChange={(e) => setF({ ...f, empresaId: e.target.value === 'grupo' ? null : empresaId })}><option value="marca">Só {nomeMarca}</option><option value="grupo">Todo o Grupo Odin</option></select>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => input.current?.click()} loading={lendo}><Paperclip className="w-4 h-4 mr-1 inline" />{lendo ? 'Lendo o arquivo…' : 'Subir arquivo (PDF, TXT, CSV)'}</Button>
          <input ref={input} type="file" className="hidden" onChange={(e) => arquivo(e.target.files?.[0])} />
          {f.arquivo && <span className="text-xs text-green-400">📎 {f.arquivo.nome}</span>}
          <span className="text-xs text-dark-400">O texto do PDF é lido sozinho. Word/Excel/imagem: suba o arquivo e cole o texto abaixo.</span>
        </div>
        {campo(`Conteúdo que a IA vai ler (${fmtN(f.texto.length)} caracteres)`, <textarea rows={16} className={cls.input + ' text-[13px]'} value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} placeholder="Cole aqui: descrição da empresa, linhas de produto e diferenciais, jeito de falar, palavras proibidas, regras fiscais (ex.: não prometer frete grátis), CNPJ, endereço, horários…" />)}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate({ ...f, empresaId: f.empresaId as any })} loading={salvar.isPending} disabled={lendo || !f.titulo.trim()}>Salvar</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function BaseConhecimento({ empresaId, nomeMarca }: { empresaId: number; nomeMarca: string }) {
  const utils = trpc.useUtils()
  const q = trpc.marketingModulo.conhecimento.useQuery({ empresaId })
  const excluir = trpc.marketingModulo.excluirConhecimento.useMutation({ onSuccess: () => utils.marketingModulo.conhecimento.invalidate() })
  const [editar, setEditar] = useState<Form | null>(null)
  const [aberto, setAberto] = useState<number | null>(null)
  const d = q.data
  const itens = (d?.itens || []) as Item[]
  const cats = d?.categorias || []
  const passou = d && d.caracteres > d.limite
  return (
    <section className={cls.card + ' p-4 space-y-3'}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-dark-100 flex items-center gap-2"><BookOpen className="w-5 h-5 text-gold-400" />Base de conhecimento · a IA lê tudo daqui</h3>
          <p className="text-sm text-dark-400">Playbook, catálogos, descrição da empresa, informações fiscais e de produto. Toda IA do marketing (roteiro, legenda, nota, ideias, brainstorm) usa isto para acertar produto e jeito de falar.</p>
        </div>
        <Button size="sm" onClick={() => setEditar({ empresaId, categoria: cats[0] || 'Informações gerais', titulo: '', texto: '' })}>+ Adicionar documento</Button>
      </div>
      {d && <div className={`text-xs ${passou ? 'text-orange-300' : 'text-dark-400'}`}>{itens.length} documento(s) · {fmtN(d.caracteres)} caracteres{passou ? ` — a IA lê os primeiros ${fmtN(d.limite)} (grupo primeiro, depois a marca, na ordem das categorias). Deixe só o essencial.` : ''}</div>}
      {!itens.length && <p className="text-sm text-dark-400">Nada ainda. Comece por "Descrição da empresa" e "Produtos e catálogo".</p>}
      <div className="space-y-2">
        {cats.map((c) => {
          const arr = itens.filter((i) => i.categoria === c)
          if (!arr.length) return null
          return (
            <div key={c} className="space-y-1.5">
              <div className={cls.rotulo}>{c}</div>
              {arr.map((i) => (
                <div key={i.id} className="bg-dark-900/60 border border-dark-700 rounded-lg p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="flex-1 min-w-[200px] text-left font-semibold text-dark-100 hover:text-gold-300" onClick={() => setAberto(aberto === i.id ? null : i.id)}>{i.titulo}</button>
                    {i.empresaId === null && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-200">todo o grupo</span>}
                    {i.arquivoPath && <a href={i.arquivoPath} target="_blank" rel="noopener noreferrer" className="text-xs text-gold-400 hover:underline">📎 {i.arquivoNome}</a>}
                    <span className="text-xs text-dark-500">{fmtN(i.texto.length)} car. · {dataHora(i.updatedAt)}</span>
                    <Button size="sm" variant="ghost" onClick={() => setEditar({ id: i.id, empresaId: i.empresaId, categoria: i.categoria, titulo: i.titulo, texto: i.texto })}>Editar</Button>
                    <Button size="sm" variant="danger" onClick={() => confirm(`Excluir "${i.titulo}" da base?`) && excluir.mutate({ id: i.id })}>Excluir</Button>
                  </div>
                  {aberto === i.id && <pre className="mt-2 whitespace-pre-wrap text-xs text-dark-300 max-h-80 overflow-y-auto">{i.texto || '(sem texto)'}</pre>}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {editar && <Editor f0={editar} categorias={cats} nomeMarca={nomeMarca} empresaId={empresaId} onClose={() => setEditar(null)} />}
    </section>
  )
}
