// Campo CNPJ/CPF das Propostas (Odin) — obrigatório desde 2026-11-17
// (Agatta/João: muita proposta duplicada pro mesmo cliente). Valida, busca
// razão social na Receita (CNPJ) e mostra as propostas que já existem pro
// mesmo documento, pra não abrir outro card do mesmo cliente.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Search } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { PROPOSTA_STAGE_LABELS, type PropostaStage } from '../../lib/propostasShared'
import { documentoValido, soDigitos } from '../../lib/documentoCliente'
import { formatDateTime } from '../../lib/utils'

export default function CampoCnpjProposta({
  valor,
  onChange,
  aoAcharRazao,
  ignorarId,
  disabled,
  aoAbrirProposta,
}: {
  valor: string
  onChange: (v: string) => void
  aoAcharRazao?: (razao: string) => void
  ignorarId?: number
  disabled?: boolean
  aoAbrirProposta?: (id: number) => void
}) {
  const d = soDigitos(valor)
  const valido = documentoValido(d)
  const [buscar, setBuscar] = useState('')
  const { data: existentes } = trpc.propostas.porDocumento.useQuery({ cnpj: d }, { enabled: valido })
  const outras = (existentes ?? []).filter((p) => p.id !== ignorarId)
  const receita = trpc.clientes.cnpjLookup.useQuery({ cnpj: buscar }, { enabled: !!buscar, retry: false })

  useEffect(() => {
    if (!buscar || receita.isFetching) return
    if (receita.error) toast.error(receita.error.message)
    else if (!receita.data) toast.error('CNPJ não encontrado na Receita')
    else if (receita.data.razaoSocial) {
      aoAcharRazao?.(receita.data.razaoSocial)
      toast.success('Razão social preenchida pela Receita')
    }
    setBuscar('')
  }, [buscar, receita.isFetching, receita.data, receita.error])

  return (
    <div>
      <label className="text-sm text-dark-200 font-medium">CNPJ do cliente * <span className="text-dark-500 font-normal text-xs">(ou CPF, se pessoa física)</span></label>
      <div className="flex gap-2 mt-1">
        <input
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="00.000.000/0000-00"
          inputMode="numeric"
          className={`flex-1 min-w-0 bg-dark-800 border rounded-lg px-3 py-2 text-sm text-dark-100 focus:outline-none disabled:opacity-60 ${d && !valido ? 'border-red-600' : 'border-dark-600 focus:border-gold-600'}`}
        />
        {aoAcharRazao && !disabled && d.length === 14 && valido && (
          <button type="button" onClick={() => setBuscar(d)} className="shrink-0 flex items-center gap-1 rounded-lg border border-dark-600 px-3 text-xs text-dark-200 hover:bg-dark-700">
            <Search size={12} /> {receita.isFetching ? 'Buscando…' : 'Buscar nome'}
          </button>
        )}
      </div>
      {d && !valido && <p className="text-xs text-red-400 mt-1">{d.length < 11 || (d.length > 11 && d.length < 14) ? 'Incompleto' : 'CNPJ/CPF inválido'}</p>}
      {valido && outras.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-700/50 bg-amber-900/15 px-3 py-2 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-amber-400">
            <AlertTriangle size={13} /> Esse cliente já tem {outras.length} proposta{outras.length > 1 ? 's' : ''} — confira antes de criar outra
          </p>
          <ul className="mt-1.5 space-y-1">
            {outras.slice(0, 6).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-2 text-dark-300">
                {aoAbrirProposta ? (
                  <button type="button" onClick={() => aoAbrirProposta(p.id)} className="text-blue-400 hover:underline">#{p.id}</button>
                ) : (
                  <span className="text-dark-200">#{p.id}</span>
                )}
                <span>{p.clienteNome}</span>
                <span className="text-dark-500">· {PROPOSTA_STAGE_LABELS[p.stage as PropostaStage] ?? p.stage}</span>
                <span className="text-dark-500">· {p.vendedor?.name ?? '—'}</span>
                <span className="text-dark-500">· {formatDateTime(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
