import { router } from '../_base.js'
import { ordensCoreRouter } from './core.js'
import { ordensFinanceiroRouter } from './financeiro.js'
import { ordensFreteRouter } from './frete.js'
import { ordensPreparacaoRouter } from './preparacao.js'
import { ordensFaturamentoRouter } from './faturamento.js'
import { ordensConferenciaRouter } from './conferencia.js'
import { ordensPosRouter } from './pos.js'
import { ordensAnexosRouter } from './anexos.js'

export const ordensRouter = router({
  core: ordensCoreRouter,
  financeiro: ordensFinanceiroRouter,
  frete: ordensFreteRouter,
  preparacao: ordensPreparacaoRouter,
  faturamento: ordensFaturamentoRouter,
  conferencia: ordensConferenciaRouter,
  pos: ordensPosRouter,
  anexos: ordensAnexosRouter,
})
