// Script avulso — importa "pamela clientes EXCEL.xlsx" (~/Downloads) pra
// empresa Joitec Automação (slug 'joitec-automacao'), todos os clientes pra
// carteira da Fernanda (única vendedora de lá hoje). Roda uma vez só.
//
// A planilha é um relatório bruto de ERP ("Compram a 90 dias") exportado em
// 14 abas ("Table 1".."Table 14"), cada uma virando uma página impressa —
// por isso os cabeçalhos de filtro quebram as colunas de forma diferente em
// cada aba (às vezes o nome do cliente vem com um número de documento colado
// na frente, ex: "64.033.559 EURICO NOGUEIRA FONTES NETO"). Em vez de confiar
// no cabeçalho de cada aba, cada linha é parseada de forma posicional pelos
// valores não-nulos: 1º = código, último numérico = data da última compra,
// depois procura "CIDADE - UF" por regex, e o que sobrar antes dela vira
// nome (+ prefixo de documento se não tiver letra) e depois dela vira
// telefone (se não tiver letra).
import fs from 'fs'
import * as XLSX from 'xlsx'
import { eq, and } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { clientes, carteiraHistorico, funilMensal, users, empresas } from '../src/db/schema.js'
import { regiaoPorUf } from '../src/lib/regiao.js'
import { mesReferenciaAtual } from '../src/lib/dataBr.js'

const CAMINHO_PLANILHA = '/Users/weslley/Downloads/pamela clientes EXCEL (1).xlsx'
const REGEX_CIDADE_UF = /^(.+?)\s-\s([A-Z]{2})$/
const TEM_LETRA = /[A-Za-zÀ-ÿ]/

function excelDataParaSqlite(serial: number): string | undefined {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 60000) return undefined
  const ms = Date.UTC(1899, 11, 30) + serial * 86400000
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

interface LinhaParseada {
  codigo: string
  razaoSocial: string
  cidade: string
  estado: string
  telefone?: string
  dataUltimaCompra?: string
}

function parseLinha(valoresNaoNulos: unknown[]): LinhaParseada | null {
  if (valoresNaoNulos.length < 3) return null
  const primeiro = valoresNaoNulos[0]
  if (typeof primeiro !== 'number') return null
  const codigo = String(primeiro)

  const resto = [...valoresNaoNulos.slice(1)]

  // Data última compra: último valor numérico da linha, dentro da faixa de
  // serial plausível.
  let dataUltimaCompra: string | undefined
  for (let i = resto.length - 1; i >= 0; i--) {
    if (typeof resto[i] === 'number') {
      dataUltimaCompra = excelDataParaSqlite(resto[i] as number)
      resto.splice(i, 1)
      break
    }
  }

  // Cidade - UF: valor (string) que bate no padrão "... - UF" E cuja UF é de
  // fato válida — muitos nomes de empresa terminam em "- ME" (Microempresa),
  // que bateria no regex mas "ME" não é UF nenhuma; pega o último candidato
  // válido (o campo real fica mais à direita, perto do telefone/data).
  const candidatos = resto
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => typeof v === 'string' && REGEX_CIDADE_UF.test(v) && regiaoPorUf((v as string).match(REGEX_CIDADE_UF)![2]) !== null)
  if (candidatos.length === 0) return null
  const { v: cidadeUfStr, i: idxCidade } = candidatos[candidatos.length - 1]
  const match = (cidadeUfStr as string).match(REGEX_CIDADE_UF)!
  const cidade = match[1].trim()
  const estado = match[2].trim().toUpperCase()
  resto.splice(idxCidade, 1)

  // O que sobrou: [ (docNum?), nome, (telefone?) ] nessa ordem posicional.
  const sobra = resto.map((v) => (typeof v === 'number' ? String(v) : String(v ?? '').trim())).filter((v) => v.length > 0)

  let docNum: string | undefined
  if (sobra.length > 0 && !TEM_LETRA.test(sobra[0])) {
    docNum = sobra.shift()
  }
  let telefone: string | undefined
  if (sobra.length > 0 && !TEM_LETRA.test(sobra[sobra.length - 1])) {
    telefone = sobra.pop()
  }
  const nome = sobra.join(' ').trim()
  if (!nome) return null

  return {
    codigo,
    razaoSocial: docNum ? `${docNum} ${nome}` : nome,
    cidade,
    estado,
    telefone,
    dataUltimaCompra,
  }
}

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'joitec-automacao') })
  if (!empresa) throw new Error('Empresa "joitec-automacao" não encontrada.')
  const fernanda = await db.query.users.findFirst({ where: and(eq(users.username, 'fernanda'), eq(users.empresaId, empresa.id)) })
  if (!fernanda) throw new Error('Vendedora "fernanda" não encontrada na Joitec Automação.')

  const wb = XLSX.read(fs.readFileSync(CAMINHO_PLANILHA))
  const mesAtual = mesReferenciaAtual()

  const codigosVistos = new Set<string>()
  let criados = 0
  let duplicados = 0
  let semRegiaoValida = 0
  let linhasIgnoradas = 0

  for (const nomeAba of wb.SheetNames) {
    const linhasBrutas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nomeAba], { header: 1, defval: null, raw: true })
    for (const linha of linhasBrutas) {
      const naoNulos = linha.filter((v) => v !== null && v !== '')
      if (naoNulos.length === 0) continue
      if (typeof naoNulos[0] === 'string') continue // linha de título/cabeçalho de filtro
      if (naoNulos[0] === 'CÓDIGO') continue

      const parsed = parseLinha(naoNulos)
      if (!parsed) {
        linhasIgnoradas++
        continue
      }
      if (codigosVistos.has(parsed.codigo)) {
        duplicados++
        continue
      }
      codigosVistos.add(parsed.codigo)

      const regiao = regiaoPorUf(parsed.estado)
      if (!regiao) {
        semRegiaoValida++
        console.log(`⚠️  Região não encontrada pra UF "${parsed.estado}" — cliente ${parsed.codigo} (${parsed.razaoSocial}) pulado`)
        continue
      }

      const result = await db.insert(clientes).values({
        empresaId: empresa.id,
        razaoSocial: parsed.razaoSocial,
        codigo: parsed.codigo,
        regiao,
        estado: parsed.estado,
        cidade: parsed.cidade,
        telefoneWhatsapp: parsed.telefone,
        dataUltimaCompra: parsed.dataUltimaCompra,
        vendedorAtualId: fernanda.id,
      })
      const clienteId = Number(result.lastInsertRowid)
      await db.insert(carteiraHistorico).values({ clienteId, vendedorId: fernanda.id })
      await db.insert(funilMensal).values({ clienteId, vendedorId: fernanda.id, mesReferencia: mesAtual })
      criados++
    }
  }

  console.log('\n📊 Resumo da importação (Joitec Automação / Fernanda):')
  console.log('  Clientes criados:', criados)
  console.log('  Duplicados (código repetido na planilha, pulados):', duplicados)
  console.log('  Sem região válida (pulados):', semRegiaoValida)
  console.log('  Linhas não reconhecidas (puladas):', linhasIgnoradas)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro na importação:', err)
  process.exit(1)
})
