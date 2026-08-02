import { createTRPCReact } from '@trpc/react-query'
import { httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@server/router/index'

export const trpc = createTRPCReact<AppRouter>()

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: '/trpc',
        headers() {
          const token = localStorage.getItem('odin_token')
          const empresaAtivaId = localStorage.getItem('empresa_ativa_id')
          return {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            // Só tem efeito no backend se o usuário logado for superAdmin —
            // ignorado silenciosamente pra todo mundo mais.
            ...(empresaAtivaId ? { 'x-empresa-id': empresaAtivaId } : {}),
          }
        },
      }),
    ],
  })
}
