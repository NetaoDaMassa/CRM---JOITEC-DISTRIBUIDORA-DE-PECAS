import { z } from 'zod'
import { and, desc, eq, inArray, isNull, lt, ne } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { chatConversas, chatParticipantes, chatMensagens, users, leads, clientes, ordens, visitas, solicitacoesCredito } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { emitirNovaMensagem, emitirParaUsuario, emitirParaConversa } from '../lib/chatSocket.js'

const TIPO_ORIGEM_VALUES = ['lead', 'cliente', 'pedido', 'visita', 'consulta_credito'] as const

// Resolve o "do que se trata" + quem é o responsável atual do registro, pra
// auto-adicionar como participante na hora de criar a conversa e pra
// mostrar o título sempre atualizado na lista (o `tituloSnapshot` salvo no
// banco só serve de fallback se o registro tiver sido excluído depois).
// Genérico de propósito — novo tipo de origem no futuro só precisa de um
// `case` novo aqui, não mexe em mais nada do chat.
async function resolverOrigem(
  tipoOrigem: (typeof TIPO_ORIGEM_VALUES)[number],
  idOrigem: number
): Promise<{ titulo: string; vendedorId: number | null } | null> {
  switch (tipoOrigem) {
    case 'lead': {
      const l = await db.query.leads.findFirst({ where: eq(leads.id, idOrigem), columns: { name: true, vendorId: true } })
      return l ? { titulo: l.name, vendedorId: l.vendorId } : null
    }
    case 'cliente': {
      const c = await db.query.clientes.findFirst({ where: eq(clientes.id, idOrigem), columns: { razaoSocial: true, vendedorAtualId: true } })
      return c ? { titulo: c.razaoSocial, vendedorId: c.vendedorAtualId } : null
    }
    case 'pedido': {
      const o = await db.query.ordens.findFirst({
        where: eq(ordens.id, idOrigem),
        columns: { vendedorId: true },
        with: { cliente: { columns: { razaoSocial: true } } },
      })
      return o ? { titulo: `Pedido #${idOrigem}${o.cliente ? ` — ${o.cliente.razaoSocial}` : ''}`, vendedorId: o.vendedorId } : null
    }
    case 'visita': {
      const v = await db.query.visitas.findFirst({ where: eq(visitas.id, idOrigem), columns: { clienteNome: true, vendedorId: true } })
      return v ? { titulo: `Visita${v.clienteNome ? ` — ${v.clienteNome}` : ''}`, vendedorId: v.vendedorId } : null
    }
    case 'consulta_credito': {
      const s = await db.query.solicitacoesCredito.findFirst({
        where: eq(solicitacoesCredito.id, idOrigem),
        columns: { vendedorSolicitanteId: true },
        with: { cliente: { columns: { razaoSocial: true } } },
      })
      return s ? { titulo: `Consulta de crédito — ${s.cliente?.razaoSocial ?? '—'}`, vendedorId: s.vendedorSolicitanteId } : null
    }
  }
}

async function garantirParticipante(conversaId: number, userId: number) {
  const existente = await db.query.chatParticipantes.findFirst({
    where: and(eq(chatParticipantes.conversaId, conversaId), eq(chatParticipantes.userId, userId)),
  })
  if (!existente) await db.insert(chatParticipantes).values({ conversaId, userId })
}

