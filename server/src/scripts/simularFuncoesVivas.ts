// Simulação SOMENTE LEITURA da troca pra funções vivas: pra cada pessoa,
// mostra em que função entra, quais exceções ficariam e o que muda no
// acesso real (deve ser só a correção aprovada de vendedor). Não grava nada.
//
// Empacotado num .mjs só (esbuild) e rodado dentro do container de produção.
import { createClient } from '@libsql/client'
import { CATALOGO, ITEM_POR_ID, NIVEL_LABEL, calcularChavesFinais, chavesDaFuncao, chavesGerenciadas, excecoesParaManter, nivelPorChaves } from '../lib/acessosCatalogo.js'
import { CHAVES_TIRADAS_DE_VENDEDOR, FUNCOES_DE_VENDEDOR, FUNCOES_INICIAIS, funcaoInicialDoUsuario, itensDaFuncaoInicial } from '../lib/acessosFuncoesIniciais.js'

const db = createClient({ url: process.env.DATABASE_URL ?? 'file:./joitec_crm.db' })
const rows = async (s: string) => (await db.execute(s)).rows as unknown as Record<string, unknown>[]

const itemDaChave = new Map<string, string>()
for (const i of CATALOGO) for (const n of Object.values(i.niveis)) for (const c of n ?? []) itemDaChave.set(c, i.id)

function descreverExcecoes(exc: { feature: string; modo: 'add' | 'remove' }[], funcao: Set<string>, slug: string | null) {
  // Agrupa por item e diz o nível que a pessoa fica vs o da função.
  const porItem = new Map<string, typeof exc>()
  for (const e of exc) {
    const it = itemDaChave.get(e.feature)!
    porItem.set(it, [...(porItem.get(it) ?? []), e])
  }
  const out: string[] = []
  for (const [id, es] of porItem) {
    const item = ITEM_POR_ID.get(id)!
    const final = new Set(funcao)
    for (const e of es) e.modo === 'add' ? final.add(e.feature) : final.delete(e.feature)
    const nf = nivelPorChaves(item, funcao).nivel
    const np = nivelPorChaves(item, final)
    const sinal = np.nivel > nf ? '+' : np.nivel < nf ? '−' : '~'
    out.push(`${sinal}${item.nome} (${NIVEL_LABEL[np.nivel as 0]}${np.exato ? '' : ', torto'})`)
  }
  void slug
  return out
}

async function main() {
  const emp = new Map((await rows('select id, slug, nome from empresas')).map((e) => [Number(e.id), { slug: String(e.slug), nome: String(e.nome) }]))
  const pessoas = await rows('select id, name, username, role, super_admin, empresa_id from users where is_active = 1 order by empresa_id, name')
  const perms = await rows('select user_id, feature from permissoes_admin')
  const porUser = new Map<number, Set<string>>()
  for (const p of perms) {
    const s = porUser.get(Number(p.user_id)) ?? new Set<string>()
    s.add(String(p.feature))
    porUser.set(Number(p.user_id), s)
  }

  const nomeFuncao = new Map(FUNCOES_INICIAIS.map((f) => [f.chave, f.nome]))
  const porFuncao = new Map<string, string[]>()
  const semFuncao: string[] = []
  const mudancas: string[] = []
  let erros = 0

  for (const p of pessoas) {
    const id = Number(p.id)
    const e = emp.get(Number(p.empresa_id))
    const slug = e?.slug ?? null
    const chave = funcaoInicialDoUsuario({ username: String(p.username), role: String(p.role), superAdmin: !!Number(p.super_admin), empresaSlug: slug })
    const rotulo = `${p.name} (${p.username}, ${e?.nome})`
    if (!chave) { semFuncao.push(rotulo); continue }
    const atuais = porUser.get(id) ?? new Set<string>()
    const gerenciadas = chavesGerenciadas(slug)
    const funcao = chavesDaFuncao(itensDaFuncaoInicial(chave), slug)
    let exc = excecoesParaManter(atuais, funcao, gerenciadas)
    const tiradas: string[] = []
    if (FUNCOES_DE_VENDEDOR.has(chave)) {
      exc = exc.filter((x) => {
        const tira = x.modo === 'add' && CHAVES_TIRADAS_DE_VENDEDOR.has(x.feature)
        if (tira) tiradas.push(x.feature)
        return !tira
      })
    }
    const finais = calcularChavesFinais({ atuais, funcao, excecoes: exc, gerenciadas })
    const perdeu = [...atuais].filter((c) => !finais.has(c))
    const ganhou = [...finais].filter((c) => !atuais.has(c))
    const inesperado = perdeu.filter((c) => !tiradas.includes(c)).length + ganhou.length
    if (inesperado) { erros++; mudancas.push(`ERRO ${rotulo}: perdeu ${perdeu} ganhou ${ganhou}`) }
    if (tiradas.length) mudancas.push(`${rotulo}: deixa de ter ${tiradas.map((t) => (t === 'devolucoes_ver_comissao' ? 'ver comissão' : 'excluir chamado')).join(' e ')}`)
    const desc = descreverExcecoes(exc, funcao, slug)
    porFuncao.set(chave, [...(porFuncao.get(chave) ?? []), `${rotulo}${desc.length ? ' — exceções: ' + desc.join('; ') : ' — igual à função'}`])
  }

  for (const f of FUNCOES_INICIAIS) {
    const lista = porFuncao.get(f.chave) ?? []
    console.log(`\n== ${nomeFuncao.get(f.chave)} (${lista.length}) ==`)
    for (const l of lista) console.log('  ' + l)
  }
  console.log(`\n== Sem função (continuam exatamente como estão) (${semFuncao.length}) ==`)
  for (const l of semFuncao) console.log('  ' + l)
  console.log(`\n== O que muda de verdade no acesso (${mudancas.length}) ==`)
  for (const l of mudancas) console.log('  ' + l)
  console.log(`\nConferência: ${erros === 0 ? 'OK — fora a correção aprovada, ninguém ganha nem perde nada' : erros + ' pessoa(s) com diferença inesperada'}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
