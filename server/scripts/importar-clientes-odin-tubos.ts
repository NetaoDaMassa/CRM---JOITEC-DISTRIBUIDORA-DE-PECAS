// Script avulso — importa "CARTEIRAS DE CLIENTES - ODIN TC.xlsx" (aba
// "CLIENTES ODIN TC", ~/Downloads) pra empresa Odin Tubos e Conexões
// (empresaId=2). Primeira importação de clientes reais dessa empresa (banco
// zerado antes de rodar).
//
// Mesmo formato/mesma lógica geral do importar-carteira-nova.ts (Joitec):
// - Vendedor da planilha bate com vendedor real ativo (via ALIASES pros
//   nomes completos da planilha != nome curto no CRM) -> cadastra direto na
//   carteira dele.
// - "BANCO DE CLIENTES" ou vendedor sem correspondência (representantes
//   externos, Sergio/Daiani que não fazem parte do time Odin Tubos hoje,
//   Jaciel — que é admin, não vendedor, por decisão do João) -> cadastra
//   sem vendedor, com o rótulo original em origemBanco pra aparecer no
//   Banco de Clientes.
// - Códigos duplicados dentro da própria planilha: só a 1ª ocorrência conta.
import fs from 'fs'
import * as XLSX from 'xlsx'
import { and, eq } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { clientes, carteiraHistorico, funilMensal, users, empresas } from '../src/db/schema.js'
import { cnpjValido, limparCnpj } from '../src/lib/cnpj.js'
import { regiaoPorUf } from '../src/lib/regiao.js'
import { mesReferenciaAtual } from '../src/lib/dataBr.js'

const CAMINHO_PLANILHA = '/Users/weslley/Downloads/CARTEIRAS DE CLIENTES - ODIN TC.xlsx'
const NOME_ABA = 'CLIENTES ODIN TC'

// Nome completo (como vem na planilha, maiúsculo) -> nome curto salvo no CRM.
const ALIASES: Record<string, string> = {
  'YASMIM PADILHA SALLES': 'YASMIN SALLES',
  'LUANA APARECIDA DOS SANTOS SOUSA': 'LUANA APARECIDA',
  'KARINNA BEATRIZ LOPES': 'KARINNA',
  'YASMIM RIBEIRO DE RAMOS': 'YASMIN RAMOS',
}

function normalizarBanco(vendedorPlanilha: string): string {
  const v = vendedorPlanilha.trim().toUpperCase()
  if (!v || v.includes('NENHUM')) return 'Sem vendedor definido'
  return v
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())
}

function escolherRazaoSocial(nomeCliente: string, nome: string): string {
  const nc = nomeCliente.trim()
  if (nc && !/^\d+$/.test(nc)) return nc
  return nome.trim() || nc
}

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-tubos') })
  if (!empresa) throw new Error('Empresa Odin Tubos e Conexões não encontrada')

  const wb = XLSX.read(fs.readFileSync(CAMINHO_PLANILHA))
  const aba = wb.Sheets[NOME_ABA]
  if (!aba) throw new Error(`Aba "${NOME_ABA}" não encontrada na planilha`)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(aba, { defval: '', raw: false })

  const vendedores = await db.query.users.findMany({ where: and(eq(users.role, 'vendor'), eq(users.empresaId, empresa.id)) })
  const vendedorPorNome = new Map(vendedores.map((v) => [v.name.trim().toUpperCase(), v]))

  const existentes = await db.query.clientes.findMany({
    where: eq(clientes.empresaId, empresa.id),
    columns: { id: true, codigo: true },
  })
  const codigosExistentes = new Set(existentes.map((c) => c.codigo))

  const codigosVistosNestaPlanilha = new Set<string>()
  const mesAtual = mesReferenciaAtual()

  let criados = 0
  let criadosComVendedor = 0
  let criadosNoBanco = 0
  let jaExistiam = 0
  let duplicadosNaPlanilha = 0
  let semRegiaoValida = 0
  let semCodigo = 0

  const contagemBanco = new Map<string, number>()

  for (const row of rows) {
    const codigo = String(row['Código'] ?? '').trim()
    if (!codigo) {
      semCodigo++
      continue
    }
    if (codigosVistosNestaPlanilha.has(codigo)) {
      duplicadosNaPlanilha++
      continue
    }
    codigosVistosNestaPlanilha.add(codigo)

    if (codigosExistentes.has(codigo)) {
      jaExistiam++
      continue
    }

    const vendedorPlanilhaRaw = String(row['Vendedor'] ?? '').trim()
    const vendedorPlanilha = ALIASES[vendedorPlanilhaRaw.toUpperCase()] ?? vendedorPlanilhaRaw.toUpperCase()
    const vendedorReal = vendedorPorNome.get(vendedorPlanilha)

    const estado = String(row['Estado'] ?? '').trim().toUpperCase()
    const regiao = estado ? regiaoPorUf(estado) : null
    if (!regiao) {
      semRegiaoValida++
      continue
    }

    const razaoSocial = escolherRazaoSocial(String(row['Nome do Cliente'] ?? ''), String(row['Nome'] ?? ''))
    if (!razaoSocial) continue

    const cnpjLimpo = limparCnpj(String(row['CNPJ'] ?? ''))
    const cnpj = cnpjLimpo.length === 14 && cnpjValido(cnpjLimpo) ? cnpjLimpo : undefined

    const codigoAntigoRaw = String(row['Código Antigo'] ?? '').trim()
    const codigoAntigo = codigoAntigoRaw ? codigoAntigoRaw.replace(/\.0$/, '') : undefined

    const telefoneWhatsapp = String(row['Telefone'] ?? '').trim() || undefined
    const email = String(row['E-mail'] ?? '').trim() || undefined
    const cidade = String(row['Cidade'] ?? '').trim() || undefined

    const result = await db.insert(clientes).values({
      empresaId: empresa.id,
      razaoSocial,
      cnpj,
      codigo,
      codigoAntigo,
      regiao,
      estado,
      cidade,
      telefoneWhatsapp,
      email,
      vendedorAtualId: vendedorReal?.id,
      origemBanco: vendedorReal ? undefined : normalizarBanco(vendedorPlanilhaRaw),
    })
    const clienteId = Number(result.lastInsertRowid)

    if (vendedorReal) {
      await db.insert(carteiraHistorico).values({ clienteId, vendedorId: vendedorReal.id })
      await db.insert(funilMensal).values({ clienteId, vendedorId: vendedorReal.id, mesReferencia: mesAtual })
      criadosComVendedor++
    } else {
      criadosNoBanco++
      const rotulo = normalizarBanco(vendedorPlanilhaRaw)
      contagemBanco.set(rotulo, (contagemBanco.get(rotulo) ?? 0) + 1)
    }
    criados++
  }

  console.log('\n📊 Resumo da importação (Odin Tubos e Conexões):')
  console.log('  Clientes criados:', criados, `(${criadosComVendedor} com vendedor, ${criadosNoBanco} no banco)`)
  console.log('  Já existiam (código já cadastrado):', jaExistiam)
  console.log('  Duplicados dentro da planilha (pulados):', duplicadosNaPlanilha)
  console.log('  Sem região válida (pulados):', semRegiaoValida)
  console.log('  Sem código (pulados):', semCodigo)
  console.log('\n  Detalhe do Banco de Clientes:')
  for (const [rotulo, qtd] of [...contagemBanco.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${qtd} — ${rotulo}`)
  }
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro na importação:', err)
  process.exit(1)
})
