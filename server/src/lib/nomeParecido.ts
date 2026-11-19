// Dois nomes de cliente são do MESMO cliente? (João, 2026-11-19: "clientes e
// pedidos trocados — SAP"). Usado pra não juntar cadastros diferentes que só
// têm o mesmo número de código antigo — o 622 da planilha da Odin Tubos
// (Planalto Compressores) não é o 622 do sistema antigo da Joitec (JR
// Manutenção, hoje C002798 no SAP).
//
// Regra: um nome contém o outro, ou os dois têm pelo menos uma palavra
// "de verdade" em comum (4+ letras, fora as genéricas de razão social e do
// ramo — "COMPRESSORES", "TUBOS", "COMERCIO"...). CNPJ/CPF no começo do nome
// do MEI ("54.424.045 ITALO FELIX") é ignorado.

const GENERICAS = new Set([
  'LTDA', 'EIRELI', 'EPP', 'MEI', 'CIA', 'COMERCIO', 'COMERCIAL', 'INDUSTRIA', 'INDUSTRIAL', 'INDUSTRIAS', 'SERVICOS', 'SERVICO',
  'COMPRESSORES', 'COMPRESSOR', 'TUBOS', 'CONEXOES', 'MANUTENCAO', 'MANUTENCOES', 'EQUIPAMENTOS', 'EQUIPAMENTO', 'MAQUINAS',
  'PECAS', 'DISTRIBUIDORA', 'DISTRIBUICAO', 'REPRESENTACOES', 'REPRESENTACAO', 'REPRES', 'ASSIST', 'TECNICA', 'TECNICO',
  'IMPORTACAO', 'EXPORTACAO', 'ENGENHARIA', 'METALURGICA', 'HIDRAULICA', 'HIDRAULICOS', 'PNEUMATICA', 'PNEUMATICOS',
  'AUTOMACAO', 'SOLUCOES', 'TRANSPORTES', 'TRANSPORTE', 'MATERIAIS', 'MATERIAL', 'CONSTRUCAO', 'CONSTRUCOES', 'ELETRICA',
  'ELETRICOS', 'BRASIL', 'GRUPO', 'EMPRESA', 'SOCIEDADE', 'FILHO', 'FILHOS', 'JUNIOR', 'NETO', 'SOBRINHO',
])

export function normalizarNome(t: string | null | undefined): string {
  return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
}

function palavras(t: string | null | undefined): string[] {
  return normalizarNome(t)
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length >= 4 && !/^\d+$/.test(p) && !GENERICAS.has(p))
}

export function nomeParecido(a: string | null | undefined, b: string | null | undefined): boolean {
  const ja = normalizarNome(a).replace(/[^A-Z]/g, '')
  const jb = normalizarNome(b).replace(/[^A-Z]/g, '')
  if (!ja || !jb) return true // sem nome pra comparar: não acusa
  if (ja.length >= 6 && jb.length >= 6 && (ja.includes(jb) || jb.includes(ja))) return true
  const pa = new Set(palavras(a))
  return palavras(b).some((p) => pa.has(p))
}
