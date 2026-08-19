export function limparCpf(cpf: string): string {
  return cpf.replace(/\D/g, '')
}

export function formatarCpf(cpf: string): string {
  const limpo = limparCpf(cpf)
  if (limpo.length !== 11) return cpf
  return limpo.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
}

function calcularDigitoVerificador(base: string, pesoInicial: number): number {
  const soma = base.split('').reduce((acc, digito, i) => acc + Number(digito) * (pesoInicial - i), 0)
  const resto = (soma * 10) % 11
  return resto === 10 ? 0 : resto
}

export function cpfValido(cpf: string): boolean {
  const limpo = limparCpf(cpf)
  if (limpo.length !== 11) return false
  if (/^(\d)\1{10}$/.test(limpo)) return false

  const dv1 = calcularDigitoVerificador(limpo.slice(0, 9), 10)
  if (dv1 !== Number(limpo[9])) return false

  const dv2 = calcularDigitoVerificador(limpo.slice(0, 10), 11)
  return dv2 === Number(limpo[10])
}
