import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, expedicaoColaboradores, expedicaoErros, expedicaoPedidos, permissoesAdmin, users } from '../db/schema.js'

// "Falar com a expedição" no chat (pedido do João, 2026-11-05): uma conversa
// por PEDIDO do SAP (idOrigem = DocEntry do pedido de venda), que continua a
// mesma se o picking for refeito — por isso não usa o id do card, que muda
// quando o pedido é descartado e recriado.
type Usuario = { id: number; role: 'admin' | 'vendor' | 'gestor'; superAdmin?: boolean | null }

export async function cardsDoPedidoSap(entry: number) {
  return db
    .select()
    .from(expedicaoPedidos)
    .where(sql`',' || ${expedicaoPedidos.orderEntriesSap} || ',' like ${`%,${entry},%`}`)
    .orderBy(expedicaoPedidos.id)
}

type Card = Awaited<ReturnType<typeof cardsDoPedidoSap>>[number]

// O vendedor pode ter o cliente em outra empresa do grupo: o código do SAP é
// o mesmo entre elas (mesma regra da jornada do pedido na ficha do cliente).
async function clientesDosCards(cards: Card[]) {
  const codigos = [...new Set(cards.map((c) => c.clienteCodigo).filter((c): c is string => !!c))]
  if (!codigos.length) return []
  return db
    .select({ empresaId: clientes.empresaId, vendedorAtualId: clientes.vendedorAtualId })
    .from(clientes)
    .where(and(isNull(clientes.deletedAt), or(inArray(clientes.codigo, codigos), inArray(clientes.codigoAntigo, codigos))))
}

// Quem pode perguntar: o vendedor dono do cliente, gestores/admins (inclui as
// contas do estoque). Outro vendedor não abre conversa de pedido que não é dele.
export async function podeConversarSobrePedido(user: Usuario, cards: Card[]): Promise<boolean> {
  if (user.superAdmin || user.role !== 'vendor') return true
  return (await clientesDosCards(cards)).some((c) => c.vendedorAtualId === user.id)
}

export async function vendedorDonoDoPedido(cards: Card[]): Promise<{ id: number; nome: string } | null> {
  const lista = await clientesDosCards(cards)
  const dono = lista.find((c) => c.empresaId === cards[0]?.empresaId && c.vendedorAtualId) ?? lista.find((c) => c.vendedorAtualId)
  if (!dono?.vendedorAtualId) return null
  const u = await db.query.users.findFirst({ where: eq(users.id, dono.vendedorAtualId), columns: { id: true, name: true } })
  return u ? { id: u.id, nome: u.name } : null
}

// As contas que o estoque usa: login da empresa com a permissão da Expedição.
export async function contasDoEstoque(empresaId: number): Promise<number[]> {
  const linhas = await db
    .select({ id: users.id })
    .from(permissoesAdmin)
    .innerJoin(users, eq(users.id, permissoesAdmin.userId))
    .where(and(eq(permissoesAdmin.feature, 'controle_estoque'), eq(users.isActive, true), eq(users.empresaId, empresaId)))
  return linhas.map((l) => l.id)
}

const ORDEM = ['separacao', 'conferencia', 'embalagem', 'nf', 'agendamento', 'coleta', 'coletado']
type EstadoPasso = 'feito' | 'agora' | 'futuro'

// O processo como está AGORA — a janela do chat consulta de novo de tempos em
// tempos, então quem responde depois já vê a etapa atual.
export async function processoDoPedido(entry: number) {
  const todos = await cardsDoPedidoSap(entry)
  if (!todos.length) return null
  const ativos = todos.filter((c) => c.etapa !== 'cancelado' && c.etapa !== 'descartado')
  const cards = ativos.length ? ativos : todos.slice(-1)
  const ids = cards.map((c) => c.id)
  const [pessoas, erros, emp] = await Promise.all([
    db.select({ id: expedicaoColaboradores.id, nome: expedicaoColaboradores.nome }).from(expedicaoColaboradores),
    db.select().from(expedicaoErros).where(inArray(expedicaoErros.expedicaoId, ids)).orderBy(expedicaoErros.id),
    db.select({ id: empresas.id, nome: empresas.nome }).from(empresas),
  ])
  const nome = (id: number | null) => (id ? pessoas.find((p) => p.id === id)?.nome ?? null : null)
  const agora = Date.now()

  return cards.map((c) => {
    const encerrado = c.etapa === 'cancelado' || c.etapa === 'descartado'
    const atual = encerrado ? -1 : ORDEM.indexOf(c.etapa)
    const errosDoCard = erros.filter((e) => e.expedicaoId === c.id)
    const estado = (etapa: string, concluidoEncerrado: boolean): EstadoPasso => {
      if (encerrado) return concluidoEncerrado ? 'feito' : 'futuro'
      const i = ORDEM.indexOf(etapa)
      if (c.etapa === 'coletado' || i < atual) return 'feito'
      return i === atual ? 'agora' : 'futuro'
    }
    const nErros = (etapa: string) => errosDoCard.filter((e) => e.etapa === etapa).length
    const prazoMs = Date.parse(`${c.inicioPrazo.replace(' ', 'T')}Z`) + 48 * 3600_000
    return {
      id: c.id,
      pedido: c.pedidosSap,
      picking: c.pickListSap,
      cliente: c.clienteNome,
      empresa: emp.find((e) => e.id === c.empresaId)?.nome ?? null,
      etapa: c.etapa,
      atrasado: !encerrado && c.etapa !== 'coletado' && agora > prazoMs,
      passos: [
        { chave: 'separacao', nome: 'Separação', estado: estado('separacao', !!c.separacaoFim), quem: nome(c.separacaoColaboradorId), inicio: c.separacaoInicio, fim: c.separacaoFim, info: null as string | null, erros: 0 },
        { chave: 'conferencia', nome: 'Conferência', estado: estado('conferencia', !!c.conferenciaFim), quem: nome(c.conferenciaColaboradorId), inicio: c.conferenciaInicio, fim: c.conferenciaFim, info: null as string | null, erros: nErros('conferencia') },
        { chave: 'embalagem', nome: 'Embalagem', estado: estado('embalagem', !!c.embalagemFim), quem: nome(c.embalagemColaboradorId), inicio: c.embalagemInicio, fim: c.embalagemFim, info: null as string | null, erros: nErros('embalagem') },
        { chave: 'nf', nome: 'NF', estado: estado('nf', !!c.nfNumero), quem: null, inicio: null, fim: null, info: c.nfNumero ? `NF ${c.nfNumero}` : null, erros: 0 },
        { chave: 'agendamento', nome: 'Agendamento', estado: estado('agendamento', !!c.agendadoEm), quem: null, inicio: null, fim: null, info: c.coletaAgendada, erros: 0 },
        { chave: 'coleta', nome: 'Coleta', estado: estado('coleta', !!c.coletadoEm), quem: nome(c.coletadoColaboradorId), inicio: null, fim: c.coletadoEm, info: null as string | null, erros: nErros('expedicao') },
      ],
      volumes: c.volumes ?? c.volumesSap,
      transportadora: c.transportadora ?? c.transportadoraSap,
      pausa: c.pausadoEm ? { em: c.pausadoEm, motivo: c.pausaMotivo } : null,
      alteracaoSap: c.alteradoSapEm ? c.alteracaoSap : null,
      encerrado: encerrado ? { tipo: c.etapa, motivo: c.motivoDescarte } : null,
      erros: errosDoCard.map((e) => ({ id: e.id, tipo: e.tipo, descricao: e.descricao, quantidade: e.quantidade, observacao: e.observacao })),
    }
  })
}
