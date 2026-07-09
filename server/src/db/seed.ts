import { db } from './client.js'
import { users, regions, ddds, regionVendors, roundRobinState, messageTemplates } from './schema.js'
import bcrypt from 'bcryptjs'
import { config } from 'dotenv'

config()

const BRAZIL_REGIONS = [
  {
    name: 'Norte',
    ddds: [91, 92, 93, 94, 95, 96, 97, 98, 99],
  },
  {
    name: 'Nordeste',
    ddds: [71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89],
  },
  {
    name: 'Centro-Oeste',
    ddds: [61, 62, 63, 64, 65, 66, 67, 68, 69],
  },
  {
    name: 'Sudeste',
    ddds: [11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38],
  },
  {
    name: 'Sul',
    ddds: [41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55],
  },
]

async function seed() {
  console.log('🌱 Iniciando seed do banco de dados...')

  // Usuários
  const adminHash = await bcrypt.hash('admin123', 12)
  const vendorHash = await bcrypt.hash('Odin@2024', 12)

  await db.insert(users).values([
    { name: 'Administrador', username: 'admin', passwordHash: adminHash, role: 'admin' },
    { name: 'Carlos Silva', username: 'carlos', passwordHash: vendorHash, role: 'vendor' },
    { name: 'Ana Souza', username: 'ana', passwordHash: vendorHash, role: 'vendor' },
    { name: 'Pedro Lima', username: 'pedro', passwordHash: vendorHash, role: 'vendor' },
  ])
  console.log('✅ Usuários criados')

  const allUsers = await db.query.users.findMany()
  const carlos = allUsers.find((u) => u.username === 'carlos')!
  const ana = allUsers.find((u) => u.username === 'ana')!
  const pedro = allUsers.find((u) => u.username === 'pedro')!

  // Regiões
  for (const reg of BRAZIL_REGIONS) {
    await db.insert(regions).values({ name: reg.name })
  }
  console.log('✅ Regiões criadas')

  const allRegions = await db.query.regions.findMany()

  // DDDs
  for (const reg of BRAZIL_REGIONS) {
    const dbRegion = allRegions.find((r) => r.name === reg.name)!
    for (const ddd of reg.ddds) {
      await db.insert(ddds).values({ ddd, regionId: dbRegion.id })
    }
  }
  console.log('✅ DDDs criados')

  // Associação vendedores por região
  const norte = allRegions.find((r) => r.name === 'Norte')!
  const nordeste = allRegions.find((r) => r.name === 'Nordeste')!
  const centroOeste = allRegions.find((r) => r.name === 'Centro-Oeste')!
  const sudeste = allRegions.find((r) => r.name === 'Sudeste')!
  const sul = allRegions.find((r) => r.name === 'Sul')!

  await db.insert(regionVendors).values([
    // Norte: Carlos
    { regionId: norte.id, vendorId: carlos.id },
    // Nordeste: Ana
    { regionId: nordeste.id, vendorId: ana.id },
    // Centro-Oeste: Pedro
    { regionId: centroOeste.id, vendorId: pedro.id },
    // Sudeste: Carlos, Ana
    { regionId: sudeste.id, vendorId: carlos.id },
    { regionId: sudeste.id, vendorId: ana.id },
    // Sul: Pedro, Carlos
    { regionId: sul.id, vendorId: pedro.id },
    { regionId: sul.id, vendorId: carlos.id },
  ])
  console.log('✅ Vendedores por região configurados')

  // Round Robin state inicial
  for (const reg of allRegions) {
    await db.insert(roundRobinState).values({ regionId: reg.id, nextIndex: 0 })
  }
  console.log('✅ Estado do rodízio inicializado')

  // Mensagens automáticas (WhatsApp/Email) para retomada de contato
  await db.insert(messageTemplates).values([
    {
      label: 'Retomada direta',
      whatsappText:
        'Olá, {{nome}}! Tudo bem? Aqui é da Odin Tubos e Conexões. Vi que você se interessou pelas nossas soluções em tubulação PPR Azul para ar comprimido e fiquei sem retorno seu. Ainda faz sentido pra você? Posso te ajudar com mais informações.',
      emailSubject: 'Ainda posso te ajudar, {{nome}}?',
      emailBody:
        'Olá, {{nome}},\n\nTudo bem? Sou da equipe comercial da Odin Tubos e Conexões. Vi que você demonstrou interesse em nossas soluções em tubulação PPR Azul para ar comprimido, mas ainda não conseguimos falar.\n\nFico à disposição para entender sua necessidade e te apresentar a melhor solução. Podemos conversar?\n\nAtenciosamente,\nEquipe Odin Tubos e Conexões',
    },
    {
      label: 'Consultiva',
      whatsappText:
        'Oi, {{nome}}! Aqui é da Odin Tubos e Conexões. Notei seu interesse na nossa linha de tubulação PPR Azul e queria entender melhor o que você precisa — é uma instalação nova, ampliação ou troca de sistema? Assim já te indico a solução certa.',
      emailSubject: 'Vamos entender sua necessidade, {{nome}}?',
      emailBody:
        'Olá, {{nome}},\n\nVi que você teve interesse nas soluções da Odin Tubos e Conexões para ar comprimido. Antes de te enviar qualquer proposta, gostaria de entender melhor o seu projeto: é uma instalação nova, ampliação ou substituição de um sistema existente?\n\nCom essas informações, consigo te indicar a solução mais adequada.\n\nFico no aguardo do seu retorno.\n\nAtenciosamente,\nEquipe Odin Tubos e Conexões',
    },
    {
      label: 'Oferta especial',
      whatsappText:
        'Olá, {{nome}}! Aqui é da Odin Tubos e Conexões. Estamos com uma condição especial este mês para quem já demonstrou interesse na nossa linha PPR Azul para ar comprimido — não queria que você perdesse. Posso te enviar os detalhes?',
      emailSubject: 'Condição especial pra você, {{nome}}',
      emailBody:
        'Olá, {{nome}},\n\nComo você já demonstrou interesse nas soluções da Odin Tubos e Conexões, quero te avisar que estamos com uma condição especial disponível este mês para novos projetos em tubulação PPR Azul para ar comprimido.\n\nPosso te enviar os detalhes e ver se faz sentido para o seu momento?\n\nAtenciosamente,\nEquipe Odin Tubos e Conexões',
    },
  ])
  console.log('✅ Mensagens automáticas criadas')

  console.log('\n🎉 Seed concluído com sucesso!')
  console.log('\n📋 Credenciais:')
  console.log('  Admin:  admin / admin123')
  console.log('  Carlos: carlos / Odin@2024')
  console.log('  Ana:    ana / Odin@2024')
  console.log('  Pedro:  pedro / Odin@2024')
  process.exit(0)
}

seed().catch((err) => {
  console.error('❌ Erro no seed:', err)
  process.exit(1)
})
