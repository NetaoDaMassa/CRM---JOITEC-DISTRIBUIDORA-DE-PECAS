import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import { Badge } from '../ui/Badge'
import type { OrderType } from '../../lib/ordensShared'
import NotaSapBotoes from '../NotaSapBotoes'

export default function EtapaFaturamento({ ordemId, isAdmin, readonly, orderType }: { ordemId: number; isAdmin: boolean; readonly: boolean; orderType: OrderType }) {
  const { data, isLoading } = trpc.ordens.faturamento.obter.useQuery({ ordemId })
  const { data: anexos } = trpc.ordens.anexos.listar.useQuery({ ordemId, stage: 'faturamento' })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return <EtapaFaturamentoForm ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} orderType={orderType} data={data ?? null} anexos={anexos ?? []} />
}

function EtapaFaturamentoForm({
  ordemId,
  isAdmin,
  readonly,
  orderType,
  data,
  anexos,
}: {
  ordemId: number
  isAdmin: boolean
  readonly: boolean
  orderType: OrderType
  data: { pagamentoConfirmado: boolean; numeroNotaFiscal: string | null; dataPagamento: string | null; numeroPicking: string | null; dataFaturamento: string | null } | null
  anexos: { id: number; nomeOriginal: string; nomeArmazenado: string }[]
}) {
  const utils = trpc.useUtils()
  const [nf, setNf] = useState(data?.numeroNotaFiscal ?? '')
  const [dataPag, setDataPag] = useState(data?.dataPagamento ?? '')
  const [dataFat, setDataFat] = useState(data?.dataFaturamento ?? '')
  const [enviando, setEnviando] = useState(false)
  const podeEditar = isAdmin && !readonly
  const isPeca = orderType === 'peca'

  function invalidar() {
    utils.ordens.faturamento.obter.invalidate({ ordemId })
    utils.ordens.anexos.listar.invalidate({ ordemId, stage: 'faturamento' })
  }
  const salvarMut = trpc.ordens.faturamento.atualizar.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const confirmarMut = trpc.ordens.faturamento.confirmar.useMutation({ onSuccess: () => { toast.success('Pagamento confirmado'); invalidar() }, onError: (e) => toast.error(e.message) })
  const registrarMut = trpc.ordens.anexos.registrar.useMutation({ onSuccess: () => { toast.success('NF anexada'); invalidar() }, onError: (e) => toast.error(e.message) })

  async function handleUploadNf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setEnviando(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('odin_token')
      const resp = await fetch('/upload/ordem-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
      registrarMut.mutate({ ordemId, stage: 'faturamento', fileCategory: 'nf', nomeOriginal: json.nome, nomeArmazenado: json.path.replace('/uploads/', ''), tipoArquivo: json.tipo, tamanhoBytes: json.tamanho })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setEnviando(false)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <NotaDoSap ordemId={ordemId} nfDigitada={data?.numeroNotaFiscal ?? null} />
      {data?.pagamentoConfirmado && <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Pagamento confirmado</Badge>}
      {isPeca ? (
        <div className="grid grid-cols-2 gap-3">
          <Input label="Data do faturamento" type="date" defaultValue={dataFat} onChange={(e) => setDataFat(e.target.value)} disabled={!podeEditar} />
          {/* Era "Número do picking" — trocado por número da nota fiscal a
              pedido do João (2026-10-19). Picking já gravado em pedidos
              antigos continua aparecendo embaixo, só pra consulta. */}
          <Input label="Número da nota fiscal" defaultValue={nf} onChange={(e) => setNf(e.target.value)} disabled={!podeEditar} />
          {data?.numeroPicking && <p className="col-span-2 text-[11px] text-dark-500">Picking (antigo): {data.numeroPicking}</p>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Data do pagamento" type="date" defaultValue={dataPag} onChange={(e) => setDataPag(e.target.value)} disabled={!podeEditar} />
            <Input label="Número da nota fiscal" defaultValue={nf} onChange={(e) => setNf(e.target.value)} disabled={!podeEditar} />
          </div>
          <div>
            <label className="text-xs text-dark-400 mb-1 block">PDF da Nota Fiscal</label>
            {anexos.map((a) => <a key={a.id} href={`/uploads/${a.nomeArmazenado}`} target="_blank" rel="noreferrer" className="block text-sm text-blue-400 hover:underline">{a.nomeOriginal}</a>)}
            {podeEditar && (
              <label className="mt-1.5 inline-block px-3 py-1.5 text-xs rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 cursor-pointer">
                {enviando ? 'Enviando...' : 'Anexar NF'}
                <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleUploadNf} disabled={enviando} />
              </label>
            )}
          </div>
        </>
      )}
      {podeEditar && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" loading={salvarMut.isPending} onClick={() => salvarMut.mutate(isPeca ? { ordemId, dataFaturamento: dataFat, numeroNotaFiscal: nf } : { ordemId, numeroNotaFiscal: nf, dataPagamento: dataPag })}>Salvar</Button>
          {!data?.pagamentoConfirmado && <Button size="sm" loading={confirmarMut.isPending} onClick={() => confirmarMut.mutate({ ordemId })}>Confirmar Pagamento</Button>}
        </div>
      )}
    </div>
  )
}

