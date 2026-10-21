// Configurações > Google Drive (Arquivos/Mídia) — conectar/desconectar a
// conta e acompanhar o envio. Só superAdmin: é UMA conta pro CRM inteiro
// (todas as empresas). O callback do OAuth é rota simples em index.ts
// (/api/google-drive/callback). Pedido do João, 2026-10-21.
import { and, count, eq, gte, isNotNull } from 'drizzle-orm'
import { router, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { googleDriveConexao, googleDriveEmpresas, marketingArquivos, marketingPastas } from '../db/schema.js'
import { driveConfigurado, limparTokenCache, revogar, urlAutorizacao } from '../lib/googleDrive.js'

export const googleDriveRouter = router({
  status: superAdminProcedure.query(async () => {
    const conexao = await db.query.googleDriveConexao.findFirst({ where: eq(googleDriveConexao.id, 1) })
    const [pastasPendentes] = await db.select({ n: count() }).from(marketingPastas).where(eq(marketingPastas.driveSyncPendente, true))
    const [arquivosPendentes] = await db.select({ n: count() }).from(marketingArquivos).where(eq(marketingArquivos.driveSyncPendente, true))
    const [enviados] = await db.select({ n: count() }).from(marketingArquivos).where(isNotNull(marketingArquivos.driveFileId))
    const comErro = await db.query.marketingArquivos.findMany({
      where: and(eq(marketingArquivos.driveSyncPendente, true), gte(marketingArquivos.driveTentativas, 5)),
      columns: { id: true, nomeOriginal: true, driveErro: true },
      limit: 20,
    })
    return {
      configurado: driveConfigurado(),
      conectado: !!conexao,
      email: conexao?.email ?? null,
      conectadoEm: conexao?.conectadoEm ?? null,
      pastasPendentes: pastasPendentes.n,
      arquivosPendentes: arquivosPendentes.n,
      arquivosEnviados: enviados.n,
      comErro,
    }
  }),

  urlConexao: superAdminProcedure.mutation(({ ctx }) => ({ url: urlAutorizacao(ctx.user.id) })),

  // Desconectar apaga a ligação com a conta. Os ids do Drive são zerados e
  // tudo volta a "pendente": se conectar de novo (mesma conta ou outra), o
  // CRM monta a estrutura do zero lá. O que já estava no Drive fica lá.
  desconectar: superAdminProcedure.mutation(async () => {
    const conexao = await db.query.googleDriveConexao.findFirst({ where: eq(googleDriveConexao.id, 1) })
    if (conexao) await revogar(conexao.refreshTokenEnc)
    await db.delete(googleDriveConexao).where(eq(googleDriveConexao.id, 1))
    await db.delete(googleDriveEmpresas)
    await db.update(marketingPastas).set({ driveFolderId: null, driveSyncPendente: true })
    await db.update(marketingArquivos).set({ driveFileId: null, driveSyncPendente: true, driveTentativas: 0, driveErro: null })
    limparTokenCache()
    return { ok: true }
  }),

  // Tenta de novo os arquivos que falharam 5 vezes.
  reenviarComErro: superAdminProcedure.mutation(async () => {
    await db
      .update(marketingArquivos)
      .set({ driveTentativas: 0, driveErro: null })
      .where(and(eq(marketingArquivos.driveSyncPendente, true), gte(marketingArquivos.driveTentativas, 5)))
    return { ok: true }
  }),
})
