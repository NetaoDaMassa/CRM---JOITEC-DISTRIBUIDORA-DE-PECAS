// Controle de serviços (Compretec Loja Física, João 2026-11-27) — substitui a
// planilha "Controle de serviços". Regras:
//   - montando orçamento: resposta ao cliente em no máximo 1 dia útil (vira
//     compromisso na agenda do vendedor no horário do prazo);
//   - aguardando cliente: obrigatório marcar a data do próximo contato (vira
//     ligação na agenda);
//   - não aprovou: obrigatório o motivo;
//   - finalizado: o serviço vira venda no card do cliente na carteira, em
//     Fechado — o pós-venda segue dali.
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  caixaMovimentacoes,
  carteiraHistorico,
  clientes,
  compromissos,
  funilMensal,
  itensPedido,
  leadHistory,
  leads,
  servicoEventos,
  servicos,
  vendas,
} from '../db/schema.js'
import { agoraSqlite, dataFechamentoDoCard, ehDiaNaoUtil, hojeBrString, mesReferenciaAtual } from './dataBr.js'
import { registrarAuditoria } from './auditoria.js'
import { avisarVendedorPix } from './adiantamentoPix.js'
import { enviarProspectParaCarteira } from './prospeccaoNova.js'
import { travarDuplicado } from './clienteDuplicado.js'
import { cnpjValido, limparCnpj } from './cnpj.js'
import { cpfValido, limparCpf } from './cpf.js'

// Empresas com a tela de Serviços (João: "talvez depois disponibilizar para outras").
export const SLUGS_SERVICOS = ['compretec-loja-fisica']

export type StatusServico = (typeof servicos.$inferSelect)['status']
export type Servico = typeof servicos.$inferSelect

export const STATUS_LABEL: Record<StatusServico, string> = {
  montando_orcamento: 'Montando orçamento',
  aguardando_cliente: 'Aguardando cliente',
  em_andamento: 'Em andamento',
  finalizado: 'Finalizado',
  nao_aprovou: 'Não aprovou',
}

export const MOTIVOS_NAO_APROVOU = ['preco', 'fechou_outro', 'desistiu', 'sem_retorno', 'adiou', 'outro'] as const

const TZ_OFFSET_MS = 3 * 60 * 60 * 1000
const DIA_MS = 24 * 60 * 60 * 1000

/** Prazo do orçamento: o mesmo horário do próximo dia útil (pula fim de semana e feriado). */
export function prazoUmDiaUtil(agora: Date = new Date()): string {
  let br = agora.getTime() - TZ_OFFSET_MS
  do br += DIA_MS
  while (ehDiaNaoUtil(new Date(br)))
  return new Date(br + TZ_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 19)
}

export function tiposDoServico(s: Pick<Servico, 'manutencao' | 'redeAr' | 'instalacao'>): string[] {
  const t: string[] = []
  if (s.manutencao) t.push('Manutenção')
  if (s.redeAr) t.push('Rede de ar')
  if (s.instalacao) t.push('Instalação')
  return t
}

export const valorTotal = (s: Pick<Servico, 'valorMaoObra' | 'valorMaterial'>) => (s.valorMaoObra ?? 0) + (s.valorMaterial ?? 0)

export async function registrarEvento(
  servicoId: number,
  userId: number | null,
  tipo: 'criado' | 'status' | 'contato' | 'visita' | 'edicao' | 'nota',
  extra: { statusDe?: string | null; statusPara?: string | null; texto?: string | null } = {}
) {
  await db.insert(servicoEventos).values({ servicoId, userId, tipo, statusDe: extra.statusDe ?? null, statusPara: extra.statusPara ?? null, texto: extra.texto ?? null })
}

/**
 * Um compromisso por serviço, conforme a situação:
 *   - montando orçamento → "Responder orçamento" no horário do prazo;
 *   - aguardando cliente → ligação no dia do próximo contato (9h);
 *   - outras → o compromisso aberto é dado como feito.
 */
