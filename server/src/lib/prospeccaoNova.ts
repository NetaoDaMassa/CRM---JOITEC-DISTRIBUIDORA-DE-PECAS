// Prospecção nova (João, 2026-11-05) — Joitec, Odin Tubos, Odin Automação,
// Compretec (e qualquer empresa menos a Odin Compressores, que segue com a
// Prospecção Odin da Bruna). Funil próprio do prospect (etapa + próximo
// contato + motivo), "Meu dia", sugestões do SAP e relatório — ver
// router/prospeccao.ts e client/src/pages/Prospeccao.tsx.
//
// Um prospect da tela nova é: clientes.emProspeccao = true E
// prospeccaoOrigem preenchida. Origem nula = cliente de balcão (a venda
// rápida também nasce com emProspeccao, 18f0d6e) ou prospect antigo da
// Bruna — nunca aparece aqui.
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { carteiraHistorico, clientes, funilMensal, prospeccaoRegistros } from '../db/schema.js'
import { agoraSqlite, hojeBrString, mesReferenciaAtual } from './dataBr.js'
import { registrarAuditoria } from './auditoria.js'
import { getConfigTexto } from './configuracoes.js'
import { regiaoPorUf, type Regiao } from './regiao.js'

export const ETAPAS_ABERTAS = ['novo', 'tentando', 'conversando', 'orcamento'] as const
export type EtapaProspeccao = 'novo' | 'tentando' | 'conversando' | 'orcamento' | 'ganho' | 'perdido' | 'desqualificado'
export type OrigemProspeccao = 'manual' | 'banco' | 'sap_grupo' | 'sap_parou' | 'crm_parou'

// Empresas do SAP que recebem "compram do grupo, mas não daqui". A Odin
// Compressores entra só como FONTE (quem compra máquina pode precisar de
// tubo/peça); destino dela é a tela da Bruna.
const SLUGS_SAP_ALVO = ['joitec', 'odin-tubos', 'joitec-automacao']
const SLUGS_SAP_FONTE = [...SLUGS_SAP_ALVO, 'odin-compressores']
const GRUPO_PADRAO = 'C003770,C002707,C001284,C001270'
export const MESES_PAROU = 6
// Perdido volta a ser sugerido depois disso; desqualificado nunca mais.
const DIAS_QUARENTENA_PERDIDO = 90
const LIMITE_SUGESTOES = 150

// ── Avanço automático de etapa por contato ─────────────────────────────────
// Novo → Tentando (contato sem resposta) / Conversando (respondeu);
// Tentando → Conversando (respondeu). Conversando/Orçamento não regridem.
export async function avancarEtapaPorContato(clienteId: number, respondeu: boolean) {
  const c = await db.query.clientes.findFirst({ where: eq(clientes.id, clienteId), columns: { prospeccaoEtapa: true } })
  if (!c) return
  let nova: EtapaProspeccao | null = null
  if (c.prospeccaoEtapa === 'novo') nova = respondeu ? 'conversando' : 'tentando'
  else if (c.prospeccaoEtapa === 'tentando' && respondeu) nova = 'conversando'
  if (nova) await db.update(clientes).set({ prospeccaoEtapa: nova, updatedAt: agoraSqlite() }).where(eq(clientes.id, clienteId))
}

export async function ehProspectNovo(clienteId: number): Promise<{ vendedorAtualId: number | null } | null> {
  const c = await db.query.clientes.findFirst({
    where: eq(clientes.id, clienteId),
    columns: { emProspeccao: true, prospeccaoOrigem: true, vendedorAtualId: true, deletedAt: true },
  })
  if (!c || c.deletedAt || !c.emProspeccao || !c.prospeccaoOrigem) return null
  return { vendedorAtualId: c.vendedorAtualId }
}

