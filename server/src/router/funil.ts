import { z } from 'zod'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { funilMensal, clientes, registroContato, itensPedido, vendas, solicitacoesCarteira, clienteVinculos, compromissos } from '../db/schema.js'
import { mesReferenciaAtual, diasDesde, agoraSqlite } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { executarResetMensal } from '../lib/resetMensal.js'
import { validarClienteFaturamento } from './vinculos.js'

const ETAPA_VALUES = [
  'novo',
  'abordagem',
  'interessado',
  'negociacao',
  'fechado',
  'faturamento',
  'perdido',
  'sem_contato',
  'consumidor_final',
] as const

// Compartilhado entre `meuFunil` (vendedor vendo o próprio funil) e
// `funilPorVendedor` (admin vendo o funil de qualquer vendedor específico) —
// mesmo formato de card pros dois casos, só muda de quem é o funil.
async function buscarFunilDoVendedor(vendedorId: number, ctxUserId: number, ctxIsAdmin: boolean, mesReferencia?: string) {
  const mes = mesReferencia ?? mesReferenciaAtual()

  const funis = await db.query.funilMensal.findMany({
    where: and(eq(funilMensal.vendedorId, vendedorId), eq(funilMensal.mesReferencia, mes), isNull(funilMensal.deletedAt)),
    with: {
      cliente: {
        columns: {
          id: true,
          razaoSocial: true,
          telefoneWhatsapp: true,
          email: true,
          nomeContato: true,
          statusFiscal: true,
          observacoes: true,
          cnpj: true,
          codigo: true,
          inscricaoEstadual: true,
          estado: true,
          cidade: true,
          versao: true,
          origemMarketing: true,
        },
        with: {
          telefonesExtras: { orderBy: (t, { asc }) => [asc(t.id)] },
          emailsExtras: { orderBy: (e, { asc }) => [asc(e.id)] },
        },
      },
      vendas: {
        where: isNull(vendas.deletedAt),
        orderBy: (v, { desc }) => [desc(v.dataFechamento)],
      },
    },
  })

  const funilIds = funis.map((f) => f.id)
  const contatos = funilIds.length
    ? await db.query.registroContato.findMany({
        where: and(inArray(registroContato.funilMensalId, funilIds), isNull(registroContato.deletedAt)),
        orderBy: (c, { desc }) => [desc(c.dataHora)],
      })
    : []
  const contatosPorFunil = new Map<number, typeof contatos>()
  for (const c of contatos) {
    const lista = contatosPorFunil.get(c.funilMensalId) ?? []
    lista.push(c)
    contatosPorFunil.set(c.funilMensalId, lista)
  }

  // Pedidos de descarte/transferência pendentes de aprovação — vira uma
  // etiqueta no card pra não esquecer que tem algo em aberto naquele cliente.
  const clienteIds = funis.map((f) => f.cliente.id)
  const pedidosPendentes = clienteIds.length
    ? await db.query.solicitacoesCarteira.findMany({
        where: and(inArray(solicitacoesCarteira.clienteId, clienteIds), eq(solicitacoesCarteira.status, 'pendente')),
      })
    : []
  const pedidoPorCliente = new Map(pedidosPendentes.map((p) => [p.clienteId, p.tipo]))

  // Próximo compromisso agendado (não concluído) de cada cliente — pra
  // aparecer já no card do Kanban (não só no Calendário), pedido direto do
  // João pra não precisar abrir o card só pra saber se tem um agendamento
  // em aberto. Ordenado por data ascendente e pegando o primeiro por
  // cliente cobre tanto "próximo compromisso futuro" quanto "compromisso
  // atrasado que ainda não foi marcado como concluído" (o mais antigo vence).
  const proximosCompromissos = clienteIds.length
    ? await db.query.compromissos.findMany({
        where: and(inArray(compromissos.clienteId, clienteIds), eq(compromissos.concluido, false), isNull(compromissos.deletedAt)),
        orderBy: (c, { asc }) => [asc(c.dataHora)],
      })
    : []
  const proximoCompromissoPorCliente = new Map<number, (typeof proximosCompromissos)[number]>()
  for (const c of proximosCompromissos) {
    if (c.clienteId === null) continue
    if (!proximoCompromissoPorCliente.has(c.clienteId)) proximoCompromissoPorCliente.set(c.clienteId, c)
  }

  // Clientes vinculados (matriz/filial, CNPJ duplicado etc.). Quando os dois
  // lados têm card neste mesmo board (mesmo vendedor, mesmo mês), viram UM
  // card só — o vendedor escolhe qual CNPJ faturar na hora de fechar (pedido
  // direto do João pra não ter 2 cards da mesma empresa no Kanban). Quando só
  // um lado tem card aqui (o outro está com outro vendedor, ou nem tem funil
  // aberto), fica só um aviso informativo — cada um continua com seu card.
  const vinculosBrutos = clienteIds.length
    ? await db.query.clienteVinculos.findMany({
        where: or(inArray(clienteVinculos.clienteId, clienteIds), inArray(clienteVinculos.clienteVinculadoId, clienteIds)),
      })
    : []
  const idsOutrosVinculados = [
    ...new Set(vinculosBrutos.map((v) => (clienteIds.includes(v.clienteId) ? v.clienteVinculadoId : v.clienteId))),
  ]
  const outrosVinculados = idsOutrosVinculados.length
    ? await db.query.clientes.findMany({
        where: or(...idsOutrosVinculados.map((id) => eq(clientes.id, id)))!,
        columns: { id: true, razaoSocial: true, codigo: true, cnpj: true },
      })
    : []

  const funilPorClienteId = new Map(funis.map((f) => [f.cliente.id, f]))
  const idsFundidos = new Set<number>()
  const cnpjsDisponiveisPorFunilPrimario = new Map<
    number,
    { clienteId: number; razaoSocial: string; codigo: string | null; cnpj: string | null }[]
  >()
  const vinculosPorCliente = new Map<number, { id: number; razaoSocial: string; codigo: string | null; cnpj: string | null }[]>()

  for (const v of vinculosBrutos) {
    const funilA = funilPorClienteId.get(v.clienteId)
    const funilB = funilPorClienteId.get(v.clienteVinculadoId)

    if (funilA && funilB) {
      // Os dois têm card aqui — funde no card de quem vinculou primeiro
      // (`clienteId` é sempre o cliente de onde o vendedor clicou "vincular",
      // `clienteVinculadoId` é o que ele buscou e escolheu) — não no mais
      // antigo, pra não trocar qual card fica visível toda hora que alguém
      // adiciona um novo vínculo.
      const [primario, secundario] = [funilA, funilB]
      if (idsFundidos.has(primario.id)) continue // já é secundário de outro par — evita encadear fusões
      idsFundidos.add(secundario.id)
      const lista =
        cnpjsDisponiveisPorFunilPrimario.get(primario.id) ??
        ([
          { clienteId: primario.cliente.id, razaoSocial: primario.cliente.razaoSocial, codigo: primario.cliente.codigo, cnpj: primario.cliente.cnpj },
        ] as { clienteId: number; razaoSocial: string; codigo: string | null; cnpj: string | null }[])
      lista.push({
        clienteId: secundario.cliente.id,
        razaoSocial: secundario.cliente.razaoSocial,
        codigo: secundario.cliente.codigo,
        cnpj: secundario.cliente.cnpj,
      })
      cnpjsDisponiveisPorFunilPrimario.set(primario.id, lista)
      continue
    }

    // Só um lado (ou nenhum) tem card aqui — vira só o aviso informativo.
    const donoId = clienteIds.includes(v.clienteId) ? v.clienteId : v.clienteVinculadoId
    const outroId = donoId === v.clienteId ? v.clienteVinculadoId : v.clienteId
    const outro = outrosVinculados.find((o) => o.id === outroId)
    if (!outro) continue
    const lista = vinculosPorCliente.get(donoId) ?? []
    lista.push(outro)
    vinculosPorCliente.set(donoId, lista)
  }

  // Quando o mesmo cliente tem mais de um card no mês (múltiplos orçamentos
  // abertos em paralelo — pedido do João pra não perder o segundo orçamento
  // quando o primeiro fecha ou é perdido), numera "Orçamento 1", "Orçamento
  // 2"... na ordem em que os cards foram criados, só pra diferenciar no
  // board. Cliente com um card só não ganha rótulo nenhum.
  const funisPorCliente = new Map<number, typeof funis>()
  for (const f of funis) {
    const lista = funisPorCliente.get(f.cliente.id) ?? []
    lista.push(f)
    funisPorCliente.set(f.cliente.id, lista)
  }
  const orcamentoLabelPorFunil = new Map<number, string>()
  for (const lista of funisPorCliente.values()) {
    if (lista.length < 2) continue
    const ordenada = [...lista].sort((a, b) => a.id - b.id)
    ordenada.forEach((f, i) => orcamentoLabelPorFunil.set(f.id, `Orçamento ${i + 1}`))
  }

  return funis
    .filter((f) => !idsFundidos.has(f.id))
    .map((f) => ({
    funilMensalId: f.id,
    orcamentoLabel: orcamentoLabelPorFunil.get(f.id) ?? null,
    versao: f.versao,
    etapa: f.etapa,
    vendedorId: f.vendedorId,
    clienteId: f.cliente.id,
    razaoSocial: f.cliente.razaoSocial,
    telefoneWhatsapp: f.cliente.telefoneWhatsapp,
    telefonesExtras: f.cliente.telefonesExtras,
    emailsExtras: f.cliente.emailsExtras,
    email: f.cliente.email,
    nomeContato: f.cliente.nomeContato,
    statusFiscal: f.cliente.statusFiscal,
    observacoes: f.cliente.observacoes,
    cnpj: f.cliente.cnpj,
    codigo: f.cliente.codigo,
    inscricaoEstadual: f.cliente.inscricaoEstadual,
    estado: f.cliente.estado,
    cidade: f.cliente.cidade,
    clienteVersao: f.cliente.versao,
    origemMarketing: f.cliente.origemMarketing,
    pedidoPendente: pedidoPorCliente.get(f.cliente.id) ?? null,
    proximoCompromisso: (() => {
      const c = proximoCompromissoPorCliente.get(f.cliente.id)
      return c ? { id: c.id, tipo: c.tipo, titulo: c.titulo, dataHora: c.dataHora } : null
    })(),
    clientesVinculados: vinculosPorCliente.get(f.cliente.id) ?? [],
    cnpjsDisponiveis: cnpjsDisponiveisPorFunilPrimario.get(f.id) ?? [],
    diasSemContato: diasDesde(f.dataUltimoContato),
    qtdTentativasContato: f.qtdTentativasContato,
    dataEntradaEtapa: f.dataEntradaEtapa,
    valorOrcado: f.valorOrcado,
    pdfPropostaPath: f.pdfPropostaPath,
    vendas: f.vendas.map((v) => ({
      id: v.id,
      valorFechado: v.valorFechado,
      condicaoPagamento: v.condicaoPagamento,
      pdfPedidoPath: v.pdfPedidoPath,
      dataFechamento: v.dataFechamento,
      tipoComprovante: v.tipoComprovante,
      faturado: v.faturado,
    })),
    valorFechadoTotal: f.vendas.reduce((soma, v) => soma + v.valorFechado, 0),
    carregadoMesAnterior: f.carregadoMesAnterior,
    contatos: (contatosPorFunil.get(f.id) ?? []).map((c) => ({
      id: c.id,
      tipo: c.tipo,
      resultado: c.resultado,
      origem: c.origem,
      observacao: c.observacao,
      dataHora: c.dataHora,
      editavel: ctxIsAdmin || c.vendedorId === ctxUserId,
    })),
  }))
}

