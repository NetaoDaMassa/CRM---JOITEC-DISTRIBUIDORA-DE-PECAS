import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { trpc } from '../lib/trpc'

interface AuthUser {
  id: number
  name: string
  username: string
  role: 'admin' | 'vendor'
  empresaId: number
  superAdmin: boolean
  senhaTrocarNoLogin?: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  login: (token: string, user: AuthUser) => void
  logout: () => void
  isLoading: boolean
  // Empresa que o superAdmin está "vendo" agora — pra todo mundo que não é
  // superAdmin, é sempre igual a user.empresaId (o header é ignorado no
  // backend nesse caso, mas mantemos consistente aqui também).
  empresaAtivaId: number | null
  trocarEmpresa: (empresaId: number) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('odin_token'))
  const [empresaAtivaId, setEmpresaAtivaId] = useState<number | null>(() => {
    const salvo = localStorage.getItem('empresa_ativa_id')
    return salvo ? Number(salvo) : null
  })
  const [isLoading, setIsLoading] = useState(true)
  const utils = trpc.useUtils()

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: !!token,
    retry: false,
  })

  useEffect(() => {
    if (meQuery.data) {
      const dados = meQuery.data as AuthUser
      setUser(dados)
      // Sem empresa ativa salva ainda (primeiro carregamento) — usa a
      // empresa "casa" do usuário.
      setEmpresaAtivaId((atual) => atual ?? dados.empresaId)
      setIsLoading(false)
    } else if (meQuery.isError) {
      logout()
      setIsLoading(false)
    } else if (!token) {
      setIsLoading(false)
    }
  }, [meQuery.data, meQuery.isError, token])

  function login(newToken: string, newUser: AuthUser) {
    localStorage.setItem('odin_token', newToken)
    localStorage.setItem('empresa_ativa_id', String(newUser.empresaId))
    setToken(newToken)
    setUser(newUser)
    setEmpresaAtivaId(newUser.empresaId)
    utils.auth.me.setData(undefined, newUser as any)
    utils.auth.me.invalidate()
  }

  function logout() {
    localStorage.removeItem('odin_token')
    localStorage.removeItem('empresa_ativa_id')
    setToken(null)
    setUser(null)
    setEmpresaAtivaId(null)
    utils.auth.me.setData(undefined, undefined)
  }

  // Troca de empresa exige recarregar a página inteira de propósito — evita
  // qualquer resquício de dado de uma empresa ficar em cache do TanStack
  // Query enquanto o usuário já está "vendo" a outra.
  function trocarEmpresa(novoEmpresaId: number) {
    localStorage.setItem('empresa_ativa_id', String(novoEmpresaId))
    window.location.reload()
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading, empresaAtivaId, trocarEmpresa }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
