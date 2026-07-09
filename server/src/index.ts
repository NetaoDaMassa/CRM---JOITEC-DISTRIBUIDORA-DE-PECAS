import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import multer from 'multer'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { config } from 'dotenv'
import { appRouter } from './router/index.js'
import { verifyToken } from './lib/jwt.js'
import { db } from './db/client.js'
import { leadAttachments, leads } from './db/schema.js'
import { eq } from 'drizzle-orm'
import { startScheduler } from './lib/scheduler.js'

config()

const app = express()
const PORT = process.env.PORT ?? 3001
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads'

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

app.use(cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:5173', credentials: true }))
app.use(express.json())
app.use('/uploads', express.static(path.resolve(UPLOADS_DIR)))

// tRPC
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req }) => {
      const auth = req.headers.authorization
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
      const user = token ? verifyToken(token) : null
      return { user }
    },
  })
)

// File upload (separate REST endpoint — tRPC doesn't support multipart)
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    cb(null, `${unique}-${file.originalname}`)
  },
})
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } })

app.post('/upload/:leadId', upload.single('file'), async (req, res) => {
  try {
    const auth = req.headers.authorization
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    const user = token ? verifyToken(token) : null
    if (!user) return res.status(401).json({ error: 'Não autenticado' })

    const leadId = parseInt(req.params.leadId)
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) })
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' })
    if (lead.companyId !== user.companyId)
      return res.status(403).json({ error: 'Acesso negado' })
    if (user.role === 'vendor' && lead.vendorId !== user.id)
      return res.status(403).json({ error: 'Acesso negado' })

    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' })

    const result = await db.insert(leadAttachments).values({
      leadId,
      userId: user.id,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    })

    // Clear attachment requirement
    await db.update(leads).set({ requiresAttachment: false }).where(eq(leads.id, leadId))

    res.json({ id: Number(result.lastInsertRowid), filename: req.file.filename, originalName: req.file.originalname })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao fazer upload' })
  }
})

app.listen(PORT, () => {
  console.log(`\n🚀 Servidor Odin CRM rodando em http://localhost:${PORT}`)
  console.log(`📡 tRPC disponível em http://localhost:${PORT}/trpc`)
  startScheduler()
})
