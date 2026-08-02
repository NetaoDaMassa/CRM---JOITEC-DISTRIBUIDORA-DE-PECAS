import { router, adminProcedure } from './_base.js'
import { executarResumoDiario } from '../lib/resumoDiario.js'

export const resumoDiarioRouter = router({
  // Roda sozinho todo fim de dia (scheduler.ts), mas o admin também pode
  // forçar manualmente — útil pra testar sem esperar o fim do expediente.
  rodarAgora: adminProcedure.mutation(async () => {
    return executarResumoDiario({ forcar: true })
  }),
})
