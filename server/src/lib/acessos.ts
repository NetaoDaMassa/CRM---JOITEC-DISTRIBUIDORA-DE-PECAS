// Funções vivas — liga funções + exceções à tabela permissoes_admin.
//
// Regra única: acesso da pessoa = (chaves da função ∪ exceções "a mais") −
// exceções "a menos", só nas chaves que o catálogo controla pra empresa
// dela. Tudo o que estiver fora disso (chave fora do catálogo, item de outra
// empresa) fica exatamente como está. Quem tem funcaoId null não é mexido.
//
// O resto do CRM não sabe que isso existe: continua lendo permissoes_admin.
import { eq, inArray, and } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, funcaoItens, funcoes, permissoesAdmin, usuarioExcecoes, users } from '../db/schema.js'
import {
  ITEM_POR_ID,
  calcularChavesFinais,
  chavesAteNivel,
  chavesDaFuncao,
  chavesGerenciadas,
  excecoesParaManter,
  niveisDoItem,
  todasChavesDoItem,
} from './acessosCatalogo.js'
import {
  CHAVES_TIRADAS_DE_VENDEDOR,
  FUNCOES_DE_VENDEDOR,
  FUNCOES_INICIAIS,
  funcaoInicialDoUsuario,
  itensDaFuncaoInicial,
} from './acessosFuncoesIniciais.js'
import { registrarAuditoria } from './auditoria.js'

async function slugDaEmpresa(empresaId: number): Promise<string | null> {
  const e = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId), columns: { slug: true } })
  return e?.slug ?? null
}

export async function itensDaFuncao(funcaoId: number): Promise<Record<string, number>> {
  const linhas = await db.query.funcaoItens.findMany({ where: eq(funcaoItens.funcaoId, funcaoId) })
  return Object.fromEntries(linhas.map((l) => [l.item, l.nivel]))
}

async function chavesAtuais(userId: number): Promise<Set<string>> {
  const linhas = await db.query.permissoesAdmin.findMany({ where: eq(permissoesAdmin.userId, userId), columns: { feature: true } })
  return new Set(linhas.map((l) => l.feature))
}

// Recalcula permissoes_admin de uma pessoa. Só escreve a diferença.
export async function recalcularPessoa(userId: number): Promise<{ adicionadas: string[]; tiradas: string[] }> {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true, funcaoId: true, empresaId: true, superAdmin: true } })
  if (!u || !u.funcaoId || u.superAdmin) return { adicionadas: [], tiradas: [] }
  const slug = await slugDaEmpresa(u.empresaId)
  const funcao = chavesDaFuncao(await itensDaFuncao(u.funcaoId), slug)
  const excecoes = await db.query.usuarioExcecoes.findMany({ where: eq(usuarioExcecoes.userId, userId) })
  const atuais = await chavesAtuais(userId)
  const finais = calcularChavesFinais({ atuais, funcao, excecoes, gerenciadas: chavesGerenciadas(slug) })

  const tiradas = [...atuais].filter((c) => !finais.has(c))
  const adicionadas = [...finais].filter((c) => !atuais.has(c))
  if (tiradas.length) await db.delete(permissoesAdmin).where(and(eq(permissoesAdmin.userId, userId), inArray(permissoesAdmin.feature, tiradas)))
  if (adicionadas.length) await db.insert(permissoesAdmin).values(adicionadas.map((feature) => ({ userId, feature }))).onConflictDoNothing()
  return { adicionadas, tiradas }
}

export async function recalcularFuncao(funcaoId: number): Promise<number> {
  const membros = await db.query.users.findMany({ where: eq(users.funcaoId, funcaoId), columns: { id: true } })
  for (const m of membros) await recalcularPessoa(m.id)
  return membros.length
}

// Coloca a pessoa numa função. `manterAcesso` = o que ela tem hoje vira
// exceção (nada muda pra ela); senão ela fica exatamente igual à função.
export async function definirFuncaoDaPessoa(userId: number, funcaoId: number | null, manterAcesso: boolean, por: number) {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true, empresaId: true, superAdmin: true, funcaoId: true } })
  if (!u) throw new Error('Pessoa não encontrada')
  if (u.superAdmin) throw new Error('O admin principal sempre vê tudo, não usa função')

  await db.delete(usuarioExcecoes).where(eq(usuarioExcecoes.userId, userId))
  await db.update(users).set({ funcaoId }).where(eq(users.id, userId))
  if (!funcaoId) return

  if (manterAcesso) {
    const slug = await slugDaEmpresa(u.empresaId)
    const funcao = chavesDaFuncao(await itensDaFuncao(funcaoId), slug)
    const exc = excecoesParaManter(await chavesAtuais(userId), funcao, chavesGerenciadas(slug))
    if (exc.length) await db.insert(usuarioExcecoes).values(exc.map((e) => ({ userId, feature: e.feature, modo: e.modo, criadoPor: por })))
  }
  await recalcularPessoa(userId)
}

