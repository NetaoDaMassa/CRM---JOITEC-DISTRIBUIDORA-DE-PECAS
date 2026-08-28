import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import QRCode from 'qrcode'
import type { inferRouterOutputs } from '@trpc/server'
import { MessageCircle, Play, RefreshCw, Save } from 'lucide-react'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

type RodarResultado = inferRouterOutputs<AppRouter>['avisoLeads']['rodarAgora']

// Tela "Automações → Aviso de leads no WhatsApp" — só superAdmin.
// Controla a automação (server/src/lib/avisoLeadsNovos.ts) sem .env nem SSH.

type Config = {
  enabled: boolean
  dryRun: boolean
  testMode: boolean
  testNumero: string
  adminNumero: string
  horarios: string
  minIntervaloMs: number
  maxIntervaloMs: number
  msgManha: string
  msgTarde: string
}

// Substitui os atalhos com dados de exemplo — só pra prévia na tela.
function renderPrevia(template: string): string {
  const exemploLeads =
    '• Metalúrgica Santos\n• Auto Peças Lima\n• Ferramentas Dias\n• João da Borracharia\n\n...e mais 8 leads no CRM.'
  return (template || '')
    .replace(/\{nome\}/g, 'Carlos')
    .replace(/\{qtd_leads\}/g, '12 leads novos')
    .replace(/\{qtd\}/g, '12')
    .replace(/\{leads\}/g, exemploLeads)
}