// NF do SAP (João, 2026-11-19): o CRM procura a nota do pedido no SAP de
// minuto em minuto (server/src/lib/sapNfOrdensOdin.ts) e preenche o nº da NF
// quando está vazio. Aqui: as NFs achadas + DANFE/XML, aviso quando a NF
// digitada não bate, e o que fazer quando o pedido não está ligado ao SAP.
const soDigitos = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '')
// Mesma regra do servidor: "20924-20988" → [20924, 20988]; "020.584" → [20584].
const nfsDigitadas = (s: string | null | undefined) => String(s ?? '').split(/[^\d.]+/).map(soDigitos).filter(Boolean)
const dataBr = (d: string) => d.split('-').reverse().join('/')

function NotaDoSap({ ordemId, nfDigitada }: { ordemId: number; nfDigitada: string | null }) {
  const { data } = trpc.ordens.faturamento.obterSap.useQuery({ ordemId })
  if (!data) return null
  const digitadas = nfsDigitadas(nfDigitada)
  const diverge = digitadas.length > 0 && data.nfs.length > 0 && !data.nfs.some((n) => digitadas.includes(soDigitos(n.nf)))
  if (data.nfs.length === 0) {
    return (
      <div className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 text-xs text-dark-400">
        {data.vinculo
          ? 'Nota do SAP: assim que a NF sair no SAP, ela aparece aqui sozinha (em até 1 minuto).'
          : 'Nota do SAP: este pedido não está ligado a um pedido do SAP. Preencha o "Número do pedido" (o nº do pedido no SAP) na etapa Pedido ou Frete Finalizado que a NF passa a vir sozinha.'}
        {digitadas.map((nf) => (
          <div key={nf} className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-dark-300">NF {nf} (digitada)</span>
            <NotaSapBotoes endereco={`/ordem-nota/${ordemId}?nf=${encodeURIComponent(nf)}`} compacto />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className={`rounded-xl border p-3 space-y-2 ${diverge ? 'border-amber-600/60 bg-amber-900/10' : 'border-emerald-700/40 bg-emerald-900/10'}`}>
      <p className="text-xs font-semibold text-dark-200">Nota do SAP{data.nfs.length > 1 ? ` — ${data.nfs.length} notas neste pedido` : ''}</p>
      {data.nfs.map((n) => (
        <div key={n.nf} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-dark-100">NF <b>{n.nf}</b> <span className="text-dark-400 text-xs">· {dataBr(n.data)}</span></span>
          <NotaSapBotoes endereco={`/ordem-nota/${ordemId}?nf=${encodeURIComponent(n.nf)}`} compacto />
        </div>
      ))}
      {diverge && (
        <p className="text-xs text-amber-300">
          Atenção: a NF digitada ({nfDigitada}) é diferente da que está no SAP. Confira e corrija se for o caso.
        </p>
      )}
    </div>
  )
}
