export function limparCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '')
}

export function formatarCnpj(cnpj: string): string {
  const limpo = limparCnpj(cnpj)
  if (limpo.length !== 14) return cnpj
  return limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

function calcularDigitoVerificador(base: string, pesos: number[]): number {
  const soma = base.split('').reduce((acc, digito, i) => acc + Number(digito) * pesos[i], 0)
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

export function cnpjValido(cnpj: string): boolean {
  const limpo = limparCnpj(cnpj)
  if (limpo.length !== 14) return false
  if (/^(\d)\1{13}$/.test(limpo)) return false

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

  const dv1 = calcularDigitoVerificador(limpo.slice(0, 12), pesos1)
  if (dv1 !== Number(limpo[12])) return false

  const dv2 = calcularDigitoVerificador(limpo.slice(0, 13), pesos2)
  return dv2 === Number(limpo[13])
}
