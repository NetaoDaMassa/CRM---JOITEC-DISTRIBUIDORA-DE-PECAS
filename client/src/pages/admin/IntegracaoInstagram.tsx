import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Instagram, Plus, X, Unplug } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import { timeAgo } from '../../lib/utils'

// Tela "Configurações > Integração Instagram" — conectar a conta
// profissional (via OAuth), editar palavras-chave e mensagens automáticas.
// O webhook em si (que a Meta chama) é público, em
// server/src/routes/instagram.ts. Pedido do João, 2026-09-21.
export default function IntegracaoInstagram() {
  const utils = trpc.useUtils()
  const { data: status, isLoading: carregandoStatus } = trpc.instagram.status.useQuery()
  const { data: config, isLoading: carregandoConfig } = trpc.instagram.getConfiguracoes.useQuery()

  const [keywords, setKeywords] = useState<string[]>([])
  const [novaKeyword, setNovaKeyword] = useState('')
  const [commentReplyMessage, setCommentReplyMessage] = useState('')
  const [welcomeDmMessage, setWelcomeDmMessage] = useState('')

  useEffect(() => {
    if (!config) return
    setKeywords(config.triggerKeywords)
    setCommentReplyMessage(config.commentReplyMessage)
    setWelcomeDmMessage(config.welcomeDmMessage)
  }, [config])

  const conectarMut = trpc.instagram.urlConexao.useMutation({
    onSuccess({ url }) {
      window.location.href = url
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const desconectarMut = trpc.instagram.desconectar.useMutation({
    onSuccess() {
      utils.instagram.status.invalidate()
      toast.success('Instagram desconectado')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const salvarMut = trpc.instagram.salvarConfiguracoes.useMutation({
    onSuccess() {
      toast.success('Configurações salvas')
      utils.instagram.getConfiguracoes.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function adicionarKeyword() {
    const valor = novaKeyword.trim()
    if (!valor || keywords.includes(valor)) return
    setKeywords((prev) => [...prev, valor])
    setNovaKeyword('')
  }

  return (
    <div className="p-6 max-w-3xl space-y-5">
      <div className="flex items-center gap-2">
        <Instagram size={20} className="text-gold-400" />
        <h1 className="font-heading text-xl text-dark-50">Integração Instagram</h1>
      </div>
      <p className="text-sm text-dark-400">
        Conecta a conta profissional do Instagram da empresa. Quando alguém comenta uma palavra-chave num post/reels
        (resposta automática no direct) ou manda a primeira mensagem direta (boas-vindas automática), isso vira um Lead
        aqui, sem telefone — complete o telefone e atribua a um vendedor quando for falar com a pessoa.
      </p>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-3">
        <p className="text-sm font-semibold text-dark-100">Conexão</p>
        {carregandoStatus ? (
          <p className="text-sm text-dark-500">Carregando...</p>
        ) : status?.conectado ? (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-green-400 bg-green-900/15 border border-green-700/30 rounded-lg px-3 py-2 flex-1">
              Conectado {status.igUsername ? `como @${status.igUsername}` : ''}
              {status.connectedAt && <span className="text-dark-500"> · desde {timeAgo(status.connectedAt)}</span>}
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={desconectarMut.isPending}
              onClick={() => {
                if (confirm('Desconectar o Instagram dessa empresa? A automação para de responder até reconectar.')) desconectarMut.mutate()
              }}
            >
              <Unplug size={14} /> Desconectar
            </Button>
          </div>
        ) : (
          <Button loading={conectarMut.isPending} onClick={() => conectarMut.mutate()}>
            <Instagram size={14} /> Conectar Instagram
          </Button>
        )}
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
        <p className="text-sm font-semibold text-dark-100">Automação</p>
        {carregandoConfig ? (
          <p className="text-sm text-dark-500">Carregando...</p>
        ) : (
          <>
            <div>
              <label className="text-sm text-dark-200 font-medium block mb-1">Palavras-chave (comentário → resposta no direct)</label>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                {keywords.map((k) => (
                  <span key={k} className="flex items-center gap-1 text-xs bg-dark-700 border border-dark-600 rounded-full px-2 py-1 text-dark-200">
                    {k}
                    <button type="button" onClick={() => setKeywords((prev) => prev.filter((x) => x !== k))} className="text-dark-500 hover:text-red-400">
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {!keywords.length && <p className="text-xs text-dark-500">Nenhuma palavra-chave ainda.</p>}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={novaKeyword}
                  onChange={(e) => setNovaKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      adicionarKeyword()
                    }
                  }}
                  placeholder="Ex: quero, preço, catálogo"
                  className="flex-1"
                />
                <Button type="button" size="sm" variant="secondary" onClick={adicionarKeyword}>
                  <Plus size={14} /> Adicionar
                </Button>
              </div>
            </div>

            <Textarea
              label="Mensagem do private reply (comentário com palavra-chave)"
              value={commentReplyMessage}
              onChange={(e) => setCommentReplyMessage(e.target.value)}
              rows={2}
            />

            <Textarea
              label="Mensagem de boas-vindas (primeira mensagem direta)"
              value={welcomeDmMessage}
              onChange={(e) => setWelcomeDmMessage(e.target.value)}
              rows={2}
            />

            <Button
              loading={salvarMut.isPending}
              onClick={() =>
                salvarMut.mutate({
                  triggerKeywords: keywords,
                  commentReplyMessage: commentReplyMessage.trim(),
                  welcomeDmMessage: welcomeDmMessage.trim(),
                })
              }
            >
              Salvar configurações
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
