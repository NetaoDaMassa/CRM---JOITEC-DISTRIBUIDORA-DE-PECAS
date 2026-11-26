// REGRA ÚNICA de "esse cliente já existe nesta empresa" (João, 2026-11-26 —
// casos DIRECIONAL BAURU e DOUGLAS: 230 duplicados vindos de planilha sem
// CNPJ / código antigo). Todo lugar que cria cliente (prospect, cliente novo,
// lead → cliente, cotação, negociação, importação de planilha, cadastro
// automático do SAP) e o "ganho" do prospect passam por aqui.
//
// Acha o mesmo cliente NA MESMA EMPRESA por:
//   - CNPJ/CPF igual;
//   - código do SAP igual (o de qualquer cadastro do grupo com esse CNPJ);
//   - nome igual (sem acento/pontuação);
//   - telefone igual (DDD + 8 últimos dígitos, telefone principal e extras).
// Nome/telefone com CNPJ diferente só é "filial" (aviso, não bloqueia) quando
// a raiz do CNPJ (8 primeiros) é a mesma. Raiz diferente com nome/telefone
// igual BLOQUEIA — foi exatamente o CNPJ errado da DIRECIONAL. Quem não é
// vendedor pode confirmar e cadastrar mesmo assim (outra empresa de verdade).
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clienteTelefones, clientes, notifications, users } from '../db/schema.js'
import { codigoSap } from './codigoSap.js'

export type MotivoDuplicado = 'cnpj' | 'codigo' | 'nome' | 'telefone'

export const ROTULO_MOTIVO: Record<MotivoDuplicado, string> = {
  cnpj: 'mesmo CNPJ/CPF',
  codigo: 'mesmo código do SAP',
  nome: 'mesmo nome',
  telefone: 'mesmo telefone',
}

export const soDigitos = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '')

export const normNomeCliente = (t: string | null | undefined) =>
  (t ?? '')
    .replace(/&amp;/gi, '&')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()

// Telefone → DDD + 8 últimos dígitos ("5514 3203-3513", "(14) 3203-3513",
// "014 99876-5432" → "1432033513" / "1498765432"). Curto demais = null.
export function chaveTelefone(t: string | null | undefined): string | null {
  let d = soDigitos(t)
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  d = d.replace(/^0+/, '')
  if (d.length < 10) return null
  return d.slice(0, 2) + d.slice(-8)
}

export interface ClienteDuplicado {
  id: number
  empresaId: number
  razaoSocial: string
  codigo: string
  cnpj: string | null
  vendedorAtualId: number | null
  vendedorNome: string | null
  emProspeccao: boolean | null
  prospeccaoOrigem: string | null
  bancoDesqualificado: string | null
  motivos: MotivoDuplicado[]
  // Filial da mesma empresa (mesma raiz de CNPJ): só aviso, não bloqueia.
  filial: boolean
  // Os dois têm CPF e são CPFs diferentes (pessoas com o mesmo nome): não bloqueia.
  pessoaDiferente: boolean
}

export interface BuscaDuplicado {
  doc?: string | null
  nomes?: (string | null | undefined)[]
  telefones?: (string | null | undefined)[]
  codigo?: string | null
  ignorarIds?: number[]
}

// Telefone que aparece em muitos cadastros (escritório de contabilidade,
// "0000-0000") não serve pra dizer que é o mesmo cliente.
const MAX_CADASTROS_POR_TELEFONE = 3

