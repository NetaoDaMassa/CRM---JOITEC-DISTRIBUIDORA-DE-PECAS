// Importação pontual da planilha "Clientes João Neto 1.xlsx" (~/Downloads),
// escopo combinado com o João em 2026-08-03:
// - Só entra o que é da Joitec Distribuidora de Peças (empresaId 1) — outras
//   empresas do grupo misturadas na mesma planilha (Odin Tubos, Odin
//   Compressores, Joitec Automação, representantes externos) ficam de fora.
// - Linhas cujo "Vendedor" bate com um dos 14 vendedores reais da Joitec vão
//   pra carteira desse vendedor.
// - Linhas com rótulo genérico de "sem vendedor definido" (confirmados com o
//   João) entram no Banco de Clientes da Joitec, com origemBanco = o próprio
//   rótulo da planilha.
// - Clientes que já existem (mesmo código) só recebem o e-mail novo, se ainda
//   não tivessem um — nada mais é sobrescrito.
import * as fs from 'fs'
import * as XLSX from 'xlsx'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { clientes, carteiraHistorico, funilMensal, users } from '../src/db/schema.js'
import { cnpjValido, limparCnpj } from '../src/lib/cnpj.js'
import { regiaoPorUf } from '../src/lib/regiao.js'
import { mesReferenciaAtual, agoraSqlite } from '../src/lib/dataBr.js'
import { registrarAuditoria } from '../src/lib/auditoria.js'

const EMPRESA_ID = 1 // Joitec Distribuidora de Peças
const ADMIN_ID = 1 // "Administrador" — quem assina a importação na auditoria

const ROTULOS_BANCO = new Set([
  '-NENHUM VENDEDOR / COMPRADOR-',
  'JOITEC',
  'BANCO DE CLIENTES SUL',
  'BANCO DE CLIENTES SUDESTE 3',
  'BANCO DE CLIENTES NORDESTE',
  'BANCO DE CLIENTES SUL 2',
  'COMPRETEC',
])

function getCol(row: Record<string, unknown>, nome: string): string {
  const chave = Object.keys(row).find((k) => k.replace(/^﻿/, '').trim() === nome)
  return chave ? String(row[chave] ?? '').trim() : ''
}

async function main() {
  const caminho = '/Users/weslley/Downloads/Clientes João Neto 1.xlsx'
  const buffer = fs.readFileSync(caminho)
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false })

  const vendedores = await db.query.users.findMany({ where: and(eq(users.role, 'vendor'), eq(users.empresaId, EMPRESA_ID)) })
  const vendedorPorNome = new Map(vendedores.map((v) => [v.name.trim().toUpperCase(), v]))

  let novos = 0
  let novosComVendedor = 0
  let novosBanco = 0
  let emailsAtualizados = 0
  let jaExistiamSemMudanca = 0
  let foraDeEscopo = 0
  let codigosDuplicadosNoArquivo = 0
  const erros: { linha: number; motivo: string }[] = []
  const codigosProcessadosNestaRodada = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const linha = i + 2
    const row = rows[i]

    const codigo = getCol(row, 'Código')
    if (!codigo) continue // planilha tem linhas de rodapé/resumo sem código — ignora silenciosamente

    const vendedorNomeOriginal = getCol(row, 'Vendedor')
    const vendedorNomeUpper = vendedorNomeOriginal.toUpperCase()
    const vendedor = vendedorPorNome.get(vendedorNomeUpper)
    const ehBanco = ROTULOS_BANCO.has(vendedorNomeUpper)

    if (!vendedor && !ehBanco) {
      foraDeEscopo++
      continue
    }

    const email = getCol(row, 'E-mail') || undefined

    const existente = await db.query.clientes.findFirst({
      where: and(eq(clientes.codigo, codigo), eq(clientes.empresaId, EMPRESA_ID)),
    })

    if (existente) {
      if (email && !existente.email) {
        await db
          .update(clientes)
          .set({ email, updatedAt: agoraSqlite(), versao: existente.versao + 1 })
          .where(eq(clientes.id, existente.id))
        await registrarAuditoria({
          tabela: 'clientes',
          registroId: existente.id,
          acao: 'editar',
          campo: 'email',
          valorNovo: email,
          alteradoPor: ADMIN_ID,
        })
        emailsAtualizados++
      } else {
        jaExistiamSemMudanca++
      }
      continue
    }

    if (codigosProcessadosNestaRodada.has(codigo)) {
      codigosDuplicadosNoArquivo++
      continue
    }

    const razaoSocial = getCol(row, 'Nome do Cliente') || getCol(row, 'Nome')
    if (!razaoSocial) {
      erros.push({ linha, motivo: 'Sem nome do cliente' })
      continue
    }

    const estado = getCol(row, 'Estado').toUpperCase()
    const regiao = estado ? regiaoPorUf(estado) : null
    if (!regiao) {
      erros.push({ linha, motivo: `Estado "${estado || '(vazio)'}" inválido` })
      continue
    }

    const cnpjLimpo = limparCnpj(getCol(row, 'CNPJ'))
    const cnpj = cnpjLimpo.length === 14 && cnpjValido(cnpjLimpo) ? cnpjLimpo : undefined
    const codigoAntigoRaw = getCol(row, 'Código Antigo')
    const codigoAntigo = codigoAntigoRaw ? codigoAntigoRaw.replace(/\.0$/, '') : undefined
    const telefoneWhatsapp = getCol(row, 'Telefone') || undefined
    const cidade = getCol(row, 'Cidade') || undefined

    const result = await db.insert(clientes).values({
      empresaId: EMPRESA_ID,
      razaoSocial,
      cnpj,
      codigo,
      codigoAntigo,
      regiao,
      estado,
      cidade,
      telefoneWhatsapp,
      email,
      cadastradoPor: ADMIN_ID,
      vendedorAtualId: vendedor?.id,
      origemBanco: vendedor ? undefined : vendedorNomeOriginal,
    })
    const clienteId = Number(result.lastInsertRowid)

    if (vendedor) {
      await db.insert(carteiraHistorico).values({ clienteId, vendedorId: vendedor.id })
      await db.insert(funilMensal).values({ clienteId, vendedorId: vendedor.id, mesReferencia: mesReferenciaAtual() })
      novosComVendedor++
    } else {
      novosBanco++
    }

    await registrarAuditoria({ tabela: 'clientes', registroId: clienteId, acao: 'criar', alteradoPor: ADMIN_ID })
    codigosProcessadosNestaRodada.add(codigo)
    novos++
  }

  console.log('=== Resultado da importação ===')
  console.log('Novos clientes com vendedor definido:', novosComVendedor)
  console.log('Novos clientes pro Banco de Clientes (sem vendedor):', novosBanco)
  console.log('Total de novos clientes:', novos)
  console.log('E-mails preenchidos em cadastros existentes:', emailsAtualizados)
  console.log('Já existiam e nada mudou:', jaExistiamSemMudanca)
  console.log('Fora de escopo (outra empresa/vendedor não reconhecido):', foraDeEscopo)
  console.log('Códigos duplicados dentro do próprio arquivo (ignorados na 2ª ocorrência):', codigosDuplicadosNoArquivo)
  console.log('Erros:', erros.length)
  if (erros.length) console.log(JSON.stringify(erros.slice(0, 30), null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
