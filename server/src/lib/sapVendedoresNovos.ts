import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, funcaoTemplates, notifications, permissoesAdmin, users } from '../db/schema.js'
import { registrarAuditoria } from './auditoria.js'
import { getConfigTexto, setConfig } from './configuracoes.js'
import { criarUsuario } from './criarUsuario.js'
import { hojeBrString } from './dataBr.js'
import { salvarVendedoresLigados, vendedoresLigados } from './sapClientes.js'
import { comSessaoSap } from './sapServiceLayer.js'
import { vendedoresAutomacaoSap } from './sapSyncItens.js'

// Vendedor novo no SAP → conta no CRM — pedido do João, 2026-11-05. O CRM só
// LÊ o SAP: a cada 10 min vê se surgiu vendedor novo e mostra pro gestor, que
// cria a conta com um clique ou liga a uma conta que já existe. Decisões:
//   - Só daqui pra frente: quem já estava no SAP na 1ª rodada fica na "base"
//     (`sap_vendedores_base`) e nunca entra na lista. SalesPersons não tem
//     data de criação, por isso a base.
//   - Só Joitec, Odin Tubos e Odin Automação. Compressores e representantes
//     ficam de fora; quem precisar entra pela tela Usuários.
//   - O SAP não diz a empresa do vendedor: a sugestão vem da filial com mais
//     pedidos. Sem pedido ainda, aparece nas 3 empresas.

const CHAVE_BASE = 'sap_vendedores_base'
const CHAVE_PENDENTES = 'sap_vendedores_pendentes'
const CHAVE_IGNORADOS = 'sap_vendedores_ignorados'
const CHAVE_AUTOMACAO = 'sap_vendedores_automacao'
const SLUGS = ['joitec', 'odin-tubos', 'joitec-automacao']
const FILIAL_SLUG: Record<number, string> = { 3: 'joitec', 4: 'odin-tubos' }

interface Pendente {
  codigo: number
  nome: string
  // null = ainda sem pedido, qualquer uma das 3 empresas pode criar
  empresaSugerida: string | null
  pedidos: number
  vistoEm: string
}

// Exceção pedida pelo João, 2026-11-06: "Clientes Desqualificados" não é uma
// pessoa, mas precisa de login. Entra na lista mesmo se já estiver na base.
export function ehExcecaoComLogin(nome: string): boolean {
  return /\bCLIENTES?\s+DESQUALIFICAD[OA]S?\b/.test(semAcento(nome).toUpperCase())
}

// Cadastros do SAP que não são uma pessoa (JOITEC, GARANTIA, BANCO DE CLIENTES
// SUL…) e representantes externos.
export function naoEhVendedorPessoa(nome: string): boolean {
  if (ehExcecaoComLogin(nome)) return false
  const n = semAcento(nome).toUpperCase()
  return /\b(BANCO DE CLIENTES|CLIENTES|GARANTIA|DEMONSTRACAO|REPRESENT\w*|COMERCIAIS|LTDA|EIRELI|JOITEC|COMPRETEC|ODIN)\b/.test(n)
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')
const palavras = (t: string) =>
  semAcento(t)
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

// "PAMELA CRISTINA  - AUTOMAÇÃO" → "Pamela Cristina"
export function nomeDoSap(nome: string): string {
  const pequenas = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])
  return nome
    .split(' - ')[0]
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => (i > 0 && pequenas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ')
}

// "Yasmim Padilha Salles" → "yasmim.salles"; se já existir, "yasmim.salles2"
export function usernameSugerido(nome: string, existentes: Set<string>): string {
  const p = palavras(nome).filter((x) => !['de', 'da', 'do', 'das', 'dos', 'e'].includes(x))
  const base = p.length > 1 ? `${p[0]}.${p[p.length - 1]}` : (p[0] ?? 'vendedor')
  let tentativa = base
  for (let i = 2; existentes.has(tentativa); i++) tentativa = `${base}${i}`
  return tentativa
}

// Mesma pessoa? Primeiro nome igual, e sobrenome em comum quando os dois têm.
// "Karinna" × "KARINNA BEATRIZ LOPES" sim; "Pedro Paulo" × "PEDRO JOSE" não.
export function pareceMesmaPessoa(nomeA: string, nomeB: string): boolean {
  const a = palavras(nomeDoSap(nomeA)).filter((x) => x.length > 2)
  const b = palavras(nomeDoSap(nomeB)).filter((x) => x.length > 2)
  if (!a.length || !b.length || a[0] !== b[0]) return false
  if (a.length === 1 || b.length === 1) return true
  return a.slice(1).some((x) => b.includes(x))
}

// Filial com mais pedidos. 'fora' = vende em filial fora desta integração
// (Compressores/Compretec).
export function empresaPelosPedidos(filiais: number[]): string | null | 'fora' {
  if (!filiais.length) return null
  const conta = new Map<number, number>()
  for (const f of filiais) conta.set(f, (conta.get(f) ?? 0) + 1)
  const [filial] = [...conta.entries()].sort((a, b) => b[1] - a[1])[0]
  return FILIAL_SLUG[filial] ?? 'fora'
}

