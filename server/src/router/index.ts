import { authRouter } from './auth.js'
import { clientesRouter } from './clientes.js'
import { funilRouter } from './funil.js'
import { contatosRouter } from './contatos.js'
import { carteiraRouter } from './carteira.js'
import { usersRouter } from './users.js'
import { reportsRouter } from './reports.js'
import { notificationsRouter } from './notifications.js'
import { messageTemplatesRouter } from './messageTemplates.js'
import { configuracoesRouter } from './configuracoes.js'
import { metasRouter } from './metas.js'
import { painelRouter } from './painel.js'
import { backupRouter } from './backup.js'
import { resumoDiarioRouter } from './resumoDiario.js'
import { gotoRouter } from './goto.js'
import { compromissosRouter } from './compromissos.js'
import { vendasRouter } from './vendas.js'
import { pedidosRouter } from './pedidos.js'
import { empresasRouter } from './empresas.js'
import { maquinasRouter } from './maquinas.js'
import { telefonesRouter } from './telefones.js'
import { prospeccaoRouter } from './prospeccao.js'
import { aprovacoesRouter } from './aprovacoes.js'
import { router } from './_base.js'

export { router, publicProcedure, protectedProcedure, adminProcedure } from './_base.js'

export const appRouter = router({
  auth: authRouter,
  clientes: clientesRouter,
  funil: funilRouter,
  contatos: contatosRouter,
  carteira: carteiraRouter,
  users: usersRouter,
  reports: reportsRouter,
  notifications: notificationsRouter,
  messageTemplates: messageTemplatesRouter,
  configuracoes: configuracoesRouter,
  metas: metasRouter,
  painel: painelRouter,
  backup: backupRouter,
  resumoDiario: resumoDiarioRouter,
  goto: gotoRouter,
  compromissos: compromissosRouter,
  vendas: vendasRouter,
  pedidos: pedidosRouter,
  empresas: empresasRouter,
  maquinas: maquinasRouter,
  telefones: telefonesRouter,
  prospeccao: prospeccaoRouter,
  aprovacoes: aprovacoesRouter,
})

export type AppRouter = typeof appRouter
