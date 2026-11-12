import { spawn } from 'node:child_process'
import express from 'express'
import { createServer } from 'http'
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
import { and, eq, isNull, sql } from 'drizzle-orm'
import { podeOuvirLigacao } from './router/pabx.js'
import { adminEmpresasExtras, pabxLigacoesProcessadas, marketingArquivos, propostaArquivos, instagramAccounts, googleDriveConexao, users as usersTabela, expedicaoPedidos, expedicaoFotos, empresas, vendas, clientes, funilMensal, itemFotos } from './db/schema.js'
import { temFeature } from './router/_base.js'
import { podeTrocarFotoProduto } from './router/fotosProdutos.js'
import { semearFotosCatalogo } from './lib/fotosProdutos.js'
import { baixarArquivoNotaSap, baixarArquivoNotaDoPedidoSap, FILIAL_SAP_POR_SLUG, type ArquivoNota } from './lib/sapDanfe.js'
import { startScheduler } from './lib/scheduler.js'
import { importarClientesCsv } from './lib/importClientes.js'
import { processarHistoricoSap } from './lib/importSapHistorico.js'
import { trocarCodigoPorToken, iniciarListener, baixarGravacaoGoto } from './lib/goto.js'
import { migrarParaFuncoesVivas, ehSetorDoGrupo } from './lib/acessos.js'
import { backfillPermissoesRelatorios, backfillPermissaoPainelTv, backfillPermissoesVendedor } from './lib/permissoesBackfill.js'
import { seedFuncaoTemplatesPadrao, backfillFuncaoRh } from './lib/funcaoTemplatesSeed.js'
import { careersRouter } from './routes/careers.js'
import { trackingRouter, TRACKER_JS } from './routes/tracking.js'
import { lojaEventosRouter } from './routes/lojaEventos.js'
import { brevoRouter } from './routes/brevo.js'
import { woocommerceRouter } from './routes/woocommerce.js'
import { instagramRouter } from './routes/instagram.js'
import { trocarCodigoEAcharConta, validarState } from './lib/instagramApi.js'
import { encryptSecret } from './lib/crypto.js'
import { cifrar as cifrarDrive, trocarCodigo as trocarCodigoDrive, validarState as validarStateDrive, limparTokenCache as limparTokenDrive } from './lib/googleDrive.js'
import { iniciarChatSocket } from './lib/chatSocket.js'

config()

const app = express()
const PORT = process.env.PORT ?? 3001
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads'

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

// Webhooks do WooCommerce (loja online da Compretec Loja Física) — a
// assinatura HMAC que o WooCommerce manda é calculada em cima do corpo cru
// da requisição, então precisa de express.raw() em vez do express.json()
// global logo abaixo. Registrado ANTES do parser global de propósito: sem
// isso, o express.json() já teria consumido/parseado o corpo antes da rota
// rodar e não daria pra validar a assinatura. `type: () => true` (em vez de
// só 'application/json') pra sempre entregar Buffer em req.body — na
// prática o WooCommerce manda Content-Type: application/x-www-form-urlencoded
// nas entregas do webhook (confirmado em produção, 2026-09-17), não
// application/json; sem esse `type: () => true`, req.body virava objeto
// parseado e quebrava o cálculo do HMAC (derrubou o servidor inteiro numa
// rodada de teste).
app.use('/api/woocommerce', express.raw({ type: () => true, limit: '2mb' }), woocommerceRouter)

// Webhook único do Instagram (Meta), compartilhado por todas as empresas —
// mesmo motivo do WooCommerce acima: a assinatura (x-hub-signature-256) é
// calculada em cima do corpo cru, precisa vir antes do express.json() global.
app.use('/api/instagram', express.raw({ type: () => true, limit: '2mb' }), instagramRouter)

// Rastreamento da loja virtual nova (Compretec) em lotes assinados — mesma
// razão: HMAC sobre o corpo cru (routes/lojaEventos.ts).
app.use('/api/loja', cors({ origin: false }), express.raw({ type: () => true, limit: '5mb' }), lojaEventosRouter)

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

