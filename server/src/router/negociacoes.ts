import { z } from 'zod'
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { router, featureProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { cobrancasRegistro, clientesCartorio, clientesRc, clientes, empresas } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'

async function validarCliente(clienteId: number, empresaId: number) {
  const cliente = await db.query.clientes.findFirst({ where: and(eq(clientes.id, clienteId), eq(clientes.empresaId, empresaId)) })
  if (!cliente) throw new Error('Cliente não encontrado')
}

// 3 planilhas do dia a dia de cobrança (Financeiro), pedido do João — todas
// cliente-scoped, sem empresaId próprio (isolamento vem do join em
// clientes.empresaId, mesmo padrão de boletos.ts).
export const negociacoesRouter = router({
  cobrancasListar: featureProcedure('negociacoes')
    .input(z.object({ dataDe: z.string().optional(), dataAte: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const condicoes = [eq(clientes.empresaId, ctx.empresaId)]
      if (input?.dataDe) condicoes.push(gte(cobrancasRegistro.dataVencimento, input.dataDe))
      if (input?.dataAte) condicoes.push(lte(cobrancasRegistro.dataVencimento, input.dataAte))

      const linhas = await db
        .select({
          id: cobrancasRegistro.id,
          canal: cobrancasRegistro.canal,
          retornoCliente: cobrancasRegistro.retornoCliente,
          valor: cobrancasRegistro.valor,
          dataVencimento: cobrancasRegistro.dataVencimento,
          status: cobrancasRegistro.status,
          createdAt: cobrancasRegistro.createdAt,
          clienteId: clientes.id,
          clienteNome: clientes.razaoSocial,
          registradoPorId: cobrancasRegistro.registradoPorId,
        })
        .from(cobrancasRegistro)
        .innerJoin(clientes, eq(cobrancasRegistro.clienteId, clientes.id))
        .where(and(...condicoes))
        .orderBy(desc(cobrancasRegistro.createdAt))
      return linhas.map((l) => ({ ...l, cliente: { id: l.clienteId, razaoSocial: l.clienteNome } }))
    }),

  cobrancaCriar: featureProcedure('negociacoes')
    .input(
      z.object({
        clienteId: z.number(),
        canal: z.enum(['whatsapp', 'ligacao', 'email']),
        retornoCliente: z.string().min(1),
        valor: z.number().positive().optional(),
        dataVencimento: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await validarCliente(input.clienteId, ctx.empresaId)
      await db.insert(cobrancasRegistro).values({
        clienteId: input.clienteId,
        canal: input.canal,
        retornoCliente: input.retornoCliente.trim(),
        valor: input.valor ?? null,
        dataVencimento: input.dataVencimento || null,
        registradoPorId: ctx.user.id,
      })
      return { success: true }
    }),

  // Fecha o ciclo da cobrança: pago (encerra) ou movida pra Cartório/RC —
  // nesses 2 últimos casos já cria a linha correspondente lá, pra não
  // precisar cadastrar o cliente de novo na outra planilha.
  cobrancaMarcarStatus: featureProcedure('negociacoes')
    .input(z.object({ id: z.number(), status: z.enum(['pendente', 'pago', 'cartorio', 'rc']) }))
    .mutation(async ({ ctx, input }) => {
      const registro = await db.query.cobrancasRegistro.findFirst({ where: eq(cobrancasRegistro.id, input.id), with: { cliente: true } })
      if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')

      await db.update(cobrancasRegistro).set({ status: input.status }).where(eq(cobrancasRegistro.id, input.id))

      if (input.status === 'cartorio') {
        await db.insert(clientesCartorio).values({
          clienteId: registro.clienteId,
          valor: registro.valor,
          enviadoEm: hojeBrString(),
          criadoPorId: ctx.user.id,
        })
      }
      if (input.status === 'rc') {
        await db.insert(clientesRc).values({
          clienteId: registro.clienteId,
          valor: registro.valor,
          enviadoEm: hojeBrString(),
          criadoPorId: ctx.user.id,
        })
      }
      return { success: true }
    }),

  cobrancaExcluir: featureProcedure('negociacoes').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const registro = await db.query.cobrancasRegistro.findFirst({ where: eq(cobrancasRegistro.id, input.id), with: { cliente: true } })
    if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
    await db.delete(cobrancasRegistro).where(eq(cobrancasRegistro.id, input.id))
    return { success: true }
  }),

  cartorioListar: featureProcedure('negociacoes').query(async ({ ctx }) => {
    const linhas = await db
      .select({
        id: clientesCartorio.id,
        valor: clientesCartorio.valor,
        enviadoEm: clientesCartorio.enviadoEm,
        status: clientesCartorio.status,
        observacoes: clientesCartorio.observacoes,
        updatedAt: clientesCartorio.updatedAt,
        clienteId: clientes.id,
        clienteNome: clientes.razaoSocial,
      })
      .from(clientesCartorio)
      .innerJoin(clientes, eq(clientesCartorio.clienteId, clientes.id))
      .where(eq(clientes.empresaId, ctx.empresaId))
      .orderBy(desc(clientesCartorio.updatedAt))
    return linhas.map((l) => ({ ...l, cliente: { id: l.clienteId, razaoSocial: l.clienteNome } }))
  }),

  cartorioCriar: featureProcedure('negociacoes')
    .input(z.object({ clienteId: z.number(), valor: z.number().positive().optional(), enviadoEm: z.string(), observacoes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await validarCliente(input.clienteId, ctx.empresaId)
      await db.insert(clientesCartorio).values({
        clienteId: input.clienteId,
        valor: input.valor ?? null,
        enviadoEm: input.enviadoEm,
        observacoes: input.observacoes || null,
        criadoPorId: ctx.user.id,
      })
      return { success: true }
    }),

  cartorioAtualizarStatus: featureProcedure('negociacoes')
    .input(z.object({ id: z.number(), status: z.enum(['aguardando', 'voltou_cobrar', 'cobranca_feita']) }))
    .mutation(async ({ ctx, input }) => {
      const registro = await db.query.clientesCartorio.findFirst({ where: eq(clientesCartorio.id, input.id), with: { cliente: true } })
      if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
      await db.update(clientesCartorio).set({ status: input.status, updatedAt: agoraSqlite() }).where(eq(clientesCartorio.id, input.id))
      return { success: true }
    }),

  cartorioExcluir: featureProcedure('negociacoes').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const registro = await db.query.clientesCartorio.findFirst({ where: eq(clientesCartorio.id, input.id), with: { cliente: true } })
    if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
    await db.delete(clientesCartorio).where(eq(clientesCartorio.id, input.id))
    return { success: true }
  }),

  rcListar: featureProcedure('negociacoes').query(async ({ ctx }) => {
    const linhas = await db
      .select({
        id: clientesRc.id,
        valor: clientesRc.valor,
        enviadoEm: clientesRc.enviadoEm,
        status: clientesRc.status,
        observacoes: clientesRc.observacoes,
        updatedAt: clientesRc.updatedAt,
        clienteId: clientes.id,
        clienteNome: clientes.razaoSocial,
      })
      .from(clientesRc)
      .innerJoin(clientes, eq(clientesRc.clienteId, clientes.id))
      .where(eq(clientes.empresaId, ctx.empresaId))
      .orderBy(desc(clientesRc.updatedAt))
    return linhas.map((l) => ({ ...l, cliente: { id: l.clienteId, razaoSocial: l.clienteNome } }))
  }),

  rcCriar: featureProcedure('negociacoes')
    .input(z.object({ clienteId: z.number(), valor: z.number().positive().optional(), enviadoEm: z.string(), observacoes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await validarCliente(input.clienteId, ctx.empresaId)
      await db.insert(clientesRc).values({
        clienteId: input.clienteId,
        valor: input.valor ?? null,
        enviadoEm: input.enviadoEm,
        observacoes: input.observacoes || null,
        criadoPorId: ctx.user.id,
      })
      return { success: true }
    }),

  rcAtualizarStatus: featureProcedure('negociacoes')
    .input(z.object({ id: z.number(), status: z.enum(['em_negociacao', 'acordo_fechado', 'nao_fechou']) }))
    .mutation(async ({ ctx, input }) => {
      const registro = await db.query.clientesRc.findFirst({ where: eq(clientesRc.id, input.id), with: { cliente: true } })
      if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
      await db.update(clientesRc).set({ status: input.status, updatedAt: agoraSqlite() }).where(eq(clientesRc.id, input.id))
      return { success: true }
    }),

  rcExcluir: featureProcedure('negociacoes').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const registro = await db.query.clientesRc.findFirst({ where: eq(clientesRc.id, input.id), with: { cliente: true } })
    if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
    await db.delete(clientesRc).where(eq(clientesRc.id, input.id))
    return { success: true }
  }),

  // Excluir vários de uma vez — pedido do João, 2026-09-25. Só apaga o que
  // realmente pertence à empresa ativa (confere um a um antes, mesmo
  // esquema de segurança do excluir individual).
  rcExcluirLote: featureProcedure('negociacoes')
    .input(z.object({ ids: z.array(z.number()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const registros = await db.query.clientesRc.findMany({
        where: inArray(clientesRc.id, input.ids),
        with: { cliente: true },
      })
      const idsValidos = registros.filter((r) => r.cliente.empresaId === ctx.empresaId).map((r) => r.id)
      if (idsValidos.length > 0) {
        await db.delete(clientesRc).where(inArray(clientesRc.id, idsValidos))
      }
      return { excluidos: idsValidos.length }
    }),

  // Carga em lote — cola um relatório externo (CNPJ/CPF, razão social, nome
  // jurídico da empresa, quantidade de pendências, valor em aberto), uma
  // linha por cliente, e joga cada um direto na esteira RC da empresa
  // certa. superAdmin porque escreve em qualquer uma das 7 empresas de uma
  // vez (a Rubia, que cuida disso no dia a dia, ainda usa a rota normal
  // 'negociacoes' pra tudo o mais — essa carga inicial é coisa do João
  // configurar). Pedido do João, 2026-09-25 (mesma planilha que ele mandou
  // antes achando que ia virar uma tela nova — na verdade é isso aqui).
  rcImportarLote: superAdminProcedure
    .input(z.object({ texto: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const empresasCadastradas = await db.query.empresas.findMany()
      const normalizar = (s: string) =>
        s
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .trim()
          .toUpperCase()

      // Nome jurídico completo (como vem no relatório externo) → nome da
      // empresa no CRM. Confirmado com o João, 2026-09-24/25.
      const MAPA_EMPRESA_LEGADO: Record<string, string> = {
        'COMPREFER COMERCIO DE COMPRESSORES LTDA': 'Comprefer',
        'COMPRETEC COMPRESSORES E FERRAMENTAS LTDA': 'Compretec Loja Física',
        'JOITEC DISTRIBUIDORA DE PECAS LTDA': 'Joitec Distribuidora de Peças',
        'JT COMPRESSORES LTDA': 'Joitec Distribuidora de Peças',
        'ODIN COMPRESSORES LTDA': 'Odin Compressores',
        'ODIN TUBOS E CONEXOES LTDA': 'Odin Tubos e Conexões',
      }
      const empresaPorNomeNormalizado = new Map(empresasCadastradas.map((e) => [normalizar(e.nome), e]))

      const linhas = input.texto.split('\n').map((l) => l.trim()).filter(Boolean)
      let criados = 0
      let processados = 0
      const erros: { linha: number; motivo: string }[] = []

      for (let i = 0; i < linhas.length; i++) {
        const numeroLinha = i + 1
        const partes = linhas[i]
          .split(/\t| {2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
        if (partes.length < 5) {
          erros.push({ linha: numeroLinha, motivo: `Não consegui separar as colunas ("${linhas[i].slice(0, 60)}...")` })
          continue
        }

        const documentoRaw = partes[0]
        const razaoSocial = partes[1]
        const valorRaw = partes[partes.length - 1]
        const quantidadeRaw = partes[partes.length - 2]
        const empresaNomeLegado = partes.slice(2, partes.length - 2).join(' ')

        const empresaAlvoNome = MAPA_EMPRESA_LEGADO[normalizar(empresaNomeLegado)]
        const empresaAlvo = empresaAlvoNome ? empresaPorNomeNormalizado.get(normalizar(empresaAlvoNome)) : undefined
        if (!empresaAlvo) {
          erros.push({ linha: numeroLinha, motivo: `Empresa "${empresaNomeLegado}" não reconhecida` })
          continue
        }

        const documentoDigitos = documentoRaw.replace(/\D/g, '')
        const ehCpf = documentoDigitos.length === 11
        const ehCnpj = documentoDigitos.length === 14
        if (!ehCpf && !ehCnpj) {
          erros.push({ linha: numeroLinha, motivo: `Documento "${documentoRaw}" não parece CNPJ nem CPF` })
          continue
        }

        const quantidadePendencias = Number(quantidadeRaw.replace(/\D/g, '')) || 0
        const valorPendencia = Number(
          valorRaw
            .replace(/[^\d,.-]/g, '')
            .replace(/\./g, '')
            .replace(',', '.')
        )

        let cliente = await db.query.clientes.findFirst({
          where: and(
            eq(clientes.empresaId, empresaAlvo.id),
            isNull(clientes.deletedAt),
            ehCnpj ? eq(clientes.cnpj, documentoDigitos) : eq(clientes.cpf, documentoDigitos)
          ),
        })

        if (!cliente) {
          const result = await db.insert(clientes).values({
            empresaId: empresaAlvo.id,
            razaoSocial,
            cnpj: ehCnpj ? documentoDigitos : undefined,
            cpf: ehCpf ? documentoDigitos : undefined,
            codigo: documentoDigitos,
            regiao: null,
            cadastradoPor: ctx.user.id,
          })
          const clienteId = Number(result.lastInsertRowid)
          cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, clienteId) })
          criados++
        }
        if (!cliente) {
          erros.push({ linha: numeroLinha, motivo: 'Falha inesperada ao localizar/criar o cliente' })
          continue
        }

        const observacoes = `${quantidadePendencias} pendência(s) — carga inicial (relatório de inadimplência)`
        const existente = await db.query.clientesRc.findFirst({
          where: and(eq(clientesRc.clienteId, cliente.id), eq(clientesRc.status, 'em_negociacao')),
        })
        if (existente) {
          await db
            .update(clientesRc)
            .set({ valor: valorPendencia, observacoes, updatedAt: agoraSqlite() })
            .where(eq(clientesRc.id, existente.id))
        } else {
          await db.insert(clientesRc).values({
            clienteId: cliente.id,
            valor: valorPendencia,
            enviadoEm: hojeBrString(),
            observacoes,
            criadoPorId: ctx.user.id,
          })
        }
        processados++
      }

      return { total: linhas.length, criados, processados, erros }
    }),
})
