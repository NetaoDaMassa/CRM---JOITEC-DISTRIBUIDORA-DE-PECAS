// "Gerar proposta" (Odin Compressores) — pedido do João, 2026-11-17. A
// pessoa que monta as propostas preenche cliente/itens/valores/pagamento
// uma vez aqui; o CRM monta o PDF a partir dos PowerPoints modelo da Odin
// (lib/propostaModelo) e anexa na proposta como "PDF da Proposta".
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, propostas, propostaArquivos, propostaHistorico, users } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { assertDonoOuGestor } from '../lib/propostasGates.js'
import { documentoValido } from '../lib/documentoCliente.js'
import { carregarBiblioteca, montarPptx, converterPdf, type DadosGeracao } from '../lib/propostaModelo/gerar.js'

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads'

async function obterProposta(propostaId: number, empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== 'odin-compressores') throw new TRPCError({ code: 'FORBIDDEN', message: 'Disponível só pra Odin Compressores' })
  const proposta = await db.query.propostas.findFirst({ where: and(eq(propostas.id, propostaId), eq(propostas.empresaId, empresaId)) })
  if (!proposta) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposta não encontrada' })
  return proposta
}

function biblioteca() {
  const bib = carregarBiblioteca()
  if (!bib) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Os modelos de proposta ainda não foram carregados no servidor' })
  return bib
}

const DadosSchema = z.object({
  conjunto: z.string().min(1, 'Escolha o conjunto'),
  numero: z.string(),
  data: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Data no formato dd/mm/aaaa'),
  cliente: z.object({
    razao: z.string().trim().min(1, 'Informe a razão social do cliente'),
    cnpj: z.string(),
    ie: z.string(),
    endereco: z.string(),
    bairro: z.string(),
    cidade: z.string(),
    contato: z.string(),
    email: z.string(),
    telefone: z.string(),
  }),
  itens: z
    .array(
      z.object({
        ficha: z.string().nullable(),
        descricao: z.string().trim().min(1, 'Todo item precisa de descrição'),
        qtd: z.number().int().min(1),
        valor: z.number().min(0),
        valor2: z.number().min(0).nullable().optional(),
      })
    )
    .min(1, 'A proposta precisa de pelo menos 1 item'),
  pagamento: z.object({
    tipo: z.enum(['normal', 'dupla', 'credito']),
    condicao: z.string(),
    entrega: z.string(),
    frete: z.string(),
    validade: z.string(),
    credito: z.number().min(0).nullable().optional(),
  }),
  assinatura: z.array(z.string()),
})

const hojeBr = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

