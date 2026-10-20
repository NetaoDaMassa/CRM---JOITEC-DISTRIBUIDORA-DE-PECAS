import { useState } from 'react'
import toast from 'react-hot-toast'
import { Upload, FileSpreadsheet, Power, Trash2, Download } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { formatarMoeda } from '../../lib/moeda'
import { formatDateTime } from '../../lib/utils'
import { paraCsv, baixarCsv } from '../../lib/csv'

// Mesmo formato que o servidor devolve (server/src/lib/importSapHistorico.ts).
interface LinhaProblema {
  linha: number
  codigo: string
  nome: string
  cnpj: string
  data: string
  numeroPedido: string
  valor: number | null
  motivo: string
}
interface Resultado {
  arquivo: string
  totalLinhas: number
  importaveis: number
  porCodigo: number
  porCnpj: number
  jaImportadas: number
  valorTotal: number
  clientesDistintos: number
  dataInicio: string | null
  dataFim: string | null
  naoEncontradas: LinhaProblema[]
  invalidas: LinhaProblema[]
  importacaoId?: number
}

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

async function enviar(arquivo: File, confirmar: boolean): Promise<Resultado> {
  const form = new FormData()
  form.append('file', arquivo)
  const token = localStorage.getItem('odin_token')
  const empresaAtivaId = localStorage.getItem('empresa_ativa_id')
  const res = await fetch(`/upload/historico-sap${confirmar ? '?confirmar=1' : ''}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      // Grava na empresa selecionada no seletor, não na "de casa" do login.
      ...(empresaAtivaId ? { 'x-empresa-id': empresaAtivaId } : {}),
    },
    body: form,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Falha ao ler o arquivo.')
  return data
}

function baixarProblemas(nome: string, linhas: LinhaProblema[]) {
  const csv = paraCsv(
    [
      { chave: 'linha', rotulo: 'Linha da planilha' },
      { chave: 'codigo', rotulo: 'Código' },
      { chave: 'nome', rotulo: 'Nome' },
      { chave: 'cnpj', rotulo: 'CNPJ' },
      { chave: 'data', rotulo: 'Data' },
      { chave: 'numeroPedido', rotulo: 'Nº Pedido' },
      { chave: 'valor', rotulo: 'Valor' },
      { chave: 'motivo', rotulo: 'Motivo' },
    ],
    linhas.map((l) => ({ ...l, valor: l.valor == null ? '' : l.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) }))
  )
  baixarCsv(nome, csv)
}

function Numero({ titulo, valor, sub, cor = 'text-dark-50' }: { titulo: string; valor: string | number; sub?: string; cor?: string }) {
  return (
    <div className="bg-dark-900/60 border border-dark-700 rounded-xl p-3">
      <p className="text-xs text-dark-400">{titulo}</p>
      <p className={`text-xl font-bold font-mono ${cor}`}>{valor}</p>
      {sub && <p className="text-xs text-dark-500">{sub}</p>}
    </div>
  )
}

function TabelaProblemas({ linhas }: { linhas: LinhaProblema[] }) {
  return (
    <div className="overflow-x-auto max-h-72 overflow-y-auto border border-dark-700 rounded-xl">
      <table className="w-full text-xs">
        <thead className="bg-dark-900 text-dark-400 sticky top-0">
          <tr>
            <th className="text-left px-2 py-1.5">Linha</th>
            <th className="text-left px-2 py-1.5">Código</th>
            <th className="text-left px-2 py-1.5">Nome</th>
            <th className="text-left px-2 py-1.5">CNPJ</th>
            <th className="text-left px-2 py-1.5">Data</th>
            <th className="text-right px-2 py-1.5">Valor</th>
            <th className="text-left px-2 py-1.5">Motivo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-dark-700/60 text-dark-200">
          {linhas.slice(0, 200).map((l) => (
            <tr key={l.linha}>
              <td className="px-2 py-1 text-dark-500">{l.linha}</td>
              <td className="px-2 py-1 font-mono">{l.codigo || '—'}</td>
              <td className="px-2 py-1 max-w-48 truncate">{l.nome || '—'}</td>
              <td className="px-2 py-1 font-mono">{l.cnpj || '—'}</td>
              <td className="px-2 py-1">{/^\d{4}-/.test(l.data) ? dataBr(l.data) : l.data || '—'}</td>
              <td className="px-2 py-1 text-right font-mono">{l.valor == null ? '—' : formatarMoeda(l.valor)}</td>
              <td className="px-2 py-1 text-dark-400">{l.motivo}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {linhas.length > 200 && <p className="text-xs text-dark-500 px-2 py-1.5">Mostrando 200 de {linhas.length} — baixe a planilha pra ver todas.</p>}
    </div>
  )
}

// Importação do histórico de vendas do SAP (pedido do João, 2026-10-20) —
// só consulta, aparece na ficha do cliente. Cada arquivo vira um lote que
// pode ser desligado (some de tudo, dá pra religar) ou excluído de vez.
export default function HistoricoSap() {
  const utils = trpc.useUtils()
  const { data: lotes, isLoading } = trpc.historicoSap.importacoes.useQuery()
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [previa, setPrevia] = useState<Resultado | null>(null)
  const [carregando, setCarregando] = useState(false)

  const alternarMut = trpc.historicoSap.alternarAtivo.useMutation({
    onSuccess(_, vars) {
      toast.success(vars.ativo ? 'Importação religada' : 'Importação desligada — some da ficha dos clientes')
      utils.historicoSap.importacoes.invalidate()
      utils.historicoSap.doCliente.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.historicoSap.excluir.useMutation({
    onSuccess() {
      toast.success('Importação excluída')
      utils.historicoSap.importacoes.invalidate()
      utils.historicoSap.doCliente.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  async function analisar() {
    if (!arquivo) return toast.error('Escolha o arquivo do SAP.')
    setCarregando(true)
    try {
      setPrevia(await enviar(arquivo, false))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }

  async function confirmar() {
    if (!arquivo || !previa) return
    setCarregando(true)
    try {
      const r = await enviar(arquivo, true)
      toast.success(`${r.importaveis} pedidos importados`)
      setPrevia(null)
      setArquivo(null)
      utils.historicoSap.importacoes.invalidate()
      utils.historicoSap.doCliente.invalidate()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Histórico SAP</h1>
        <p className="text-sm text-dark-400">
          Importa o histórico de vendas do SAP pra aparecer na ficha de cada cliente. É só consulta — não entra em metas, rankings nem
          painéis. Cada importação pode ser desligada ou excluída depois, se vier errada.
        </p>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
        <div className="text-sm text-dark-300 space-y-1">
          <p className="font-medium text-dark-100">1. Escolha a planilha (Excel ou CSV) da empresa selecionada</p>
          <p className="text-xs text-dark-400">
            Colunas esperadas: <strong>Código do cliente</strong>, <strong>Nome</strong>, <strong>CNPJ</strong>, <strong>Data</strong>,{' '}
            <strong>Nº do Pedido</strong> e <strong>Valor</strong>. O cliente é achado pelo código; não achando, pelo CNPJ.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dark-600 bg-dark-900 text-sm text-dark-200 cursor-pointer hover:border-gold-600">
            <FileSpreadsheet size={16} className="text-gold-400" />
            {arquivo ? arquivo.name : 'Escolher arquivo...'}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                setArquivo(e.target.files?.[0] ?? null)
                setPrevia(null)
              }}
            />
          </label>
          <Button onClick={analisar} loading={carregando && !previa} disabled={!arquivo}>
            <Upload size={14} />
            Analisar (não grava nada)
          </Button>
        </div>

        {previa && (
          <div className="space-y-4 pt-2 border-t border-dark-700">
            <p className="font-medium text-dark-100 text-sm">2. Confira a prévia</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Numero titulo="Pedidos que vão entrar" valor={previa.importaveis} sub={`${previa.clientesDistintos} clientes`} cor="text-green-400" />
              <Numero titulo="Valor total" valor={formatarMoeda(previa.valorTotal, { casas: 0 })} sub={`${dataBr(previa.dataInicio)} a ${dataBr(previa.dataFim)}`} />
              <Numero titulo="Achados pelo código / CNPJ" valor={`${previa.porCodigo} / ${previa.porCnpj}`} />
              <Numero
                titulo="Ficam de fora"
                valor={previa.naoEncontradas.length + previa.invalidas.length}
                sub={previa.jaImportadas ? `+ ${previa.jaImportadas} já importados antes (pulados)` : undefined}
                cor={previa.naoEncontradas.length + previa.invalidas.length ? 'text-amber-400' : 'text-dark-50'}
              />
            </div>

            {previa.naoEncontradas.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-amber-400">{previa.naoEncontradas.length} linha(s) com cliente não encontrado no CRM</p>
                  <Button size="sm" variant="secondary" onClick={() => baixarProblemas('sap-clientes-nao-encontrados.csv', previa.naoEncontradas)}>
                    <Download size={14} />
                    Baixar planilha
                  </Button>
                </div>
                <TabelaProblemas linhas={previa.naoEncontradas} />
              </div>
            )}
            {previa.invalidas.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-red-400">{previa.invalidas.length} linha(s) com dado faltando ou inválido</p>
                  <Button size="sm" variant="secondary" onClick={() => baixarProblemas('sap-linhas-invalidas.csv', previa.invalidas)}>
                    <Download size={14} />
                    Baixar planilha
                  </Button>
                </div>
                <TabelaProblemas linhas={previa.invalidas} />
              </div>
            )}

            <div className="flex gap-3">
              <Button onClick={confirmar} loading={carregando} disabled={previa.importaveis === 0}>
                Confirmar importação de {previa.importaveis} pedidos
              </Button>
              <Button variant="secondary" onClick={() => setPrevia(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-3">
        <h2 className="font-medium text-dark-100">Importações feitas</h2>
        {isLoading && <p className="text-sm text-dark-400">Carregando...</p>}
        {!isLoading && !lotes?.length && <p className="text-sm text-dark-500">Nenhuma importação ainda nessa empresa.</p>}
        <div className="divide-y divide-dark-700">
          {lotes?.map((l) => (
            <div key={l.id} className={`flex flex-wrap items-center gap-3 py-3 ${l.ativo ? '' : 'opacity-60'}`}>
              <div className="flex-1 min-w-56">
                <p className="text-sm text-dark-100 font-medium flex items-center gap-2">
                  {l.nomeArquivo}
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${l.ativo ? 'bg-green-600 text-white' : 'bg-dark-600 text-dark-200'}`}>
                    {l.ativo ? 'Ligada' : 'Desligada'}
                  </span>
                </p>
                <p className="text-xs text-dark-400">
                  {l.importadas} pedidos · {formatarMoeda(l.valorTotal, { casas: 0 })} · {dataBr(l.dataInicio)} a {dataBr(l.dataFim)}
                  {l.naoEncontradas ? ` · ${l.naoEncontradas} sem cliente` : ''}
                </p>
                <p className="text-xs text-dark-500">
                  Importado em {formatDateTime(l.createdAt)}
                  {l.importadoPor ? ` por ${l.importadoPor}` : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={alternarMut.isPending && alternarMut.variables?.id === l.id}
                onClick={() => alternarMut.mutate({ id: l.id, ativo: !l.ativo })}
              >
                <Power size={14} />
                {l.ativo ? 'Desligar' : 'Religar'}
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={excluirMut.isPending && excluirMut.variables?.id === l.id}
                onClick={() => {
                  if (confirm(`Excluir de vez a importação "${l.nomeArquivo}" (${l.importadas} pedidos)? Não dá pra desfazer — se quiser só esconder, use "Desligar".`)) {
                    excluirMut.mutate({ id: l.id })
                  }
                }}
              >
                <Trash2 size={14} />
                Excluir
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-dark-500">Desligar esconde os pedidos dessa importação de todas as fichas, sem apagar. Religar traz de volta.</p>
      </div>
    </div>
  )
}