const STATUS_LABEL: Record<string, { txt: string; cls: string }> = {
  conectado: { txt: 'Conectado', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  conectando: { txt: 'Conectando…', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  desconectado: { txt: 'Desconectado', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-dark-100">{titulo}</h2>
      {children}
    </div>
  )
}

function QrImg({ texto }: { texto: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    QRCode.toDataURL(texto, { width: 260, margin: 1 }).then(setSrc).catch(() => setSrc(''))
  }, [texto])
  if (!src) return null
  return <img src={src} alt="QR code do WhatsApp" className="rounded-lg bg-white p-2" width={260} height={260} />
}

export default function AutomacaoLeads() {
  const utils = trpc.useUtils()
  const empresas = trpc.avisoLeads.listarEmpresas.useQuery()

  const [empresaId, setEmpresaId] = useState<number | null>(null)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [buscandoQr, setBuscandoQr] = useState(false)
  const [previa, setPrevia] = useState<RodarResultado | null>(null)
  const qrTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Escolhe uma empresa assim que a lista chega (a 1ª que já está ligada, ou a 1ª).
  useEffect(() => {
    if (empresaId == null && empresas.data?.length) {
      setEmpresaId((empresas.data.find((e) => e.ativa) ?? empresas.data[0]).id)
    }
  }, [empresas.data, empresaId])

  const painel = trpc.avisoLeads.getPainel.useQuery(
    { empresaId: empresaId ?? 0 },
    { enabled: empresaId != null, refetchInterval: 15000 },
  )
  const vendedores = trpc.avisoLeads.listarVendedores.useQuery(
    { empresaId: empresaId ?? 0 },
    { enabled: empresaId != null },
  )

  // Trocou de empresa → limpa o formulário e a prévia.
  useEffect(() => {
    setCfg(null)
    setPrevia(null)
  }, [empresaId])

  // Semeia o formulário com o que veio do servidor (uma vez por empresa).
  useEffect(() => {
    if (painel.data?.empresaId === empresaId && !cfg) setCfg(painel.data.config)
  }, [painel.data, cfg, empresaId])

  const sessao = painel.data?.sessao
  const status = sessao?.status ?? 'desconectado'

  const salvarMut = trpc.avisoLeads.salvarConfig.useMutation({
    onSuccess(nova) {
      toast.success('Configuração salva')
      setCfg(nova)
      utils.avisoLeads.getPainel.invalidate()
      utils.avisoLeads.listarEmpresas.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  const getQrMut = trpc.avisoLeads.getQr.useMutation({
    onSuccess(s) {
      setQr(s.qr)
      if (s.status === 'conectado') {
        pararPollQr()
        utils.avisoLeads.getPainel.invalidate()
        toast.success('WhatsApp conectado!')
      }
    },
  })

  const desconectarMut = trpc.avisoLeads.desconectarWhatsapp.useMutation({
    onSuccess() {
      toast.success('Sessão desconectada. Gere um QR novo para parear outro número.')
      setQr(null)
      utils.avisoLeads.getPainel.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  const rodarMut = trpc.avisoLeads.rodarAgora.useMutation({
    onSuccess(r) {
      setPrevia(r)
      utils.avisoLeads.getPainel.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  const telMut = trpc.avisoLeads.salvarTelefoneVendedor.useMutation({
    onSuccess() {
      toast.success('Telefone salvo')
      utils.avisoLeads.listarVendedores.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  function pararPollQr() {
    if (qrTimer.current) clearInterval(qrTimer.current)
    qrTimer.current = null
    setBuscandoQr(false)
  }
  function iniciarPollQr() {
    setBuscandoQr(true)
    getQrMut.mutate()
    qrTimer.current = setInterval(() => getQrMut.mutate(), 2500)
  }
  useEffect(() => () => pararPollQr(), [])

  // Hooks têm que vir todos ANTES de qualquer return condicional.
  const sujo = useMemo(
    () => (cfg && painel.data?.empresaId === empresaId ? JSON.stringify(cfg) !== JSON.stringify(painel.data?.config) : false),
    [cfg, painel.data, empresaId],
  )

  if (empresaId == null || !cfg) return <div className="p-6 text-dark-400">Carregando…</div>

  const patch = (p: Partial<Config>) => setCfg({ ...cfg, ...p })
  const salvar = () => salvarMut.mutate({ empresaId, ...cfg })

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-dark-50 flex items-center gap-2">
          <MessageCircle size={18} /> Aviso de leads novos no WhatsApp
        </h1>
        <p className="text-xs text-dark-400 mt-1">
          Lembrete 2x por dia (dias úteis) pra cada vendedor com leads parados na etapa “Novo”. Só leitura no funil.
          Configuração por empresa; o WhatsApp que envia é o mesmo pra todas.
        </p>
      </div>

      {/* Seletor de empresa + liga/desliga desta empresa */}
      <div className="flex items-center justify-between gap-3 bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-dark-400">Empresa:</label>
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(Number(e.target.value))}
            className="bg-dark-900 border border-dark-600 rounded-lg px-2 py-1.5 text-sm text-dark-100"
          >
            {empresas.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
                {e.ativa ? ' • ligada' : ''}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => patch({ enabled: !cfg.enabled })}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
            cfg.enabled
              ? 'bg-green-500/15 text-green-400 border-green-500/30'
              : 'bg-dark-700 text-dark-300 border-dark-600'
          }`}
        >
          {cfg.enabled ? 'Ligada nesta empresa' : 'Desligada nesta empresa'}
        </button>
      </div>

      {/* Sessão do WhatsApp */}
      <Secao titulo="Sessão do WhatsApp">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${STATUS_LABEL[status]?.cls ?? ''}`}>
            {STATUS_LABEL[status]?.txt ?? status}
          </span>
          {sessao?.precisaPareamento && (
            <span className="text-xs text-amber-400">Deu logout no celular — pareie o QR de novo.</span>
          )}
          {status !== 'conectado' && !buscandoQr && (
            <Button onClick={iniciarPollQr}>Mostrar QR pra parear</Button>
          )}
          {status !== 'conectado' && buscandoQr && (
            <Button variant="secondary" onClick={pararPollQr}>Parar</Button>
          )}
          {status === 'conectado' && (
            <Button
              variant="secondary"
              onClick={() => {
                if (confirm('Desconectar o WhatsApp atual? Vai precisar parear um número de novo.')) desconectarMut.mutate()
              }}
            >
              Desconectar / trocar número
            </Button>
          )}
        </div>
        {buscandoQr && qr && (
          <div className="flex flex-col items-center gap-2 pt-2">
            <QrImg texto={qr} />
            <p className="text-xs text-dark-400 text-center">
              WhatsApp → Aparelhos conectados → Conectar um aparelho. O QR troca sozinho a cada poucos segundos.
            </p>
          </div>
        )}
        {buscandoQr && !qr && <p className="text-xs text-dark-400">Gerando QR…</p>}
      </Secao>

      {/* Configurações */}
      <Secao titulo="Configurações">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-dark-400 block mb-1">Horário da manhã</label>
            <Input
              value={cfg.horarios.split(',')[0] ?? ''}
              onChange={(e) => patch({ horarios: `${e.target.value},${cfg.horarios.split(',')[1] ?? ''}` })}
              placeholder="08:00"
            />
          </div>
          <div>
            <label className="text-xs text-dark-400 block mb-1">Horário do fim da tarde</label>
            <Input
              value={cfg.horarios.split(',')[1] ?? ''}
              onChange={(e) => patch({ horarios: `${cfg.horarios.split(',')[0] ?? ''},${e.target.value}` })}
              placeholder="17:30"
            />
          </div>
          <div>
            <label className="text-xs text-dark-400 block mb-1">Número de teste / resumo do gestor</label>
            <Input value={cfg.testNumero} onChange={(e) => patch({ testNumero: e.target.value })} placeholder="5547999999999" />
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <label className="flex items-center gap-2 text-sm text-dark-200">
            <input type="checkbox" checked={cfg.testMode} onChange={(e) => patch({ testMode: e.target.checked })} />
            Modo teste — manda tudo pro número de teste, não pros vendedores
          </label>
          <label className="flex items-center gap-2 text-sm text-dark-200">
            <input type="checkbox" checked={cfg.dryRun} onChange={(e) => patch({ dryRun: e.target.checked })} />
            Modo simulação (dry run) — monta e registra no log, não envia nada
          </label>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => salvar()} disabled={!sujo || salvarMut.isPending}>
            <Save size={15} /> Salvar
          </Button>
        </div>
      </Secao>

      {/* Texto das mensagens */}
      <Secao titulo="Texto das mensagens">
        <p className="text-xs text-dark-400">
          Atalhos que o sistema troca na hora de enviar:{' '}
          <code className="text-dark-200">{'{nome}'}</code> (1º nome do vendedor),{' '}
          <code className="text-dark-200">{'{qtd}'}</code> (só o número),{' '}
          <code className="text-dark-200">{'{qtd_leads}'}</code> (“12 leads novos”),{' '}
          <code className="text-dark-200">{'{leads}'}</code> (a lista — obrigatório).
        </p>
        {(['manha', 'tarde'] as const).map((p) => {
          const chave = p === 'manha' ? 'msgManha' : 'msgTarde'
          const valor = cfg[chave]
          return (
            <div key={p} className="space-y-1">
              <label className="text-xs text-dark-400 block">
                {p === 'manha' ? 'Mensagem da manhã' : 'Mensagem do fim da tarde'}
              </label>
              <div className="grid md:grid-cols-2 gap-2">
                <textarea
                  className="bg-dark-900 border border-dark-600 rounded-lg p-3 text-sm text-dark-100 min-h-[150px] font-mono"
                  value={valor}
                  onChange={(e) => patch({ [chave]: e.target.value } as Partial<Config>)}
                />
                <pre className="bg-dark-900 border border-dark-700 rounded-lg p-3 text-xs text-dark-200 whitespace-pre-wrap min-h-[150px]">
                  {renderPrevia(valor)}
                </pre>
              </div>
            </div>
          )
        })}
        <div className="flex justify-end">
          <Button onClick={() => salvar()} disabled={!sujo || salvarMut.isPending}>
            <Save size={15} /> Salvar
          </Button>
        </div>
      </Secao>

      {/* Rodar agora */}
      <Secao titulo="Rodar agora">
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="secondary"
            onClick={() => rodarMut.mutate({ empresaId, dryRun: true, testMode: true })}
            disabled={rodarMut.isPending}
          >
            <Play size={15} /> Simular (não envia)
          </Button>
          <Button
            onClick={() => {
              if (confirm(`Enviar as mensagens de teste agora para ${cfg.testNumero || '(número de teste vazio)'}?`))
                rodarMut.mutate({ empresaId, dryRun: false, testMode: true })
            }}
            disabled={rodarMut.isPending || !cfg.testNumero}
          >
            <Play size={15} /> Enviar teste pro meu número
          </Button>
        </div>
        {rodarMut.isPending && <p className="text-xs text-dark-400">Rodando…</p>}
        {previa && (
          <div className="text-xs text-dark-300 space-y-2">
            <p>
              {previa.vendedoresNotificados} vendedor(es) · {previa.leadsNoTotal} leads · {previa.leadsSemVendedor} sem
              vendedor · {previa.falhas.length} falha(s)
              {previa.abortadoPorConexao && ' · ABORTADO (WhatsApp sem conexão)'}
            </p>
            {previa.mensagens.map((m, i) => (
              <pre key={i} className="bg-dark-900 border border-dark-700 rounded-lg p-3 whitespace-pre-wrap">
                <span className="text-dark-500">
                  {m.vendedor} · {m.telefone ?? 'sem número'} · {m.qtdLeads} leads{'\n\n'}
                </span>
                {m.texto}
              </pre>
            ))}
            {previa.resumoAdmin && (
              <pre className="bg-dark-900 border border-dark-700 rounded-lg p-3 whitespace-pre-wrap">
                <span className="text-dark-500">resumo do gestor:{'\n\n'}</span>
                {previa.resumoAdmin}
              </pre>
            )}
          </div>
        )}
      </Secao>

      {/* Telefones dos vendedores */}
      <Secao titulo="Telefones dos vendedores">
        {vendedores.data && vendedores.data.leadsSemVendedor > 0 && (
          <p className="text-xs text-amber-400">
            {vendedores.data.leadsSemVendedor} lead(s) na etapa “Novo” estão sem vendedor definido — ninguém é avisado deles.
          </p>
        )}
        <div className="space-y-2">
          {vendedores.data?.vendedores.map((v) => (
            <LinhaVendedor
              key={v.id}
              nome={v.nome}
              leadsNovos={v.leadsNovos}
              whatsapp={v.whatsapp}
              salvando={telMut.isPending}
              onSalvar={(whatsapp) => telMut.mutate({ empresaId, userId: v.id, whatsapp })}
            />
          ))}
        </div>
      </Secao>

      {/* Última execução */}
      {painel.data?.ultimaExecucao && (
        <Secao titulo="Última execução">
          <p className="text-xs text-dark-300">
            {new Date(painel.data.ultimaExecucao.em).toLocaleString('pt-BR')} · rodada da{' '}
            {painel.data.ultimaExecucao.periodo === 'manha' ? 'manhã' : 'tarde'} · modo {painel.data.ultimaExecucao.modo} ·{' '}
            {painel.data.ultimaExecucao.vendedoresNotificados} notificados · {painel.data.ultimaExecucao.leadsNoTotal} leads ·{' '}
            {painel.data.ultimaExecucao.falhas.length} falha(s)
            {painel.data.ultimaExecucao.abortadoPorConexao && ' · ABORTADO (WhatsApp sem conexão)'}
          </p>
          {painel.data.ultimaExecucao.falhas.length > 0 && (
            <ul className="text-xs text-red-400 list-disc pl-4">
              {painel.data.ultimaExecucao.falhas.map((f, i) => (
                <li key={i}>
                  {f.vendedor} — {f.motivo}
                </li>
              ))}
            </ul>
          )}
        </Secao>
      )}
    </div>
  )
}

function LinhaVendedor({
  nome,
  leadsNovos,
  whatsapp,
  salvando,
  onSalvar,
}: {
  nome: string
  leadsNovos: number
  whatsapp: string
  salvando: boolean
  onSalvar: (whatsapp: string) => void
}) {
  const [valor, setValor] = useState(whatsapp)
  useEffect(() => setValor(whatsapp), [whatsapp])
  const mudou = valor.trim() !== whatsapp.trim()
  return (
    <div className="flex items-center gap-2">
      <div className="w-48 shrink-0">
        <div className="text-sm text-dark-100 truncate">{nome}</div>
        <div className="text-xs text-dark-500">{leadsNovos} lead(s) novo(s)</div>
      </div>
      <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="55 + DDD + número" />
      <Button variant="secondary" onClick={() => onSalvar(valor)} disabled={!mudou || salvando}>
        <RefreshCw size={14} />
      </Button>
    </div>
  )
}
