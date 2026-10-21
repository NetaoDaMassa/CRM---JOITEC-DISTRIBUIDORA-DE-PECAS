// Espelha Arquivos/Mídia no Google Drive (só CRM → Drive). Roda a cada
// minuto pelo scheduler; cada pasta/arquivo tem `driveSyncPendente`, ligado
// pelas mutations de marketing.ts quando algo muda (criar, renomear, mover,
// mudar acesso, ligar "somente visualização"). Excluir no CRM NÃO apaga no
// Drive (pedido do João, 2026-10-21: o Drive vira o histórico).
//
// Estrutura no Drive:
//   Arquivos CRM/<Empresa>/...            ← "qualquer pessoa com o link vê"
//   Arquivos CRM - Restritos/<Empresa>/   ← sem link; pasta com controle de
//                                           acesso no CRM vai pra cá, com o
//                                           caminho completo no nome
// No Gmail comum, compartilhar uma pasta compartilha tudo dentro — não dá
// pra "esconder" uma subpasta, por isso as restritas ficam numa árvore à
// parte.
//
// Tudo aqui é assíncrono (fetch/stream) e com tempo máximo por rodada — não
// pode travar o servidor (ver travadas de 2026-10-21, scheduler.ts).
import fs from 'fs'
import path from 'path'
import { and, eq, inArray, lt } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, googleDriveConexao, googleDriveEmpresas, marketingArquivos, marketingPastaAcessos, marketingPastas } from '../db/schema.js'
import { abrirPraQuemTemLink, atualizar, criarPasta, driveConfigurado, enviarArquivo } from './googleDrive.js'

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads'
const MAX_TENTATIVAS = 5
const TEMPO_MAX_RODADA_MS = 50_000
// Prévia local usa outro nome (ex.: "Arquivos CRM (teste)") pra não misturar
// com as pastas de verdade na mesma conta.
const NOME_RAIZ = process.env.GOOGLE_DRIVE_RAIZ ?? 'Arquivos CRM'

const eh404 = (err: unknown) => String(err).includes('Google Drive 404')

// Marca uma pasta, as subpastas e os arquivos de dentro pra sincronizar de
// novo (mover/renomear/mudar acesso muda o lugar ou o nome no Drive).
export async function marcarPastaPendente(empresaId: number, pastaId: number) {
  const todas = await db.query.marketingPastas.findMany({ where: eq(marketingPastas.empresaId, empresaId), columns: { id: true, pastaPaiId: true } })
  const ids = new Set([pastaId])
  let cresceu = true
  while (cresceu) {
    cresceu = false
    for (const p of todas) {
      if (p.pastaPaiId !== null && ids.has(p.pastaPaiId) && !ids.has(p.id)) {
        ids.add(p.id)
        cresceu = true
      }
    }
  }
  await db.update(marketingPastas).set({ driveSyncPendente: true }).where(inArray(marketingPastas.id, [...ids]))
  await db.update(marketingArquivos).set({ driveSyncPendente: true, driveTentativas: 0 }).where(inArray(marketingArquivos.pastaId, [...ids]))
}

export async function marcarArquivoPendente(arquivoId: number) {
  await db.update(marketingArquivos).set({ driveSyncPendente: true, driveTentativas: 0, driveErro: null }).where(eq(marketingArquivos.id, arquivoId))
}

let rodando = false

export async function sincronizarGoogleDrive(): Promise<void> {
  if (rodando || !driveConfigurado()) return
  const conexao = await db.query.googleDriveConexao.findFirst({ where: eq(googleDriveConexao.id, 1) })
  if (!conexao) return
  rodando = true
  const limite = Date.now() + TEMPO_MAX_RODADA_MS
  try {
    await rodada(conexao, limite)
  } finally {
    rodando = false
  }
}

