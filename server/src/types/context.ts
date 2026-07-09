export interface AuthUser {
  id: number
  username: string
  name: string
  role: 'admin' | 'vendor'
  companyId: number
  companyName: string
}

export interface Context {
  user: AuthUser | null
}
