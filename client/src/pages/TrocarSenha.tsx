import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export default function TrocarSenha() {
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
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
    trocarMut.mutate({ novaSenha })
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
          <Button type="submit" size="lg" className="w-full mt-2" loading={trocarMut.isPending}>
            Salvar e continuar
          </Button>
        </form>
      </div>
    </div>
  )
}
