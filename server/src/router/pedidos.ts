import path from 'path'
import fs from 'fs'
import { z } from 'zod'
import { router, protectedProcedure } from './_base.js'
import { extrairItensDoPdf } from '../lib/pdfExtraction.js'

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR ?? './uploads')

export const pedidosRouter = router({
  // Recebe o nome do arquivo já salvo por POST /upload/pedido e pede pra
  // Claude ler o PDF e devolver os itens estruturados, pra pré-preencher o
  // editor de itens antes do vendedor confirmar o fechamento da venda.
  extrairItens: protectedProcedure.input(z.object({ path: z.string().min(1) })).mutation(async ({ input }) => {
    const nomeArquivo = path.basename(input.path)
    const caminhoAbsoluto = path.resolve(UPLOADS_DIR, nomeArquivo)
    if (!caminhoAbsoluto.startsWith(UPLOADS_DIR)) throw new Error('Caminho de arquivo inválido')
    if (!fs.existsSync(caminhoAbsoluto)) throw new Error('Arquivo não encontrado — envie o PDF novamente.')

    return extrairItensDoPdf(caminhoAbsoluto)
  }),
})