// Webhook do Brevo (e-mail marketing) — chamada servidor-a-servidor pela
// Brevo, não pelo navegador, então não precisa do CORS aberto acima (não
// tem preflight). Fica antes do CORS global só por organização, junto das
// outras rotas públicas.
app.use('/api/brevo', brevoRouter)

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
  if (concedida) return empresaIdPedida
  // Setor do grupo (Financeiro, RH...) entra em qualquer empresa — só nas
  // telas da função dela (as permissões não mudam com a empresa).
  if (await ehSetorDoGrupo(user.id)) {
    const existe = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaIdPedida), columns: { id: true } })
    if (existe) return empresaIdPedida
  }
  return user.empresaId
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

// Anexos do módulo de Garantias (documento/foto de cada etapa + foto de
// entrada/entrega da oficina) — mesmo padrão de ordem-anexo.
const storageGarantia = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `garantia-${randomUUID()}${ext}`)
  },
})
const uploadGarantia = multer({
  storage: storageGarantia,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    cb(null, MIME_PERMITIDOS_ORDEM.some((m) => file.mimetype.startsWith(m)))
  },
})
app.post('/upload/garantia-anexo', uploadGarantia.single('file'), async (req, res) => {
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

// Nota fiscal/cupom fiscal do Cartão de Crédito (Gastos) — mesmo padrão de
// proposta-anexo (só imagem/PDF, nome aleatorizado no disco).
const storageCartao = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `cartao-${randomUUID()}${ext}`)
  },
})
const uploadCartao = multer({
  storage: storageCartao,
  limits: { fileSize: 15 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/', 'application/pdf'].some((m) => file.mimetype.startsWith(m)))
  },
})
app.post('/upload/cartao-anexo', uploadCartao.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado ou tipo não permitido' })
  res.json({ path: `/uploads/${req.file.filename}`, nome: corrigirNomeArquivo(req.file.originalname), tipo: req.file.mimetype, tamanho: req.file.size })
})

// Comprovante opcional da Liberação de Crédito — mesmo padrão de
// cartao-anexo (só imagem/PDF, nome aleatorizado no disco).
const storageLiberacaoCredito = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `liberacao-credito-${randomUUID()}${ext}`)
  },
})
const uploadLiberacaoCredito = multer({
  storage: storageLiberacaoCredito,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/', 'application/pdf'].some((m) => file.mimetype.startsWith(m)))
  },
})
app.post('/upload/liberacao-credito-anexo', uploadLiberacaoCredito.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado ou tipo não permitido' })
  res.json({ path: `/uploads/${req.file.filename}`, nome: corrigirNomeArquivo(req.file.originalname), tipo: req.file.mimetype, tamanho: req.file.size })
})

// Anexos da Consulta/Solicitação de Crédito — qualquer tipo de arquivo
// (print, PDF, áudio, vídeo), tanto do vendedor (pedido) quanto do
// financeiro (resposta, ex: print do Serasa). Mesmo padrão de demanda-anexo
// (sem fileFilter), limite maior de tamanho por causa de áudio/vídeo.
const storageSolicitacaoCredito = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `solicitacao-credito-${randomUUID()}${ext}`)
  },
})
const uploadSolicitacaoCredito = multer({ storage: storageSolicitacaoCredito, limits: { fileSize: 50 * 1024 * 1024 } })
app.post('/upload/solicitacao-credito-anexo', uploadSolicitacaoCredito.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' })
  res.json({ path: `/uploads/${req.file.filename}`, nome: corrigirNomeArquivo(req.file.originalname), tipo: req.file.mimetype, tamanho: req.file.size })
})