export const chatRouter = router({
  // Cross-empresa de propósito — "todo mundo, grupo inteiro" (pedido do
  // João, 2026-10-02): qualquer um pode começar uma conversa direta com
  // qualquer outro, não só gente da própria empresa.
  usuarios: protectedProcedure.query(async ({ ctx }) => {
    const todos = await db.query.users.findMany({
      where: and(eq(users.isActive, true), ne(users.id, ctx.user.id)),
      columns: { id: true, name: true, empresaId: true, chatOnline: true, chatUltimaAtividadeEm: true, fotoUrl: true },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    return todos
  }),

  // Acha (ou cria na hora) a conversa vinculada a um registro — é o que
  // alimenta o botão "Conversar sobre isso", sempre idempotente: clicar de
  // novo no mesmo registro sempre volta pra mesma conversa, nunca duplica.
  conversas: router({
    abrirPorOrigem: protectedProcedure
      .input(z.object({ tipoOrigem: z.enum(TIPO_ORIGEM_VALUES), idOrigem: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const existente = await db.query.chatConversas.findFirst({
          where: and(eq(chatConversas.tipoOrigem, input.tipoOrigem), eq(chatConversas.idOrigem, input.idOrigem)),
        })
        let conversaId: number
        if (existente) {
          conversaId = existente.id
          await garantirParticipante(conversaId, ctx.user.id)
        } else {
          const origem = await resolverOrigem(input.tipoOrigem, input.idOrigem)
          const result = await db.insert(chatConversas).values({
            tipoOrigem: input.tipoOrigem,
            idOrigem: input.idOrigem,
            tituloSnapshot: origem?.titulo ?? null,
            criadoPor: ctx.user.id,
          })
          conversaId = Number(result.lastInsertRowid)

          await garantirParticipante(conversaId, ctx.user.id)
          if (origem?.vendedorId && origem.vendedorId !== ctx.user.id) {
            await garantirParticipante(conversaId, origem.vendedorId)
            emitirParaUsuario(origem.vendedorId, 'chat:conversaAtualizada', { conversaId })
          }
        }

        // O vendedor costuma já SER o responsável do lead/cliente — auto-
        // adicionar "o dono do registro" não ajuda em nada nesse caso comum.
        // Em vez de adivinhar quem mais deveria entrar, avisa o front que
        // essa conversa ainda está "sozinha" (só quem abriu) pra oferecer
        // escolher com quem falar (financeiro, gestor, admin, marketing,
        // qualquer um) — pedido do João, 2026-10-02.
        const totalParticipantes = await db.query.chatParticipantes.findMany({ where: eq(chatParticipantes.conversaId, conversaId) })
        return { id: conversaId, precisaEscolherComQuemFalar: totalParticipantes.length <= 1 }
      }),

    // Conversa direta (sem vínculo com registro nenhum) entre duas pessoas
    // — mesma lógica de idempotência: já existindo uma entre os dois, volta
    // pra ela em vez de criar outra.
    abrirDireta: protectedProcedure.input(z.object({ outroUserId: z.number() })).mutation(async ({ ctx, input }) => {
      if (input.outroUserId === ctx.user.id) throw new Error('Não dá pra abrir uma conversa consigo mesmo.')

      const minhas = await db.query.chatParticipantes.findMany({
        where: eq(chatParticipantes.userId, ctx.user.id),
        columns: { conversaId: true },
      })
      const conversaIds = minhas.map((m) => m.conversaId)
      if (conversaIds.length) {
        const candidatas = await db.query.chatConversas.findMany({
          where: and(eq(chatConversas.tipoOrigem, 'direta'), inArray(chatConversas.id, conversaIds)),
        })
        for (const c of candidatas) {
          const doOutro = await db.query.chatParticipantes.findFirst({
            where: and(eq(chatParticipantes.conversaId, c.id), eq(chatParticipantes.userId, input.outroUserId)),
          })
          if (doOutro) return { id: c.id }
        }
      }

      const outro = await db.query.users.findFirst({ where: eq(users.id, input.outroUserId), columns: { name: true } })
      if (!outro) throw new Error('Usuário não encontrado')

      const result = await db.insert(chatConversas).values({
        tipoOrigem: 'direta',
        tituloSnapshot: outro.name,
        criadoPor: ctx.user.id,
      })
      const conversaId = Number(result.lastInsertRowid)
      await garantirParticipante(conversaId, ctx.user.id)
      await garantirParticipante(conversaId, input.outroUserId)
      emitirParaUsuario(input.outroUserId, 'chat:conversaAtualizada', { conversaId })
      return { id: conversaId }
    }),

    // Adiciona mais alguém numa conversa já existente (igual entrar num
    // grupo de WhatsApp) — qualquer participante atual pode convidar.
    adicionarParticipante: protectedProcedure
      .input(z.object({ conversaId: z.number(), userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const souParticipante = await db.query.chatParticipantes.findFirst({
          where: and(eq(chatParticipantes.conversaId, input.conversaId), eq(chatParticipantes.userId, ctx.user.id)),
        })
        if (!souParticipante) throw new Error('Você não participa dessa conversa.')
        await garantirParticipante(input.conversaId, input.userId)
        emitirParaUsuario(input.userId, 'chat:conversaAtualizada', { conversaId: input.conversaId })
        return { success: true }
      }),

    // Dados do registro de origem, pra mostrar direto na janela do chat
    // (sem precisar sair pra ficha do cliente) — hoje só 'cliente' traz
    // informação extra (telefone, código, vendedor); os outros tipos só
    // confirmam tipoOrigem/idOrigem. Pedido do João, 2026-10-02: conversa
    // sobre cliente da carteira (ou aberta pelo Kanban) já vem com os
    // dados dele.
    detalhe: protectedProcedure.input(z.object({ conversaId: z.number() })).query(async ({ ctx, input }) => {
      const souParticipante = await db.query.chatParticipantes.findFirst({
        where: and(eq(chatParticipantes.conversaId, input.conversaId), eq(chatParticipantes.userId, ctx.user.id)),
      })
      if (!souParticipante) throw new Error('Você não participa dessa conversa.')
      const conversa = await db.query.chatConversas.findFirst({ where: eq(chatConversas.id, input.conversaId) })
      if (!conversa) throw new Error('Conversa não encontrada')

      if (conversa.tipoOrigem !== 'cliente' || !conversa.idOrigem) {
        return { tipoOrigem: conversa.tipoOrigem, idOrigem: conversa.idOrigem, cliente: null }
      }
      const c = await db.query.clientes.findFirst({
        where: eq(clientes.id, conversa.idOrigem),
        columns: { id: true, razaoSocial: true, codigo: true, telefoneWhatsapp: true, email: true, vendedorAtualId: true },
      })
      if (!c) return { tipoOrigem: conversa.tipoOrigem, idOrigem: conversa.idOrigem, cliente: null }
      const vendedor = c.vendedorAtualId ? await db.query.users.findFirst({ where: eq(users.id, c.vendedorAtualId), columns: { name: true } }) : null
      return {
        tipoOrigem: conversa.tipoOrigem,
        idOrigem: conversa.idOrigem,
        cliente: {
          id: c.id,
          razaoSocial: c.razaoSocial,
          codigo: c.codigo,
          telefoneWhatsapp: c.telefoneWhatsapp,
          email: c.email,
          vendedorNome: vendedor?.name ?? null,
        },
      }
    }),

    // Quem participa de uma conversa — alimenta o cabeçalho da janela de
    // chat (avatares) e o botão "+" de adicionar mais gente a qualquer
    // momento (não só na criação).
    participantes: protectedProcedure.input(z.object({ conversaId: z.number() })).query(async ({ ctx, input }) => {
      const souParticipante = await db.query.chatParticipantes.findFirst({
        where: and(eq(chatParticipantes.conversaId, input.conversaId), eq(chatParticipantes.userId, ctx.user.id)),
      })
      if (!souParticipante) throw new Error('Você não participa dessa conversa.')
      const todos = await db.query.chatParticipantes.findMany({ where: eq(chatParticipantes.conversaId, input.conversaId) })
      const pessoas = await db.query.users.findMany({
        where: inArray(
          users.id,
          todos.map((p) => p.userId)
        ),
        columns: { id: true, name: true, fotoUrl: true, chatOnline: true },
      })
      const leituraPorUser = new Map(todos.map((p) => [p.userId, p.ultimaLeituraEm]))
      // `ultimaLeituraEm` de cada um — alimenta o "✓✓ Lido" nas MINHAS
      // mensagens (comparado com a data de cada uma, ver ChatJanela.tsx).
      return pessoas.map((p) => ({ ...p, ultimaLeituraEm: leituraPorUser.get(p.id) ?? null }))
    }),

    // Lista as conversas do usuário logado, mais recente primeiro, com
    // prévia da última mensagem + contagem de não lidas.
    listar: protectedProcedure.query(async ({ ctx }) => {
      const minhas = await db.query.chatParticipantes.findMany({ where: eq(chatParticipantes.userId, ctx.user.id) })
      if (!minhas.length) return []

      const conversas = await db.query.chatConversas.findMany({
        where: inArray(
          chatConversas.id,
          minhas.map((m) => m.conversaId)
        ),
        orderBy: (c, { desc }) => [desc(c.ultimaMensagemEm), desc(c.createdAt)],
      })
      const leituraPorConversa = new Map(minhas.map((m) => [m.conversaId, m.ultimaLeituraEm]))

      const conversaIds = conversas.map((c) => c.id)
      const todosParticipantes = conversaIds.length
        ? await db.query.chatParticipantes.findMany({ where: inArray(chatParticipantes.conversaId, conversaIds) })
        : []
      const outrosIds = [...new Set(todosParticipantes.map((p) => p.userId).filter((id) => id !== ctx.user.id))]
      const outrosUsers = outrosIds.length
        ? await db.query.users.findMany({ where: inArray(users.id, outrosIds), columns: { id: true, name: true, chatOnline: true, fotoUrl: true } })
        : []
      const userPorId = new Map(outrosUsers.map((u) => [u.id, u]))
      const participantesPorConversa = new Map<number, number[]>()
      for (const p of todosParticipantes) {
        const lista = participantesPorConversa.get(p.conversaId) ?? []
        lista.push(p.userId)
        participantesPorConversa.set(p.conversaId, lista)
      }

      const ultimasMensagens = conversaIds.length
        ? await db.query.chatMensagens.findMany({
            where: and(inArray(chatMensagens.conversaId, conversaIds), isNull(chatMensagens.deletedAt)),
            orderBy: (m, { desc }) => [desc(m.createdAt)],
          })
        : []
      const ultimaPorConversa = new Map<number, (typeof ultimasMensagens)[number]>()
      for (const m of ultimasMensagens) {
        if (!ultimaPorConversa.has(m.conversaId)) ultimaPorConversa.set(m.conversaId, m)
      }
      const naoLidasPorConversa = new Map<number, number>()
      for (const m of ultimasMensagens) {
        if (m.autorId === ctx.user.id) continue
        const ultimaLeitura = leituraPorConversa.get(m.conversaId)
        if (!ultimaLeitura || m.createdAt > ultimaLeitura) {
          naoLidasPorConversa.set(m.conversaId, (naoLidasPorConversa.get(m.conversaId) ?? 0) + 1)
        }
      }

      return conversas.map((c) => {
        const outrosDaConversa = (participantesPorConversa.get(c.id) ?? [])
          .filter((id) => id !== ctx.user.id)
          .map((id) => userPorId.get(id))
          .filter((u): u is NonNullable<typeof u> => !!u)
        const ultima = ultimaPorConversa.get(c.id)
        return {
          id: c.id,
          tipoOrigem: c.tipoOrigem,
          idOrigem: c.idOrigem,
          titulo:
            c.tipoOrigem === 'direta' && outrosDaConversa.length
              ? outrosDaConversa.map((u) => u.name).join(', ')
              : c.tituloSnapshot ?? 'Conversa',
          outrosParticipantes: outrosDaConversa,
          ultimaMensagem: ultima
            ? { texto: ultima.texto, tipo: ultima.tipo, autorId: ultima.autorId, createdAt: ultima.createdAt }
            : null,
          naoLidas: naoLidasPorConversa.get(c.id) ?? 0,
          ultimaMensagemEm: c.ultimaMensagemEm,
        }
      })
    }),
  }),

  mensagens: router({
    // `antesDe` pagina pra trás no histórico (mensagem mais antiga já
    // carregada) — a tela pede mais 50 ao rolar pro topo da conversa, até
    // acabar. Sem isso, "histórico completo" só valeria pras últimas 50
    // mensagens. Pedido do João, 2026-10-02.
    listar: protectedProcedure
      .input(z.object({ conversaId: z.number(), antesDe: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        const souParticipante = await db.query.chatParticipantes.findFirst({
          where: and(eq(chatParticipantes.conversaId, input.conversaId), eq(chatParticipantes.userId, ctx.user.id)),
        })
        if (!souParticipante) throw new Error('Você não participa dessa conversa.')

        const filtros = [eq(chatMensagens.conversaId, input.conversaId), isNull(chatMensagens.deletedAt)]
        if (input.antesDe) filtros.push(lt(chatMensagens.createdAt, input.antesDe))
        const msgs = await db.query.chatMensagens.findMany({
          where: and(...filtros),
          orderBy: (m, { desc }) => [desc(m.createdAt)],
          limit: 50,
          with: { autor: { columns: { id: true, name: true, fotoUrl: true } } },
        })
        return { mensagens: msgs.reverse(), temMais: msgs.length === 50 }
      }),

    enviar: protectedProcedure
      .input(
        z.object({
          conversaId: z.number(),
          tipo: z.enum(['texto', 'arquivo', 'imagem', 'video', 'audio']).default('texto'),
          texto: z.string().trim().optional(),
          urlArquivo: z.string().optional(),
          nomeArquivo: z.string().optional(),
          tipoArquivoMime: z.string().optional(),
          duracaoAudioSegundos: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const souParticipante = await db.query.chatParticipantes.findFirst({
          where: and(eq(chatParticipantes.conversaId, input.conversaId), eq(chatParticipantes.userId, ctx.user.id)),
        })
        if (!souParticipante) throw new Error('Você não participa dessa conversa.')
        if (input.tipo === 'texto' && !input.texto?.trim()) throw new Error('Mensagem vazia.')

        const agora = agoraSqlite()
        const result = await db.insert(chatMensagens).values({
          conversaId: input.conversaId,
          autorId: ctx.user.id,
          tipo: input.tipo,
          texto: input.texto?.trim(),
          urlArquivo: input.urlArquivo,
          nomeArquivo: input.nomeArquivo,
          tipoArquivoMime: input.tipoArquivoMime,
          duracaoAudioSegundos: input.duracaoAudioSegundos,
          createdAt: agora,
        })
        await db.update(chatConversas).set({ ultimaMensagemEm: agora }).where(eq(chatConversas.id, input.conversaId))
        // Marca como lida pra quem acabou de mandar — senão a própria
        // mensagem aparece como "não lida" pro autor.
        await db
          .update(chatParticipantes)
          .set({ ultimaLeituraEm: agora })
          .where(and(eq(chatParticipantes.conversaId, input.conversaId), eq(chatParticipantes.userId, ctx.user.id)))

        const participantes = await db.query.chatParticipantes.findMany({ where: eq(chatParticipantes.conversaId, input.conversaId) })
        // Busca a foto fresca do banco — o JWT não carrega fotoUrl (pode ter
        // mudado depois do login), e a bolha da própria mensagem enviada
        // agora precisa mostrar a foto certa sem esperar um F5.
        const autorAtual = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id), columns: { fotoUrl: true } })
        const mensagem = {
          id: Number(result.lastInsertRowid),
          conversaId: input.conversaId,
          autorId: ctx.user.id,
          autor: { id: ctx.user.id, name: ctx.user.name, fotoUrl: autorAtual?.fotoUrl ?? null },
          tipo: input.tipo,
          texto: input.texto?.trim() ?? null,
          urlArquivo: input.urlArquivo ?? null,
          nomeArquivo: input.nomeArquivo ?? null,
          tipoArquivoMime: input.tipoArquivoMime ?? null,
          duracaoAudioSegundos: input.duracaoAudioSegundos ?? null,
          createdAt: agora,
        }
        emitirNovaMensagem(
          input.conversaId,
          participantes.map((p) => p.userId),
          mensagem
        )

        // Pop-up (toast) pra quem NÃO está com essa conversa aberta na hora
        // — ChatContext decide se mostra (compara com qual conversa está
        // aberta agora) ou ignora. Pedido do João, 2026-10-02.
        const preview =
          input.tipo === 'texto'
            ? (input.texto?.trim() ?? '').slice(0, 80)
            : input.tipo === 'imagem'
              ? '📷 Foto'
              : input.tipo === 'video'
                ? '🎥 Vídeo'
                : input.tipo === 'audio'
                  ? '🎤 Áudio'
                  : `📎 ${input.nomeArquivo ?? 'Arquivo'}`
        for (const p of participantes) {
          if (p.userId === ctx.user.id) continue
          emitirParaUsuario(p.userId, 'chat:mensagemRecebida', {
            conversaId: input.conversaId,
            autorNome: ctx.user.name,
            autorFotoUrl: autorAtual?.fotoUrl ?? null,
            preview,
          })
        }

        return mensagem
      }),

    marcarLida: protectedProcedure.input(z.object({ conversaId: z.number() })).mutation(async ({ ctx, input }) => {
      const agora = agoraSqlite()
      await db
        .update(chatParticipantes)
        .set({ ultimaLeituraEm: agora })
        .where(and(eq(chatParticipantes.conversaId, input.conversaId), eq(chatParticipantes.userId, ctx.user.id)))
      // Avisa quem está com essa conversa aberta AGORA (ex: quem mandou a
      // mensagem) pra atualizar o "✓✓ Lido" na hora, sem precisar sair e
      // voltar da tela.
      emitirParaConversa(input.conversaId, 'chat:lida', { conversaId: input.conversaId, userId: ctx.user.id, ultimaLeituraEm: agora })
      return { success: true }
    }),
  }),
})
