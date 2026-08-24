import { eq, and } from 'drizzle-orm'
import { db } from '../db/client.js'
import { funcaoTemplates, funcaoTemplateFeatures } from '../db/schema.js'
import { FEATURES_ADMIN, FEATURES_VENDEDOR } from '../router/permissoes.js'

// Telas do módulo de RH (vagas/candidatos/mensagens) — extraído à parte pra
// reaproveitar tanto no seed inicial quanto no backfill de quem já tinha o
// template "RH" criado antes desse módulo existir (ver backfillFuncaoRh).
const RH_FEATURES = ['dashboard', 'vagas', 'candidatos', 'mensagens_rh'] as const

const DEFAULTS: { nome: string; role: 'admin' | 'vendor'; features: readonly string[] }[] = [
  { nome: 'Vendedor', role: 'vendor', features: FEATURES_VENDEDOR.filter((f) => f !== 'banco_clientes') },
  { nome: 'Administrador', role: 'admin', features: FEATURES_ADMIN },
  // As 4 abaixo nascem só com o que o setor costuma usar — de propósito SEM
  // painel_tv/painel_financeiro/kanban/carteira etc pra quem não é do
  // comercial. O superAdmin edita/renomeia/cria à vontade depois em Funções;
  // isso aqui é só o ponto de partida na primeira vez que a empresa usa a
  // tela.
  { nome: 'Compras', role: 'admin', features: ['dashboard', 'compras', 'relatorios'] },
  { nome: 'RH', role: 'admin', features: RH_FEATURES },
  { nome: 'Financeiro', role: 'admin', features: ['dashboard', 'caixa', 'painel_financeiro', 'relatorios'] },
  { nome: 'Marketing', role: 'admin', features: ['dashboard', 'relatorios'] },
]

// Cria os modelos padrão pra toda empresa que ainda não tem NENHUM
// funcaoTemplate — só roda uma vez por empresa (empresa nova, ou primeiro
// boot depois que essa tela passou a existir). Não roda de novo pra quem já
// tem pelo menos 1 template, mesmo que o superAdmin tenha apagado os 6
// originais de propósito.
export async function seedFuncaoTemplatesPadrao() {
  const todasEmpresas = await db.query.empresas.findMany({ columns: { id: true } })
  for (const empresa of todasEmpresas) {
    const jaTem = await db.query.funcaoTemplates.findFirst({ where: eq(funcaoTemplates.empresaId, empresa.id) })
    if (jaTem) continue

    for (const modelo of DEFAULTS) {
      const result = await db.insert(funcaoTemplates).values({ empresaId: empresa.id, nome: modelo.nome, role: modelo.role })
      const templateId = Number(result.lastInsertRowid)
      if (modelo.features.length > 0) {
        await db.insert(funcaoTemplateFeatures).values(modelo.features.map((feature) => ({ templateId, feature })))
      }
    }
    console.log(`[funcaoTemplates] funções padrão criadas pra empresa ${empresa.id}`)
  }
}

// O template "RH" de cada empresa já existia antes do módulo de vagas/
// candidatos nascer (nasceu só com dashboard+usuarios) — sem isso, quem já
// rodou o seedFuncaoTemplatesPadrao antes ficaria com o RH capado pra
// sempre. Idempotente: só mexe no template que ainda não tem 'vagas'.
export async function backfillFuncaoRh() {
  const templatesRh = await db.query.funcaoTemplates.findMany({ where: eq(funcaoTemplates.nome, 'RH') })
  for (const template of templatesRh) {
    const jaTem = await db.query.funcaoTemplateFeatures.findFirst({
      where: and(eq(funcaoTemplateFeatures.templateId, template.id), eq(funcaoTemplateFeatures.feature, 'vagas')),
    })
    if (jaTem) continue

    const featuresAtuais = await db.query.funcaoTemplateFeatures.findMany({ where: eq(funcaoTemplateFeatures.templateId, template.id) })
    const jaExistentes = new Set(featuresAtuais.map((f) => f.feature))
    const faltando = RH_FEATURES.filter((f) => !jaExistentes.has(f))
    if (faltando.length === 0) continue

    await db.insert(funcaoTemplateFeatures).values(faltando.map((feature) => ({ templateId: template.id, feature })))
    console.log(`[funcaoTemplates] backfill de RH (vagas/candidatos/mensagens) aplicado ao template ${template.id}`)
  }
}
