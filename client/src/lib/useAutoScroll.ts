import { useEffect } from 'react'

// TVs de painel ficam sem mouse/controle — se o conteúdo do slide passa da
// altura da tela, tudo que fica abaixo da dobra nunca é visto por ninguém.
// Rola a página inteira até o fim (com uma pausa lendo o topo e outra lendo
// o final) e volta ao topo quando o slide troca. `duracaoMs` é o tempo que
// o slide fica na tela — a rolagem sempre termina antes da troca, com folga.
export function useAutoScroll(chave: unknown, duracaoMs: number) {
  useEffect(() => {
    window.scrollTo(0, 0)

    const pausaMs = Math.min(3000, duracaoMs * 0.15)
    let frameId: number | null = null

    const idInicio = setTimeout(() => {
      // Medido só agora (depois da pausa), pra dar tempo dos gráficos
      // (ResponsiveContainer etc.) terminarem de montar e o scrollHeight
      // já refletir a altura final do slide.
      const alvo = document.documentElement.scrollHeight - window.innerHeight
      if (alvo <= 0) return

      const duracaoRolagem = Math.max(1000, duracaoMs - pausaMs * 2)
      let inicio: number | null = null

      function animar(timestamp: number) {
        if (inicio === null) inicio = timestamp
        const progresso = Math.min(1, (timestamp - inicio) / duracaoRolagem)
        const suavizado = progresso < 0.5 ? 2 * progresso * progresso : 1 - (-2 * progresso + 2) ** 2 / 2
        window.scrollTo(0, alvo * suavizado)
        if (progresso < 1) frameId = requestAnimationFrame(animar)
      }

      frameId = requestAnimationFrame(animar)
    }, pausaMs)

    return () => {
      clearTimeout(idInicio)
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [chave, duracaoMs])
}