export async function sincronizarAgenda(s: Servico): Promise<void> {
  const atual = s.compromissoId ? await db.query.compromissos.findFirst({ where: eq(compromissos.id, s.compromissoId) }) : null
  const aberto = atual && !atual.concluido && !atual.deletedAt ? atual : null
  const tipos = tiposDoServico(s).join(' + ').toLowerCase() || 'serviço'

  let quer: { tipo: 'ligacao' | 'outro'; titulo: string; descricao: string; dataHora: string } | null = null
  if (s.vendedorId && s.status === 'montando_orcamento' && s.prazoOrcamento) {
    quer = {
      tipo: 'outro',
      titulo: `Responder orçamento: ${s.clienteNome}`.slice(0, 200),
      descricao: `Orçamento de ${tipos}${s.compressor ? ` (${s.compressor})` : ''} — o cliente precisa ter a resposta até este horário. Atualize em Serviços.`,
      dataHora: s.prazoOrcamento,
    }
  } else if (s.vendedorId && s.status === 'aguardando_cliente' && s.proximoContato) {
    quer = {
      tipo: 'ligacao',
      titulo: `Serviço: retornar ${s.clienteNome}`.slice(0, 200),
      descricao: `Aguardando o cliente sobre ${tipos}${s.compressor ? ` (${s.compressor})` : ''}. Registre o contato em Serviços.`,
      // 9h de Brasília = 12h UTC (compromissos.dataHora é UTC).
      dataHora: `${s.proximoContato} 12:00:00`,
    }
  }

  if (aberto && (!quer || aberto.tipo !== quer.tipo)) {
    await db.update(compromissos).set({ concluido: true, updatedAt: agoraSqlite() }).where(eq(compromissos.id, aberto.id))
  }
  if (!quer) {
    if (s.compromissoId) await db.update(servicos).set({ compromissoId: null }).where(eq(servicos.id, s.id))
    return
  }
  if (aberto && aberto.tipo === quer.tipo) {
    if (aberto.dataHora !== quer.dataHora || aberto.vendedorId !== s.vendedorId || aberto.titulo !== quer.titulo) {
      await db
        .update(compromissos)
        .set({ dataHora: quer.dataHora, vendedorId: s.vendedorId!, titulo: quer.titulo, descricao: quer.descricao, notificado: false, updatedAt: agoraSqlite() })
        .where(eq(compromissos.id, aberto.id))
    }
    return
  }
  const [novo] = await db
    .insert(compromissos)
    .values({ vendedorId: s.vendedorId!, clienteId: s.clienteId, tipo: quer.tipo, titulo: quer.titulo, descricao: quer.descricao, dataHora: quer.dataHora })
    .returning({ id: compromissos.id })
  await db.update(servicos).set({ compromissoId: novo.id }).where(eq(servicos.id, s.id))
}

export type NovoCliente = { razaoSocial: string; cpf?: string; cnpj?: string; cidade?: string }

/**
 * Serviço que veio de lead (ou avulso) precisa de cadastro pra virar venda:
 * cria o cliente (mesmas travas do "Lead ganho → Carteira") e marca o lead
 * como Ganho, ligado ao cliente novo.
 */