// Anexos do Chat Grupo Odin — arquivo, foto, vídeo ou áudio (nota de voz
// gravada no navegador). Mesmo padrão de solicitacao-credito-anexo (sem
// fileFilter, aceita qualquer tipo).
const storageChat = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `chat-${randomUUID()}${ext}`)
  },
})
const uploadChat = multer({ storage: storageChat, limits: { fileSize: 50 * 1024 * 1024 } })
app.post('/upload/chat-anexo', uploadChat.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' })
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

// Foto de um produto (módulo Fotos dos produtos, João 2026-11-10): admin
// troca/coloca a foto do item; substitui a do catálogo. Só imagem, até 5 MB.
const uploadFotoProduto = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `produto-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
})
app.post('/upload/foto-produto/:itemCodigo', uploadFotoProduto.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!(await podeTrocarFotoProduto(user))) return res.status(403).json({ error: 'Só admin com Cotações ou Controle do Estoque troca foto' })
  const itemCodigo = String(req.params.itemCodigo)
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(itemCodigo)) return res.status(400).json({ error: 'Código de item inválido' })
  if (!req.file) return res.status(400).json({ error: 'Envie uma imagem JPG, PNG ou WEBP de até 5 MB' })
  const url = `/uploads/${req.file.filename}`
  await db
    .insert(itemFotos)
    .values({ itemCodigo, url, origem: 'upload', atualizadoPorId: user.id })
    .onConflictDoUpdate({ target: itemFotos.itemCodigo, set: { url, origem: 'upload', atualizadoPorId: user.id, atualizadoEm: sql`(datetime('now'))` } })
  res.json({ url })
})

// Fotos gerais do pedido no fim da conferência da Expedição (João
// 2026-11-12). Até 10 imagens por envio, 15 MB cada (foto de celular).
// Quem pode: superAdmin ou admin com Controle do Estoque, pedido da empresa ativa.
const uploadFotoExpedicao = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `expedicao-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
})
app.post('/upload/expedicao-foto/:id', uploadFotoExpedicao.array('fotos', 10), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!user.superAdmin && !(user.role === 'admin' && (await temFeature(user.id, 'controle_estoque')))) return res.status(403).json({ error: 'Sem permissão' })
  const empresaId = await resolverEmpresaId(user, req.headers['x-empresa-id'])
  const pedido = await db.query.expedicaoPedidos.findFirst({
    where: and(eq(expedicaoPedidos.id, Number(req.params.id)), eq(expedicaoPedidos.empresaId, empresaId ?? -1)),
    columns: { id: true, etapa: true, conferenciaColaboradorId: true },
  })
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' })
  const arquivos = (req.files as Express.Multer.File[] | undefined) ?? []
  if (!arquivos.length) return res.status(400).json({ error: 'Envie pelo menos uma foto (imagem de até 15 MB)' })
  await db.insert(expedicaoFotos).values(
    arquivos.map((f) => ({ expedicaoId: pedido.id, url: `/uploads/${f.filename}`, colaboradorId: pedido.conferenciaColaboradorId, enviadoPorId: user.id }))
  )
  res.json({ enviadas: arquivos.length })
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

  // Qualquer usuário autenticado da mesma empresa pode ver — Arquivos/Mídia
  // é liberado pra todo mundo, sem feature própria (ver marketing.ts).
  const empresaId = await resolverEmpresaId(user, req.headers['x-empresa-id'])
  if (arquivo.empresaId !== empresaId) return res.status(403).json({ error: 'Sem permissão' })

  res.setHeader('Content-Disposition', 'inline')
  if (arquivo.tipoArquivo) res.setHeader('Content-Type', arquivo.tipoArquivo)
  res.sendFile(path.resolve(UPLOADS_DIR, arquivo.nomeArmazenado))
})

// Gravação de ligação da PABXONE360 (relatório Ligações). O CRM busca o
// áudio no link da PABXONE360 e repassa, só pra quem pode ver aquela
// ligação (o link carrega o token da gravação, não vai pro navegador).
function paraMp3(entrada: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-f', 'mp3', '-b:a', '48k', 'pipe:1'])
    const saida: Buffer[] = []
    let erro = ''
    const timer = setTimeout(() => p.kill('SIGKILL'), 60_000)
    p.stdout.on('data', (d: Buffer) => saida.push(d))
    p.stderr.on('data', (d: Buffer) => (erro += d.toString()))
    p.on('error', (e) => (clearTimeout(timer), reject(e)))
    p.on('close', (code) => (clearTimeout(timer), code === 0 ? resolve(Buffer.concat(saida)) : reject(new Error(erro.slice(0, 200) || `ffmpeg saiu com ${code}`))))
    p.stdin.on('error', () => {})
    p.stdin.end(entrada)
  })
}

