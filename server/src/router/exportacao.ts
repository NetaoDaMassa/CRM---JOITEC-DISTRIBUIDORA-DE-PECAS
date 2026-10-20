import { z } from 'zod'
import * as XLSX from 'xlsx'
import { router, protectedProcedure } from './_base.js'

// Excel da tela "Exportar relatórios" (pedido do João, 2026-10-20). Os
// números já vêm prontos do navegador — são exatamente as tabelas e os cards
// que a pessoa está vendo (mesmos componentes dos relatórios, já filtrados
// pelo que ela tem acesso). Aqui só monta a planilha: aba "Resumo" com os
// números grandes + uma aba por tabela, com número/moeda/%/data de verdade
// (dá pra somar e filtrar no Excel, não é texto).

const formato = z.enum(['texto', 'moeda', 'numero', 'pct', 'data'])

const entrada = z.object({
  titulo: z.string().max(200),
  // Linhas do cabeçalho: empresa, período, vendedor, região, gerado em...
  info: z.array(z.string().max(300)).max(20),
  resumo: z
    .array(z.object({ relatorio: z.string().max(100), metrica: z.string().max(200), valor: z.string().max(200), detalhe: z.string().max(300) }))
    .max(500),
  tabelas: z
    .array(
      z.object({
        relatorio: z.string().max(100),
        titulo: z.string().max(100),
        colunas: z.array(z.object({ rotulo: z.string().max(100), formato })).max(60),
        linhas: z.array(z.array(z.union([z.string().max(5000), z.number(), z.null()])).max(60)).max(60000),
      })
    )
    .max(60),
})

const FORMATO_EXCEL = {
  moeda: '"R$" #,##0.00',
  pct: '0.0%',
  data: 'dd/mm/yyyy',
} as const

// Data "YYYY-MM-DD..." → número de série do Excel (dia 1 = 01/01/1900), sem
// passar por Date local pra não escorregar um dia por causa de fuso.
function serialExcel(texto: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto)
  if (!m) return null
  return (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86400000
}

// Excel: até 31 caracteres, sem []:*?/\ e sem repetir.
function nomeAba(nome: string, usados: Set<string>) {
  const base = nome.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Tabela'
  let final = base
  for (let i = 2; usados.has(final.toLowerCase()); i++) final = `${base.slice(0, 31 - String(i).length - 1)} ${i}`
  usados.add(final.toLowerCase())
  return final
}

function larguras(linhas: (string | number | null)[][]) {
  const cols: number[] = []
  for (const l of linhas) l.forEach((v, i) => (cols[i] = Math.max(cols[i] ?? 8, Math.min(50, String(v ?? '').length + 2))))
  return cols.map((wch) => ({ wch }))
}

export const exportacaoRouter = router({
  excel: protectedProcedure.input(entrada).mutation(({ input }) => {
    const wb = XLSX.utils.book_new()
    const usados = new Set<string>()
    const cabecalho = [[input.titulo], ...input.info.map((i) => [i]), []]

    // Aba Resumo — os números grandes de cada relatório.
    const resumo: (string | number | null)[][] = [...cabecalho, ['Relatório', 'Métrica', 'Valor', 'Detalhe']]
    for (const r of input.resumo) resumo.push([r.relatorio, r.metrica, r.valor, r.detalhe])
    const wsResumo = XLSX.utils.aoa_to_sheet(resumo)
    wsResumo['!cols'] = larguras(resumo.slice(cabecalho.length))
    XLSX.utils.book_append_sheet(wb, wsResumo, nomeAba('Resumo', usados))

    for (const t of input.tabelas) {
      const topo = [[`${t.relatorio} — ${t.titulo}`], ...input.info.map((i) => [i]), []]
      const linhaCabecalho = topo.length
      const dados: (string | number | null)[][] = t.linhas.map((l) =>
        l.map((v, i) => {
          const f = t.colunas[i]?.formato
          if (v === null) return null
          if (f === 'data' && typeof v === 'string') return serialExcel(v) ?? v
          if (f === 'pct' && typeof v === 'number') return v / 100
          if ((f === 'moeda' || f === 'numero') && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
          return v
        })
      )
      const ws = XLSX.utils.aoa_to_sheet([...topo, t.colunas.map((c) => c.rotulo), ...dados])
      // Formato de número/moeda/%/data em cada célula da tabela.
      dados.forEach((l, li) =>
        l.forEach((v, ci) => {
          if (typeof v !== 'number') return
          const f = t.colunas[ci]?.formato
          const cel = ws[XLSX.utils.encode_cell({ r: linhaCabecalho + 1 + li, c: ci })]
          if (!cel) return
          if (f === 'moeda' || f === 'pct' || f === 'data') cel.z = FORMATO_EXCEL[f]
          else cel.z = Number.isInteger(v) ? '#,##0' : '#,##0.0#'
        })
      )
      if (t.colunas.length) {
        ws['!autofilter'] = {
          ref: XLSX.utils.encode_range({ s: { r: linhaCabecalho, c: 0 }, e: { r: linhaCabecalho + Math.max(dados.length, 1), c: t.colunas.length - 1 } }),
        }
      }
      ws['!cols'] = larguras([t.colunas.map((c) => c.rotulo), ...t.linhas])
      XLSX.utils.book_append_sheet(wb, ws, nomeAba(t.titulo, usados))
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    return { data: buffer.toString('base64') }
  }),
})
