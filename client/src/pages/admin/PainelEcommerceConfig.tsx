import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ShoppingCart, Tv } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'

// Configuração do Painel E-commerce (João, 2026-11-18): a gestora diz de quem
// é cada conta da Aton e as 3 metas de cada vendedora. As vendas vêm sozinhas.
type Vend = { id: string; nome: string; metas: [number, number, number]; fotoPath: string | null }

const urlFoto = (p: string | null) => (!p ? null : p.startsWith('/') || p.startsWith('http') ? p : `/uploads/${p}`)
const nomeConta = (c: string) =>
  c
    .toLowerCase()
    .replace(/(^|\s)\S/g, (s) => s.toUpperCase())
    .replace(/^Ml /, 'ML ')
    .replace(/ Jt$/, ' JT')
    .replace('Tik Tok', 'TikTok')
// "250.000" / "250000" / "250.000,50" → número
const lerValor = (s: string) => {
  const t = s.trim()
  if (!t) return 0
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/\./g, '')) || 0
}
const mostrarValor = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

export default function PainelEcommerceConfig() {
  const utils = trpc.useUtils()
  const { data, isLoading, error } = trpc.painelEcommerce.config.useQuery()
  const salvar = trpc.painelEcommerce.salvarConfig.useMutation({
    onSuccess: () => (toast.success('Salvo — o telão atualiza em até 1 minuto'), utils.painelEcommerce.invalidate()),
    onError: (e) => toast.error(e.message),
  })
  const [vend, setVend] = useState<Vend[]>([])
  const [metas, setMetas] = useState<Record<string, [string, string, string]>>({})
  const [metaGeral, setMetaGeral] = useState('')
  const [contas, setContas] = useState<Record<string, string>>({})
  const [novaNome, setNovaNome] = useState('')
  const [enviandoFoto, setEnviandoFoto] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return
    setVend(data.vendedoras as Vend[])
    setMetas(Object.fromEntries(data.vendedoras.map((v) => [v.id, v.metas.map(mostrarValor) as [string, string, string]])))
    setMetaGeral(mostrarValor(data.metaGeral))
    setContas(Object.fromEntries(data.contasAton.map((c) => [c.conta, c.dona])))
  }, [data])

  if (isLoading) return <div className="h-40 animate-pulse" />
  if (error) return <p className="text-red-400">{error.message}</p>

  const somaMeta3 = vend.reduce((s, v) => s + lerValor(metas[v.id]?.[2] ?? '0'), 0)

  async function trocarFoto(id: string, f: File | undefined) {
    if (!f) return
    setEnviandoFoto(id)
    try {
      const form = new FormData()
      form.append('file', f)
      const r = await fetch('/upload/foto-vendedor', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('odin_token')}` }, body: form })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Falha ao enviar a foto')
      setVend((vs) => vs.map((v) => (v.id === id ? { ...v, fotoPath: j.path } : v)))
      toast('Foto carregada — clique em Salvar')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEnviandoFoto(null)
    }
  }

  function adicionarVendedora() {
    const nome = novaNome.trim()
    if (!nome) return
    const id = `${nome.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')}-${Date.now().toString(36)}`
    setVend((vs) => [...vs, { id, nome, metas: [0, 0, 0], fotoPath: null }])
    setMetas((m) => ({ ...m, [id]: ['', '', ''] }))
    setNovaNome('')
  }

  function removerVendedora(id: string) {
    setVend((vs) => vs.filter((v) => v.id !== id))
    setContas((c) => Object.fromEntries(Object.entries(c).map(([k, d]) => [k, d === id ? '' : d])))
  }

  function onSalvar() {
    salvar.mutate({
      metaGeral: lerValor(metaGeral),
      vendedoras: vend.map((v) => ({ ...v, metas: (metas[v.id] ?? ['', '', '']).map(lerValor) as [number, number, number] })),
      contas,
    })
  }

  const opcoes = [...vend.map((v) => ({ v: v.id, l: v.nome })), { v: '', l: 'Só soma no total geral' }, { v: 'fora', l: 'Fora do painel' }]

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
            <ShoppingCart size={20} className="text-sky-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Painel E-commerce</h1>
            <p className="text-sm text-dark-400">As vendas vêm sozinhas da Aton. Aqui você define as metas e de quem é cada conta.</p>
          </div>
        </div>
        <a href="/painel-ecommerce" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm rounded-lg px-3 py-2 border border-dark-600 text-dark-200 hover:bg-dark-800">
          <Tv size={16} /> Abrir o telão
        </a>
      </div>

      <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
        <h2 className="font-semibold text-dark-100">Metas do mês</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-dark-400 text-left">
                <th className="py-2 pr-3 font-medium">Foto</th>
                <th className="py-2 pr-3 font-medium">Vendedora</th>
                <th className="py-2 pr-3 font-medium">Meta 1 (R$)</th>
                <th className="py-2 pr-3 font-medium">Meta 2 (R$)</th>
                <th className="py-2 pr-3 font-medium">Meta 3 (R$)</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {vend.map((v) => {
                const foto = urlFoto(v.fotoPath)
                return (
                  <tr key={v.id} className="border-t border-dark-700/70">
                    <td className="py-2 pr-3">
                      <label className="cursor-pointer inline-flex" title="Trocar foto">
                        <span
                          className="w-11 h-11 rounded-full bg-[#1d3550] text-[#9cc4f0] font-bold inline-flex items-center justify-center bg-cover bg-center border border-dark-600"
                          style={{ backgroundImage: foto ? `url('${foto}')` : undefined }}
                        >
                          {enviandoFoto === v.id ? '…' : foto ? '' : v.nome[0]}
                        </span>
                        <input id={`foto-${v.id}`} type="file" accept="image/*" className="hidden" onChange={(e) => (trocarFoto(v.id, e.target.files?.[0]), (e.target.value = ''))} />
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        id={`nome-${v.id}`}
                        className="w-36 bg-dark-900 border border-dark-600 rounded-lg px-2 py-1.5 text-dark-100"
                        value={v.nome}
                        onChange={(e) => setVend((vs) => vs.map((x) => (x.id === v.id ? { ...x, nome: e.target.value } : x)))}
                      />
                    </td>
                    {[0, 1, 2].map((k) => (
                      <td key={k} className="py-2 pr-3">
                        <input
                          id={`meta-${v.id}-${k}`}
                          inputMode="decimal"
                          className="w-32 bg-dark-900 border border-dark-600 rounded-lg px-2 py-1.5 text-right font-mono text-dark-100"
                          value={metas[v.id]?.[k] ?? ''}
                          onChange={(e) =>
                            setMetas((m) => {
                              const atual = [...(m[v.id] ?? ['', '', ''])] as [string, string, string]
                              atual[k] = e.target.value
                              return { ...m, [v.id]: atual }
                            })
                          }
                        />
                      </td>
                    ))}
                    <td className="py-2 text-right">
                      <button type="button" className="text-xs text-dark-500 hover:text-red-400" onClick={() => removerVendedora(v.id)}>
                        remover
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="nova-vendedora" className="block text-xs text-dark-400 mb-1">Nova vendedora</label>
            <input id="nova-vendedora" className="w-44 bg-dark-900 border border-dark-600 rounded-lg px-2 py-1.5 text-dark-100" placeholder="Nome" value={novaNome} onChange={(e) => setNovaNome(e.target.value)} />
          </div>
          <Button size="sm" variant="secondary" onClick={adicionarVendedora}>Adicionar</Button>
          <div className="ml-auto">
            <label htmlFor="meta-geral" className="block text-xs text-dark-400 mb-1">Meta geral do e-commerce (R$)</label>
            <input id="meta-geral" inputMode="decimal" className="w-40 bg-dark-900 border border-dark-600 rounded-lg px-2 py-1.5 text-right font-mono text-dark-100" value={metaGeral} onChange={(e) => setMetaGeral(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-dark-500">
          Soma das Metas 3 das vendedoras: R$ {mostrarValor(somaMeta3)}. O ranking do telão é pelo % da Meta 1 de cada uma.
        </p>
      </section>

      <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
        <div>
          <h2 className="font-semibold text-dark-100">Contas da Aton → vendedora</h2>
          <p className="text-xs text-dark-400">Conta nova que aparecer na Aton entra aqui sozinha (e, até alguém escolher, soma só no total geral).</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-dark-400 text-left">
                <th className="py-2 pr-3 font-medium">Conta (como vem da Aton)</th>
                <th className="py-2 pr-3 font-medium text-right">Vendas no mês</th>
                <th className="py-2 font-medium">De quem é</th>
              </tr>
            </thead>
            <tbody>
              {data?.contasAton.map((c) => (
                <tr key={c.conta} className="border-t border-dark-700/70">
                  <td className="py-2 pr-3 text-dark-100">
                    {nomeConta(c.conta)}
                    {!c.pedidosMes && <span className="ml-2 text-xs rounded px-1.5 py-0.5 bg-red-900/30 text-red-300">sem pedidos este mês</span>}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-dark-300">{c.pedidosMes.toLocaleString('pt-BR')}</td>
                  <td className="py-2">
                    <select
                      id={`dona-${c.conta.replace(/\W/g, '')}`}
                      className="w-56 bg-dark-900 border border-dark-600 rounded-lg px-2 py-1.5 text-dark-100"
                      value={contas[c.conta] ?? ''}
                      onChange={(e) => setContas((m) => ({ ...m, [c.conta]: e.target.value }))}
                    >
                      {opcoes.map((o) => (
                        <option key={o.v} value={o.v}>
                          {o.l}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-dark-500">
          Valor usado: valor bruto do pedido (igual à nota), só pedidos faturados ou fechados com situação normal. Cancelados e aguardando faturar aparecem separados no telão. O "Vlr. Recebido" da Conciliação ainda não vem pela integração da Aton.
        </p>
      </section>

      <div className="flex justify-end">
        <Button onClick={onSalvar} disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Button>
      </div>
    </div>
  )
}
