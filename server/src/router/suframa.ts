import { z } from 'zod'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { router, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { suframaClientes, suframaNotas, suframaNotaEventos, clientes, empresas, users } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'

// Controle SUFRAMA (Financeiro) — PIN de cada nota vendida pra cliente da
// Zona Franca. Cross-empresa (mesmo padrão de requisicaoPosto.ts): quem tem
// a permissão `controle_suframa` vê tudo numa tela só. Ver schema.ts.
const FEATURE = 'controle_suframa'

const STATUS = ['pin_solicitado', 'aguardando', 'ok'] as const
const STATUS_LABEL: Record<(typeof STATUS)[number], string> = {
  pin_solicitado: 'PIN solicitado',
  aguardando: 'Aguardando conf. de recebimento',
  ok: 'OK',
}

// Chave de acesso da NF-e: cUF(2) AAMM(4) CNPJ(14) modelo(2) série(3)
// nNF(9) tpEmis(1) cNF(8) DV(1) = 44 dígitos.
export function lerChaveNfe(bruta: string): { chave: string; numeroNota: string; mesEmissao: string; cnpjEmitente: string } {
  const chave = bruta.replace(/\D/g, '')
  if (chave.length !== 44) throw new Error('A chave da nota precisa ter 44 números.')
  return {
    chave,
    mesEmissao: `20${chave.slice(2, 4)}-${chave.slice(4, 6)}`,
    cnpjEmitente: chave.slice(6, 20),
    numeroNota: String(Number(chave.slice(25, 34))),
  }
}

async function registrarEvento(notaId: number, descricao: string, userId: number) {
  await db.insert(suframaNotaEventos).values({ notaId, descricao, userId })
}

export const suframaRouter = router({
  listar: featureProcedure(FEATURE).query(async () => {
    const cs = await db.query.suframaClientes.findMany({
      where: isNull(suframaClientes.deletedAt),
      orderBy: (c, { asc }) => [asc(c.nome), asc(c.codigo)],
    })
    const notas = cs.length
      ? await db.query.suframaNotas.findMany({
          where: and(inArray(suframaNotas.suframaClienteId, cs.map((c) => c.id)), isNull(suframaNotas.deletedAt)),
          orderBy: (n, { desc }) => [desc(n.mesEmissao), desc(n.id)],
        })
      : []
    // Nome em branco (ex.: os "não precisa de PIN" do Word) → usa o do cadastro do CRM.
    const ligados = cs.filter((c) => c.clienteId).map((c) => c.clienteId as number)
    const doCrm = ligados.length
      ? await db.query.clientes.findMany({ where: inArray(clientes.id, ligados), columns: { id: true, razaoSocial: true } })
      : []
    const nomeCrm = new Map(doCrm.map((c) => [c.id, c.razaoSocial]))
    return cs
      .map((c) => ({ ...c, nome: c.nome || (c.clienteId ? (nomeCrm.get(c.clienteId) ?? null) : null), notas: notas.filter((n) => n.suframaClienteId === c.id) }))
      // Quem precisa de PIN primeiro; "não precisa" vai pro fim.
      .sort((a, b) => Number(a.naoPrecisaPin) - Number(b.naoPrecisaPin) || (a.nome ?? a.codigo).localeCompare(b.nome ?? b.codigo, 'pt-BR'))
  }),

  // Acha o cliente no cadastro do CRM pelo código (qualquer empresa) pra
  // preencher nome/telefone sozinho.
  buscarClienteCrm: featureProcedure(FEATURE)
    .input(z.object({ codigo: z.string().min(1) }))
    .query(async ({ input }) => {
      const rows = await db
        .select({ id: clientes.id, razaoSocial: clientes.razaoSocial, telefone: clientes.telefoneWhatsapp, empresa: empresas.nome })
        .from(clientes)
        .innerJoin(empresas, eq(empresas.id, clientes.empresaId))
        .where(and(eq(clientes.codigo, input.codigo.trim().toUpperCase()), isNull(clientes.deletedAt)))
        .limit(5)
      return rows
    }),

  salvarCliente: featureProcedure(FEATURE)
    .input(
      z.object({
        id: z.number().optional(),
        codigo: z.string().min(1),
        nome: z.string().optional(),
        telefone: z.string().optional(),
        naoPrecisaPin: z.boolean(),
        observacao: z.string().optional(),
        clienteId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const dados = {
        codigo: input.codigo.trim().toUpperCase(),
        nome: input.nome?.trim() || null,
        telefone: input.telefone?.trim() || null,
        naoPrecisaPin: input.naoPrecisaPin,
        observacao: input.observacao?.trim() || null,
        clienteId: input.clienteId ?? null,
        updatedAt: agoraSqlite(),
      }
      if (input.id) {
        await db.update(suframaClientes).set(dados).where(eq(suframaClientes.id, input.id))
        return { id: input.id }
      }
      const existente = await db.query.suframaClientes.findFirst({
        where: and(eq(suframaClientes.codigo, dados.codigo), isNull(suframaClientes.deletedAt)),
      })
      if (existente) throw new Error(`O cliente ${dados.codigo} já está no controle.`)
      const [criado] = await db.insert(suframaClientes).values(dados).returning({ id: suframaClientes.id })
      return criado
    }),

  excluirCliente: featureProcedure(FEATURE)
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.update(suframaClientes).set({ deletedAt: agoraSqlite() }).where(eq(suframaClientes.id, input.id))
      return { ok: true }
    }),

  adicionarNota: featureProcedure(FEATURE)
    .input(
      z.object({
        suframaClienteId: z.number(),
        chave: z.string(),
        status: z.enum(STATUS),
        pin: z.string().optional(),
        observacao: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const lida = lerChaveNfe(input.chave)
      const repetida = await db.query.suframaNotas.findFirst({ where: and(eq(suframaNotas.chave, lida.chave), isNull(suframaNotas.deletedAt)) })
      if (repetida) throw new Error(`A nota ${lida.numeroNota} (essa chave) já está cadastrada.`)
      // Nota excluída antes com a mesma chave: reaproveita a linha (chave é única).
      const excluida = await db.query.suframaNotas.findFirst({ where: eq(suframaNotas.chave, lida.chave) })
      const valores = {
        suframaClienteId: input.suframaClienteId,
        ...lida,
        status: input.status,
        pin: input.pin?.trim() || null,
        observacao: input.observacao?.trim() || null,
        criadoPor: ctx.user.id,
        updatedAt: agoraSqlite(),
        deletedAt: null,
      }
      let notaId: number
      if (excluida) {
        await db.update(suframaNotas).set(valores).where(eq(suframaNotas.id, excluida.id))
        notaId = excluida.id
      } else {
        const [criada] = await db.insert(suframaNotas).values(valores).returning({ id: suframaNotas.id })
        notaId = criada.id
      }
      await registrarEvento(notaId, `Nota cadastrada — ${STATUS_LABEL[input.status]}${valores.pin ? ` · PIN ${valores.pin}` : ''}`, ctx.user.id)
      return { id: notaId }
    }),

  atualizarNota: featureProcedure(FEATURE)
    .input(
      z.object({
        id: z.number(),
        status: z.enum(STATUS).optional(),
        pin: z.string().nullable().optional(),
        observacao: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const nota = await db.query.suframaNotas.findFirst({ where: eq(suframaNotas.id, input.id) })
      if (!nota) throw new Error('Nota não encontrada')
      const mudancas: string[] = []
      const set: Partial<typeof suframaNotas.$inferInsert> = { updatedAt: agoraSqlite() }
      if (input.status && input.status !== nota.status) {
        set.status = input.status
        mudancas.push(`Status: ${STATUS_LABEL[nota.status]} → ${STATUS_LABEL[input.status]}`)
      }
      if (input.pin !== undefined) {
        const pin = input.pin?.trim() || null
        if (pin !== nota.pin) {
          set.pin = pin
          mudancas.push(pin ? `PIN: ${pin}` : 'PIN apagado')
        }
      }
      if (input.observacao !== undefined) {
        const obs = input.observacao?.trim() || null
        if (obs !== nota.observacao) {
          set.observacao = obs
          mudancas.push('Observação alterada')
        }
      }
      if (!mudancas.length) return { ok: true }
      await db.update(suframaNotas).set(set).where(eq(suframaNotas.id, input.id))
      await registrarEvento(input.id, mudancas.join(' · '), ctx.user.id)
      return { ok: true }
    }),

  excluirNota: featureProcedure(FEATURE)
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.update(suframaNotas).set({ deletedAt: agoraSqlite() }).where(eq(suframaNotas.id, input.id))
      await registrarEvento(input.id, 'Nota excluída', ctx.user.id)
      return { ok: true }
    }),

  eventos: featureProcedure(FEATURE)
    .input(z.object({ notaId: z.number() }))
    .query(async ({ input }) => {
      return db
        .select({ id: suframaNotaEventos.id, descricao: suframaNotaEventos.descricao, createdAt: suframaNotaEventos.createdAt, usuario: users.name })
        .from(suframaNotaEventos)
        .leftJoin(users, eq(users.id, suframaNotaEventos.userId))
        .where(eq(suframaNotaEventos.notaId, input.notaId))
        .orderBy(desc(suframaNotaEventos.id))
    }),
})
