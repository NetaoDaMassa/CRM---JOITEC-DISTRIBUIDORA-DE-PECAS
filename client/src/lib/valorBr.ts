// Campos de valor em dinheiro usam `type="text"` (não "number") porque o
// input nativo number só aceita ponto decimal e barra a vírgula — no formato
// brasileiro ("1.250,50", ponto de milhar + vírgula decimal) isso travava o
// vendedor no meio da digitação. Aqui aceita os dois formatos: tira ponto de
// milhar e troca vírgula por ponto antes de converter pra número.
//
// O campo aceita texto livre, então também chega "R$ 1.094,90" (o vendedor
// copiou de algum lugar que já mostra formatado, ex: "Orçado: R$ 1.094,90"
// no próprio card) — sem tirar o "R$"/espaços antes, Number() vira NaN, que
// no JSON some e vira `null`, travando na validação do backend
// ("Expected number, received null"). Por isso tira tudo que não é
// dígito/vírgula/ponto/sinal antes de converter.
//
// Extraído do FunilBoard (onde nasceu) pra ser reaproveitado em qualquer
// tela com campo de valor em texto livre (Boletos, Caixa, Cobrança,
// Negociações, Cliente) — antes cada uma reinventava um
// `Number(valor.replace(',', '.'))` própria, que quebra tanto pra valor com
// separador de milhar (ex: "4.987,21" virava "4.987.21" → NaN → erro
// "Expected number, received null" no pedido de alteração de boleto) quanto,
// pior, pra valor só com ponto sem vírgula (ex: "1.500" virava 1.5 —
// silencioso, sem erro nenhum). Achado do João, 2026-09-11.
export function parseValorBr(v: string): number {
  let limpo = v.replace(/[^\d,.-]/g, '')
  const temVirgula = limpo.includes(',')
  const temPonto = limpo.includes('.')

  if (temVirgula && temPonto) {
    // Os dois aparecem — o que vier por último é o separador decimal de
    // verdade, o resto é separador de milhar. Cobre tanto "1.234.567,89"
    // (BR) quanto alguém colando de uma fonte em inglês ("1,234,567.89").
    if (limpo.lastIndexOf(',') > limpo.lastIndexOf('.')) {
      limpo = limpo.replace(/\./g, '').replace(',', '.')
    } else {
      limpo = limpo.replace(/,/g, '')
    }
  } else if (temVirgula) {
    limpo = limpo.replace(',', '.')
  } else if (temPonto) {
    // Só ponto, sem vírgula, é ambíguo — no formato BR é separador de
    // milhar ("1.500" = R$1.500,00), mas é fácil digitar "." querendo dizer
    // vírgula decimal (teclado numérico, hábito de outro sistema). Ninguém
    // tem 3 casas decimais em dinheiro, então: 3 dígitos depois do ÚLTIMO
    // ponto = separador de milhar (remove todos); 1 ou 2 dígitos = decimal
    // de verdade, mantém como está. Sem essa distinção, "49549.72" (queria
    // dizer R$49.549,72) virava R$4.954.972,00 — 100x maior, foi exatamente
    // o que inflou um orçamento aberto na Odin Tubos (2026-08-20).
    const partes = limpo.split('.')
    if (partes.length > 1 && partes[partes.length - 1].length === 3) {
      limpo = limpo.replace(/\./g, '')
    }
  }

  const numero = Number(limpo)
  // Nunca deixa passar NaN pra quem chama por engano — cai pro comportamento
  // antigo (mais permissivo) só como último recurso num formato estranho.
  return Number.isNaN(numero) ? Number(v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) : numero
}

// Inverso do parseValorBr — usado só pra pré-preencher um campo (ex: valor
// já salvo) com o mesmo formato que o input agora espera de volta.
export function formatarValorInput(v: number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
