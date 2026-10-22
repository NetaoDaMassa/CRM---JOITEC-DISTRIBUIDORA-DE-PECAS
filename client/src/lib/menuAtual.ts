import { useSyncExternalStore } from 'react'
import type { LucideIcon } from 'lucide-react'

// Os itens de menu que o usuário enxerga agora (a Sidebar publica aqui) —
// a busca rápida (Ctrl+K) usa a mesma lista, então só acha tela que a
// pessoa pode abrir.
export type ItemMenu = { to: string; label: string; icon: LucideIcon; external?: boolean; grupo?: string }

let itens: ItemMenu[] = []
const ouvintes = new Set<() => void>()

export function publicarMenu(novos: ItemMenu[]) {
  const chave = (l: ItemMenu[]) => l.map((i) => i.to).join('|')
  if (chave(novos) === chave(itens)) return
  itens = novos
  ouvintes.forEach((f) => f())
}

export function useMenuAtual(): ItemMenu[] {
  return useSyncExternalStore(
    (f) => {
      ouvintes.add(f)
      return () => ouvintes.delete(f)
    },
    () => itens
  )
}
