import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { config } from 'dotenv'
import { appRouter } from './router/index.js'
import { verifyToken, type JwtPayload } from './lib/jwt.js'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { db } from './db/client.js'
import { and, eq } from 'drizzle-orm'
import { adminEmpresasExtras, marketingArquivos, permissoesAdmin } from './db/schema.js'
import { startScheduler } from './lib/scheduler.js'
import { importarClientesCsv } from './lib/importClientes.js'
import { trocarCodigoPorToken, iniciarListener } from './lib/goto.js'
import { backfillPermissoesRelatorios, backfillPermissaoPainelTv, backfillPermissoesVendedor } from './lib/permissoesBackfill.js'
import { seedFuncaoTemplatesPadrao, backfillFuncaoRh } from './lib/funcaoTemplatesSeed.js'
import { careersRouter } from './routes/careers.js'
import { trackingRouter, TRACKER_JS } from './routes/tracking.js'

config()

const app = express()
const PORT = process.env.PORT ?? 3001
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads'

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

// Limite default do express.json() é 100kb — currículo em base64 (até 5MB,
// ver RESUME_MAX_SIZE_BYTES em routes/careers.ts) estourava isso e o body
// parser rejeitava com 413 antes da rota rodar, sem chegar na validação de
// tamanho própria da rota. Elevado pra caber o maior payload esperado.
app.use(express.json({ limit: '10mb' }))

// API pública de vagas (Trabalhe Conosco dos sites do grupo) — cross-origin
// de propósito (`origin: true`, não o CLIENT_URL restrito de baixo), já que
// quem chama são os sites (domínios diferentes do CRM), não o próprio front.
// Registrada ANTES do CORS global de propósito: o pacote `cors` intercepta e
// responde sozinho o preflight OPTIONS (não dá next()), então se o CORS
// global rodasse primeiro pra essa rota, o preflight nunca chegaria no CORS
// permissivo daqui — o navegador bloqueava o POST de candidatura com
// "Failed to fetch" mesmo o GET de listar vaga funcionando (GET não precisa
// de preflight, POST com JSON precisa).
app.use('/api/careers', cors({ origin: true }), careersRouter)

// Rastreamento de leads dos sites (fase 2 da migração do CRM de marketing) —
// mesma razão do CORS aberto/ordem antes do global explicada acima pro
// /api/careers. `tracker.js` também precisa ficar fora do CORS travado (é
// um <script src> cross-origin, embutido nos sites via <script>, não uma
// chamada fetch — mas serve-lo aqui, antes do CORS global, mantém tudo
// junto e não depende de nenhuma pasta estática extra no Dockerfile).
app.use('/api/tracking', cors({ origin: true }), trackingRouter)
app.get('/tracker.js', cors({ origin: true }), (req, res) => {
  res.type('application/javascript').send(TRACKER_JS)
})

app.use(cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:5173', credentials: true }))
app.use('/uploads', express.static(path.resolve(UPLOADS_DIR)))

// Resolve qual empresa vale pra esta requisição: normalmente é a empresa do
// próprio usuário, mas um `superAdmin` pode mandar o header `x-empresa-id`
// pra "entrar" em outra empresa sem logar de novo (ver Sidebar/AuthContext
// no client). Um admin comum também consegue, mas só pra uma empresa que o
// superAdmin liberou explicitamente pra ele (tabela adminEmpresasExtras,
// gerida em Permissões — ver empresas.ts atualizarExtras). Usuário sem
// nenhuma das duas coisas nunca consegue spoofar — o header é ignorado.
async function resolverEmpresaId(
  user: JwtPayload | null,
  headerEmpresaId: string | string[] | undefined
): Promise<number | null> {
  if (!user) return null
  const valor = Array.isArray(headerEmpresaId) ? headerEmpresaId[0] : headerEmpresaId
  const empresaIdPedida = valor ? Number(valor) : NaN
  if (!Number.isInteger(empresaIdPedida) || empresaIdPedida <= 0) return user.empresaId
  if (user.superAdmin) return empresaIdPedida
  if (empresaIdPedida === user.empresaId) return empresaIdPedida
  const concedida = await db.query.adminEmpresasExtras.findFirst({
    where: and(eq(adminEmpresasExtras.userId, user.id), eq(adminEmpresasExtras.empresaId, empresaIdPedida)),
  })
  return concedida ? empresaIdPedida : user.empresaId
}

// tRPC
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: async ({ req }) => {
      const auth = req.headers.authorization
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
      const user = token ? verifyToken(token) : null
      return { user, empresaId: await resolverEmpresaId(user, req.headers['x-empresa-id']) }
    },
  })
)

