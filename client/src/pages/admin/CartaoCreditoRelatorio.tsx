import { useState } from 'react'
import { CreditCard, Paperclip } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { hojeBrString } from '../../lib/utils'

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const CATEGORIA_LABEL: Record<string, string> = {
  combustivel: 'Combustível',
  alimentacao: 'Alimentação',
  hospedagem: 'Hospedagem',
  pedagio: 'Pedágio',
  manutencao: 'Manutenção',
  outro: 'Outro',
}

// Relatório geral de gastos do cartão — só o admin principal (superAdmin)
// enxerga essa tela (ver Sidebar.tsx). Junta todo mundo que lançou gasto no
// mês, não só vendedor da Odin Compressores, porque o backend não trava
// por empresa (quem usa é decidido em Permissões). Pedido do João,
// 2026-09-15.
export default function CartaoCreditoRelatorio() {
  const [mesReferencia, setMesReferencia] = useState(hojeBrString().slice(0, 7))
  const { data: relatorio, isLoading } = trpc.cartao.relatorio.useQuery({ mesReferencia })

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <CreditCard size={20} className="text-gold-400" />
          <div>
            <h1 className="font-heading text-xl text-dark-50">Cartão de Crédito — Relatório</h1>
            <p className="text-sm text-dark-400">Gastos de todos os vendedores com cartão corporativo.</p>
          </div>
        </div>
        <Input type="month" value={mesReferencia} onChange={(e) => setMesReferencia(e.target.value)} className="w-40" />
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}

      {relatorio && (
        <>
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
            <p className="text-sm text-dark-400">
              Total do mês: <span className="text-dark-100 font-semibold">{formatarMoeda(relatorio.totalGeral)}</span> ({relatorio.quantidadeGeral} lançamentos)
            </p>
            <div className="space-y-1">
              {relatorio.porVendedor.map((v) => (
                <div key={v.vendedorId} className="flex items-center justify-between text-sm">
                  <span className="text-dark-300">{v.vendedorNome}</span>
                  <span className="text-dark-100">
                    {formatarMoeda(v.total)} <span className="text-dark-500 text-xs">({v.qtd})</span>
                  </span>
                </div>
              ))}
              {!relatorio.porVendedor.length && <p className="text-xs text-dark-500">Nenhum lançamento nesse mês.</p>}
            </div>
          </div>

          <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
            {!relatorio.lancamentos.length && <p className="p-4 text-dark-400 text-sm">Nenhum lançamento nesse mês.</p>}
            {relatorio.lancamentos.map((l) => (
              <div key={l.id} className="p-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm text-dark-100">
                    {new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR')} — {l.vendedorNome}{' '}
                    <span className="font-medium">{formatarMoeda(l.valor)}</span>
                  </p>
                  <p className="text-xs text-dark-400">
                    {l.empresaNome} {l.categoria && <>· {CATEGORIA_LABEL[l.categoria]}</>} {l.descricao && <>· {l.descricao}</>}
                  </p>
                </div>
                <div className="flex gap-2">
                  {l.anexos.map((a) => (
                    <a key={a.id} href={a.urlArquivo} target="_blank" rel="noreferrer" className="text-xs text-gold-400 hover:underline flex items-center gap-1">
                      <Paperclip size={10} /> {a.nomeArquivo}
                    </a>
                  ))}
                  {!l.anexos.length && <Badge className="bg-red-500/15 text-red-400 border-red-500/30">sem anexo</Badge>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
