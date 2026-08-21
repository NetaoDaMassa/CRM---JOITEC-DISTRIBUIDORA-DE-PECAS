import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas } from '../db/schema.js'
import { getConfigNumero, getConfigTexto } from '../lib/configuracoes.js'
import { buscarChamadasPabxone360 } from '../lib/pabxone360.js'

// Integração de TESTE com a PABXONE360 — só Odin Tubos e Conexões usa esse
// PABX hoje, e os ramais ainda são compartilhados (não 1 por vendedora), por
// isso isso não grava nada em registro_contato ainda, só devolve o resumo
// pra conferir se a API está trazendo os números certos. superAdminProcedure
// de propósito (só o João testa isso por enquanto, não é uma tela de
// vendedor/admin normal).
const SLUG_ODIN_TUBOS = 'odin-tubos'

export const pabxRouter = router({
  resumoChamadasOdinTubos: superAdminProcedure
    .input(z.object({ dataInicio: z.string(), dataFim: z.string() }))
    .query(async ({ input }) => {
      const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, SLUG_ODIN_TUBOS) })
      if (!empresa) throw new Error('Empresa Odin Tubos e Conexões não encontrada')

      const [usuario, token] = await Promise.all([
        getConfigTexto('pabxone360_usuario'),
        getConfigTexto('pabxone360_token'),
      ])
      if (!usuario || !token) throw new Error('Credenciais da PABXONE360 não configuradas')

      const duracaoMinima = await getConfigNumero('pabxone360_duracao_minima_segundos', 15)

      const inicio = new Date(`${input.dataInicio}T00:00:00`)
      const fim = new Date(`${input.dataFim}T23:59:59`)
      const chamadas = await buscarChamadasPabxone360(usuario, token, inicio, fim, duracaoMinima)

      const semRamal = chamadas.filter((c) => !c.ramal).length
      const efetivas = chamadas.filter((c) => c.efetiva).length

      return {
        tentativas: chamadas.length,
        efetivas,
        semRamal,
        duracaoMinimaSegundos: duracaoMinima,
        chamadas,
      }
    }),
})