app.get('/pabx-gravacao/:id', async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  const lig = await db.query.pabxLigacoesProcessadas.findFirst({ where: eq(pabxLigacoesProcessadas.id, Number(req.params.id)) })
  const links = (lig?.linkGravacao ?? '').split('\n').filter(Boolean)
  const parte = Math.max(0, Number(req.query.parte ?? 0) || 0)
  const link = links[parte]
  if (!lig || !link) return res.status(404).json({ error: 'Gravação não encontrada' })
  const empresaId = await resolverEmpresaId(user, req.headers['x-empresa-id'])
  if (!(await podeOuvirLigacao(user, empresaId, lig))) return res.status(403).json({ error: 'Sem permissão' })
  // GoTo (Joitec): "goto:<recordingId>" — baixa pela API da GoTo.
  if (link.startsWith('goto:')) {
    try {
      const { audio } = await baixarGravacaoGoto(link.slice(5))
      // Já vem em MP3 ("ID3" ou cabeçalho de quadro 0xFFEx) — só converte se não for.
      const jaMp3 = audio.subarray(0, 3).toString('latin1') === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)
      const mp3 = jaMp3 ? audio : await paraMp3(audio).catch(() => null)
      const final = mp3?.length ? mp3 : audio
      res.setHeader('Content-Type', mp3?.length ? 'audio/mpeg' : 'audio/wav')
      res.setHeader('Content-Length', String(final.length))
      res.setHeader('Content-Disposition', `inline; filename="ligacao-${lig.id}.${mp3?.length ? 'mp3' : 'wav'}"`)
      res.setHeader('Cache-Control', 'private, max-age=3600')
      return res.end(final)
    } catch (e) {
      return res.status(502).json({ error: (e as Error).message })
    }
  }
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return res.status(404).json({ error: 'Link de gravação inválido' })
  }
  // A API devolve o link num IP (https://45.170.138.172/…) com certificado
  // autoassinado; o mesmo download_audio.php responde no domínio oficial,
  // que tem certificado válido — usa o domínio.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
    url.hostname = 'pabxone360.com.br'
    url.protocol = 'https:'
    url.port = ''
  }
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!resp.ok || !resp.body) return res.status(502).json({ error: `PABXONE360 não devolveu o áudio (${resp.status})` })
    const tipo = resp.headers.get('content-type') ?? ''
    // "Parâmetros inválidos!" / link vencido vem como página HTML, não áudio.
    if (/text\/|json/i.test(tipo)) return res.status(502).json({ error: `PABXONE360 não devolveu o áudio: ${(await resp.text()).replace(/<[^>]+>/g, ' ').trim().slice(0, 120)}` })
    // Vem como application/force-download; o arquivo é WAV ("RIFF") —
    // descobre pelo começo do arquivo pro navegador tocar.
    let audio: Buffer = Buffer.from(await resp.arrayBuffer())
    const inicio = audio.subarray(0, 4).toString('latin1')
    let [mime, ext] =
      inicio === 'RIFF' ? ['audio/wav', 'wav'] : inicio === 'OggS' ? ['audio/ogg', 'ogg'] : /audio/i.test(tipo) ? [tipo, 'mp3'] : ['audio/mpeg', 'mp3']
    // WAV de telefonia (GSM/µ-law…) o Chrome não toca — converte pra MP3.
    if (inicio === 'RIFF') {
      const mp3 = await paraMp3(audio).catch((e) => (console.error('[pabx-gravacao] ffmpeg:', (e as Error).message), null))
      if (mp3?.length) [audio, mime, ext] = [mp3, 'audio/mpeg', 'mp3']
    }
    res.setHeader('Content-Type', mime)
    res.setHeader('Content-Length', String(audio.length))
    res.setHeader('Content-Disposition', `inline; filename="ligacao-${lig.id}${parte ? `-${parte + 1}` : ''}.${ext}"`)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.end(audio)
  } catch (e) {
    const causa = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message
    res.status(502).json({ error: `Não consegui buscar a gravação na PABXONE360 (${causa})` })
  }
})