export async function criarClienteDoServico(s: Servico, dados: NovoCliente, userId: number, podeForcar: boolean): Promise<number> {
  const razao = dados.razaoSocial.trim()
  if (razao.length < 2) throw new Error('Informe o nome / razão social do cliente')
  let cnpj: string | undefined
  let cpf: string | undefined
  if (dados.cnpj?.trim()) {
    if (!cnpjValido(dados.cnpj)) throw new Error('CNPJ inválido')
    cnpj = limparCnpj(dados.cnpj)
  }
  if (dados.cpf?.trim()) {
    if (!cpfValido(dados.cpf)) throw new Error('CPF inválido')
    cpf = limparCpf(dados.cpf)
  }
  if (!cnpj && !cpf) throw new Error('Informe o CPF ou o CNPJ do cliente (o serviço sai com nota)')
  const lead = s.leadId ? await db.query.leads.findFirst({ where: eq(leads.id, s.leadId) }) : null
  const telefone = (s.telefone || (lead ? `${lead.ddd ?? ''}${lead.phone ?? ''}` : '')).replace(/\D/g, '')
  await travarDuplicado(s.empresaId, { doc: cnpj || cpf, nomes: [razao], telefones: telefone ? [telefone] : [], podeForcar })
  const vendedorId = s.vendedorId ?? userId
  const r = await db.insert(clientes).values({
    empresaId: s.empresaId,
    razaoSocial: razao,
    cnpj,
    cpf,
    codigo: `S${Date.now()}`,
    regiao: 'sul',
    estado: 'SC',
    cidade: dados.cidade?.trim() || lead?.city || undefined,
    telefoneWhatsapp: telefone || undefined,
    email: lead?.email || undefined,
    nomeContato: lead?.name || s.clienteNome,
    cadastradoPor: userId,
    vendedorAtualId: vendedorId,
    origemMarketing: s.origem === 'marketing',
    origemMarketingTipo: s.origem === 'marketing' ? (/^(ecommerce|site|loja)/.test(lead?.source || '') ? 'site' : 'padrao') : undefined,
  })
  const clienteId = Number(r.lastInsertRowid)
  await db.insert(carteiraHistorico).values({ clienteId, vendedorId })
  if (lead && !lead.convertidoParaClienteId) {
    await db.update(leads).set({ convertidoParaClienteId: clienteId }).where(eq(leads.id, lead.id))
    await db.insert(leadHistory).values({
      empresaId: s.empresaId,
      leadId: lead.id,
      userId,
      action: 'transferido_carteira',
      details: `Virou cliente "${razao}" pelo serviço finalizado (Serviços #${s.id})`,
    })
  }
  return clienteId
}

const FORMA_LEAD: Record<string, 'avista' | 'boleto' | 'cartao_credito'> = {
  Dinheiro: 'avista',
  Pix: 'avista',
  'Cartão Crédito': 'cartao_credito',
  'Cartão Débito': 'avista',
  Boleto: 'boleto',
}

/**
 * Finalizado → venda no card do cliente na carteira, etapa Fechado (ou soma
 * mais uma venda se o card do mês já está Fechado/Faturamento).
 */
