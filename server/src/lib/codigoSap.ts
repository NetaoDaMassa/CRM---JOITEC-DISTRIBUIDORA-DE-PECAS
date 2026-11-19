// REGRA ÚNICA de vínculo SAP → CRM (João, 2026-11-19: "o CRM tem os
// clientes, o SAP tem os clientes e eles estão vinculados pelo código — puxar
// pelo código e pela filial e já designar"). Pedido, cotação, nota, boleto e
// expedição do SAP só entram no cadastro que tem EXATAMENTE aquele código do
// SAP (C + números), na empresa que a filial decide. Nada de código antigo
// (o 622 da Joitec não é o 622 da planilha da Odin Tubos), nome parecido ou
// "sem zero na frente". Sem cadastro com o código: não chuta — vai pra
// "Clientes do SAP p/ cadastrar" (Cadastrar ou Ligar código).

export function codigoSap(c: string | null | undefined): string | null {
  const k = (c ?? '').trim().replace(/\.0+$/, '').toUpperCase()
  return /^C\d{4,}$/.test(k) ? k : null
}

// Códigos do SAP de um cadastro: o `codigo`; o `codigoAntigo` só se também
// for código do SAP (2 casos na Odin Tubos, cadastro que juntou dois códigos).
export function codigosSapDoCadastro(c: { codigo: string | null; codigoAntigo?: string | null }): string[] {
  return [...new Set([codigoSap(c.codigo), codigoSap(c.codigoAntigo)].filter((x): x is string => !!x))]
}
