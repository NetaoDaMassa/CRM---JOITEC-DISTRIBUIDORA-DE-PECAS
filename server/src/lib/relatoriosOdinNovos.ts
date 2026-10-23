// Relatórios só da Odin Compressores, pedidos pelo João em 2026-10-23
// (abas novas de Relatórios Odin):
//   1. Visitas por região/cidade (externos)
//   2. Propostas: perdas e prazos
//   3. Máquinas por modelo (vendas, procura em propostas, estoque parado,
//      demonstrações)
//   4. Peças: recompra da carteira
// Período opcional: sem datas = desde sempre. Colunas datetime('now') estão
// em UTC → janela deslocada +3h; dataVisita/dataSaida já são dia de Brasília.
import { and, eq, gte, inArray, isNull, lt, ne } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, demonstracaoItens, demonstracoes, estoqueMaquinas, ordens, propostas, users, vendas, visitas, visitasClientes } from '../db/schema.js'
import { hojeBrString } from './dataBr.js'

export type FiltroOdin = { dataDe?: string; dataAte?: string; vendedorId?: number }

const proximoDia = (dia: string) => new Date(new Date(`${dia}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
const utcMs = (s: string) => new Date(s.replace(' ', 'T') + (s.length <= 10 ? 'T12:00:00Z' : 'Z')).getTime()
const diasEntre = (de: string, ate: string) => Math.floor((utcMs(ate) - utcMs(de)) / 86_400_000)
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)

function janelas(f: FiltroOdin) {
  const fim = f.dataAte ? proximoDia(f.dataAte) : null
  return {
    utc: [f.dataDe ? `${f.dataDe} 03:00:00` : null, fim ? `${fim} 03:00:00` : null] as const,
    dia: [f.dataDe ?? null, fim] as const,
  }
}

async function nomesUsuarios(empresaId: number) {
  const us = await db.query.users.findMany({ where: eq(users.empresaId, empresaId), columns: { id: true, name: true } })
  return new Map(us.map((u) => [u.id, u.name]))
}

// ── 1. Visitas por região/cidade ─────────────────────────────────────────
export async function visitasPorRegiao(empresaId: number, f: FiltroOdin) {
  const { dia } = janelas(f)
  const lista = await db
    .select({
      id: visitas.id,
      vendedorId: visitas.vendedorId,
      dataVisita: visitas.dataVisita,
      checkinEm: visitas.checkinEm,
      checkoutEm: visitas.checkoutEm,
      latCheckin: visitas.latCheckin,
      convertida: visitas.convertidoParaPropostaId,
      clienteId: visitas.clienteId,
      clienteNomeVisita: visitas.clienteNome,
      nomeEmpresa: visitas.nomeEmpresa,
      clienteNome: visitasClientes.nome,
      cidade: visitasClientes.cidade,
      estado: visitasClientes.estado,
    })
    .from(visitas)
    .leftJoin(visitasClientes, eq(visitasClientes.id, visitas.clienteId))
    .where(
      and(
        eq(visitas.empresaId, empresaId),
        f.vendedorId ? eq(visitas.vendedorId, f.vendedorId) : undefined,
        dia[0] ? gte(visitas.dataVisita, dia[0]) : undefined,
        dia[1] ? lt(visitas.dataVisita, dia[1]) : undefined,
      ),
    )
  const nomes = await nomesUsuarios(empresaId)
  const normEstado = (e: string | null) => (e?.trim() ? e.trim().toUpperCase().slice(0, 2) : 'Sem UF')
  const normCidade = (c: string | null) => (c?.trim() ? c.trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (l) => l.toUpperCase()) : 'Sem cidade')
  const chaveCliente = (v: (typeof lista)[number]) => (v.clienteId ? `c${v.clienteId}` : `n${(v.clienteNome ?? v.clienteNomeVisita ?? v.nomeEmpresa ?? v.id).toString().toLowerCase()}`)

  type Grupo = { visitas: number; clientes: Set<string>; convertidas: number; vendedores: Set<number>; ultima: string }
  const novo = (): Grupo => ({ visitas: 0, clientes: new Set(), convertidas: 0, vendedores: new Set(), ultima: '' })
  const porEstado = new Map<string, Grupo>()
  const porCidade = new Map<string, Grupo & { cidade: string; estado: string }>()
  for (const v of lista) {
    const uf = normEstado(v.estado)
    const cid = normCidade(v.cidade)
    const ge = porEstado.get(uf) ?? porEstado.set(uf, novo()).get(uf)!
    const kc = `${cid}|${uf}`
    const gc = porCidade.get(kc) ?? porCidade.set(kc, { ...novo(), cidade: cid, estado: uf }).get(kc)!
    for (const g of [ge, gc]) {
      g.visitas++
      g.clientes.add(chaveCliente(v))
      if (v.convertida) g.convertidas++
      g.vendedores.add(v.vendedorId)
      if (v.dataVisita > g.ultima) g.ultima = v.dataVisita
    }
  }
  const fechar = (g: Grupo) => ({
    visitas: g.visitas,
    clientes: g.clientes.size,
    convertidas: g.convertidas,
    conversao: pct(g.convertidas, g.visitas),
    vendedores: [...g.vendedores].map((id) => nomes.get(id) ?? '—'),
    ultimaVisita: g.ultima.slice(0, 10),
  })

  const vendIds = [...new Set(lista.map((v) => v.vendedorId))]
  const porVendedor = vendIds
    .map((id) => {
      const dele = lista.filter((v) => v.vendedorId === id)
      return {
        id,
        nome: nomes.get(id) ?? '—',
        visitas: dele.length,
        cidades: new Set(dele.map((v) => `${normCidade(v.cidade)}|${normEstado(v.estado)}`)).size,
        estados: new Set(dele.map((v) => normEstado(v.estado))).size,
        semGps: dele.filter((v) => v.latCheckin == null).length,
        semCheckout: dele.filter((v) => v.checkinEm && !v.checkoutEm).length,
        convertidas: dele.filter((v) => v.convertida).length,
        conversao: pct(dele.filter((v) => v.convertida).length, dele.length),
      }
    })
    .sort((a, b) => b.visitas - a.visitas)

  // Clientes visitados que nunca viraram proposta no período (o último
  // contato primeiro) — pra cobrar retorno.
  const porCliente = new Map<string, { nome: string; cidade: string; estado: string; visitas: number; ultima: string; vendedor: string; convertida: boolean }>()
  for (const v of lista) {
    const k = chaveCliente(v)
    const atual = porCliente.get(k) ?? {
      nome: v.clienteNome ?? v.clienteNomeVisita ?? v.nomeEmpresa ?? '—',
      cidade: normCidade(v.cidade),
      estado: normEstado(v.estado),
      visitas: 0,
      ultima: '',
      vendedor: nomes.get(v.vendedorId) ?? '—',
      convertida: false,
    }
    atual.visitas++
    if (v.dataVisita > atual.ultima) {
      atual.ultima = v.dataVisita
      atual.vendedor = nomes.get(v.vendedorId) ?? '—'
    }
    if (v.convertida) atual.convertida = true
    porCliente.set(k, atual)
  }
  const semProposta = [...porCliente.values()]
    .filter((c) => !c.convertida)
    .sort((a, b) => b.visitas - a.visitas || b.ultima.localeCompare(a.ultima))
    .slice(0, 40)
    .map((c) => ({ ...c, ultima: c.ultima.slice(0, 10) }))

  return {
    totais: {
      visitas: lista.length,
      clientes: porCliente.size,
      cidades: porCidade.size,
      estados: porEstado.size,
      semGps: lista.filter((v) => v.latCheckin == null).length,
      semCheckout: lista.filter((v) => v.checkinEm && !v.checkoutEm).length,
      convertidas: lista.filter((v) => v.convertida).length,
      semCidade: lista.filter((v) => !v.cidade?.trim()).length,
    },
    porEstado: [...porEstado.entries()].map(([estado, g]) => ({ estado, ...fechar(g) })).sort((a, b) => b.visitas - a.visitas),
    porCidade: [...porCidade.values()].map((g) => ({ cidade: g.cidade, estado: g.estado, ...fechar(g) })).sort((a, b) => b.visitas - a.visitas).slice(0, 40),
    porVendedor,
    semProposta,
  }
}

// ── 2. Propostas: perdas e prazos ────────────────────────────────────────
const ABERTAS = ['proposta', 'negociacao', 'chamar_depois'] as const

export async function propostasPerdasPrazos(empresaId: number, f: FiltroOdin) {
  const { utc } = janelas(f)
  const hoje = hojeBrString()
  const doPeriodo = await db.query.propostas.findMany({
    where: and(
      eq(propostas.empresaId, empresaId),
      f.vendedorId ? eq(propostas.vendedorId, f.vendedorId) : undefined,
      utc[0] ? gte(propostas.createdAt, utc[0]) : undefined,
      utc[1] ? lt(propostas.createdAt, utc[1]) : undefined,
    ),
    columns: { id: true, vendedorId: true, stage: true, motivoPerda: true, createdAt: true, convertidoParaOrdemId: true, semProposta: true },
  })
  // Abertas AGORA (qualquer data de criação) — o "prazo" é foto do momento.
  const abertas = await db.query.propostas.findMany({
    where: and(eq(propostas.empresaId, empresaId), inArray(propostas.stage, [...ABERTAS]), f.vendedorId ? eq(propostas.vendedorId, f.vendedorId) : undefined),
    columns: { id: true, vendedorId: true, stage: true, clienteNome: true, createdAt: true, updatedAt: true, dataRetorno: true, prioridade: true },
  })
  const ordensConv = doPeriodo.filter((p) => p.convertidoParaOrdemId).map((p) => p.convertidoParaOrdemId!)
  const criacaoOrdem = ordensConv.length
    ? new Map((await db.query.ordens.findMany({ where: inArray(ordens.id, ordensConv), columns: { id: true, createdAt: true } })).map((o) => [o.id, o.createdAt]))
    : new Map<number, string>()
  const nomes = await nomesUsuarios(empresaId)

  const ganhas = doPeriodo.filter((p) => p.stage === 'convertido' || p.stage === 'fechado' || p.convertidoParaOrdemId)
  const perdidas = doPeriodo.filter((p) => p.stage === 'perdido')

  // Motivos: texto livre — agrupa ignorando maiúscula/espaço/pontuação final.
  const motivos = new Map<string, { texto: string; qtd: number }>()
  for (const p of perdidas) {
    const texto = p.motivoPerda?.trim() || 'Sem motivo informado'
    const chave = texto.toLowerCase().replace(/[.!\s]+$/g, '').replace(/\s+/g, ' ')
    const m = motivos.get(chave) ?? motivos.set(chave, { texto, qtd: 0 }).get(chave)!
    m.qtd++
  }

  const diasAteFechar = doPeriodo
    .map((p) => (p.convertidoParaOrdemId ? criacaoOrdem.get(p.convertidoParaOrdemId) : null) ?? null)
    .map((fim, i) => (fim ? diasEntre(doPeriodo[i].createdAt, fim) : null))
    .filter((d): d is number => d != null && d >= 0)

  const vendIds = [...new Set([...doPeriodo.map((p) => p.vendedorId), ...abertas.map((p) => p.vendedorId)])]
  const porVendedor = vendIds
    .map((id) => {
      const dele = doPeriodo.filter((p) => p.vendedorId === id)
      const g = dele.filter((p) => ganhas.includes(p)).length
      const pe = dele.filter((p) => p.stage === 'perdido').length
      const ab = abertas.filter((p) => p.vendedorId === id)
      return {
        id,
        nome: nomes.get(id) ?? '—',
        criadas: dele.length,
        ganhas: g,
        perdidas: pe,
        taxaGanho: pct(g, g + pe),
        abertasAgora: ab.length,
        paradas15: ab.filter((p) => diasEntre(p.updatedAt, `${hoje} 15:00:00`) > 15).length,
      }
    })
    .sort((a, b) => b.criadas - a.criadas)

  const paradas = abertas
    .map((p) => ({
      id: p.id,
      cliente: p.clienteNome,
      vendedor: nomes.get(p.vendedorId) ?? '—',
      etapa: p.stage,
      prioridade: p.prioridade,
      diasParada: Math.max(0, diasEntre(p.updatedAt, `${hoje} 15:00:00`)),
      idadeDias: Math.max(0, diasEntre(p.createdAt, `${hoje} 15:00:00`)),
      dataRetorno: p.dataRetorno?.slice(0, 10) ?? null,
      retornoVencido: !!p.dataRetorno && p.dataRetorno.slice(0, 10) < hoje,
    }))
    .sort((a, b) => Number(b.retornoVencido) - Number(a.retornoVencido) || b.diasParada - a.diasParada)

  return {
    totais: {
      criadas: doPeriodo.length,
      ganhas: ganhas.length,
      perdidas: perdidas.length,
      emAberto: doPeriodo.length - ganhas.length - perdidas.length,
      taxaGanho: pct(ganhas.length, ganhas.length + perdidas.length),
      diasMedioAteFechar: diasAteFechar.length ? Math.round((diasAteFechar.reduce((a, b) => a + b, 0) / diasAteFechar.length) * 10) / 10 : null,
      abertasAgora: abertas.length,
      paradas15: paradas.filter((p) => p.diasParada > 15).length,
      retornosVencidos: paradas.filter((p) => p.retornoVencido).length,
    },
    motivos: [...motivos.values()].sort((a, b) => b.qtd - a.qtd),
    porVendedor,
    paradas: paradas.slice(0, 60),
  }
}

// ── 3. Máquinas por modelo ───────────────────────────────────────────────
function modeloBase(m: string | null | undefined) {
  return m?.trim() ? m.trim().toUpperCase() : 'Sem modelo'
}

export async function maquinasPorModelo(empresaId: number, f: FiltroOdin) {
  const { utc, dia } = janelas(f)
  const hoje = hojeBrString()
  const nomes = await nomesUsuarios(empresaId)

  // Vendidas = máquina ligada a pedido não cancelado criado no período.
  const vendidas = await db
    .select({ modelo: estoqueMaquinas.modelo, vendedorId: ordens.vendedorId, estadoEntrega: ordens.enderecoEntregaEstado, estadoCliente: clientes.estado })
    .from(estoqueMaquinas)
    .innerJoin(ordens, eq(ordens.id, estoqueMaquinas.ordemId))
    .leftJoin(clientes, eq(clientes.id, ordens.clienteId))
    .where(
      and(
        eq(estoqueMaquinas.empresaId, empresaId),
        ne(ordens.status, 'cancelado'),
        f.vendedorId ? eq(ordens.vendedorId, f.vendedorId) : undefined,
        utc[0] ? gte(ordens.createdAt, utc[0]) : undefined,
        utc[1] ? lt(ordens.createdAt, utc[1]) : undefined,
      ),
    )

  // Procura = modelos pedidos em propostas do período (produtosItens JSON).
  const props = await db.query.propostas.findMany({
    where: and(
      eq(propostas.empresaId, empresaId),
      f.vendedorId ? eq(propostas.vendedorId, f.vendedorId) : undefined,
      utc[0] ? gte(propostas.createdAt, utc[0]) : undefined,
      utc[1] ? lt(propostas.createdAt, utc[1]) : undefined,
    ),
    columns: { produtosItens: true, stage: true },
  })
  const procura = new Map<string, { propostas: number; perdidas: number }>()
  for (const p of props) {
    let itens: { modelo?: string; qtd?: number }[] = []
    try {
      itens = p.produtosItens ? JSON.parse(p.produtosItens) : []
    } catch {
      itens = []
    }
    for (const it of Array.isArray(itens) ? itens : []) {
      const m = modeloBase(it.modelo)
      const g = procura.get(m) ?? procura.set(m, { propostas: 0, perdidas: 0 }).get(m)!
      g.propostas += Number(it.qtd) > 0 ? Number(it.qtd) : 1
      if (p.stage === 'perdido') g.perdidas += Number(it.qtd) > 0 ? Number(it.qtd) : 1
    }
  }

  const estoque = await db.query.estoqueMaquinas.findMany({
    where: and(eq(estoqueMaquinas.empresaId, empresaId), eq(estoqueMaquinas.status, 'estoque')),
    columns: { modelo: true, dataEntrada: true, createdAt: true },
  })

  const modelos = new Set<string>([...vendidas.map((v) => modeloBase(v.modelo)), ...procura.keys(), ...estoque.map((e) => modeloBase(e.modelo))])
  const porModelo = [...modelos]
    .map((m) => {
      const v = vendidas.filter((x) => modeloBase(x.modelo) === m)
      const e = estoque.filter((x) => modeloBase(x.modelo) === m)
      const idades = e.map((x) => diasEntre((x.dataEntrada ?? x.createdAt).slice(0, 10), hoje)).filter((d) => d >= 0)
      const vendPorVend = new Map<string, number>()
      for (const x of v) vendPorVend.set(nomes.get(x.vendedorId ?? -1) ?? '—', (vendPorVend.get(nomes.get(x.vendedorId ?? -1) ?? '—') ?? 0) + 1)
      const estados = new Map<string, number>()
      for (const x of v) {
        const uf = (x.estadoEntrega || x.estadoCliente || '').trim().toUpperCase().slice(0, 2) || '—'
        estados.set(uf, (estados.get(uf) ?? 0) + 1)
      }
      return {
        modelo: m,
        vendidas: v.length,
        procuraPropostas: procura.get(m)?.propostas ?? 0,
        perdidasPropostas: procura.get(m)?.perdidas ?? 0,
        emEstoque: e.length,
        estoqueParado90: idades.filter((d) => d > 90).length,
        idadeMaxEstoque: idades.length ? Math.max(...idades) : null,
        topVendedores: [...vendPorVend.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nome, qtd]) => ({ nome, qtd })),
        topEstados: [...estados.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([uf, qtd]) => ({ uf, qtd })),
      }
    })
    .sort((a, b) => b.vendidas - a.vendidas || b.procuraPropostas - a.procuraPropostas || b.emEstoque - a.emEstoque)

  // Demonstrações que saíram no período.
  const demos = await db
    .select({ produto: demonstracaoItens.produto, status: demonstracaoItens.status, retornoPrevisto: demonstracaoItens.retornoPrevistoEm, vendedorId: demonstracoes.vendedorId, cliente: demonstracoes.clienteNome, dataSaida: demonstracoes.dataSaida })
    .from(demonstracaoItens)
    .innerJoin(demonstracoes, eq(demonstracoes.id, demonstracaoItens.demonstracaoId))
    .where(
      and(
        eq(demonstracoes.empresaId, empresaId),
        f.vendedorId ? eq(demonstracoes.vendedorId, f.vendedorId) : undefined,
        dia[0] ? gte(demonstracoes.dataSaida, dia[0]) : undefined,
        dia[1] ? lt(demonstracoes.dataSaida, dia[1]) : undefined,
      ),
    )
  const vendidasDemo = demos.filter((d) => d.status === 'vendido' || d.status === 'aguardando_nf').length
  const atrasadas = demos
    .filter((d) => d.status === 'em_demonstracao' && d.retornoPrevisto && d.retornoPrevisto.slice(0, 10) < hoje)
    .map((d) => ({ produto: d.produto, cliente: d.cliente, vendedor: nomes.get(d.vendedorId ?? -1) ?? '—', retornoPrevisto: d.retornoPrevisto!.slice(0, 10), diasAtraso: diasEntre(d.retornoPrevisto!.slice(0, 10), hoje) }))
    .sort((a, b) => b.diasAtraso - a.diasAtraso)

  return {
    totais: {
      vendidas: vendidas.length,
      modelosVendidos: new Set(vendidas.map((v) => modeloBase(v.modelo))).size,
      procuraPropostas: [...procura.values()].reduce((a, g) => a + g.propostas, 0),
      emEstoque: estoque.length,
      estoqueParado90: porModelo.reduce((a, m) => a + m.estoqueParado90, 0),
      demonstracoes: demos.length,
      demonstracoesVendidas: vendidasDemo,
      conversaoDemonstracao: pct(vendidasDemo, demos.length),
      demonstracoesAtrasadas: atrasadas.length,
    },
    porModelo,
    demonstracoesAtrasadas: atrasadas.slice(0, 30),
  }
}

// ── 4. Peças: recompra da carteira ───────────────────────────────────────
// Base: vendas do Kanban (peças) por cliente, desde sempre. Classifica cada
// cliente pelo tempo desde a última compra e pelo intervalo de costume dele
// ("deveria ter comprado" = já passou do intervalo médio entre compras).
// E quem comprou MÁQUINA e nunca comprou peça (oportunidade de pós-venda).
export async function pecasRecompra(empresaId: number, f: FiltroOdin) {
  const hoje = hojeBrString()
  const nomes = await nomesUsuarios(empresaId)
  const carteira = await db.query.clientes.findMany({
    where: and(eq(clientes.empresaId, empresaId), isNull(clientes.deletedAt), f.vendedorId ? eq(clientes.vendedorAtualId, f.vendedorId) : undefined),
    columns: { id: true, razaoSocial: true, cidade: true, estado: true, vendedorAtualId: true, telefoneWhatsapp: true },
  })
  const porId = new Map(carteira.map((c) => [c.id, c]))
  const ids = carteira.map((c) => c.id)
  const compras = ids.length
    ? await db.query.vendas.findMany({
        where: and(inArray(vendas.clienteId, ids), isNull(vendas.deletedAt)),
        columns: { clienteId: true, dataFechamento: true, valorFechado: true },
      })
    : []
  const maquinas = ids.length
    ? await db.query.ordens.findMany({
        where: and(eq(ordens.empresaId, empresaId), eq(ordens.orderType, 'maquina'), ne(ordens.status, 'cancelado'), inArray(ordens.clienteId, ids)),
        columns: { clienteId: true, createdAt: true },
      })
    : []
  const pecasOrdem = ids.length
    ? await db.query.ordens.findMany({
        where: and(eq(ordens.empresaId, empresaId), eq(ordens.orderType, 'peca'), ne(ordens.status, 'cancelado'), inArray(ordens.clienteId, ids)),
        columns: { clienteId: true },
      })
    : []

  const porCliente = new Map<number, string[]>()
  const valorPor = new Map<number, number>()
  for (const c of compras) {
    ;(porCliente.get(c.clienteId) ?? porCliente.set(c.clienteId, []).get(c.clienteId)!).push(c.dataFechamento.slice(0, 10))
    valorPor.set(c.clienteId, (valorPor.get(c.clienteId) ?? 0) + c.valorFechado)
  }

  const linhas = [...porCliente.entries()].map(([clienteId, datas]) => {
    const unicas = [...new Set(datas)].sort()
    const ultima = unicas[unicas.length - 1]
    const intervalos = unicas.slice(1).map((d, i) => diasEntre(unicas[i], d))
    const intervaloMedio = intervalos.length ? Math.round(intervalos.reduce((a, b) => a + b, 0) / intervalos.length) : null
    const diasSemComprar = diasEntre(ultima, hoje)
    const c = porId.get(clienteId)!
    return {
      clienteId,
      cliente: c.razaoSocial,
      cidade: [c.cidade, c.estado].filter(Boolean).join('/') || '—',
      vendedor: nomes.get(c.vendedorAtualId ?? -1) ?? 'Sem vendedor',
      compras: datas.length,
      valorTotal: valorPor.get(clienteId) ?? 0,
      primeira: unicas[0],
      ultima,
      intervaloMedio,
      diasSemComprar,
      status: diasSemComprar <= 60 ? ('ativo' as const) : diasSemComprar <= 120 ? ('esfriando' as const) : ('parado' as const),
      atrasadoNoCostume: intervaloMedio != null && diasSemComprar > intervaloMedio * 1.5 && diasSemComprar > 30,
    }
  })

  const compraramPeca = new Set([...porCliente.keys(), ...pecasOrdem.map((o) => o.clienteId).filter((x): x is number => x != null)])
  const maquinaPor = new Map<number, string>()
  for (const m of maquinas) if (m.clienteId != null && m.createdAt > (maquinaPor.get(m.clienteId) ?? '')) maquinaPor.set(m.clienteId, m.createdAt)
  const maquinaSemPeca = [...maquinaPor.entries()]
    .filter(([id]) => !compraramPeca.has(id))
    .map(([id, quando]) => {
      const c = porId.get(id)!
      return { clienteId: id, cliente: c.razaoSocial, cidade: [c.cidade, c.estado].filter(Boolean).join('/') || '—', vendedor: nomes.get(c.vendedorAtualId ?? -1) ?? 'Sem vendedor', compraMaquina: quando.slice(0, 10), diasDesde: diasEntre(quando.slice(0, 10), hoje) }
    })
    .sort((a, b) => b.diasDesde - a.diasDesde)

  const contar = (s: string) => linhas.filter((l) => l.status === s).length
  const vendIds = [...new Set(carteira.map((c) => c.vendedorAtualId))]
  const porVendedor = vendIds
    .map((id) => {
      const dele = linhas.filter((l) => porId.get(l.clienteId)?.vendedorAtualId === id)
      return {
        nome: nomes.get(id ?? -1) ?? 'Sem vendedor',
        compradores: dele.length,
        ativos: dele.filter((l) => l.status === 'ativo').length,
        esfriando: dele.filter((l) => l.status === 'esfriando').length,
        parados: dele.filter((l) => l.status === 'parado').length,
        atrasadosNoCostume: dele.filter((l) => l.atrasadoNoCostume).length,
      }
    })
    .filter((v) => v.compradores > 0)
    .sort((a, b) => b.compradores - a.compradores)

  return {
    totais: {
      carteira: carteira.length,
      compradores: linhas.length,
      ativos: contar('ativo'),
      esfriando: contar('esfriando'),
      parados: contar('parado'),
      atrasadosNoCostume: linhas.filter((l) => l.atrasadoNoCostume).length,
      maquinaSemPeca: maquinaSemPeca.length,
    },
    porVendedor,
    // Pra ligar primeiro: quem passou do costume, depois parados com mais compras.
    paraLigar: linhas
      .filter((l) => l.status !== 'ativo' || l.atrasadoNoCostume)
      .sort((a, b) => Number(b.atrasadoNoCostume) - Number(a.atrasadoNoCostume) || b.compras - a.compras || b.valorTotal - a.valorTotal)
      .slice(0, 80),
    maquinaSemPeca: maquinaSemPeca.slice(0, 60),
  }
}
