// CNPJ ou CPF do cliente (Propostas da Odin aceitam os dois — tem cliente
// pessoa física). Guardado só com dígitos.
import { cnpjValido } from './cnpj.js'
import { cpfValido } from './cpf.js'

export const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export function documentoValido(doc: string): boolean {
  const d = soDigitos(doc)
  return (d.length === 14 && cnpjValido(d)) || (d.length === 11 && cpfValido(d))
}
