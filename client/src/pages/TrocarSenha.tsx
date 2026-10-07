import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'

// Pergunta/resposta de segurança são pedidas aqui (se a pessoa ainda não
// tiver uma cadastrada) — é o que alimenta o "Esqueci minha senha" lá no
// Login, sem depender de e-mail (não existe) nem WhatsApp (não confiável).
// Vai virando padrão aos poucos, conforme o admin for resetando senha de
// cada um. Pedido do João, 2026-10-07.
export default function TrocarSenha() {
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [perguntaSeguranca, setPerguntaSeguranca] = useState('')
  const [respostaSeguranca, setRespostaSeguranca] = useState('')
  const navigate = useNavigate()

  const trocarMut = trpc.auth.trocarSenha.useMutation({
    onSuccess() {
      toast.success('Senha alterada com sucesso.')
      navigate('/')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (novaSenha !== confirmar) return toast.error('As senhas não coincidem.')
    trocarMut.mutate({ novaSenha, perguntaSeguranca: perguntaSeguranca || undefined, respostaSeguranca: respostaSeguranca || undefined })
  }

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-dark-800 border border-dark-600 rounded-2xl p-8 shadow-2xl">
        <h1 className="font-heading text-lg text-gold-400 font-bold mb-1">Troque sua senha</h1>
        <p className="text-dark-400 text-sm mb-6">
          Por segurança, defina uma senha nova antes de continuar (mínimo 8 caracteres, com letras e números).
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nova senha"
            type="password"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
          />
          <Input
            label="Confirmar senha"
            type="password"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
          />
          <div className="pt-2 border-t border-dark-700 space-y-3">
            <div>
              <p className="text-sm text-dark-200 font-medium">Pergunta de segurança</p>
              <p className="text-xs text-dark-500">Se você já tem uma cadastrada, pode deixar em branco. Isso é usado caso você esqueça a senha no futuro.</p>
            </div>
            <Input
              label="Pergunta (ex: nome do seu primeiro pet)"
              value={perguntaSeguranca}
              onChange={(e) => setPerguntaSeguranca(e.target.value)}
            />
            <Input
              label="Resposta"
              value={respostaSeguranca}
              onChange={(e) => setRespostaSeguranca(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" className="w-full mt-2" loading={trocarMut.isPending}>
            Salvar e continuar
          </Button>
        </form>
      </div>
    </div>
  )
}
