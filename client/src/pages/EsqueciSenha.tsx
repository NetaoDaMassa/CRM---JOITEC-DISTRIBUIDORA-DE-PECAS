import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'

// "Esqueci minha senha" self-service, sem depender de e-mail (não existe
// cadastro) nem WhatsApp (automação instável) — usa a pergunta de
// segurança que a própria pessoa cadastrou na última troca de senha (ver
// TrocarSenha.tsx). Quem ainda não tem uma cadastrada precisa falar com o
// admin pra resetar, igual sempre foi. Pedido do João, 2026-10-07.
export default function EsqueciSenha() {
  const navigate = useNavigate()
  const [etapa, setEtapa] = useState<'usuario' | 'resposta'>('usuario')
  const [username, setUsername] = useState('')
  const [pergunta, setPergunta] = useState('')
  const [resposta, setResposta] = useState('')
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')

  const obterPerguntaMut = trpc.auth.esqueciSenhaObterPergunta.useMutation({
    onSuccess(data) {
      setPergunta(data.pergunta)
      setEtapa('resposta')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const redefinirMut = trpc.auth.esqueciSenhaRedefinir.useMutation({
    onSuccess() {
      toast.success('Senha redefinida! Já pode entrar com a senha nova.')
      navigate('/login')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function handleUsuario(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim()) return toast.error('Digite seu usuário')
    obterPerguntaMut.mutate({ username: username.trim() })
  }

  function handleResposta(e: React.FormEvent) {
    e.preventDefault()
    if (!resposta.trim()) return toast.error('Responda a pergunta de segurança')
    if (novaSenha !== confirmar) return toast.error('As senhas não coincidem.')
    redefinirMut.mutate({ username: username.trim(), resposta: resposta.trim(), novaSenha })
  }

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-dark-800 border border-dark-600 rounded-2xl p-8 shadow-2xl">
        <h1 className="font-heading text-lg text-gold-400 font-bold mb-1">Esqueci minha senha</h1>

        {etapa === 'usuario' && (
          <>
            <p className="text-dark-400 text-sm mb-6">Digite seu usuário pra ver sua pergunta de segurança.</p>
            <form onSubmit={handleUsuario} className="space-y-4">
              <Input label="Usuário" placeholder="seu.usuario" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
              <Button type="submit" size="lg" className="w-full mt-2" loading={obterPerguntaMut.isPending}>
                Continuar
              </Button>
            </form>
          </>
        )}

        {etapa === 'resposta' && (
          <>
            <p className="text-dark-400 text-sm mb-6">Responda sua pergunta de segurança e escolha uma senha nova.</p>
            <form onSubmit={handleResposta} className="space-y-4">
              <div>
                <p className="text-sm text-dark-200 font-medium mb-1">{pergunta}</p>
                <Input label="Sua resposta" value={resposta} onChange={(e) => setResposta(e.target.value)} />
              </div>
              <Input label="Nova senha" type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
              <Input label="Confirmar senha" type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
              <Button type="submit" size="lg" className="w-full mt-2" loading={redefinirMut.isPending}>
                Redefinir senha
              </Button>
            </form>
          </>
        )}

        <Link to="/login" className="block text-center text-dark-500 text-xs mt-6 hover:text-dark-300">
          Voltar pro login
        </Link>
      </div>
    </div>
  )
}
