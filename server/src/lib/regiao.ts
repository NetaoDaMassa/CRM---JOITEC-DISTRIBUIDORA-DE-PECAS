export const REGIAO_VALUES = ['norte', 'nordeste', 'centro_oeste', 'sudeste', 'sul'] as const
export type Regiao = (typeof REGIAO_VALUES)[number]

export const REGIAO_LABELS: Record<Regiao, string> = {
  norte: 'Norte',
  nordeste: 'Nordeste',
  centro_oeste: 'Centro-Oeste',
  sudeste: 'Sudeste',
  sul: 'Sul',
}

const UF_PARA_REGIAO: Record<string, Regiao> = {
  AC: 'norte', AP: 'norte', AM: 'norte', PA: 'norte', RO: 'norte', RR: 'norte', TO: 'norte',
  AL: 'nordeste', BA: 'nordeste', CE: 'nordeste', MA: 'nordeste', PB: 'nordeste', PE: 'nordeste',
  PI: 'nordeste', RN: 'nordeste', SE: 'nordeste',
  DF: 'centro_oeste', GO: 'centro_oeste', MT: 'centro_oeste', MS: 'centro_oeste',
  ES: 'sudeste', MG: 'sudeste', RJ: 'sudeste', SP: 'sudeste',
  PR: 'sul', RS: 'sul', SC: 'sul',
}

export function regiaoPorUf(uf: string): Regiao | null {
  return UF_PARA_REGIAO[uf.toUpperCase()] ?? null
}
