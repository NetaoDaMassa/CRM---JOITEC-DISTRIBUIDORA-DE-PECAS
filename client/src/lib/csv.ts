// Delimitador ";" (não ",") porque o Excel em PT-BR usa vírgula como
// separador decimal — um CSV com "," como delimitador de coluna quebra a
// leitura de qualquer valor numérico. BOM UTF-8 na frente garante que
// acentos abram certo no Excel do Windows, que não assume UTF-8 sem ele.
function escaparCsv(valor: unknown): string {
  const texto = valor === null || valor === undefined ? '' : String(valor)
  return /["\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function paraCsv<T extends Record<string, unknown>>(colunas: { chave: keyof T; rotulo: string }[], linhas: T[]): string {
  const cabecalho = colunas.map((c) => escaparCsv(c.rotulo)).join(';')
  const corpo = linhas.map((linha) => colunas.map((c) => escaparCsv(linha[c.chave])).join(';'))
  return [cabecalho, ...corpo].join('\r\n')
}

const BOM_UTF8 = '﻿'

export function baixarCsv(nomeArquivo: string, conteudo: string) {
  const blob = new Blob([BOM_UTF8 + conteudo], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  // Precisa estar no DOM pra o clique disparar o download de forma
  // confiável em todo navegador — em alguns (Safari, Chrome mais antigo) um
  // <a> solto (nunca anexado) simplesmente não navega no .click(). Revoga a
  // URL só depois, num próximo tick, senão corre risco de invalidar o blob
  // antes do navegador terminar de iniciar o download.
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
