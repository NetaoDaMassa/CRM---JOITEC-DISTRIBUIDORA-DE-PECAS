// Pós-venda de máquina + Agendamentos de peças (Odin Compressores) — pedido
// do João, 2026-10-29. Fluxo:
//   Qualidade → Pós-venda (PDF de cuidados/preventiva/garantia + pesquisa de
//   satisfação) → respondida a pesquisa, o pedido vai sozinho pra Concluído
//   → Concluído abre um Agendamento de peças pro vendedor de peças (Bruna),
//   com NF, modelos/séries e revenda do pedido.
import { randomBytes } from 'node:crypto'
import { and, eq, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { agendamentosPecas, clientes, ordemDetalhes, ordemHistorico, ordemMaquinas, ordemPosVenda, ordens, posVendaPesquisas, revendas, users } from '../db/schema.js'
import { getConfigNumero } from './configuracoes.js'
import { agoraSqlite, hojeBrString } from './dataBr.js'
import { registrarAuditoria } from './auditoria.js'

export const chaveVendedorPecas = (empresaId: number) => `pos_venda_vendedor_pecas_${empresaId}`
export const chaveDiasPrimeiroContato = (empresaId: number) => `pos_venda_dias_primeiro_contato_${empresaId}`
export const DIAS_PRIMEIRO_CONTATO_PADRAO = 30

// Nota baixa (1-2), "não atendeu" ou pediu contato = precisa a equipe olhar.
export function respostaPedeAtencao(p: { notaOdin: number | null; notaTransportadora: number | null; notaTecnico: number | null; atendeu: string | null; querContato: boolean }): boolean {
  const baixa = [p.notaOdin, p.notaTransportadora, p.notaTecnico].some((n) => n != null && n <= 2)
  return baixa || p.atendeu === 'nao' || p.querContato
}

// Secador, trafo, reservatório, filtro e motocompressor não geram venda de
// peça nem preventiva (João, 2026-10-29): pedido só com esses itens não vai
// pra carteira da Bruna e só sai do Pós-venda quando alguém der o OK.
// 'indefinido' = pedido sem máquina registrada (a equipe escolhe).
const ACESSORIO = /secador|trafo|transformador|reservat[oó]rio|filtro|motocompressor|moto compressor/i
export type TipoPedidoMaquina = 'compressor' | 'acessorio' | 'indefinido'
export function tipoPorModelos(modelos: string[]): TipoPedidoMaquina {
  if (modelos.length === 0) return 'indefinido'
  return modelos.every((m) => ACESSORIO.test(m)) ? 'acessorio' : 'compressor'
}
export async function tipoPedidoMaquina(ordemId: number): Promise<TipoPedidoMaquina> {
  const maquinas = await db.query.ordemMaquinas.findMany({ where: eq(ordemMaquinas.ordemId, ordemId), columns: { modelo: true } })
  return tipoPorModelos(maquinas.map((m) => m.modelo))
}

// Quem recebe o agendamento: o vendedor escolhido em Config. Odin; sem
// escolha, a Bruna (pedido do João: "acredito que sempre irá para bruna");
// sem Bruna, o primeiro vendedor de peças ativo.
export async function vendedorPecasPadrao(empresaId: number): Promise<number | null> {
  const configurado = await getConfigNumero(chaveVendedorPecas(empresaId), 0)
  if (configurado) {
    const u = await db.query.users.findFirst({ where: and(eq(users.id, configurado), eq(users.empresaId, empresaId), eq(users.isActive, true)), columns: { id: true } })
    if (u) return u.id
  }
  const bruna = await db.query.users.findFirst({ where: and(eq(users.empresaId, empresaId), eq(users.isActive, true), like(users.name, 'bruna%')), columns: { id: true } })
  if (bruna) return bruna.id
  const pecas = await db.query.users.findFirst({ where: and(eq(users.empresaId, empresaId), eq(users.isActive, true), eq(users.canalVenda, 'pecas')), columns: { id: true } })
  return pecas?.id ?? null
}

function somarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

// Revenda do pedido desde o início do processo — pedido do João,
// 2026-10-29: o que veio da proposta/foi editado no pedido
// (ordemDetalhes.revenda) vale primeiro; depois a revenda do cadastro do
// cliente; por último a digitada no Pós-venda (pedidos antigos). Nome que
// não bate com nenhuma revenda cadastrada volta só como texto.
export async function revendaDaOrdem(ordemId: number): Promise<{ id: number | null; nome: string | null }> {
  const ordem = await db.query.ordens.findFirst({ where: eq(ordens.id, ordemId), columns: { empresaId: true, clienteId: true } })
  if (!ordem) return { id: null, nome: null }
  const [detalhes, cliente, posVenda, lista] = await Promise.all([
    db.query.ordemDetalhes.findFirst({ where: eq(ordemDetalhes.ordemId, ordemId), columns: { revenda: true } }),
    ordem.clienteId ? db.query.clientes.findFirst({ where: eq(clientes.id, ordem.clienteId), columns: { revendaId: true } }) : null,
    db.query.ordemPosVenda.findFirst({ where: eq(ordemPosVenda.ordemId, ordemId), columns: { nomeRevenda: true } }),
    db.query.revendas.findMany({ where: eq(revendas.empresaId, ordem.empresaId), columns: { id: true, nome: true } }),
  ])
  const porNome = (nome: string) => lista.find((r) => r.nome.trim().toLowerCase() === nome.trim().toLowerCase())
  if (detalhes?.revenda?.trim()) {
    const r = porNome(detalhes.revenda)
    return r ? { id: r.id, nome: r.nome } : { id: null, nome: detalhes.revenda.trim() }
  }
  const doCliente = cliente?.revendaId ? lista.find((r) => r.id === cliente.revendaId) : undefined
  if (doCliente) return { id: doCliente.id, nome: doCliente.nome }
  if (posVenda?.nomeRevenda?.trim()) {
    const r = porNome(posVenda.nomeRevenda)
    return r ? { id: r.id, nome: r.nome } : { id: null, nome: posVenda.nomeRevenda.trim() }
  }
  return { id: null, nome: null }
}

// Idempotente (ordem_id é único): voltar e avançar de novo pra Concluído
// não duplica. Só máquina.
// Venda de peça, 1ª preventiva e lembrete agora são preenchidos pela Bruna
// no próprio card do agendamento (João, 2026-10-29); se o pedido antigo já
// tinha esses dados no Pós-venda, eles descem junto.
export async function criarAgendamentoDaOrdem(ordemId: number, opts: { forcar?: boolean } = {}): Promise<number | null> {
  const ordem = await db.query.ordens.findFirst({ where: eq(ordens.id, ordemId) })
  if (!ordem || ordem.orderType !== 'maquina' || !ordem.clienteId) return null
  const existente = await db.query.agendamentosPecas.findFirst({ where: eq(agendamentosPecas.ordemId, ordemId), columns: { id: true } })
  if (existente) return existente.id
  if (!opts.forcar && (await tipoPedidoMaquina(ordemId)) === 'acessorio') return null
  const [revenda, posVenda, vendedorId, dias] = await Promise.all([
    revendaDaOrdem(ordemId),
    db.query.ordemPosVenda.findFirst({ where: eq(ordemPosVenda.ordemId, ordemId) }),
    vendedorPecasPadrao(ordem.empresaId),
    getConfigNumero(chaveDiasPrimeiroContato(ordem.empresaId), DIAS_PRIMEIRO_CONTATO_PADRAO),
  ])
  const revendaId = revenda.id
  const proximoContato = posVenda?.primeiraPreventiva || posVenda?.dataLembrete || somarDias(hojeBrString(), dias)
  const obs = [
    revendaId || !revenda.nome ? null : `Revenda informada no pedido: ${revenda.nome}`,
    posVenda?.dataLembrete ? `Lembrete do pós-venda (${posVenda.dataLembrete.split('-').reverse().join('/')}): ${posVenda.notaLembrete ?? ''}`.trim() : null,
  ].filter(Boolean).join('\n')
  const [novo] = await db
    .insert(agendamentosPecas)
    .values({ empresaId: ordem.empresaId, ordemId, clienteId: ordem.clienteId, vendedorId, revendaId, proximoContato, observacoes: obs || null })
    .onConflictDoNothing()
    .returning({ id: agendamentosPecas.id })
  if (novo) {
    await db.insert(ordemHistorico).values({ ordemId, userId: null, action: 'update', description: `Agendamento de peças criado (próximo contato ${proximoContato.split('-').reverse().join('/')})`, stage: 'concluido' })
  }
  return novo?.id ?? null
}

export async function obterOuCriarPesquisa(ordemId: number) {
  const existente = await db.query.posVendaPesquisas.findFirst({ where: eq(posVendaPesquisas.ordemId, ordemId) })
  if (existente) return existente
  const ordem = await db.query.ordens.findFirst({ where: eq(ordens.id, ordemId), with: { coleta: true, rastreio: true } })
  if (!ordem) throw new Error('Pedido não encontrado')
  await db
    .insert(posVendaPesquisas)
    .values({
      empresaId: ordem.empresaId,
      ordemId,
      clienteId: ordem.clienteId,
      token: randomBytes(12).toString('base64url'),
      transportadora: ordem.rastreio?.transportadora || ordem.coleta?.transportadora || null,
    })
    .onConflictDoNothing()
  return (await db.query.posVendaPesquisas.findFirst({ where: eq(posVendaPesquisas.ordemId, ordemId) }))!
}

// Pesquisa respondida → pedido de máquina que está em Pós-venda vai sozinho
// pra Concluído ("após a finalização do Pós-venda, o processo deverá ser
// direcionado automaticamente para Concluído"). Pedido em outra etapa
// (ex.: os antigos, ou alguém já moveu) fica onde está.
export async function concluirPedidoPelaPesquisa(ordemId: number, userId: number | null, via: 'cliente' | 'equipe'): Promise<boolean> {
  const ordem = await db.query.ordens.findFirst({ where: eq(ordens.id, ordemId) })
  if (!ordem || ordem.status !== 'ativo' || ordem.stage !== 'pos_venda') return false
  // Máquina: acessório (ou pedido sem máquina registrada) espera o OK da
  // equipe. Peça conclui direto (2026-10-29).
  if (ordem.orderType === 'maquina' && (await tipoPedidoMaquina(ordemId)) !== 'compressor') return false
  const upd = await db
    .update(ordens)
    .set({ stage: 'concluido', versao: ordem.versao + 1, updatedAt: agoraSqlite() })
    .where(and(eq(ordens.id, ordemId), eq(ordens.versao, ordem.versao)))
  if (upd.rowsAffected === 0) return false
  await db.insert(ordemHistorico).values({
    ordemId,
    userId,
    action: 'stage_change',
    fieldName: 'stage',
    oldValue: 'pos_venda',
    newValue: 'concluido',
    description: via === 'cliente' ? 'Cliente respondeu a pesquisa — pedido concluído automaticamente' : 'Pesquisa registrada pela equipe — pedido concluído automaticamente',
    stage: 'concluido',
  })
  await registrarAuditoria({ tabela: 'ordens', registroId: ordemId, acao: 'mudar_etapa', campo: 'stage', valorAnterior: 'pos_venda', valorNovo: 'concluido', alteradoPor: userId })
  await criarAgendamentoDaOrdem(ordemId)
  return true
}

// Documentos (PDF) que valem pra um pedido: os sem modelo + os cujo modelo
// aparece em alguma máquina do pedido.
export function documentoValeParaModelos(doc: { modelo: string | null }, modelos: string[]): boolean {
  const alvo = doc.modelo?.trim().toLowerCase()
  if (!alvo) return true
  return modelos.some((m) => m.toLowerCase().includes(alvo))
}
