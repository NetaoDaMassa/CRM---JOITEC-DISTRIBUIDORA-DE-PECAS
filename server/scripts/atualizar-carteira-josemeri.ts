// Script avulso — substitui a carteira da Josemeri (vendedora Joitec) pela
// lista nova enviada pelo João. A carteira ANTIGA (o que ela tem hoje e não
// está na lista nova) vai pro Banco de Clientes com origemBanco = "Jean"
// (nome antigo dela no CRM, antes da troca de nome Jean -> Josemeri). O que
// já está na lista nova mas não existe ainda no CRM é cadastrado do zero.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { clientes, carteiraHistorico, funilMensal, users } from '../src/db/schema.js'
import { cnpjValido, limparCnpj } from '../src/lib/cnpj.js'
import { regiaoPorUf } from '../src/lib/regiao.js'
import { mesReferenciaAtual } from '../src/lib/dataBr.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TSV_PATH = path.join(__dirname, 'carteira-josemeri-nova.tsv')
const EMPRESA_ID = 1 // Joitec Distribuidora
const VENDEDOR_NOME = 'Josemeri'
const ROTULO_BANCO_ANTIGO = 'Jean'

async function run() {
  const vendedor = await db.query.users.findFirst({ where: and(eq(users.name, VENDEDOR_NOME), eq(users.empresaId, EMPRESA_ID)) })
  if (!vendedor) throw new Error(`Vendedor "${VENDEDOR_NOME}" não encontrado`)

  const linhas = fs.readFileSync(TSV_PATH, 'utf-8').split('\n').filter((l) => l.trim())
  const linhasPorCodigo = new Map<string, string[]>()
  for (const linha of linhas) {
    const cols = linha.split('\t')
    const codigo = cols[0].trim()
    if (codigo && !linhasPorCodigo.has(codigo)) linhasPorCodigo.set(codigo, cols)
  }

  const existentes = await db.query.clientes.findMany({
    where: and(eq(clientes.empresaId, EMPRESA_ID), isNull(clientes.deletedAt)),
    columns: { id: true, codigo: true, vendedorAtualId: true },
  })
  const existentePorCodigo = new Map(existentes.map((c) => [c.codigo, c]))
  const mesAtual = mesReferenciaAtual()

  let transferidosParaEla = 0
  let criadosParaEla = 0
  let semRegiaoValida = 0

  for (const [codigo, cols] of linhasPorCodigo) {
    const existente = existentePorCodigo.get(codigo)

    if (existente) {
      if (existente.vendedorAtualId === vendedor.id) continue // já é dela

      await db.update(clientes).set({ vendedorAtualId: vendedor.id, origemBanco: null }).where(eq(clientes.id, existente.id))
      await db.insert(carteiraHistorico).values({ clienteId: existente.id, vendedorId: vendedor.id })
      const funilExistente = await db.query.funilMensal.findFirst({
        where: and(eq(funilMensal.clienteId, existente.id), eq(funilMensal.mesReferencia, mesAtual), isNull(funilMensal.deletedAt)),
      })
      if (!funilExistente) {
        await db.insert(funilMensal).values({ clienteId: existente.id, vendedorId: vendedor.id, mesReferencia: mesAtual })
      } else if (funilExistente.vendedorId !== vendedor.id) {
        await db.update(funilMensal).set({ vendedorId: vendedor.id }).where(eq(funilMensal.id, funilExistente.id))
      }
      transferidosParaEla++
      continue
    }

    // Cliente novo — não existe ainda no CRM
    const [, codigoAntigoRaw, nomeCliente, nomeFantasia, cnpjRaw, telefone, email, estado, cidade] = cols
    const estadoUf = (estado ?? '').trim().toUpperCase()
    const regiao = estadoUf ? regiaoPorUf(estadoUf) : null
    if (!regiao) {
      semRegiaoValida++
      console.warn(`  Sem região válida, pulado: ${codigo} (estado="${estadoUf}")`)
      continue
    }

    const razaoSocial = (nomeCliente ?? '').trim() || (nomeFantasia ?? '').trim() || codigo
    const cnpjLimpo = limparCnpj(cnpjRaw ?? '')
    const cnpj = cnpjLimpo.length === 14 && cnpjValido(cnpjLimpo) ? cnpjLimpo : undefined
    const codigoAntigo = (codigoAntigoRaw ?? '').trim() || undefined

    const result = await db.insert(clientes).values({
      empresaId: EMPRESA_ID,
      razaoSocial,
      cnpj,
      codigo,
      codigoAntigo,
      regiao,
      estado: estadoUf || undefined,
      cidade: (cidade ?? '').trim() || undefined,
      telefoneWhatsapp: (telefone ?? '').trim() || undefined,
      email: (email ?? '').trim() || undefined,
      vendedorAtualId: vendedor.id,
    })
    const clienteId = Number(result.lastInsertRowid)
    await db.insert(carteiraHistorico).values({ clienteId, vendedorId: vendedor.id })
    await db.insert(funilMensal).values({ clienteId, vendedorId: vendedor.id, mesReferencia: mesAtual })
    criadosParaEla++
  }

  // Carteira antiga: quem está com ela hoje mas não está na lista nova vai pro Banco
  const carteiraAtual = await db.query.clientes.findMany({
    where: and(eq(clientes.vendedorAtualId, vendedor.id), isNull(clientes.deletedAt), eq(clientes.empresaId, EMPRESA_ID)),
    columns: { id: true, codigo: true },
  })
  let movidosParaBanco = 0
  for (const cliente of carteiraAtual) {
    if (linhasPorCodigo.has(cliente.codigo)) continue // ficou com ela, já tratado acima

    await db.update(clientes).set({ vendedorAtualId: null, origemBanco: ROTULO_BANCO_ANTIGO }).where(eq(clientes.id, cliente.id))

    const funilExistente = await db.query.funilMensal.findFirst({
      where: and(eq(funilMensal.clienteId, cliente.id), eq(funilMensal.mesReferencia, mesAtual), isNull(funilMensal.deletedAt)),
    })
    if (funilExistente) {
      await db.update(funilMensal).set({ deletedAt: new Date().toISOString() }).where(eq(funilMensal.id, funilExistente.id))
    }
    movidosParaBanco++
  }

  console.log('\n📊 Resumo:')
  console.log('  Transferidos para ela (já existiam no CRM):', transferidosParaEla)
  console.log('  Cadastrados do zero e atribuídos a ela:', criadosParaEla)
  console.log('  Sem região válida (pulados):', semRegiaoValida)
  console.log('  Movidos da carteira dela para o Banco (rótulo "Jean"):', movidosParaBanco)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
