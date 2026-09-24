import { z } from 'zod'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { restricoesCredito, clientes, empresas, users } from '../db/schema.js'
import { limparCnpj } from '../lib/cnpj.js'
import { limparCpf } from '../lib/cpf.js'

// Restrição de Crédito — cross-empresa por design, mesmo padrão de
// liberacaoCredito/requisicao_posto/grupo_odin: quem tem a permissão
// 'restricao_credito' vê/lança pra TODAS as empresas do grupo. Nenhuma
// query aqui filtra por ctx.empresaId de propósito.
export const restricaoCreditoRouter = router({
  listar: adminProcedure.query(async () => {
    return db
      .select({
        id: restricoesCredito.id,
        clienteId: restricoesCredito.clienteId,
        clienteNome: clientes.razaoSocial,
        clienteCodigo: clientes.codigo,
        clienteCnpj: clientes.cnpj,
        clienteCpf: clientes.cpf,
        empresaId: restricoesCredito.empresaId,
        empresaNome: empresas.nome,
        quantidadePendencias: restricoesCredito.quantidadePendencias,
        valorPendencia: restricoesCredito.valorPendencia,
        motivo: restricoesCredito.motivo,
        createdAt: restricoesCredito.createdAt,
      })
      .from(restricoesCredito)
      .innerJoin(clientes, eq(clientes.id, restricoesCredito.clienteId))
      .innerJoin(empresas, eq(empresas.id, restricoesCredito.empresaId))
      .orderBy(desc(restricoesCredito.createdAt))
      .limit(1000)
  }),

  remover: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await db.delete(restricoesCredito).where(eq(restricoesCredito.id, input.id))
    return { success: true }
  }),

  // Carga em lote — cola um relatório externo (CNPJ/CPF, razão social, nome
  // da empresa por extenso, quantidade de pendências, valor em aberto),
  // separado por tab ou 2+ espaços, uma linha por cliente. Cruza por
  // documento (CNPJ/CPF) dentro da empresa certa; não achando, CRIA um
  // cliente novo (sem vendedor, sem região — completa depois quem for
  // trabalhar a conta). Pedido do João, 2026-09-24.
  importarLote: adminProcedure
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
      // empresa no CRM (como aparece no seletor). Confirmado com o João,
      // 2026-09-24.
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
      let atualizados = 0
      const erros: { linha: number; motivo: string }[] = []

      for (let i = 0; i < linhas.length; i++) {
        const numeroLinha = i + 1
        const partes = linhas[i]
          .split(/\t| {2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
        // Formato esperado: documento, razão social, empresa (nome jurídico),
        // quantidade, valor — pelo menos 5 pedaços depois de dividir.
        if (partes.length < 5) {
          erros.push({ linha: numeroLinha, motivo: `Não consegui separar as colunas ("${linhas[i].slice(0, 60)}...")` })
          continue
        }

        const documentoRaw = partes[0]
        const razaoSocial = partes[1]
        // Empresa pode ter vindo com espaço extra separando palavras (já
        // dividido pelo split acima) — junta tudo entre razão social e os 2
        // últimos campos (quantidade/valor), que são sempre numéricos.
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

        const restricaoExistente = await db.query.restricoesCredito.findFirst({
          where: eq(restricoesCredito.clienteId, cliente.id),
        })
        if (restricaoExistente) {
          await db
            .update(restricoesCredito)
            .set({
              quantidadePendencias,
              valorPendencia,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(restricoesCredito.id, restricaoExistente.id))
        } else {
          await db.insert(restricoesCredito).values({
            clienteId: cliente.id,
            empresaId: empresaAlvo.id,
            quantidadePendencias,
            valorPendencia,
            motivo: 'Carga inicial (relatório de inadimplência)',
            criadoPor: ctx.user.id,
          })
        }
        atualizados++
      }

      return { total: linhas.length, criados, atualizados, erros }
    }),
})
