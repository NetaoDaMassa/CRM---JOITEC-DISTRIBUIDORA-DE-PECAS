import { router, adminProcedure } from './_base.js'
import { executarBackup, listarBackups } from '../lib/backup.js'

export const backupRouter = router({
  listar: adminProcedure.query(() => listarBackups()),
  rodarAgora: adminProcedure.mutation(() => executarBackup()),
})