// Nome de arquivo com acento (á, é, ç, ã...) chegava corrompido — o
// navegador manda o nome em UTF-8 dentro do header multipart, mas o busboy
// (usado pelo multer) decodifica esse header como latin1 por padrão, então
// cada caractere multibyte virava 2 caracteres errados ("CATÁLOGO" virava
// "CATÃLOGO" etc). Redecodificar de latin1 pra utf8 desfaz a leitura
// errada. Achado do João, 2026-09-04.
function corrigirNomeArquivo(nome: string): string {
  return Buffer.from(nome, 'latin1').toString('utf8')
}

// Upload de arquivo (PDF do pedido/nota, planilha de importação) — separado do
// tRPC porque ele não suporta multipart/form-data.
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    cb(null, `${unique}-${corrigirNomeArquivo(file.originalname)}`)
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

// Anexo de lead (módulo de Leads) — qualquer tipo de arquivo (print de
// conversa, proposta em PDF, foto...), igual ao sistema de origem.
app.post('/upload/lead-attachment', upload.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' })

  res.json({
    path: req.file.filename,
    originalName: corrigirNomeArquivo(req.file.originalname),
    mimeType: req.file.mimetype,
    size: req.file.size,
  })
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

// Anexos de chamado de Devolução — nome de arquivo aleatorizado (crypto,
// nunca o nome original) igual ao sistema original: evita que o link
// (servido sem login em /uploads) vaze o nome do arquivo que o cliente
// mandou, ou vire um link adivinhável. Aceita imagem/vídeo/áudio/PDF, até
// 15MB/arquivo — mesmos limites do sistema original.
const storageDevolucao = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `devolucao-${randomUUID()}${ext}`)
  },
})
const MIME_PERMITIDOS_DEVOLUCAO = ['image/', 'video/', 'audio/', 'application/pdf']
const uploadDevolucao = multer({
  storage: storageDevolucao,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    cb(null, MIME_PERMITIDOS_DEVOLUCAO.some((m) => file.mimetype.startsWith(m)))
  },
})

// Uso interno (vendedor/admin logado, dentro do CRM).
app.post('/upload/devolucao-anexo', uploadDevolucao.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado ou tipo não permitido' })
  res.json({ path: `/uploads/${req.file.filename}`, nome: corrigirNomeArquivo(req.file.originalname), tipo: req.file.mimetype })
})

// Formulário público do cliente (/solicitacao) — sem login, é o link que
// vai ser compartilhado com clientes de fora.
app.post('/upload/devolucao-anexo-publico', uploadDevolucao.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado ou tipo não permitido' })
  res.json({ path: `/uploads/${req.file.filename}`, nome: corrigirNomeArquivo(req.file.originalname), tipo: req.file.mimetype })
})

// Anexos do módulo de Ordens (pós-venda Odin Compressores) — mesmo padrão
// de devolucao-anexo: nome aleatorizado, imagem/PDF, até 15MB/10 arquivos.
const storageOrdem = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `ordem-${randomUUID()}${ext}`)
  },
})
const MIME_PERMITIDOS_ORDEM = ['image/', 'application/pdf']
const uploadOrdem = multer({
  storage: storageOrdem,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    cb(null, MIME_PERMITIDOS_ORDEM.some((m) => file.mimetype.startsWith(m)))
  },
})
app.post('/upload/ordem-anexo', uploadOrdem.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado ou tipo não permitido' })
  res.json({ path: `/uploads/${req.file.filename}`, nome: corrigirNomeArquivo(req.file.originalname), tipo: req.file.mimetype, tamanho: req.file.size })
})

