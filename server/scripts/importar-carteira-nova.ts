// Script avulso — importa "CARTEIRA DE CLIENTES JOITEC.xlsx" (planilha nova,
// ~/Downloads) pra empresa Joitec (empresaId=1). Roda uma vez só:
//
// - Clientes com código que já existe no CRM: por padrão não mexe. Só
//   atualiza o vendedor responsável se a planilha mostrar outro E esse par
//   não estiver na lista de EXCECOES_IGNORAR (mudanças que a planilha tem
//   desatualizadas — ex: vendedor demitido).
// - Clientes novos (código não existe): cadastra. Se a planilha já traz um
//   vendedor real (nome bate com algum vendedor ativo da Joitec), cadastra
//   direto na carteira dele. Se vier com "Banco de Clientes X" ou "-Nenhum
//   vendedor / comprador-", cadastra SEM vendedor e grava esse rótulo em
//   `origemBanco`, pra aparecer na tela "Banco de Clientes" do admin.
// - Códigos duplicados dentro da própria planilha: só a primeira ocorrência
//   é considerada, as repetidas são puladas (logadas no resumo).
import fs from 'fs'
import * as XLSX from 'xlsx'
import { and, eq } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { clientes, carteiraHistorico, funilMensal, users, empresas } from '../src/db/schema.js'
import { cnpjValido, limparCnpj } from '../src/lib/cnpj.js'
import { regiaoPorUf } from '../src/lib/regiao.js'
import { mesReferenciaAtual } from '../src/lib/dataBr.js'

const CAMINHO_PLANILHA = '/Users/weslley/Downloads/CARTEIRA DE CLIENTES JOITEC.xlsx'

// vendedorAtualNoCRM -> vendedorNaPlanilha que deve ser IGNORADO (planilha
// desatualizada). Achado analisando a planilha: 231 clientes da Josemeri
// aparecem como "Jean Marcelo Genuino", mas o Jean foi demitido e a Josemeri
// assumiu a carteira dele — é a planilha que está desatualizada, não o CRM.
const EXCECOES_IGNORAR: [string, string][] = [['JOSEMERI', 'JEAN MARCELO GENUINO']]

function normalizarBanco(vendedorPlanilha: string): string {
  const v = vendedorPlanilha.trim().toUpperCase()
  if (v.includes('NENHUM')) return 'Sem vendedor definido'
  // "BANCO DE CLIENTES SUDESTE 2" -> "Banco de Clientes Sudeste 2"
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
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'joitec') })
  if (!empresa) throw new Error('Empresa Joitec não encontrada')

  const wb = XLSX.read(fs.readFileSync(CAMINHO_PLANILHA))
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })

  const vendedores = await db.query.users.findMany({ where: and(eq(users.role, 'vendor'), eq(users.empresaId, empresa.id)) })
  const vendedorPorNome = new Map(vendedores.map((v) => [v.name.trim().toUpperCase(), v]))

  const existentes = await db.query.clientes.findMany({
    where: eq(clientes.empresaId, empresa.id),
    columns: { id: true, codigo: true, vendedorAtualId: true },
    with: { vendedorAtual: { columns: { name: true } } },
  })
  const existentePorCodigo = new Map(existentes.map((c) => [c.codigo, c]))

  const codigosVistosNestaPlanilha = new Set<string>()
  const mesAtual = mesReferenciaAtual()

  let criados = 0
  let criadosComVendedor = 0
  let criadosNoBanco = 0
  let transferidos = 0
  let semMudanca = 0
  let ignoradosPorExcecao = 0
  let duplicadosNaPlanilha = 0
  let semRegiaoValida = 0
  let semCodigo = 0

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

    const vendedorPlanilhaRaw = String(row['Vendedor'] ?? '').trim()
    const vendedorPlanilha = vendedorPlanilhaRaw.toUpperCase()
    const ehBanco = vendedorPlanilha.startsWith('BANCO') || vendedorPlanilha.includes('NENHUM')
    const vendedorReal = !ehBanco ? vendedorPorNome.get(vendedorPlanilha) : undefined

    const existente = existentePorCodigo.get(codigo)

    if (existente) {
      if (ehBanco) continue // nenhum caso real hoje, mas não regride cliente já atribuído
      const vendedorAtualNome = (existente.vendedorAtual?.name ?? '').trim().toUpperCase()
      if (!vendedorReal || vendedorPlanilha === vendedorAtualNome) {
        semMudanca++
        continue
      }
      const naExcecao = EXCECOES_IGNORAR.some(([atual, novo]) => atual === vendedorAtualNome && novo === vendedorPlanilha)
      if (naExcecao) {
        ignoradosPorExcecao++
        continue
      }

      // Reatribuição real — mesma lógica de carteira.transferirCliente
      // (crédito de vendas passadas fica com quem já tinha, só muda o dono
      // atual da carteira daqui pra frente).
      await db.update(clientes).set({ vendedorAtualId: vendedorReal.id }).where(eq(clientes.id, existente.id))
      await db.insert(carteiraHistorico).values({ clienteId: existente.id, vendedorId: vendedorReal.id })
      const funilExistente = await db.query.funilMensal.findFirst({
        where: and(eq(funilMensal.clienteId, existente.id), eq(funilMensal.mesReferencia, mesAtual)),
      })
      if (!funilExistente) {
        await db.insert(funilMensal).values({ clienteId: existente.id, vendedorId: vendedorReal.id, mesReferencia: mesAtual })
      }
      transferidos++
      continue
    }

    // Cliente novo
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
    }
    criados++
  }

  console.log('\n📊 Resumo da importação:')
  console.log('  Clientes criados:', criados, `(${criadosComVendedor} com vendedor, ${criadosNoBanco} no banco)`)
  console.log('  Carteiras transferidas:', transferidos)
  console.log('  Sem mudança (já corretos):', semMudanca)
  console.log('  Ignorados por exceção (planilha desatualizada):', ignoradosPorExcecao)
  console.log('  Duplicados dentro da planilha (pulados):', duplicadosNaPlanilha)
  console.log('  Sem região válida (pulados):', semRegiaoValida)
  console.log('  Sem código (pulados):', semCodigo)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro na importação:', err)
  process.exit(1)
})