function lerPendentes(texto: string | null): Pendente[] {
  try {
    const j = JSON.parse(texto ?? '[]')
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

async function ignorados(): Promise<Set<number>> {
  return new Set(
    ((await getConfigTexto(CHAVE_IGNORADOS)) ?? '')
      .split(',')
      .map((s) => Number(s))
      .filter((n) => n > 0)
  )
}

export async function ignorarVendedorSap(codigo: number, ignorar: boolean): Promise<void> {
  const atual = await ignorados()
  if (ignorar) atual.add(codigo)
  else atual.delete(codigo)
  await setConfig(CHAVE_IGNORADOS, [...atual].join(','))
}

// Quem recebe o aviso: superAdmin + quem tem acesso à tela de Clientes do SAP.
async function avisarGestores(novos: Pendente[]): Promise<void> {
  const comAcesso = await db.select({ id: permissoesAdmin.userId }).from(permissoesAdmin).where(eq(permissoesAdmin.feature, 'conferencia_sap'))
  const lista = await db.query.users.findMany({ where: eq(users.isActive, true), columns: { id: true, superAdmin: true, role: true } })
  const ids = new Set(comAcesso.map((c) => c.id))
  const destino = lista.filter((u) => u.superAdmin || (ids.has(u.id) && u.role !== 'vendor'))
  for (const v of novos) {
    for (const u of destino) {
      await db.insert(notifications).values({
        vendedorId: u.id,
        type: 'info',
        title: 'Vendedor novo no SAP',
        message: `${nomeDoSap(v.nome)} foi cadastrado no SAP e ainda não tem conta no CRM. Crie em Clientes do SAP p/ cadastrar → Vendedores novos.`,
      })
    }
  }
}

// ── Rodada automática (sapAgendado.ts) ──────────────────────────────────
export async function verificarVendedoresNovosSap(): Promise<{ baseCriada: boolean; pendentes: number; novos: number }> {
  const { lista, pedidosPorCodigo, base } = await comSessaoSap(async (sap) => {
    const lista = await sap.getTodos<{ SalesEmployeeCode: number; SalesEmployeeName: string; Active: string }>('/SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName,Active', 200)
    const textoBase = await getConfigTexto(CHAVE_BASE)
    const base = textoBase ? new Set(textoBase.split(',').map(Number)) : null
    const ligados = await vendedoresLigados()
    const pedidosPorCodigo = new Map<number, number[]>()
    if (base) {
      // Só consulta pedido de quem é candidato (normalmente ninguém).
      for (const v of lista) {
        if (!candidato(v, base, ligados)) continue
        const pedidos = await sap.getTodos<{ BPL_IDAssignedToInvoice: number }>(`/Orders?$filter=SalesPersonCode eq ${v.SalesEmployeeCode} and Cancelled eq 'tNO'&$select=BPL_IDAssignedToInvoice`, 200)
        pedidosPorCodigo.set(v.SalesEmployeeCode, pedidos.map((p) => p.BPL_IDAssignedToInvoice))
      }
    }
    return { lista, pedidosPorCodigo, base }
  })

  // 1ª rodada: todo mundo que já está no SAP vira base. Lista vazia seria
  // erro do SAP: gravar transformaria todos em "novos" depois.
  if (!base) {
    if (!lista.length) throw new Error('SAP devolveu a lista de vendedores vazia')
    await setConfig(CHAVE_BASE, lista.map((v) => v.SalesEmployeeCode).join(','))
    return { baseCriada: true, pendentes: 0, novos: 0 }
  }

  const anteriores = lerPendentes(await getConfigTexto(CHAVE_PENDENTES))
  const vistoAntes = new Map(anteriores.map((p) => [p.codigo, p]))
  const hoje = hojeBrString()
  const pendentes: Pendente[] = []
  for (const v of lista) {
    const filiais = pedidosPorCodigo.get(v.SalesEmployeeCode)
    if (!filiais) continue
    const empresa = empresaPelosPedidos(filiais)
    if (empresa === 'fora') continue
    pendentes.push({
      codigo: v.SalesEmployeeCode,
      nome: v.SalesEmployeeName.trim(),
      empresaSugerida: empresa,
      pedidos: filiais.length,
      vistoEm: vistoAntes.get(v.SalesEmployeeCode)?.vistoEm ?? hoje,
    })
  }
  await setConfig(CHAVE_PENDENTES, JSON.stringify(pendentes))

  const fora = await ignorados()
  const novos = pendentes.filter((p) => !vistoAntes.has(p.codigo) && !fora.has(p.codigo))
  if (novos.length) await avisarGestores(novos)
  return { baseCriada: false, pendentes: pendentes.length, novos: novos.length }
}

function candidato(v: { SalesEmployeeCode: number; SalesEmployeeName: string; Active: string }, base: Set<number>, ligados: Record<string, number>): boolean {
  return v.SalesEmployeeCode > 0 && v.Active !== 'tNO' && (!base.has(v.SalesEmployeeCode) || ehExcecaoComLogin(v.SalesEmployeeName)) && !ligados[String(v.SalesEmployeeCode)] && !naoEhVendedorPessoa(v.SalesEmployeeName)
}

// ── Tela do gestor ──────────────────────────────────────────────────────
const apareceNaEmpresa = (p: Pendente, slug: string) =>
  // Vendedor da Automação tira pedido pela filial Joitec, então a sugestão
  // "joitec" também aparece pra Automação.
  p.empresaSugerida === null || p.empresaSugerida === slug || (slug === 'joitec-automacao' && p.empresaSugerida === 'joitec')

export async function vendedoresNovosDaEmpresa(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (!empresa || !SLUGS.includes(empresa.slug)) return { suportada: false as const, lista: [] }
  const [pendentes, ligados, fora] = await Promise.all([getConfigTexto(CHAVE_PENDENTES).then(lerPendentes), vendedoresLigados(), ignorados()])
  const todos = await db.query.users.findMany({ columns: { id: true, name: true, username: true, empresaId: true, isActive: true, superAdmin: true } })
  const usernames = new Set(todos.map((u) => u.username))
  const daEmpresa = todos.filter((u) => u.empresaId === empresaId && u.isActive && !u.superAdmin)
  const lista = pendentes
    .filter((p) => !ligados[String(p.codigo)] && apareceNaEmpresa(p, empresa.slug))
    .map((p) => {
      const nome = nomeDoSap(p.nome)
      return {
        ...p,
        nomeSugerido: nome,
        usernameSugerido: usernameSugerido(nome, usernames),
        ignorado: fora.has(p.codigo),
        parecidos: daEmpresa.filter((u) => pareceMesmaPessoa(p.nome, u.name)).map((u) => ({ id: u.id, nome: u.name, username: u.username })),
      }
    })
  return { suportada: true as const, empresa: empresa.nome, lista }
}

async function pendenteParaEmpresa(codigo: number, empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  const p = lerPendentes(await getConfigTexto(CHAVE_PENDENTES)).find((x) => x.codigo === codigo)
  if (!empresa || !p || !apareceNaEmpresa(p, empresa.slug)) throw new Error('Este vendedor não está na lista desta empresa.')
  const ligados = await vendedoresLigados()
  if (ligados[String(codigo)]) throw new Error('Este vendedor do SAP já está ligado a uma conta.')
  return { empresa, ligados }
}

// Liga o código do SAP à conta. Na Automação também entra na lista que separa
// os pedidos dela dos da Joitec (mesma filial no SAP): sem isso, os pedidos
// dele cairiam na Joitec.
async function ligar(codigo: number, userId: number, slug: string, ligados: Record<string, number>): Promise<void> {
  await salvarVendedoresLigados({ ...ligados, [String(codigo)]: userId })
  if (slug === 'joitec-automacao') {
    const automacao = await vendedoresAutomacaoSap()
    automacao.add(codigo)
    await setConfig(CHAVE_AUTOMACAO, [...automacao].join(','))
  }
}

export async function criarContaVendedorSap(input: { codigo: number; nome: string; username: string }, empresaId: number, autorId: number) {
  const { empresa, ligados } = await pendenteParaEmpresa(input.codigo, empresaId)
  const template = await db.query.funcaoTemplates.findFirst({
    where: and(eq(funcaoTemplates.empresaId, empresaId), eq(funcaoTemplates.nome, 'Vendedor'), eq(funcaoTemplates.role, 'vendor')),
  })
  if (!template) throw new Error('Esta empresa não tem a função "Vendedor". Crie em Funções.')
  const r = await criarUsuario({ empresaId, name: input.nome.trim(), username: input.username.trim().toLowerCase(), funcaoTemplateId: template.id })
  await ligar(input.codigo, r.id, empresa.slug, ligados)
  await registrarAuditoria({ tabela: 'users', registroId: r.id, acao: 'criar', alteradoPor: autorId, campo: 'origem', valorNovo: `Vendedor ${input.codigo} do SAP` })
  return { id: r.id, username: input.username.trim().toLowerCase(), senhaTemporaria: r.senhaTemporaria }
}

export async function ligarContaVendedorSap(codigo: number, userId: number, empresaId: number, autorId: number) {
  const { empresa, ligados } = await pendenteParaEmpresa(codigo, empresaId)
  const alvo = await db.query.users.findFirst({ where: and(eq(users.id, userId), eq(users.empresaId, empresaId)), columns: { id: true } })
  if (!alvo) throw new Error('Conta não encontrada nesta empresa.')
  await ligar(codigo, userId, empresa.slug, ligados)
  await registrarAuditoria({ tabela: 'users', registroId: userId, acao: 'editar', alteradoPor: autorId, campo: 'vendedor_sap', valorNovo: String(codigo) })
  return { ok: true }
}
