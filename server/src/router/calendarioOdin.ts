// Calendário consolidado (Odin Compressores) — portado de pages/Calendar.tsx
// do odincrm.duckdns.org. Junta datas de vários módulos (Coleta, Faturamento,
// Financeiro, Preparação, Pós-Venda, Propostas "Chamar Depois", Visitas) num
// só calendário, cada tipo com sua cor — o "juntar tudo" que falta no resto
// do sistema, só que aqui. Só leitura — não introduz tabela nova.
import { z } from 'zod'
import { eq, and, gte, lte } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, ordens, propostas, visitas } from '../db/schema.js'

const SLUG = 'odin-compressores'

async function assertEmpresa(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
}

export type EventoTipo = 'coleta' | 'faturamento' | 'financeiro' | 'preparacao' | 'pos_venda' | 'proposta_chamar_depois' | 'visita' | 'visita_retorno'

const input = z.object({ dataDe: z.string(), dataAte: z.string(), vendedorId: z.number().optional() })

export const calendarioOdinRouter = router({
  eventos: adminOrFeatureProcedure('dashboard_odin').input(input).query(async ({ ctx, input }) => {
    await assertEmpresa(ctx.empresaId)
    const isAdmin = ctx.user.role === 'admin'
    const vendedorId = isAdmin ? input.vendedorId : ctx.user.id
    const hoje = new Date().toISOString().slice(0, 10)

    const condOrdens = [eq(ordens.empresaId, ctx.empresaId)]
    if (vendedorId) condOrdens.push(eq(ordens.vendedorId, vendedorId))
    const todasOrdens = await db.query.ordens.findMany({
      where: and(...condOrdens),
      columns: { id: true, status: true },
      with: {
        cliente: { columns: { razaoSocial: true } },
        coleta: { columns: { dataColeta: true, confirmado: true } },
        faturamento: { columns: { dataFaturamento: true, pagamentoConfirmado: true } },
        liberacaoFinanceira: { columns: { dataPagamentoPrevista: true, aprovado: true } },
        preparacao: { columns: { dataEntradaEstoque: true, aprovadoGestor: true } },
        posVenda: { columns: { dataLembrete: true } },
      },
    })

    const eventos: { id: string; tipo: EventoTipo; data: string; titulo: string; concluido: boolean; atrasado: boolean; link: string }[] = []

    for (const o of todasOrdens) {
      if (o.status === 'cancelado') continue
      const nome = o.cliente?.razaoSocial ?? `Pedido #${o.id}`
      if (o.coleta?.dataColeta) {
        eventos.push({ id: `coleta-${o.id}`, tipo: 'coleta', data: o.coleta.dataColeta, titulo: `Coleta #${o.id} — ${nome}`, concluido: !!o.coleta.confirmado, atrasado: !o.coleta.confirmado && o.coleta.dataColeta < hoje, link: `/admin/ordens/${o.id}` })
      }
      if (o.faturamento?.dataFaturamento) {
        eventos.push({ id: `faturamento-${o.id}`, tipo: 'faturamento', data: o.faturamento.dataFaturamento, titulo: `Faturamento #${o.id} — ${nome}`, concluido: !!o.faturamento.pagamentoConfirmado, atrasado: !o.faturamento.pagamentoConfirmado && o.faturamento.dataFaturamento < hoje, link: `/admin/ordens/${o.id}` })
      }
      if (o.liberacaoFinanceira?.dataPagamentoPrevista) {
        eventos.push({ id: `financeiro-${o.id}`, tipo: 'financeiro', data: o.liberacaoFinanceira.dataPagamentoPrevista, titulo: `Pagamento #${o.id} — ${nome}`, concluido: !!o.liberacaoFinanceira.aprovado, atrasado: !o.liberacaoFinanceira.aprovado && o.liberacaoFinanceira.dataPagamentoPrevista < hoje, link: `/admin/ordens/${o.id}` })
      }
      if (o.preparacao?.dataEntradaEstoque) {
        eventos.push({ id: `preparacao-${o.id}`, tipo: 'preparacao', data: o.preparacao.dataEntradaEstoque, titulo: `Preparação #${o.id} — ${nome}`, concluido: !!o.preparacao.aprovadoGestor, atrasado: !o.preparacao.aprovadoGestor && o.preparacao.dataEntradaEstoque < hoje, link: `/admin/ordens/${o.id}` })
      }
      if (o.posVenda?.dataLembrete) {
        eventos.push({ id: `pos_venda-${o.id}`, tipo: 'pos_venda', data: o.posVenda.dataLembrete, titulo: `Lembrete Pós-Venda #${o.id} — ${nome}`, concluido: o.posVenda.dataLembrete < hoje, atrasado: false, link: `/admin/ordens/${o.id}` })
      }
    }

    const condProp = [eq(propostas.empresaId, ctx.empresaId), eq(propostas.stage, 'chamar_depois')]
    if (vendedorId) condProp.push(eq(propostas.vendedorId, vendedorId))
    const propostasChamarDepois = await db.query.propostas.findMany({ where: and(...condProp), columns: { id: true, clienteNome: true, dataRetorno: true } })
    for (const p of propostasChamarDepois) {
      if (!p.dataRetorno) continue
      eventos.push({ id: `proposta-${p.id}`, tipo: 'proposta_chamar_depois', data: p.dataRetorno, titulo: `Retomar contato — ${p.clienteNome}`, concluido: false, atrasado: p.dataRetorno < hoje, link: `/admin/propostas/${p.id}` })
    }

    const condVis = [eq(visitas.empresaId, ctx.empresaId)]
    if (vendedorId) condVis.push(eq(visitas.vendedorId, vendedorId))
    const todasVisitas = await db.query.visitas.findMany({ where: and(...condVis), columns: { id: true, clienteNome: true, nomeEmpresa: true, dataVisita: true, dataRetorno: true, checkinEm: true } })
    for (const v of todasVisitas) {
      const nome = v.nomeEmpresa || v.clienteNome || `Visita #${v.id}`
      const dia = (v.dataVisita || '').slice(0, 10)
      if (dia) eventos.push({ id: `visita-${v.id}`, tipo: 'visita', data: dia, titulo: `Visita — ${nome}`, concluido: !!v.checkinEm, atrasado: false, link: '/admin/visitas' })
      if (v.dataRetorno) eventos.push({ id: `visita_retorno-${v.id}`, tipo: 'visita_retorno', data: v.dataRetorno, titulo: `Retorno — ${nome}`, concluido: false, atrasado: v.dataRetorno < hoje, link: '/admin/visitas' })
    }

    return eventos.filter((e) => e.data >= input.dataDe && e.data <= input.dataAte).sort((a, b) => a.data.localeCompare(b.data))
  }),
})
