import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { Input, Textarea } from '../components/ui/Input'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'

const OCORRENCIA_LABEL: Record<string, string> = {
  envio_errado: 'Envio errado',
  falta_materiais: 'Falta de materiais',
  produto_defeito: 'Produto com defeito',
  outro: 'Outro',
}

async function uploadAnexoPublico(file: File): Promise<{ path: string; nome: string; tipo: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/upload/devolucao-anexo-publico', { method: 'POST', body: form })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Falha ao enviar o arquivo')
  return { path: data.path, nome: data.nome, tipo: data.tipo }
}

// Formulário público (sem login) pro cliente abrir um chamado de devolução
// — link a ser compartilhado direto com o cliente. Reaproveita a mesma
// visão sóbria do /login (sem Sidebar/Layout, é uma página de fora).
export default function DevolucaoSolicitar() {
  const { data: empresas } = trpc.devolucoes.listarEmpresasPublico.useQuery()
  const [empresaId, setEmpresaId] = useState('')
  const [clienteNome, setClienteNome] = useState('')
  const [clienteCnpj, setClienteCnpj] = useState('')
  const [clienteWhatsapp, setClienteWhatsapp] = useState('')
  const [clienteEmail, setClienteEmail] = useState('')
  const [numeroNotaFiscal, setNumeroNotaFiscal] = useState('')
  const [descricao, setDescricao] = useState('')
  const [ocorrencias, setOcorrencias] = useState<string[]>([])
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [protocoloGerado, setProtocoloGerado] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const criarMut = trpc.devolucoes.criarPublico.useMutation()
  const anexarMut = trpc.devolucoes.anexarArquivoPublico.useMutation()

  function toggleOcorrencia(tipo: string) {
    setOcorrencias((prev) => (prev.includes(tipo) ? prev.filter((t) => t !== tipo) : [...prev, tipo]))
  }

  async function enviar() {
    if (!empresaId) return toast.error('Selecione a empresa')
    if (!clienteNome.trim()) return toast.error('Informe o nome do cliente/empresa')
    if (!descricao.trim()) return toast.error('Descreva o que aconteceu')
    if (!ocorrencias.length) return toast.error('Marque ao menos um tipo de ocorrência')

    setEnviando(true)
    try {
      const result = await criarMut.mutateAsync({
        empresaId: Number(empresaId),
        clienteNome,
        clienteCnpj: clienteCnpj || undefined,
        clienteWhatsapp: clienteWhatsapp || undefined,
        clienteEmail: clienteEmail || undefined,
        numeroNotaFiscal: numeroNotaFiscal || undefined,
        descricao,
        ocorrencias: ocorrencias.map((tipo) => ({ tipo: tipo as any })),
      })
      if (arquivo) {
        const up = await uploadAnexoPublico(arquivo)
        await anexarMut.mutateAsync({ protocolo: result.protocolo, urlArquivo: up.path, nomeArquivo: up.nome, tipoArquivo: up.tipo })
      }
      setProtocoloGerado(result.protocolo)
    } catch (err: any) {
      toast.error(err.message ?? 'Não foi possível enviar o chamado')
    } finally {
      setEnviando(false)
    }
  }

  if (protocoloGerado) {
    return (
      <div className="min-h-screen bg-dark-950 flex items-center justify-center p-6">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-8 max-w-md text-center space-y-3">
          <p className="text-2xl">✅</p>
          <h1 className="font-heading text-xl text-gold-400 font-bold">Chamado aberto</h1>
          <p className="text-dark-300 text-sm">Anote o protocolo abaixo pra acompanhar o andamento:</p>
          <p className="text-2xl font-mono text-dark-50 bg-dark-900 rounded-xl py-3">{protocoloGerado}</p>
          <a href="/devolucao/acompanhar" className="text-sm text-gold-400 underline">
            Acompanhar chamado
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark-950 py-10 px-4">
      <div className="max-w-xl mx-auto bg-dark-800 border border-dark-600 rounded-2xl p-6 sm:p-8 space-y-4">
        <div>
          <h1 className="font-heading text-xl text-gold-400 font-bold">Solicitação de devolução</h1>
          <p className="text-dark-400 text-sm mt-1">Preencha os dados abaixo pra abrir um chamado.</p>
        </div>

        <Select
          label="Empresa"
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          placeholder="Selecione..."
          options={(empresas ?? []).map((e) => ({ value: e.id, label: e.nome }))}
        />
        <Input label="Nome do cliente/empresa" value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} required />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="CNPJ (se tiver)" value={clienteCnpj} onChange={(e) => setClienteCnpj(e.target.value)} />
          <Input label="Número da nota fiscal" value={numeroNotaFiscal} onChange={(e) => setNumeroNotaFiscal(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="WhatsApp" value={clienteWhatsapp} onChange={(e) => setClienteWhatsapp(e.target.value)} />
          <Input label="E-mail" value={clienteEmail} onChange={(e) => setClienteEmail(e.target.value)} />
        </div>

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

        <div>
          <p className="text-sm text-dark-200 font-medium mb-1.5">Foto/documento (opcional)</p>
          <input
            type="file"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            className="text-sm text-dark-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-dark-600 file:bg-dark-800 file:text-dark-200"
          />
        </div>

        <Button className="w-full" loading={enviando} onClick={enviar}>
          Enviar solicitação
        </Button>
      </div>
    </div>
  )
}
