import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const loginMut = trpc.auth.login.useMutation({
    onSuccess(data) {
      login(data.token, data.user)
      if (data.user.senhaTrocarNoLogin) {
        navigate('/trocar-senha')
      } else {
        navigate(data.user.role === 'admin' ? '/admin' : '/vendedor/fila-hoje')
      }
    },
    onError(err) {
      toast.error(err.message || 'Credenciais inválidas')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!username || !password) return toast.error('Preencha todos os campos')
    loginMut.mutate({ username, password })
  }

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(0,101,132,0.18) 0%, transparent 70%)',
        }}
      />

      <div className="relative w-full max-w-md">
        <div
          className="bg-dark-800 border border-dark-600 rounded-2xl p-8 shadow-2xl"
          style={{ boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(36,175,244,0.05)' }}
        >
          <div className="flex flex-col items-center gap-5 mb-8">
            <div className="text-center">
              <h1 className="font-heading text-lg text-gold-400 font-bold">Joitec CRM</h1>
              <p className="text-dark-400 text-sm">Entre com seu usuário e senha</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Usuário"
              placeholder="seu.usuario"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm text-dark-200 font-medium">Senha</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100 placeholder-dark-400 focus:outline-none focus:border-gold-600 focus:ring-1 focus:ring-gold-600/30 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-200"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <Button type="submit" size="lg" className="w-full mt-2" loading={loginMut.isPending}>
              Entrar
            </Button>
          </form>

          <p className="text-center text-dark-500 text-xs mt-6">Joitec CRM · v1.0</p>
        </div>
      </div>
    </div>
  )
}
