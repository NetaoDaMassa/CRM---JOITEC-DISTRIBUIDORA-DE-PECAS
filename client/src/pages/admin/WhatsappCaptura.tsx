import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import QRCode from 'qrcode'
import { Link } from 'react-router-dom'
import { Smartphone, Power, QrCode, LogOut } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'

// Tela "WhatsApp → leads" (só superAdmin), pedido do João 2026-11-25.
// Conecta o WhatsApp principal de uma empresa ao CRM só para LER: mensagem de
// número novo vira lead (etapa Novo, vendedor pelo DDD), e a conversa aparece
// na ficha do lead. O CRM não envia nada por esta conexão.

const ESTADO: Record<string, { txt: string; cls: string }> = {
  conectado: { txt: 'Conectado', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  conectando: { txt: 'Conectando…', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  aguardando_qr: { txt: 'Esperando ler o QR', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  desconectado: { txt: 'Desconectado', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  desligada: { txt: 'Desligada', cls: 'bg-dark-700 text-dark-300 border-dark-600' },
}
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function QrImg({ texto }: { texto: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => { QRCode.toDataURL(texto, { width: 260, margin: 1 }).then(setSrc).catch(() => setSrc('')) }, [texto])
  return src ? <img src={src} alt="QR code do WhatsApp" className="rounded-lg bg-white p-2" width={260} height={260} /> : null
}

export default function WhatsappCaptura() {
  const utils = trpc.useUtils()
  const empresas = trpc.whatsappCaptura.empresas.useQuery()
  const [empresaId, setEmpresaId] = useState<number | null>(null)
  useEffect(() => {
    if (empresaId || !empresas.data?.length) return
    setEmpresaId((empresas.data.find((e) => /odin compressores/i.test(e.nome)) ?? empresas.data[0]).id)
  }, [empresas.data, empresaId])
  const painel = trpc.whatsappCaptura.painel.useQuery({ empresaId: empresaId ?? 0 }, { enabled: !!empresaId, refetchInterval: 5000 })
  const [qr, setQr] = useState<string | null>(null)
  const qrTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const recarregar = () => { utils.whatsappCaptura.painel.invalidate(); utils.whatsappCaptura.empresas.invalidate() }

  const ligar = trpc.whatsappCaptura.ligar.useMutation({ onSuccess: recarregar, onError: (e) => toast.error(e.message) })
  const desconectar = trpc.whatsappCaptura.desconectar.useMutation({ onSuccess: () => { toast.success('Desconectado. Para conectar outro número, mostre o QR de novo.'); recarregar() }, onError: (e) => toast.error(e.message) })
  const qrMut = trpc.whatsappCaptura.qr.useMutation({
    onSuccess: (r) => {
      setQr(r.qr)
      if (r.estado === 'conectado') { pararQr(); toast.success('WhatsApp conectado!'); recarregar() }
    },
    onError: (e) => { pararQr(); toast.error(e.message) },
  })
  function pararQr() { if (qrTimer.current) clearInterval(qrTimer.current); qrTimer.current = null; setQr(null) }
  function mostrarQr() {
    if (!empresaId) return
    pararQr()
    qrMut.mutate({ empresaId })
    qrTimer.current = setInterval(() => qrMut.mutate({ empresaId }), 2500)
  }
  useEffect(() => () => pararQr(), [])
  useEffect(() => { pararQr() }, [empresaId])

  const p = painel.data
  const est = ESTADO[p?.estado ?? 'desligada'] ?? ESTADO.desligada

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold text-dark-100 flex items-center gap-2"><Smartphone className="w-7 h-7 text-emerald-400" /> WhatsApp → leads</h1>
        <p className="text-sm text-dark-400">Conecta o WhatsApp principal da empresa ao CRM. Mensagem de número novo vira lead na etapa <b>Novo</b>, com o vendedor escolhido pelo DDD (mesma regra dos leads da Meta). A conversa aparece na ficha do lead. <b>O CRM não envia nenhuma mensagem e não marca nada como lido</b> — o celular continua notificando normalmente.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(empresas.data ?? []).map((e) => (
          <button key={e.id} onClick={() => setEmpresaId(e.id)} className={`px-3 py-1.5 rounded-lg text-sm border ${empresaId === e.id ? 'border-emerald-500 bg-emerald-500/10 text-dark-100' : 'border-dark-600 text-dark-300 hover:border-dark-500'}`}>
            {e.nome}{e.ativa && <span className="ml-1.5 text-emerald-400">●</span>}
          </button>
        ))}
      </div>

      {p && empresaId && (
        <>
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`text-xs px-2.5 py-1 rounded-full border ${est.cls}`}>{est.txt}</span>
              {p.numero && <span className="text-sm text-dark-300">Número: <b className="text-dark-100">+{p.numero}</b></span>}
              {p.conectadoEm && p.estado === 'conectado' && <span className="text-xs text-dark-500">desde {quando(p.conectadoEm)}</span>}
              <span className="text-xs text-dark-500 ml-auto">{p.leads7} lead(s) pelo WhatsApp em 7 dias</span>
            </div>
            {p.precisaParear && <p className="text-sm text-red-400">O WhatsApp foi desconectado no celular. Leia o QR code de novo para voltar a capturar.</p>}

            <div className="flex flex-wrap gap-2">
              <Button variant={p.ativa ? 'secondary' : 'primary'} loading={ligar.isPending} onClick={() => ligar.mutate({ empresaId, ativa: !p.ativa })}>
                <Power className="w-4 h-4 mr-1" />{p.ativa ? 'Desligar captura' : 'Ligar captura'}
              </Button>
              {p.ativa && p.estado !== 'conectado' && <Button variant="secondary" onClick={mostrarQr} loading={qrMut.isPending && !qr}><QrCode className="w-4 h-4 mr-1" />Mostrar QR para conectar</Button>}
              {p.temLoginSalvo && <Button variant="secondary" loading={desconectar.isPending} onClick={() => { if (window.confirm('Desconectar este WhatsApp do CRM? Para voltar vai precisar ler o QR code de novo.')) desconectar.mutate({ empresaId }) }}><LogOut className="w-4 h-4 mr-1" />Desconectar / trocar número</Button>}
            </div>

            {qr && (
              <div className="flex flex-wrap items-start gap-5 rounded-xl bg-dark-900/60 p-4">
                <QrImg texto={qr} />
                <ol className="text-sm text-dark-300 space-y-1.5 list-decimal pl-4 max-w-sm">
                  <li>Pegue o celular com o WhatsApp <b>principal da empresa</b>.</li>
                  <li>Toque em <b>⋮ (ou Configurações) → Aparelhos conectados → Conectar um aparelho</b>.</li>
                  <li>Aponte a câmera para este QR. Ele muda a cada ~20 segundos; a tela atualiza sozinha.</li>
                  <li>Quando conectar, esta tela mostra <b>Conectado</b>.</li>
                </ol>
              </div>
            )}
            <p className="text-xs text-dark-500">Conversas antigas não entram: só mensagens que chegarem depois de conectar. Grupos, status e canais são ignorados. Contagem desde o último reinício do servidor: {p.contagem.recebidas} recebidas · {p.contagem.enviadas} enviadas · {p.contagem.leadsCriados} leads criados{p.contagem.erros ? ` · ${p.contagem.erros} erros` : ''}.</p>
            {p.ultimoEvento && <p className="text-xs text-dark-500">Último evento: {p.ultimoEvento.slice(25)}</p>}
          </div>

          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-dark-100">Últimas mensagens capturadas</h2>
            {!p.ultimas.length && <p className="text-sm text-dark-500">Nenhuma ainda.</p>}
            <div className="divide-y divide-dark-700">
              {p.ultimas.map((m) => (
                <div key={m.id} className="py-2 flex items-start gap-3 text-sm">
                  <span className={`text-[10px] mt-0.5 px-1.5 py-0.5 rounded ${m.direcao === 'recebida' ? 'bg-dark-700 text-dark-300' : 'bg-emerald-600/20 text-emerald-300'}`}>{m.direcao === 'recebida' ? 'recebida' : 'enviada'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-dark-200 truncate">{m.texto}</div>
                    <div className="text-xs text-dark-500">{quando(m.enviadaEm)} · {m.pushName || (m.telefone ? `+${m.telefone}` : '—')}{m.leadId ? <> · <Link className="text-emerald-400 hover:underline" to={`/admin/leads/${m.leadId}`}>lead #{m.leadId} {m.leadNome}</Link></> : ' · ainda não é lead'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
