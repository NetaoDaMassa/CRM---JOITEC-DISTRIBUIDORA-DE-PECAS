// Importação ÚNICA — Banco de Clientes da Odin Tubos e Conexões (empresa_id
// 2), a partir de 5 relatórios em PDF ("Consulta de Clientes") extraídos e
// limpos em 2026-09-02 (ver data-banco-odintc-2026-09-02.json, ao lado).
//
// Cada cliente entra SEM vendedor (vendedorAtualId null) — fica na tela
// "Banco de Clientes" pro admin distribuir depois; nenhum funil_mensal é
// criado (resetMensal.ts só cria card pra quem tem vendedor). Rótulo
// `origemBanco` separa esse lote dos bancos que já existiam:
//   "Banco de Clientes <Região> - 02/09/2026"
//
// Região vem do estado (UF) de cada cliente; 8 registros sem estado no PDF
// tiveram a região inferida pelo DDD do telefone; 3 sem estado NEM telefone
// (empresas estrangeiras) caíram em "sudeste" por padrão e ficam marcados
// pra revisão manual (ver log no fim).
//
// Idempotente: código gravado como "TF-<código original>" — rodar de novo
// pula quem já foi importado (não duplica).
//
// Rodar:
//   Local:  npm run importar-banco-odintc -- --dry-run
//           npm run importar-banco-odintc
//   VPS:    docker compose exec backend node dist/scripts/importarBancoOdinTubosSetembro.js --dry-run
//           docker compose exec backend node dist/scripts/importarBancoOdinTubosSetembro.js

import { config } from 'dotenv'
config()

import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes } from '../db/schema.js'
import { normalizarBr } from '../lib/whatsapp/telefone.js'
import { REGISTROS_BANCO_ODINTC, type RegistroBancoOdintc } from './dataBancoOdintc20260902.js'

const EMPRESA_ID = 2 // Odin Tubos e Conexões
const DATA_IMPORTACAO = '02/09/2026'

const REGIAO_LABEL: Record<string, string> = {
  norte: 'Norte',
  nordeste: 'Nordeste',
  centro_oeste: 'Centro-Oeste',
  sudeste: 'Sudeste',
  sul: 'Sul',
}

const dryRun = process.argv.includes('--dry-run')

function montarObservacao(r: RegistroBancoOdintc): string | undefined {
  const partes: string[] = []
  if (r.cpfParcial) partes.push(`CPF (parcial, planilha origem): ${r.cpfParcial}`)
  if (r.representante) partes.push(`Representante (planilha origem): ${r.representante}`)
  partes.push(`Código original: ${r.codigo}`)
  if (r.regiaoDesconhecida) partes.push('⚠️ Região não veio na planilha (sem estado nem telefone) — REVISAR.')
  return partes.length ? partes.join(' · ') : undefined
}

async function run() {
  const registros = REGISTROS_BANCO_ODINTC

  console.log(`[importar-banco-odintc] ${dryRun ? 'DRY RUN — nada será gravado' : 'gravando'} | ${registros.length} registro(s) na origem\n`)

  let inseridos = 0
  let jaExistiam = 0
  let falhas = 0
  const porRegiao: Record<string, number> = {}
  const avisosRegiaoDesconhecida: string[] = []

  for (const r of registros) {
    const codigo = `TF-${r.codigo}`

    const existente = await db.query.clientes.findFirst({
      where: and(eq(clientes.empresaId, EMPRESA_ID), eq(clientes.codigo, codigo)),
      columns: { id: true },
    })
    if (existente) {
      jaExistiam++
      continue
    }

    if (r.regiaoDesconhecida) avisosRegiaoDesconhecida.push(`${r.codigo} — ${r.nome}`)

    const origemBanco = `Banco de Clientes ${REGIAO_LABEL[r.regiao]} - ${DATA_IMPORTACAO}`

    if (dryRun) {
      inseridos++
      porRegiao[r.regiao] = (porRegiao[r.regiao] ?? 0) + 1
      continue
    }

    try {
      await db.insert(clientes).values({
        empresaId: EMPRESA_ID,
        razaoSocial: r.nome,
        codigo,
        regiao: r.regiao,
        cidade: r.cidade ?? undefined,
        estado: r.uf ?? undefined,
        telefoneWhatsapp: r.telefone ? normalizarBr(r.telefone) : undefined,
        email: r.email ?? undefined,
        nomeContato: r.contato ?? undefined,
        origemBanco,
        observacoes: montarObservacao(r),
        vendedorAtualId: null,
      })
      inseridos++
      porRegiao[r.regiao] = (porRegiao[r.regiao] ?? 0) + 1
    } catch (err) {
      falhas++
      console.error(`[importar-banco-odintc] falha em "${r.nome}" (código ${r.codigo}):`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`\n[importar-banco-odintc] ${dryRun ? 'seriam inseridos' : 'inseridos'}: ${inseridos} | já existiam (pulados): ${jaExistiam} | falhas: ${falhas}`)
  console.log('  por região:', JSON.stringify(porRegiao))
  if (avisosRegiaoDesconhecida.length) {
    console.log(`\n⚠️  ${avisosRegiaoDesconhecida.length} cliente(s) sem região na planilha (foram pra Sudeste por padrão, revisar):`)
    for (const a of avisosRegiaoDesconhecida) console.log('   ', a)
  }
  process.exit(0)
}

run().catch((err) => {
  console.error('[importar-banco-odintc] erro fatal:', err)
  process.exit(1)
})
