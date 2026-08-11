import { eq, and } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { atividadeDiariaUsuario } from '../db/schema.js'
import { toUtcISO, toLocalDateKey } from '../lib/businessHours.js'

// O frontend manda um ping a cada ~60s enquanto a aba está em foco. Um gap
// maior que isso (aba fechada, computador dormindo, troca de aba por horas)
// não vira tempo online — só soma o intervalo entre pings quando ele é
// plausivelmente contínuo.
const MAX_GAP_SECONDS = 150

export const activityRouter = router({
  ping: protectedProcedure.mutation(async ({ ctx }) => {
    const now = new Date()
    const nowISO = now.toISOString()
    const hoje = toLocalDateKey(nowISO)

    const existente = await db.query.atividadeDiariaUsuario.findFirst({
      where: and(eq(atividadeDiariaUsuario.usuarioId, ctx.user.id), eq(atividadeDiariaUsuario.data, hoje)),
    })

    if (!existente) {
      await db.insert(atividadeDiariaUsuario).values({
        usuarioId: ctx.user.id,
        data: hoje,
        segundosOnline: 0,
        primeiroPingEm: nowISO,
        ultimoPingEm: nowISO,
      })
      return { success: true }
    }

    const gapSegundos = (now.getTime() - new Date(toUtcISO(existente.ultimoPingEm)).getTime()) / 1000
    const addSegundos = gapSegundos > 0 && gapSegundos <= MAX_GAP_SECONDS ? Math.round(gapSegundos) : 0

    await db
      .update(atividadeDiariaUsuario)
      .set({ segundosOnline: existente.segundosOnline + addSegundos, ultimoPingEm: nowISO })
      .where(eq(atividadeDiariaUsuario.id, existente.id))

    return { success: true }
  }),
})