export async function enviarServicoParaCarteira(
  s: Servico,
  dados: { condicaoPagamento: string; numeroPedido: string },
  userId: number,
  empresaSlug: string
): Promise<{ funilMensalId: number; vendaId: number }> {
  if (!s.clienteId) throw new Error('O serviço precisa de um cliente cadastrado para ir à carteira')
  const total = valorTotal(s)
  if (!(total > 0)) throw new Error('Informe o valor do serviço (mão de obra e/ou material) antes de finalizar')

  let cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, s.clienteId) })
  if (!cliente || cliente.deletedAt) throw new Error('Cliente não encontrado')
  if (/consumidor final/i.test(cliente.razaoSocial)) throw new Error('Serviço não pode ir para o CONSUMIDOR FINAL — escolha ou cadastre o cliente de verdade')
  if (!cliente.vendedorAtualId) {
    await db.update(clientes).set({ vendedorAtualId: s.vendedorId ?? userId, updatedAt: agoraSqlite() }).where(eq(clientes.id, cliente.id))
    await db.insert(carteiraHistorico).values({ clienteId: cliente.id, vendedorId: s.vendedorId ?? userId })
  }
  if (cliente.emProspeccao) await enviarProspectParaCarteira(cliente.id, userId, 'serviço finalizado')
  cliente = (await db.query.clientes.findFirst({ where: eq(clientes.id, s.clienteId) }))!
  const donoCard = cliente.vendedorAtualId ?? s.vendedorId ?? userId
  const vendedorVenda = s.vendedorId ?? donoCard

  const mes = mesReferenciaAtual()
  let card = await db.query.funilMensal.findFirst({
    where: and(eq(funilMensal.clienteId, cliente.id), eq(funilMensal.mesReferencia, mes), isNull(funilMensal.deletedAt)),
  })
  if (!card) {
    const r = await db.insert(funilMensal).values({ clienteId: cliente.id, vendedorId: donoCard, mesReferencia: mes }).returning()
    card = r[0]
  }
  if (card.etapa !== 'fechado' && card.etapa !== 'faturamento') {
    await db
      .update(funilMensal)
      .set({ etapa: 'fechado', dataEntradaEtapa: agoraSqlite(), updatedAt: agoraSqlite(), versao: card.versao + 1 })
      .where(eq(funilMensal.id, card.id))
    await registrarAuditoria({ tabela: 'funil_mensal', registroId: card.id, acao: 'mudar_etapa', campo: 'etapa', valorAnterior: card.etapa, valorNovo: 'fechado', alteradoPor: userId })
  }

  const dataFechamento = dataFechamentoDoCard(card.mesReferencia)
  await db
    .update(clientes)
    .set({ dataUltimaCompra: sql`max(coalesce(${clientes.dataUltimaCompra}, ''), ${dataFechamento})` })
    .where(eq(clientes.id, cliente.id))

  const tipos = tiposDoServico(s).join(' + ') || 'Serviço'
  const [venda] = await db
    .insert(vendas)
    .values({
      funilMensalId: card.id,
      clienteId: cliente.id,
      vendedorId: vendedorVenda,
      mesReferencia: card.mesReferencia,
      valorFechado: total,
      condicaoPagamento: dados.condicaoPagamento,
      numeroPedido: dados.numeroPedido,
      dataFechamento,
      origemMarketing: s.origem === 'marketing',
      origemMarketingTipo: s.origem === 'marketing' ? 'padrao' : null,
    })
    .returning({ id: vendas.id })
  const itens = [
    { descricao: `Serviço — ${tipos}${s.compressor ? ` (${s.compressor})` : ''} — mão de obra`, valor: s.valorMaoObra ?? 0 },
    { descricao: `Serviço — ${tipos} — material`, valor: s.valorMaterial ?? 0 },
  ].filter((i) => i.valor > 0)
  if (itens.length) {
    await db.insert(itensPedido).values(itens.map((i) => ({ vendaId: venda.id, clienteId: cliente!.id, descricao: i.descricao, quantidade: 1, valorUnitario: i.valor, valorTotal: i.valor })))
  }
  if (empresaSlug === 'compretec-loja-fisica' && dados.condicaoPagamento === 'Dinheiro') {
    await db.insert(caixaMovimentacoes).values({
      empresaId: s.empresaId,
      tipo: 'entrada',
      valor: total,
      data: hojeBrString(),
      descricao: `Serviço finalizado — ${cliente.razaoSocial}`,
      origemVendaId: venda.id,
      criadoPor: userId,
    })
  }
  void avisarVendedorPix(venda.id)
  await registrarAuditoria({ tabela: 'vendas', registroId: venda.id, acao: 'criar', alteradoPor: userId })

  // Serviço que veio de lead: o lead vai pra Ganho junto.
  if (s.leadId) {
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, s.leadId) })
    if (lead && lead.status !== 'ganho') {
      await db
        .update(leads)
        .set({
          status: 'ganho',
          statusChangedAt: agoraSqlite(),
          finalOrderValue: total,
          paymentMethod: FORMA_LEAD[dados.condicaoPagamento] ?? 'avista',
          convertidoParaClienteId: lead.convertidoParaClienteId ?? cliente.id,
        })
        .where(eq(leads.id, lead.id))
      await db.insert(leadHistory).values({
        empresaId: s.empresaId,
        leadId: lead.id,
        userId,
        action: 'status_alterado',
        fromStatus: lead.status,
        toStatus: 'ganho',
        details: `Ganho: serviço finalizado (${tipos}) — R$ ${total.toFixed(2)}`,
      })
    }
  }
  return { funilMensalId: card.id, vendaId: venda.id }
}