function formatarFone(f: string | null | undefined): string {
  const d = (f ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return f ?? ''
}

// Nome do arquivo igual ao que o comercial já usa:
// "Proposta Comercial D.C012599 - Conjunto OD100F 380V - Cervejaria Nova Malta.pdf"
function nomeArquivo(d: DadosGeracao, conjuntoNome: string) {
  const limpar = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return limpar(`Proposta Comercial ${d.numero || ''} - ${conjuntoNome} - ${d.cliente.razao}`) + '.pdf'
}

export const propostaGeradorRouter = router({
  // Conjuntos (cada modelo "Proposta Comercial Modelo - Conjunto X") com os
  // itens padrão, e todas as fichas técnicas pra acrescentar item avulso.
  modelos: adminOrFeatureProcedure('propostas_odin').query(() => {
    const bib = carregarBiblioteca()
    if (!bib) return { disponivel: false as const, conjuntos: [], fichas: [], avisos: [] }
    const c = bib.catalogo
    return {
      disponivel: true as const,
      conjuntos: c.conjuntos.map((x) => ({ id: x.id, nome: x.nome, itens: x.itens })),
      fichas: c.fichas.map((f) => ({ id: f.id, familia: f.familia, titulo: f.titulo, codigo: f.codigo, descricao: f.descricao })),
      avisos: c.avisos,
      temDupla: !!c.condicoes.dupla,
      temCredito: !!c.condicoes.credito,
    }
  }),

  // O que já foi preenchido antes nessa proposta (ou uma sugestão inicial a
  // partir do card: nome do cliente, WhatsApp, Cód. SAP, vendedor).
  dados: adminOrFeatureProcedure('propostas_odin')
    .input(z.object({ propostaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const p = await obterProposta(input.propostaId, ctx.empresaId)
      const vendedor = await db.query.users.findFirst({ where: eq(users.id, p.vendedorId), columns: { name: true, whatsapp: true } })
      let salvos: DadosGeracao | null = null
      try {
        salvos = p.geracaoDados ? JSON.parse(p.geracaoDados) : null
      } catch {
        salvos = null
      }
      const assinatura = [vendedor ? [vendedor.name, formatarFone(vendedor.whatsapp)].filter(Boolean).join(' – ') : '']
      return {
        salvos,
        sugestao: {
          numero: p.codSap ? `D.${p.codSap.trim()}` : '',
          cnpj: p.cnpj ?? '',
          data: hojeBr(),
          clienteNome: p.clienteNome.trim(),
          clienteWhatsapp: p.clienteWhatsapp ?? '',
          assinatura,
          formaPagamentoCard: p.formaPagamento ?? '',
          produtosCard: p.produtosItens ?? '',
        },
      }
    }),

  salvar: adminOrFeatureProcedure('propostas_odin')
    .input(z.object({ propostaId: z.number(), dados: DadosSchema.partial().passthrough() }))
    .mutation(async ({ ctx, input }) => {
      const p = await obterProposta(input.propostaId, ctx.empresaId)
      assertDonoOuGestor(p, ctx.user.id, ctx.user.role)
      await db.update(propostas).set({ geracaoDados: JSON.stringify(input.dados) }).where(eq(propostas.id, p.id))
      return { ok: true }
    }),

  // formato 'pdf' → gera, salva como "PDF da Proposta" do card e devolve o
  // arquivo. 'pptx' → só devolve o PowerPoint preenchido (pra ajuste manual
  // num caso fora do padrão), sem anexar nada.
  gerar: adminOrFeatureProcedure('propostas_odin')
    .input(z.object({ propostaId: z.number(), dados: DadosSchema, formato: z.enum(['pdf', 'pptx']) }))
    .mutation(async ({ ctx, input }) => {
      const p = await obterProposta(input.propostaId, ctx.empresaId)
      assertDonoOuGestor(p, ctx.user.id, ctx.user.role)
      const bib = biblioteca()
      const d = input.dados as DadosGeracao
      const conjunto = bib.catalogo.conjuntos.find((c) => c.id === d.conjunto)
      if (!conjunto) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Conjunto não encontrado nos modelos' })
      // CNPJ digitado aqui completa a proposta que ainda não tinha.
      const docGerado = d.cliente.cnpj.replace(/\D/g, '')
      const completaCnpj = !p.cnpj && documentoValido(docGerado) ? { cnpj: docGerado } : {}
      await db.update(propostas).set({ geracaoDados: JSON.stringify(d), ...completaCnpj }).where(eq(propostas.id, p.id))

      let pptx: Buffer
      try {
        pptx = montarPptx(bib, d)
      } catch (e) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Não deu pra montar a proposta: ${(e as Error).message}` })
      }
      const nome = nomeArquivo(d, conjunto.nome)
      if (input.formato === 'pptx') {
        return { formato: 'pptx' as const, nome: nome.replace(/\.pdf$/, '.pptx'), base64: pptx.toString('base64') }
      }

      let pdf: Buffer
      try {
        pdf = await converterPdf(pptx)
      } catch (e) {
        console.error('[proposta] falha ao converter pra PDF:', e)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Não deu pra transformar a proposta em PDF agora — tente de novo em instantes' })
      }
      const armazenado = `prop-${randomUUID()}.pdf`
      fs.mkdirSync(UPLOADS_DIR, { recursive: true })
      fs.writeFileSync(path.join(UPLOADS_DIR, armazenado), pdf)
      const r = await db.insert(propostaArquivos).values({
        propostaId: p.id,
        fileCategory: 'proposta_pdf',
        nomeOriginal: nome,
        nomeArmazenado: armazenado,
        tipoArquivo: 'application/pdf',
        tamanhoBytes: pdf.length,
        enviadoPor: ctx.user.id,
      })
      const total = d.itens.reduce((s, it) => s + it.valor * 1, 0)
      await db.insert(propostaHistorico).values({
        propostaId: p.id,
        userId: ctx.user.id,
        etapaAnterior: p.stage,
        etapaNova: p.stage,
        nota: `Proposta gerada pelo CRM (${conjunto.nome}, ${d.itens.length} ${d.itens.length === 1 ? 'item' : 'itens'}, total R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`,
      })
      await db.update(propostas).set({ updatedAt: agoraSqlite() }).where(eq(propostas.id, p.id))
      return { formato: 'pdf' as const, arquivoId: Number(r.lastInsertRowid), nome, nomeArmazenado: armazenado }
    }),
})