// Ligação captada pela PABXONE360 pra um número de prospect (ele não tem
// card no Kanban, então antes a ligação era ignorada — "sem_funil_mes_atual").
export async function registrarLigacaoPabxNoProspect(p: {
  clienteId: number
  userId: number
  efetiva: boolean
  observacao: string
  dataHora: string
}): Promise<boolean> {
  const prospect = await ehProspectNovo(p.clienteId)
  if (!prospect) return false
  const quem = p.userId || prospect.vendedorAtualId
  if (!quem) return false
  await db.insert(prospeccaoRegistros).values({
    clienteId: p.clienteId,
    tipo: 'ligacao',
    observacao: p.observacao,
    registradoPorId: quem,
    resultado: p.efetiva ? 'respondeu' : 'nao_respondeu',
    pendente: false,
    origem: 'pabx',
    createdAt: p.dataHora,
  })
  await avancarEtapaPorContato(p.clienteId, p.efetiva)
  return true
}

// ── Enviar pra carteira ─────────────────────────────────────────────────────
export async function enviarProspectParaCarteira(clienteId: number, alteradoPor: number | null, motivo = 'enviado pelo vendedor') {
  const c = await db.query.clientes.findFirst({ where: eq(clientes.id, clienteId) })
  if (!c) throw new Error('Prospect não encontrado')
  if (!c.emProspeccao) throw new Error('Este cliente já está na carteira.')
  if (!c.vendedorAtualId) throw new Error('Defina um vendedor responsável antes de enviar pra carteira.')
  await db
    .update(clientes)
    .set({ emProspeccao: false, prospeccaoEtapa: 'ganho', prospeccaoEncerradoEm: agoraSqlite(), prospeccaoProximoContato: null, updatedAt: agoraSqlite() })
    .where(eq(clientes.id, clienteId))
  await db.insert(carteiraHistorico).values({ clienteId, vendedorId: c.vendedorAtualId })
  const mes = mesReferenciaAtual()
  const card = await db.query.funilMensal.findFirst({
    where: and(eq(funilMensal.clienteId, clienteId), eq(funilMensal.mesReferencia, mes), isNull(funilMensal.deletedAt)),
    columns: { id: true },
  })
  if (!card) await db.insert(funilMensal).values({ clienteId, vendedorId: c.vendedorAtualId, mesReferencia: mes })
  await registrarAuditoria({ tabela: 'clientes', registroId: clienteId, acao: 'editar', campo: 'em_prospeccao', valorAnterior: 'true', valorNovo: 'false', alteradoPor })
  if (c.prospeccaoOrigem) {
    await registrarAuditoria({
      tabela: 'clientes',
      registroId: clienteId,
      acao: 'mudar_etapa',
      campo: 'prospeccao_etapa',
      valorAnterior: c.prospeccaoEtapa,
      valorNovo: `ganho|${c.vendedorAtualId}|${c.prospeccaoOrigem}|${motivo}`,
      alteradoPor,
    })
  }
}

// Venda que chegou sozinha do SAP pra um prospect = virou cliente: manda pra
// carteira na hora (senão o card do mês ficava escondido, porque o Kanban
// não mostra cliente em prospecção).
export async function concluirProspeccaoPorVenda(clienteId: number) {
  const p = await ehProspectNovo(clienteId)
  if (!p || !p.vendedorAtualId) return
  await enviarProspectParaCarteira(clienteId, null, 'venda do SAP')
}

// ── Sugestões (SAP / vendas do CRM) ─────────────────────────────────────────
export interface Sugestao {
  chave: string // 'g:<chave>' (grupo) ou 'p:<clienteId>' (parou)
  tipo: 'grupo' | 'parou'
  razaoSocial: string
  cidade: string | null
  estado: string | null
  regiao: Regiao | null
  documento: string | null
  telefone: string | null
  info: string
  valor: number
  ultimaCompra: string | null
  // grupo: cliente-fonte (outra empresa) e, se existir, o cadastro no banco
  // daqui; parou: o cadastro do banco daqui.
  clienteFonteId: number | null
  clienteDestinoId: number | null
  origemBanco: string | null
}

const soDig = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')
// Todas as chaves de um cadastro: CNPJ/CPF E código do SAP (um banco só
// pras 3 empresas: o mesmo PN tem o mesmo código na Joitec, Odin Tubos e
// Automação). Tem que comparar pelas duas — achado no teste: o cadastro da
// Joitec sem CNPJ (só código) não batia com o da Odin Tubos com CNPJ, e o
// cliente que já era da Karinna aparecia como sugestão.
function chavesCliente(c: { cnpj: string | null; cpf: string | null; codigo: string; codigoAntigo?: string | null }): string[] {
  const k: string[] = []
  for (const doc of [soDig(c.cnpj), soDig(c.cpf)]) if (doc.length === 14 || doc.length === 11) k.push(`d${doc}`)
  for (const cod of [c.codigo, c.codigoAntigo ?? '']) {
    const v = cod.trim().toUpperCase()
    if (/^C\d{5,}$/.test(v)) k.push(`c${v}`)
  }
  return [...new Set(k)]
}
const fmtR$ = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const fmtData = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—')

