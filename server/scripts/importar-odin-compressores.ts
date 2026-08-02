// Script avulso — importa a lista de prospects/revendas da Odin Compressores
// (colada manualmente pelo João no chat, salva em odin-compressores-clientes.txt)
// pra empresa "odin-compressores", tudo na carteira da Bruna (única
// vendedora, carteira fixa — confirmado pelo João: "todos as revendas sao da
// bruna", independente de quem aparece na última coluna da lista, que é só
// o responsável interno da Odin por aquele contato, não o vendedor no CRM).
//
// Formato de cada linha (colunas separadas por 2+ espaços, vindas de uma
// planilha colada como texto): Nome | Contato+Telefone | Cidade | Estado |
// Observação | Responsável interno. Nome e/ou Contato+Telefone podem faltar.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { eq, and } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { clientes, carteiraHistorico, funilMensal, users, empresas } from '../src/db/schema.js'
import { regiaoPorUf } from '../src/lib/regiao.js'
import { mesReferenciaAtual } from '../src/lib/dataBr.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CAMINHO_LISTA = path.join(__dirname, 'odin-compressores-clientes.txt')

const ESTADO_PARA_UF: Record<string, string> = {
  GOIAS: 'GO', BAHIA: 'BA', PARA: 'PA',
}

const REGEX_NOME_TELEFONE = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.]*?)\s*[-/]\s*(\d.*)$/

function normalizarEstado(bruto: string): string {
  const v = bruto.trim().toUpperCase()
  return ESTADO_PARA_UF[v] ?? v
}

interface LinhaParseada {
  razaoSocial: string
  contatoNome?: string
  telefone?: string
  cidade: string
  estado: string
  observacao: string
  responsavelInterno: string
}

function parseLinha(linhaBruta: string): LinhaParseada | null {
  const colunas = linhaBruta.split(/\s{2,}/).map((c) => c.trim()).filter((c) => c.length > 0)
  if (colunas.length < 5) return null

  const tokens = [...colunas]
  const responsavelInterno = tokens.pop()!
  const observacao = tokens.pop()!
  const estado = normalizarEstado(tokens.pop()!)
  const cidade = tokens.pop()!

  let nome = ''
  let contatoTel = ''
  if (tokens.length === 2) {
    ;[nome, contatoTel] = tokens
  } else if (tokens.length === 1) {
    if (/\d/.test(tokens[0])) contatoTel = tokens[0]
    else nome = tokens[0]
  }

  let contatoNome: string | undefined
  let telefone: string | undefined
  if (contatoTel) {
    const match = contatoTel.match(REGEX_NOME_TELEFONE)
    if (match) {
      contatoNome = match[1].trim()
      telefone = match[2].trim()
    } else if (/\d/.test(contatoTel)) {
      telefone = contatoTel.trim()
    } else {
      contatoNome = contatoTel.trim()
    }
  }

  const razaoSocial = nome || contatoNome || ''
  if (!razaoSocial) return null

  const partesObs: string[] = []
  if (nome && contatoNome) partesObs.push(`Contato: ${contatoNome}.`)
  partesObs.push(observacao.replace(/\s+/g, ' ').trim())
  partesObs.push(`Responsável interno (Odin): ${responsavelInterno}.`)

  return {
    razaoSocial: razaoSocial.replace(/\s+/g, ' ').trim(),
    contatoNome,
    telefone,
    cidade: cidade.replace(/\s+/g, ' ').trim(),
    estado,
    observacao: partesObs.join(' '),
    responsavelInterno,
  }
}

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-compressores') })
  if (!empresa) throw new Error('Empresa "odin-compressores" não encontrada.')
  const bruna = await db.query.users.findFirst({ where: and(eq(users.username, 'bruna'), eq(users.empresaId, empresa.id)) })
  if (!bruna) throw new Error('Vendedora "bruna" não encontrada na Odin Compressores.')

  const linhas = fs.readFileSync(CAMINHO_LISTA, 'utf-8').split('\n').filter((l) => l.trim().length > 0)

  const codigoExistenteMax = await db.query.clientes.findFirst({
    where: eq(clientes.empresaId, empresa.id),
    orderBy: (c, { desc }) => [desc(c.id)],
  })
  let proximoCodigo = 1 // empresa nova, sem clientes ainda — códigos sequenciais simples
  void codigoExistenteMax

  const mesAtual = mesReferenciaAtual()
  let criados = 0
  let semRegiaoValida = 0
  let ignoradas = 0

  for (const linhaBruta of linhas) {
    const parsed = parseLinha(linhaBruta)
    if (!parsed) {
      ignoradas++
      console.log(`⚠️  Linha não reconhecida, pulada: "${linhaBruta}"`)
      continue
    }

    const regiao = regiaoPorUf(parsed.estado)
    if (!regiao) {
      semRegiaoValida++
      console.log(`⚠️  Região não encontrada pra UF "${parsed.estado}" — cliente "${parsed.razaoSocial}" pulado`)
      continue
    }

    const codigo = String(proximoCodigo++)
    const result = await db.insert(clientes).values({
      empresaId: empresa.id,
      razaoSocial: parsed.razaoSocial,
      codigo,
      regiao,
      estado: parsed.estado,
      cidade: parsed.cidade,
      telefoneWhatsapp: parsed.telefone,
      observacoes: parsed.observacao,
      vendedorAtualId: bruna.id,
    })
    const clienteId = Number(result.lastInsertRowid)
    await db.insert(carteiraHistorico).values({ clienteId, vendedorId: bruna.id })
    await db.insert(funilMensal).values({ clienteId, vendedorId: bruna.id, mesReferencia: mesAtual })
    criados++
  }

  console.log('\n📊 Resumo da importação (Odin Compressores / Bruna):')
  console.log('  Clientes criados:', criados)
  console.log('  Sem região válida (pulados):', semRegiaoValida)
  console.log('  Linhas não reconhecidas (puladas):', ignoradas)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro na importação:', err)
  process.exit(1)
})