export async function acharDuplicados(empresaId: number, p: BuscaDuplicado): Promise<ClienteDuplicado[]> {
  const doc = soDigitos(p.doc)
  const docValido = doc.length === 11 || doc.length === 14 ? doc : ''
  const motivos = new Map<number, Set<MotivoDuplicado>>()
  const marca = (id: number, m: MotivoDuplicado) => {
    if (p.ignorarIds?.includes(id)) return
    if (!motivos.has(id)) motivos.set(id, new Set())
    motivos.get(id)!.add(m)
  }

  // 1. CNPJ/CPF — no grupo todo (pra achar o código SAP e o nome de outras empresas).
  const porDoc = docValido
    ? await db.query.clientes.findMany({
        where: and(
          isNull(clientes.deletedAt),
          or(
            sql`replace(replace(replace(replace(coalesce(${clientes.cnpj}, ''), '.', ''), '/', ''), '-', ''), ' ', '') = ${docValido}`,
            sql`replace(replace(replace(coalesce(${clientes.cpf}, ''), '.', ''), '-', ''), ' ', '') = ${docValido}`
          )
        ),
        columns: { id: true, empresaId: true, codigo: true, razaoSocial: true },
      })
    : []
  for (const c of porDoc) if (c.empresaId === empresaId) marca(c.id, 'cnpj')

  // 2. Código do SAP (o informado + o dos cadastros do grupo com esse CNPJ).
  const codigos = [...new Set([codigoSap(p.codigo), ...porDoc.map((c) => codigoSap(c.codigo))].filter((x): x is string => !!x))]
  if (codigos.length)
    for (const c of await db.query.clientes.findMany({
      where: and(eq(clientes.empresaId, empresaId), isNull(clientes.deletedAt), inArray(sql`upper(trim(${clientes.codigo}))`, codigos)),
      columns: { id: true },
    }))
      marca(c.id, 'codigo')

  // 3. Nome igual (pré-filtro pela 1ª palavra no SQL, comparação exata no JS).
  const nomesN = [...new Set([...(p.nomes ?? []), ...porDoc.map((c) => c.razaoSocial)].map(normNomeCliente).filter((n) => n.replace(/ /g, '').length >= 5))]
  if (nomesN.length) {
    const primeiras = [...new Set(nomesN.map((n) => n.split(' ')[0]))]
    for (const c of await db.query.clientes.findMany({
      where: and(eq(clientes.empresaId, empresaId), isNull(clientes.deletedAt), or(...primeiras.map((w) => sql`upper(${clientes.razaoSocial}) like ${w + '%'}`))),
      columns: { id: true, razaoSocial: true },
    }))
      if (nomesN.includes(normNomeCliente(c.razaoSocial))) marca(c.id, 'nome')
  }

  // 4. Telefone (principal + extras), pelos 8 últimos dígitos no SQL e DDD no JS.
  const chaves = [...new Set((p.telefones ?? []).map(chaveTelefone).filter((x): x is string => !!x))]
  for (const k of chaves) {
    const fim = '%' + k.slice(-8)
    const digitos = (col: unknown) =>
      sql`replace(replace(replace(replace(replace(replace(coalesce(${col}, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', '')`
    const principais = await db
      .select({ id: clientes.id, tel: clientes.telefoneWhatsapp })
      .from(clientes)
      .where(and(eq(clientes.empresaId, empresaId), isNull(clientes.deletedAt), sql`${digitos(clientes.telefoneWhatsapp)} like ${fim}`))
    const extras = await db
      .select({ id: clientes.id, tel: clienteTelefones.numero })
      .from(clienteTelefones)
      .innerJoin(clientes, eq(clientes.id, clienteTelefones.clienteId))
      .where(and(eq(clientes.empresaId, empresaId), isNull(clientes.deletedAt), sql`${digitos(clienteTelefones.numero)} like ${fim}`))
    const ids = [...new Set([...principais, ...extras].filter((r) => chaveTelefone(r.tel) === k).map((r) => r.id))]
    if (ids.length && ids.length <= MAX_CADASTROS_POR_TELEFONE) for (const id of ids) marca(id, 'telefone')
  }

  if (!motivos.size) return []
  const lista = await db.query.clientes.findMany({
    where: inArray(clientes.id, [...motivos.keys()]),
    columns: { id: true, empresaId: true, razaoSocial: true, codigo: true, cnpj: true, cpf: true, vendedorAtualId: true, emProspeccao: true, prospeccaoOrigem: true, bancoDesqualificado: true },
    with: { vendedorAtual: { columns: { name: true } } },
  })
  return lista.map((c) => {
    const m = [...motivos.get(c.id)!]
    const outroDoc = soDigitos(c.cnpj) || soDigitos(c.cpf)
    const soPorNomeOuTel = !m.includes('cnpj') && !m.includes('codigo')
    const filial = soPorNomeOuTel && doc.length === 14 && outroDoc.length === 14 && outroDoc !== doc && outroDoc.slice(0, 8) === doc.slice(0, 8)
    const pessoaDiferente = soPorNomeOuTel && doc.length === 11 && outroDoc.length === 11 && outroDoc !== doc
    return {
      id: c.id,
      empresaId: c.empresaId,
      razaoSocial: c.razaoSocial,
      codigo: c.codigo,
      cnpj: c.cnpj,
      vendedorAtualId: c.vendedorAtualId,
      vendedorNome: c.vendedorAtual?.name ?? null,
      emProspeccao: c.emProspeccao,
      prospeccaoOrigem: c.prospeccaoOrigem,
      bancoDesqualificado: c.bancoDesqualificado,
      motivos: m,
      filial,
      pessoaDiferente,
    }
  })
}

