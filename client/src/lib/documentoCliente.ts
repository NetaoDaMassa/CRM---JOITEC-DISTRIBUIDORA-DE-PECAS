// CNPJ/CPF do cliente nas Propostas (Odin) — mesma regra do servidor
// (server/src/lib/cnpj.ts + cpf.ts). 2026-11-17.
export const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

function dvCnpj(base: string, pesos: number[]) {
  const r = base.split('').reduce((a, d, i) => a + Number(d) * pesos[i], 0) % 11
  return r < 2 ? 0 : 11 - r
}
function cnpjValido(d: string) {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  return dvCnpj(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[12]) && dvCnpj(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13])
}
function dvCpf(base: string, peso: number) {
  const r = (base.split('').reduce((a, d, i) => a + Number(d) * (peso - i), 0) * 10) % 11
  return r === 10 ? 0 : r
}
function cpfValido(d: string) {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  return dvCpf(d.slice(0, 9), 10) === Number(d[9]) && dvCpf(d.slice(0, 10), 11) === Number(d[10])
}

export function documentoValido(doc: string) {
  const d = soDigitos(doc)
  return d.length === 14 ? cnpjValido(d) : d.length === 11 ? cpfValido(d) : false
}

export function formatarDocumento(doc: string | null | undefined) {
  const d = soDigitos(doc)
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return doc ?? ''
}
