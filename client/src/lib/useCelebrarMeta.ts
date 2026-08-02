import { useEffect, useRef, useState } from 'react'
import confetti from 'canvas-confetti'

interface VendedorMeta {
  id: number
  nome: string
  fotoUrl?: string | null
  bateuMetaDia: boolean
  bateuMetaFaturamento: boolean
  valorFechadoMes: number
  metaFaturamento: number | null
}

export interface Celebracao {
  nome: string
  fotoUrl?: string | null
  tipo: 'dia' | 'mes'
  valorFechadoMes: number
  metaFaturamento: number | null
}

const DURACAO_POPUP_MS = 8000

/**
 * Dispara confete + um pop-up grande quando algum vendedor passa de "não
 * bateu" pra "bateu a meta" (dia ou mês). Não dispara no primeiro
 * carregamento (não dá pra saber se quem já está com a meta batida acabou
 * de bater agora ou bateu antes), só em transições observadas depois disso.
 * Meta do mês é o marco maior — se os dois baterem juntos, o pop-up mostra
 * o do mês.
 */
export function useCelebrarMeta(vendedores: VendedorMeta[] | undefined) {
  const anteriorRef = useRef<Map<number, { dia: boolean; mes: boolean }> | null>(null)
  const [celebracao, setCelebracao] = useState<Celebracao | null>(null)

  useEffect(() => {
    if (!vendedores) return
    const anterior = anteriorRef.current

    if (anterior) {
      const bateuMes = vendedores.find((v) => v.bateuMetaFaturamento && anterior.get(v.id)?.mes === false)
      const bateuDia = vendedores.find((v) => v.bateuMetaDia && anterior.get(v.id)?.dia === false)
      const alvo = bateuMes ?? bateuDia
      if (alvo) {
        confetti({ particleCount: 160, spread: 100, origin: { y: 0.6 } })
        setCelebracao({
          nome: alvo.nome,
          fotoUrl: alvo.fotoUrl,
          tipo: bateuMes ? 'mes' : 'dia',
          valorFechadoMes: alvo.valorFechadoMes,
          metaFaturamento: alvo.metaFaturamento,
        })
      }
    }

    anteriorRef.current = new Map(vendedores.map((v) => [v.id, { dia: v.bateuMetaDia, mes: v.bateuMetaFaturamento }]))
  }, [vendedores])

  useEffect(() => {
    if (!celebracao) return
    const id = setTimeout(() => setCelebracao(null), DURACAO_POPUP_MS)
    return () => clearTimeout(id)
  }, [celebracao])

  return { celebracao, fecharCelebracao: () => setCelebracao(null) }
}
