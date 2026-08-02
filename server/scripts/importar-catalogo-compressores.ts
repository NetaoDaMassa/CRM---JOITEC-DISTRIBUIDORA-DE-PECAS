// Script avulso — importa o catálogo INTEIRO de
// produtos_odin_compressores_secadores.xlsx (~/Downloads, 3 abas:
// Compressores, Secadores de Ar, Outros Itens) pra empresa Odin
// Compressores. Só os `tipo: 'compressor'` alimentam o dropdown de "Modelo"
// ao cadastrar uma máquina vendida (client/src/pages/ClienteDetail.tsx) —
// secador/outro item não tem o ciclo de filtro de ar/óleo do compressor,
// então ficam só como catálogo de referência por enquanto.
import fs from 'fs'
import * as XLSX from 'xlsx'
import { eq, and } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { catalogoCompressores, empresas } from '../src/db/schema.js'

const CAMINHO_PLANILHA = '/Users/weslley/Downloads/produtos_odin_compressores_secadores.xlsx'

function numeroBr(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  if (typeof v === 'number') return v
  const n = Number(String(v).replace(',', '.'))
  return Number.isNaN(n) ? undefined : n
}

function texto(v: unknown): string | undefined {
  const s = String(v ?? '').trim()
  return s || undefined
}

async function salvar(empresaId: number, modelo: string, valores: Partial<typeof catalogoCompressores.$inferInsert>) {
  const existente = await db.query.catalogoCompressores.findFirst({
    where: and(eq(catalogoCompressores.empresaId, empresaId), eq(catalogoCompressores.modelo, modelo)),
  })
  if (existente) {
    await db.update(catalogoCompressores).set(valores).where(eq(catalogoCompressores.id, existente.id))
    return 'atualizado' as const
  }
  await db.insert(catalogoCompressores).values({ empresaId, modelo, ...valores })
  return 'criado' as const
}

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-compressores') })
  if (!empresa) throw new Error('Empresa "odin-compressores" não encontrada.')

  const wb = XLSX.read(fs.readFileSync(CAMINHO_PLANILHA))
  const contagem = { criados: 0, atualizados: 0 }

  // Compressores — os campos técnicos vão em colunas próprias.
  const compressores = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Compressores'], { defval: null, raw: true })
  for (const row of compressores) {
    const modelo = texto(row['Modelo'])
    if (!modelo) continue
    const resultado = await salvar(empresa.id, modelo, {
      tipo: 'compressor',
      linha: texto(row['Linha']),
      bar: numeroBr(row['Bar']),
      energiaKw: numeroBr(row['Energia (KW)']),
      motorHp: numeroBr(row['Motor (HP)']),
      pcm: numeroBr(row['PCM (pés³/min)']),
      nivelRuido: texto(row['Nível Ruído']),
      resfriamento: texto(row['Resfriamento']),
      eletricidade: texto(row['Eletricidade (V/Hz)']),
      pesoKg: numeroBr(row['Peso (Kg)']),
    })
    contagem[resultado === 'criado' ? 'criados' : 'atualizados']++
  }

  // Secadores de Ar — campos não cobertos pelas colunas de compressor
  // (vazão, voltagem, gás refrigerante, conexão, ponto de orvalho) viram um
  // resumo em `especificacoes`, mesmo padrão que a planilha já usa em
  // "Outros Itens".
  const secadores = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Secadores de Ar'], { defval: null, raw: true })
  for (const row of secadores) {
    const modelo = texto(row['Modelo'])
    if (!modelo) continue
    const partes = [
      row['Vazão (m³/min)'] != null ? `Vazão ${row['Vazão (m³/min)']} m³/min` : null,
      row['Voltagem'] != null ? `${row['Voltagem']}` : null,
      row['Gás Refrigerante'] != null ? `Gás ${row['Gás Refrigerante']}` : null,
      row['Conexão'] != null ? `Conexão ${row['Conexão']}` : null,
      row['Ponto de Orvalho'] != null ? `Ponto de orvalho ${row['Ponto de Orvalho']}` : null,
    ].filter(Boolean)
    const resultado = await salvar(empresa.id, modelo, {
      tipo: 'secador',
      categoria: 'Secador de Ar',
      bar: numeroBr(row['Bar']),
      pcm: numeroBr(row['PCM (pés³/min)']),
      pesoKg: numeroBr(row['Peso (Kg)']),
      especificacoes: partes.join(' | ') || undefined,
    })
    contagem[resultado === 'criado' ? 'criados' : 'atualizados']++
  }

  // Outros Itens — já vem como um blob de especificações na própria
  // planilha, só repassa direto.
  const outros = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Outros Itens (catálogo)'], { defval: null, raw: true })
  for (const row of outros) {
    const modelo = texto(row['Modelo'])
    if (!modelo) continue
    const resultado = await salvar(empresa.id, modelo, {
      tipo: 'outro',
      categoria: texto(row['Categoria']),
      especificacoes: texto(row['Especificações principais']),
    })
    contagem[resultado === 'criado' ? 'criados' : 'atualizados']++
  }

  console.log(`\n📊 Catálogo completo: ${contagem.criados} criado(s), ${contagem.atualizados} atualizado(s)`)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
