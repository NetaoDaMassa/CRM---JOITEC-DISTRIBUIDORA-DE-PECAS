import { db } from './client.js'
import { companies, users, regions, ddds, regionVendors, roundRobinState, messageTemplates } from './schema.js'
import bcrypt from 'bcryptjs'
import { config } from 'dotenv'

config()

// Mapeamento padrão DDD -> UF (Brasil), usado pra derivar DDDs a partir de estados
const STATE_DDDS: Record<string, number[]> = {
  AC: [68], AL: [82], AP: [96], AM: [92, 97], BA: [71, 73, 74, 75, 77],
  CE: [85, 88], DF: [61], ES: [27, 28], GO: [62, 64], MA: [98, 99],
  MT: [65, 66], MS: [67], MG: [31, 32, 33, 34, 35, 37, 38], PA: [91, 93, 94],
  PB: [83], PR: [41, 42, 43, 44, 45, 46], PE: [81, 87], PI: [86, 89],
  RJ: [21, 22, 24], RN: [84], RS: [51, 53, 54, 55], RO: [69], RR: [95],
  SC: [47, 48, 49], SP: [11, 12, 13, 14, 15, 16, 17, 18, 19], SE: [79], TO: [63],
}

function dddsForStates(states: string[]): number[] {
  return states.flatMap((uf) => STATE_DDDS[uf] ?? [])
}

interface RegionSeed {
  name: string
  ddds: number[]
  vendorNames: string[]
}

interface CompanySeed {
  name: string
  slug: string
  adminUsername: string
  adminPassword: string
  vendorPassword: string
  vendorFullNames: Record<string, string> // primeiro-nome-lowercase -> nome completo (opcional, senão usa o próprio nome)
  regionsData: RegionSeed[]
}

async function createCompany(spec: CompanySeed) {
  const companyResult = await db.insert(companies).values({ name: spec.name, slug: spec.slug })
  const companyId = Number(companyResult.lastInsertRowid)

  const adminHash = await bcrypt.hash(spec.adminPassword, 12)
  await db.insert(users).values({
    companyId,
    name: 'Administrador',
    username: spec.adminUsername,
    passwordHash: adminHash,
    role: 'admin',
  })

  const vendorHash = await bcrypt.hash(spec.vendorPassword, 12)
  const vendorIdByName = new Map<string, number>()

  for (const region of spec.regionsData) {
    const regionResult = await db.insert(regions).values({ name: region.name, companyId })
    const regionId = Number(regionResult.lastInsertRowid)
    await db.insert(roundRobinState).values({ regionId, nextIndex: 0 })

    for (const ddd of region.ddds) {
      await db.insert(ddds).values({ ddd, regionId, companyId })
    }

    for (const vendorName of region.vendorNames) {
      let vendorId = vendorIdByName.get(vendorName)
      if (!vendorId) {
        const username = vendorName.toLowerCase()
        const fullName = spec.vendorFullNames[username] ?? vendorName
        const vendorResult = await db.insert(users).values({
          companyId,
          name: fullName,
          username,
          passwordHash: vendorHash,
          role: 'vendor',
        })
        vendorId = Number(vendorResult.lastInsertRowid)
        vendorIdByName.set(vendorName, vendorId)
      }
      await db.insert(regionVendors).values({ regionId, vendorId })
    }
  }

  console.log(
    `✅ ${spec.name} criada (companyId=${companyId}) com ${vendorIdByName.size} vendedor(es) em ${spec.regionsData.length} região(ões)`
  )
  return companyId
}

