import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { adiantamentosPix, clientes, empresas, notifications, vendas } from '../db/schema.js'
import { getConfigTexto, setConfig } from './configuracoes.js'
import { hojeBrString } from './dataBr.js'
import { filtroPiloto } from './pilotoFinanceiro.js'

// Adiantamento PIX (financeiro, 2026-11-13): toda venda à vista (PIX) ou
// entrada + boleto da Joitec, Odin Tubos e Odin Automação precisa do
// comprovante do PIX anexado pelo vendedor. Sem ele: card do Kanban mostra
// "AGUARDANDO COMPROVANTE DO PIX", a expedição não agenda nem fecha a coleta.
// O financeiro confere na tela Adiantamento PIX (À conferir → Conferido).

export const EMPRESAS_PIX = ['joitec', 'odin-tubos', 'joitec-automacao']

export type TipoPix = 'avista' | 'entrada_boleto'
export type RegraPix = { avista: string[]; entrada: string[] }

// Palavras que, aparecendo na condição de pagamento da venda, fazem ela
// cair no PIX. O financeiro muda em Adiantamento PIX → Configuração.
const REGRA_PADRAO: RegraPix = { avista: ['vista', 'pix', 'antecipado'], entrada: ['entrada', 'sinal'] }
const CHAVE_REGRA = 'pix_condicoes'
// Só vendas a partir dessa data (YYYY-MM-DD) — as antigas não travam nada.
const CHAVE_DESDE = 'pix_desde'

export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export async function lerRegraPix(): Promise<RegraPix> {
  const v = await getConfigTexto(CHAVE_REGRA)
  if (!v) return REGRA_PADRAO
  try {
    const r = JSON.parse(v) as Partial<RegraPix>
    return { avista: Array.isArray(r.avista) ? r.avista : REGRA_PADRAO.avista, entrada: Array.isArray(r.entrada) ? r.entrada : REGRA_PADRAO.entrada }
  } catch {
    return REGRA_PADRAO
  }
}

export async function salvarRegraPix(r: RegraPix): Promise<void> {
  const limpar = (l: string[]) => [...new Set(l.map((x) => normalizar(x)).filter(Boolean))]
  await setConfig(CHAVE_REGRA, JSON.stringify({ avista: limpar(r.avista), entrada: limpar(r.entrada) }))
}

// Primeira vez que roda grava o dia de hoje — a regra vale dali pra frente.
export async function lerPixDesde(): Promise<string> {
  const v = await getConfigTexto(CHAVE_DESDE)
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const hoje = hojeBrString()
  await setConfig(CHAVE_DESDE, hoje)
  return hoje
}

export async function salvarPixDesde(data: string): Promise<void> {
  await setConfig(CHAVE_DESDE, data)
}

export function tipoPix(condicao: string | null | undefined, regra: RegraPix): TipoPix | null {
  if (!condicao) return null
  const c = normalizar(condicao)
  // "Entrada + boleto" primeiro — "entrada à vista + 28 dias" é entrada.
  if (regra.entrada.some((p) => p && c.includes(normalizar(p)))) return 'entrada_boleto'
  if (regra.avista.some((p) => p && c.includes(normalizar(p)))) return 'avista'
  return null
}

export type StatusPix = 'aguardando' | 'anexado' | 'conferido'

// Vários comprovantes por venda (João, 2026-11-17: "poder anexar mais de uma
// imagem"). Sem migração: com 1 arquivo `comprovante_path` continua sendo o
// caminho puro (como sempre foi); com 2+ vira um JSON [{path, nome}] e
// `comprovante_nome` = "N arquivos". Ler/gravar SEMPRE por estas funções.
export type ArquivoPix = { path: string; nome: string | null }
export const MAX_COMPROVANTES_PIX = 15
export function lerComprovantes(path: string | null | undefined, nome: string | null | undefined): ArquivoPix[] {
  if (!path) return []
  if (path.startsWith('[')) {
    try {
      const a = JSON.parse(path)
      if (Array.isArray(a)) return a.filter((x) => x && typeof x.path === 'string' && x.path).map((x) => ({ path: x.path as string, nome: typeof x.nome === 'string' ? x.nome : null }))
    } catch {
      /* caminho antigo que por acaso começa com "[" — trata como arquivo único */
    }
  }
  return [{ path, nome: nome ?? null }]
}
export function gravarComprovantes(lista: ArquivoPix[]): { comprovantePath: string | null; comprovanteNome: string | null } {
  if (!lista.length) return { comprovantePath: null, comprovanteNome: null }
  if (lista.length === 1) return { comprovantePath: lista[0].path, comprovanteNome: lista[0].nome }
  return { comprovantePath: JSON.stringify(lista), comprovanteNome: `${lista.length} arquivos` }
}
export type PixDaVenda = {
  tipo: TipoPix
  status: StatusPix
  comprovantePath: string | null
  comprovanteNome: string | null
  comprovantes: ArquivoPix[]
  anexadoEm: string | null
  conferidoEm: string | null
}

type VendaBase = { id: number; condicaoPagamento: string | null; dataFechamento: string; clienteId: number; vendedorId: number }