// Muda o nível de UM item só pra essa pessoa. `nivel` null = volta a seguir
// a função nesse item.
export async function definirNivelDaPessoa(userId: number, itemId: string, nivel: number | null, por: number) {
  const item = ITEM_POR_ID.get(itemId)
  if (!item) throw new Error('Item desconhecido')
  if (nivel !== null && nivel !== 0 && !niveisDoItem(item).includes(nivel as 1 | 2 | 3)) throw new Error('Nível inválido pra esse item')
  const u = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true, funcaoId: true } })
  if (!u?.funcaoId) throw new Error('Coloque a pessoa numa função primeiro')

  const chavesItem = todasChavesDoItem(item)
  await db.delete(usuarioExcecoes).where(and(eq(usuarioExcecoes.userId, userId), inArray(usuarioExcecoes.feature, chavesItem)))
  if (nivel !== null) {
    const daFuncao = new Set(chavesAteNivel(item, (await itensDaFuncao(u.funcaoId))[itemId] ?? 0))
    const alvo = new Set(chavesAteNivel(item, nivel))
    const exc = chavesItem
      .filter((c) => alvo.has(c) !== daFuncao.has(c))
      .map((c) => ({ userId, feature: c, modo: (alvo.has(c) ? 'add' : 'remove') as 'add' | 'remove', criadoPor: por }))
    if (exc.length) await db.insert(usuarioExcecoes).values(exc)
  }
  await recalcularPessoa(userId)
}

// Tela de Permissões antiga (checkbox por chave) gravando em alguém que já
// está numa função: em vez de escrever direto, vira exceção — senão a
// próxima mudança na função apagaria o ajuste.
export async function gravarChavesComoExcecoes(userId: number, chaves: string[], por: number) {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true, funcaoId: true, empresaId: true } })
  if (!u?.funcaoId) return false
  const slug = await slugDaEmpresa(u.empresaId)
  const gerenciadas = chavesGerenciadas(slug)
  const funcao = chavesDaFuncao(await itensDaFuncao(u.funcaoId), slug)
  await db.delete(usuarioExcecoes).where(eq(usuarioExcecoes.userId, userId))
  const exc = excecoesParaManter(new Set(chaves), funcao, gerenciadas)
  if (exc.length) await db.insert(usuarioExcecoes).values(exc.map((e) => ({ userId, feature: e.feature, modo: e.modo, criadoPor: por })))
  // Chaves fora do catálogo continuam indo direto, como antes.
  const fora = chaves.filter((c) => !gerenciadas.has(c))
  const atuais = await chavesAtuais(userId)
  const foraAtuais = [...atuais].filter((c) => !gerenciadas.has(c))
  const tirarFora = foraAtuais.filter((c) => !fora.includes(c))
  if (tirarFora.length) await db.delete(permissoesAdmin).where(and(eq(permissoesAdmin.userId, userId), inArray(permissoesAdmin.feature, tirarFora)))
  const porFora = fora.filter((c) => !atuais.has(c))
  if (porFora.length) await db.insert(permissoesAdmin).values(porFora.map((feature) => ({ userId, feature }))).onConflictDoNothing()
  await recalcularPessoa(userId)
  return true
}

// Primeira subida: cria as funções combinadas com o João, coloca cada
// pessoa na dela mantendo o acesso de hoje (o que for diferente vira
// exceção) e aplica a única correção já aprovada (vendedor sem "excluir
// chamado" e sem "ver comissão" de devolução). Roda uma vez só: se já
// existe alguma função, não faz nada.
export async function migrarParaFuncoesVivas() {
  const ja = await db.query.funcoes.findFirst({ columns: { id: true } })
  if (ja) return

  const idPorChave = new Map<string, number>()
  let ordem = 0
  for (const f of FUNCOES_INICIAIS) {
    const r = await db.insert(funcoes).values({ nome: f.nome, descricao: f.descricao, camada: f.camada, tipoConta: f.tipoConta, ordem: ordem++ })
    const id = Number(r.lastInsertRowid)
    idPorChave.set(f.chave, id)
    const itens = itensDaFuncaoInicial(f.chave)
    const linhas = Object.entries(itens).map(([item, nivel]) => ({ funcaoId: id, item, nivel }))
    if (linhas.length) await db.insert(funcaoItens).values(linhas)
  }

  const todasEmpresas = await db.query.empresas.findMany({ columns: { id: true, slug: true } })
  const slugPorId = new Map(todasEmpresas.map((e) => [e.id, e.slug]))
  const pessoas = await db.query.users.findMany({
    where: eq(users.isActive, true),
    columns: { id: true, username: true, role: true, superAdmin: true, empresaId: true },
  })
  let colocadas = 0
  let correcoes = 0
  for (const p of pessoas) {
    const slug = slugPorId.get(p.empresaId) ?? null
    const chave = funcaoInicialDoUsuario({ username: p.username, role: p.role, superAdmin: p.superAdmin, empresaSlug: slug })
    if (!chave) continue
    const funcaoId = idPorChave.get(chave)!
    const funcao = chavesDaFuncao(itensDaFuncaoInicial(chave), slug)
    let exc = excecoesParaManter(await chavesAtuais(p.id), funcao, chavesGerenciadas(slug))
    if (FUNCOES_DE_VENDEDOR.has(chave)) {
      const antes = exc.length
      exc = exc.filter((e) => !(e.modo === 'add' && CHAVES_TIRADAS_DE_VENDEDOR.has(e.feature)))
      correcoes += antes - exc.length
    }
    await db.update(users).set({ funcaoId }).where(eq(users.id, p.id))
    if (exc.length) await db.insert(usuarioExcecoes).values(exc.map((e) => ({ userId: p.id, feature: e.feature, modo: e.modo })))
    await recalcularPessoa(p.id)
    colocadas++
  }

  await registrarAuditoria({
    tabela: 'funcoes',
    registroId: 0,
    acao: 'criar',
    valorNovo: `funções vivas: ${FUNCOES_INICIAIS.length} funções, ${colocadas} pessoas, ${correcoes} permissões de vendedor tiradas`,
    alteradoPor: null,
  })
  console.log(`[acessos] funções vivas criadas: ${FUNCOES_INICIAIS.length} funções, ${colocadas} pessoas, ${correcoes} correções de vendedor`)
}