// Os que bloqueiam (tira as filiais e pessoas diferentes com o mesmo nome).
export async function duplicadosQueBloqueiam(empresaId: number, p: BuscaDuplicado) {
  return (await acharDuplicados(empresaId, p)).filter((d) => !d.filial && !d.pessoaDiferente)
}

export function descreverDuplicado(d: ClienteDuplicado): string {
  const onde = d.vendedorAtualId
    ? `${d.emProspeccao && d.prospeccaoOrigem ? 'em prospecção' : 'na carteira'} de ${d.vendedorNome ?? 'outro vendedor'}`
    : 'no Banco de Clientes, sem vendedor'
  return `${d.razaoSocial} (${d.codigo}) — ${onde} — ${d.motivos.map((m) => ROTULO_MOTIVO[m]).join(', ')}`
}

// Erro padrão pra quem tenta criar um cliente que já existe.
export class ClienteJaExisteError extends Error {
  constructor(public duplicados: ClienteDuplicado[]) {
    super(
      `Esse cliente já existe nesta empresa: ${descreverDuplicado(duplicados[0])}.` +
        (duplicados.length > 1 ? ` (+${duplicados.length - 1} cadastro${duplicados.length > 2 ? 's' : ''})` : '') +
        ' Não dá pra cadastrar de novo — se é outro cliente de verdade, peça ao gestor.'
    )
  }
}

// Trava pra usar antes de qualquer insert em `clientes`. `podeForcar` = quem
// não é vendedor e confirmou que é outro cliente (raiz de CNPJ diferente etc.).
export async function travarDuplicado(empresaId: number, p: BuscaDuplicado & { podeForcar?: boolean }) {
  const dup = await duplicadosQueBloqueiam(empresaId, p)
  if (!dup.length) return
  // CNPJ/CPF ou código SAP iguais nunca são forçáveis: é o mesmo cadastro.
  const forte = dup.some((d) => d.motivos.includes('cnpj') || d.motivos.includes('codigo'))
  if (p.podeForcar && !forte) return
  throw new ClienteJaExisteError(dup)
}

// Trava 2 — aviso na ligação (João, 2026-11-26, caso DIRECIONAL: a ligação do
// Ricardo caiu no card da debora e ninguém foi avisado). Quando alguém liga
// pra um cliente que é da carteira de OUTRO vendedor, os dois recebem aviso.
// Um aviso por pessoa/cliente por dia.
export async function avisarLigacaoClienteDeOutro(p: { clienteId: number; quemLigou: number | null; direcao: string }) {
  if (!p.quemLigou || p.direcao !== 'OUTBOUND') return
  const c = await db.query.clientes.findFirst({
    where: eq(clientes.id, p.clienteId),
    columns: { id: true, razaoSocial: true, codigo: true, vendedorAtualId: true, emProspeccao: true, prospeccaoOrigem: true },
    with: { vendedorAtual: { columns: { name: true } } },
  })
  if (!c?.vendedorAtualId || c.vendedorAtualId === p.quemLigou) return
  const jaAvisou = await db.query.notifications.findFirst({
    where: and(eq(notifications.vendedorId, p.quemLigou), eq(notifications.clienteId, c.id), eq(notifications.type, 'cliente_de_outro_vendedor'), sql`date(${notifications.createdAt}) = date('now')`),
    columns: { id: true },
  })
  if (jaAvisou) return
  // Só vendedor (o financeiro/cobrança liga pra cliente de todo mundo — é o trabalho dele).
  const quem = await db.query.users.findFirst({ where: eq(users.id, p.quemLigou), columns: { name: true, role: true } })
  if (quem?.role !== 'vendor') return
  const dono = c.vendedorAtual?.name ?? 'outro vendedor'
  const onde = c.emProspeccao && c.prospeccaoOrigem ? 'em prospecção com' : 'da carteira de'
  await db.insert(notifications).values([
    {
      vendedorId: p.quemLigou,
      clienteId: c.id,
      type: 'cliente_de_outro_vendedor',
      title: `Esse cliente é ${onde} ${dono}`,
      message: `Você ligou para ${c.razaoSocial} (${c.codigo}), que é ${onde} ${dono}. Não cadastre de novo como prospect — se precisa atender esse cliente, peça a transferência ao gestor.`,
    },
    {
      vendedorId: c.vendedorAtualId,
      clienteId: c.id,
      type: 'cliente_de_outro_vendedor',
      title: `${quem?.name ?? 'Outro vendedor'} ligou para seu cliente`,
      message: `${quem?.name ?? 'Outro vendedor'} ligou para ${c.razaoSocial} (${c.codigo}), que é seu. A ligação ficou registrada no card.`,
    },
  ])
}
