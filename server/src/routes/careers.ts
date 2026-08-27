import express from 'express'
import fs from 'fs'
import path from 'path'
import { db } from '../db/client.js'
import { empresas, jobPostings, candidates } from '../db/schema.js'
import { eq, and, inArray } from 'drizzle-orm'

// API pública (sem login) usada pelos sites do grupo — Joitec, Odin Tubos,
// Odin Compressores — pra montar a página "Trabalhe Conosco" e receber
// candidaturas. Portada do sistema separado CRM-GRUPO-ODIN (mesmo contrato
// de rotas/campos, pra não precisar mudar nada nos sites além da URL base).
export const careersRouter = express.Router()

// As vagas dessas 3 empresas aparecem iguais nos 3 sites — pedido do João
// 2026-08-27: "as vagas precisam estar iguais em todos os sites". Vaga
// criada em qualquer uma delas aparece nas 3 (a empresa "dona" de verdade
// continua sendo `jobPostings.empresaId`, é só a listagem pública que junta
// as 3). Compretec fica de fora — não tem site de vagas hoje.
const SLUGS_VAGAS_COMPARTILHADAS = ['joitec', 'odin-tubos', 'odin-compressores']

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads'
const RESUME_MAX_SIZE_BYTES = 5 * 1024 * 1024 // base64 já decodificado

function publicJob(job: typeof jobPostings.$inferSelect) {
  return {
    id: job.id,
    title: job.title,
    description: job.description,
    benefits: job.benefits,
    requirements: job.requirements,
    city: job.city,
    createdAt: job.createdAt,
  }
}

// Resolve o conjunto de empresaIds que devem aparecer juntas na página de
// vagas de `empresaSlug` — as 3 do grupo compartilhado quando o slug pedido
// é uma delas, senão só a própria empresa (ex: Compretec continua isolada).
async function empresaIdsVisiveis(empresaSlug: string): Promise<number[] | null> {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, empresaSlug) })
  if (!empresa) return null
  if (!SLUGS_VAGAS_COMPARTILHADAS.includes(empresaSlug)) return [empresa.id]
  const grupo = await db.query.empresas.findMany({ where: inArray(empresas.slug, SLUGS_VAGAS_COMPARTILHADAS) })
  return grupo.map((e) => e.id)
}

// Lista as vagas abertas de uma empresa — pros sites montarem a página de Trabalhe Conosco.
careersRouter.get('/:empresaSlug', async (req, res) => {
  try {
    const empresaIds = await empresaIdsVisiveis(req.params.empresaSlug)
    if (!empresaIds) return res.status(404).json({ error: 'Empresa não encontrada' })

    const rows = await db.query.jobPostings.findMany({
      where: and(inArray(jobPostings.empresaId, empresaIds), eq(jobPostings.isActive, true)),
      orderBy: (j, { desc }) => [desc(j.createdAt)],
    })
    res.json(rows.map(publicJob))
  } catch (err) {
    console.error('[careers/list]', err)
    res.status(500).json({ error: 'erro ao buscar vagas' })
  }
})

// Detalhe de uma vaga específica.
careersRouter.get('/:empresaSlug/:jobId', async (req, res) => {
  try {
    const empresaIds = await empresaIdsVisiveis(req.params.empresaSlug)
    if (!empresaIds) return res.status(404).json({ error: 'Empresa não encontrada' })

    const jobId = parseInt(req.params.jobId, 10)
    const job = await db.query.jobPostings.findFirst({
      where: and(eq(jobPostings.id, jobId), inArray(jobPostings.empresaId, empresaIds), eq(jobPostings.isActive, true)),
    })
    if (!job) return res.status(404).json({ error: 'Vaga não encontrada' })

    res.json(publicJob(job))
  } catch (err) {
    console.error('[careers/detail]', err)
    res.status(500).json({ error: 'erro ao buscar vaga' })
  }
})

// Candidatura — recebe o currículo em base64 (o form do site já converte o arquivo antes de enviar).
// A candidatura sempre vai pra fila de RH da empresa DONA da vaga
// (`job.empresaId`), mesmo que a pessoa tenha se candidatado pelo site de
// outra empresa do grupo compartilhado.
careersRouter.post('/:empresaSlug/:jobId/apply', async (req, res) => {
  try {
    const empresaIds = await empresaIdsVisiveis(req.params.empresaSlug)
    if (!empresaIds) return res.status(404).json({ error: 'Empresa não encontrada' })

    const jobId = parseInt(req.params.jobId, 10)
    const job = await db.query.jobPostings.findFirst({
      where: and(eq(jobPostings.id, jobId), inArray(jobPostings.empresaId, empresaIds), eq(jobPostings.isActive, true)),
    })
    if (!job) return res.status(404).json({ error: 'Vaga não encontrada' })

    const { name, phone, email, message, resume } = req.body ?? {}
    if (!name || !phone) {
      return res.status(400).json({ error: 'name e phone são obrigatórios' })
    }

    let resumeFilename: string | null = null
    let resumeOriginalName: string | null = null

    if (resume?.base64 && resume?.filename) {
      const buffer = Buffer.from(resume.base64, 'base64')
      if (buffer.length > RESUME_MAX_SIZE_BYTES) {
        return res.status(400).json({ error: 'Currículo muito grande (máximo 5MB)' })
      }
      if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      resumeFilename = `${unique}-${resume.filename}`
      resumeOriginalName = resume.filename
      fs.writeFileSync(path.join(UPLOADS_DIR, resumeFilename), buffer)
    }

    await db.insert(candidates).values({
      empresaId: job.empresaId,
      jobPostingId: job.id,
      name,
      phone,
      email: email || null,
      message: message || null,
      resumeFilename,
      resumeOriginalName,
    })

    res.status(201).json({ ok: true })
  } catch (err) {
    console.error('[careers/apply]', err)
    res.status(500).json({ error: 'erro ao enviar candidatura' })
  }
})
