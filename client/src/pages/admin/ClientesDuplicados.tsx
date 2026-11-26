import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Copy, Search, ShieldCheck } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'

// Tela "Clientes duplicados" (João, 2026-11-26 — casos DIRECIONAL BAURU e
// DOUGLAS): o gestor vê o mesmo cliente em mais de um cadastro na empresa e
// os CNPJs gravados em clientes com nomes diferentes (CNPJ errado).

const dataBr = (s: string | null) => (s ? new Date(s.replace(' ', 'T')).toLocaleDateString('pt-BR') : '—')
const cnpjFmt = (d: string) =>
  d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d || '—'

export default function ClientesDuplicados() {
  const [aba, setAba] = useState<'duplicados' | 'cnpj'>('duplicados')
  const [filtro, setFiltro] = useState<'todos' | 'gerente' | 'vendedores'>('todos')
  const [busca, setBusca] = useState('')
  const dup = trpc.clientesDuplicados.duplicados.useQuery(undefined, { enabled: aba === 'duplicados', staleTime: 5 * 60_000 })
  const cnpj = trpc.clientesDuplicados.cnpjSuspeitos.useQuery(undefined, { enabled: aba === 'cnpj', staleTime: 5 * 60_000 })
  const [receita, setReceita] = useState<Record<string, string>>({})
  const conferir = trpc.clientesDuplicados.conferirReceita.useMutation({ onError: (e) => toast.error(e.message) })

  const grupos = useMemo(() => {
    const n = busca.trim().toUpperCase()
    return (dup.data?.grupos ?? []).filter(
      (g) =>
        (filtro === 'todos' || (filtro === 'gerente' ? g.decisaoGerente : g.vendedoresDiferentes)) &&
        (!n || g.cadastros.some((c) => c.razaoSocial.toUpperCase().includes(n) || c.codigo.toUpperCase().includes(n) || (c.vendedor ?? '').toUpperCase().includes(n)))
    )
  }, [dup.data, filtro, busca])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-dark-50 flex items-center gap-2">
          <Copy size={22} /> Clientes duplicados
        </h1>
        <p className="text-sm text-dark-400 mt-1">
          O mesmo cliente em mais de um cadastro nesta empresa (mesmo nome ou telefone, sem CNPJ que prove ser outra empresa) e CNPJs gravados em clientes com nomes diferentes. Desde 26/11 o CRM não deixa mais criar duplicado; esta lista é o que já existia.
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant={aba === 'duplicados' ? 'primary' : 'secondary'} size="sm" onClick={() => setAba('duplicados')}>
          Duplicados {dup.data ? `(${dup.data.grupos.length})` : ''}
        </Button>
        <Button variant={aba === 'cnpj' ? 'primary' : 'secondary'} size="sm" onClick={() => setAba('cnpj')}>
          CNPJ suspeito {cnpj.data ? `(${cnpj.data.suspeitos.length})` : ''}
        </Button>
      </div>

      {aba === 'duplicados' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['todos', 'Todos'],
                ['vendedores', 'Em vendedores diferentes'],
                ['gerente', 'Decisão do gerente (os dois trabalham)'],
              ] as const
            ).map(([k, r]) => (
              <button
                key={k}
                onClick={() => setFiltro(k)}
                className={`px-3 py-1.5 rounded-lg text-xs border ${filtro === k ? 'bg-primary-500/20 border-primary-500/50 text-primary-200' : 'border-dark-600 text-dark-300 hover:bg-dark-700'}`}
              >
                {r}
              </button>
            ))}
            <div className="relative ml-auto">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-400" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, código ou vendedor" className="pl-8 pr-3 py-1.5 rounded-lg bg-dark-800 border border-dark-600 text-sm text-dark-100 w-64" />
            </div>
          </div>
          {dup.isLoading && <p className="text-dark-400 text-sm">Procurando duplicados…</p>}
          {dup.data && grupos.length === 0 && <p className="text-dark-400 text-sm">Nenhum duplicado com esse filtro. 🎉</p>}
          <div className="space-y-3">
            {grupos.map((g) => (
              <div key={g.cadastros.map((c) => c.id).join('-')} className={`rounded-xl border p-3 ${g.decisaoGerente ? 'border-red-500/40 bg-red-500/5' : 'border-dark-600 bg-dark-800/60'}`}>
                {g.decisaoGerente && (
                  <p className="text-xs text-red-300 mb-2 flex items-center gap-1">
                    <AlertTriangle size={13} /> Os dois cadastros têm venda ou contato com vendedores diferentes — o gerente decide de quem fica.
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-dark-400">
                        <th className="py-1 pr-3"></th>
                        <th className="py-1 pr-3">Código</th>
                        <th className="py-1 pr-3">Nome</th>
                        <th className="py-1 pr-3">CNPJ/CPF</th>
                        <th className="py-1 pr-3">Telefone</th>
                        <th className="py-1 pr-3">Carteira</th>
                        <th className="py-1 pr-3">Criado</th>
                        <th className="py-1 pr-3 text-right">Vendas</th>
                        <th className="py-1 pr-3 text-right">Contatos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.cadastros.map((c, i) => (
                        <tr key={c.id} className="border-t border-dark-700">
                          <td className="py-1.5 pr-3">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${i === 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-dark-700 text-dark-300'}`}>{i === 0 ? 'FICA' : 'cópia'}</span>
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-xs text-dark-200">{c.codigo}</td>
                          <td className="py-1.5 pr-3 text-dark-100">{c.razaoSocial}</td>
                          <td className="py-1.5 pr-3 text-dark-300">{cnpjFmt(c.cnpj)}</td>
                          <td className="py-1.5 pr-3 text-dark-300">{c.telefone || '—'}</td>
                          <td className="py-1.5 pr-3 text-dark-200">{c.vendedor ?? <span className="text-dark-500">sem vendedor</span>}</td>
                          <td className="py-1.5 pr-3 text-dark-400">{dataBr(c.criadoEm)}</td>
                          <td className="py-1.5 pr-3 text-right text-dark-200">{c.vendas ? `${c.vendas} (últ. ${dataBr(c.ultimaVenda)})` : '—'}</td>
                          <td className="py-1.5 pr-3 text-right text-dark-200">{c.contatos || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {aba === 'cnpj' && (
        <>
          <p className="text-xs text-dark-400">
            O mesmo CNPJ em clientes com nomes diferentes — normalmente um deles está com o CNPJ errado (foi o caso da DIRECIONAL BAURU com o CNPJ da CHIPCOM). Clique em “Conferir na Receita” pra ver de quem é o CNPJ e corrija o cadastro errado.
          </p>
          {cnpj.isLoading && <p className="text-dark-400 text-sm">Procurando…</p>}
          {cnpj.data && cnpj.data.suspeitos.length === 0 && <p className="text-dark-400 text-sm">Nenhum CNPJ suspeito. 🎉</p>}
          <div className="space-y-3">
            {cnpj.data?.suspeitos.map((s) => (
              <div key={s.cnpj} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <span className="font-mono text-sm text-amber-200">{cnpjFmt(s.cnpj)}</span>
                  {receita[s.cnpj] ? (
                    <span className="text-xs text-emerald-300 flex items-center gap-1">
                      <ShieldCheck size={13} /> Na Receita: <b>{receita[s.cnpj]}</b>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={conferir.isPending && conferir.variables?.cnpj === s.cnpj}
                      onClick={() => conferir.mutate({ cnpj: s.cnpj }, { onSuccess: (r) => setReceita((x) => ({ ...x, [s.cnpj]: r.razaoSocial })) })}
                    >
                      Conferir na Receita
                    </Button>
                  )}
                </div>
                <ul className="text-sm space-y-1">
                  {s.cadastros.map((c) => (
                    <li key={c.id} className={c.aqui ? 'text-dark-100' : 'text-dark-400'}>
                      <span className="font-mono text-xs">{c.codigo}</span> · {c.razaoSocial} · {c.empresa} · {c.vendedor ?? 'sem vendedor'}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
