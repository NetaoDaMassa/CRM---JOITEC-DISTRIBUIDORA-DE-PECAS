import { useState } from 'react'
import toast from 'react-hot-toast'
import { Building2, Plus, Pencil, Trash2, Star } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import ModalFornecedor, { type FornecedorEditavel } from '../../components/compras/ModalFornecedor'
import TabelaDados, { type Coluna } from '../../components/relatorios/TabelaDados'
import { useAcessoCompras } from '../../lib/comprasShared'

type Linha = FornecedorEditavel & {
  qtdCompras: number
  totalComprado: number
  qtdCotacoes: number
  ultimaCompra: string | null
  prazoMedioReal: number | null
  percNoPrazo: number | null
}

export default function Fornecedores() {
  const utils = trpc.useUtils()
  const { data: acesso } = useAcessoCompras()
  const { data, isLoading } = trpc.comprasProcesso.fornecedores.useQuery()
  const [editando, setEditando] = useState<Linha | 'novo' | null>(null)
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const excluir = trpc.comprasProcesso.excluirFornecedor.useMutation({
    onSuccess: (r) => {
      toast.success(r.desativado ? 'Tem cotações no histórico — foi só desativado' : 'Fornecedor excluído')
      utils.comprasProcesso.fornecedores.invalidate()
      utils.comprasProcesso.auxiliares.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const podeEditar = !!acesso?.gestao
  const linhas = (data ?? []).filter((f) => mostrarInativos || f.ativo) as Linha[]

  const colunas: Coluna<Linha>[] = [
    {
      id: 'nome',
      rotulo: 'Fornecedor',
      valor: (l) => l.nome,
      render: (l) => (
        <div>
          <p className={`font-medium ${l.ativo ? 'text-dark-50' : 'text-dark-500 line-through'}`}>{l.nome}</p>
          {l.fornece && <p className="text-xs text-dark-400 truncate max-w-xs">{l.fornece}</p>}
        </div>
      ),
    },
    { id: 'cnpj', rotulo: 'CNPJ', valor: (l) => l.cnpj?.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') ?? '' },
    { id: 'contato', rotulo: 'Contato', valor: (l) => [l.contato, l.telefone].filter(Boolean).join(' · ') },
    { id: 'email', rotulo: 'E-mail', valor: (l) => l.email, oculta: true },
    { id: 'cidade', rotulo: 'Cidade', valor: (l) => [l.cidade, l.uf].filter(Boolean).join('/'), oculta: true },
    { id: 'condicao', rotulo: 'Pagamento', valor: (l) => l.condicaoPagamento, oculta: true },
    {
      id: 'avaliacao',
      rotulo: 'Avaliação',
      valor: (l) => l.avaliacao ?? 0,
      render: (l) =>
        l.avaliacao ? (
          <span className="inline-flex">
            {Array.from({ length: l.avaliacao }, (_, i) => (
              <Star key={i} size={13} className="fill-amber-400 text-amber-400" />
            ))}
          </span>
        ) : (
          <span className="text-dark-500">—</span>
        ),
    },
    { id: 'qtdCotacoes', rotulo: 'Cotações', valor: (l) => l.qtdCotacoes, formato: 'numero' },
    { id: 'qtdCompras', rotulo: 'Compras', valor: (l) => l.qtdCompras, formato: 'numero', somar: true },
    { id: 'totalComprado', rotulo: 'Total comprado', valor: (l) => l.totalComprado, formato: 'moeda', somar: true },
    { id: 'ultimaCompra', rotulo: 'Última compra', valor: (l) => l.ultimaCompra, formato: 'data' },
    { id: 'prazoMedio', rotulo: 'Entrega média (dias)', valor: (l) => l.prazoMedioReal, formato: 'numero' },
    { id: 'noPrazo', rotulo: '% no prazo', valor: (l) => l.percNoPrazo, formato: 'pct' },
    ...(podeEditar
      ? [
          {
            id: 'acoes',
            rotulo: '',
            valor: () => '',
            render: (l: Linha) => (
              <div className="flex gap-1 justify-end">
                <button type="button" className="p-1.5 rounded-lg text-dark-400 hover:text-dark-100 hover:bg-dark-700" title="Editar" onClick={() => setEditando(l)}>
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="p-1.5 rounded-lg text-dark-400 hover:text-red-400 hover:bg-dark-700"
                  title="Excluir"
                  onClick={() => window.confirm(`Excluir ${l.nome}?`) && excluir.mutate({ id: l.id })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ),
          } as Coluna<Linha>,
        ]
      : []),
  ]

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Building2 size={20} className="text-gold-400" />
          <div>
            <h1 className="font-heading text-xl text-dark-50">Fornecedores</h1>
            <p className="text-sm text-dark-400">Cadastro e desempenho de cada fornecedor (compras, valor, entrega no prazo).</p>
          </div>
        </div>
        {podeEditar && (
          <Button onClick={() => setEditando('novo')}>
            <Plus size={16} /> Novo fornecedor
          </Button>
        )}
      </div>
      <TabelaDados
        id="compras-fornecedores"
        linhas={linhas}
        colunas={colunas}
        chave={(l) => l.id}
        buscaEm={(l) => `${l.nome} ${l.razaoSocial ?? ''} ${l.cnpj ?? ''} ${l.fornece ?? ''} ${l.contato ?? ''}`}
        placeholderBusca="Buscar fornecedor, CNPJ, o que fornece..."
        nomeArquivo="fornecedores.csv"
        ordemInicial={{ coluna: 'totalComprado', direcao: 'desc' }}
        carregando={isLoading}
        vazio="Nenhum fornecedor cadastrado ainda."
        barraExtra={
          <label className="flex items-center gap-2 text-xs text-dark-400">
            <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} /> Mostrar inativos
          </label>
        }
      />
      {editando && <ModalFornecedor fornecedor={editando === 'novo' ? null : editando} onClose={() => setEditando(null)} />}
    </div>
  )
}
