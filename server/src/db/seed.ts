import { db } from './client.js'
import { users, empresas } from './schema.js'
import bcrypt from 'bcryptjs'
import { config } from 'dotenv'

config()

interface VendedorSeed {
  username: string
  name: string
  regiao: 'norte' | 'nordeste' | 'centro_oeste' | 'sudeste' | 'sul'
}

// Vendedores e regiões reais da Joitec (nomes completos, batendo com a coluna
// "Vendedor" das planilhas de carteira) — cada um com UMA região fixa, sem
// rodízio (diferente do CRM-GRUPO-ODIN original, que era round-robin).
const VENDEDORES: VendedorSeed[] = [
  { username: 'guilherme', name: 'Guilherme Lima Barros', regiao: 'nordeste' },
  { username: 'camila', name: 'Camila da Silva de Freitas', regiao: 'nordeste' },
  { username: 'antonio', name: 'Antonio Kleber', regiao: 'norte' },
  { username: 'douglas', name: 'Douglas da Silva', regiao: 'centro_oeste' },
  { username: 'claudia', name: 'Claudia de Freitas', regiao: 'centro_oeste' },
  { username: 'gino', name: 'Gino Ricardo de Siqueira', regiao: 'sudeste' },
  { username: 'enzo', name: 'Enzo Daniel', regiao: 'sudeste' },
  { username: 'sarah', name: 'Sarah Alves Kanoff Belo', regiao: 'sudeste' },
  { username: 'gustavo', name: 'Gustavo Lucas dos Santos', regiao: 'sul' },
  { username: 'kati', name: 'Katiely Chafron dos Santos', regiao: 'sul' },
  { username: 'yuri', name: 'Yuri Lucas', regiao: 'sul' },
  { username: 'caio', name: 'Caio Axel Leal Oliveira Paulo', regiao: 'sudeste' },
  { username: 'jean', name: 'Jean Marcelo Genuino', regiao: 'sudeste' },
  { username: 'sergio', name: 'Sergio Leandro Gratao', regiao: 'sul' },
]

async function seed() {
  console.log('🌱 Iniciando seed do banco Joitec CRM...')

  // Banco novo/vazio (dev do zero) só tem a empresa Joitec — a Odin Tubos e
  // Conexões é adicionada depois via script separado (scripts/seed-odin-tubos.mjs),
  // não faz parte do bootstrap padrão.
  const empresaResult = await db.insert(empresas).values({ nome: 'Joitec Distribuidora de Peças', slug: 'joitec' })
  const empresaId = Number(empresaResult.lastInsertRowid)

  const adminHash = await bcrypt.hash('Joitec@2026', 12)
  await db.insert(users).values({
    empresaId,
    name: 'Administrador',
    username: 'admin',
    passwordHash: adminHash,
    role: 'admin',
    superAdmin: true,
  })

  const vendorHash = await bcrypt.hash('Joitec@2026', 12)
  for (const v of VENDEDORES) {
    await db.insert(users).values({
      empresaId,
      name: v.name,
      username: v.username,
      passwordHash: vendorHash,
      role: 'vendor',
      regiao: v.regiao,
    })
  }

  console.log(`✅ Seed concluído: 1 admin + ${VENDEDORES.length} vendedores`)
  console.log('\n📋 Credenciais (todas iguais, é só desenvolvimento):')
  console.log('  Admin:', 'admin / Joitec@2026')
  console.log('  Vendedores:', VENDEDORES.map((v) => v.username).join(', '), '/ Joitec@2026')
  process.exit(0)
}

seed().catch((err) => {
  console.error('❌ Erro no seed:', err)
  process.exit(1)
})
