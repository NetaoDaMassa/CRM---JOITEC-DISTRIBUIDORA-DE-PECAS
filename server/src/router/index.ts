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
import { designRouter } from './design.js'
import { financeiroRouter } from './financeiro.js'
import { vinculosRouter } from './vinculos.js'
import { emailsRouter } from './emails.js'
import { activityRouter } from './activity.js'
import { caixaRouter } from './caixa.js'
import { comprasRouter } from './compras.js'
import { permissoesRouter } from './permissoes.js'
import { contasVinculadasRouter } from './contasVinculadas.js'
import { integracoesRouter } from './integracoes.js'
import { pabxRouter } from './pabx.js'
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
  design: designRouter,
  financeiro: financeiroRouter,
  vinculos: vinculosRouter,
  emails: emailsRouter,
  activity: activityRouter,
  caixa: caixaRouter,
  compras: comprasRouter,
  permissoes: permissoesRouter,
  contasVinculadas: contasVinculadasRouter,
  integracoes: integracoesRouter,
  pabx: pabxRouter,
})

export type AppRouter = typeof appRouter
