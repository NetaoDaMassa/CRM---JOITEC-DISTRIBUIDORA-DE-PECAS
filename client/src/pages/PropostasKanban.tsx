import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plus, Download, RefreshCw, CalendarRange, X, CheckCircle2, Search, FileClock, Zap, FileWarning, MessageSquareWarning, Hourglass, PhoneCall, Trophy, Columns3, List } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { usePersistedState } from '../lib/usePersistedState'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import { Input, Textarea } from '../components/ui/Input'
import ProductSelector from '../components/ProductSelector'
import PropostasBoard from '../components/PropostasBoard'
import PropostaDetail from './PropostaDetail'
import { PROPOSTA_STAGE_LABELS, type PropostaStage } from '../lib/propostasShared'
import { AvisoFiltro, BotaoLegenda, CaixaNovidades, Indicador, TrocaVisao } from '../components/painel/PainelVisual'
import {
  LEGENDA_PROPOSTAS,
  MotivosPerda,
  NOVIDADES_PROPOSTAS,
  RankingPropostas,
  ROTULO_FILTRO_PROPOSTA,
  TESTES_PROPOSTA,
  TabelaPropostas,
  conversaoMes,
  type FiltroProposta,
} from '../components/propostas/PainelPropostas'
import { Esqueleto } from '../components/ui/Visual'

// Atalho "Mês" — preenche De/Até com o mês inteiro de uma vez, igual ao
// filtro de data do Propostas.tsx no odincrm original.
function monthToRange(mes: string): { from: string; to: string } {
  const [ano, m] = mes.split('-').map(Number)
  const ultimoDia = new Date(ano, m, 0).getDate()
  return { from: `${mes}-01`, to: `${mes}-${String(ultimoDia).padStart(2, '0')}` }
}

