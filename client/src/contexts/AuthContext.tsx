import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { trpc } from '../lib/trpc'

interface AuthUser {
  id: number
  name: string
  username: string
  role: 'admin' | 'vendor'
  companyId: number
  companyName: string
}

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  login: (token: string, user: AuthUser) => void
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('odin_token'))
  const [isLoading, setIsLoading] = useState(true)
  const utils = trpc.useUtils()

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: !!token,
    retry: false,
  })

  useEffect(() => {
    if (meQuery.data) {
      setUser(meQuery.data as AuthUser)
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
    setToken(newToken)
    setUser(newUser)
    utils.auth.me.setData(undefined, newUser as any)
    utils.auth.me.invalidate()
  }

  function logout() {
    localStorage.removeItem('odin_token')
    setToken(null)
    setUser(null)
    utils.auth.me.setData(undefined, undefined)
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
