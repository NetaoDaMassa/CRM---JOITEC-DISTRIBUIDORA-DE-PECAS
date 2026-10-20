// DDD → estado (UF) → região do Brasil. Usado pelo relatório de Leads pra
// agrupar por estado/região mesmo quando a cidade não foi preenchida (o DDD
// sai sempre do telefone).

const UF_POR_DDD: Record<number, string> = {}
const FAIXAS: [string, number[]][] = [
  ['SP', [11, 12, 13, 14, 15, 16, 17, 18, 19]],
  ['RJ', [21, 22, 24]],
  ['ES', [27, 28]],
  ['MG', [31, 32, 33, 34, 35, 37, 38]],
  ['PR', [41, 42, 43, 44, 45, 46]],
  ['SC', [47, 48, 49]],
  ['RS', [51, 53, 54, 55]],
  ['DF', [61]],
  ['GO', [62, 64]],
  ['TO', [63]],
  ['MT', [65, 66]],
  ['MS', [67]],
  ['AC', [68]],
  ['RO', [69]],
  ['BA', [71, 73, 74, 75, 77]],
  ['SE', [79]],
  ['PE', [81, 87]],
  ['AL', [82]],
  ['PB', [83]],
  ['RN', [84]],
  ['CE', [85, 88]],
  ['PI', [86, 89]],
  ['PA', [91, 93, 94]],
  ['AM', [92, 97]],
  ['RR', [95]],
  ['AP', [96]],
  ['MA', [98, 99]],
]
for (const [uf, ddds] of FAIXAS) for (const d of ddds) UF_POR_DDD[d] = uf

export type RegiaoBr = 'norte' | 'nordeste' | 'centro_oeste' | 'sudeste' | 'sul'

const REGIAO_POR_UF: Record<string, RegiaoBr> = {
  AC: 'norte', AP: 'norte', AM: 'norte', PA: 'norte', RO: 'norte', RR: 'norte', TO: 'norte',
  AL: 'nordeste', BA: 'nordeste', CE: 'nordeste', MA: 'nordeste', PB: 'nordeste', PE: 'nordeste', PI: 'nordeste', RN: 'nordeste', SE: 'nordeste',
  DF: 'centro_oeste', GO: 'centro_oeste', MT: 'centro_oeste', MS: 'centro_oeste',
  ES: 'sudeste', MG: 'sudeste', RJ: 'sudeste', SP: 'sudeste',
  PR: 'sul', RS: 'sul', SC: 'sul',
}

export function ufDoDdd(ddd: number | null | undefined): string | null {
  return ddd ? UF_POR_DDD[ddd] ?? null : null
}

export function regiaoDaUf(uf: string | null | undefined): RegiaoBr | null {
  return uf ? REGIAO_POR_UF[uf] ?? null : null
}