const cache = new Map<number, { em: number; dados: { grupo: Sugestao[]; parou: Sugestao[] } }>()
export function limparCacheSugestoes() {
  cache.clear()
}

interface LinhaCompra {
  cliente_id: number
  ultima: string | null
  total12: number
}

async function comprasPorCliente(empresaIds: number[]): Promise<Map<number, LinhaCompra>> {
  if (!empresaIds.length) return new Map()
  const lista = sql.join(empresaIds.map((id) => sql`${id}`), sql`, `)
  // Data da última compra: vendas do CRM + histórico SAP (pedidos abr–jul e
  // notas abr em diante). Valor: só vendas + pedidos SAP (itens são as
  // mesmas vendas linha a linha — somar duplicaria).
  const linhas = await db.all<LinhaCompra>(sql`
    WITH compras AS (
      SELECT v.cliente_id AS cid, substr(v.data_fechamento, 1, 10) AS d, v.valor_fechado AS val
        FROM vendas v JOIN clientes c ON c.id = v.cliente_id
       WHERE v.deleted_at IS NULL AND c.empresa_id IN (${lista})
      UNION ALL
      SELECT cliente_id, data_pedido, valor FROM sap_vendas_historico WHERE empresa_id IN (${lista})
      UNION ALL
      SELECT cliente_id, data_nota, 0 FROM sap_itens_historico WHERE empresa_id IN (${lista})
    )
    SELECT cid AS cliente_id, max(d) AS ultima,
           coalesce(sum(CASE WHEN d >= date('now', '-12 months') THEN val ELSE 0 END), 0) AS total12
      FROM compras GROUP BY cid`)
  return new Map(linhas.map((l) => [Number(l.cliente_id), { ...l, total12: Number(l.total12) || 0 }]))
}

type ClienteLeve = {
  id: number
  empresaId: number
  razaoSocial: string
  codigo: string
  codigoAntigo: string | null
  cnpj: string | null
  cpf: string | null
  cidade: string | null
  estado: string | null
  regiao: Regiao | null
  telefoneWhatsapp: string | null
  vendedorAtualId: number | null
  emProspeccao: boolean
  origemBanco: string | null
  dataUltimaCompra: string | null
  bancoDesqualificado: string | null
  prospeccaoEtapa: string | null
  prospeccaoEncerradoEm: string | null
}

async function clientesDas(empresaIds: number[]): Promise<ClienteLeve[]> {
  if (!empresaIds.length) return []
  return db.query.clientes.findMany({
    where: and(isNull(clientes.deletedAt), sql`${clientes.empresaId} IN (${sql.join(empresaIds.map((i) => sql`${i}`), sql`, `)})`),
    columns: {
      id: true,
      empresaId: true,
      razaoSocial: true,
      codigo: true,
      codigoAntigo: true,
      cnpj: true,
      cpf: true,
      cidade: true,
      estado: true,
      regiao: true,
      telefoneWhatsapp: true,
      vendedorAtualId: true,
      emProspeccao: true,
      origemBanco: true,
      dataUltimaCompra: true,
      bancoDesqualificado: true,
      prospeccaoEtapa: true,
      prospeccaoEncerradoEm: true,
    },
  }) as Promise<ClienteLeve[]>
}

// Livre pra sugerir: sem dono, não desqualificado, e se foi perdido há
// pouco, espera a quarentena.
function livre(c: ClienteLeve, limiteQuarentena: string): boolean {
  if (c.vendedorAtualId || c.emProspeccao || c.bancoDesqualificado) return false
  if (c.prospeccaoEtapa === 'perdido' && c.prospeccaoEncerradoEm && c.prospeccaoEncerradoEm > limiteQuarentena) return false
  return true
}

