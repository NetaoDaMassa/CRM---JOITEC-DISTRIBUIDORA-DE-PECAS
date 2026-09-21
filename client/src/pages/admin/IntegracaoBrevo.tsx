import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Copy, RefreshCw, ExternalLink } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { timeAgo } from '../../lib/utils'

const TIPO_LABEL: Record<string, string> = {
  entregue: 'Entregue',
  aberto: 'Abriu',
  clicado: 'Clicou',
  resposta: 'Respondeu',
  rejeitado: 'Rejeitado',
  spam: 'Marcou como spam',
  descadastrado: 'Descadastrou',
  bloqueado: 'Bloqueado',
}
const TIPO_COR: Record<string, string> = {
  entregue: 'text-dark-400 bg-dark-700/50 border-dark-600',
  aberto: 'text-blue-400 bg-blue-900/20 border-blue-700/40',
  clicado: 'text-gold-400 bg-gold-900/20 border-gold-700/40',
  resposta: 'text-green-400 bg-green-900/20 border-green-700/40',
  rejeitado: 'text-red-400 bg-red-900/20 border-red-700/40',
  spam: 'text-red-400 bg-red-900/20 border-red-700/40',
  descadastrado: 'text-amber-400 bg-amber-900/20 border-amber-700/40',
  bloqueado: 'text-red-400 bg-red-900/20 border-red-700/40',
}

export default function IntegracaoBrevo() {
  const utils = trpc.useUtils()
  const { data: config, isLoading } = trpc.brevo.config.useQuery()
  const { data: eventos } = trpc.brevo.eventosRecentes.useQuery({ limit: 50 })
  const [gerando, setGerando] = useState(false)

  const gerarMut = trpc.brevo.gerarToken.useMutation({
    onSuccess() {
      utils.brevo.config.invalidate()
      toast.success('Nova URL de webhook gerada')
      setGerando(false)
    },
    onError(err) {
      toast.error(err.message)
      setGerando(false)
    },
  })

  const webhookUrl =
    config?.token && config.empresaSlug ? `${window.location.origin}/api/brevo/webhook/${config.empresaSlug}/${config.token}` : null

  async function copiar() {
    if (!webhookUrl) return
    try {
      await navigator.clipboard.writeText(webhookUrl)
      toast.success('URL copiada')
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  function gerar() {
    if (webhookUrl && !confirm('Isso troca a URL do webhook — se já tiver colado a anterior no Brevo, você vai precisar atualizar lá também. Continuar?')) return
    setGerando(true)
    gerarMut.mutate()
  }

  return (
    <div className="p-6 max-w-3xl space-y-5">
      <h1 className="font-heading text-xl text-dark-50">Integração Brevo (e-mail marketing)</h1>
      <p className="text-sm text-dark-400">
        Conecta sua conta do Brevo ao CRM: quando alguém clica ou responde um e-mail de campanha, isso vira um Lead aqui
        automaticamente (ou some no histórico de um Lead já existente, se o e-mail bater).
      </p>

      {isLoading ? (
        <p className="text-dark-500 text-sm">Carregando...</p>
      ) : (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-dark-100 mb-2">1. Sua URL de webhook</p>
            {webhookUrl ? (
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={webhookUrl}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="flex-1 bg-dark-900 border border-dark-700 rounded-lg text-xs text-dark-200 px-3 py-2 font-mono"
                />
                <Button size="sm" variant="secondary" onClick={copiar}>
                  <Copy size={14} /> Copiar
                </Button>
              </div>
            ) : (
              <p className="text-sm text-dark-500">Nenhuma URL gerada ainda.</p>
            )}
            <Button size="sm" variant="secondary" className="mt-2" loading={gerando} onClick={gerar}>
              <RefreshCw size={14} /> {webhookUrl ? 'Gerar nova URL' : 'Gerar URL de webhook'}
            </Button>
          </div>

          <div className="border-t border-dark-700 pt-4">
            <p className="text-sm font-semibold text-dark-100 mb-2">2. Cole no painel do Brevo</p>
            <ol className="text-sm text-dark-300 space-y-1.5 list-decimal list-inside">
              <li>
                No Brevo, vá em <span className="text-gold-400">Automações → Configurações → Webhooks</span> (ou{' '}
                <span className="text-gold-400">Transacional → Configurações → Webhooks</span>, dependendo do plano).
              </li>
              <li>Clique em "Adicionar um novo webhook".</li>
              <li>Cole a URL acima no campo "URL a ser chamada".</li>
              <li>
                Marque os eventos: <b>Clicado</b> e, se quiser ver aberturas no histórico do Lead (sem virar Lead novo
                sozinho), <b>Aberto</b> também.
              </li>
              <li>Salve.</li>
            </ol>
          </div>

          <div className="border-t border-dark-700 pt-4 bg-dark-900/40 rounded-xl p-3">
            <p className="text-sm font-semibold text-dark-100 mb-1">Resposta de verdade (clicar em "Responder")</p>
            <p className="text-xs text-dark-400">
              Isso é um recurso à parte do Brevo ("Inbound Parsing") que exige mexer no DNS de um subdomínio — ainda não
              configurado. Quando quiser habilitar, me avise que eu te guio passo a passo.
            </p>
          </div>
        </div>
      )}

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <p className="text-sm font-semibold text-dark-100 mb-3">Últimos eventos recebidos</p>
        {!eventos || eventos.length === 0 ? (
          <p className="text-sm text-dark-500">Nenhum evento recebido ainda.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {eventos.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between gap-3 text-xs border-b border-dark-700/60 pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`px-2 py-0.5 rounded-full border font-medium shrink-0 ${TIPO_COR[ev.tipo] ?? ''}`}>
                    {TIPO_LABEL[ev.tipo] ?? ev.tipo}
                  </span>
                  <span className="text-dark-300 truncate">{ev.email}</span>
                  {ev.assunto && <span className="text-dark-500 truncate hidden sm:inline">· {ev.assunto}</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {ev.lead && (
                    <Link to={`/admin/leads/${ev.lead.id}`} className="text-gold-400 hover:text-gold-300 flex items-center gap-0.5">
                      {ev.lead.name} <ExternalLink size={11} />
                    </Link>
                  )}
                  <span className="text-dark-500">{timeAgo(ev.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