// Situação do PIX de cada venda (só as que entram na regra). Map vendaId → pix.
export async function pixDasVendas(lista: VendaBase[]): Promise<Map<number, PixDaVenda>> {
  const out = new Map<number, PixDaVenda>()
  if (!lista.length) return out
  const [regra, desde, piloto] = await Promise.all([lerRegraPix(), lerPixDesde(), filtroPiloto()])
  // Piloto (2026-11-16): só vendas de vendedor que está no piloto do financeiro.
  const candidatas = lista.filter((v) => piloto(v.vendedorId) && v.dataFechamento.slice(0, 10) >= desde && tipoPix(v.condicaoPagamento, regra))
  if (!candidatas.length) return out
  // Só as 3 empresas (pela empresa do cliente da venda).
  const clienteIds = [...new Set(candidatas.map((v) => v.clienteId))]
  const doCliente = new Map(
    (
      await db
        .select({ id: clientes.id, slug: empresas.slug })
        .from(clientes)
        .innerJoin(empresas, eq(empresas.id, clientes.empresaId))
        .where(inArray(clientes.id, clienteIds))
    ).map((c) => [c.id, c.slug])
  )
  const validas = candidatas.filter((v) => EMPRESAS_PIX.includes(doCliente.get(v.clienteId) ?? ''))
  if (!validas.length) return out
  const linhas = new Map(
    (await db.select().from(adiantamentosPix).where(inArray(adiantamentosPix.vendaId, validas.map((v) => v.id)))).map((l) => [l.vendaId, l])
  )
  for (const v of validas) {
    const l = linhas.get(v.id)
    const comprovantes = lerComprovantes(l?.comprovantePath, l?.comprovanteNome)
    out.set(v.id, {
      tipo: tipoPix(v.condicaoPagamento, regra)!,
      status: l?.conferidoEm ? 'conferido' : comprovantes.length ? 'anexado' : 'aguardando',
      comprovantePath: comprovantes[0]?.path ?? null,
      comprovanteNome: comprovantes[0]?.nome ?? null,
      comprovantes,
      anexadoEm: l?.anexadoEm ?? null,
      conferidoEm: l?.conferidoEm ?? null,
    })
  }
  return out
}

// Pedidos do SAP (DocEntry) cujo PIX ainda NÃO foi conferido pelo financeiro
// — a expedição trava esses (agendar coleta / marcar coletado). João,
// 2026-11-16: a trava só sai quando o financeiro confere (não ao anexar).
export async function pedidosAguardandoPix(entries: number[]): Promise<Map<number, { vendaId: number; tipo: TipoPix; status: 'aguardando' | 'anexado' }>> {
  const out = new Map<number, { vendaId: number; tipo: TipoPix; status: 'aguardando' | 'anexado' }>()
  const unicos = [...new Set(entries.filter((e) => Number.isFinite(e)))]
  if (!unicos.length) return out
  const vs = await db
    .select({ id: vendas.id, condicaoPagamento: vendas.condicaoPagamento, dataFechamento: vendas.dataFechamento, clienteId: vendas.clienteId, vendedorId: vendas.vendedorId, entry: vendas.pedidoSapEntry })
    .from(vendas)
    .where(and(inArray(vendas.pedidoSapEntry, unicos), isNull(vendas.deletedAt)))
  const pix = await pixDasVendas(vs)
  for (const v of vs) {
    const p = pix.get(v.id)
    if (p && p.status !== 'conferido' && v.entry != null) out.set(v.entry, { vendaId: v.id, tipo: p.tipo, status: p.status })
  }
  return out
}

export function entriesDoCard(orderEntriesSap: string | null | undefined): number[] {
  return (orderEntriesSap ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

export const MSG_TRAVA_PIX = 'PIX AINDA NÃO CONFERIDO — o vendedor anexa o comprovante no card do cliente e o financeiro confere em Adiantamento PIX. Só depois sai a NF / termina a expedição.'

// Aviso pro vendedor logo que a venda à vista/entrada entra (manual ou SAP).
// Nunca derruba quem chamou.
export async function avisarVendedorPix(vendaId: number): Promise<void> {
  try {
    const v = await db.query.vendas.findFirst({ where: eq(vendas.id, vendaId) })
    if (!v) return
    const pix = (await pixDasVendas([v])).get(v.id)
    if (!pix || pix.status !== 'aguardando') return
    const cli = await db.query.clientes.findFirst({ where: eq(clientes.id, v.clienteId), columns: { razaoSocial: true } })
    await db.insert(notifications).values({
      vendedorId: v.vendedorId,
      clienteId: v.clienteId,
      type: 'pix_comprovante',
      title: 'Anexe o comprovante do PIX',
      message: `${cli?.razaoSocial ?? 'Cliente'}${v.numeroPedido ? ` · pedido ${v.numeroPedido}` : ''} é ${pix.tipo === 'entrada_boleto' ? 'entrada + boleto' : 'à vista'}: anexe o comprovante no card, senão NÃO SAI NOTA e a expedição NÃO TERMINA.`,
    })
  } catch (e) {
    console.error('[pix] aviso ao vendedor falhou', e)
  }
}
