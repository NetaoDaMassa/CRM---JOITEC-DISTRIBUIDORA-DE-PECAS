import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { router, protectedProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { permissoesAdmin, users } from '../db/schema.js'
import { registrarAuditoria } from '../lib/auditoria.js'

// Chaves fixas — 1:1 com ADMIN_LINKS em client/src/components/Sidebar.tsx.
// superAdmin nunca depende dessa lista: sempre vê tudo (ver Sidebar/rotas).
export const FEATURES_ADMIN = [
  'dashboard',
  'kanban',
  'pos_venda',
  'agenda',
  'clientes',
  'prospeccao',
  'aprovacoes',
  'carteira',
  'banco_clientes',
  'importar',
  'relatorios',
  'usuarios',
  'metas',
  'mensagens',
  'caixa',
  'compras',
  'lixeira',
  'configuracoes',
  'backup',
  'painel_financeiro',
  'painel_tv',
  'marketing_analytics',
  // Devolução (Grupo Odin) — 'devolucoes' já libera o Kanban de chamados
  // pra admin (que sempre passa por ser admin); as demais são poderes extra
  // que um admin normal não tem por padrão, precisam ser concedidos:
  // 'devolucoes_mecanica' (módulo Mecânica, equivalente ao antigo "gestor de
  // estoque"), 'devolucoes_demonstracao', 'devolucoes_ver_comissao' (campos
  // "quem errou"/impacto na comissão — sigiloso, nunca on por padrão),
  // 'devolucoes_excluir_chamado' e 'devolucoes_finalizar_fora_ordem' (os 2
  // poderes que no sistema original eram fixos por e-mail — Paola/Andreia —
  // agora concedidos por aqui, a quem for). 'devolucoes_visao_global' é pra
  // quem trata devolução das 4 empresas do grupo (hoje só a Amanda) — em vez
  // de logar em cada empresa separada, essa feature junta as 4 numa tela só.
  'devolucoes',
  'devolucoes_mecanica',
  'devolucoes_demonstracao',
  'devolucoes_ver_comissao',
  'devolucoes_excluir_chamado',
  'devolucoes_finalizar_fora_ordem',
  'devolucoes_visao_global',
  // Módulo de RH (vagas/candidatos), portado do CRM-GRUPO-ODIN — nome
  // 'mensagens_rh' de propósito diferente de 'mensagens' (templates de
  // venda), pra não colidir.
  'vagas',
  'candidatos',
  'mensagens_rh',
  // Leads de venda (site) — módulo novo, portado do sistema CRM-GRUPO-ODIN.
  // Diferente do RH, também existe em FEATURES_VENDEDOR (é tela de uso
  // diário do vendedor, não só do admin).
  'leads',
  // Kanban de Pedidos (pós-venda) — só Odin Compressores, portado do
  // odincrm.duckdns.org. Também existe em FEATURES_VENDEDOR (é tela de uso
  // diário do vendedor, que cria pedido e preenche dados de várias etapas).
  'pedidos_odin',
  // Funil de Propostas — só Odin Compressores, portado do odincrm.duckdns.org.
  // Também existe em FEATURES_VENDEDOR (vendedor cria e acompanha as próprias).
  'propostas_odin',
  // Lista de Revendas — só Odin Compressores, portado do odincrm.duckdns.org.
  'revendas_odin',
  // Almoxarifado (porta-pallets, vagas, máquinas em estoque, catálogo de
  // modelos) — só Odin Compressores, portado do odincrm.duckdns.org. Só
  // existe em FEATURES_ADMIN — no sistema original é gestor-only, vendedor
  // nunca tem acesso a essa tela.
  'estoque_odin',
  // Visitas de campo — só Odin Compressores, portado do odincrm.duckdns.org.
  // Também existe em FEATURES_VENDEDOR (é a tela de uso diário do vendedor em campo).
  'visitas_odin',
  // Controle de Qualidade (resumo de anexos+histórico de Pedidos) — só Odin
  // Compressores, gestor-only, não existe em FEATURES_VENDEDOR.
  'qualidade_odin',
  // Configurações auxiliares (condições de pagamento, transportadoras,
  // modelos de e-mail) — só Odin Compressores, gestor-only.
  'configuracoes_odin',
] as const

// Chaves fixas — 1:1 com VENDOR_LINKS em Sidebar.tsx. Repete de propósito
// algumas chaves que também existem em FEATURES_ADMIN (kanban, agenda,
// clientes, prospeccao, pos_venda, banco_clientes, relatorios) — é a mesma
// string, mas nunca colide: o Sidebar já filtra ADMIN_LINKS ou VENDOR_LINKS
// pelo role antes de checar a feature, então cada papel só enxerga os itens
// da própria lista.
export const FEATURES_VENDEDOR = [
  'meu_painel',
  'fila_hoje',
  'pos_venda',
  'kanban',
  'agenda',
  'clientes',
  'prospeccao',
  'banco_clientes',
  'relatorios',
  'solicitar_design',
  // Visão "Faturamento Geral" (Compretec Loja Física) — todos os cards
  // Fechado/Faturamento da empresa, de qualquer vendedor, num board só.
  'faturamento_geral',
  // Devolução — mesmas chaves de FEATURES_ADMIN (ver comentário lá). Um
  // vendedor com 'devolucoes' + 'devolucoes_mecanica' concedidos, por
  // exemplo, cobre o antigo papel "gestor padrão" do sistema original, sem
  // precisar virar admin de verdade (que abriria todo o resto do CRM).
  'devolucoes',
  'devolucoes_mecanica',
  'devolucoes_demonstracao',
  'devolucoes_ver_comissao',
  'devolucoes_excluir_chamado',
  'devolucoes_finalizar_fora_ordem',
  // Leads de venda (site) — mesma chave de FEATURES_ADMIN acima.
  'leads',
  // Kanban de Pedidos (pós-venda) — mesma chave de FEATURES_ADMIN acima.
  'pedidos_odin',
  // Funil de Propostas — mesma chave de FEATURES_ADMIN acima.
  'propostas_odin',
  // Lista de Revendas — mesma chave de FEATURES_ADMIN acima.
  'revendas_odin',
  // Visitas de campo — mesma chave de FEATURES_ADMIN acima.
  'visitas_odin',
] as const

// Abas de dentro de Relatórios — controle mais fino que o 'relatorios' acima
// (esse continua controlando a página inteira pro admin; estas controlam
// aba por aba, tanto pra admin quanto pra vendedor). "Todas as Empresas" não
// entra aqui: é superAdminOnly sempre, direto no componente, sem depender
// dessa tabela. Reaproveita a mesma tabela `permissoes_admin` (o nome ficou
// datado, mas a coluna `feature` é só uma string livre, serve pra qualquer
// papel de usuário).
export const FEATURES_RELATORIOS = [
  'relatorio_visao_geral',
  'relatorio_contatos',
  'relatorio_orcamentos',
  'relatorio_alertas',
] as const

export const permissoesRouter = router({
  // Lista todos os admins (de qualquer empresa) pra tela de configuração —
  // só o superAdmin monta essa tela.
  listarAdmins: superAdminProcedure.query(async () => {
    const admins = await db.query.users.findMany({
      where: eq(users.role, 'admin'),
      columns: { id: true, name: true, username: true, empresaId: true, superAdmin: true, isActive: true },
      with: { funcaoTemplate: { columns: { nome: true } } },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    const todasPermissoes = await db.query.permissoesAdmin.findMany()
    const porUsuario = new Map<number, string[]>()
    for (const p of todasPermissoes) {
      const lista = porUsuario.get(p.userId) ?? []
      lista.push(p.feature)
      porUsuario.set(p.userId, lista)
    }
    return admins.map((a) => ({ ...a, funcaoNome: a.funcaoTemplate?.nome ?? null, features: porUsuario.get(a.id) ?? [] }))
  }),

  // Mesma ideia de listarAdmins, mas pra vendedores — itens da Sidebar dele
  // (VENDOR_LINKS) + abas de relatório, tudo junto na mesma tela.
  listarVendedores: superAdminProcedure.query(async () => {
    const vendedores = await db.query.users.findMany({
      where: eq(users.role, 'vendor'),
      columns: { id: true, name: true, username: true, empresaId: true, isActive: true },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    const todasPermissoes = await db.query.permissoesAdmin.findMany({
      where: inArray(permissoesAdmin.feature, [...FEATURES_VENDEDOR, ...FEATURES_RELATORIOS]),
    })
    const porUsuario = new Map<number, string[]>()
    for (const p of todasPermissoes) {
      const lista = porUsuario.get(p.userId) ?? []
      lista.push(p.feature)
      porUsuario.set(p.userId, lista)
    }
    return vendedores.map((v) => ({ ...v, features: porUsuario.get(v.id) ?? [] }))
  }),

  // Features liberadas pro usuário logado — usado pelo Sidebar/route guard.
  // superAdmin sempre recebe a lista completa, sem depender de linhas na tabela.
  minhasPermissoes: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.superAdmin) return [...FEATURES_ADMIN]
    const linhas = await db.query.permissoesAdmin.findMany({ where: eq(permissoesAdmin.userId, ctx.user.id) })
    return linhas.map((l) => l.feature)
  }),

  // Substitui o conjunto inteiro de features liberadas pra pessoa alvo
  // (itens de menu + abas de relatórios juntos) — funciona pra admin OU
  // vendedor, a mesma tabela/mecanismo pros dois papéis agora.
  atualizar: superAdminProcedure
    .input(
      z.object({
        userId: z.number(),
        features: z.array(z.enum([...FEATURES_ADMIN, ...FEATURES_VENDEDOR, ...FEATURES_RELATORIOS])),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const alvo = await db.query.users.findFirst({ where: eq(users.id, input.userId) })
      if (!alvo || (alvo.role !== 'admin' && alvo.role !== 'vendor')) throw new Error('Usuário não encontrado')

      await db.delete(permissoesAdmin).where(eq(permissoesAdmin.userId, input.userId))
      if (input.features.length > 0) {
        await db.insert(permissoesAdmin).values(input.features.map((feature) => ({ userId: input.userId, feature })))
      }

      await registrarAuditoria({
        tabela: 'permissoes_admin',
        registroId: input.userId,
        acao: 'editar',
        valorNovo: input.features.join(','),
        alteradoPor: ctx.user.id,
      })
      return { success: true }
    }),
})
