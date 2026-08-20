import * as XLSX from 'xlsx'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, carteiraHistorico, funilMensal, users } from '../db/schema.js'
import { cnpjValido } from './cnpj.js'
import { regiaoPorUf } from './regiao.js'
import { mesReferenciaAtual } from './dataBr.js'
import { registrarAuditoria } from './auditoria.js'

export interface ImportRowError {
  linha: number
  motivo: string
}

export interface ImportFileResult {
  arquivo: string
  sucesso: number
  erros: ImportRowError[]
}

// A planilha real da Joitec vem com cabeçalho BOM ("﻿Código") e nomes de
// coluna variados (nome_exibicao vs "Nome do Cliente" vs "Nome") — comparamos
// ignorando isso em vez de assumir a chave exata.
function getCol(row: Record<string, unknown>, nome: string): string {
  const chave = Object.keys(row).find((k) => k.replace(/^﻿/, '').trim() === nome)
  return chave ? String(row[chave] ?? '').trim() : ''
}

export async function importarClientesCsv(
  buffer: Buffer,
  nomeArquivo: string,
  alteradoPor: number,
  empresaId: number
): Promise<ImportFileResult> {
  // .csv sem BOM vem sempre acentuado ("Código", "Vendedor"...) — lido como
  // buffer bruto, o xlsx assume um codepage errado e transforma "Código" em
  // lixo, fazendo `getCol` nunca casar e todo o arquivo falhar com "Sem
  // código" silenciosamente. Decodificar como texto resolve, mas o
  // charset varia: Excel "CSV UTF-8" grava BOM + UTF-8 (Buffer decodifica
  // certo em UTF-8 direto), enquanto o "CSV" comum do Excel PT-BR (Windows)
  // grava em cp1252/ANSI sem BOM — UTF-8 nesse caso vira "CÃ³digo" (bytes
  // inválidos, gera replacement character �). `latin1` do Node é idêntico a
  // cp1252 pros acentos do português (só diverge no intervalo 0x80–0x9F,
  // aspas curvas/travessão que não aparecem em cabeçalho de planilha), então
  // detectar U+FFFD após decodificar em UTF-8 e cair pra latin1 nesse caso
  // cobre os dois formatos reais que o Excel produz. .xlsx/.xls continuam
  // binários, não dá pra fazer o mesmo com eles.
  const ehCsv = nomeArquivo.toLowerCase().endsWith('.csv')
  let textoCsv = ehCsv ? buffer.toString('utf8') : ''
  if (ehCsv && textoCsv.includes('�')) textoCsv = buffer.toString('latin1')
  const wb = ehCsv ? XLSX.read(textoCsv, { type: 'string' }) : XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  // `raw: false` pedia pro xlsx formatar o valor como o Excel exibiria — pra
  // números de 14 dígitos (CNPJ) isso vira notação científica ("5.5E+13"),
  // destruindo o valor. `raw: true` devolve o número puro do JS, que o
  // `getCol` já converte certo com `String(...)` (sem notação científica até
  // 1e21, bem acima de qualquer CNPJ/telefone/código real).
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })

  const vendedores = await db.query.users.findMany({ where: and(eq(users.role, 'vendor'), eq(users.empresaId, empresaId)) })
  const vendedorPorNome = new Map(vendedores.map((v) => [v.name.trim().toUpperCase(), v]))

  const erros: ImportRowError[] = []
  let sucesso = 0

  for (let i = 0; i < rows.length; i++) {
    const linha = i + 2 // +1 pelo cabeçalho, +1 porque planilha é 1-indexada
    const row = rows[i]

    const codigo = getCol(row, 'Código')
    if (!codigo) {
      erros.push({ linha, motivo: 'Sem código' })
      continue
    }

    const existente = await db.query.clientes.findFirst({
      where: and(eq(clientes.codigo, codigo), eq(clientes.empresaId, empresaId)),
    })
    if (existente) {
      erros.push({ linha, motivo: `Código ${codigo} já cadastrado (cliente #${existente.id})` })
      continue
    }

    const razaoSocial = getCol(row, 'Nome do Cliente') || getCol(row, 'nome_exibicao') || getCol(row, 'Nome')
    if (!razaoSocial) {
      erros.push({ linha, motivo: 'Sem nome do cliente' })
      continue
    }

    const estado = getCol(row, 'Estado').toUpperCase()
    const regiao = estado ? regiaoPorUf(estado) : null
    if (!regiao) {
      erros.push({ linha, motivo: `Estado "${estado || '(vazio)'}" inválido — cadastre manualmente depois` })
      continue
    }

    const vendedorNome = getCol(row, 'Vendedor').toUpperCase()
    const vendedor = vendedorNome ? vendedorPorNome.get(vendedorNome) : undefined
    if (vendedorNome && !vendedor) {
      erros.push({ linha, motivo: `Vendedor "${vendedorNome}" não encontrado no sistema` })
      continue
    }

    const documentoLimpo = getCol(row, 'documento_limpo').replace(/\D/g, '')
    const cnpj = documentoLimpo.length === 14 && cnpjValido(documentoLimpo) ? documentoLimpo : undefined

    const codigoAntigoRaw = getCol(row, 'Código Antigo')
    const codigoAntigo = codigoAntigoRaw ? codigoAntigoRaw.replace(/\.0$/, '') : undefined

    const telefoneWhatsapp = getCol(row, 'telefone_limpo') || getCol(row, 'Telefone') || undefined
    const cidade = getCol(row, 'Cidade') || undefined

    const result = await db.insert(clientes).values({
      empresaId,
      razaoSocial,
      cnpj,
      codigo,
      codigoAntigo,
      regiao,
      estado,
      cidade,
      telefoneWhatsapp,
      cadastradoPor: alteradoPor,
      vendedorAtualId: vendedor?.id,
    })
    const clienteId = Number(result.lastInsertRowid)

    if (vendedor) {
      await db.insert(carteiraHistorico).values({ clienteId, vendedorId: vendedor.id })
      await db.insert(funilMensal).values({ clienteId, vendedorId: vendedor.id, mesReferencia: mesReferenciaAtual() })
    }

    await registrarAuditoria({ tabela: 'clientes', registroId: clienteId, acao: 'criar', alteradoPor })
    sucesso++
  }

  return { arquivo: nomeArquivo, sucesso, erros }
}
