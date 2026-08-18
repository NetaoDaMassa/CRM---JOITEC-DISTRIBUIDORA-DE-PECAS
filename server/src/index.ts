import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import multer from 'multer'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { config } from 'dotenv'
import { appRouter } from './router/index.js'
import { verifyToken, type JwtPayload } from './lib/jwt.js'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { db } from './db/client.js'
import { startScheduler } from './lib/scheduler.js'
import { importarClientesCsv } from './lib/importClientes.js'
import { trocarCodigoPorToken, iniciarListener } from './lib/goto.js'
import { backfillPermissoesRelatorios, backfillPermissaoPainelTv, backfillPermissoesVendedor } from './lib/permissoesBackfill.js'

config()

const app = express()
const PORT = process.env.PORT ?? 3001
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads'

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

app.use(cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:5173', credentials: true }))
app.use(express.json())
app.use('/uploads', express.static(path.resolve(UPLOADS_DIR)))

// Resolve qual empresa vale pra esta requisição: normalmente é a empresa do
// próprio usuário, mas um `superAdmin` pode mandar o header `x-empresa-id`
// pra "entrar" em outra empresa sem logar de novo (ver Sidebar/AuthContext
// no client). Usuário comum nunca consegue spoofar — o header é ignorado.
function resolverEmpresaId(user: JwtPayload | null, headerEmpresaId: string | string[] | undefined): number | null {
  if (!user) return null
  if (!user.superAdmin) return user.empresaId
  const valor = Array.isArray(headerEmpresaId) ? headerEmpresaId[0] : headerEmpresaId
  const empresaId = valor ? Number(valor) : NaN
  return Number.isInteger(empresaId) && empresaId > 0 ? empresaId : user.empresaId
}

// tRPC
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req }) => {
      const auth = req.headers.authorization
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
      const user = token ? verifyToken(token) : null
      return { user, empresaId: resolverEmpresaId(user, req.headers['x-empresa-id']) }
    },
  })
)

// Upload de arquivo (PDF do pedido/nota, planilha de importação) — separado do
// tRPC porque ele não suporta multipart/form-data.
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    cb(null, `${unique}-${file.originalname}`)
  },
})
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } })

function authenticate(req: express.Request): ReturnType<typeof verifyToken> {
  const auth = req.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  return token ? verifyToken(token) : null
}

app.post('/upload/pedido', upload.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' })

  res.json({ path: req.file.filename })
})

// Foto de perfil do vendedor (usada no Dashboard e no Painel de TV)
app.post('/upload/foto-vendedor', upload.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' })
  if (!req.file.mimetype.startsWith('image/')) {
    fs.unlink(req.file.path, () => {})
    return res.status(400).json({ error: 'O arquivo precisa ser uma imagem' })
  }

  res.json({ path: `/uploads/${req.file.filename}` })
})

// Comprovante (print/imagem) obrigatório ao excluir um cliente (admin) ou ao
// pedir o descarte de um cliente da própria carteira (vendedor, via aba de
// Aprovações) — fica salvo permanentemente pra auditoria, mesmo depois do
// cliente ser restaurado. Qualquer usuário autenticado pode subir o arquivo;
// quem decide se a exclusão/aprovação de fato acontece é o tRPC (admin-only).
app.post('/upload/comprovante-exclusao', upload.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' })
  if (!req.file.mimetype.startsWith('image/')) {
    fs.unlink(req.file.path, () => {})
    return res.status(400).json({ error: 'O arquivo precisa ser uma imagem' })
  }

  res.json({ path: `/uploads/${req.file.filename}` })
})

// Importação em massa de clientes (Excel/CSV) — em memória, não vai pro disco
// de uploads (não é um anexo permanente, só processado e descartado).
const uploadMemoria = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

app.post('/upload/clientes-csv', uploadMemoria.array('files'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador' })
  const empresaId = resolverEmpresaId(user, req.headers['x-empresa-id'])
  if (!empresaId) return res.status(401).json({ error: 'Empresa não resolvida' })

  const files = req.files as Express.Multer.File[] | undefined
  if (!files || files.length === 0) return res.status(400).json({ error: 'Nenhum arquivo enviado' })

  try {
    const resultados = []
    for (const file of files) {
      const resultado = await importarClientesCsv(file.buffer, file.originalname, user.id, empresaId)
      resultados.push(resultado)
    }
    res.json({ resultados })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Falha ao processar a importação' })
  }
})

// Callback do OAuth da GoTo — precisa ser uma rota simples (não tRPC) porque
// quem chama é o navegador sendo redirecionado pela GoTo, sem header de
// autenticação nosso.
app.get('/api/goto/callback', async (req, res) => {
  const code = req.query.code as string | undefined
  const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5183'

  if (!code) {
    return res.redirect(`${clientUrl}/admin/configuracoes?goto=erro`)
  }

  try {
    await trocarCodigoPorToken(code)
    await iniciarListener()
    res.redirect(`${clientUrl}/admin/configuracoes?goto=conectado`)
  } catch (err) {
    console.error('[goto] falha no callback de autorização:', err)
    res.redirect(`${clientUrl}/admin/configuracoes?goto=erro`)
  }
})

async function start() {
  try {
    await migrate(db, { migrationsFolder: path.resolve('drizzle') })
    console.log('[db] migrações aplicadas')
    await backfillPermissoesRelatorios()
    await backfillPermissaoPainelTv()
    await backfillPermissoesVendedor()
  } catch (err) {
    console.error('[db] falha ao aplicar migrações:', err)
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Servidor Joitec CRM rodando em http://localhost:${PORT}`)
    console.log(`📡 tRPC disponível em http://localhost:${PORT}/trpc`)
    startScheduler()
    iniciarListener().catch((err) => console.error('[goto] falha ao iniciar listener no boot:', err))
  })
}

start()