const ETAPAS_ABERTAS_FILA = ['novo', 'abordagem', 'interessado', 'negociacao', 'sem_contato']
const TAMANHO_FILA_HOJE = 20

export const funilRouter = router({
  meuFunil: protectedProcedure.input(z.object({ mesReferencia: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
    return buscarFunilDoVendedor(ctx.user.id, ctx.user.id, ctx.user.role === 'admin', input?.mesReferencia)
  }),

  // "Fila de hoje" — em vez do vendedor caçar quem precisa de atenção
  // vasculhando as colunas do Kanban, aqui já vem pronto: só etapas em
  // aberto, ordenado por quem está há mais tempo sem contato (nunca
  // contatado vem primeiro — é o caso mais urgente). Cortado num tamanho de
  // fila diária razoável; o resto continua acessível pelo Kanban normal.
  filaHoje: protectedProcedure.query(async ({ ctx }) => {
    const cards = await buscarFunilDoVendedor(ctx.user.id, ctx.user.id, ctx.user.role === 'admin')
    const abertos = cards.filter((c) => ETAPAS_ABERTAS_FILA.includes(c.etapa))

    abertos.sort((a, b) => {
      const pa = a.diasSemContato ?? Infinity
      const pb = b.diasSemContato ?? Infinity
      return pb - pa
    })

    return { total: abertos.length, cards: abertos.slice(0, TAMANHO_FILA_HOJE) }
  }),

  // Admin vendo o funil (tratativa de venda) de um vendedor específico —
  // ele acompanha tudo que cada vendedor está fazendo, não só os números
  // agregados dos relatórios/painel de TV. Pode editar/excluir os contatos
  // de qualquer vendedor (mesma regra que já vale em `contatos.editar`).
  funilPorVendedor: adminProcedure
    .input(z.object({ vendedorId: z.number(), mesReferencia: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      return buscarFunilDoVendedor(input.vendedorId, ctx.user.id, true, input.mesReferencia)
    }),

  moverEtapa: protectedProcedure
    .input(
      z.object({
        funilMensalId: z.number(),
        versao: z.number(),
        etapa: z.enum(ETAPA_VALUES),
        valorOrcado: z.number().optional(),
        valorFechado: z.number().optional(),
        condicaoPagamento: z.string().optional(),
        pdfPedidoPath: z.string().optional(),
        pdfPropostaPath: z.string().optional(),
        clienteIdFaturamento: z.number().optional(),
        motivoPerdaCategoria: z.enum(['estoque', 'financeiro', 'compras']).optional(),
        motivoPerdaOpcao: z.string().optional(),
        motivoPerdaItem: z.string().optional(),
        motivoPerdaObservacao: z.string().optional(),
        empresaRepasse: z.enum(['tubos_conexoes', 'compressores', 'outra']).optional(),
        motivoRepasseObservacao: z.string().optional(),
        itens: z
          .array(
            z.object({
              descricao: z.string().min(1),
              quantidade: z.number().optional(),
              valorUnitario: z.number().optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const funil = await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, input.funilMensalId) })
      if (!funil) throw new Error('Card não encontrado')
      if (ctx.user.role !== 'admin' && funil.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

      if (funil.etapa === 'novo' && input.etapa !== 'novo' && funil.qtdTentativasContato === 0) {
        throw new Error('Registre ao menos um contato antes de mover este cliente para fora de "Novo".')
      }

      const updates: Record<string, unknown> = {
        etapa: input.etapa,
        dataEntradaEtapa: agoraSqlite(),
        valorOrcado: input.valorOrcado ?? null,
        updatedAt: agoraSqlite(),
        versao: input.versao + 1,
      }
      // Só sobrescreve quando vier um PDF novo (reanexar uma proposta
      // revisada) — sem isso, mover pra outra etapa sem mexer no PDF não
      // pode apagar o que já tinha sido salvo antes.
      if (input.pdfPropostaPath) updates.pdfPropostaPath = input.pdfPropostaPath

      if (input.etapa === 'fechado') {
        // `moverEtapa` só cobre a *primeira* venda (é o que efetivamente
        // muda a etapa) — reenviar "fechado" com o cliente já fechado
        // duplicaria a venda. Pra comprar de novo no mesmo mês é
        // `vendas.registrar`, sem passar por aqui.
        if (funil.etapa === 'fechado') {
          throw new Error('Este cliente já está fechado esse mês. Use "Registrar nova venda" pra lançar outro pedido.')
        }
        if (input.valorFechado === undefined) throw new Error('Informe o valor fechado.')
        if (!input.pdfPedidoPath) throw new Error('Anexe o PDF do pedido/nota para fechar a venda.')
      }

      if (input.etapa === 'faturamento' && funil.etapa !== 'fechado') {
        throw new Error('Só é possível mover pra Faturamento a partir de "Fechado".')
      }

      if (input.etapa === 'perdido') {
        if (!input.motivoPerdaCategoria || !input.motivoPerdaObservacao) {
          throw new Error('Informe a categoria e a observação do motivo de perda.')
        }
        updates.motivoPerdaCategoria = input.motivoPerdaCategoria
        updates.motivoPerdaOpcao = input.motivoPerdaOpcao ?? null
        updates.motivoPerdaItem = input.motivoPerdaItem ?? null
        updates.motivoPerdaObservacao = input.motivoPerdaObservacao
      }

      if (input.etapa === 'consumidor_final') {
        if (!input.empresaRepasse) {
          throw new Error('Informe para qual empresa este cliente foi repassado.')
        }
        updates.empresaRepasse = input.empresaRepasse
        updates.motivoRepasseObservacao = input.motivoRepasseObservacao ?? null
      }

      const updated = await db
        .update(funilMensal)
        .set(updates)
        .where(and(eq(funilMensal.id, input.funilMensalId), eq(funilMensal.versao, input.versao)))
      if (updated.rowsAffected === 0) {
        throw new Error('Este card foi alterado por outra pessoa enquanto você editava. Recarregue a página e tente de novo.')
      }

      if (input.etapa !== funil.etapa) {
        await registrarAuditoria({
          tabela: 'funil_mensal',
          registroId: input.funilMensalId,
          acao: 'mudar_etapa',
          campo: 'etapa',
          valorAnterior: funil.etapa,
          valorNovo: input.etapa,
          alteradoPor: ctx.user.id,
        })
      }

      if (input.etapa === 'fechado') {
        // Cliente com CNPJ vinculado (matriz/filial, cadastro duplicado) —
        // o vendedor escolhe qual CNPJ recebe a venda; por padrão é o
        // próprio cliente do card.
        const clienteFaturamentoId = input.clienteIdFaturamento ?? funil.clienteId
        if (clienteFaturamentoId !== funil.clienteId) {
          await validarClienteFaturamento(funil.clienteId, clienteFaturamentoId, ctx.empresaId)
        }

        await db.update(clientes).set({ dataUltimaCompra: agoraSqlite() }).where(eq(clientes.id, clienteFaturamentoId))

        const vendaResult = await db.insert(vendas).values({
          funilMensalId: input.funilMensalId,
          clienteId: clienteFaturamentoId,
          vendedorId: funil.vendedorId,
          mesReferencia: funil.mesReferencia,
          valorFechado: input.valorFechado!,
          condicaoPagamento: input.condicaoPagamento ?? null,
          pdfPedidoPath: input.pdfPedidoPath,
        })
        const vendaId = Number(vendaResult.lastInsertRowid)

        // Itens são opcionais (o vendedor pode fechar só com o valor total e o
        // PDF, sem detalhar item a item) — mas quando informados, alimentam o
        // relatório "itens mais comprados" e o histórico do cliente, que antes
        // só seriam preenchidos pela extração de PDF via IA (bloco 11, ainda
        // bloqueado sem chave da Anthropic).
        if (input.itens?.length) {
          await db.insert(itensPedido).values(
            input.itens.map((item) => ({
              vendaId,
              clienteId: clienteFaturamentoId,
              descricao: item.descricao,
              quantidade: item.quantidade ?? null,
              valorUnitario: item.valorUnitario ?? null,
              valorTotal: item.quantidade != null && item.valorUnitario != null ? item.quantidade * item.valorUnitario : null,
            }))
          )
        }
      }

      return { success: true }
    }),

  // Salva o PDF de proposta/orçamento assim que o vendedor anexa, sem
  // esperar ele clicar em "Salvar etapa" — anexar só subia o arquivo pro
  // disco (pra IA ler os itens) mas não persistia a referência em lugar
  // nenhum até o formulário de mover etapa ser submetido, e como o card já
  // podia estar em Negociação (sem nenhuma mudança de etapa pra disparar o
  // submit), o vendedor via o anexo "sumir" ao reabrir o card. Não mexe em
  // etapa/versão/valor orçado — só grava o caminho do PDF.
  anexarProposta: protectedProcedure
    .input(z.object({ funilMensalId: z.number(), pdfPropostaPath: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const funil = await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, input.funilMensalId) })
      if (!funil) throw new Error('Card não encontrado')
      if (ctx.user.role !== 'admin' && funil.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

      await db
        .update(funilMensal)
        .set({ pdfPropostaPath: input.pdfPropostaPath, updatedAt: agoraSqlite() })
        .where(eq(funilMensal.id, input.funilMensalId))

      return { success: true }
    }),

  // Abre um segundo (ou terceiro...) orçamento pro mesmo cliente, sem mexer
  // no card original — o vendedor as vezes cotação mais de um pedido em
  // paralelo (ex: peça A e peça B, negociados em ritmos diferentes) e
  // precisa fechar um e perder o outro sem que um afete o outro. Só pode
  // abrir a partir de Negociação: o relacionamento com o cliente já existe,
  // não faz sentido repetir Novo/Abordagem/Interessado pro card novo.
  criarOrcamento: protectedProcedure
    .input(z.object({ funilMensalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const origem = await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, input.funilMensalId) })
      if (!origem) throw new Error('Card não encontrado')
      if (ctx.user.role !== 'admin' && origem.vendedorId !== ctx.user.id) throw new Error('Acesso negado')
      if (origem.etapa !== 'negociacao' && origem.etapa !== 'fechado') {
        throw new Error('Só é possível abrir um novo orçamento a partir de Negociação ou de um pedido já Fechado.')
      }

      const result = await db.insert(funilMensal).values({
        clienteId: origem.clienteId,
        vendedorId: origem.vendedorId,
        mesReferencia: origem.mesReferencia,
        etapa: 'negociacao',
        dataEntradaEtapa: agoraSqlite(),
      })
      return { funilMensalId: Number(result.lastInsertRowid) }
    }),

  // Roda sozinho todo início de mês (scheduler.ts), mas o admin também pode
  // forçar manualmente — útil pra testar sem esperar o mês virar, ou como
  // rede de segurança se o servidor ficou fora do ar na virada.
  rodarResetMensal: adminProcedure.mutation(async () => {
    return executarResetMensal()
  }),
})