async function rodada(conexao: typeof googleDriveConexao.$inferSelect, limite: number) {
  const pastasPendentes = await db.query.marketingPastas.findMany({ where: eq(marketingPastas.driveSyncPendente, true), columns: { id: true } })
  const arquivosPendentes = await db.query.marketingArquivos.findMany({
    where: and(eq(marketingArquivos.driveSyncPendente, true), lt(marketingArquivos.driveTentativas, MAX_TENTATIVAS)),
    orderBy: (a, { asc }) => [asc(a.id)],
  })
  if (!pastasPendentes.length && !arquivosPendentes.length) return

  // Raízes "Arquivos CRM" e "Arquivos CRM - Restritos".
  let raiz = conexao.raizFolderId
  if (!raiz) {
    raiz = await criarPasta(NOME_RAIZ, null)
    await db.update(googleDriveConexao).set({ raizFolderId: raiz }).where(eq(googleDriveConexao.id, 1))
  }
  let raizRestritos = conexao.restritosFolderId
  async function garantirRaizRestritos() {
    if (!raizRestritos) {
      raizRestritos = await criarPasta(`${NOME_RAIZ} - Restritos`, null)
      await db.update(googleDriveConexao).set({ restritosFolderId: raizRestritos }).where(eq(googleDriveConexao.id, 1))
    }
    return raizRestritos
  }

  // Pasta de cada empresa (normal e restritos), criada na primeira vez.
  const nomesEmpresas = new Map((await db.query.empresas.findMany({ columns: { id: true, nome: true } })).map((e) => [e.id, e.nome]))
  const pastasEmpresa = new Map((await db.query.googleDriveEmpresas.findMany()).map((e) => [e.empresaId, e]))
  async function pastaEmpresa(empresaId: number, restrita: boolean): Promise<string> {
    let linha = pastasEmpresa.get(empresaId)
    if (!linha) {
      await db.insert(googleDriveEmpresas).values({ empresaId })
      linha = { empresaId, folderId: null, restritosFolderId: null }
      pastasEmpresa.set(empresaId, linha)
    }
    const nome = nomesEmpresas.get(empresaId) ?? `Empresa ${empresaId}`
    if (restrita) {
      if (!linha.restritosFolderId) {
        linha.restritosFolderId = await criarPasta(nome, await garantirRaizRestritos())
        await db.update(googleDriveEmpresas).set({ restritosFolderId: linha.restritosFolderId }).where(eq(googleDriveEmpresas.empresaId, empresaId))
      }
      return linha.restritosFolderId
    }
    if (!linha.folderId) {
      linha.folderId = await criarPasta(nome, raiz)
      // Só a pasta da empresa abre pra quem tem o link — vale pro que está
      // dentro. A raiz e a árvore de restritos continuam fechadas.
      await abrirPraQuemTemLink(linha.folderId)
      await db.update(googleDriveEmpresas).set({ folderId: linha.folderId }).where(eq(googleDriveEmpresas.empresaId, empresaId))
    }
    return linha.folderId
  }

  // Árvore inteira das pastas (são poucas — dezenas/centenas).
  const todas = await db.query.marketingPastas.findMany()
  const porId = new Map(todas.map((p) => [p.id, p]))
  const comAcesso = new Set((await db.query.marketingPastaAcessos.findMany({ columns: { pastaId: true } })).map((a) => a.pastaId))
  const profundidade = (id: number): number => {
    let n = 0
    for (let p = porId.get(id); p?.pastaPaiId; p = porId.get(p.pastaPaiId)) n++
    return n
  }
  const caminho = (id: number): string => {
    const nomes: string[] = []
    for (let p = porId.get(id); p; p = p.pastaPaiId ? porId.get(p.pastaPaiId) : undefined) nomes.unshift(p.nome)
    return nomes.join(' / ')
  }

  // 1) Pastas — de cima pra baixo (a mãe precisa existir antes da filha).
  const ordem = pastasPendentes.map((p) => p.id).sort((a, b) => profundidade(a) - profundidade(b))
  for (const id of ordem) {
    if (Date.now() > limite) return
    const p = porId.get(id)
    if (!p) continue
    const restritaRaiz = comAcesso.has(p.id)
    const paiId = restritaRaiz
      ? await pastaEmpresa(p.empresaId, true)
      : p.pastaPaiId
        ? porId.get(p.pastaPaiId)?.driveFolderId ?? null
        : await pastaEmpresa(p.empresaId, false)
    if (!paiId) continue // mãe ainda não foi pro Drive — próxima rodada
    const nome = restritaRaiz ? caminho(p.id) : p.nome
    try {
      if (p.driveFolderId) {
        try {
          await atualizar(p.driveFolderId, { nome, paiId })
        } catch (err) {
          if (!eh404(err)) throw err
          p.driveFolderId = null // apagada à mão no Drive — recria
        }
      }
      if (!p.driveFolderId) {
        p.driveFolderId = await criarPasta(nome, paiId)
        // Id novo: subpastas e arquivos de dentro precisam ir pro lugar novo.
        await db.update(marketingPastas).set({ driveSyncPendente: true }).where(eq(marketingPastas.pastaPaiId, p.id))
        await db.update(marketingArquivos).set({ driveSyncPendente: true }).where(eq(marketingArquivos.pastaId, p.id))
      }
      await db.update(marketingPastas).set({ driveFolderId: p.driveFolderId, driveSyncPendente: false }).where(eq(marketingPastas.id, p.id))
    } catch (err) {
      console.error(`[google-drive] pasta ${p.id} "${p.nome}":`, err)
    }
  }

  // 2) Arquivos — um por vez, até acabar o tempo da rodada.
  for (const a of arquivosPendentes) {
    if (Date.now() > limite) return
    const paiId = a.pastaId ? porId.get(a.pastaId)?.driveFolderId ?? null : await pastaEmpresa(a.empresaId, false)
    if (!paiId) continue
    const dados = { nome: a.nomeOriginal, paiId, bloquearDownload: a.somenteVisualizacao }
    try {
      let fileId = a.driveFileId
      if (fileId) {
        try {
          await atualizar(fileId, dados)
        } catch (err) {
          if (!eh404(err)) throw err
          fileId = null
        }
      }
      if (!fileId) {
        const caminhoDisco = path.resolve(UPLOADS_DIR, a.nomeArmazenado)
        if (!fs.existsSync(caminhoDisco)) {
          await db
            .update(marketingArquivos)
            .set({ driveTentativas: MAX_TENTATIVAS, driveErro: 'Arquivo não está mais no servidor' })
            .where(eq(marketingArquivos.id, a.id))
          continue
        }
        fileId = await enviarArquivo(caminhoDisco, { ...dados, mime: a.tipoArquivo })
      }
      await db
        .update(marketingArquivos)
        .set({ driveFileId: fileId, driveSyncPendente: false, driveTentativas: 0, driveErro: null })
        .where(eq(marketingArquivos.id, a.id))
    } catch (err) {
      console.error(`[google-drive] arquivo ${a.id} "${a.nomeOriginal}":`, err)
      await db
        .update(marketingArquivos)
        .set({ driveTentativas: a.driveTentativas + 1, driveErro: String(err).slice(0, 300) })
        .where(eq(marketingArquivos.id, a.id))
    }
  }
}
