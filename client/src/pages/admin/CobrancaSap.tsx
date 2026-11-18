import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Copy, ImagePlus, Mail, MessageCircle, Phone, RefreshCw, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import GravacaoLigacao from '../../components/ui/GravacaoLigacao'
import { Input, Textarea } from '../../components/ui/Input'
import { formatDateTime } from '../../lib/utils'
import { formatarMoeda } from '../../lib/moeda'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'

// Cobrança (financeiro, 2026-11-13): contas a receber do SAP → régua de dias
// úteis 1–5 → cartório no 6º → 10 dias pra conferir → RC aos 60 dias.

type Grupo = inferRouterOutputs<AppRouter>['cobrancaSap']['listar'][number]
type Aba = 'cobrar' | 'cartorio' | 'rc' | 'pago' | 'mensagens'

const EMPRESA_LABEL: Record<string, string> = { joitec: 'Joitec', 'odin-tubos': 'Odin Tubos', 'joitec-automacao': 'Odin Automação' }
const CANAL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', ligacao: 'Ligação', email: 'E-mail', outro: 'Registro' }
const TIPO_LABEL: Record<string, string> = { cobranca: 'Cobrança', aviso_cartorio: 'Aviso de cartório', retorno: 'Retorno do cartório', observacao: 'Observação' }

const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')

function montarMensagem(modelo: string, g: Grupo) {
  const titulos = g.titulos
    .map((t) => `• ${t.tipo === 'nota' ? 'NF' : 'Título'} ${t.documento}${t.parcela ? `/${t.parcela}` : ''} — venc. ${dataBr(t.vencimento)} — ${formatarMoeda(t.valor)}`)
    .join('\n')
  return modelo.replaceAll('{cliente}', g.contato?.nomeContato || g.nomeCliente || '').replaceAll('{titulos}', titulos).replaceAll('{total}', formatarMoeda(g.total))
}

function formatarDoc(d: string) {
  const n = d.replace(/\D/g, '')
  if (n.length === 14) return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (n.length === 11) return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d
}

