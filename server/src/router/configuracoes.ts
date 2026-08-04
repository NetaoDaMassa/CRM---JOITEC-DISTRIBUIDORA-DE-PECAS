import { z } from 'zod'
import { router, adminProcedure, protectedProcedure } from './_base.js'
import { getConfigNumero, setConfig } from '../lib/configuracoes.js'

const CHAVES_NUMERICAS = {
  senha_max_tentativas_login: 5,
  senha_bloqueio_minutos: 15,
  meta_faturamento_padrao: 100000,
  meta_ligacoes_dia_padrao: 25,
  dias_sem_contato_alerta: 7,
  backup_retencao_dias: 30,
  goto_duracao_minima_segundos: 15,
  // Horário de expediente (seg-sex — fim de semana não trabalha, já fixo no
  // resto do sistema). Guardado como hora/minuto separados (em vez de uma
  // string "HH:MM") pra caber no mesmo esquema chave/valor numérico já usado
  // por toda essa tabela, sem precisar de um tipo de config à parte.
  expediente_inicio_hora: 8,
  expediente_inicio_minuto: 0,
  expediente_fim_hora: 17,
  expediente_fim_minuto: 48,
  expediente_almoco_inicio_hora: 12,
  expediente_almoco_inicio_minuto: 0,
  expediente_almoco_fim_hora: 13,
  expediente_almoco_fim_minuto: 0,
  // Quantos segundos cada slide do Painel de TV fica na tela antes de trocar
  // pro próximo (carrossel automático) — pedido do João pra poder ajustar
  // sem precisar mexer em código.
  painel_tv_segundos_por_slide: 30,
} as const

export const configuracoesRouter = router({
  get: adminProcedure.query(async ({ ctx }) => {
    const entradas = await Promise.all(
      Object.entries(CHAVES_NUMERICAS).map(async ([chave, padrao]) => [chave, await getConfigNumero(chave, padrao)] as const)
    )
    // Meta de faturamento da empresa inteira no mês — por empresa (não
    // compartilhada, diferente do resto dessas configs), por isso fora do
    // loop genérico acima: a chave leva o empresaId embutido.
    const metaFaturamentoEmpresa = await getConfigNumero(`meta_faturamento_empresa_${ctx.empresaId}`, 0)
    return {
      ...Object.fromEntries(entradas),
      meta_faturamento_empresa: metaFaturamentoEmpresa,
    } as Record<keyof typeof CHAVES_NUMERICAS, number> & { meta_faturamento_empresa: number }
  }),

  set: adminProcedure
    .input(
      z.object({
        senha_max_tentativas_login: z.number().min(1).optional(),
        senha_bloqueio_minutos: z.number().min(1).optional(),
        meta_faturamento_padrao: z.number().min(0).optional(),
        meta_ligacoes_dia_padrao: z.number().min(0).optional(),
        meta_faturamento_empresa: z.number().min(0).optional(),
        dias_sem_contato_alerta: z.number().min(1).optional(),
        backup_retencao_dias: z.number().min(1).optional(),
        goto_duracao_minima_segundos: z.number().min(0).optional(),
        expediente_inicio_hora: z.number().min(0).max(23).optional(),
        expediente_inicio_minuto: z.number().min(0).max(59).optional(),
        expediente_fim_hora: z.number().min(0).max(23).optional(),
        expediente_fim_minuto: z.number().min(0).max(59).optional(),
        expediente_almoco_inicio_hora: z.number().min(0).max(23).optional(),
        expediente_almoco_inicio_minuto: z.number().min(0).max(59).optional(),
        expediente_almoco_fim_hora: z.number().min(0).max(23).optional(),
        expediente_almoco_fim_minuto: z.number().min(0).max(59).optional(),
        painel_tv_segundos_por_slide: z.number().min(3).max(300).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { meta_faturamento_empresa, ...resto } = input
      if (meta_faturamento_empresa !== undefined) {
        await setConfig(`meta_faturamento_empresa_${ctx.empresaId}`, meta_faturamento_empresa)
      }
      for (const [chave, valor] of Object.entries(resto)) {
        if (valor !== undefined) await setConfig(chave, valor)
      }
      return { success: true }
    }),

  // Só esse valor específico, liberado pra qualquer usuário autenticado (não
  // só admin) — o Painel de TV (`/painel-tv`) não é uma rota admin-only, e
  // precisa ler o intervalo do carrossel sem exigir permissão de admin.
  painelTvSegundosPorSlide: protectedProcedure.query(async () => {
    return getConfigNumero('painel_tv_segundos_por_slide', CHAVES_NUMERICAS.painel_tv_segundos_por_slide)
  }),
})
