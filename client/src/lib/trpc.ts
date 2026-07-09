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
          return token ? { Authorization: `Bearer ${token}` } : {}
        },
      }),
    ],
  })
}
