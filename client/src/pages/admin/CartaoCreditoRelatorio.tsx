import { useState } from 'react'
import toast from 'react-hot-toast'
import { CreditCard, Paperclip, FileDown } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { usePersistedState } from '../../lib/usePersistedState'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { hojeBrString } from '../../lib/utils'
import { formatarMoeda } from '../../lib/moeda'
import BotaoImprimir from '../../components/relatorios/BotaoImprimir'

const CATEGORIA_LABEL: Record<string, string> = {
  combustivel: 'Combustível',
  alimentacao: 'Alimentação',
  hospedagem: 'Hospedagem',
  pedagio: 'Pedágio',
  estacionamento: 'Estacionamento',
  manutencao: 'Manutenção',
  outro: 'Outro',
  sem_categoria: 'Sem categoria',
}

function dataBr(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR')
}

// Baixa o PDF com o resumo + todos os comprovantes (gerado no servidor,
// /api/cartao-credito-pdf). Sem vendedorId = todos, um atrás do outro.
function BotaoPdf({ de, ate, vendedorId, rotulo }: { de: string; ate: string; vendedorId?: number; rotulo: string }) {
  const [gerando, setGerando] = useState(false)
  async function baixar() {
    setGerando(true)
    try {
      const token = localStorage.getItem('odin_token')
      const empresaAtivaId = localStorage.getItem('empresa_ativa_id')
      const qs = new URLSearchParams({ de, ate, ...(vendedorId ? { vendedorId: String(vendedorId) } : {}) })
      const r = await fetch(`/api/cartao-credito-pdf?${qs}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(empresaAtivaId ? { 'x-empresa-id': empresaAtivaId } : {}) },
      })
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'Não deu pra gerar o PDF')
      const nome = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'cartao.pdf'
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = nome
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setGerando(false)
    }
  }
  return (
    <Button size="sm" variant="secondary" loading={gerando} onClick={baixar} className="print:hidden">
      <FileDown size={14} className="mr-1" /> {rotulo}
    </Button>
  )
}

function fimDoMes(ano: number, mes0: number) {
  const fim = new Date(ano, mes0 + 1, 0)
  return `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, '0')}-${String(fim.getDate()).padStart(2, '0')}`
}

// Relatório do cartão corporativo — pedido do João, 2026-11-24: separar por
// vendedor e por datas, imprimir todos os comprovantes por vendedor e gerar
// relatório. Quem vê: permissão cartao_credito_relatorio (admin comum só a
// própria empresa — regra no servidor).
export default function CartaoCreditoRelatorio() {
  const hoje = hojeBrString()
  const [de, setDe] = usePersistedState('cartaoCreditoRelatorio:de', `${hoje.slice(0, 7)}-01`)
  const [ate, setAte] = usePersistedState('cartaoCreditoRelatorio:ate', hoje)
  const [vendedorId, setVendedorId] = usePersistedState('cartaoCreditoRelatorio:vendedorId', '')
  const periodoOk = !!de && !!ate && de <= ate
  const { data: relatorio, isLoading } = trpc.cartao.relatorio.useQuery({ de, ate, vendedorId: vendedorId ? Number(vendedorId) : undefined }, { enabled: periodoOk })

  function atalhoMes(offset: number) {
    const [a, m] = hoje.split('-').map(Number)
    const d = new Date(a, m - 1 + offset, 1)
    const ini = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    setDe(ini)
    setAte(offset === 0 ? hoje : fimDoMes(d.getFullYear(), d.getMonth()))
  }

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <div className="flex items-center gap-2">
        <CreditCard size={20} className="text-gold-400" />
        <div>
          <h1 className="font-heading text-xl text-dark-50">Cartão de Crédito — Relatório</h1>
          <p className="text-sm text-dark-400">
            Gastos com cartão corporativo por vendedor. {relatorio && <>Período: {dataBr(relatorio.de)} a {dataBr(relatorio.ate)}.</>}
          </p>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 flex flex-wrap items-end gap-3 print:hidden">
        <Input label="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-40" />
        <Input label="Até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-40" />
        <div className="w-56">
          <Select
            label="Vendedor"
            value={vendedorId}
            onChange={(e) => setVendedorId(e.target.value)}
            options={[{ value: '', label: 'Todos' }, ...(relatorio?.vendedores ?? []).map((v) => ({ value: String(v.id), label: v.nome }))]}
          />
        </div>
        <div className="flex gap-3 text-xs pb-2">
          <button type="button" className="text-gold-400 hover:underline" onClick={() => atalhoMes(0)}>
            este mês
          </button>
          <button type="button" className="text-gold-400 hover:underline" onClick={() => atalhoMes(-1)}>
            mês passado
          </button>
        </div>
        <div className="flex gap-2 ml-auto">
          <BotaoImprimir nomeArquivo={`cartao-credito-${de}-a-${ate}`} />
          {relatorio && relatorio.porVendedor.length > 0 && (
            <BotaoPdf de={de} ate={ate} vendedorId={vendedorId ? Number(vendedorId) : undefined} rotulo={vendedorId ? 'PDF com comprovantes' : 'PDF de todos com comprovantes'} />
          )}
        </div>
      </div>
      {!periodoOk && <p className="text-sm text-red-400">Escolha o período: a data "De" precisa ser antes da data "Até".</p>}

      {isLoading && periodoOk && <p className="text-dark-400 text-sm">Carregando...</p>}

      {relatorio && (
        <>
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-2">
            <p className="text-sm text-dark-400">
              Total do período: <span className="text-dark-100 font-semibold">{formatarMoeda(relatorio.totalGeral)}</span> ({relatorio.quantidadeGeral} gastos)
            </p>
            <div className="space-y-1">
              {relatorio.porVendedor.map((v) => (
                <div key={v.vendedorId} className="flex items-center justify-between text-sm">
                  <span className="text-dark-300">
                    {v.vendedorNome} <span className="text-dark-500 text-xs">({v.empresaNome})</span>
                  </span>
                  <span className="text-dark-100">
                    {formatarMoeda(v.total)} <span className="text-dark-500 text-xs">({v.qtd})</span>
                  </span>
                </div>
              ))}
              {!relatorio.porVendedor.length && <p className="text-xs text-dark-500">Nenhum gasto nesse período.</p>}
            </div>
          </div>

          {relatorio.porVendedor.map((v) => (
            <div key={v.vendedorId} className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden break-inside-avoid-page">
              <div className="p-4 flex items-start justify-between gap-3 flex-wrap border-b border-dark-700">
                <div>
                  <p className="text-base font-medium text-dark-50">{v.vendedorNome}</p>
                  <p className="text-xs text-dark-400">
                    {v.empresaNome} · {v.qtd} gasto{v.qtd === 1 ? '' : 's'} · <span className="text-dark-100 font-semibold">{formatarMoeda(v.total)}</span>
                    {v.semAnexo > 0 && <span className="text-red-400"> · {v.semAnexo} sem comprovante</span>}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {v.porCategoria.map((c) => (
                      <span
                        key={c.categoria}
                        className={`text-xs px-2 py-0.5 rounded-full border ${c.categoria === 'sem_categoria' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-dark-700 border-dark-600 text-dark-300'}`}
                      >
                        {CATEGORIA_LABEL[c.categoria] ?? c.categoria}: {formatarMoeda(c.total)}
                      </span>
                    ))}
                  </div>
                </div>
                <BotaoPdf de={de} ate={ate} vendedorId={v.vendedorId} rotulo="PDF com comprovantes" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-dark-500">
                      <th className="px-3 py-2 font-normal">Data</th>
                      <th className="px-3 py-2 font-normal">O que foi</th>
                      <th className="px-3 py-2 font-normal">Descrição</th>
                      <th className="px-3 py-2 font-normal text-right">Valor</th>
                      <th className="px-3 py-2 font-normal">Comprovante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.lancamentos.map((l) => (
                      <tr key={l.id} className="border-t border-dark-700">
                        <td className="px-3 py-2 text-dark-300 whitespace-nowrap">{dataBr(l.data)}</td>
                        <td className="px-3 py-2">
                          {l.categoria ? <span className="text-dark-200">{CATEGORIA_LABEL[l.categoria] ?? l.categoria}</span> : <span className="text-red-400 text-xs">sem categoria</span>}
                        </td>
                        <td className="px-3 py-2 text-dark-400">{l.descricao}</td>
                        <td className="px-3 py-2 text-dark-100 font-medium text-right whitespace-nowrap">{formatarMoeda(l.valor)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            {l.anexos.map((a) => (
                              <a key={a.id} href={a.urlArquivo} target="_blank" rel="noreferrer" className="text-xs text-gold-400 hover:underline flex items-center gap-1">
                                <Paperclip size={10} /> {a.nomeArquivo}
                              </a>
                            ))}
                            {!l.anexos.length && <Badge className="bg-red-500/15 text-red-400 border-red-500/30">sem anexo</Badge>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
