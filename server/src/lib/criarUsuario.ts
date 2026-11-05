import bcrypt from 'bcryptjs'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { funcaoTemplates, metasMensais, permissoesAdmin, users } from '../db/schema.js'
import { getConfigNumero } from './configuracoes.js'
import { mesReferenciaAtual } from './dataBr.js'

export function gerarSenhaTemporaria(): string {
  return `Joitec${Math.random().toString(36).slice(2, 8)}9x`
}

export const REGIAO_VALUES = ['norte', 'nordeste', 'centro_oeste', 'sudeste', 'sul'] as const

// Criação de conta — usada pela tela Usuários e pelo "Criar conta" de vendedor
// novo do SAP (lib/sapVendedoresNovos.ts).
export async function criarUsuario(dados: {
  empresaId: number
  name: string
  username: string
  funcaoTemplateId: number
  regiao?: (typeof REGIAO_VALUES)[number]
}): Promise<{ id: number; senhaTemporaria: string }> {
  // username é único globalmente (o login não sabe de qual empresa é
  // antes de autenticar), então essa checagem não leva empresaId.
  const existing = await db.query.users.findFirst({ where: eq(users.username, dados.username) })
  if (existing) throw new Error('Nome de usuário já existe')

  const template = await db.query.funcaoTemplates.findFirst({
    where: and(eq(funcaoTemplates.id, dados.funcaoTemplateId), eq(funcaoTemplates.empresaId, dados.empresaId)),
    with: { features: true },
  })
  if (!template) throw new Error('Função inválida')

  const senhaTemporaria = gerarSenhaTemporaria()
  const hash = await bcrypt.hash(senhaTemporaria, 12)
  const result = await db.insert(users).values({
    empresaId: dados.empresaId,
    name: dados.name,
    username: dados.username,
    passwordHash: hash,
    role: template.role,
    funcaoTemplateId: template.id,
    regiao: dados.regiao,
    senhaTrocarNoLogin: true,
  })
  const id = Number(result.lastInsertRowid)

  // Já nasce com as telas do template escolhido, em vez de nascer cego
  // até o superAdmin configurar manualmente em Permissões.
  if (template.features.length > 0) {
    await db.insert(permissoesAdmin).values(template.features.map((f) => ({ userId: id, feature: f.feature })))
  }

  // Vendedor novo já nasce com meta do mês corrente (padrão configurável
  // em Configurações) — evita aparecer sem meta no dashboard/TV.
  if (template.role === 'vendor') {
    const metaFaturamento = await getConfigNumero('meta_faturamento_padrao', 100000)
    const metaLigacoesDia = await getConfigNumero('meta_ligacoes_dia_padrao', 25)
    await db.insert(metasMensais).values({
      vendedorId: id,
      mesReferencia: mesReferenciaAtual(),
      metaFaturamento,
      metaLigacoesDia,
    })
  }

  return { id, senhaTemporaria }
}