// DANFE (PDF) ou XML da NF de um pedido da Expedição, buscado no SAP na hora
// (anexo que o TaxPlus põe na nota). Mesma permissão da tela da Expedição.
app.get('/expedicao-nota/:id', async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!user.superAdmin && !(user.role === 'admin' && (await temFeature(user.id, 'controle_estoque')))) {
    return res.status(403).json({ error: 'Sem permissão' })
  }
  const formato = req.query.formato === 'xml' ? 'xml' : 'pdf'
  const empresaId = await resolverEmpresaId(user, req.headers['x-empresa-id'])
  const pedido = await db.query.expedicaoPedidos.findFirst({
    where: and(eq(expedicaoPedidos.id, Number(req.params.id)), eq(expedicaoPedidos.empresaId, empresaId ?? -1)),
    columns: { nfNumero: true, empresaId: true },
  })
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' })
  if (!pedido.nfNumero) return res.status(404).json({ error: 'Esse pedido ainda não tem NF' })
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, pedido.empresaId), columns: { slug: true } })
  const filial = FILIAL_SAP_POR_SLUG[empresa?.slug ?? '']
  if (!filial) return res.status(404).json({ error: 'Empresa sem filial no SAP' })
  await enviarArquivoNota(res, formato, () => baixarArquivoNotaSap(filial, pedido.nfNumero!, formato))
})

// Mesmo arquivo, a partir de uma venda do card do cliente que veio do SAP
// (pedidoSapEntry + nº da NF). Vê quem vê o card: dono do card, quem tem o
// crédito da venda, ou admin da empresa do cliente.
app.get('/venda-nota/:id', async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  const formato = req.query.formato === 'xml' ? 'xml' : 'pdf'
  const venda = await db.query.vendas.findFirst({
    where: and(eq(vendas.id, Number(req.params.id)), isNull(vendas.deletedAt)),
    columns: { numeroNotaFiscal: true, pedidoSapEntry: true, vendedorId: true, clienteId: true, funilMensalId: true },
  })
  if (!venda) return res.status(404).json({ error: 'Venda não encontrada' })
  const [cliente, funil] = await Promise.all([
    db.query.clientes.findFirst({ where: eq(clientes.id, venda.clienteId), columns: { empresaId: true } }),
    db.query.funilMensal.findFirst({ where: eq(funilMensal.id, venda.funilMensalId), columns: { vendedorId: true } }),
  ])
  const empresaId = await resolverEmpresaId(user, req.headers['x-empresa-id'])
  const pode =
    user.superAdmin ||
    (user.role === 'admin' && cliente?.empresaId === empresaId) ||
    user.id === venda.vendedorId ||
    user.id === funil?.vendedorId
  if (!pode) return res.status(403).json({ error: 'Sem permissão' })
  if (!venda.numeroNotaFiscal || !venda.pedidoSapEntry) return res.status(404).json({ error: 'Essa venda não tem NF do SAP' })
  await enviarArquivoNota(res, formato, () => baixarArquivoNotaDoPedidoSap(venda.pedidoSapEntry!, venda.numeroNotaFiscal!, formato))
})

async function enviarArquivoNota(res: express.Response, formato: 'pdf' | 'xml', buscar: () => Promise<ArquivoNota | { erro: string }>) {
  try {
    const r = await buscar()
    if ('erro' in r) return res.status(404).json({ error: r.erro })
    res.setHeader('Content-Type', r.tipo)
    res.setHeader('Content-Length', String(r.dados.length))
    res.setHeader('Content-Disposition', `${formato === 'pdf' ? 'inline' : 'attachment'}; filename="${r.nome}"`)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.end(r.dados)
  } catch (e) {
    res.status(502).json({ error: `Não consegui buscar no SAP: ${(e as Error).message}` })
  }
}