async function seed() {
  console.log('🌱 Iniciando seed do banco de dados...')

  // Odin Tubos e Conexões — empresa original
  const odinTubosId = await createCompany({
    name: 'Odin Tubos e Conexões',
    slug: 'odin-tubos',
    adminUsername: 'admin',
    adminPassword: 'admin123',
    vendorPassword: 'Odin@2024',
    vendorFullNames: { carlos: 'Carlos Silva', ana: 'Ana Souza', pedro: 'Pedro Lima' },
    regionsData: [
      { name: 'Norte', ddds: [91, 92, 93, 94, 95, 96, 97, 98, 99], vendorNames: ['Carlos'] },
      { name: 'Nordeste', ddds: [71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89], vendorNames: ['Ana'] },
      { name: 'Centro-Oeste', ddds: [61, 62, 63, 64, 65, 66, 67, 68, 69], vendorNames: ['Pedro'] },
      {
        name: 'Sudeste',
        ddds: [11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38],
        vendorNames: ['Carlos', 'Ana'],
      },
      { name: 'Sul', ddds: [41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55], vendorNames: ['Pedro', 'Carlos'] },
    ],
  })

  // Mensagens automáticas (WhatsApp/Email) — só a Odin Tubos vem com exemplos prontos
  await db.insert(messageTemplates).values([
    {
      companyId: odinTubosId,
      label: 'Retomada direta',
      whatsappText:
        'Olá, {{nome}}! Tudo bem? Aqui é da Odin Tubos e Conexões. Vi que você se interessou pelas nossas soluções em tubulação PPR Azul para ar comprimido e fiquei sem retorno seu. Ainda faz sentido pra você? Posso te ajudar com mais informações.',
      emailSubject: 'Ainda posso te ajudar, {{nome}}?',
      emailBody:
        'Olá, {{nome}},\n\nTudo bem? Sou da equipe comercial da Odin Tubos e Conexões. Vi que você demonstrou interesse em nossas soluções em tubulação PPR Azul para ar comprimido, mas ainda não conseguimos falar.\n\nFico à disposição para entender sua necessidade e te apresentar a melhor solução. Podemos conversar?\n\nAtenciosamente,\nEquipe Odin Tubos e Conexões',
    },
    {
      companyId: odinTubosId,
      label: 'Consultiva',
      whatsappText:
        'Oi, {{nome}}! Aqui é da Odin Tubos e Conexões. Notei seu interesse na nossa linha de tubulação PPR Azul e queria entender melhor o que você precisa — é uma instalação nova, ampliação ou troca de sistema? Assim já te indico a solução certa.',
      emailSubject: 'Vamos entender sua necessidade, {{nome}}?',
      emailBody:
        'Olá, {{nome}},\n\nVi que você teve interesse nas soluções da Odin Tubos e Conexões para ar comprimido. Antes de te enviar qualquer proposta, gostaria de entender melhor o seu projeto: é uma instalação nova, ampliação ou substituição de um sistema existente?\n\nCom essas informações, consigo te indicar a solução mais adequada.\n\nFico no aguardo do seu retorno.\n\nAtenciosamente,\nEquipe Odin Tubos e Conexões',
    },
    {
      companyId: odinTubosId,
      label: 'Oferta especial',
      whatsappText:
        'Olá, {{nome}}! Aqui é da Odin Tubos e Conexões. Estamos com uma condição especial este mês para quem já demonstrou interesse na nossa linha PPR Azul para ar comprimido — não queria que você perdesse. Posso te enviar os detalhes?',
      emailSubject: 'Condição especial pra você, {{nome}}',
      emailBody:
        'Olá, {{nome}},\n\nComo você já demonstrou interesse nas soluções da Odin Tubos e Conexões, quero te avisar que estamos com uma condição especial disponível este mês para novos projetos em tubulação PPR Azul para ar comprimido.\n\nPosso te enviar os detalhes e ver se faz sentido para o seu momento?\n\nAtenciosamente,\nEquipe Odin Tubos e Conexões',
    },
  ])
  console.log('✅ Mensagens automáticas da Odin Tubos criadas')

  // Odin Compressores
  const odinCompId = await createCompany({
    name: 'Odin Compressores',
    slug: 'odin-compressores',
    adminUsername: 'admin',
    adminPassword: 'OdinComp@2024',
    vendorPassword: 'OdinComp@2024',
    vendorFullNames: {},
    regionsData: [
      {
        name: 'Região Emily',
        ddds: dddsForStates(['RS', 'SC', 'MG', 'PR', 'SP', 'MT', 'GO', 'PE', 'ES']),
        vendorNames: ['Emily'],
      },
      {
        name: 'Região Matheus',
        ddds: dddsForStates(['AM', 'PA', 'RR', 'AP', 'AC', 'RO', 'TO', 'MA', 'PI', 'CE', 'RN', 'PB', 'AL', 'SE', 'BA', 'MS', 'RJ', 'DF']),
        vendorNames: ['Matheus'],
      },
    ],
  })

  await db.insert(messageTemplates).values([
    {
      companyId: odinCompId,
      label: 'Retomada direta',
      whatsappText:
        'Olá, {{nome}}! Tudo bem? Aqui é da Odin Compressores. Vi que você se interessou por um compressor de ar e fiquei sem retorno seu. Ainda faz sentido pra você? Posso te ajudar a fechar a melhor condição.',
      emailSubject: 'Ainda posso te ajudar, {{nome}}?',
      emailBody:
        'Olá, {{nome}},\n\nTudo bem? Sou da equipe comercial da Odin Compressores. Vi que você demonstrou interesse em um dos nossos compressores, mas ainda não conseguimos falar.\n\nFico à disposição para entender sua necessidade e te apresentar a melhor solução. Podemos conversar?\n\nAtenciosamente,\nEquipe Odin Compressores',
    },
    {
      companyId: odinCompId,
      label: 'Consultiva',
      whatsappText:
        'Oi, {{nome}}! Aqui é da Odin Compressores. Notei seu interesse e queria entender melhor sua aplicação — é uso industrial, oficina, ou linha de produção? Quantos HP ou litros você precisa? Assim já te indico o modelo certo.',
      emailSubject: 'Vamos entender sua necessidade, {{nome}}?',
      emailBody:
        'Olá, {{nome}},\n\nVi que você teve interesse nos compressores da Odin Compressores. Antes de te enviar qualquer proposta, gostaria de entender melhor sua aplicação: é uso industrial, oficina ou linha de produção? E qual a capacidade que você precisa?\n\nCom essas informações, consigo te indicar o modelo mais adequado.\n\nFico no aguardo do seu retorno.\n\nAtenciosamente,\nEquipe Odin Compressores',
    },
    {
      companyId: odinCompId,
      label: 'Oferta especial',
      whatsappText:
        'Olá, {{nome}}! Aqui é da Odin Compressores. Estamos com uma condição especial este mês para quem já demonstrou interesse nos nossos compressores — não queria que você perdesse. Posso te enviar os detalhes?',
      emailSubject: 'Condição especial pra você, {{nome}}',
      emailBody:
        'Olá, {{nome}},\n\nComo você já demonstrou interesse nos compressores da Odin Compressores, quero te avisar que estamos com uma condição especial disponível este mês.\n\nPosso te enviar os detalhes e ver se faz sentido para o seu momento?\n\nAtenciosamente,\nEquipe Odin Compressores',
    },
  ])
  console.log('✅ Mensagens automáticas da Odin Compressores criadas')

  // Joitec Distribuidora de Peças
  const joitecId = await createCompany({
    name: 'Joitec Distribuidora de Peças',
    slug: 'joitec',
    adminUsername: 'admin',
    adminPassword: 'Joitec@2024',
    vendorPassword: 'Joitec@2024',
    vendorFullNames: {},
    regionsData: [
      { name: 'Nordeste', ddds: dddsForStates(['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE']), vendorNames: ['Guilherme', 'Camila'] },
      { name: 'Norte', ddds: dddsForStates(['AC', 'AP', 'AM', 'RO', 'RR', 'PA', 'TO']), vendorNames: ['Antonio'] },
      { name: 'Centro-Oeste', ddds: dddsForStates(['DF', 'GO', 'MT', 'MS']), vendorNames: ['Douglas', 'Claudia'] },
      { name: 'Sudeste', ddds: dddsForStates(['ES', 'MG', 'RJ', 'SP']), vendorNames: ['Gino', 'Enzo', 'Sarah', 'Douglas'] },
      { name: 'Sul', ddds: dddsForStates(['PR', 'RS', 'SC']), vendorNames: ['Gustavo', 'Kati', 'Yuri'] },
    ],
  })

  await db.insert(messageTemplates).values([
    {
      companyId: joitecId,
      label: 'Retomada direta',
      whatsappText:
        'Olá, {{nome}}! Tudo bem? Aqui é da Joitec Distribuidora de Peças. Vi que você se interessou pelas nossas peças pneumáticas e fiquei sem retorno seu. Ainda faz sentido pra você? Posso te ajudar com mais informações.',
      emailSubject: 'Ainda posso te ajudar, {{nome}}?',
      emailBody:
        'Olá, {{nome}},\n\nTudo bem? Sou da equipe comercial da Joitec Distribuidora de Peças. Vi que você demonstrou interesse em nossas peças, mas ainda não conseguimos falar.\n\nFico à disposição para entender sua necessidade e te apresentar a melhor solução. Podemos conversar?\n\nAtenciosamente,\nEquipe Joitec',
    },
    {
      companyId: joitecId,
      label: 'Consultiva',
      whatsappText:
        'Oi, {{nome}}! Aqui é da Joitec Distribuidora de Peças. Notei seu interesse e queria entender melhor o que você precisa — é pra oficina, indústria ou revenda? Assim já te indico as peças certas e a rosca certa (1/4" ou M11).',
      emailSubject: 'Vamos entender sua necessidade, {{nome}}?',
      emailBody:
        'Olá, {{nome}},\n\nVi que você teve interesse nas peças da Joitec. Antes de te enviar qualquer proposta, gostaria de entender melhor sua necessidade: é pra oficina, indústria ou revenda?\n\nCom essas informações, consigo te indicar a solução mais adequada.\n\nFico no aguardo do seu retorno.\n\nAtenciosamente,\nEquipe Joitec',
    },
    {
      companyId: joitecId,
      label: 'Oferta especial',
      whatsappText:
        'Olá, {{nome}}! Aqui é da Joitec Distribuidora de Peças. Estamos com uma condição especial este mês para quem já demonstrou interesse nas nossas peças — não queria que você perdesse. Posso te enviar os detalhes?',
      emailSubject: 'Condição especial pra você, {{nome}}',
      emailBody:
        'Olá, {{nome}},\n\nComo você já demonstrou interesse nas peças da Joitec Distribuidora de Peças, quero te avisar que estamos com uma condição especial disponível este mês.\n\nPosso te enviar os detalhes e ver se faz sentido para o seu momento?\n\nAtenciosamente,\nEquipe Joitec',
    },
  ])
  console.log('✅ Mensagens automáticas da Joitec criadas')

  console.log('\n🎉 Seed concluído com sucesso!')
  console.log('\n📋 Credenciais:')
  console.log('  Odin Tubos e Conexões:')
  console.log('    Admin:  admin / admin123')
  console.log('    Carlos: carlos / Odin@2024')
  console.log('    Ana:    ana / Odin@2024')
  console.log('    Pedro:  pedro / Odin@2024')
  console.log('  Odin Compressores:')
  console.log('    Admin:   admin / OdinComp@2024')
  console.log('    Emily:   emily / OdinComp@2024')
  console.log('    Matheus: matheus / OdinComp@2024')
  console.log('  Joitec Distribuidora de Peças:')
  console.log('    Admin: admin / Joitec@2024')
  console.log('    Vendedores (guilherme, camila, antonio, douglas, claudia, gino, enzo, sarah, gustavo, kati, yuri): Joitec@2024')
  process.exit(0)
}

seed().catch((err) => {
  console.error('❌ Erro no seed:', err)
  process.exit(1)
})
