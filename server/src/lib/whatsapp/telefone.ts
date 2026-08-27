// Normalização de telefone BR pro envio via WhatsApp.
//
// Contexto: os números dos vendedores foram cadastrados na mão e vários
// vieram com 8 dígitos depois do DDD (padrão antigo, sem o "9" de celular).
// O WhatsApp pode ter a conta registrada COM ou SEM esse 9 — não dá pra saber
// de fora. Por isso não "consertamos" o número na marra: geramos as duas
// formas possíveis e deixamos o `onWhatsApp()` do Baileys dizer qual existe
// de verdade (ver session.ts → resolverJid).

export function soDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '')
}

// Só dígitos, com o código do Brasil (55) na frente. Não mexe no corpo do
// número (não adiciona nem tira o 9).
export function normalizarBr(valor: string | null | undefined): string {
  let d = soDigitos(valor)
  if (!d) return ''
  // Já tem 55 + DDD + (8 ou 9) → 12 ou 13 dígitos: mantém.
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d
  // DDD + (8 ou 9) → 10 ou 11 dígitos: falta só o 55.
  if (d.length === 10 || d.length === 11) return '55' + d
  // Qualquer outro tamanho: garante o 55 na frente e devolve como está,
  // pro onWhatsApp() tentar mesmo assim (e logar se não achar).
  return d.startsWith('55') ? d : '55' + d
}

// As formas plausíveis do mesmo número pra tentar no onWhatsApp():
// com o 9 e sem o 9 depois do DDD.
export function variantesBr(valor: string | null | undefined): string[] {
  const base = normalizarBr(valor)
  const formas = new Set<string>()
  if (!base) return []
  formas.add(base)

  if (base.startsWith('55') && base.length >= 12) {
    const ddd = base.slice(2, 4)
    const corpo = base.slice(4)
    if (corpo.length === 8) formas.add(`55${ddd}9${corpo}`)
    if (corpo.length === 9 && corpo.startsWith('9')) formas.add(`55${ddd}${corpo.slice(1)}`)
  }

  return [...formas]
}
