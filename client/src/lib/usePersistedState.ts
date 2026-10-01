import { useState } from 'react'

// Filtro de tela (vendedor, busca, etapa...) guardado como `useState` comum
// zera toda vez que a página desmonta — o que acontece sempre que o usuário
// entra na ficha de um lead e aperta "Voltar" (vai pra um path fixo, não
// `navigate(-1)`), te obrigando a filtrar tudo de novo. Troca o estado por
// isso aqui: mesma API do useState, mas lida de/grava em sessionStorage, que
// sobrevive ao desmonte/remonte do componente (só reseta fechando a aba).
// Pedido do João, 2026-10-01: "quando volta pro início tem que filtrar tudo
// de novo".
export function usePersistedState<T>(chave: string, valorInicial: T) {
  const [valor, setValorState] = useState<T>(() => {
    try {
      const salvo = sessionStorage.getItem(chave)
      return salvo !== null ? (JSON.parse(salvo) as T) : valorInicial
    } catch {
      return valorInicial
    }
  })

  function setValor(novo: T) {
    setValorState(novo)
    try {
      sessionStorage.setItem(chave, JSON.stringify(novo))
    } catch {
      // Aba anônima/sessionStorage bloqueado — segue só em memória, sem persistir.
    }
  }

  return [valor, setValor] as const
}
