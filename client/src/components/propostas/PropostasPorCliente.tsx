// Visão "Por cliente" das Propostas (Odin) — pedido do João/Agatta,
// 2026-11-17: procurar o cliente (nome ou CNPJ, na busca lá de cima) e ver
// todas as propostas que ele já teve, de qualquer vendedor e de qualquer
// época, com o PDF de cada uma. Agrupa pelo CNPJ/CPF; proposta antiga sem
// CNPJ cai num grupo pelo nome, marcado "sem CNPJ".
import { useMemo, useState } from 'react'
import { Building2, FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { PROPOSTA_STAGE_COLORS, PROPOSTA_STAGE_LABELS, type PropostaStage } from '../../lib/propostasShared'
import { formatarDocumento, soDigitos } from '../../lib/documentoCliente'
import { formatDateTime } from '../../lib/utils'
import type { PropostaCard } from '../PropostasBoard'

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(ltda|me|epp|eireli|s\/?a)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

type Grupo = { chave: string; documento: string | null; nome: string; propostas: PropostaCard[]; ultima: string }

export default function PropostasPorCliente({ lista, filtrando, mostrarVendedor, aoAbrir }: { lista: PropostaCard[]; filtrando: boolean; mostrarVendedor: boolean; aoAbrir: (id: number) => void }) {
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [limite, setLimite] = useState(60)

  const grupos = useMemo(() => {
    const m = new Map<string, Grupo>()
    for (const p of lista) {
      const doc = soDigitos(p.cnpj)
      const chave = doc ? `doc:${doc}` : `nome:${normalizar(p.clienteNome)}`
      const g = m.get(chave) ?? { chave, documento: doc || null, nome: p.clienteNome.trim(), propostas: [], ultima: '' }
      g.propostas.push(p)
      if (p.createdAt > g.ultima) {
        g.ultima = p.createdAt
        g.nome = p.clienteNome.trim()
      }
      m.set(chave, g)
    }
    for (const g of m.values()) g.propostas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    return [...m.values()].sort((a, b) => (a.ultima < b.ultima ? 1 : -1))
  }, [lista])

  const repetidos = grupos.filter((g) => g.propostas.length > 1).length
  const abrirTudo = filtrando && grupos.length <= 5

  function toggle(k: string) {
    setAbertos((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  }

  if (!grupos.length) return <p className="text-sm text-dark-500 text-center py-10">Nenhum cliente encontrado. Busque pelo nome ou CNPJ lá em cima.</p>

  return (
    <div className="space-y-2">
      <p className="text-xs text-dark-400">
        {grupos.length} cliente{grupos.length === 1 ? '' : 's'} · {lista.length} proposta{lista.length === 1 ? '' : 's'}
        {repetidos > 0 && <> · <span className="text-amber-400">{repetidos} com mais de uma proposta</span></>}
        {!filtrando && <> · use a busca (nome ou CNPJ) pra achar um cliente</>}
      </p>
      {grupos.slice(0, limite).map((g) => {
        const aberto = abrirTudo || abertos.has(g.chave)
        const etapas = new Map<string, number>()
        for (const p of g.propostas) etapas.set(p.stage, (etapas.get(p.stage) ?? 0) + 1)
        return (
          <div key={g.chave} className="rounded-xl border border-dark-600 bg-dark-800/60 overflow-hidden">
            <button onClick={() => toggle(g.chave)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-dark-800">
              {aberto ? <ChevronDown size={14} className="text-dark-400 shrink-0" /> : <ChevronRight size={14} className="text-dark-400 shrink-0" />}
              <Building2 size={15} className="text-dark-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-dark-100 truncate">{g.nome}</p>
                <p className="text-xs text-dark-500">
                  {g.documento ? formatarDocumento(g.documento) : <span className="text-amber-500">sem CNPJ</span>} · última em {formatDateTime(g.ultima)}
                </p>
              </div>
              <div className="hidden sm:flex items-center gap-1 flex-wrap justify-end">
                {[...etapas.entries()].map(([st, n]) => (
                  <span key={st} className={`text-[10px] rounded-full border px-1.5 py-0.5 ${PROPOSTA_STAGE_COLORS[st as PropostaStage] ?? 'text-dark-300 border-dark-600'}`}>
                    {PROPOSTA_STAGE_LABELS[st as PropostaStage] ?? st}
                    {n > 1 ? ` ×${n}` : ''}
                  </span>
                ))}
              </div>
              <span className={`shrink-0 text-xs font-semibold rounded-full px-2 py-0.5 ${g.propostas.length > 1 ? 'bg-amber-900/40 text-amber-300' : 'bg-dark-700 text-dark-300'}`}>{g.propostas.length}</span>
            </button>
            {aberto && (
              <div className="border-t border-dark-700 divide-y divide-dark-700">
                {g.propostas.map((p) => {
                  const pdfs = p.arquivos.filter((a) => a.fileCategory === 'proposta_pdf').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                  return (
                    <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs hover:bg-dark-800/80">
                      <button onClick={() => aoAbrir(p.id)} className="font-semibold text-blue-400 hover:underline">#{p.id}</button>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${PROPOSTA_STAGE_COLORS[p.stage as PropostaStage] ?? ''}`}>{PROPOSTA_STAGE_LABELS[p.stage as PropostaStage] ?? p.stage}</span>
                      <span className="text-dark-400">{formatDateTime(p.createdAt)}</span>
                      {mostrarVendedor && <span className="text-dark-300">{p.vendedor?.name ?? '—'}</span>}
                      <span className="flex-1 min-w-[140px] text-dark-300 truncate">{p.produtosDescricao?.replace(/\s+/g, ' ') ?? ''}</span>
                      {pdfs.length > 0 ? (
                        <a href={`/proposta-arquivo/${pdfs[0].nomeArmazenado}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-gold-400 hover:underline">
                          <FileText size={12} /> PDF{pdfs.length > 1 ? ` (${pdfs.length})` : ''}
                        </a>
                      ) : (
                        <span className="text-dark-600">sem PDF</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      {grupos.length > limite && (
        <button onClick={() => setLimite(limite + 60)} className="w-full rounded-lg border border-dark-600 py-2 text-xs text-dark-300 hover:bg-dark-800">
          Mostrar mais clientes ({grupos.length - limite} restantes)
        </button>
      )}
    </div>
  )
}
