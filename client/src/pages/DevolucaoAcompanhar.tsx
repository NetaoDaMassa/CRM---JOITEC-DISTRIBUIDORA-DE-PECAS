import { useState } from 'react'
import { trpc } from '../lib/trpc'
import { Input } from '../components/ui/Input'
import Button from '../components/ui/Button'

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

function formatarData(v: string): string {
  return new Date(v.replace(' ', 'T')).toLocaleString('pt-BR')
}

// Rastreio público (sem login) por número de protocolo.
export default function DevolucaoAcompanhar() {
  const [protocoloInput, setProtocoloInput] = useState('')
  const [protocoloBusca, setProtocoloBusca] = useState<string | null>(null)

  const { data, isLoading, isError } = trpc.devolucoes.rastrearPublico.useQuery(
    { protocolo: protocoloBusca ?? '' },
    { enabled: !!protocoloBusca }
  )

  return (
    <div className="min-h-screen bg-dark-950 py-10 px-4">
      <div className="max-w-lg mx-auto bg-dark-800 border border-dark-600 rounded-2xl p-6 sm:p-8 space-y-4">
        <div>
          <h1 className="font-heading text-xl text-gold-400 font-bold">Acompanhar chamado</h1>
          <p className="text-dark-400 text-sm mt-1">Informe o número de protocolo recebido na abertura.</p>
        </div>

        <div className="flex gap-2">
          <Input value={protocoloInput} onChange={(e) => setProtocoloInput(e.target.value)} placeholder="Ex: JOI-2026-00001" className="flex-1" />
          <Button onClick={() => setProtocoloBusca(protocoloInput.trim())}>Buscar</Button>
        </div>

        {isLoading && <p className="text-dark-400 text-sm">Buscando...</p>}
        {isError && <p className="text-red-400 text-sm">Protocolo não encontrado.</p>}

        {data && (
          <div className="space-y-4 pt-2">
            <div className="bg-dark-900/40 border border-dark-700 rounded-2xl p-4">
              <p className="text-lg font-mono text-dark-50">{data.protocolo}</p>
              <p className="text-sm text-gold-400 font-medium mt-1">{STATUS_LABEL[data.status] ?? data.status}</p>
              <p className="text-sm text-dark-300 mt-2 whitespace-pre-wrap">{data.descricao}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-dark-400 uppercase tracking-wide mb-2">Histórico</p>
              <div className="space-y-1.5">
                {data.historico.map((h, i) => (
                  <div key={i} className="text-xs text-dark-300 flex justify-between">
                    <span>{STATUS_LABEL[h.statusNovo] ?? h.statusNovo}</span>
                    <span className="text-dark-500">{formatarData(h.alteradoEm)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
