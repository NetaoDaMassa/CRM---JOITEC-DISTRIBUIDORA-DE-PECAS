export interface AuthUser {
  id: number
  username: string
  name: string
  role: 'admin' | 'vendor'
  empresaId: number
  superAdmin: boolean
}

export interface Context {
  user: AuthUser | null
  // Empresa efetivamente ativa nesta requisição — igual a `user.empresaId`
  // pra todo mundo, exceto um `superAdmin` que mandou o header
  // `x-empresa-id` pra "entrar" em outra empresa sem logar de novo (ver
  // `createContext` em index.ts). Todo router que lista/filtra
  // clientes/vendedores deve usar ESTE campo, nunca `user.empresaId` direto.
  empresaId: number | null
}