// Anexos de Propostas (PDF da proposta, dados cadastrais etc.) — mesmo
// padrão de ordem-anexo.
const storageProposta = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `prop-${randomUUID()}${ext}`)
  },
})
const uploadProposta = multer({
  storage: storageProposta,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/', 'application/pdf'].some((m) => file.mimetype.startsWith(m)))
  },
})
app.post('/upload/proposta-anexo', uploadProposta.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado ou tipo não permitido' })
  res.json({ path: `/uploads/${req.file.filename}`, nome: corrigirNomeArquivo(req.file.originalname), tipo: req.file.mimetype, tamanho: req.file.size })
})

// Anexos de Demandas (board estilo Trello) — mesmo padrão de ordem-anexo/
// proposta-anexo, aceita qualquer tipo de arquivo (planilha, doc, pdf,
// imagem etc.), diferente dos outros dois que são só imagem/PDF.
const storageDemanda = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `demanda-${randomUUID()}${ext}`)
  },
})
const uploadDemanda = multer({ storage: storageDemanda, limits: { fileSize: 20 * 1024 * 1024, files: 10 } })
app.post('/upload/demanda-anexo', uploadDemanda.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' })
  res.json({ path: `/uploads/${req.file.filename}`, nome: corrigirNomeArquivo(req.file.originalname), tamanho: req.file.size })
})

// Arquivos/Mídia de Marketing — fotos/vídeos/PDFs, qualquer tipo (como
// demanda-anexo), limite bem maior por causa de vídeo (pedido do João,
// 2026-09-04). Só admin sobe (checado aqui E de novo em
// marketing.registrarArquivo, que é quem grava a linha no banco — esse
// endpoint só grava o arquivo cru em disco).
const storageMarketing = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `marketing-${randomUUID()}${ext}`)
  },
})
const uploadMarketing = multer({ storage: storageMarketing, limits: { fileSize: 300 * 1024 * 1024, files: 10 } })
app.post('/upload/marketing-arquivo', uploadMarketing.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (user.role !== 'admin') return res.status(403).json({ error: 'Só admin pode subir arquivo' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' })
  res.json({ path: `/uploads/${req.file.filename}`, nome: corrigirNomeArquivo(req.file.originalname), tipo: req.file.mimetype, tamanho: req.file.size })
})

// Conteúdo de um arquivo de Marketing "somente visualização" — diferente do
// resto de /uploads (estático, sem login), essa rota exige token E confere
// empresa/feature antes de servir os bytes, porque pra esse arquivo o front
// nunca recebe o nome real em disco (ver marketing.listarArquivos). Sempre
// `inline` (nunca `attachment`) — não é uma trava perfeita (a pessoa
// logada sempre consegue tirar print ou salvar pelo DevTools), só tira o
// "baixar com 1 clique" que o resto do sistema dá.
app.get('/marketing-arquivo/:id/conteudo', async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  const arquivo = await db.query.marketingArquivos.findFirst({ where: eq(marketingArquivos.id, Number(req.params.id)) })
  if (!arquivo) return res.status(404).json({ error: 'Arquivo não encontrado' })

  const empresaId = await resolverEmpresaId(user, req.headers['x-empresa-id'])
  if (arquivo.empresaId !== empresaId) return res.status(403).json({ error: 'Sem permissão' })

  if (user.role !== 'admin' && !user.superAdmin) {
    const liberado = await db.query.permissoesAdmin.findFirst({
      where: and(eq(permissoesAdmin.userId, user.id), eq(permissoesAdmin.feature, 'arquivos')),
    })
    if (!liberado) return res.status(403).json({ error: 'Sem permissão' })
  }

  res.setHeader('Content-Disposition', 'inline')
  if (arquivo.tipoArquivo) res.setHeader('Content-Type', arquivo.tipoArquivo)
  res.sendFile(path.resolve(UPLOADS_DIR, arquivo.nomeArmazenado))
})

// Importação em massa de clientes (Excel/CSV) — em memória, não vai pro disco
// de uploads (não é um anexo permanente, só processado e descartado).
const uploadMemoria = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

app.post('/upload/clientes-csv', uploadMemoria.array('files'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador' })
  const empresaId = await resolverEmpresaId(user, req.headers['x-empresa-id'])
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
    await seedFuncaoTemplatesPadrao()
    await backfillFuncaoRh()
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