export async function calcularSugestoes(empresaId: number): Promise<{ grupo: Sugestao[]; parou: Sugestao[] }> {
  const hit = cache.get(empresaId)
  if (hit && Date.now() - hit.em < 10 * 60_000) return hit.dados

  const todas = await db.query.empresas.findMany({ columns: { id: true, slug: true, nome: true } })
  const nomeEmpresa = new Map(todas.map((e) => [e.id, e.nome]))
  const alvo = todas.find((e) => e.id === empresaId)
  if (!alvo || alvo.slug === 'odin-compressores') return { grupo: [], parou: [] }

  const grupoCodigos = new Set(
    ((await getConfigTexto('sap_receber_ignorar_clientes')) ?? GRUPO_PADRAO)
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  )
  const ehGrupo = (c: ClienteLeve) => grupoCodigos.has(c.codigo.trim().toUpperCase())
  const d = new Date()
  d.setDate(d.getDate() - DIAS_QUARENTENA_PERDIDO)
  const limiteQuarentena = d.toISOString().replace('T', ' ').slice(0, 19)

  const daqui = await clientesDas([empresaId])
  const comprasDaqui = await comprasPorCliente([empresaId])

  // ── Pararam de comprar (banco daqui) ──
  const corte = new Date()
  corte.setMonth(corte.getMonth() - MESES_PAROU)
  const corteStr = corte.toISOString().slice(0, 10)
  const ehSap = SLUGS_SAP_ALVO.includes(alvo.slug)
  const parou: Sugestao[] = []
  for (const c of daqui) {
    if (!livre(c, limiteQuarentena) || ehGrupo(c)) continue
    const comp = comprasDaqui.get(c.id)
    const ultimas = [comp?.ultima ?? null, c.dataUltimaCompra?.slice(0, 10) ?? null].filter((x): x is string => !!x).sort()
    const ultima = ultimas.at(-1) ?? null
    if (!ultima || ultima >= corteStr) continue
    parou.push({
      chave: `p:${c.id}`,
      tipo: 'parou',
      razaoSocial: c.razaoSocial,
      cidade: c.cidade,
      estado: c.estado,
      regiao: c.regiao ?? (c.estado ? regiaoPorUf(c.estado) : null),
      documento: c.cnpj || c.cpf,
      telefone: c.telefoneWhatsapp,
      info: `Última compra ${fmtData(ultima)}${comp?.total12 ? ` · ${fmtR$(comp.total12)} nos últimos 12 meses` : ''}`,
      valor: comp?.total12 ?? 0,
      ultimaCompra: ultima,
      clienteFonteId: null,
      clienteDestinoId: c.id,
      origemBanco: c.origemBanco,
    })
  }
  parou.sort((a, b) => b.valor - a.valor || (b.ultimaCompra ?? '').localeCompare(a.ultimaCompra ?? ''))

  // ── Compram do grupo, mas não daqui (só empresas do SAP) ──
  const grupo: Sugestao[] = []
  if (ehSap) {
    const idsFonte = todas.filter((e) => SLUGS_SAP_FONTE.includes(e.slug) && e.id !== empresaId).map((e) => e.id)
    const fontes = await clientesDas(idsFonte)
    const comprasFonte = await comprasPorCliente(idsFonte)
    const daquiPorChave = new Map<string, ClienteLeve[]>()
    for (const c of daqui) {
      for (const k of chavesCliente(c)) {
        const l = daquiPorChave.get(k) ?? []
        l.push(c)
        daquiPorChave.set(k, l)
      }
    }
    const doze = new Date()
    doze.setMonth(doze.getMonth() - 12)
    const dozeStr = doze.toISOString().slice(0, 10)
    const porChave = new Map<string, { fonte: ClienteLeve; total: number; ultima: string; empresas: Set<string>; destino: ClienteLeve | null }>()
    for (const f of fontes) {
      if (ehGrupo(f)) continue
      const comp = comprasFonte.get(f.id)
      if (!comp?.ultima || comp.ultima < dozeStr) continue
      const ks = chavesCliente(f)
      if (!ks.length) continue
      const aqui = [...new Set(ks.flatMap((k) => daquiPorChave.get(k) ?? []))]
      // Já tem dono aqui, já comprou daqui, ou desqualificado/quarentena → não sugere.
      if (aqui.some((c) => !livre(c, limiteQuarentena) || ehGrupo(c) || comprasDaqui.has(c.id))) continue
      // Agrupa as fontes do mesmo cliente (ex.: Joitec + Automação) numa sugestão só.
      const k = ks.find((x) => porChave.has(x)) ?? ks[0]
      const atual = porChave.get(k)
      const nome = nomeEmpresa.get(f.empresaId) ?? ''
      if (!atual) porChave.set(k, { fonte: f, total: comp.total12, ultima: comp.ultima, empresas: new Set([nome]), destino: aqui[0] ?? null })
      else {
        atual.empresas.add(nome)
        atual.destino ??= aqui[0] ?? null
        atual.total += comp.total12
        if (comp.ultima > atual.ultima) atual.ultima = comp.ultima
        if (comp.total12 > (comprasFonte.get(atual.fonte.id)?.total12 ?? 0)) atual.fonte = f
      }
    }
    for (const [k, g] of porChave) {
      const aqui = g.destino
      const f = g.fonte
      grupo.push({
        chave: `g:${k}`,
        tipo: 'grupo',
        razaoSocial: aqui?.razaoSocial ?? f.razaoSocial,
        cidade: aqui?.cidade ?? f.cidade,
        estado: aqui?.estado ?? f.estado,
        regiao: aqui?.regiao ?? f.regiao ?? regiaoPorUf(aqui?.estado ?? f.estado ?? ''),
        documento: f.cnpj || f.cpf,
        telefone: aqui?.telefoneWhatsapp || f.telefoneWhatsapp,
        info: `Compra da ${[...g.empresas].join(' e ')} · ${g.total ? `${fmtR$(g.total)} em 12 meses · ` : ''}última ${fmtData(g.ultima)}`,
        valor: g.total,
        ultimaCompra: g.ultima,
        clienteFonteId: f.id,
        clienteDestinoId: aqui?.id ?? null,
        origemBanco: aqui?.origemBanco ?? null,
      })
    }
    grupo.sort((a, b) => b.valor - a.valor)
  }

  const dados = { grupo: grupo.slice(0, 2000), parou: parou.slice(0, 2000) }
  cache.set(empresaId, { em: Date.now(), dados })
  return dados
}

