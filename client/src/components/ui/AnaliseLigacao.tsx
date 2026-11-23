import { useState } from 'react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'

// "Analisar ligação" (João, 2026-11-23): a IA transcreve a gravação e dá
// nota + o que foi bem + o que melhorar. Servidor: lib/avaliacaoLigacao.ts.
// Só consulta quando a pessoa clica (não pesa nas listas com muitas gravações).
// Só gestores veem (admin/gestor/superAdmin) — João, 2026-11-23.
export default function AnaliseLigacao({ ligacaoId }: { ligacaoId: number }) {
  const { user } = useAuth()
  if (!user || (user.role === 'vendor' && !user.superAdmin)) return null
  return <AnaliseLigacaoGestor ligacaoId={ligacaoId} />
}

function AnaliseLigacaoGestor({ ligacaoId }: { ligacaoId: number }) {
  const [aberta, setAberta] = useState(false)
  const [verTranscricao, setVerTranscricao] = useState(false)
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.pabx.avaliacaoLigacao.useQuery(
    { ligacaoId },
    { enabled: aberta, refetchInterval: (q) => (q.state.data?.avaliacao?.status === 'processando' ? 3000 : false) }
  )
  const analisar = trpc.pabx.avaliarLigacao.useMutation({ onSuccess: () => utils.pabx.avaliacaoLigacao.invalidate({ ligacaoId }) })

  const abrir = async () => {
    setAberta(true)
    const atual = await utils.pabx.avaliacaoLigacao.fetch({ ligacaoId })
    if (atual.disponivel && !atual.avaliacao) analisar.mutate({ ligacaoId })
  }

  if (!aberta)
    return (
      <button type="button" onClick={(e) => (e.stopPropagation(), abrir())} className="text-gold-400 hover:underline text-sm">
        ✨ Análise da IA
      </button>
    )

  const a = data?.avaliacao
  const processando = analisar.isPending || a?.status === 'processando' || (isLoading && !data)
  const corNota = (n: number) => (n >= 8 ? 'bg-emerald-500/20 text-emerald-300' : n >= 5 ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-300')

  return (
    <div onClick={(e) => e.stopPropagation()} className="rounded-lg border border-dark-600 bg-dark-800/60 p-3 space-y-2 text-sm max-w-2xl">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-dark-100">✨ Análise da IA</span>
        <button type="button" onClick={() => setAberta(false)} className="text-xs text-dark-400 hover:underline">fechar</button>
      </div>
      {data && !data.disponivel && <p className="text-dark-300">A IA não está configurada no servidor.</p>}
      {processando && <p className="text-dark-300">Ouvindo a ligação e avaliando… leva uns 20–40 segundos.</p>}
      {analisar.error && <p className="text-red-300">{analisar.error.message}</p>}
      {a?.status === 'erro' && !processando && (
        <div className="space-y-1">
          <p className="text-red-300">Não deu certo: {a.erro}</p>
          <button type="button" onClick={() => analisar.mutate({ ligacaoId })} className="text-gold-400 hover:underline">Tentar de novo</button>
        </div>
      )}
      {a?.status === 'pronta' && !processando && (
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <span className={`shrink-0 rounded-md px-2 py-1 text-lg font-bold ${corNota(a.nota ?? 0)}`}>{a.nota}/10</span>
            <p className="text-dark-200">{a.resumo}</p>
          </div>
          {a.pontosFortes.length > 0 && (
            <div>
              <p className="text-emerald-300 font-medium">O que foi bem</p>
              <ul className="list-disc pl-5 text-dark-200 space-y-0.5">{a.pontosFortes.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          {a.pontosMelhorar.length > 0 && (
            <div>
              <p className="text-amber-300 font-medium">O que melhorar</p>
              <ul className="list-disc pl-5 text-dark-200 space-y-0.5">{a.pontosMelhorar.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          {a.proximoPasso && (
            <p className="text-dark-200"><span className="text-sky-300 font-medium">Próximo passo: </span>{a.proximoPasso}</p>
          )}
          <div className="flex flex-wrap gap-3 text-xs">
            <button type="button" onClick={() => setVerTranscricao((v) => !v)} className="text-gold-400 hover:underline">
              {verTranscricao ? 'Esconder transcrição' : 'Ver transcrição'}
            </button>
            <button type="button" onClick={() => analisar.mutate({ ligacaoId })} className="text-dark-400 hover:underline">Avaliar de novo</button>
          </div>
          {verTranscricao && <p className="whitespace-pre-wrap text-dark-300 text-xs border-t border-dark-600 pt-2">{a.transcricao}</p>}
        </div>
      )}
    </div>
  )
}
