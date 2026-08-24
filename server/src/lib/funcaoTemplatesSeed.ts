import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { funcaoTemplates, funcaoTemplateFeatures } from '../db/schema.js'
import { FEATURES_ADMIN, FEATURES_VENDEDOR } from '../router/permissoes.js'

const DEFAULTS: { nome: string; role: 'admin' | 'vendor'; features: readonly string[] }[] = [
  { nome: 'Vendedor', role: 'vendor', features: FEATURES_VENDEDOR.filter((f) => f !== 'banco_clientes') },
  { nome: 'Administrador', role: 'admin', features: FEATURES_ADMIN },
  // As 4 abaixo nascem só com o que o setor costuma usar — de propósito SEM
  // painel_tv/painel_financeiro/kanban/carteira etc pra quem não é do
  // comercial. O superAdmin edita/renomeia/cria à vontade depois em Funções;
  // isso aqui é só o ponto de partida na primeira vez que a empresa usa a
  // tela.
  { nome: 'Compras', role: 'admin', features: ['dashboard', 'compras', 'relatorios'] },
  { nome: 'RH', role: 'admin', features: ['dashboard', 'usuarios'] },
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