// Baixar o anexo de uma proposta com nome amigável ("Proposta - <cliente>.pdf")
// em vez do nome cru em disco ("prop-<uuid>.pdf"). Público igual /uploads —
// o que protege é o UUID no caminho ser impossível de adivinhar (mesmo
// modelo de antes; o link vai pro cliente por WhatsApp, ele não tem login).
// O front usa essa rota no lugar de /uploads/<nomeArmazenado> pros PDFs de
// proposta (link de WhatsApp, "copiar link" e o botão de baixar no CRM).
app.get('/proposta-arquivo/:nomeArmazenado', async (req, res) => {
  const nomeArmazenado = req.params.nomeArmazenado
  // Só o padrão gerado pelo upload (prop-<uuid>.<ext>) — barra path traversal
  // e garante que é mesmo um anexo de proposta.
  if (!/^prop-[0-9a-fA-F-]{36}\.[A-Za-z0-9]{2,5}$/.test(nomeArmazenado)) {
    return res.status(400).send('Arquivo inválido')
  }
  const arq = await db.query.propostaArquivos.findFirst({
    where: eq(propostaArquivos.nomeArmazenado, nomeArmazenado),
    with: { proposta: { columns: { id: true, clienteNome: true, codSap: true } } },
  })
  if (!arq) return res.status(404).send('Arquivo não encontrado')

  const ext = path.extname(nomeArmazenado) || '.pdf'
  const cliente = (arq.proposta?.clienteNome ?? 'cliente')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const prefixo = arq.proposta?.codSap ? `${arq.proposta.codSap.replace(/[\\/:*?"<>|]+/g, '')} - ` : ''
  const nomeAmigavel = `Proposta ${prefixo}${cliente}${ext}`.trim()

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${nomeAmigavel.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(nomeAmigavel)}`
  )
  if (arq.tipoArquivo) res.setHeader('Content-Type', arq.tipoArquivo)
  res.sendFile(path.resolve(UPLOADS_DIR, nomeArmazenado))
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

  // Cada arquivo isolado no próprio try/catch — um .xlsx corrompido não pode
  // derrubar a resposta inteira e esconder o resultado dos outros arquivos
  // do mesmo lote que já tinham processado certo.
  const resultados = []
  for (const file of files) {
    try {
      const resultado = await importarClientesCsv(file.buffer, file.originalname, user.id, empresaId)
      resultados.push(resultado)
    } catch (err) {
      console.error(`[upload/clientes-csv] falha lendo ${file.originalname}:`, err)
      resultados.push({ arquivo: file.originalname, sucesso: 0, atualizados: 0, erros: [{ linha: 0, motivo: 'Não consegui abrir esse arquivo — confirme se é um Excel/CSV válido' }], avisos: [] })
    }
  }
  res.json({ resultados })
})

// Histórico de vendas do SAP (só consulta) — 2 passos com o mesmo arquivo:
// `?confirmar=1` grava num lote novo; sem isso, só devolve a prévia. Só o
// superAdmin importa (é quem desfaz se vier errado). Limite maior que o dos
// clientes porque o histórico de anos do SAP pode ser grande.
const uploadSap = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } })
app.post('/upload/historico-sap', uploadSap.single('file'), async (req, res) => {
  const user = authenticate(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  if (!user.superAdmin) return res.status(403).json({ error: 'Acesso restrito ao superAdmin' })
  const empresaId = await resolverEmpresaId(user, req.headers['x-empresa-id'])
  if (!empresaId) return res.status(401).json({ error: 'Empresa não resolvida' })
  const file = req.file
  if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado' })
  try {
    const resultado = await processarHistoricoSap(file.buffer, file.originalname, empresaId, {
      confirmar: req.query.confirmar === '1',
      usuarioId: user.id,
    })
    res.json(resultado)
  } catch (err) {
    console.error(`[upload/historico-sap] falha lendo ${file.originalname}:`, err)
    res.status(400).json({ error: 'Não consegui ler esse arquivo — confirme se é um Excel/CSV válido' })
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

// Callback do OAuth do Google Drive (Arquivos/Mídia) — mesmo motivo dos
// callbacks acima. `state` assinado traz quem pediu; só superAdmin conecta.
app.get('/api/google-drive/callback', async (req, res) => {
  const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5183'
  const voltar = (resultado: string) => res.redirect(`${clientUrl}/admin/configuracoes?drive=${resultado}`)
  const code = req.query.code as string | undefined
  const userId = validarStateDrive(String(req.query.state ?? ''))
  if (!code || !userId) return voltar('erro')
  try {
    const quem = await db.query.users.findFirst({ where: eq(usersTabela.id, userId), columns: { superAdmin: true } })
    if (!quem?.superAdmin) return voltar('erro')
    const { refreshToken, email } = await trocarCodigoDrive(code)
    const valores = { email, refreshTokenEnc: cifrarDrive(refreshToken), conectadoPor: userId, conectadoEm: new Date().toISOString().replace('T', ' ').slice(0, 19) }
    const existente = await db.query.googleDriveConexao.findFirst({ where: eq(googleDriveConexao.id, 1) })
    if (existente) await db.update(googleDriveConexao).set(valores).where(eq(googleDriveConexao.id, 1))
    else await db.insert(googleDriveConexao).values({ id: 1, ...valores })
    limparTokenDrive()
    voltar('conectado')
  } catch (err) {
    console.error('[google-drive] falha no callback de autorização:', err)
    voltar('erro')
  }
})

// Callback do OAuth do Instagram (Facebook Login for Business) — mesmo
// motivo do callback da GoTo acima: quem chama é o navegador sendo
// redirecionado pela Meta, sem header de autenticação nosso. `state` carrega
// o empresaId assinado (ver instagramApi.ts) pra saber de qual empresa era
// o pedido de conexão.
app.get('/api/instagram/callback', async (req, res) => {
  const code = req.query.code as string | undefined
  const state = req.query.state as string | undefined
  const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5183'

  const empresaId = state ? validarState(state) : null
  if (!code || !empresaId) {
    return res.redirect(`${clientUrl}/admin/configuracoes?instagram=erro`)
  }

  try {
    const conta = await trocarCodigoEAcharConta(code)
    const valores = {
      empresaId,
      igBusinessAccountId: conta.igBusinessAccountId,
      igPageId: conta.igPageId,
      igUsername: conta.igUsername,
      pageAccessTokenEnc: encryptSecret(conta.pageAccessToken),
      status: 'conectado' as const,
      connectedAt: new Date().toISOString(),
    }
    const existente = await db.query.instagramAccounts.findFirst({ where: eq(instagramAccounts.empresaId, empresaId) })
    if (existente) {
      await db.update(instagramAccounts).set(valores).where(eq(instagramAccounts.empresaId, empresaId))
    } else {
      await db.insert(instagramAccounts).values(valores)
    }
    res.redirect(`${clientUrl}/admin/configuracoes?instagram=conectado`)
  } catch (err) {
    console.error('[instagram] falha no callback de autorização:', err)
    res.redirect(`${clientUrl}/admin/configuracoes?instagram=erro`)
  }
})

// Erro assíncrono que ninguém tratou (ex.: rota de upload que faz `await`
// no banco sem try/catch) — no Node 20 isso DERRUBA o processo e o CRM cai
// pra todo mundo até o Docker reiniciar. Registra e segue (2026-10-21).
process.on('unhandledRejection', (motivo) => {
  console.error('[processo] erro assíncrono não tratado (servidor continua no ar):', motivo)
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
    // Funções vivas (2026-11-09) — roda uma vez só, na primeira subida.
    await migrarParaFuncoesVivas()
    // Fotos dos produtos: recortes do catálogo (só os itens ainda sem foto).
    await semearFotosCatalogo().catch((e) => console.error('[fotos] semear:', e))
  } catch (err) {
    console.error('[db] falha ao aplicar migrações:', err)
    process.exit(1)
  }

  const httpServer = createServer(app)
  iniciarChatSocket(httpServer)

  httpServer.listen(PORT, () => {
    console.log(`\n🚀 Servidor Joitec CRM rodando em http://localhost:${PORT}`)
    console.log(`📡 tRPC disponível em http://localhost:${PORT}/trpc`)
    console.log(`💬 Chat Grupo Odin (socket) em /chat-socket`)
    startScheduler()
    iniciarListener().catch((err) => console.error('[goto] falha ao iniciar listener no boot:', err))
  })
}

start()
