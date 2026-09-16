// Carga ÚNICA — replica os 5 modelos de mensagem (WhatsApp/e-mail de
// follow-up da Carteira) que já existem pra Joitec Distribuidora (empresaId
// 1) pras outras empresas que ainda não têm nenhum. Pedido do João,
// 2026-09-16: "modelo de mensagem... cria algumas pra todas as empresas
// igual a joitec tem".
//
// Idempotente: só insere modelo cuja `label` ainda não existe naquela
// empresa (não duplica, não erra rodando de novo). Texto igual ao de
// Joitec, só trocando o nome da empresa — variáveis {{nome}}/{{cidade}}/
// {{dias_sem_contato}}/{{ultimo_contato}} continuam intactas (são
// substituídas na hora de mandar, ver FunilBoard.tsx `interpolarMensagem`).
//
// Rodar:
//   Local:  npx tsx src/scripts/seedMessageTemplatesTodasEmpresas.ts --dry-run
//           npx tsx src/scripts/seedMessageTemplatesTodasEmpresas.ts
//   VPS:    docker compose exec backend node dist/scripts/seedMessageTemplatesTodasEmpresas.js --dry-run
//           docker compose exec backend node dist/scripts/seedMessageTemplatesTodasEmpresas.js
import { config } from 'dotenv'
config()

import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, messageTemplates } from '../db/schema.js'

const dryRun = process.argv.includes('--dry-run')

function templatesParaEmpresa(nomeEmpresa: string) {
  return [
    {
      label: 'Retomada de contato',
      whatsappText: `Olá, {{nome}}! Tudo bem? Aqui é da ${nomeEmpresa}. Faz um tempinho que a gente não conversa e queria saber se você precisa de alguma coisa ou tem alguma dúvida sobre os produtos. Fico à disposição!`,
      emailSubject: `${nomeEmpresa} — retomando contato`,
      emailBody: `Olá, {{nome}},\n\nTudo bem? Faz um tempo que não conversamos e gostaria de saber se posso ajudar com algo — seja uma dúvida, um pedido novo ou reposição de estoque.\n\nFico à disposição!\n\nAtenciosamente,\nEquipe ${nomeEmpresa}`,
    },
    {
      label: 'Oferta / novidade',
      whatsappText: `Oi, {{nome}}! Tudo certo? Temos novidades e condições especiais que podem te interessar. Posso te passar mais detalhes?`,
      emailSubject: `${nomeEmpresa} — novidades e condições especiais`,
      emailBody: `Olá, {{nome}},\n\nTemos novidades no nosso catálogo e condições especiais que podem ser do seu interesse.\n\nPosso te passar mais detalhes? Fico no aguardo!\n\nAtenciosamente,\nEquipe ${nomeEmpresa}`,
    },
    {
      label: 'Confirmação de pedido/entrega',
      whatsappText: `Olá, {{nome}}! Passando aqui pra confirmar os detalhes do seu pedido e alinhar o prazo de entrega. Qualquer dúvida, me chama!`,
      emailSubject: `${nomeEmpresa} — confirmação do seu pedido`,
      emailBody: `Olá, {{nome}},\n\nPassando para confirmar os detalhes do seu pedido e alinhar o prazo de entrega.\n\nQualquer dúvida, estou à disposição!\n\nAtenciosamente,\nEquipe ${nomeEmpresa}`,
    },
    {
      label: 'Recuperação de cliente',
      whatsappText: `Olá, {{nome}}! Aqui é da ${nomeEmpresa}. Notei que já faz um tempo desde nosso último contato ({{ultimo_contato}}) e queria saber se está tudo bem por aí. Sentimos sua falta! Precisando de peças ou tiver alguma necessidade, é só me chamar que já te atendo.`,
      emailSubject: `${nomeEmpresa} — sentimos sua falta, {{nome}}!`,
      emailBody: `Olá, {{nome}},\n\nFaz um tempinho que não fechamos pedido junto ({{dias_sem_contato}} dias) e eu queria entender se está tudo certo — às vezes muda alguma coisa na operação e a gente nem fica sabendo.\n\nSe precisar de peças, tiver alguma dúvida ou quiser revisar as condições comerciais, estou à disposição pra conversar.\n\nUm abraço,\nEquipe ${nomeEmpresa}`,
    },
    {
      label: 'Recuperação de cliente — oferta especial',
      whatsappText: `Oi, {{nome}}! Tudo bem? Faz tempo que a gente não fecha um pedido e preparei uma condição especial de retorno pra você em {{cidade}}. Topa dar uma olhada? É rapidinho.`,
      emailSubject: `${nomeEmpresa} — condição especial pra você, {{nome}}`,
      emailBody: `Olá, {{nome}},\n\nComo cliente que já confiou na ${nomeEmpresa}, separei uma condição especial de retorno pensando em reativar nossa parceria.\n\nMe conta o que você está precisando que já monto uma proposta com essas condições.\n\nAguardo seu retorno!\n\nAtenciosamente,\nEquipe ${nomeEmpresa}`,
    },
  ]
}

async function run() {
  console.log(`[seed-message-templates] ${dryRun ? 'DRY RUN — nada será gravado' : 'gravando'}\n`)

  const todasEmpresas = await db.query.empresas.findMany({ columns: { id: true, nome: true } })

  let criados = 0
  let jaExistiam = 0
  for (const empresa of todasEmpresas) {
    const existentes = await db.query.messageTemplates.findMany({
      where: eq(messageTemplates.empresaId, empresa.id),
      columns: { label: true },
    })
    const labelsExistentes = new Set(existentes.map((t) => t.label))

    for (const modelo of templatesParaEmpresa(empresa.nome)) {
      if (labelsExistentes.has(modelo.label)) {
        jaExistiam++
        continue
      }
      console.log(`  + [${empresa.nome}] ${modelo.label}`)
      if (!dryRun) {
        await db.insert(messageTemplates).values({ ...modelo, empresaId: empresa.id })
      }
      criados++
    }
  }

  console.log(`\n[seed-message-templates] ${dryRun ? 'conferido' : 'criado'}: ${criados} modelo(s) novo(s) (${jaExistiam} já existiam).`)
  process.exit(0)
}

run().catch((err) => {
  console.error('[seed-message-templates] erro:', err)
  process.exit(1)
})