export function filtrarSugestoes(lista: Sugestao[], regiao: string | null) {
  const daRegiao = regiao ? lista.filter((s) => !s.regiao || s.regiao === regiao) : lista
  return { itens: daRegiao.slice(0, LIMITE_SUGESTOES), total: daRegiao.length }
}

// Assume um cliente sem dono pra prospecção do vendedor — com trava de
// corrida (só se ainda estiver sem vendedor).
export async function assumirParaProspeccao(p: {
  clienteId: number
  vendedorId: number
  origem: OrigemProspeccao
  info?: string | null
  alteradoPor: number
}): Promise<boolean> {
  const r = await db
    .update(clientes)
    .set({
      vendedorAtualId: p.vendedorId,
      emProspeccao: true,
      prospeccaoOrigem: p.origem,
      prospeccaoEtapa: 'novo',
      prospeccaoProximoContato: hojeBrString(),
      prospeccaoMotivo: null,
      prospeccaoInfo: p.info ?? null,
      prospeccaoDesde: agoraSqlite(),
      prospeccaoEncerradoEm: null,
      updatedAt: agoraSqlite(),
    })
    .where(and(eq(clientes.id, p.clienteId), isNull(clientes.vendedorAtualId), isNull(clientes.deletedAt)))
  if (!r.rowsAffected) return false
  await registrarEntrada(p.clienteId, p.origem, p.vendedorId, p.alteradoPor)
  return true
}

// Entrada na prospecção — fica no log pro relatório (de onde vieram, por vendedor).
export async function registrarEntrada(clienteId: number, origem: OrigemProspeccao, vendedorId: number, alteradoPor: number) {
  await registrarAuditoria({ tabela: 'clientes', registroId: clienteId, acao: 'editar', campo: 'prospeccao_entrada', valorNovo: `${origem}|${vendedorId}`, alteradoPor })
}