function telefoneWa(tel: string | null | undefined) {
  const d = (tel ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  return d.length <= 11 ? `55${d}` : d
}

function Bolinhas({ dias, atual }: { dias: number[]; atual: number }) {
  return (
    <span className="inline-flex items-center gap-1" title="Dias úteis depois do vencimento (verde = cobrado nesse dia)">
      {[1, 2, 3, 4, 5].map((d) => (
        <span
          key={d}
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold border ${
            dias.includes(d) ? 'bg-green-600 border-green-500 text-white' : d === atual ? 'border-amber-400 text-amber-300' : d < atual ? 'border-red-700/70 text-red-400' : 'border-dark-600 text-dark-500'
          }`}
        >
          {d}
        </span>
      ))}
      <span className={`ml-1 text-[10px] font-semibold ${atual >= 6 ? 'text-red-400' : 'text-dark-400'}`}>6 = cartório</span>
    </span>
  )
}

// Ligação pelo WhatsApp na Cobrança (João, 2026-11-18): só o print é
// obrigatório — tempo e o que foi conversado são opcionais.
function LigacaoWhatsappCobranca({ ids, tipo, onFechar, onRegistrada }: { ids: number[]; tipo: 'cobranca' | 'aviso_cartorio'; onFechar: () => void; onRegistrada: () => void }) {
  const [print, setPrint] = useState<File | null>(null)
  const [previa, setPrevia] = useState<string | null>(null)
  const [minutos, setMinutos] = useState('')
  const [segundos, setSegundos] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const mut = trpc.cobrancaSap.registrarLigacaoWhatsapp.useMutation()
  useEffect(() => () => void (previa && URL.revokeObjectURL(previa)), [previa])

  const escolher = (f: File | undefined | null) => {
    if (!f) return
    if (!f.type.startsWith('image/')) return toast.error('O print precisa ser uma imagem')
    setPrint(f)
    setPrevia(URL.createObjectURL(f))
  }
  const salvar = async (atendeu: boolean) => {
    if (!print) return toast.error('Anexe o print da ligação')
    setEnviando(true)
    try {
      const form = new FormData()
      form.append('file', print, print.name || 'print-ligacao-whatsapp.jpg')
      const res = await fetch('/upload/comprovante-exclusao', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('odin_token')}` }, body: form })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Não consegui enviar o print')
      const { path } = await res.json()
      const total = (Number(minutos) || 0) * 60 + (Number(segundos) || 0)
      const r = await mut.mutateAsync({ tituloIds: ids, tipo, printPath: path, atendeu, duracaoSegundos: total > 0 ? total : undefined, observacao: obs.trim() || undefined })
      toast.success(r.efetiva ? 'Ligação registrada — contou como efetiva na meta' : 'Ligação registrada — conta como tentativa na meta')
      onRegistrada()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao registrar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div
      className="rounded-lg border border-green-600/60 bg-green-900/15 p-2 space-y-2"
      onPaste={(e) => {
        const f = Array.from(e.clipboardData.files ?? []).find((x) => x.type.startsWith('image/'))
        if (f) (e.preventDefault(), escolher(f))
      }}
    >
      <p className="text-xs font-semibold text-green-100">📱 Ligação pelo WhatsApp — anexe o print da tela da ligação (obrigatório). O resto é opcional.</p>
      <div
        className="rounded-lg border-2 border-dashed border-dark-600 bg-dark-900/60 p-2 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => (e.preventDefault(), escolher(e.dataTransfer.files?.[0]))}
      >
        {previa ? (
          <div className="relative inline-block">
            <img src={previa} alt="print da ligação" className="max-h-40 rounded border border-dark-600" />
            <button type="button" onClick={() => (setPrint(null), setPrevia(null))} className="absolute -top-2 -right-2 rounded-full border border-dark-600 bg-dark-900 p-0.5 text-dark-300 hover:text-red-400">
              <X size={13} />
            </button>
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center gap-1 text-xs text-dark-300">
            <ImagePlus size={18} className="text-green-400" />
            <span>
              <b>Ctrl+V</b> pra colar o print, arraste aqui ou <span className="text-gold-400 underline">escolha o arquivo</span> *
            </span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => escolher(e.target.files?.[0])} />
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-dark-400">Tempo (opcional):</span>
        <input className="w-14 rounded-lg border border-dark-600 bg-dark-900 px-2 py-1 text-xs text-dark-100" placeholder="min" inputMode="numeric" value={minutos} onChange={(e) => setMinutos(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        <input className="w-14 rounded-lg border border-dark-600 bg-dark-900 px-2 py-1 text-xs text-dark-100" placeholder="seg" inputMode="numeric" value={segundos} onChange={(e) => setSegundos(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        <input className="min-w-[160px] flex-1 rounded-lg border border-dark-600 bg-dark-900 px-2 py-1 text-xs text-dark-100" placeholder="O que o cliente disse (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => salvar(true)} disabled={!print} loading={enviando}>
          ✓ Atendeu
        </Button>
        <Button size="sm" variant="secondary" onClick={() => salvar(false)} disabled={!print || enviando}>
          📵 Não atendeu
        </Button>
        <Button size="sm" variant="ghost" onClick={onFechar}>
          Cancelar
        </Button>
        {!print && <span className="self-center text-[11px] text-amber-300">anexe o print para registrar</span>}
      </div>
    </div>
  )
}

function CartaoCliente({ g, aba, msgs }: { g: Grupo; aba: Aba; msgs: { cobranca: string; cartorio: string } | undefined }) {
  const utils = trpc.useUtils()
  const recarregar = () => (utils.cobrancaSap.listar.invalidate(), utils.cobrancaSap.resumo.invalidate())
  const erro = (e: { message: string }) => toast.error(e.message)
  const registrar = trpc.cobrancaSap.registrarContato.useMutation({ onSuccess: () => (toast.success('Cobrança registrada'), recarregar()), onError: erro })
  const anotar = trpc.cobrancaSap.registrarContato.useMutation({ onSuccess: () => (toast.success('Observação salva'), setObs(''), recarregar()), onError: erro })
  const salvarObs = () => obs.trim() && anotar.mutate({ tituloIds: ids, canal: 'outro', tipo: 'observacao', observacao: obs.trim() })
  const pago = trpc.cobrancaSap.marcarPago.useMutation({ onSuccess: () => (toast.success('Marcado como pago'), recarregar()), onError: erro })
  const mover = trpc.cobrancaSap.mover.useMutation({ onSuccess: () => (toast.success('Movido'), recarregar()), onError: erro })
  const retorno = trpc.cobrancaSap.verificarRetorno.useMutation({ onSuccess: () => (toast.success('Registrado'), recarregar()), onError: erro })
  const { data: ramal } = trpc.pabx.meuRamal.useQuery(undefined, { staleTime: 5 * 60_000 })
  const discar = trpc.pabx.discar.useMutation({ onError: erro })
  const [historico, setHistorico] = useState(false)
  const [obs, setObs] = useState('')
  // Depois de abrir WhatsApp / e-mail / telefone, a cobrança só fica
  // registrada quando a pessoa confirma (João, 2026-11-17).
  const [aConfirmar, setAConfirmar] = useState<null | 'whatsapp' | 'ligacao' | 'email'>(null)
  const [ligacaoWa, setLigacaoWa] = useState(false)
  // Telefones/e-mails do cadastro do CRM + do SAP (João, 2026-11-18) — escolhe qual usar.
  const telefones = g.contato?.telefones ?? []
  const emails = g.contato?.emails ?? []
  const [telEscolhido, setTelEscolhido] = useState(0)
  const [emailEscolhido, setEmailEscolhido] = useState(0)
  const telAtual = telefones[telEscolhido]?.numero ?? g.contato?.telefone ?? null
  const emailAtual = emails[emailEscolhido]?.email ?? g.contato?.email ?? null
  const [desfazendo, setDesfazendo] = useState(false)
  const [motivoBaixa, setMotivoBaixa] = useState('')
  const desfazer = trpc.cobrancaSap.desfazerBaixa.useMutation({
    onSuccess: (r) => {
      if (r.voltaram) toast.success(`${r.voltaram} título(s) voltaram pra cobrança`)
      if (r.baixadosNoSap) toast.error(`${r.baixadosNoSap} título(s) estão baixados no SAP — estorne a baixa no SAP que eles voltam sozinhos`, { duration: 8000 })
      setDesfazendo(false)
      setMotivoBaixa('')
      recarregar()
    },
    onError: erro,
  })
  const documento = g.titulos.find((t) => t.cnpjCliente)?.cnpjCliente ?? g.contato?.documento ?? null

  const ids = g.titulos.map((t) => t.id)
  const tipoContato = aba === 'cartorio' ? ('aviso_cartorio' as const) : ('cobranca' as const)
  const modelo = aba === 'cartorio' ? msgs?.cartorio : msgs?.cobranca
  const texto = modelo ? montarMensagem(modelo, g) : ''
  const wa = telefoneWa(telAtual)
  const reg = (canal: 'whatsapp' | 'ligacao' | 'email' | 'outro', observacao?: string) =>
    registrar.mutate(
      { tituloIds: ids, canal, tipo: tipoContato, observacao: observacao || undefined },
      { onSuccess: () => (setAConfirmar(null), setObs('')) }
    )

  const whatsapp = () => {
    if (!wa) return toast.error('Cliente sem celular (nem no CRM nem no SAP)')
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(texto)}`, '_blank')
    setLigacaoWa(false)
    setAConfirmar('whatsapp')
  }
  const ligar = () => {
    const tel = telAtual
    if (!tel) return toast.error('Cliente sem telefone (nem no CRM nem no SAP)')
    // Pelo PABX a ligação entra sozinha no histórico (atendida ou não, com a
    // gravação) — lib/cobrancaLigacoes.ts. Sem PABX, registra no clique.
    if (ramal?.click2call)
      discar.mutate({ numero: tel }, { onSuccess: () => toast.success('Ligando pelo PABX — atenda o seu ramal. A ligação entra sozinha no histórico.') })
    else {
      window.location.href = `tel:${tel.replace(/\D/g, '')}`
      setAConfirmar('ligacao')
    }
  }
  const email = () => {
    if (!emailAtual) return toast.error('Cliente sem e-mail (nem no CRM nem no SAP)')
    const assunto = aba === 'cartorio' ? 'Aviso: título encaminhado ao cartório' : 'Títulos em aberto'
    window.location.href = `mailto:${emailAtual}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto)}`
    setAConfirmar('email')
  }

  const avisado = g.titulos.every((t) => t.cartorioAvisoEm)
  const borda = g.retornoVencido ? 'border-red-600/70' : aba === 'cobrar' && g.cobradoHoje ? 'border-green-800/60' : 'border-dark-600'
  return (
    <div className={`rounded-xl border bg-dark-800 p-3 space-y-2 ${borda}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-dark-100">
            {g.nomeCliente} <span className="text-xs font-normal text-dark-500">{g.codigoCliente}</span>
          </p>
          {documento && (
            <p className="text-xs text-dark-200">
              {documento.replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ'} <b>{formatarDoc(documento)}</b>
              <button
                type="button"
                title="Copiar"
                className="ml-1 align-middle text-dark-400 hover:text-gold-300"
                onClick={() => navigator.clipboard.writeText(documento.replace(/\D/g, '')).then(() => toast.success('Copiado'))}
              >
                <Copy size={12} />
              </button>
            </p>
          )}
          <p className="text-xs text-dark-400">
            {EMPRESA_LABEL[g.empresaSlug ?? ''] ?? g.empresaSlug}
            {g.contato?.vendedor && ` · 👤 ${g.contato.vendedor}`}
            {g.contato?.nomeContato && ` · contato: ${g.contato.nomeContato}`}
            {!g.contato && ' · sem telefone/e-mail (nem no CRM nem no SAP)'}
            {g.contato && !g.contato.temCadastroCrm && ' · sem cadastro no CRM (contato do SAP)'}
          </p>
          {(telefones.length > 0 || emails.length > 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {telefones.map((t, i) => (
                <button
                  key={`t${i}`}
                  type="button"
                  onClick={() => setTelEscolhido(i)}
                  title={telefones.length > 1 ? 'Usar este número no WhatsApp / ligação' : undefined}
                  className={`text-[11px] rounded-md border px-1.5 py-0.5 ${i === telEscolhido ? 'border-gold-600 text-gold-200 bg-gold-900/10' : 'border-dark-600 text-dark-300 hover:bg-dark-700'}`}
                >
                  📱 {t.numero} <span className={t.origem === 'SAP' ? 'text-sky-300' : 'text-emerald-300'}>{t.origem}</span>
                </button>
              ))}
              {emails.map((e, i) => (
                <button
                  key={`e${i}`}
                  type="button"
                  onClick={() => setEmailEscolhido(i)}
                  className={`text-[11px] rounded-md border px-1.5 py-0.5 ${i === emailEscolhido ? 'border-gold-600 text-gold-200 bg-gold-900/10' : 'border-dark-600 text-dark-300 hover:bg-dark-700'}`}
                >
                  ✉ {e.email} <span className={e.origem === 'SAP' ? 'text-sky-300' : 'text-emerald-300'}>{e.origem}</span>
                </button>
              ))}
              {telefones.length > 1 && <span className="text-[10px] text-dark-500">clique no número que vai usar</span>}
            </div>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-red-300">{formatarMoeda(g.total)}</p>
          {aba === 'cobrar' && g.cobradoHoje && <p className="text-[11px] text-green-400">✓ cobrado hoje</p>}
          {aba === 'cartorio' && <p className={`text-[11px] ${avisado ? 'text-green-400' : 'text-amber-300'}`}>{avisado ? '✓ cliente avisado' : '⚠ falta avisar o cliente'}</p>}
          {g.retornoVencido && <p className="text-[11px] font-bold text-red-300">⏰ voltar e conferir</p>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-dark-500">
            <tr className="text-left">
              <th className="py-1 pr-2 font-medium">Documento</th>
              <th className="py-1 pr-2 font-medium">Vencimento</th>
              <th className="py-1 pr-2 font-medium">Banco / forma de pgto</th>
              <th className="py-1 pr-2 font-medium text-right">Valor</th>
              <th className="py-1 font-medium">{aba === 'cobrar' ? 'Régua' : aba === 'cartorio' ? 'Cartório' : aba === 'rc' ? 'RC' : 'Pago'}</th>
            </tr>
          </thead>
          <tbody>
            {g.titulos.map((t) => (
              <tr key={t.id} className="border-t border-dark-700">
                <td className="py-1 pr-2 text-dark-200">
                  {t.tipo === 'nota' ? 'NF' : 'Título'} {t.documento}
                  {t.parcela ? `/${t.parcela}` : ''}
                </td>
                <td className="py-1 pr-2 text-dark-300">
                  {dataBr(t.vencimento)} <span className="text-dark-500">({t.diasVencido}d)</span>
                </td>
                <td className="py-1 pr-2 text-dark-200">
                  {t.formaPagamento ? (
                    <>
                      <b>{t.formaPagamento}</b>
                      {t.formaPagamentoDesc && <span className="block text-[10px] text-dark-400">{t.formaPagamentoDesc}</span>}
                    </>
                  ) : (
                    <span className="text-dark-500">—</span>
                  )}
                </td>
                <td className="py-1 pr-2 text-right text-dark-100">{formatarMoeda(t.valor)}</td>
                <td className="py-1">
                  {aba === 'cobrar' && (
                    <span className="flex flex-wrap items-center gap-2">
                      <Bolinhas dias={t.diasCobrados} atual={t.diaUtil} />
                      {t.cartorioPrevisto && <span className="text-[10px] text-dark-500">cartório em {dataBr(t.cartorioPrevisto)}</span>}
                    </span>
                  )}
                  {aba === 'cartorio' && (
                    <span className="text-dark-300">
                      enviado {dataBr(t.cartorioEm)} · conferir em <b className={t.retornoVencido ? 'text-red-300' : ''}>{dataBr(t.retornoEm)}</b>
                      {t.retornoResultado && <span className="text-dark-500"> · última conferência: {t.retornoResultado}</span>}
                    </span>
                  )}
                  {aba === 'rc' && <span className="text-dark-300">enviado à RC em {dataBr(t.rcEm)}</span>}
                  {aba === 'pago' && (
                    <span className="text-green-400">
                      {dataBr(t.pagoEm)} {t.pagoAuto ? '(baixa no SAP)' : '(marcado no CRM)'}
                      {t.abertoNoSap === true && <span className="ml-1 text-amber-300">· ⚠ ainda em aberto no SAP</span>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(aba === 'cobrar' || aba === 'cartorio') && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-dark-400">{aba === 'cartorio' ? 'Avisar que foi a cartório:' : 'Cobrar:'}</span>
            <Button size="sm" variant="secondary" onClick={whatsapp} disabled={registrar.isPending}>
              <MessageCircle size={13} className="mr-1 text-green-400" /> WhatsApp
            </Button>
            {aba === 'cobrar' && (
              <Button size="sm" variant="secondary" onClick={ligar} disabled={registrar.isPending}>
                <Phone size={13} className="mr-1 text-sky-400" /> Ligar{ramal?.click2call ? ' (PABX)' : ''}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => (setAConfirmar(null), setLigacaoWa(true))} disabled={registrar.isPending}>
              📱 Ligação pelo WhatsApp
            </Button>
            <Button size="sm" variant="secondary" onClick={email} disabled={registrar.isPending}>
              <Mail size={13} className="mr-1 text-amber-300" /> E-mail
            </Button>
            <input
              className="min-w-[180px] flex-1 rounded-lg border border-dark-600 bg-dark-900 px-2 py-1 text-xs text-dark-100"
              placeholder="Observação (o que o cliente disse) — opcional"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !aConfirmar && salvarObs()}
            />
            {/* Só anotar, sem cobrar (João 2026-11-18): vai pro histórico, não conta na régua. */}
            <Button size="sm" variant="secondary" onClick={salvarObs} disabled={!obs.trim() || !!aConfirmar} loading={anotar.isPending}>
              💬 Salvar observação
            </Button>
          </div>
          {ligacaoWa && <LigacaoWhatsappCobranca ids={ids} tipo={tipoContato} onFechar={() => setLigacaoWa(false)} onRegistrada={() => (setLigacaoWa(false), recarregar())} />}
          {aConfirmar && (
            <div className="rounded-lg border border-amber-500/70 bg-amber-900/20 p-2 space-y-2">
              <p className="text-xs font-semibold text-amber-100">
                Você abriu o {aConfirmar === 'whatsapp' ? 'WhatsApp' : aConfirmar === 'email' ? 'e-mail' : 'telefone'}. Conseguiu{' '}
                {aba === 'cartorio' ? 'avisar o cliente' : 'cobrar'}? Confirme para ficar no histórico.
              </p>
              <input
                className="w-full rounded-lg border border-dark-600 bg-dark-900 px-2 py-1 text-xs text-dark-100"
                placeholder="O que o cliente disse (opcional)"
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => reg(aConfirmar, obs)} loading={registrar.isPending}>
                  ✓ Confirmar {aba === 'cartorio' ? 'aviso' : 'cobrança'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => reg(aConfirmar, `Sem resposta${obs ? ` — ${obs}` : ''}`)} disabled={registrar.isPending}>
                  📵 Não respondeu / não atendeu
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAConfirmar(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {aba === 'cartorio' && (
              <>
                <Button size="sm" onClick={() => retorno.mutate({ tituloIds: ids, resultado: 'pago', observacao: obs || undefined })}>
                  Conferi: pago
                </Button>
                <Button size="sm" variant="secondary" onClick={() => retorno.mutate({ tituloIds: ids, resultado: 'nao_pago', observacao: obs || undefined })}>
                  Conferi: ainda não pago (+ prazo)
                </Button>
                <Button size="sm" variant="ghost" onClick={() => mover.mutate({ tituloIds: ids, para: 'rc' })}>
                  Mandar para RC
                </Button>
              </>
            )}
            {aba === 'cobrar' && (
              <>
                <Button size="sm" onClick={() => pago.mutate({ tituloIds: ids, observacao: obs || undefined })}>
                  ✓ Cliente pagou
                </Button>
                <Button size="sm" variant="ghost" onClick={() => mover.mutate({ tituloIds: ids, para: 'cartorio' })}>
                  Mandar ao cartório agora
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {aba === 'rc' && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => pago.mutate({ tituloIds: ids })}>
            ✓ Pago
          </Button>
          <Button size="sm" variant="ghost" onClick={() => mover.mutate({ tituloIds: ids, para: 'cartorio' })}>
            Voltar para cartório
          </Button>
        </div>
      )}
      {aba === 'pago' &&
        (() => {
          const podeVoltar = g.titulos.filter((t) => t.abertoNoSap)
          const soNoSap = g.titulos.filter((t) => t.abertoNoSap === false)
          return (
            <div className="space-y-1.5">
              {!desfazendo ? (
                <div className="flex flex-wrap items-center gap-2">
                  {podeVoltar.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => setDesfazendo(true)}>
                      ↩ Desfazer baixa (baixa errada)
                    </Button>
                  )}
                  {soNoSap.length > 0 && (
                    <span className="text-[11px] text-dark-500">
                      {soNoSap.length === g.titulos.length ? 'Baixado' : `${soNoSap.length} título(s) baixado(s)`} também no SAP — se a baixa foi errada, estorne no SAP que volta sozinho pra cobrança (o SAP é lido de hora em hora).
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-600/50 bg-amber-900/10 p-2">
                  <span className="text-xs text-amber-200">
                    Voltar {podeVoltar.length} título(s) pra etapa em que estava{podeVoltar.some((t) => t.rcEm) ? ' (RC)' : podeVoltar.some((t) => t.cartorioEm) ? ' (cartório)' : ' (cobrança)'}?
                  </span>
                  <input
                    className="min-w-[180px] flex-1 rounded-lg border border-dark-600 bg-dark-900 px-2 py-1 text-xs text-dark-100"
                    placeholder="Motivo (opcional) — ex.: baixa no cliente errado"
                    value={motivoBaixa}
                    onChange={(e) => setMotivoBaixa(e.target.value)}
                  />
                  <Button size="sm" onClick={() => desfazer.mutate({ tituloIds: podeVoltar.map((t) => t.id), motivo: motivoBaixa.trim() || undefined })} loading={desfazer.isPending}>
                    Sim, voltar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDesfazendo(false)}>
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          )
        })()}

      {(() => {
        const todos = [...new Map(g.titulos.flatMap((t) => t.contatos).map((c) => [c.createdAt + c.canal + c.tipo, c])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        if (!todos.length) return <p className="text-[11px] text-dark-500">Histórico da cobrança: nenhuma ação ainda.</p>
        return (
        <div className="rounded-lg bg-dark-900/50 p-2">
          <p className="text-[11px] font-semibold text-dark-300">Histórico da cobrança ({todos.length})</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-dark-400">
              {(historico ? todos : todos.slice(0, 4))
                .map((c) => (
                  <li key={c.id}>
                    {formatDateTime(c.createdAt)} · {c.tipo === 'observacao' ? '💬 Observação' : `${TIPO_LABEL[c.tipo]} por ${CANAL_LABEL[c.canal]}`}
                    {c.diaRegua ? ` (dia ${c.diaRegua})` : ''} · {c.quem ?? '—'}
                    {c.observacao ? ` — ${c.observacao}` : ''}
                    {c.printPath && (
                      <a href={c.printPath} target="_blank" rel="noreferrer" className="ml-1 text-gold-400 underline">
                        🖼 ver print
                      </a>
                    )}
                    {c.ligacaoId && c.ligacaoPartes > 0 && (
                      <div className="mt-1 mb-1.5">
                        <GravacaoLigacao ligacaoId={c.ligacaoId} partes={c.ligacaoPartes} />
                      </div>
                    )}
                    {c.ligacaoId && !c.ligacaoPartes && c.ligacaoEfetiva && !c.printPath && <span className="text-dark-500"> · 🎧 a gravação aparece aqui alguns minutos depois</span>}
                  </li>
                ))}
            </ul>
          {todos.length > 4 && (
            <button className="mt-1 text-[11px] text-gold-400 hover:underline" onClick={() => setHistorico(!historico)}>
              {historico ? '▾ mostrar só as últimas' : `▸ ver todas (${todos.length})`}
            </button>
          )}
        </div>
        )
      })()}
    </div>
  )
}

function Mensagens() {
  const utils = trpc.useUtils()
  const { data } = trpc.cobrancaSap.mensagens.useQuery()
  const { data: resumo } = trpc.cobrancaSap.resumo.useQuery()
  const [cobranca, setCobranca] = useState('')
  const [cartorio, setCartorio] = useState('')
  const [diasRetorno, setDiasRetorno] = useState('10')
  const [diasRc, setDiasRc] = useState('60')
  useEffect(() => {
    if (data) (setCobranca(data.cobranca), setCartorio(data.cartorio))
  }, [data])
  useEffect(() => {
    if (resumo) (setDiasRetorno(String(resumo.diasRetorno)), setDiasRc(String(resumo.diasRc)))
  }, [resumo])
  const salvar = trpc.cobrancaSap.salvarMensagens.useMutation({ onSuccess: () => (toast.success('Salvo'), utils.cobrancaSap.invalidate()), onError: (e) => toast.error(e.message) })
  return (
    <div className="space-y-4">
      <p className="text-sm text-dark-400">
        Use <code className="text-gold-400">{'{cliente}'}</code>, <code className="text-gold-400">{'{titulos}'}</code> (lista com documento, vencimento e valor) e{' '}
        <code className="text-gold-400">{'{total}'}</code> — são trocados pelos dados do cliente na hora de mandar.
      </p>
      <Textarea label="Mensagem de cobrança (dias 1 a 5)" rows={8} value={cobranca} onChange={(e) => setCobranca(e.target.value)} />
      <Textarea label="Mensagem de aviso de cartório" rows={7} value={cartorio} onChange={(e) => setCartorio(e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2 max-w-md">
        <Input label="Dias para voltar e conferir o cartório" type="number" value={diasRetorno} onChange={(e) => setDiasRetorno(e.target.value)} />
        <Input label="Dias do vencimento até mandar à RC" type="number" value={diasRc} onChange={(e) => setDiasRc(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button onClick={() => salvar.mutate({ cobranca, cartorio, diasRetorno: Number(diasRetorno) || 10, diasRc: Number(diasRc) || 60 })} loading={salvar.isPending}>
          Salvar
        </Button>
        {data && (
          <Button variant="ghost" onClick={() => (setCobranca(data.padrao.cobranca), setCartorio(data.padrao.cartorio))}>
            Voltar ao texto padrão
          </Button>
        )}
      </div>
    </div>
  )
}

export default function CobrancaSap() {
  const [aba, setAba] = useState<Aba>('cobrar')
  const [empresa, setEmpresa] = useState('')
  const [busca, setBusca] = useState('')
  const utils = trpc.useUtils()
  const { data: resumo } = trpc.cobrancaSap.resumo.useQuery()
  const { data: msgs } = trpc.cobrancaSap.mensagens.useQuery()
  const { data, isLoading } = trpc.cobrancaSap.listar.useQuery({ aba: aba === 'mensagens' ? 'cobrar' : aba, empresa: empresa || undefined }, { enabled: aba !== 'mensagens' })
  const atualizar = trpc.cobrancaSap.atualizarAgora.useMutation({
    onSuccess: (r) => (toast.success(`${r.novos} novo(s), ${r.pagos} pago(s), ${r.cartorio} p/ cartório, ${r.rc} p/ RC`), utils.cobrancaSap.invalidate()),
    onError: (e) => toast.error(e.message),
  })
  const q = busca.trim().toLowerCase()
  const lista = (data ?? []).filter((g) => !q || [g.nomeCliente, g.codigoCliente, g.contato?.vendedor, ...g.titulos.map((t) => t.documento)].some((x) => (x ?? '').toLowerCase().includes(q)))
  const rotulo: Record<Aba, string> = {
    cobrar: `A cobrar${resumo ? ` (${resumo.cobrar.qtd})` : ''}`,
    cartorio: `Cartório${resumo ? ` (${resumo.cartorio.qtd})` : ''}`,
    rc: `Enviados à RC${resumo ? ` (${resumo.rc.qtd})` : ''}`,
    pago: 'Pagos',
    mensagens: 'Mensagens e prazos',
  }

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl text-dark-50">Cobrança</h1>
          <p className="text-sm text-dark-400 mt-1 max-w-3xl">
            Contas a receber do SAP (Joitec, Odin Tubos e Odin Automação). O título entra 1 dia útil depois do vencimento (sem sábado, domingo e feriado). Cobre nos dias 1 a 5: cada clique em
            WhatsApp, Ligar ou E-mail fica registrado. No 6º dia útil sem pagamento, vai sozinho para o cartório (avise o cliente). Depois de {resumo?.diasRetorno ?? 10} dias, volte e confira. Com{' '}
            {resumo?.diasRc ?? 60} dias do vencimento sem pagar, vai para a RC. Quando sai a baixa no SAP, vira pago sozinho.
          </p>
          {resumo?.fotoSapEm && <p className="text-[11px] text-dark-500 mt-1">Contas a receber do SAP atualizadas em {formatDateTime(resumo.fotoSapEm)}</p>}
          <a href="/admin/negociacoes" className="mt-1 inline-block text-[11px] text-dark-500 underline hover:text-dark-300" title="A tela antiga, preenchida à mão, continua guardada">
            Abrir a tela antiga (Negociações)
          </a>
        </div>
        <div className="flex items-center gap-2">
          <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-sm text-dark-100" aria-label="Empresa">
            <option value="">Todas as empresas</option>
            {Object.entries(EMPRESA_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" onClick={() => atualizar.mutate()} loading={atualizar.isPending}>
            <RefreshCw size={13} className="mr-1" /> Atualizar
          </Button>
        </div>
      </div>

      {resumo && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-amber-700/40 bg-amber-900/10 p-3">
            <p className="text-xs text-dark-400">A cobrar</p>
            <p className="text-lg font-bold text-amber-200">{formatarMoeda(resumo.cobrar.valor)}</p>
            <p className="text-[11px] text-dark-500">{resumo.cobrar.qtd} título(s)</p>
          </div>
          <div className="rounded-xl border border-red-700/40 bg-red-900/10 p-3">
            <p className="text-xs text-dark-400">No cartório</p>
            <p className="text-lg font-bold text-red-300">{formatarMoeda(resumo.cartorio.valor)}</p>
            <p className="text-[11px] text-dark-500">
              {resumo.cartorio.qtd} título(s){resumo.cartorio.retornoVencido ? ` · ${resumo.cartorio.retornoVencido} para conferir` : ''}
            </p>
          </div>
          <div className="rounded-xl border border-violet-700/40 bg-violet-900/10 p-3">
            <p className="text-xs text-dark-400">Enviados à RC</p>
            <p className="text-lg font-bold text-violet-200">{formatarMoeda(resumo.rc.valor)}</p>
            <p className="text-[11px] text-dark-500">{resumo.rc.qtd} título(s)</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-dark-700">
        {(['cobrar', 'cartorio', 'rc', 'pago', 'mensagens'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAba(t)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${aba === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
          >
            {rotulo[t]}
          </button>
        ))}
      </div>

      {aba === 'mensagens' ? (
        <Mensagens />
      ) : (
        <>
          <Input placeholder="Buscar cliente, código, NF, vendedor…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {isLoading && <p className="text-sm text-dark-400">Carregando…</p>}
          {!isLoading && lista.length === 0 && <p className="text-sm text-dark-400">Nada aqui.</p>}
          <div className="space-y-2">
            {lista.map((g) => (
              <CartaoCliente key={g.chave} g={g} aba={aba} msgs={msgs} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