function baixarCsvPropostas(propostas: { id: number; stage: string; clienteNome: string; vendedor: { name: string } | null; updatedAt: string }[]) {
  const linhas = ['ID,Cliente,Vendedor,Etapa,Atualizado em']
  for (const p of propostas) {
    linhas.push([p.id, p.clienteNome.replace(/,/g, ' '), p.vendedor?.name ?? '', PROPOSTA_STAGE_LABELS[p.stage as PropostaStage] ?? p.stage, p.updatedAt].join(','))
  }
  const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `propostas_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function PropostasKanban() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const basePath = isAdmin ? '/admin/propostas' : '/vendedor/propostas'
  const { id } = useParams()
  const navigate = useNavigate()

  const [modalAberto, setModalAberto] = useState(false)
  const [semProposta, setSemProposta] = useState(false)
  const [clienteNome, setClienteNome] = useState('')
  const [clienteWhatsapp, setClienteWhatsapp] = useState('')
  const [produtosDescricao, setProdutosDescricao] = useState('')
  const [produtosItens, setProdutosItens] = useState('')
  const [comissao, setComissao] = useState('')
  const [revenda, setRevenda] = useState('')
  const [formaPagamento, setFormaPagamento] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [prioridade, setPrioridade] = useState<'normal' | 'urgente'>('normal')
  const [motivoUrgencia, setMotivoUrgencia] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [docFiles, setDocFiles] = useState<File[]>([])
  const [enviandoArquivos, setEnviandoArquivos] = useState(false)
  const [vendedorId, setVendedorId] = usePersistedState('propostasKanban:vendedorId', '')
  const [mes, setMes] = usePersistedState('propostasKanban:mes', '')
  const [dataDe, setDataDe] = usePersistedState('propostasKanban:dataDe', '')
  const [dataAte, setDataAte] = usePersistedState('propostasKanban:dataAte', '')
  const [busca, setBusca] = usePersistedState('propostasKanban:busca', '')
  const [filtroRapido, setFiltroRapido] = usePersistedState<FiltroProposta | ''>('propostasKanban:filtroRapido', '')
  const [modo, setModo] = usePersistedState<'quadro' | 'lista'>('propostasKanban:modo', 'quadro')
  const [novidadesVistas, setNovidadesVistas] = usePersistedState('propostasKanban:novidadesVistas:v1', false)

  const utils = trpc.useUtils()
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: isAdmin })
  const { data: propostasTodas, isLoading } = trpc.propostas.listar.useQuery({ vendedorId: vendedorId ? Number(vendedorId) : undefined })
  const { data: revendas } = trpc.revendas.listar.useQuery(undefined, { retry: false })

  const temFiltroData = !!(dataDe || dataAte)
  const propostasPorData = temFiltroData
    ? (propostasTodas ?? []).filter((p) => {
        const dia = p.createdAt.slice(0, 10)
        if (dataDe && dia < dataDe) return false
        if (dataAte && dia > dataAte) return false
        return true
      })
    : propostasTodas

  const termo = busca.trim().toLowerCase()
  const termoDigitos = termo.replace(/\D/g, '')
  // Busca ignora o filtro de data de propósito — pedido do João (2026-09-03):
  // gente deixava um "mês" filtrado de antes, buscava um cliente de outro mês
  // e não achava nada, achando que a busca tava quebrada. Quem procura um
  // cliente específico quer achar não importa quando foi criado.
  const propostas = termo
    ? (propostasTodas ?? []).filter(
        (p) =>
          String(p.id).includes(termo) ||
          p.clienteNome.toLowerCase().includes(termo) ||
          p.vendedor?.name.toLowerCase().includes(termo) ||
          (termoDigitos && p.clienteWhatsapp?.replace(/\D/g, '').includes(termoDigitos))
      )
    : propostasPorData

  const listaBase = propostas ?? []
  const contar = (f: FiltroProposta) => listaBase.filter(TESTES_PROPOSTA[f]).length
  const alternar = (f: FiltroProposta) => setFiltroRapido(filtroRapido === f ? '' : f)
  const visiveis = filtroRapido ? listaBase.filter(TESTES_PROPOSTA[filtroRapido]) : listaBase
  const conv = conversaoMes(listaBase)

  function aplicarMes(m: string) {
    setMes(m)
    if (m) {
      const { from, to } = monthToRange(m)
      setDataDe(from)
      setDataAte(to)
    } else {
      setDataDe('')
      setDataAte('')
    }
  }
  function alterarData(campo: 'de' | 'ate', valor: string) {
    if (campo === 'de') setDataDe(valor)
    else setDataAte(valor)
    setMes('')
  }

  const registrarArquivoMut = trpc.propostas.registrarArquivo.useMutation()

  async function enviarArquivo(propostaId: number, file: File, fileCategory: string) {
    const formData = new FormData()
    formData.append('file', file)
    const token = localStorage.getItem('odin_token')
    const resp = await fetch('/upload/proposta-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
    const json = await resp.json()
    if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
    await registrarArquivoMut.mutateAsync({ propostaId, fileCategory, nomeOriginal: json.nome, nomeArmazenado: json.path.replace('/uploads/', ''), tipoArquivo: json.tipo, tamanhoBytes: json.tamanho })
  }

  const criarMut = trpc.propostas.criar.useMutation({
    async onSuccess(result) {
      try {
        setEnviandoArquivos(true)
        if (pdfFile) await enviarArquivo(result.id, pdfFile, 'proposta_pdf')
        for (const f of docFiles) await enviarArquivo(result.id, f, 'dados_cadastrais')
      } catch (err: any) {
        toast.error(`Proposta criada, mas houve erro ao anexar arquivo: ${err.message}`)
      } finally {
        setEnviandoArquivos(false)
      }
      toast.success(semProposta ? 'Fechamento registrado em Fechado' : 'Proposta criada')
      setModalAberto(false)
      setSemProposta(false)
      limparFormulario()
      utils.propostas.listar.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function limparFormulario() {
    setClienteNome('')
    setClienteWhatsapp('')
    setProdutosDescricao('')
    setProdutosItens('')
    setComissao('')
    setRevenda('')
    setFormaPagamento('')
    setObservacoes('')
    setPrioridade('normal')
    setMotivoUrgencia('')
    setPdfFile(null)
    setDocFiles([])
  }

  function abrirModal(sem: boolean) {
    setSemProposta(sem)
    limparFormulario()
    setModalAberto(true)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="font-heading text-2xl text-dark-50 font-bold">Propostas</h1>
          <p className="text-sm text-dark-400">{contar('abertas')} em aberto agora</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <TrocaVisao
            valor={modo}
            onChange={setModo}
            opcoes={[
              { valor: 'quadro', rotulo: 'Quadro', icone: Columns3 },
              { valor: 'lista', rotulo: 'Lista', icone: List },
            ]}
          />
          <BotaoLegenda secoes={LEGENDA_PROPOSTAS} aoRever={() => setNovidadesVistas(false)} />
          <Button size="sm" variant="secondary" onClick={() => abrirModal(true)} title="Registrar um negócio já fechado, sem passar pelo funil">
            <CheckCircle2 size={14} className="mr-1" /> Fechamento / Sem Proposta
          </Button>
          <Button size="sm" onClick={() => abrirModal(false)}>
            <Plus size={14} className="mr-1" /> Nova Proposta
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente, telefone ou #proposta..."
              className="w-64 rounded-lg border border-dark-600 bg-dark-900 py-1.5 pl-8 pr-2 text-xs text-dark-100 placeholder-dark-500 focus:outline-none focus:border-gold-600"
            />
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-dark-600 px-2 py-1.5" title="Filtrar por data de criação da proposta">
            <CalendarRange size={13} className="text-dark-500 shrink-0" />
            <input
              type="month"
              value={mes}
              title="Atalho: preenche De/Até com o mês inteiro"
              onChange={(e) => aplicarMes(e.target.value)}
              className="bg-transparent text-xs py-0.5 px-1 w-[100px] text-dark-100 focus:outline-none"
            />
            <span className="text-dark-600">|</span>
            <input type="date" value={dataDe} onChange={(e) => alterarData('de', e.target.value)} className="bg-transparent text-xs py-0.5 px-1 w-[110px] text-dark-100 focus:outline-none" />
            <span className="text-dark-500 text-xs">até</span>
            <input type="date" value={dataAte} onChange={(e) => alterarData('ate', e.target.value)} className="bg-transparent text-xs py-0.5 px-1 w-[110px] text-dark-100 focus:outline-none" />
            {temFiltroData && (
              <button onClick={() => aplicarMes('')} className="text-dark-500 hover:text-dark-300 shrink-0"><X size={12} /></button>
            )}
          </div>
          {isAdmin && (
            <div className="w-52">
              <Select
                value={vendedorId}
                onChange={(e) => setVendedorId(e.target.value)}
                placeholder="Todos os vendedores"
                options={(vendedores ?? []).filter((v) => v.role === 'vendor').map((v) => ({ value: v.id, label: v.name }))}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => baixarCsvPropostas(propostas ?? [])}
            className="flex items-center gap-1.5 rounded-lg border border-dark-600 px-3 py-1.5 text-xs font-medium text-dark-300 hover:bg-dark-800 transition-colors"
          >
            <Download size={13} /> Exportar CSV
          </button>
          <button
            onClick={() => utils.propostas.listar.invalidate()}
            className="flex items-center gap-1.5 text-xs text-dark-400 hover:text-gold-400 transition-colors"
          >
            <RefreshCw size={13} /> Atualizar
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2.5">
            {Array.from({ length: 7 }, (_, i) => (
              <Esqueleto key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          <div className="flex gap-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Esqueleto key={i} className="h-96 w-72 rounded-xl shrink-0" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {!novidadesVistas && <CaixaNovidades itens={NOVIDADES_PROPOSTAS} aoFechar={() => setNovidadesVistas(true)} />}
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2.5 mb-3">
            <Indicador icone={FileClock} valor={contar('abertas')} rotulo="Em aberto" dica="Em Proposta ou Negociação" cor="#3987e5" ativo={filtroRapido === 'abertas'} onClick={() => alternar('abertas')} />
            <Indicador icone={Zap} valor={contar('urgentes')} rotulo="Urgentes" dica="Em aberto e marcadas como urgentes" cor="#e5534b" ativo={filtroRapido === 'urgentes'} onClick={() => alternar('urgentes')} />
            <Indicador icone={FileWarning} valor={contar('sem_pdf')} rotulo="Sem PDF" dica="Em Proposta sem o PDF anexado (obrigatório para Negociação)" cor="#eab308" ativo={filtroRapido === 'sem_pdf'} onClick={() => alternar('sem_pdf')} />
            <Indicador icone={MessageSquareWarning} valor={contar('alteracao')} rotulo="Com alteração" dica="Alguém pediu alteração" cor="#f59e0b" ativo={filtroRapido === 'alteracao'} onClick={() => alternar('alteracao')} />
            <Indicador icone={Hourglass} valor={contar('paradas')} rotulo="Paradas" dica="Em aberto sem nenhuma mudança há 7 dias ou mais" cor="#e5534b" ativo={filtroRapido === 'paradas'} onClick={() => alternar('paradas')} />
            <Indicador icone={PhoneCall} valor={contar('retomar')} rotulo="Retomar" dica="Em Chamar Depois com a data de retorno vencida" cor="#f97316" ativo={filtroRapido === 'retomar'} onClick={() => alternar('retomar')} />
            <Indicador
              icone={Trophy}
              valor={conv.ganhas}
              rotulo={conv.taxa !== null ? `Fechadas · ${conv.taxa}%` : 'Fechadas no mês'}
              dica="Fechadas ou que viraram pedido este mês · % = fechadas ÷ (fechadas + perdidas) no mês"
              cor="#22a861"
              ativo={filtroRapido === 'fechadas_mes'}
              onClick={() => alternar('fechadas_mes')}
            />
          </div>

          {(isAdmin || listaBase.some((p) => p.stage === 'perdido')) && (
            <div className={`grid gap-3 mb-3 ${isAdmin ? 'lg:grid-cols-[2fr_1fr]' : ''}`}>
              {isAdmin && !vendedorId && <RankingPropostas lista={listaBase} />}
              <MotivosPerda lista={listaBase} />
            </div>
          )}

          {filtroRapido && <AvisoFiltro quantidade={visiveis.length} texto={ROTULO_FILTRO_PROPOSTA[filtroRapido]} aoLimpar={() => setFiltroRapido('')} />}

          {modo === 'lista' ? (
            <TabelaPropostas lista={visiveis} mostrarVendedor={isAdmin} aoAbrir={(pid) => navigate(`${basePath}/${pid}`)} />
          ) : (
            <PropostasBoard propostas={visiveis} basePath={basePath} mostrarVendedor={isAdmin} />
          )}
        </>
      )}

      <Modal open={modalAberto} onClose={() => setModalAberto(false)} title={semProposta ? 'Fechamento / Sem Proposta' : 'Nova Proposta'} size="md">
        <div className="p-5 space-y-4">
          {semProposta && (
            <p className="text-xs text-dark-400">Cria a proposta já em <span className="font-semibold text-dark-200">Fechado</span>, sem precisar anexar PDF. Complete os demais dados abrindo o card.</p>
          )}
          <Input label="Nome do cliente" value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} />
          <Input label="WhatsApp do cliente" value={clienteWhatsapp} onChange={(e) => setClienteWhatsapp(e.target.value)} />

          {!semProposta && (
            <div>
              <label className="text-xs text-dark-400 mb-1.5 block">Prioridade</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setPrioridade('normal'); setMotivoUrgencia('') }}
                  className={`flex-1 rounded-lg border-2 py-2 text-sm font-semibold transition-colors ${
                    prioridade === 'normal' ? 'border-green-500 bg-green-900/20 text-green-400' : 'border-dark-600 text-dark-400 hover:border-dark-500'
                  }`}
                >
                  ✅ Normal
                </button>
                <button
                  type="button"
                  onClick={() => setPrioridade('urgente')}
                  className={`flex-1 rounded-lg border-2 py-2 text-sm font-semibold transition-colors ${
                    prioridade === 'urgente' ? 'border-red-500 bg-red-900/20 text-red-400' : 'border-dark-600 text-dark-400 hover:border-dark-500'
                  }`}
                >
                  🔴 Urgente
                </button>
              </div>
              {prioridade === 'urgente' && (
                <div className="mt-2">
                  <Input
                    label="Motivo da urgência"
                    placeholder="Ex: Prazo de entrega do cliente, concorrência..."
                    value={motivoUrgencia}
                    onChange={(e) => setMotivoUrgencia(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-xs text-dark-400 mb-1.5 block">Produtos/Serviços</label>
            <ProductSelector value={produtosDescricao} onChange={setProdutosDescricao} itensJson={produtosItens} onItensChange={setProdutosItens} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Comissão" value={comissao} onChange={(e) => setComissao(e.target.value)} />
            <div>
              <Input label="Revenda" list="revendas-lista" value={revenda} onChange={(e) => setRevenda(e.target.value)} />
              <datalist id="revendas-lista">
                {(revendas ?? []).map((r) => <option key={r.id} value={r.nome} />)}
              </datalist>
            </div>
            <Input label="Forma de pagamento" value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)} />
          </div>

          <Textarea label="Informações para cadastro" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />

          {!semProposta && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-dark-400 mb-1.5 block">PDF da proposta</label>
                <p className="text-[11px] text-dark-500 mb-1">Obrigatório pra avançar pra Negociação — pode anexar depois também.</p>
                <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)} className="text-xs text-dark-300 w-full file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-dark-600 file:bg-dark-800 file:text-dark-200 file:text-xs" />
              </div>
              <div>
                <label className="text-xs text-dark-400 mb-1.5 block">Outros documentos</label>
                <input type="file" multiple onChange={(e) => setDocFiles(Array.from(e.target.files ?? []))} className="text-xs text-dark-300 w-full file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-dark-600 file:bg-dark-800 file:text-dark-200 file:text-xs" />
              </div>
            </div>
          )}

          <Button
            className="w-full"
            disabled={!clienteNome || criarMut.isPending || enviandoArquivos}
            loading={criarMut.isPending || enviandoArquivos}
            onClick={() => criarMut.mutate({
              clienteNome,
              clienteWhatsapp: clienteWhatsapp || undefined,
              produtosDescricao: produtosDescricao || undefined,
              produtosItens: produtosItens || undefined,
              comissao: comissao || undefined,
              revenda: revenda || undefined,
              formaPagamento: formaPagamento || undefined,
              observacoes: observacoes || undefined,
              ...(semProposta ? { stage: 'fechado' as const, semProposta: true } : { prioridade, motivoUrgencia: motivoUrgencia || undefined }),
            })}
          >
            {semProposta ? 'Registrar fechamento' : 'Criar proposta'}
          </Button>
        </div>
      </Modal>

      {id && <PropostaDetail propostaId={Number(id)} onClose={() => navigate(basePath)} />}
    </div>
  )
}
