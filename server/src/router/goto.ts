import { router, adminProcedure } from './_base.js'
import { montarUrlAutorizacao, statusConexao, desconectar, pararListener } from '../lib/goto.js'

export const gotoRouter = router({
  status: adminProcedure.query(() => statusConexao()),

  urlConexao: adminProcedure.query(() => ({ url: montarUrlAutorizacao() })),

  desconectar: adminProcedure.mutation(async () => {
    await desconectar()
    pararListener()
    return { success: true }
  }),
})
