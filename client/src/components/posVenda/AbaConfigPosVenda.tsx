// Config. Odin → Pós-venda: o PDF padrão que vai pro cliente (cuidados,
// plano de preventiva, garantia — um geral e, se quiser, um por modelo) e
// quem recebe os Agendamentos de peças. Pedido do João, 2026-10-29.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FileText, Trash2, Upload } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import Select from '../ui/Select'
import PassoAPasso from './PassoAPasso'

export default function AbaConfigPosVenda() {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.posVendaOdin.configObter.useQuery()
  const [vendedorId, setVendedorId] = useState('')
  const [dias, setDias] = useState('30')
  const [titulo, setTitulo] = useState('Guia do equipamento: cuidados, manutenção preventiva e garantia')
  const [modelo, setModelo] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!data) return
    setVendedorId(data.vendedorPecasId ? String(data.vendedorPecasId) : '')
    setDias(String(data.diasPrimeiroContato))
  }, [data])

  const salvarMut = trpc.posVendaOdin.configSalvar.useMutation({ onSuccess: () => { toast.success('Salvo'); utils.posVendaOdin.configObter.invalidate() }, onError: (e) => toast.error(e.message) })
  const criarDocMut = trpc.posVendaOdin.documentoCriar.useMutation({ onSuccess: () => { toast.success('Documento adicionado'); setModelo(''); utils.posVendaOdin.configObter.invalidate() }, onError: (e) => toast.error(e.message) })
  const removerDocMut = trpc.posVendaOdin.documentoRemover.useMutation({ onSuccess: () => utils.posVendaOdin.configObter.invalidate(), onError: (e) => toast.error(e.message) })

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.type !== 'application/pdf') { toast.error('Envie um arquivo PDF'); return }
    if (!titulo.trim()) { toast.error('Dê um nome para o documento'); return }
    setEnviando(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const token = localStorage.getItem('odin_token')
      const resp = await fetch('/upload/ordem-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
      criarDocMut.mutate({ titulo, modelo: modelo || undefined, nomeOriginal: json.nome, nomeArmazenado: json.path.replace('/uploads/', '') })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>

  return (
    <div className="space-y-6 max-w-3xl">
      <PassoAPasso
        chave="config_pos_venda"
        titulo="Como configurar"
        passos={[
          <>Em <b>Nome do documento</b>, escreva como o cliente vai ver o nome do PDF.</>,
          <>Deixe <b>Só para o modelo</b> em branco para o PDF valer para todas as máquinas. Para um PDF de um modelo só, escreva parte do nome do modelo (ex.: <b>SRP 4010</b>).</>,
          <>Clique em <b>Escolher PDF e adicionar</b> e escolha o arquivo. Ele aparece na lista acima.</>,
          <>Em <b>Agendamentos de peças</b>, escolha <b>quem recebe</b> (a Bruna) e quantos dias depois da venda fazer o primeiro contato quando não houver data de preventiva. Clique em <b>Salvar</b>.</>,
        ]}
        dicas={['Para trocar um PDF, adicione o novo e apague o antigo na lixeira.', 'Pedido com mais de um modelo recebe todos os PDFs que servirem.']}
      />
      <section className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-dark-100 mb-1">Documento enviado ao cliente</h2>
        <p className="text-sm text-dark-400 mb-4">
          PDF com os cuidados com o equipamento, o plano de manutenção preventiva e a garantia. Vai junto com a pesquisa de satisfação na etapa Pós-venda dos pedidos de máquina.
          Deixe o modelo em branco para valer para todas as máquinas, ou preencha (ex.: "SRP 4010") para um PDF só daquele modelo.
        </p>
        {data.documentos.length > 0 && (
          <div className="space-y-2 mb-4">
            {data.documentos.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border border-dark-700 px-3 py-2">
                <FileText size={16} className="text-gold-400 shrink-0" />
                <a href={d.url} target="_blank" rel="noreferrer" className="text-sm text-dark-100 hover:underline flex-1 min-w-0 truncate">{d.titulo}</a>
                <span className="text-xs text-dark-500 shrink-0">{d.modelo ? `Modelo ${d.modelo}` : 'Todas as máquinas'}</span>
                <button onClick={() => removerDocMut.mutate({ id: d.id })} className="text-dark-500 hover:text-red-400" title="Remover"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
          <Input label="Nome do documento" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          <Input label="Só para o modelo (opcional)" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Todas" />
        </div>
        <label className={`mt-3 inline-flex items-center gap-2 rounded-lg border border-gold-600/60 bg-gold-900/20 px-3 py-2 text-sm text-gold-300 cursor-pointer hover:bg-gold-900/30 ${enviando ? 'opacity-60 pointer-events-none' : ''}`}>
          <Upload size={15} /> {enviando ? 'Enviando...' : 'Escolher PDF e adicionar'}
          <input type="file" accept="application/pdf" className="hidden" onChange={upload} />
        </label>
      </section>

      <section className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-dark-100 mb-1">Agendamentos de peças</h2>
        <p className="text-sm text-dark-400 mb-4">
          Quando um pedido de compressor é concluído (botão "Enviar para a carteira da Bruna" ou resposta da pesquisa), o sistema cria um agendamento na coluna "Agendamentos" do Kanban desta pessoa. O primeiro contato é na data da 1ª preventiva informada no Pós-venda; sem essa data, usa os dias abaixo.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="Quem recebe" value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} placeholder="Escolha" options={data.vendedores.map((v) => ({ value: String(v.id), label: v.name }))} />
          <Input label="Primeiro contato após quantos dias (sem data de preventiva)" type="number" min={0} max={365} value={dias} onChange={(e) => setDias(e.target.value)} />
        </div>
        <Button size="sm" className="mt-3" disabled={!vendedorId} loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ vendedorPecasId: Number(vendedorId), diasPrimeiroContato: Number(dias) || 0 })}>
          Salvar
        </Button>
      </section>
    </div>
  )
}
