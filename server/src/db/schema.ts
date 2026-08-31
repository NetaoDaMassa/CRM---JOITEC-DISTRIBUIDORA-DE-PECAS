import { sqliteTable, text, integer, real, unique, index } from 'drizzle-orm/sqlite-core'
import { relations, sql } from 'drizzle-orm'

// Multi-empresa (adicionado quando a Odin Tubos e Conexões entrou no mesmo
// CRM) — cada empresa é isolada (clientes/vendedores próprios); só o
// `superAdmin` (users.superAdmin) consegue trocar de empresa sem logar de
// novo, via header `x-empresa-id` resolvido em `createContext`. Tabelas que
// penduram em `clientes`/`users` (funil, vendas, contatos, metas...) não
// ganharam `empresaId` próprio — o isolamento delas vem do join em
// `clientes.empresaId`/`users.empresaId` em cada query de listagem.
export const empresas = sqliteTable('empresas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nome: text('nome').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Configurações gerais do sistema, chave-valor (valor sempre armazenado como
// texto — quem lê decide o parse, ex: Number(valor)). Compartilhada entre
// todas as empresas por enquanto (não virou multi-empresa nesta rodada).
export const configuracoes = sqliteTable('configuracoes', {
  chave: text('chave').primaryKey(),
  valor: text('valor').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// Modelos de função pra criação de usuário (Vendedor/Admin/Compras/RH/
// Financeiro/Marketing e o que mais o superAdmin quiser criar em Funções) —
// cada um decide o `role` (só quem marca 'vendor' vira vendedor de verdade,
// com carteira/Kanban/meta; o resto é admin com acesso restrito) e a lista
// de telas que um usuário criado com ele já nasce enxergando (ver
// funcaoTemplateFeatures). Por empresa — cada empresa do grupo pode ter seu
// próprio conjunto de funções.
export const funcaoTemplates = sqliteTable('funcao_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  nome: text('nome').notNull(),
  role: text('role', { enum: ['admin', 'vendor'] }).notNull().default('admin'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Telas liberadas por template — presença de (templateId, feature) = essa
// função nasce com aquela tela marcada. Mesma ideia normalizada de
// permissoesAdmin, só que por template em vez de por usuário.
export const funcaoTemplateFeatures = sqliteTable(
  'funcao_template_features',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    templateId: integer('template_id').notNull().references(() => funcaoTemplates.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(),
  },
  (t) => ({
    templateFeature: unique().on(t.templateId, t.feature),
  })
)

export const funcaoTemplatesRelations = relations(funcaoTemplates, ({ many }) => ({
  features: many(funcaoTemplateFeatures),
}))

export const funcaoTemplateFeaturesRelations = relations(funcaoTemplateFeatures, ({ one }) => ({
  template: one(funcaoTemplates, { fields: [funcaoTemplateFeatures.templateId], references: [funcaoTemplates.id] }),
}))

// Grupos colapsáveis da sidebar (ex: "Marketing" contendo Leads/Kanban de
// Leads/Solicitar Arte) — o superAdmin monta em Configurações > Grupos da
// Sidebar. Globais (SEM empresaId): é organização do menu em si, não um
// dado de negócio que varie por empresa — mesmas telas existem em todo
// lugar, só a visibilidade de cada uma já é filtrada por feature/empresa
// como sempre foi (ver Sidebar.tsx). Item que não está em nenhum grupo
// continua aparecendo solto.
export const sidebarGroups = sqliteTable('sidebar_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nome: text('nome').notNull(),
  icone: text('icone').notNull(),
  ordem: integer('ordem').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Itens dentro de um grupo — `linkTo` é o `to`/`href` do item na sidebar
// (ex: '/admin/leads'), validado contra uma lista fixa no router (não é FK,
// não existe tabela de "links" — mesma ideia de `feature` em
// funcaoTemplateFeatures, texto livre validado na borda).
export const sidebarGroupItems = sqliteTable(
  'sidebar_group_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id').notNull().references(() => sidebarGroups.id, { onDelete: 'cascade' }),
    linkTo: text('link_to').notNull(),
    ordem: integer('ordem').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    grupoLink: unique().on(t.groupId, t.linkTo),
  })
)

export const sidebarGroupsRelations = relations(sidebarGroups, ({ many }) => ({
  itens: many(sidebarGroupItems),
}))

export const sidebarGroupItemsRelations = relations(sidebarGroupItems, ({ one }) => ({
  grupo: one(sidebarGroups, { fields: [sidebarGroupItems.groupId], references: [sidebarGroups.id] }),
}))

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  name: text('name').notNull(),
  // Continua único globalmente (não composto com empresaId) — o login não
  // tem seletor de empresa, resolve o usuário só pelo username.
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'vendor'] }).notNull().default('vendor'),
  // Função escolhida na criação (aponta pra um modelo em funcaoTemplates,
  // que o próprio superAdmin cria/edita em Funções) — só rótulo + atalho pra
  // semear as permissões certas na hora de criar o usuário. Quem decide o
  // que a pessoa realmente enxerga continua sendo `role` + a tabela
  // permissoesAdmin; editar o template depois NÃO reaplica nada em quem já
  // foi criado com ele (evita apagar ajuste manual que o superAdmin já fez
  // pra alguém específico em Permissões). `set null` no delete do template
  // pra não travar a exclusão nem apagar o usuário — só perde o rótulo.
  funcaoTemplateId: integer('funcao_template_id').references(() => funcaoTemplates.id, { onDelete: 'set null' }),
  // Só verdadeiro pra conta(s) que podem trocar de empresa ativa sem logar de
  // novo (o dono/gestor geral) — ver createContext.
  superAdmin: integer('super_admin', { mode: 'boolean' }).notNull().default(false),
  regiao: text('regiao', {
    enum: ['norte', 'nordeste', 'centro_oeste', 'sudeste', 'sul'],
  }),
  fotoUrl: text('foto_url'),
  // Usado pelos botões de WhatsApp do módulo de Devolução (notificar o
  // vendedor quando o status do chamado muda) — opcional, nem todo mundo
  // precisa preencher.
  whatsapp: text('whatsapp'),
  temaPreferido: text('tema_preferido', { enum: ['claro', 'escuro'] }).notNull().default('claro'),
  senhaTrocarNoLogin: integer('senha_trocar_no_login', { mode: 'boolean' }).notNull().default(false),
  tentativasLoginFalhas: integer('tentativas_login_falhas').notNull().default(0),
  bloqueadoAte: text('bloqueado_ate'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  // Continua vendedor normal (login, carteira, Kanban) — só some do
  // ranking/gráficos do Painel de TV, pra casos tipo alguém de licença ou
  // que o gestor não quer expor no telão por qualquer motivo específico.
  ocultoPainelTv: integer('oculto_painel_tv', { mode: 'boolean' }).notNull().default(false),
  // Hoje só usado pelo Painel de TV da Odin Compressores — separa quem
  // trabalha em campo (visita → proposta → venda) de quem só atende leads
  // do site (Emily/Rodrigo/Matheus: lead → proposta → venda, sem visita).
  // Fica na tabela global de users, igual regiao/ocultoPainelTv, mesmo só
  // fazendo sentido pra essa empresa hoje.
  canalVenda: text('canal_venda', { enum: ['visitas', 'leads'] }).notNull().default('visitas'),
  // Só o último — o histórico dia a dia de acesso fica em logAcessoUsuario.
  lastLoginAt: text('last_login_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// Vincula duas contas que são a mesma pessoa em empresas diferentes (ex:
// Sergio tem login separado em Joitec e em Odin Tubos, cada carteira
// pertence à empresa certa) — permite "trocar empresa" sem digitar senha
// de novo, sem precisar de um modelo real de multi-empresa por usuário.
// Sempre gravado nos dois sentidos (par simétrico): se A pode trocar pra
// B, B também pode trocar pra A.
export const contasVinculadas = sqliteTable(
  'contas_vinculadas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    contaVinculadaId: integer('conta_vinculada_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    parUnico: unique().on(t.userId, t.contaVinculadaId),
  })
)

// Um registro por login — dá o histórico de acesso dia a dia (não só o
// último login), pra admin ver quais vendedores não estão entrando no CRM.
export const logAcessoUsuario = sqliteTable(
  'log_acesso_usuario',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    criadoEm: text('criado_em').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    usuarioIdx: index('idx_log_acesso_usuario_usuario').on(t.usuarioId),
  })
)

export const logAcessoUsuarioRelations = relations(logAcessoUsuario, ({ one }) => ({
  usuario: one(users, { fields: [logAcessoUsuario.usuarioId], references: [users.id] }),
}))

// Acumulado de tempo online por dia — o frontend manda um "ping" a cada
// minuto enquanto a aba está em foco, e cada ping soma o intervalo desde o
// ping anterior (só se for pequeno o suficiente pra não ser um hiato de aba
// fechada/computador dormindo — ver activityRouter.ping).
export const atividadeDiariaUsuario = sqliteTable(
  'atividade_diaria_usuario',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    data: text('data').notNull(), // YYYY-MM-DD, fuso de Brasília
    segundosOnline: integer('segundos_online').notNull().default(0),
    primeiroPingEm: text('primeiro_ping_em').notNull(),
    ultimoPingEm: text('ultimo_ping_em').notNull(),
  },
  (t) => ({
    usuarioData: unique().on(t.usuarioId, t.data),
    usuarioIdx: index('idx_atividade_diaria_usuario_usuario').on(t.usuarioId),
  })
)

export const atividadeDiariaUsuarioRelations = relations(atividadeDiariaUsuario, ({ one }) => ({
  usuario: one(users, { fields: [atividadeDiariaUsuario.usuarioId], references: [users.id] }),
}))

export const clientes = sqliteTable('clientes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  razaoSocial: text('razao_social').notNull(),
  // Nem todo cliente tem CNPJ (boa parte da carteira real são pessoas físicas/
  // pequenos clientes) — por isso é opcional, e o identificador único de
  // verdade é `codigo`, não o CNPJ. Únicos por empresa (não globais), senão
  // uma segunda empresa nunca conseguiria ter um código/CNPJ que coincida
  // por acaso com o de um cliente da outra.
  cnpj: text('cnpj'),
  // Pessoa física — alternativa ao CNPJ, não os dois juntos (o formulário de
  // cadastro pergunta "pessoa física ou jurídica" e mostra só o campo certo).
  cpf: text('cpf'),
  codigo: text('codigo').notNull(),
  codigoAntigo: text('codigo_antigo'),
  inscricaoEstadual: text('inscricao_estadual'),
  regiao: text('regiao', {
    enum: ['norte', 'nordeste', 'centro_oeste', 'sudeste', 'sul'],
  }).notNull(),
  estado: text('estado'),
  cidade: text('cidade'),
  endereco: text('endereco'),
  telefoneWhatsapp: text('telefone_whatsapp'),
  email: text('email'),
  // Nome da pessoa de contato na empresa do cliente — diferente da razão
  // social (nome da empresa em si). Pedido do João pra vendedor saber com
  // quem falar sem depender só do WhatsApp/e-mail salvos.
  nomeContato: text('nome_contato'),
  // Status fiscal do cliente perante impostos (isento, contribuinte normal
  // ou consumidor final — pessoa física/quem compra sem repassar/revender) —
  // o vendedor completa isso no cadastro, junto com CNPJ/IE.
  statusFiscal: text('status_fiscal', { enum: ['isento', 'normal', 'consumidor_final'] }),
  vendedorAtualId: integer('vendedor_atual_id').references(() => users.id, { onDelete: 'set null' }),
  // Rótulo de origem quando o cliente entra sem vendedor (importação em
  // massa cujo Vendedor era "Banco de Clientes X" / "-Nenhum vendedor-") —
  // fica visível na tela "Banco de Clientes" pro admin distribuir depois.
  // Null pra qualquer cliente que já nasceu com vendedor (importado ou
  // cadastrado manualmente).
  origemBanco: text('origem_banco'),
  dataUltimaCompra: text('data_ultima_compra'),
  // Contexto livre sobre o cliente/prospect (ex: "revenda já vendeu Odin",
  // "assistente técnico", quem indicou) — vem principalmente de importações
  // de planilhas de prospecção que não são pedidos formais de compra, sem
  // um lugar melhor pra guardar isso hoje.
  observacoes: text('observacoes'),
  ticketMedioHistorico: real('ticket_medio_historico'),
  cadastradoPor: integer('cadastrado_por').references(() => users.id, { onDelete: 'set null' }),
  // Prospect cadastrado pelo próprio vendedor (lead que ele caçou, ex: Google)
  // — fica fora do Kanban/funil normal (nenhum `funil_mensal` é criado) até o
  // vendedor decidir "enviar pra carteira", quando vira cliente de verdade.
  emProspeccao: integer('em_prospeccao', { mode: 'boolean' }).notNull().default(false),
  // Canal por onde o vendedor encontrou o prospect — só preenchido pra
  // clientes que nasceram via aba de Prospecção, pra entender depois qual
  // canal cada vendedor mais usa (Google, indicação etc.).
  canalOrigem: text('canal_origem', {
    enum: ['google', 'indicacao', 'redes_sociais', 'porta_a_porta', 'outro'],
  }),
  // Cliente veio de uma ação de Marketing (ads, campanha etc.) — diferente
  // de `canalOrigem` (que é só pra prospecção feita pelo próprio vendedor).
  // Marcado manualmente no "Completar cadastro", pra dar pra medir depois o
  // retorno de vendas dos clientes de Marketing separado do resto.
  origemMarketing: integer('origem_marketing', { mode: 'boolean' }).notNull().default(false),
  versao: integer('versao').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  deletedAt: text('deleted_at'),
  // Exclusão de cliente exige motivo + comprovante (print/imagem) — fica
  // registrado aqui pra dar pra conferir depois quem excluiu o quê e por quê,
  // mesmo que o cliente seja restaurado (não se apagam ao restaurar).
  motivoExclusao: text('motivo_exclusao'),
  comprovanteExclusaoPath: text('comprovante_exclusao_path'),
}, (t) => ({
  empresaCnpj: unique().on(t.empresaId, t.cnpj),
  empresaCodigo: unique().on(t.empresaId, t.codigo),
}))

// Telefones extras de um cliente, além do principal (`clientes.telefoneWhatsapp`)
// — pedido do João pra vendedores conseguirem cadastrar mais de um número
// (ex: contato financeiro, um segundo celular) sem perder o que já usa o
// campo principal (busca, casamento de ligação do GoTo, importação de
// planilha continuam olhando só pra `telefoneWhatsapp`).
export const clienteTelefones = sqliteTable('cliente_telefones', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id, { onDelete: 'cascade' }),
  numero: text('numero').notNull(),
  rotulo: text('rotulo'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// E-mails extras de um cliente, além do principal (`clientes.email`) — mesmo
// padrão dos telefones extras, pra vendedor cadastrar mais de um contato
// (ex: financeiro, compras) sem perder o campo principal já usado em
// outros lugares do sistema.
export const clienteEmails = sqliteTable('cliente_emails', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  rotulo: text('rotulo'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Histórico de carteira — todo cliente que já teve vendedor responsável,
// preservado mesmo após transferência (a venda fica creditada a quem estava
// na carteira no momento do fechamento — ver funilMensal.vendedorId).
export const carteiraHistorico = sqliteTable('carteira_historico', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id, { onDelete: 'cascade' }),
  vendedorId: integer('vendedor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const funilMensal = sqliteTable('funil_mensal', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id, { onDelete: 'cascade' }),
  vendedorId: integer('vendedor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mesReferencia: text('mes_referencia').notNull(), // YYYY-MM-01
  etapa: text('etapa', {
    // 'faturamento' só existe pra Compretec Loja Física (ver
    // ETAPAS_FATURAMENTO no FunilBoard.tsx) — vem sempre depois de
    // 'fechado', pro card já vendido acompanhar se saiu cupom/nota fiscal.
    // 'consumidor_final' é diferente de 'consumidor_final_loja': a primeira
    // exige escolher pra qual empresa o cliente foi repassado (uso das
    // empresas que NÃO vendem no varejo, tipo Tubos e Odin Compressores); a
    // segunda é só uma etapa simples, exclusiva da Compretec Loja Física
    // (que JÁ é a loja de varejo), sem exigir nada — Daniela só joga o card
    // pra lá depois de visualizar/processar a venda pro consumidor final.
    enum: [
      'novo',
      'abordagem',
      'interessado',
      'negociacao',
      'fechado',
      'faturamento',
      'perdido',
      'sem_contato',
      'consumidor_final',
      'consumidor_final_loja',
    ],
  }).notNull().default('novo'),
  dataEntradaEtapa: text('data_entrada_etapa').notNull().default(sql`(datetime('now'))`),
  qtdTentativasContato: integer('qtd_tentativas_contato').notNull().default(0),
  dataUltimoContato: text('data_ultimo_contato'),
  valorOrcado: real('valor_orcado'),
  motivoPerdaCategoria: text('motivo_perda_categoria', {
    enum: ['estoque', 'financeiro', 'compras'],
  }),
  motivoPerdaOpcao: text('motivo_perda_opcao'),
  motivoPerdaItem: text('motivo_perda_item'),
  motivoPerdaObservacao: text('motivo_perda_observacao'),
  empresaRepasse: text('empresa_repasse', {
    enum: ['tubos_conexoes', 'compressores', 'outra'],
  }),
  motivoRepasseObservacao: text('motivo_repasse_observacao'),
  // PDF de proposta/orçamento anexado durante a Negociação — separado do
  // `pdfPedidoPath` de cada venda (que só existe quando fecha de verdade),
  // pra ficar visível/consultável mesmo que o vendedor feche o card e volte
  // depois, em vez de servir só pra IA ler os itens na hora e sumir.
  pdfPropostaPath: text('pdf_proposta_path'),
  carregadoMesAnterior: integer('carregado_mes_anterior', { mode: 'boolean' }).notNull().default(false),
  versao: integer('versao').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  deletedAt: text('deleted_at'),
})

// Um pedido/venda individual — um cliente pode ter várias no mesmo mês
// (funilMensal continua sendo só o rastreador de etapa/relacionamento,
// "em que pé está" com aquele cliente; cada compra de verdade vira uma
// linha aqui, ligada ao mesmo card do mês).
export const vendas = sqliteTable('vendas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  funilMensalId: integer('funil_mensal_id').notNull().references(() => funilMensal.id, { onDelete: 'cascade' }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id, { onDelete: 'cascade' }),
  vendedorId: integer('vendedor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mesReferencia: text('mes_referencia').notNull(),
  valorFechado: real('valor_fechado').notNull(),
  condicaoPagamento: text('condicao_pagamento'),
  numeroCupomFiscal: text('numero_cupom_fiscal'),
  numeroNotaFiscal: text('numero_nota_fiscal'),
  // Só a venda rápida (Compretec Loja Física) exige isso — pedido direto do
  // João pra identificar o card na hora (aparece junto do nome do cliente
  // no Kanban, ex: "Consumidor Final - 10210").
  numeroPedido: text('numero_pedido'),
  pdfPedidoPath: text('pdf_pedido_path'),
  dataFechamento: text('data_fechamento').notNull().default(sql`(datetime('now'))`),
  // Etapa "Faturamento" (Compretec Loja Física) — tipo do comprovante fiscal
  // dessa venda e se já foi emitido de verdade. `tipoComprovante` fica null
  // até alguém confirmar; `faturado` sempre começa falso mesmo se o
  // vendedor já escolheu o tipo (só vira true quando confirma que saiu).
  tipoComprovante: text('tipo_comprovante', { enum: ['cupom_fiscal', 'nota_fiscal'] }),
  faturado: integer('faturado', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  deletedAt: text('deleted_at'),
})

export const itensPedido = sqliteTable('itens_pedido', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendaId: integer('venda_id').notNull().references(() => vendas.id, { onDelete: 'cascade' }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id, { onDelete: 'cascade' }),
  descricao: text('descricao').notNull(),
  quantidade: real('quantidade'),
  valorUnitario: real('valor_unitario'),
  valorTotal: real('valor_total'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  deletedAt: text('deleted_at'),
})

// Compressor(es) já vendido(s) pra esse cliente — usado pelo pós-venda da
// Odin Compressores pra saber quando oferecer filtro de ar/óleo de novo.
// Como não tem telemetria remota do horímetro real, o acompanhamento é por
// estimativa: horas de uso por dia informadas na hora do cadastro, projetando
// a data da próxima troca a partir da última troca (ou da instalação, se
// nunca trocou). `quantidade` também serve pra calibrar quantidade de peça a
// oferecer (cliente com 5 máquinas iguais provavelmente compra kit de 5).
export const maquinasCliente = sqliteTable('maquinas_cliente', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id, { onDelete: 'cascade' }),
  modelo: text('modelo').notNull(),
  quantidade: integer('quantidade').notNull().default(1),
  dataInstalacao: text('data_instalacao').notNull(),
  horasUsoDia: real('horas_uso_dia').notNull(),
  // Consumidor final pra quem a revenda repassou essa máquina — texto livre
  // (não vira cliente completo, não tem carteira/funil próprio), só pra
  // entender que a revenda comprou da gente e revendeu pra esse cliente.
  consumidorFinalNome: text('consumidor_final_nome'),
  consumidorFinalTelefone: text('consumidor_final_telefone'),
  observacoes: text('observacoes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  deletedAt: text('deleted_at'),
})

// Itens de manutenção configuráveis por empresa (só Odin Compressores usa
// isso por enquanto) — substitui os campos fixos de filtro de ar/óleo que
// existiam antes. Admin cadastra quantos itens quiser (filtro de ar,
// filtro de óleo, elemento separador, óleo...), cada um com seu intervalo
// em horas.
export const itensManutencao = sqliteTable('itens_manutencao', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  intervaloHoras: integer('intervalo_horas').notNull(),
  ordem: integer('ordem').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  deletedAt: text('deleted_at'),
})

// Status de manutenção de UM item numa máquina específica. `horasNaReferencia`
// + `dataReferencia` são a base pra projetar a próxima troca (mesma lógica de
// projeção por dias × horas/dia que já existia, só que agora por item
// configurável em vez de 2 campos fixos). O primeiro registro pra um par
// máquina+item é a "primeira preventiva": a leitura real de horas da peça
// naquele momento (não necessariamente 0 — a máquina pode já estar em uso há
// tempo quando é cadastrada no sistema). "Marcar troca" depois só zera
// horasNaReferencia e atualiza dataReferencia pra hoje.
export const maquinaManutencaoStatus = sqliteTable(
  'maquina_manutencao_status',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    maquinaId: integer('maquina_id').notNull().references(() => maquinasCliente.id, { onDelete: 'cascade' }),
    itemId: integer('item_id').notNull().references(() => itensManutencao.id, { onDelete: 'cascade' }),
    horasNaReferencia: real('horas_na_referencia').notNull().default(0),
    dataReferencia: text('data_referencia').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    maquinaItemUnico: unique().on(t.maquinaId, t.itemId),
  })
)

// Catálogo de produtos da Odin Compressores — nasceu só com compressor (pra
// alimentar o dropdown de "Modelo" em Nova Máquina), mas cobre o catálogo
// inteiro (secadores de ar, outros itens) por pedido do João. `tipo`
// distingue os três; só os `compressor` aparecem no dropdown de máquina
// vendida (secador/outro item não tem o ciclo de filtro de ar/óleo). Campos
// específicos de compressor (bar, energiaKw etc.) ficam null pros outros
// tipos — a especificação deles vai resumida em `especificacoes`, mesmo
// padrão que a aba "Outros Itens" da planilha já usava. Por empresa pra já
// suportar outra empresa ter seu próprio catálogo no futuro.
export const catalogoCompressores = sqliteTable('catalogo_compressores', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  tipo: text('tipo', { enum: ['compressor', 'secador', 'outro'] }).notNull().default('compressor'),
  categoria: text('categoria'),
  modelo: text('modelo').notNull(),
  linha: text('linha'),
  bar: real('bar'),
  energiaKw: real('energia_kw'),
  motorHp: real('motor_hp'),
  pcm: real('pcm'),
  nivelRuido: text('nivel_ruido'),
  resfriamento: text('resfriamento'),
  eletricidade: text('eletricidade'),
  pesoKg: real('peso_kg'),
  especificacoes: text('especificacoes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  empresaModelo: unique().on(t.empresaId, t.modelo),
}))

export const registroContato = sqliteTable('registro_contato', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  funilMensalId: integer('funil_mensal_id').notNull().references(() => funilMensal.id, { onDelete: 'cascade' }),
  vendedorId: integer('vendedor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tipo: text('tipo', { enum: ['ligacao', 'whatsapp', 'email', 'visita'] }).notNull(),
  // 'confirmado' é o resultado do botão "Confirmar" (card do Kanban) — o
  // vendedor confirma que o contato aconteceu sem precisar dizer se a
  // pessoa respondeu ou não; por isso não conta como `efetiva` sozinho,
  // só tira o registro do estado "aguardando confirmação".
  resultado: text('resultado', { enum: ['respondeu', 'nao_respondeu', 'numero_errado', 'caixa_postal', 'confirmado'] }),
  // De onde veio o registro — pra distinguir contato registrado de verdade
  // pelo vendedor (manual) de captura automática (clique no WhatsApp, ou
  // ligação real via GoTo Connect). Fica junto do registro pra sempre (não
  // é derivado do texto da observação, que pode ser editado depois).
  origem: text('origem', { enum: ['manual', 'whatsapp_automatico', 'ligacao_automatica'] })
    .notNull()
    .default('manual'),
  observacao: text('observacao').notNull(),
  // Só preenchido pra tipo='ligacao' — duração real (GoTo Connect) ou nula
  // quando registrada manualmente sem cronômetro. `efetiva` é a métrica que
  // importa pros relatórios, e só vira true quando o vendedor confirma
  // resultado="respondeu" — a duração sozinha não prova que teve conversa
  // (caixa postal pode durar mais que uma ligação atendida de verdade).
  duracaoSegundos: integer('duracao_segundos'),
  efetiva: integer('efetiva', { mode: 'boolean' }),
  dataHora: text('data_hora').notNull().default(sql`(datetime('now'))`),
  deletedAt: text('deleted_at'),
})

export const metasMensais = sqliteTable('metas_mensais', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendedorId: integer('vendedor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mesReferencia: text('mes_referencia').notNull(),
  metaFaturamento: real('meta_faturamento'),
  metaPctCarteiraAtivada: real('meta_pct_carteira_ativada'),
  metaLigacoesDia: integer('meta_ligacoes_dia').notNull().default(25),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  vendedorMes: unique().on(t.vendedorId, t.mesReferencia),
}))

// Metas do módulo de Leads/marketing — diferente de metasMensais (que é por
// vendedor, faturamento de venda): aqui é por empresa inteira, um alvo só
// pro mês, comparado com os números já calculados em leadsRelatorios.reportGeral.
export const metasMarketing = sqliteTable('metas_marketing', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
  mesReferencia: text('mes_referencia').notNull(),
  metaTaxaConversaoPct: real('meta_taxa_conversao_pct'),
  // "Atendimento rápido" — meta de horas úteis até o 1º contato (quanto
  // menor, melhor), comparado com tempoMedioPrimeiroContatoHoras.
  metaAtendimentoRapidoHoras: real('meta_atendimento_rapido_horas'),
  // "Clientes abertos" — quantidade de leads recebidos no mês (totalLeads).
  metaClientesAbertos: integer('meta_clientes_abertos'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  empresaMes: unique().on(t.empresaId, t.mesReferencia),
}))

export const logAuditoria = sqliteTable('log_auditoria', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tabela: text('tabela').notNull(),
  registroId: integer('registro_id').notNull(),
  acao: text('acao', {
    enum: ['criar', 'editar', 'excluir', 'restaurar', 'mudar_etapa', 'transferir_carteira'],
  }).notNull(),
  campo: text('campo'),
  valorAnterior: text('valor_anterior'),
  valorNovo: text('valor_novo'),
  alteradoPor: integer('alterado_por').references(() => users.id, { onDelete: 'set null' }),
  alteradoEm: text('alterado_em').notNull().default(sql`(datetime('now'))`),
})

// Idempotência da integração GoTo Connect (Call Events Report API) —
// persistida em tabela (não Set/Map em memória) pra sobreviver a redeploy.
// `conversationSpaceId` é o identificador de chamada que a GoTo usa tanto
// na notificação (evento REPORT_SUMMARY) quanto pra buscar o relatório
// completo — vira a chave única. O fluxo faz um "claim" (insert com
// unique, ignora se já existe) antes de processar, pra duas notificações
// da mesma ligação (ex: reconexão do canal) nunca processarem em paralelo.
export const gotoLigacoesProcessadas = sqliteTable('goto_ligacoes_processadas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationSpaceId: text('conversation_space_id').notNull().unique(),
  direcao: text('direcao', { enum: ['INBOUND', 'OUTBOUND'] }),
  numeroExterno: text('numero_externo'),
  duracaoSegundos: integer('duracao_segundos'),
  clienteId: integer('cliente_id').references(() => clientes.id, { onDelete: 'set null' }),
  registroContatoId: integer('registro_contato_id').references(() => registroContato.id, { onDelete: 'set null' }),
  status: text('status', { enum: ['processando', 'concluido', 'erro'] }).notNull().default('processando'),
  // Por que não virou registroContato (ex: "nenhum cliente com telefone
  // batendo", "cliente ambíguo", "sem vendedor") — só pra debug rápido sem
  // precisar cruzar com goto_log_integracao.
  motivoNaoRegistrado: text('motivo_nao_registrado'),
  payloadBruto: text('payload_bruto'),
  criadoEm: text('criado_em').notNull().default(sql`(datetime('now'))`),
  atualizadoEm: text('atualizado_em').notNull().default(sql`(datetime('now'))`),
})

// Log estruturado de TODA chamada HTTP da integração GoTo (troca/renovação
// de token, criar canal, criar assinatura, buscar relatório) — request,
// status code e corpo da resposta, sucesso ou erro — além do payload bruto
// de cada notificação recebida pelo WebSocket, antes de qualquer
// processamento. Access/refresh token nunca vão pro corpo logado (só o
// necessário pra debugar, sem duplicar segredo em mais um lugar).
export const gotoLogIntegracao = sqliteTable('goto_log_integracao', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  operacao: text('operacao').notNull(),
  metodo: text('metodo'),
  url: text('url'),
  statusCode: integer('status_code'),
  requestBody: text('request_body'),
  responseBody: text('response_body'),
  sucesso: integer('sucesso', { mode: 'boolean' }).notNull(),
  erro: text('erro'),
  criadoEm: text('criado_em').notNull().default(sql`(datetime('now'))`),
})

// Idempotência do polling da PABXONE360 (Odin Tubos e Conexões, teste
// isolado — não tem relação nenhuma com a integração GoTo Connect acima,
// são empresas/telefonias diferentes). Como não tem webhook, cada rodada
// de sincronização busca as ligações recentes de novo — essa tabela evita
// registrar a mesma chamada duas vezes entre uma rodada e outra.
export const pabxLigacoesProcessadas = sqliteTable('pabx_ligacoes_processadas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chamadaId: text('chamada_id').notNull().unique(),
  direcao: text('direcao', { enum: ['INBOUND', 'OUTBOUND'] }),
  numeroExterno: text('numero_externo'),
  duracaoSegundos: integer('duracao_segundos'),
  sipCode: text('sip_code'),
  clienteId: integer('cliente_id').references(() => clientes.id, { onDelete: 'set null' }),
  registroContatoId: integer('registro_contato_id').references(() => registroContato.id, { onDelete: 'set null' }),
  // Por que não virou registroContato (ex: "nenhum cliente com telefone
  // batendo", "cliente ambíguo", "sem vendedor", "sem ramal identificado").
  motivoNaoRegistrado: text('motivo_nao_registrado'),
  criadoEm: text('criado_em').notNull().default(sql`(datetime('now'))`),
})

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendedorId: integer('vendedor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clienteId: integer('cliente_id').references(() => clientes.id, { onDelete: 'cascade' }),
  // Motor de SLA de Leads (server/src/lib/leadsSlaScheduler.ts) — nunca
  // preenchido junto com clienteId (são dois tipos de notificação
  // diferentes: Carteira vs. Leads/marketing).
  leadId: integer('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Vínculo entre dois cadastros de cliente que são, na prática, a mesma
// empresa/pessoa (ex: matriz e filial, ou o mesmo cliente com CNPJs
// diferentes) — só informativo, não mistura carteira/funil/histórico dos
// dois. Uma linha por par (sem direção — pra saber os vínculos de um
// cliente, busca por cliente_id OU cliente_vinculado_id igual ao id dele).
export const clienteVinculos = sqliteTable('cliente_vinculos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id, { onDelete: 'cascade' }),
  clienteVinculadoId: integer('cliente_vinculado_id').notNull().references(() => clientes.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Pedido do vendedor pra descartar (excluir) ou transferir um cliente da
// própria carteira — fica pendente até o admin aprovar ou recusar na aba de
// Aprovações. Se aprovado, a ação (exclusão ou transferência) é aplicada de
// verdade; se recusado, nada muda e o cliente continua com o vendedor atual.
export const solicitacoesCarteira = sqliteTable('solicitacoes_carteira', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id, { onDelete: 'cascade' }),
  vendedorSolicitanteId: integer('vendedor_solicitante_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tipo: text('tipo', { enum: ['descartar', 'transferir'] }).notNull(),
  motivo: text('motivo').notNull(),
  // Só obrigatório pra 'descartar' — mesmo padrão de comprovante já exigido
  // na exclusão direta pelo admin.
  comprovantePath: text('comprovante_path'),
  status: text('status', { enum: ['pendente', 'aprovado', 'recusado'] }).notNull().default('pendente'),
  // Preenchido pelo admin na hora de aprovar um pedido de tipo 'transferir'
  // — o vendedor só pede, não escolhe o destino.
  vendedorDestinoId: integer('vendedor_destino_id').references(() => users.id, { onDelete: 'set null' }),
  respostaObservacao: text('resposta_observacao'),
  decididoPor: integer('decidido_por').references(() => users.id, { onDelete: 'set null' }),
  decididoEm: text('decidido_em'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Agenda de compromissos futuros (ligar de novo, visitar, reunião...) —
// alimenta o calendário do vendedor/admin e as notificações do navegador
// quando o horário chega.
export const compromissos = sqliteTable(
  'compromissos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    vendedorId: integer('vendedor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    clienteId: integer('cliente_id').references(() => clientes.id, { onDelete: 'cascade' }),
    tipo: text('tipo', { enum: ['ligacao', 'visita', 'reuniao', 'outro'] }).notNull().default('outro'),
    titulo: text('titulo').notNull(),
    descricao: text('descricao'),
    dataHora: text('data_hora').notNull(),
    concluido: integer('concluido', { mode: 'boolean' }).notNull().default(false),
    notificado: integer('notificado', { mode: 'boolean' }).notNull().default(false),
    // Recorrência: cada ocorrência é uma linha de verdade (gerada na hora de
    // criar, não expandida em tempo de leitura) — mais simples de consultar
    // por intervalo de data, mesmo padrão que o resto do sistema já usa
    // (funil_mensal por exemplo não é "virtual"). `recorrenciaGrupoId` liga
    // todas as ocorrências da mesma série (é o id da primeira ocorrência) —
    // só a primeira tem esse campo igual ao próprio id.
    recorrencia: text('recorrencia', { enum: ['nenhuma', 'diaria', 'semanal', 'quinzenal', 'mensal'] }).notNull().default('nenhuma'),
    recorrenciaGrupoId: integer('recorrencia_grupo_id'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
    deletedAt: text('deleted_at'),
  },
  (t) => ({
    // Toda navegação do calendário (mês/semana/dia) filtra por vendedor +
    // intervalo de data — sem índice composto isso varria a tabela inteira
    // a cada troca de mês/semana.
    vendedorDataIdx: index('idx_compromissos_vendedor_data').on(t.vendedorId, t.dataHora),
    grupoIdx: index('idx_compromissos_grupo').on(t.recorrenciaGrupoId),
  })
)

// Pedido do vendedor pra equipe de marketing criar uma arte (comunicado,
// oferta ou banner) — fica pendente até o admin aprovar ou recusar na aba de
// Aprovações, mesmo fluxo já usado pra pedidos de carteira. Aprovar aqui só
// libera o pedido pra marketing (não gera nenhuma arte sozinho).
export const solicitacoesDesign = sqliteTable('solicitacoes_design', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendedorSolicitanteId: integer('vendedor_solicitante_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tipo: text('tipo', { enum: ['comunicado', 'oferta', 'banner'] }).notNull(),
  descricao: text('descricao').notNull(),
  preco: text('preco'),
  produto: text('produto'),
  quantidade: text('quantidade'),
  dataLimiteEntrega: text('data_limite_entrega'),
  dataLimiteValidade: text('data_limite_validade'),
  observacoes: text('observacoes'),
  status: text('status', { enum: ['pendente', 'aprovado', 'recusado'] }).notNull().default('pendente'),
  respostaObservacao: text('resposta_observacao'),
  decididoPor: integer('decidido_por').references(() => users.id, { onDelete: 'set null' }),
  decididoEm: text('decidido_em'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Inadimplência por CARD do Painel Financeiro — só um valor total +
// quantidade de clientes, atualizado manualmente pelo admin (não tem fonte
// automática de inadimplência no sistema hoje). Chave por `cardKey` (string
// fixa definida em `financeiro.ts`), não por empresaId direto, porque um
// card pode juntar mais de uma empresa (ex: Odin Compressores + Comprefer
// aparecem como um card só) — não faria sentido pedir pro admin lançar dois
// valores separados pra algo que ele vê como uma linha única. Uma linha por
// card (upsert): o histórico de quem mudou fica só no
// atualizadoPor/atualizadoEm, não guarda série temporal.
export const inadimplenciaEmpresas = sqliteTable(
  'inadimplencia_empresas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    cardKey: text('card_key').notNull(),
    valorTotal: real('valor_total').notNull().default(0),
    quantidadeClientes: integer('quantidade_clientes').notNull().default(0),
    atualizadoPor: integer('atualizado_por').references(() => users.id, { onDelete: 'set null' }),
    atualizadoEm: text('atualizado_em'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    cardUnico: unique().on(t.cardKey),
  })
)

// Demandas (board estilo Trello, pedido do João) — fases/colunas do board,
// por empresa (cada empresa do grupo pode ter seu próprio fluxo). Toda
// empresa ganha as 4 fases padrão (A Fazer/Em Andamento/Aguardando/
// Concluído) na primeira vez que alguém abre o board dela — ver
// garantirEstagiosPadrao em demandas.ts, não depende de migração/seed.
// `concluido` marca a fase final do board: mover uma demanda pra lá
// preenche `demandas.concluidoEm` sozinho.
export const demandaEstagios = sqliteTable('demanda_estagios', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  ordem: integer('ordem').notNull().default(0),
  concluido: integer('concluido', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Demanda em si — só o admin cria (pedido do João), endereçada a uma
// empresa do grupo e, opcionalmente, a uma pessoa específica dentro dela
// (sem pessoa = demanda da empresa/setor como um todo, todo mundo de lá
// vê no board). Qualquer um (admin ou vendedor) pode mover de fase depois
// de criada — só o conteúdo (título/descrição/prazo/etc) é admin-only.
// `mostrarPainelFinanceiro` é um recorte manual do admin (ex: cobrança
// pendente, nota a emitir) pra aparecer também no Painel Financeiro — não
// infere nada sozinho a partir do texto.
export const demandas = sqliteTable('demandas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  estagioId: integer('estagio_id').notNull().references(() => demandaEstagios.id),
  titulo: text('titulo').notNull(),
  descricao: text('descricao'),
  criadoPorId: integer('criado_por_id').notNull().references(() => users.id),
  atribuidoParaId: integer('atribuido_para_id').references(() => users.id, { onDelete: 'set null' }),
  dataLimite: text('data_limite'),
  lembreteEm: text('lembrete_em'),
  mostrarPainelFinanceiro: integer('mostrar_painel_financeiro', { mode: 'boolean' }).notNull().default(false),
  // Posição do card dentro da coluna (drag and drop) — maior primeiro na
  // hora de reordenar, igual não existe ainda em nenhuma outra tela, mas
  // segue o mesmo espírito de `sidebarGroupItems.ordem`.
  ordem: integer('ordem').notNull().default(0),
  concluidoEm: text('concluido_em'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const demandaAnexos = sqliteTable('demanda_anexos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  demandaId: integer('demanda_id').notNull().references(() => demandas.id, { onDelete: 'cascade' }),
  nomeArquivo: text('nome_arquivo').notNull(),
  path: text('path').notNull(),
  tamanho: integer('tamanho'),
  enviadoPorId: integer('enviado_por_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const demandaComentarios = sqliteTable('demanda_comentarios', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  demandaId: integer('demanda_id').notNull().references(() => demandas.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id),
  texto: text('texto').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const demandaEstagiosRelations = relations(demandaEstagios, ({ one, many }) => ({
  empresa: one(empresas, { fields: [demandaEstagios.empresaId], references: [empresas.id] }),
  demandas: many(demandas),
}))

export const demandasRelations = relations(demandas, ({ one, many }) => ({
  empresa: one(empresas, { fields: [demandas.empresaId], references: [empresas.id] }),
  estagio: one(demandaEstagios, { fields: [demandas.estagioId], references: [demandaEstagios.id] }),
  criadoPor: one(users, { fields: [demandas.criadoPorId], references: [users.id] }),
  atribuidoPara: one(users, { fields: [demandas.atribuidoParaId], references: [users.id] }),
  anexos: many(demandaAnexos),
  comentarios: many(demandaComentarios),
}))

export const demandaAnexosRelations = relations(demandaAnexos, ({ one }) => ({
  demanda: one(demandas, { fields: [demandaAnexos.demandaId], references: [demandas.id] }),
  enviadoPor: one(users, { fields: [demandaAnexos.enviadoPorId], references: [users.id] }),
}))

export const demandaComentariosRelations = relations(demandaComentarios, ({ one }) => ({
  demanda: one(demandas, { fields: [demandaComentarios.demandaId], references: [demandas.id] }),
  user: one(users, { fields: [demandaComentarios.userId], references: [users.id] }),
}))

// Boletos em aberto (planilha do Financeiro) — sempre de um cliente já
// cadastrado, sem empresaId próprio (isolamento vem do join em
// clientes.empresaId, mesmo padrão do resto do schema). `valorAtual` some
// do `valorOriginal` quando o admin renegocia (registra em boletoAlteracoes,
// não sobrescreve sem rastro); `status` só muda por ação explícita —
// "vencido" é calculado na hora (vencimento passado + não pago), nunca
// gravado, pra não depender de um job rodando toda noite.
export const boletos = sqliteTable('boletos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id),
  numeroBoleto: text('numero_boleto'),
  valorOriginal: real('valor_original').notNull(),
  valorAtual: real('valor_atual').notNull(),
  vencimento: text('vencimento').notNull(),
  status: text('status', { enum: ['em_aberto', 'renegociado', 'pago'] }).notNull().default('em_aberto'),
  observacoes: text('observacoes'),
  criadoPorId: integer('criado_por_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// Histórico de alteração de cada boleto (valor, vencimento, status) — pedido
// explícito do João ("alteração de boletos/renegociação/alteração de
// valor"), guarda de/para pra saber o que mudou, quando e quem mudou.
export const boletoAlteracoes = sqliteTable('boleto_alteracoes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  boletoId: integer('boleto_id').notNull().references(() => boletos.id, { onDelete: 'cascade' }),
  tipo: text('tipo', { enum: ['criacao', 'valor', 'vencimento', 'status'] }).notNull(),
  valorAnterior: text('valor_anterior'),
  valorNovo: text('valor_novo'),
  observacao: text('observacao'),
  alteradoPorId: integer('alterado_por_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Fila de pedidos de alteração de boleto (mudar vencimento/valor) — o
// cliente liga/manda mensagem pedindo, fica registrado aqui e o Financeiro
// acompanha até executar (diferente de `boletoAlteracoes`, que é o histórico
// do que já foi de fato alterado num boleto específico).
export const boletoPedidosAlteracao = sqliteTable('boleto_pedidos_alteracao', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id),
  descricao: text('descricao').notNull(),
  status: text('status', { enum: ['lancado', 'em_execucao', 'concluido'] }).notNull().default('lancado'),
  criadoPorId: integer('criado_por_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// Negociações/cobrança (Financeiro) — 3 planilhas separadas, pedido do
// João: log do dia a dia (sem fase, é só histórico de contato), Cartório
// (pra lembrar de cobrar de novo quando o cliente "voltar") e RC (clientes
// mandados pra assessoria de cobrança terceirizada, até fechar acordo ou
// não). Todas cliente-scoped sem empresaId próprio, mesmo padrão de boletos.
export const cobrancasRegistro = sqliteTable('cobrancas_registro', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id),
  canal: text('canal', { enum: ['whatsapp', 'ligacao', 'email'] }).notNull(),
  retornoCliente: text('retorno_cliente').notNull(),
  // Valor/vencimento da cobrança em si — antes só existia o log de contato,
  // sem nenhum dado de quanto/quando, então não dava pra gerar relatório
  // nenhum por data nem saber se o cliente pagou. `status` fecha o ciclo:
  // pendente → pago, ou pendente → cartorio/rc (que também cria a linha
  // correspondente em clientesCartorio/clientesRc — ver `cobrancaMarcarStatus`).
  valor: real('valor'),
  dataVencimento: text('data_vencimento'),
  status: text('status', { enum: ['pendente', 'pago', 'cartorio', 'rc'] }).notNull().default('pendente'),
  registradoPorId: integer('registrado_por_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const clientesCartorio = sqliteTable('clientes_cartorio', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id),
  valor: real('valor'),
  enviadoEm: text('enviado_em').notNull(),
  status: text('status', { enum: ['aguardando', 'voltou_cobrar', 'cobranca_feita'] }).notNull().default('aguardando'),
  observacoes: text('observacoes'),
  criadoPorId: integer('criado_por_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const clientesRc = sqliteTable('clientes_rc', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id),
  valor: real('valor'),
  enviadoEm: text('enviado_em').notNull(),
  status: text('status', { enum: ['em_negociacao', 'acordo_fechado', 'nao_fechou'] }).notNull().default('em_negociacao'),
  observacoes: text('observacoes'),
  criadoPorId: integer('criado_por_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const boletosRelations = relations(boletos, ({ one, many }) => ({
  cliente: one(clientes, { fields: [boletos.clienteId], references: [clientes.id] }),
  criadoPor: one(users, { fields: [boletos.criadoPorId], references: [users.id] }),
  alteracoes: many(boletoAlteracoes),
}))

export const boletoAlteracoesRelations = relations(boletoAlteracoes, ({ one }) => ({
  boleto: one(boletos, { fields: [boletoAlteracoes.boletoId], references: [boletos.id] }),
  alteradoPor: one(users, { fields: [boletoAlteracoes.alteradoPorId], references: [users.id] }),
}))

export const boletoPedidosAlteracaoRelations = relations(boletoPedidosAlteracao, ({ one }) => ({
  cliente: one(clientes, { fields: [boletoPedidosAlteracao.clienteId], references: [clientes.id] }),
  criadoPor: one(users, { fields: [boletoPedidosAlteracao.criadoPorId], references: [users.id] }),
}))

export const cobrancasRegistroRelations = relations(cobrancasRegistro, ({ one }) => ({
  cliente: one(clientes, { fields: [cobrancasRegistro.clienteId], references: [clientes.id] }),
  registradoPor: one(users, { fields: [cobrancasRegistro.registradoPorId], references: [users.id] }),
}))

export const clientesCartorioRelations = relations(clientesCartorio, ({ one }) => ({
  cliente: one(clientes, { fields: [clientesCartorio.clienteId], references: [clientes.id] }),
  criadoPor: one(users, { fields: [clientesCartorio.criadoPorId], references: [users.id] }),
}))

export const clientesRcRelations = relations(clientesRc, ({ one }) => ({
  cliente: one(clientes, { fields: [clientesRc.clienteId], references: [clientes.id] }),
  criadoPor: one(users, { fields: [clientesRc.criadoPorId], references: [users.id] }),
}))

// Caixa da empresa (entradas/saídas de dinheiro, registro manual do
// admin) — pedido do João pra Compretec Loja Física acompanhar movimento
// de caixa mês a mês, mas escopado por empresaId igual o resto do app
// (não é exclusivo dela). `data` é a data do movimento em si (o admin pode
// lançar retroativo), não necessariamente hoje — por isso fica separada
// de `createdAt`.
export const caixaMovimentacoes = sqliteTable('caixa_movimentacoes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  tipo: text('tipo', { enum: ['entrada', 'saida'] }).notNull(),
  valor: real('valor').notNull(),
  data: text('data').notNull(),
  descricao: text('descricao'),
  // Preenchido só quando a entrada nasceu sozinha de uma venda de balcão
  // (Compretec Loja Física, `vendas.registrarVendaRapida`) — nunca setado em
  // lançamento manual. Serve pra saber a origem e não deixar cair pro null
  // "sem querer" se a venda for excluída de verdade um dia.
  origemVendaId: integer('origem_venda_id').references(() => vendas.id, { onDelete: 'set null' }),
  criadoPor: integer('criado_por').references(() => users.id, { onDelete: 'set null' }),
  deletedAt: text('deleted_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Setor Compras — controle de invoices de importação (container) das 3
// empresas que importam (Odin Tubos, Odin Compressores, Joitec). Sem
// `empresaId`/escopo de tenant de propósito: é um setor único do Grupo
// Odin, compartilhado — qualquer admin, de qualquer empresa ativa, vê e
// edita a mesma lista (a coluna `empresa` já diz de qual das 3 é cada
// invoice). Alimenta a segunda página do Painel Financeiro (TV).
export const comprasInvoices = sqliteTable('compras_invoices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresa: text('empresa', { enum: ['odin-tubos', 'odin-compressores', 'joitec'] }).notNull(),
  numeroInvoice: text('numero_invoice').notNull(),
  fornecedor: text('fornecedor'),
  status: text('status', { enum: ['em_producao', 'embarcado', 'a_caminho', 'chegou'] }).notNull().default('em_producao'),
  dataEmbarque: text('data_embarque'),
  dataChegada: text('data_chegada'),
  // Regra de negócio: o dólar só é exibido no painel depois que a invoice
  // está paga — por isso fica um campo separado do "pago", nunca inferido
  // (evita mostrar R$ 0,00 pra invoice ainda não paga).
  invoicePaga: integer('invoice_paga', { mode: 'boolean' }).notNull().default(false),
  valorDolar: real('valor_dolar'),
  valorInvoiceReais: real('valor_invoice_reais'),
  numeroContainer: text('numero_container'),
  navio: text('navio'),
  portoOrigem: text('porto_origem'),
  portoDestino: text('porto_destino'),
  observacoes: text('observacoes'),
  criadoPor: integer('criado_por').references(() => users.id, { onDelete: 'set null' }),
  deletedAt: text('deleted_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// Compras nacionais — aba separada de `comprasInvoices` (que é só pra
// importação/container). Toda solicitação nasce em "aguardando_aprovacao"
// e precisa passar pelo diretor de compras (aprovar/recusar) antes de
// virar uma compra em andamento de verdade.
export const comprasNacionais = sqliteTable('compras_nacionais', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fornecedor: text('fornecedor').notNull(),
  produtos: text('produtos').notNull(),
  valorTotal: real('valor_total').notNull(),
  status: text('status', {
    enum: ['aguardando_aprovacao', 'a_caminho', 'chegou', 'entrada_nota', 'recusado'],
  })
    .notNull()
    .default('aguardando_aprovacao'),
  dataPrevistaChegada: text('data_prevista_chegada'),
  observacoes: text('observacoes'),
  solicitadoPor: integer('solicitado_por').references(() => users.id, { onDelete: 'set null' }),
  aprovadoPor: integer('aprovado_por').references(() => users.id, { onDelete: 'set null' }),
  aprovadoEm: text('aprovado_em'),
  motivoRecusa: text('motivo_recusa'),
  deletedAt: text('deleted_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// Módulo de RH — vagas publicadas pros sites do grupo (Trabalhe Conosco) e os
// candidatos que se aplicam. Portado do sistema separado CRM-GRUPO-ODIN
// (crm-odin.duckdns.org) pra dentro do CRM principal.
export const jobPostings = sqliteTable('job_postings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  benefits: text('benefits'),
  requirements: text('requirements'),
  city: text('city'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const candidates = sqliteTable(
  'candidates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
    jobPostingId: integer('job_posting_id').notNull().references(() => jobPostings.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    message: text('message'),
    resumeFilename: text('resume_filename'),
    resumeOriginalName: text('resume_original_name'),
    status: text('status', {
      enum: ['novo', 'em_analise', 'entrevista', 'aprovado', 'reprovado'],
    })
      .notNull()
      .default('novo'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    jobIdx: index('idx_candidates_job').on(t.jobPostingId),
  })
)

// Mensagens automáticas de WhatsApp usadas pelo RH ao abordar candidatos —
// nome diferente de messageTemplates (que é do time de vendas) de propósito.
export const candidateMessageTemplates = sqliteTable('candidate_message_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  whatsappText: text('whatsapp_text').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const jobPostingsRelations = relations(jobPostings, ({ one, many }) => ({
  empresa: one(empresas, { fields: [jobPostings.empresaId], references: [empresas.id] }),
  candidates: many(candidates),
}))

export const candidatesRelations = relations(candidates, ({ one }) => ({
  empresa: one(empresas, { fields: [candidates.empresaId], references: [empresas.id] }),
  jobPosting: one(jobPostings, { fields: [candidates.jobPostingId], references: [jobPostings.id] }),
}))

export const candidateMessageTemplatesRelations = relations(candidateMessageTemplates, ({ one }) => ({
  empresa: one(empresas, { fields: [candidateMessageTemplates.empresaId], references: [empresas.id] }),
}))

// Módulo de Leads — leads de venda captados nos sites do grupo (formulário,
// download de ebook, etc.), com distribuição automática por rodízio
// (região/DDD → vendedor). Portado do sistema separado CRM-GRUPO-ODIN
// (crm-odin.duckdns.org/admin/leads) pra dentro do CRM principal — fase 1
// (núcleo: lista/Kanban/ficha/etapas/notas/anexos/fila de desqualificado +
// rodízio na criação; SLA/alertas automáticos/relatórios ficam pra depois,
// ver server/src/lib/scheduler.ts do sistema antigo pro que falta portar).
// Nomes de campo em inglês de propósito, espelhando o sistema de origem —
// mesma escolha já feita no módulo de RH acima.
export const leadRegions = sqliteTable('lead_regions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const leadDdds = sqliteTable(
  'lead_ddds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
    ddd: integer('ddd').notNull(),
    regionId: integer('region_id').notNull().references(() => leadRegions.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    empresaDdd: unique().on(t.empresaId, t.ddd),
  })
)

// Quais vendedores atendem cada região — a lista que o rodízio percorre.
export const leadRegionVendedores = sqliteTable('lead_region_vendedores', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  regionId: integer('region_id').notNull().references(() => leadRegions.id, { onDelete: 'cascade' }),
  vendorId: integer('vendor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Cursor do rodízio — 1 linha por região, `nextIndex` é um contador que só
// cresce (o índice real na lista de vendedores ativos é `nextIndex %
// quantidade`), ver server/src/lib/leadsRoundRobin.ts.
export const leadRoundRobinState = sqliteTable('lead_round_robin_state', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  regionId: integer('region_id').notNull().unique().references(() => leadRegions.id, { onDelete: 'cascade' }),
  nextIndex: integer('next_index').notNull().default(0),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const leadCampaigns = sqliteTable('lead_campaigns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  channel: text('channel', {
    enum: ['facebook', 'instagram', 'google', 'whatsapp', 'site', 'indicacao', 'outro'],
  }).notNull().default('outro'),
  description: text('description'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const leads = sqliteTable(
  'leads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    ddd: integer('ddd').notNull(),
    email: text('email'),
    company: text('company'),
    city: text('city'),
    segment: text('segment', {
      enum: ['assistente_tecnico', 'instalador', 'revendedor_lojista', 'outros'],
    }).default('outros'),
    status: text('status', {
      enum: ['novo', 'abordagem', 'qualificado', 'em_negociacao', 'ganho', 'perdido', 'desqualificado', 'consumidor_final'],
    }).notNull().default('novo'),
    vendorId: integer('vendor_id').references(() => users.id, { onDelete: 'set null' }),
    regionId: integer('region_id').references(() => leadRegions.id, { onDelete: 'set null' }),
    campaignId: integer('campaign_id').references(() => leadCampaigns.id, { onDelete: 'set null' }),
    source: text('source'),
    observations: text('observations'),
    nextContactAt: text('next_contact_at'),
    followUpCount: integer('follow_up_count').notNull().default(0),
    requiresAttachment: integer('requires_attachment', { mode: 'boolean' }).notNull().default(false),
    statusChangedAt: text('status_changed_at'),
    // Campos de SLA/automação — só escritos hoje pelas ações manuais do
    // núcleo (changeStatus/addContactAttempt zeram/atualizam). O motor que os
    // preenche sozinho (scheduler.ts do sistema antigo) ainda não foi
    // portado — ver plano da migração — mantidos aqui pra já bater 1:1 com
    // os dados históricos migrados e não exigir 2ª migração de schema depois.
    idleAlertSentAt: text('idle_alert_sent_at'),
    autoReassignedAt: text('auto_reassigned_at'),
    lastContactAt: text('last_contact_at'),
    attemptCount: integer('attempt_count'),
    slaStatus: text('sla_status', { enum: ['em_risco', 'critico'] }),
    abordagem4hAlertSentAt: text('abordagem_4h_alert_sent_at'),
    lastContactStaleAlertSentAt: text('last_contact_stale_alert_sent_at'),
    codSap: text('cod_sap'),
    orderValue: real('order_value'),
    finalOrderValue: real('final_order_value'),
    paymentMethod: text('payment_method', { enum: ['avista', 'boleto', 'boleto_entrada', 'cartao_credito'] }),
    lossReason: text('loss_reason'),
    disqualifyReason: text('disqualify_reason'),
    finalConsumerReason: text('final_consumer_reason'),
    negotiationTag: text('negotiation_tag', { enum: ['vermelho', 'amarelo'] }),
    // Preenchido quando um lead "Ganho" é transferido pra frente — Carteira
    // (Joitec/Odin Tubos, cadastro completo de cliente) ou Propostas (Odin
    // Compressores, que não usa Carteira e segue o funil normal de
    // propostas). Só um dos dois é preenchido, nunca os dois; nenhum é
    // preenchido pra quem nunca transferiu. Ver leads.transferirParaCarteira/
    // transferirParaPropostas.
    convertidoParaClienteId: integer('convertido_para_cliente_id').references(() => clientes.id, { onDelete: 'set null' }),
    convertidoParaPropostaId: integer('convertido_para_proposta_id').references(() => propostas.id, { onDelete: 'set null' }),
    // Id numérico do lead no sistema antigo — só pra rastreabilidade e pra
    // permitir rodar o script de migração de novo sem duplicar (ver
    // server/scripts/migrar-leads-crm-marketing.ts). Nulo pra lead criado
    // direto aqui.
    origemLeadId: integer('origem_lead_id'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
    assignedAt: text('assigned_at'),
    deletedAt: text('deleted_at'),
    deletedBy: integer('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    origemIdx: unique().on(t.empresaId, t.origemLeadId),
  })
)

export const leadNotes = sqliteTable('lead_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leadId: integer('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['nota', 'followup', 'lembrete'] }).notNull().default('nota'),
  content: text('content').notNull(),
  nextContactAt: text('next_contact_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Metadados do anexo — o arquivo em si fica em server/uploads/, igual ao
// resto do CRM (`filename` é o nome em disco, `originalName` o nome que o
// usuário enviou).
export const leadAttachments = sqliteTable('lead_attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leadId: integer('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Trilha de auditoria do lead (mudança de etapa, transferência,
// reatribuição automática, exclusão...). `action` é texto livre — valores
// usados pelo router: criado, status_alterado, reaberto_desqualificado,
// desqualificacao_aprovada, tentativa_contato, transferido, excluido,
// reatribuicao_automatica.
export const leadHistory = sqliteTable('lead_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
  leadId: integer('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  fromVendorId: integer('from_vendor_id').references(() => users.id, { onDelete: 'set null' }),
  toVendorId: integer('to_vendor_id').references(() => users.id, { onDelete: 'set null' }),
  details: text('details'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const leadContactAttempts = sqliteTable('lead_contact_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leadId: integer('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channel: text('channel', { enum: ['ligacao', 'whatsapp', 'email'] }).notNull(),
  result: text('result', {
    enum: ['sem_resposta', 'nao_atendeu', 'reagendou', 'recusou', 'avancou'],
  }).notNull(),
  nextActionAt: text('next_action_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Visitante do site (identificado por um uid gerado no navegador,
// localStorage) — alimenta a timeline "veio do site" na ficha do lead. A
// captação ao vivo (tracker.js nos sites) continua apontando pro sistema
// antigo por enquanto (ver plano da migração) — estas tabelas guardam só o
// histórico já migrado.
export const leadTrackingVisitors = sqliteTable(
  'lead_tracking_visitors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
    visitorUid: text('visitor_uid').notNull(),
    firstSeenAt: text('first_seen_at').notNull().default(sql`(datetime('now'))`),
    lastSeenAt: text('last_seen_at').notNull().default(sql`(datetime('now'))`),
    leadId: integer('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
  },
  (t) => ({
    empresaVisitorUid: unique().on(t.empresaId, t.visitorUid),
    leadIdx: index('idx_lead_tracking_visitors_lead').on(t.leadId),
  })
)

export const leadTrackingEvents = sqliteTable(
  'lead_tracking_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    visitorId: integer('visitor_id').notNull().references(() => leadTrackingVisitors.id, { onDelete: 'cascade' }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
    eventType: text('event_type', {
      enum: ['page_view', 'click', 'form_submit', 'ebook_download', 'blog_signup'],
    }).notNull(),
    pageUrl: text('page_url'),
    pageTitle: text('page_title'),
    metadata: text('metadata'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    visitorIdx: index('idx_lead_tracking_events_visitor').on(t.visitorId),
    empresaTypeIdx: index('idx_lead_tracking_events_empresa_type').on(t.empresaId, t.eventType),
  })
)

export const leadRegionsRelations = relations(leadRegions, ({ one, many }) => ({
  empresa: one(empresas, { fields: [leadRegions.empresaId], references: [empresas.id] }),
  ddds: many(leadDdds),
  vendedores: many(leadRegionVendedores),
}))

export const leadDddsRelations = relations(leadDdds, ({ one }) => ({
  empresa: one(empresas, { fields: [leadDdds.empresaId], references: [empresas.id] }),
  region: one(leadRegions, { fields: [leadDdds.regionId], references: [leadRegions.id] }),
}))

export const leadRegionVendedoresRelations = relations(leadRegionVendedores, ({ one }) => ({
  region: one(leadRegions, { fields: [leadRegionVendedores.regionId], references: [leadRegions.id] }),
  vendor: one(users, { fields: [leadRegionVendedores.vendorId], references: [users.id] }),
}))

export const leadRoundRobinStateRelations = relations(leadRoundRobinState, ({ one }) => ({
  region: one(leadRegions, { fields: [leadRoundRobinState.regionId], references: [leadRegions.id] }),
}))

export const leadCampaignsRelations = relations(leadCampaigns, ({ one }) => ({
  empresa: one(empresas, { fields: [leadCampaigns.empresaId], references: [empresas.id] }),
}))

export const leadsRelations = relations(leads, ({ one, many }) => ({
  empresa: one(empresas, { fields: [leads.empresaId], references: [empresas.id] }),
  vendor: one(users, { fields: [leads.vendorId], references: [users.id] }),
  region: one(leadRegions, { fields: [leads.regionId], references: [leadRegions.id] }),
  campaign: one(leadCampaigns, { fields: [leads.campaignId], references: [leadCampaigns.id] }),
  convertidoParaCliente: one(clientes, { fields: [leads.convertidoParaClienteId], references: [clientes.id] }),
  convertidoParaProposta: one(propostas, { fields: [leads.convertidoParaPropostaId], references: [propostas.id] }),
  notes: many(leadNotes),
  attachments: many(leadAttachments),
  history: many(leadHistory),
  contactAttempts: many(leadContactAttempts),
  trackingVisitors: many(leadTrackingVisitors),
}))

export const leadNotesRelations = relations(leadNotes, ({ one }) => ({
  lead: one(leads, { fields: [leadNotes.leadId], references: [leads.id] }),
  user: one(users, { fields: [leadNotes.userId], references: [users.id] }),
}))

export const leadAttachmentsRelations = relations(leadAttachments, ({ one }) => ({
  lead: one(leads, { fields: [leadAttachments.leadId], references: [leads.id] }),
  user: one(users, { fields: [leadAttachments.userId], references: [users.id] }),
}))

export const leadHistoryRelations = relations(leadHistory, ({ one }) => ({
  empresa: one(empresas, { fields: [leadHistory.empresaId], references: [empresas.id] }),
  lead: one(leads, { fields: [leadHistory.leadId], references: [leads.id] }),
  user: one(users, { fields: [leadHistory.userId], references: [users.id] }),
}))

export const leadContactAttemptsRelations = relations(leadContactAttempts, ({ one }) => ({
  lead: one(leads, { fields: [leadContactAttempts.leadId], references: [leads.id] }),
  user: one(users, { fields: [leadContactAttempts.userId], references: [users.id] }),
}))

export const leadTrackingVisitorsRelations = relations(leadTrackingVisitors, ({ one, many }) => ({
  empresa: one(empresas, { fields: [leadTrackingVisitors.empresaId], references: [empresas.id] }),
  lead: one(leads, { fields: [leadTrackingVisitors.leadId], references: [leads.id] }),
  events: many(leadTrackingEvents),
}))

export const leadTrackingEventsRelations = relations(leadTrackingEvents, ({ one }) => ({
  visitor: one(leadTrackingVisitors, { fields: [leadTrackingEvents.visitorId], references: [leadTrackingVisitors.id] }),
  empresa: one(empresas, { fields: [leadTrackingEvents.empresaId], references: [empresas.id] }),
}))

// Permissões por item de menu, por admin — presença de uma linha
// (userId, feature) = acesso liberado. superAdmin nunca precisa de linhas
// aqui (sempre vê tudo, ver `superAdmin` na tabela users). `feature` é uma
// das chaves fixas de ADMIN_LINKS no Sidebar do client.
export const permissoesAdmin = sqliteTable(
  'permissoes_admin',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    usuarioFeature: unique().on(t.userId, t.feature),
  })
)

export const permissoesAdminRelations = relations(permissoesAdmin, ({ one }) => ({
  user: one(users, { fields: [permissoesAdmin.userId], references: [users.id] }),
}))

// Empresas extras liberadas pra um admin comum acessar sem precisar de uma
// conta separada em cada uma — presença de (userId, empresaId) = pode trocar
// pra aquela empresa pelo mesmo seletor que o superAdmin já usa (ver
// resolverEmpresaId em server/src/index.ts e o seletor em Sidebar.tsx).
// superAdmin nunca precisa de linhas aqui (já acessa qualquer empresa).
export const adminEmpresasExtras = sqliteTable(
  'admin_empresas_extras',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    usuarioEmpresa: unique().on(t.userId, t.empresaId),
  })
)

export const adminEmpresasExtrasRelations = relations(adminEmpresasExtras, ({ one }) => ({
  user: one(users, { fields: [adminEmpresasExtras.userId], references: [users.id] }),
  empresa: one(empresas, { fields: [adminEmpresasExtras.empresaId], references: [empresas.id] }),
}))

export const messageTemplates = sqliteTable('message_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  label: text('label').notNull(),
  whatsappText: text('whatsapp_text').notNull(),
  emailSubject: text('email_subject').notNull(),
  emailBody: text('email_body').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// ─────────────────────────────────────────────────────────────────────────
// Devolução (portado do sistema separado "Controle de Devoluções — Grupo
// Odin", controle-devolucao.duckdns.org — Postgres próprio, RBAC próprio).
// Aqui não recria login/empresa próprios: usuário é `users` normal (o papel
// dentro do módulo — gestor padrão, gestor de estoque, admin de empresa,
// poder de excluir chamado, poder de finalizar fora de ordem — vira feature
// em `permissoesAdmin`, mesmo mecanismo do resto do CRM) e empresa é
// `empresas` normal (mapeamento com as 4 empresas do sistema original:
// joitec→1, odin-tubos→2, odin-compressores→4, compretec→7 "Loja Física").
// IDs viram autoincrement (era uuid no Postgres original) — a migração dos
// dados existentes remapeia os uuids antigos pra esses ids novos.
// ─────────────────────────────────────────────────────────────────────────

export const devolucaoChamados = sqliteTable('devolucao_chamados', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  protocolo: text('protocolo').notNull().unique(),
  status: text('status', {
    enum: [
      'novo',
      'analise',
      'em_andamento',
      'nota_fiscal_devolucao',
      'chegada_materiais',
      'preparacao_envio',
      'rastreio_transportadora',
      'finalizado',
    ],
  })
    .notNull()
    .default('novo'),
  // 'preparacao_envio'/'rastreio_transportadora' só existem no fluxo da Odin
  // Compressores (avança sozinho depois da análise, sem arrastar no Kanban).
  origem: text('origem', { enum: ['cliente', 'vendedor'] }).notNull(),
  criadoPorUserId: integer('criado_por_user_id').references(() => users.id, { onDelete: 'set null' }),
  vendedorId: integer('vendedor_id').references(() => users.id, { onDelete: 'set null' }),
  clienteCnpj: text('cliente_cnpj'),
  clienteWhatsapp: text('cliente_whatsapp'),
  clienteEmail: text('cliente_email'),
  clienteCodigo: text('cliente_codigo'),
  clienteNome: text('cliente_nome'),
  numeroNotaFiscal: text('numero_nota_fiscal'),
  numeroNotaFiscalVenda: text('numero_nota_fiscal_venda'),
  numeroPedidoVenda: text('numero_pedido_venda'),
  descricao: text('descricao'),
  observacao: text('observacao'),
  // Nem sempre quem coleta o material devolvido é a mesma transportadora
  // que leva a troca/reparo de volta pro cliente — por isso 2 campos
  // separados (coleta guarda no campo antigo `transportadoraNome`, envio é
  // o novo `transportadoraEnvioNome`), o mesmo espírito do frete em 2
  // momentos logo abaixo.
  transportadoraNome: text('transportadora_nome'),
  dataChegadaPrevista: text('data_chegada_prevista'),
  // Custo do frete pontuado em 2 momentos separados — o de trazer o
  // material devolvido de volta (chegada) costuma ser pago por quem
  // devolveu ou pela transportadora combinada, já o de mandar a troca/
  // reparo de volta pro cliente (envio) é outro frete, outro valor.
  freteChegadaValor: real('frete_chegada_valor'),
  dataSaidaPrevista: text('data_saida_prevista'),
  freteEnvioValor: real('frete_envio_valor'),
  transportadoraEnvioNome: text('transportadora_envio_nome'),
  dataInicioTratamento: text('data_inicio_tratamento'),
  pularNotaFiscalDevolucao: integer('pular_nota_fiscal_devolucao', { mode: 'boolean' }).notNull().default(false),
  origemDemonstracaoId: integer('origem_demonstracao_id').references((): any => devolucaoDemonstracoes.id, { onDelete: 'set null' }),
  fechadoEm: text('fechado_em'),
  // Campos legados (pré ticket_services no sistema original) — não usados
  // por telas novas, mantidos só pra não perder dado de chamados antigos.
  legacyMaquinaNumeroSerie: text('legacy_maquina_numero_serie'),
  legacyMaquinaModelo: text('legacy_maquina_modelo'),
  legacyTecnicoPago: integer('legacy_tecnico_pago', { mode: 'boolean' }),
  legacyTecnicoValorPagamento: real('legacy_tecnico_valor_pagamento'),
  legacyTecnicoDescricaoServico: text('legacy_tecnico_descricao_servico'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const devolucaoOcorrencias = sqliteTable(
  'devolucao_ocorrencias',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chamadoId: integer('chamado_id').notNull().references(() => devolucaoChamados.id, { onDelete: 'cascade' }),
    tipo: text('tipo', { enum: ['envio_errado', 'falta_materiais', 'produto_defeito', 'outro'] }).notNull(),
    rotuloCustom: text('rotulo_custom'),
  },
  (t) => ({
    chamadoTipo: unique().on(t.chamadoId, t.tipo),
  })
)

export const devolucaoMateriais = sqliteTable('devolucao_materiais', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chamadoId: integer('chamado_id').notNull().references(() => devolucaoChamados.id, { onDelete: 'cascade' }),
  // Nem sempre o código do item é conhecido na hora de registrar a
  // devolução (pode ser preenchido só a descrição) — nulo é normal aqui.
  codigoItem: text('codigo_item'),
  descricaoItem: text('descricao_item').notNull(),
  quantidade: real('quantidade').notNull().default(1),
  numeroSerie: text('numero_serie'),
  // Quando a ocorrência é "envio errado", o que veio (`descricaoItem` acima)
  // não é o que deveria ter vindo — esses 2 campos guardam qual seria o
  // material certo, preenchidos na abertura ou depois durante a análise.
  codigoItemCorreto: text('codigo_item_correto'),
  descricaoItemCorreto: text('descricao_item_correto'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// URL/nome de arquivo aleatorizados na hora do upload (mesmo motivo do
// sistema original: não deixar o nome do arquivo vazar dado do cliente nem
// virar link adivinhável) — ver rota de upload no router.
export const devolucaoAnexos = sqliteTable('devolucao_anexos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chamadoId: integer('chamado_id').notNull().references(() => devolucaoChamados.id, { onDelete: 'cascade' }),
  contexto: text('contexto', { enum: ['abertura', 'analise', 'mecanica'] }).notNull().default('abertura'),
  urlArquivo: text('url_arquivo').notNull(),
  nomeArquivo: text('nome_arquivo').notNull(),
  tipoArquivo: text('tipo_arquivo'),
  enviadoPorUserId: integer('enviado_por_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const devolucaoHistoricoStatus = sqliteTable('devolucao_historico_status', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chamadoId: integer('chamado_id').notNull().references(() => devolucaoChamados.id, { onDelete: 'cascade' }),
  statusAnterior: text('status_anterior'),
  statusNovo: text('status_novo').notNull(),
  alteradoPorUserId: integer('alterado_por_user_id').references(() => users.id, { onDelete: 'set null' }),
  nota: text('nota'),
  alteradoEm: text('alterado_em').notNull().default(sql`(datetime('now'))`),
})

// who_erred/impacto na comissão nunca podem ser mandados pro front pra quem
// não tem a feature 'devolucoes_ver_comissao' — sanitizar isso é
// responsabilidade do router (ver comentário lá), não desta tabela.
export const devolucaoAnalises = sqliteTable('devolucao_analises', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chamadoId: integer('chamado_id').notNull().references(() => devolucaoChamados.id, { onDelete: 'cascade' }).unique(),
  resultado: text('resultado', { enum: ['positivo', 'negativo'] }).notNull(),
  motivoNegativa: text('motivo_negativa'),
  creditoRestante: real('credito_restante'),
  quemErrou: text('quem_errou', { enum: ['cliente', 'estoque', 'transportadora', 'vendedor', 'defeito'] }),
  tipoResolucao: text('tipo_resolucao', {
    enum: ['saldo_credito', 'troca_produto', 'abatimento_boleto', 'dinheiro_volta', 'envio_materiais'],
  }),
  impactaComissao: integer('impacta_comissao', { mode: 'boolean' }).notNull().default(false),
  valorImpactoComissao: real('valor_impacto_comissao'),
  anexoNotaDevolucaoId: integer('anexo_nota_devolucao_id').references(() => devolucaoAnexos.id, { onDelete: 'set null' }),
  analisadoPorUserId: integer('analisado_por_user_id').references(() => users.id, { onDelete: 'set null' }),
  analisadoEm: text('analisado_em').notNull().default(sql`(datetime('now'))`),
})

export const devolucaoAnaliseProdutos = sqliteTable('devolucao_analise_produtos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  analiseId: integer('analise_id').notNull().references(() => devolucaoAnalises.id, { onDelete: 'cascade' }),
  codigoProduto: text('codigo_produto'),
  descricaoProduto: text('descricao_produto').notNull(),
  quantidade: real('quantidade').notNull().default(1),
})

// 'recebido'/'manutencao' só existem no fluxo da Odin Compressores.
export const devolucaoMecanicaItens = sqliteTable('devolucao_mecanica_itens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chamadoId: integer('chamado_id').notNull().references(() => devolucaoChamados.id, { onDelete: 'cascade' }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  codigoItem: text('codigo_item'),
  descricaoItem: text('descricao_item').notNull(),
  quantidade: real('quantidade').notNull().default(1),
  status: text('status', {
    enum: ['enviado', 'retornado', 'testado', 'arrumado', 'descarte', 'recebido', 'manutencao'],
  })
    .notNull()
    .default('enviado'),
  enviadoEm: text('enviado_em'),
  retornadoEm: text('retornado_em'),
  testadoEm: text('testado_em'),
  resolvidoEm: text('resolvido_em'),
  atualizadoPorUserId: integer('atualizado_por_user_id').references(() => users.id, { onDelete: 'set null' }),
  observacao: text('observacao'),
  descricaoManutencao: text('descricao_manutencao'),
  condicaoRetorno: text('condicao_retorno', { enum: ['novo', 'usado'] }),
  motivoDescarte: text('motivo_descarte'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const devolucaoMecanicaHistorico = sqliteTable('devolucao_mecanica_historico', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => devolucaoMecanicaItens.id, { onDelete: 'cascade' }),
  statusAnterior: text('status_anterior'),
  statusNovo: text('status_novo').notNull(),
  alteradoPorUserId: integer('alterado_por_user_id').references(() => users.id, { onDelete: 'set null' }),
  alteradoEm: text('alterado_em').notNull().default(sql`(datetime('now'))`),
})

export const devolucaoFeedbacks = sqliteTable('devolucao_feedbacks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chamadoId: integer('chamado_id').notNull().references(() => devolucaoChamados.id, { onDelete: 'cascade' }),
  textoFeedback: text('texto_feedback').notNull(),
  recebidoVia: text('recebido_via').notNull().default('whatsapp'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const devolucaoAtualizacoes = sqliteTable('devolucao_atualizacoes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chamadoId: integer('chamado_id').notNull().references(() => devolucaoChamados.id, { onDelete: 'cascade' }),
  autorUserId: integer('autor_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mensagem: text('mensagem').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const devolucaoServicos = sqliteTable('devolucao_servicos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chamadoId: integer('chamado_id').notNull().references(() => devolucaoChamados.id, { onDelete: 'cascade' }).unique(),
  teveServico: integer('teve_servico', { mode: 'boolean' }).notNull(),
  valorCobrado: real('valor_cobrado'),
  horasTrabalhadas: real('horas_trabalhadas'),
  executadoPor: text('executado_por'),
  statusPagamento: text('status_pagamento', { enum: ['credito', 'pago'] }),
  valorFinal: real('valor_final'),
  registradoPorUserId: integer('registrado_por_user_id').references(() => users.id, { onDelete: 'set null' }),
  registradoEm: text('registrado_em').notNull().default(sql`(datetime('now'))`),
})

export const devolucaoDemonstracoes = sqliteTable('devolucao_demonstracoes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  clienteNome: text('cliente_nome').notNull(),
  anexoNotaUrl: text('anexo_nota_url'),
  vendedorId: integer('vendedor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  enviadoEm: text('enviado_em').notNull().default(sql`(date('now'))`),
  retornoPrevistoEm: text('retorno_previsto_em'),
  observacao: text('observacao'),
  status: text('status', { enum: ['ativa', 'retornada', 'convertida_venda', 'devolucao_aberta'] }).notNull().default('ativa'),
  criadoPorUserId: integer('criado_por_user_id').references(() => users.id, { onDelete: 'set null' }),
  contagemRenovacao: integer('contagem_renovacao').notNull().default(0),
  numeroNotaVenda: text('numero_nota_venda'),
  chamadoVinculadoId: integer('chamado_vinculado_id').references(() => devolucaoChamados.id, { onDelete: 'set null' }),
  clienteCnpj: text('cliente_cnpj'),
  clienteLocalizacao: text('cliente_localizacao'),
  nomeClienteVenda: text('nome_cliente_venda'),
  dataVenda: text('data_venda'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const devolucaoDemonstracaoItens = sqliteTable('devolucao_demonstracao_itens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  demonstracaoId: integer('demonstracao_id').notNull().references(() => devolucaoDemonstracoes.id, { onDelete: 'cascade' }),
  descricaoProduto: text('descricao_produto').notNull(),
  numeroSerie: text('numero_serie'),
  quantidade: real('quantidade').notNull().default(1),
})

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  clientesCarteira: many(clientes),
  carteiraHistorico: many(carteiraHistorico),
  funis: many(funilMensal),
  contatos: many(registroContato),
  notifications: many(notifications),
  metas: many(metasMensais),
  logsAcesso: many(logAcessoUsuario),
  atividadesDiarias: many(atividadeDiariaUsuario),
  funcaoTemplate: one(funcaoTemplates, { fields: [users.funcaoTemplateId], references: [funcaoTemplates.id] }),
}))

export const clientesRelations = relations(clientes, ({ one, many }) => ({
  vendedorAtual: one(users, { fields: [clientes.vendedorAtualId], references: [users.id] }),
  cadastradoPorUser: one(users, { fields: [clientes.cadastradoPor], references: [users.id] }),
  carteiraHistorico: many(carteiraHistorico),
  funis: many(funilMensal),
  itensPedido: many(itensPedido),
  notifications: many(notifications),
  maquinas: many(maquinasCliente),
  telefonesExtras: many(clienteTelefones),
  emailsExtras: many(clienteEmails),
}))

export const clienteTelefonesRelations = relations(clienteTelefones, ({ one }) => ({
  cliente: one(clientes, { fields: [clienteTelefones.clienteId], references: [clientes.id] }),
}))

export const clienteEmailsRelations = relations(clienteEmails, ({ one }) => ({
  cliente: one(clientes, { fields: [clienteEmails.clienteId], references: [clientes.id] }),
}))

export const maquinasClienteRelations = relations(maquinasCliente, ({ one, many }) => ({
  cliente: one(clientes, { fields: [maquinasCliente.clienteId], references: [clientes.id] }),
  statusManutencao: many(maquinaManutencaoStatus),
}))

export const itensManutencaoRelations = relations(itensManutencao, ({ one, many }) => ({
  empresa: one(empresas, { fields: [itensManutencao.empresaId], references: [empresas.id] }),
  status: many(maquinaManutencaoStatus),
}))

export const maquinaManutencaoStatusRelations = relations(maquinaManutencaoStatus, ({ one }) => ({
  maquina: one(maquinasCliente, { fields: [maquinaManutencaoStatus.maquinaId], references: [maquinasCliente.id] }),
  item: one(itensManutencao, { fields: [maquinaManutencaoStatus.itemId], references: [itensManutencao.id] }),
}))

export const carteiraHistoricoRelations = relations(carteiraHistorico, ({ one }) => ({
  cliente: one(clientes, { fields: [carteiraHistorico.clienteId], references: [clientes.id] }),
  vendedor: one(users, { fields: [carteiraHistorico.vendedorId], references: [users.id] }),
}))

export const funilMensalRelations = relations(funilMensal, ({ one, many }) => ({
  cliente: one(clientes, { fields: [funilMensal.clienteId], references: [clientes.id] }),
  vendedor: one(users, { fields: [funilMensal.vendedorId], references: [users.id] }),
  contatos: many(registroContato),
  vendas: many(vendas),
}))

export const solicitacoesCarteiraRelations = relations(solicitacoesCarteira, ({ one }) => ({
  cliente: one(clientes, { fields: [solicitacoesCarteira.clienteId], references: [clientes.id] }),
  vendedorSolicitante: one(users, { fields: [solicitacoesCarteira.vendedorSolicitanteId], references: [users.id] }),
  vendedorDestino: one(users, { fields: [solicitacoesCarteira.vendedorDestinoId], references: [users.id] }),
  decisor: one(users, { fields: [solicitacoesCarteira.decididoPor], references: [users.id] }),
}))

export const inadimplenciaEmpresasRelations = relations(inadimplenciaEmpresas, ({ one }) => ({
  atualizadoPorUser: one(users, { fields: [inadimplenciaEmpresas.atualizadoPor], references: [users.id] }),
}))

export const caixaMovimentacoesRelations = relations(caixaMovimentacoes, ({ one }) => ({
  criadoPorUser: one(users, { fields: [caixaMovimentacoes.criadoPor], references: [users.id] }),
}))

export const comprasInvoicesRelations = relations(comprasInvoices, ({ one }) => ({
  criadoPorUser: one(users, { fields: [comprasInvoices.criadoPor], references: [users.id] }),
}))

export const comprasNacionaisRelations = relations(comprasNacionais, ({ one }) => ({
  solicitadoPorUser: one(users, { fields: [comprasNacionais.solicitadoPor], references: [users.id] }),
  aprovadoPorUser: one(users, { fields: [comprasNacionais.aprovadoPor], references: [users.id] }),
}))

export const solicitacoesDesignRelations = relations(solicitacoesDesign, ({ one }) => ({
  vendedorSolicitante: one(users, { fields: [solicitacoesDesign.vendedorSolicitanteId], references: [users.id] }),
  decisor: one(users, { fields: [solicitacoesDesign.decididoPor], references: [users.id] }),
}))

export const vendasRelations = relations(vendas, ({ one, many }) => ({
  funil: one(funilMensal, { fields: [vendas.funilMensalId], references: [funilMensal.id] }),
  cliente: one(clientes, { fields: [vendas.clienteId], references: [clientes.id] }),
  vendedor: one(users, { fields: [vendas.vendedorId], references: [users.id] }),
  itensPedido: many(itensPedido),
}))

export const itensPedidoRelations = relations(itensPedido, ({ one }) => ({
  venda: one(vendas, { fields: [itensPedido.vendaId], references: [vendas.id] }),
  cliente: one(clientes, { fields: [itensPedido.clienteId], references: [clientes.id] }),
}))

export const registroContatoRelations = relations(registroContato, ({ one }) => ({
  funil: one(funilMensal, { fields: [registroContato.funilMensalId], references: [funilMensal.id] }),
  vendedor: one(users, { fields: [registroContato.vendedorId], references: [users.id] }),
}))

export const metasMensaisRelations = relations(metasMensais, ({ one }) => ({
  vendedor: one(users, { fields: [metasMensais.vendedorId], references: [users.id] }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  vendedor: one(users, { fields: [notifications.vendedorId], references: [users.id] }),
  cliente: one(clientes, { fields: [notifications.clienteId], references: [clientes.id] }),
}))

export const compromissosRelations = relations(compromissos, ({ one }) => ({
  vendedor: one(users, { fields: [compromissos.vendedorId], references: [users.id] }),
  cliente: one(clientes, { fields: [compromissos.clienteId], references: [clientes.id] }),
}))

export const devolucaoChamadosRelations = relations(devolucaoChamados, ({ one, many }) => ({
  empresa: one(empresas, { fields: [devolucaoChamados.empresaId], references: [empresas.id] }),
  criadoPor: one(users, { fields: [devolucaoChamados.criadoPorUserId], references: [users.id] }),
  vendedor: one(users, { fields: [devolucaoChamados.vendedorId], references: [users.id] }),
  origemDemonstracao: one(devolucaoDemonstracoes, {
    fields: [devolucaoChamados.origemDemonstracaoId],
    references: [devolucaoDemonstracoes.id],
  }),
  ocorrencias: many(devolucaoOcorrencias),
  materiais: many(devolucaoMateriais),
  anexos: many(devolucaoAnexos),
  historicoStatus: many(devolucaoHistoricoStatus),
  analise: one(devolucaoAnalises, { fields: [devolucaoChamados.id], references: [devolucaoAnalises.chamadoId] }),
  mecanicaItens: many(devolucaoMecanicaItens),
  feedbacks: many(devolucaoFeedbacks),
  atualizacoes: many(devolucaoAtualizacoes),
  servicos: one(devolucaoServicos, { fields: [devolucaoChamados.id], references: [devolucaoServicos.chamadoId] }),
}))

export const devolucaoOcorrenciasRelations = relations(devolucaoOcorrencias, ({ one }) => ({
  chamado: one(devolucaoChamados, { fields: [devolucaoOcorrencias.chamadoId], references: [devolucaoChamados.id] }),
}))

export const devolucaoMateriaisRelations = relations(devolucaoMateriais, ({ one }) => ({
  chamado: one(devolucaoChamados, { fields: [devolucaoMateriais.chamadoId], references: [devolucaoChamados.id] }),
}))

export const devolucaoAnexosRelations = relations(devolucaoAnexos, ({ one }) => ({
  chamado: one(devolucaoChamados, { fields: [devolucaoAnexos.chamadoId], references: [devolucaoChamados.id] }),
  enviadoPor: one(users, { fields: [devolucaoAnexos.enviadoPorUserId], references: [users.id] }),
}))

export const devolucaoHistoricoStatusRelations = relations(devolucaoHistoricoStatus, ({ one }) => ({
  chamado: one(devolucaoChamados, { fields: [devolucaoHistoricoStatus.chamadoId], references: [devolucaoChamados.id] }),
  alteradoPor: one(users, { fields: [devolucaoHistoricoStatus.alteradoPorUserId], references: [users.id] }),
}))

export const devolucaoAnalisesRelations = relations(devolucaoAnalises, ({ one, many }) => ({
  chamado: one(devolucaoChamados, { fields: [devolucaoAnalises.chamadoId], references: [devolucaoChamados.id] }),
  anexoNotaDevolucao: one(devolucaoAnexos, { fields: [devolucaoAnalises.anexoNotaDevolucaoId], references: [devolucaoAnexos.id] }),
  analisadoPor: one(users, { fields: [devolucaoAnalises.analisadoPorUserId], references: [users.id] }),
  produtos: many(devolucaoAnaliseProdutos),
}))

export const devolucaoAnaliseProdutosRelations = relations(devolucaoAnaliseProdutos, ({ one }) => ({
  analise: one(devolucaoAnalises, { fields: [devolucaoAnaliseProdutos.analiseId], references: [devolucaoAnalises.id] }),
}))

export const devolucaoMecanicaItensRelations = relations(devolucaoMecanicaItens, ({ one, many }) => ({
  chamado: one(devolucaoChamados, { fields: [devolucaoMecanicaItens.chamadoId], references: [devolucaoChamados.id] }),
  empresa: one(empresas, { fields: [devolucaoMecanicaItens.empresaId], references: [empresas.id] }),
  atualizadoPor: one(users, { fields: [devolucaoMecanicaItens.atualizadoPorUserId], references: [users.id] }),
  historico: many(devolucaoMecanicaHistorico),
}))

export const devolucaoMecanicaHistoricoRelations = relations(devolucaoMecanicaHistorico, ({ one }) => ({
  item: one(devolucaoMecanicaItens, { fields: [devolucaoMecanicaHistorico.itemId], references: [devolucaoMecanicaItens.id] }),
  alteradoPor: one(users, { fields: [devolucaoMecanicaHistorico.alteradoPorUserId], references: [users.id] }),
}))

export const devolucaoFeedbacksRelations = relations(devolucaoFeedbacks, ({ one }) => ({
  chamado: one(devolucaoChamados, { fields: [devolucaoFeedbacks.chamadoId], references: [devolucaoChamados.id] }),
}))

export const devolucaoAtualizacoesRelations = relations(devolucaoAtualizacoes, ({ one }) => ({
  chamado: one(devolucaoChamados, { fields: [devolucaoAtualizacoes.chamadoId], references: [devolucaoChamados.id] }),
  autor: one(users, { fields: [devolucaoAtualizacoes.autorUserId], references: [users.id] }),
}))

export const devolucaoServicosRelations = relations(devolucaoServicos, ({ one }) => ({
  chamado: one(devolucaoChamados, { fields: [devolucaoServicos.chamadoId], references: [devolucaoChamados.id] }),
  registradoPor: one(users, { fields: [devolucaoServicos.registradoPorUserId], references: [users.id] }),
}))

export const devolucaoDemonstracoesRelations = relations(devolucaoDemonstracoes, ({ one, many }) => ({
  empresa: one(empresas, { fields: [devolucaoDemonstracoes.empresaId], references: [empresas.id] }),
  vendedor: one(users, { fields: [devolucaoDemonstracoes.vendedorId], references: [users.id] }),
  criadoPor: one(users, { fields: [devolucaoDemonstracoes.criadoPorUserId], references: [users.id] }),
  chamadoVinculado: one(devolucaoChamados, { fields: [devolucaoDemonstracoes.chamadoVinculadoId], references: [devolucaoChamados.id] }),
  itens: many(devolucaoDemonstracaoItens),
}))

export const devolucaoDemonstracaoItensRelations = relations(devolucaoDemonstracaoItens, ({ one }) => ({
  demonstracao: one(devolucaoDemonstracoes, {
    fields: [devolucaoDemonstracaoItens.demonstracaoId],
    references: [devolucaoDemonstracoes.id],
  }),
}))

// ── Ordens (pós-venda Odin Compressores, portado do odincrm.duckdns.org) ──
// Kanban de acompanhamento do pedido depois de vendido: liberação
// financeira, frete, preparação, faturamento, conferência, coleta, rastreio,
// qualidade e pós-venda. Só a Odin Compressores usa isso (checado por slug
// no router, ver SLUG_ORDENS em router/ordens/core.ts) — mundo totalmente
// separado do funil de vendas (`vendas`/`funilMensal`), que é sobre fechar a
// venda, não sobre entregar o que já foi vendido. Duas sequências de etapa
// diferentes conforme `orderType` (ver server/src/lib/ordensStages.ts) —
// `stage` aqui é texto livre validado em código, não enum do banco, porque
// os dois tipos têm conjuntos de valores diferentes.
export const ordens = sqliteTable(
  'ordens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    clienteId: integer('cliente_id').references(() => clientes.id),
    vendedorId: integer('vendedor_id').references(() => users.id, { onDelete: 'set null' }),
    criadoPor: integer('criado_por').references(() => users.id, { onDelete: 'set null' }),
    orderType: text('order_type', { enum: ['maquina', 'peca'] }).notNull(),
    stage: text('stage').notNull().default('cadastro'),
    status: text('status', { enum: ['ativo', 'cancelado', 'concluido'] }).notNull().default('ativo'),
    cancelMotivo: text('cancel_motivo'),
    canceladoPor: integer('cancelado_por').references(() => users.id, { onDelete: 'set null' }),
    canceladoEm: text('cancelado_em'),
    pausadoMotivo: text('pausado_motivo'),
    pausadoPor: integer('pausado_por').references(() => users.id, { onDelete: 'set null' }),
    pausadoEm: text('pausado_em'),
    enderecoEntregaCep: text('endereco_entrega_cep'),
    enderecoEntregaLogradouro: text('endereco_entrega_logradouro'),
    enderecoEntregaCidade: text('endereco_entrega_cidade'),
    enderecoEntregaEstado: text('endereco_entrega_estado'),
    // Gancho pra migração dos pedidos reais do odincrm.duckdns.org (fase
    // futura) — evita duplicar se o script de importação rodar de novo.
    legacyOrdemId: integer('legacy_ordem_id').unique(),
    // Trava otimista, mesma ideia de funilMensal.versao — evita duas pessoas
    // avançando etapa ao mesmo tempo e uma pisando na outra.
    versao: integer('versao').notNull().default(1),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    empresaStageIdx: index('ordens_empresa_stage_idx').on(t.empresaId, t.stage),
    empresaStatusIdx: index('ordens_empresa_status_idx').on(t.empresaId, t.status),
  })
)

export const ordemLiberacaoFinanceira = sqliteTable('ordem_liberacao_financeira', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().unique().references(() => ordens.id, { onDelete: 'cascade' }),
  formaPagamento: text('forma_pagamento'),
  condicaoPagamento: text('condicao_pagamento'),
  dataPagamentoPrevista: text('data_pagamento_prevista'),
  observacoes: text('observacoes'),
  obsTravadaEm: text('obs_travada_em'), // observação travada após "Salvar" — edição só por gestor
  obsTravadaPor: integer('obs_travada_por').references(() => users.id, { onDelete: 'set null' }),
  aprovado: integer('aprovado', { mode: 'boolean' }).notNull().default(false),
  aprovadoPor: integer('aprovado_por').references(() => users.id, { onDelete: 'set null' }),
  aprovadoEm: text('aprovado_em'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const ordemDetalhes = sqliteTable('ordem_detalhes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().unique().references(() => ordens.id, { onDelete: 'cascade' }),
  numeroPedido: text('numero_pedido'),
  observacoes: text('observacoes'),
  prioridadeDespacho: text('prioridade_despacho', { enum: ['normal', 'urgente', 'lead', 'direto'] }),
  comissaoRevenda: text('comissao_revenda'),
  valorPedido: real('valor_pedido'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const ordemCotacoesFrete = sqliteTable('ordem_cotacoes_frete', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().references(() => ordens.id, { onDelete: 'cascade' }),
  numeroSequencial: integer('numero_sequencial').notNull(),
  numeroCotacaoTransportadora: text('numero_cotacao_transportadora'),
  transportadora: text('transportadora'),
  valor: real('valor'),
  peso: real('peso'),
  volume: real('volume'),
  prazo: text('prazo'),
  tipoFrete: text('tipo_frete', { enum: ['CIF', 'FOB'] }),
  observacoes: text('observacoes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const ordemAprovacaoFrete = sqliteTable('ordem_aprovacao_frete', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().unique().references(() => ordens.id, { onDelete: 'cascade' }),
  cotacaoSelecionadaId: integer('cotacao_selecionada_id').references(() => ordemCotacoesFrete.id, { onDelete: 'set null' }),
  retiradaLocal: integer('retirada_local', { mode: 'boolean' }).notNull().default(false),
  retiradaEmpresa: text('retirada_empresa'),
  retiradaData: text('retirada_data'),
  semFrete: integer('sem_frete', { mode: 'boolean' }).notNull().default(false),
  semFreteObservacoes: text('sem_frete_observacoes'),
  cotacaoFinalizada: integer('cotacao_finalizada', { mode: 'boolean' }).notNull().default(false), // operador marcou "cotação finalizada" (selo no card)
  cotacaoFinalizadaEm: text('cotacao_finalizada_em'),
  cotacaoFinalizadaPor: integer('cotacao_finalizada_por').references(() => users.id, { onDelete: 'set null' }),
  aprovadoPor: integer('aprovado_por').references(() => users.id, { onDelete: 'set null' }),
  aprovadoEm: text('aprovado_em'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Não é etapa visível no Kanban de pedido "máquina" (é pré-requisito checado
// antes de avançar de "cotação de frete" pra "frete finalizado", igual no
// odincrm) — pra pedido "peça" já é uma etapa normal do funil.
export const ordemPreparacao = sqliteTable('ordem_preparacao', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().unique().references(() => ordens.id, { onDelete: 'cascade' }),
  dataEntradaEstoque: text('data_entrada_estoque'),
  observacoes: text('observacoes'),
  obsTravadaEm: text('obs_travada_em'),
  obsTravadaPor: integer('obs_travada_por').references(() => users.id, { onDelete: 'set null' }),
  operadorFinalizou: integer('operador_finalizou', { mode: 'boolean' }).notNull().default(false), // marca do operador (selo no card)
  operadorFinalizouEm: text('operador_finalizou_em'),
  operadorFinalizouPor: integer('operador_finalizou_por').references(() => users.id, { onDelete: 'set null' }),
  aprovadoGestor: integer('aprovado_gestor', { mode: 'boolean' }).notNull().default(false),
  aprovadoPor: integer('aprovado_por').references(() => users.id, { onDelete: 'set null' }),
  aprovadoEm: text('aprovado_em'),
  entradaEm: text('entrada_em').notNull().default(sql`(datetime('now'))`),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// Máquina física do pedido — usada pro checklist de conferência por máquina
// e pra exigência de fotos por máquina na aprovação de preparação. Não é a
// mesma coisa que `maquinasCliente` (aquela é pós-venda/manutenção de
// máquina já instalada, ciclo de vida diferente).
export const ordemMaquinas = sqliteTable('ordem_maquinas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().references(() => ordens.id, { onDelete: 'cascade' }),
  modelo: text('modelo').notNull(),
  numeroSerie: text('numero_serie'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const ordemFreteFinalizado = sqliteTable('ordem_frete_finalizado', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().unique().references(() => ordens.id, { onDelete: 'cascade' }),
  confirmado: integer('confirmado', { mode: 'boolean' }).notNull().default(false),
  confirmadoPor: integer('confirmado_por').references(() => users.id, { onDelete: 'set null' }),
  confirmadoEm: text('confirmado_em'),
  observacoes: text('observacoes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const ordemFaturamento = sqliteTable('ordem_faturamento', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().unique().references(() => ordens.id, { onDelete: 'cascade' }),
  pagamentoConfirmado: integer('pagamento_confirmado', { mode: 'boolean' }).notNull().default(false),
  dataPagamento: text('data_pagamento'),
  numeroNotaFiscal: text('numero_nota_fiscal'),
  numeroPicking: text('numero_picking'),
  dataFaturamento: text('data_faturamento'),
  confirmadoPor: integer('confirmado_por').references(() => users.id, { onDelete: 'set null' }),
  confirmadoEm: text('confirmado_em'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// Só existe de verdade pra pedido tipo "máquina" (checklist de embalagem +
// por máquina antes da coleta).
export const ordemConferencia = sqliteTable('ordem_conferencia', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().unique().references(() => ordens.id, { onDelete: 'cascade' }),
  placaOk: integer('placa_ok', { mode: 'boolean' }).notNull().default(false),
  adesivoOk: integer('adesivo_ok', { mode: 'boolean' }).notNull().default(false),
  fichaTecnicaOk: integer('ficha_tecnica_ok', { mode: 'boolean' }).notNull().default(false),
  kitCompressor: integer('kit_compressor', { mode: 'boolean' }).notNull().default(false),
  kitReservatorio: integer('kit_reservatorio', { mode: 'boolean' }).notNull().default(false),
  kitSecador: integer('kit_secador', { mode: 'boolean' }).notNull().default(false),
  // Tri-state de propósito (null = ainda não respondido).
  inspecaoVisualAvaria: integer('inspecao_visual_avaria', { mode: 'boolean' }),
  embalagemOk: integer('embalagem_ok', { mode: 'boolean' }).notNull().default(false),
  embalagemPor: text('embalagem_por'), // quem embalou: RAFAEL | MARCUS | EDUARDO
  embalagemConfirmadoPor: integer('embalagem_confirmado_por').references(() => users.id, { onDelete: 'set null' }),
  embalagemConfirmadoEm: text('embalagem_confirmado_em'),
  observacoes: text('observacoes'),
  observacoesGerais: text('observacoes_gerais'),
  obsTravadaEm: text('obs_travada_em'),
  obsTravadaPor: integer('obs_travada_por').references(() => users.id, { onDelete: 'set null' }),
  confirmado: integer('confirmado', { mode: 'boolean' }).notNull().default(false),
  confirmadoPor: integer('confirmado_por').references(() => users.id, { onDelete: 'set null' }),
  confirmadoEm: text('confirmado_em'),
  entradaEm: text('entrada_em').notNull().default(sql`(datetime('now'))`),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const ordemConferenciaItens = sqliteTable(
  'ordem_conferencia_itens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ordemId: integer('ordem_id').notNull().references(() => ordens.id, { onDelete: 'cascade' }),
    maquinaId: integer('maquina_id').notNull().references(() => ordemMaquinas.id, { onDelete: 'cascade' }),
    placaOk: integer('placa_ok', { mode: 'boolean' }).notNull().default(false),
    adesivoOk: integer('adesivo_ok', { mode: 'boolean' }).notNull().default(false),
    fichaTecnicaOk: integer('ficha_tecnica_ok', { mode: 'boolean' }).notNull().default(false),
    voltagemOk: integer('voltagem_ok', { mode: 'boolean' }).notNull().default(false),
    kitOk: integer('kit_ok', { mode: 'boolean' }).notNull().default(false),
    inspecaoVisualAvaria: integer('inspecao_visual_avaria', { mode: 'boolean' }),
    naoAplicavel: integer('nao_aplicavel', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => ({
    ordemMaquina: unique().on(t.ordemId, t.maquinaId),
  })
)

export const ordemColeta = sqliteTable('ordem_coleta', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().unique().references(() => ordens.id, { onDelete: 'cascade' }),
  dataColeta: text('data_coleta'),
  horaColetaInicio: text('hora_coleta_inicio'),
  horaColetaFim: text('hora_coleta_fim'),
  transportadora: text('transportadora'),
  observacoes: text('observacoes'),
  confirmado: integer('confirmado', { mode: 'boolean' }).notNull().default(false),
  confirmadoPor: integer('confirmado_por').references(() => users.id, { onDelete: 'set null' }),
  confirmadoEm: text('confirmado_em'),
  entradaEm: text('entrada_em').notNull().default(sql`(datetime('now'))`),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const ordemRastreio = sqliteTable('ordem_rastreio', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().unique().references(() => ordens.id, { onDelete: 'cascade' }),
  transportadora: text('transportadora'),
  codigoRastreio: text('codigo_rastreio'),
  linkRastreio: text('link_rastreio'),
  observacoes: text('observacoes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const ordemQualidade = sqliteTable('ordem_qualidade', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().unique().references(() => ordens.id, { onDelete: 'cascade' }),
  observacoes: text('observacoes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const ordemPosVenda = sqliteTable('ordem_pos_venda', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().unique().references(() => ordens.id, { onDelete: 'cascade' }),
  feedbackCliente: text('feedback_cliente'),
  npsScore: integer('nps_score'),
  dataLembrete: text('data_lembrete'),
  notaLembrete: text('nota_lembrete'),
  vendaPeca: integer('venda_peca', { mode: 'boolean' }).notNull().default(false),
  primeiraPreventiva: text('primeira_preventiva'),
  nomeRevenda: text('nome_revenda'),
  dataRecebimentoMercadoria: text('data_recebimento_mercadoria'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// Log genérico append-only (não é diff estruturado, exceto pra
// action='stage_change', onde fieldName/oldValue/newValue vêm preenchidos) —
// mesmo espírito de devolucaoHistoricoStatus, com os campos extras que o
// odincrm original tinha.
export const ordemHistorico = sqliteTable('ordem_historico', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().references(() => ordens.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  fieldName: text('field_name'),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  description: text('description').notNull(),
  stage: text('stage'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Nome randomizado em disco (uuid + extensão), nome original só no banco —
// mesmo motivo de devolucaoAnexos: evita link adivinhável/vazamento pelo
// nome do arquivo em /uploads (servido sem login). `fileCategory` livre tem
// a convenção `{categoria}__{maquinaId}` pra foto obrigatória por máquina
// (ver server/src/lib/ordensGates.ts).
export const ordemAnexos = sqliteTable('ordem_anexos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordemId: integer('ordem_id').notNull().references(() => ordens.id, { onDelete: 'cascade' }),
  stage: text('stage').notNull(),
  fileCategory: text('file_category'),
  nomeOriginal: text('nome_original').notNull(),
  nomeArmazenado: text('nome_armazenado').notNull(),
  tipoArquivo: text('tipo_arquivo'),
  tamanhoBytes: integer('tamanho_bytes'),
  enviadoPor: integer('enviado_por').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const ordensRelations = relations(ordens, ({ one, many }) => ({
  empresa: one(empresas, { fields: [ordens.empresaId], references: [empresas.id] }),
  cliente: one(clientes, { fields: [ordens.clienteId], references: [clientes.id] }),
  vendedor: one(users, { fields: [ordens.vendedorId], references: [users.id] }),
  liberacaoFinanceira: one(ordemLiberacaoFinanceira, { fields: [ordens.id], references: [ordemLiberacaoFinanceira.ordemId] }),
  detalhes: one(ordemDetalhes, { fields: [ordens.id], references: [ordemDetalhes.ordemId] }),
  cotacoesFrete: many(ordemCotacoesFrete),
  aprovacaoFrete: one(ordemAprovacaoFrete, { fields: [ordens.id], references: [ordemAprovacaoFrete.ordemId] }),
  preparacao: one(ordemPreparacao, { fields: [ordens.id], references: [ordemPreparacao.ordemId] }),
  maquinas: many(ordemMaquinas),
  freteFinalizado: one(ordemFreteFinalizado, { fields: [ordens.id], references: [ordemFreteFinalizado.ordemId] }),
  faturamento: one(ordemFaturamento, { fields: [ordens.id], references: [ordemFaturamento.ordemId] }),
  conferencia: one(ordemConferencia, { fields: [ordens.id], references: [ordemConferencia.ordemId] }),
  coleta: one(ordemColeta, { fields: [ordens.id], references: [ordemColeta.ordemId] }),
  rastreio: one(ordemRastreio, { fields: [ordens.id], references: [ordemRastreio.ordemId] }),
  qualidade: one(ordemQualidade, { fields: [ordens.id], references: [ordemQualidade.ordemId] }),
  posVenda: one(ordemPosVenda, { fields: [ordens.id], references: [ordemPosVenda.ordemId] }),
  historico: many(ordemHistorico),
  anexos: many(ordemAnexos),
}))

export const ordemAprovacaoFreteRelations = relations(ordemAprovacaoFrete, ({ one }) => ({
  ordem: one(ordens, { fields: [ordemAprovacaoFrete.ordemId], references: [ordens.id] }),
  cotacaoSelecionada: one(ordemCotacoesFrete, { fields: [ordemAprovacaoFrete.cotacaoSelecionadaId], references: [ordemCotacoesFrete.id] }),
}))

export const ordemMaquinasRelations = relations(ordemMaquinas, ({ one, many }) => ({
  ordem: one(ordens, { fields: [ordemMaquinas.ordemId], references: [ordens.id] }),
  conferenciaItens: many(ordemConferenciaItens),
}))

export const ordemConferenciaItensRelations = relations(ordemConferenciaItens, ({ one }) => ({
  ordem: one(ordens, { fields: [ordemConferenciaItens.ordemId], references: [ordens.id] }),
  maquina: one(ordemMaquinas, { fields: [ordemConferenciaItens.maquinaId], references: [ordemMaquinas.id] }),
}))

export const ordemCotacoesFreteRelations = relations(ordemCotacoesFrete, ({ one }) => ({
  ordem: one(ordens, { fields: [ordemCotacoesFrete.ordemId], references: [ordens.id] }),
}))

export const ordemHistoricoRelations = relations(ordemHistorico, ({ one }) => ({
  ordem: one(ordens, { fields: [ordemHistorico.ordemId], references: [ordens.id] }),
  user: one(users, { fields: [ordemHistorico.userId], references: [users.id] }),
}))

export const ordemAnexosRelations = relations(ordemAnexos, ({ one }) => ({
  ordem: one(ordens, { fields: [ordemAnexos.ordemId], references: [ordens.id] }),
  enviadoPorUser: one(users, { fields: [ordemAnexos.enviadoPor], references: [users.id] }),
}))

// ── Propostas (funil de vendas Odin Compressores, portado do odincrm.duckdns.org) ──
// Funil de propostas comerciais anterior ao pedido — diferente de
// `funilMensal`/`vendas` (o funil próprio do Joitec CRM): aqui o cliente
// ainda é texto livre (`clienteNome`), só vira um `clientes` de verdade
// quando a proposta é convertida em pedido (ver `convertidoParaOrdemId`).
// Etapas não são uma sequência linear estrita como em `ordens` — proposta →
// negociacao → fechado é o caminho normal, mas perdido/chamar_depois são
// alcançados por ação explícita a qualquer momento (ver server/src/router/propostas.ts).
export const propostas = sqliteTable(
  'propostas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    vendedorId: integer('vendedor_id').notNull().references(() => users.id),
    clienteNome: text('cliente_nome').notNull(),
    clienteWhatsapp: text('cliente_whatsapp'),
    produtosDescricao: text('produtos_descricao'),
    produtosItens: text('produtos_itens'), // JSON: [{modelo, qtd, voltagem}] — fonte da verdade do seletor
    semProposta: integer('sem_proposta', { mode: 'boolean' }).notNull().default(false), // fechamento direto, criado já em "fechado"
    comissao: text('comissao'),
    revenda: text('revenda'),
    formaPagamento: text('forma_pagamento'),
    observacoes: text('observacoes'),
    prioridade: text('prioridade', { enum: ['normal', 'urgente'] }).notNull().default('normal'),
    motivoUrgencia: text('motivo_urgencia'),
    motivoPerda: text('motivo_perda'),
    dataRetorno: text('data_retorno'),
    ultimaAlteracaoSolicitadaEm: text('ultima_alteracao_solicitada_em'),
    stage: text('stage', { enum: ['proposta', 'negociacao', 'fechado', 'convertido', 'perdido', 'chamar_depois'] })
      .notNull()
      .default('proposta'),
    convertidoParaOrdemId: integer('convertido_para_ordem_id').references(() => ordens.id, { onDelete: 'set null' }),
    // Gancho pra migração das 229 propostas reais do odincrm — evita duplicar se o script de importação rodar de novo.
    legacyPropostaId: integer('legacy_proposta_id').unique(),
    versao: integer('versao').notNull().default(1),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    empresaStageIdx: index('propostas_empresa_stage_idx').on(t.empresaId, t.stage),
    vendedorIdx: index('propostas_vendedor_idx').on(t.vendedorId),
  })
)

export const propostaArquivos = sqliteTable('proposta_arquivos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  propostaId: integer('proposta_id').notNull().references(() => propostas.id, { onDelete: 'cascade' }),
  // 'proposta_pdf' (exigido pra avançar de "Proposta" pra "Negociação") | 'dados_cadastrais' | outros.
  fileCategory: text('file_category'),
  nomeOriginal: text('nome_original').notNull(),
  nomeArmazenado: text('nome_armazenado').notNull(),
  tipoArquivo: text('tipo_arquivo'),
  tamanhoBytes: integer('tamanho_bytes'),
  enviadoPor: integer('enviado_por').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const propostaFeedbacks = sqliteTable('proposta_feedbacks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  propostaId: integer('proposta_id').notNull().references(() => propostas.id, { onDelete: 'cascade' }),
  vendedorId: integer('vendedor_id').references(() => users.id, { onDelete: 'set null' }),
  conteudo: text('conteudo').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// "Solicitar Alteração" — cada chamada cria uma entrada nova (histórico
// completo, não sobrescreve) e devolve a proposta pra etapa "proposta"
// pra revisão, destravando produtosDescricao pro vendedor de novo.
export const propostaAlteracoes = sqliteTable('proposta_alteracoes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  propostaId: integer('proposta_id').notNull().references(() => propostas.id, { onDelete: 'cascade' }),
  solicitadoPor: integer('solicitado_por').references(() => users.id, { onDelete: 'set null' }),
  conteudo: text('conteudo').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Histórico de mudança de etapa — não existe no odincrm original (lá só tem
// `updated_at`), acrescentado aqui seguindo o mesmo padrão de auditoria já
// usado em `ordemHistorico`/`devolucaoHistoricoStatus` no resto do sistema.
export const propostaHistorico = sqliteTable('proposta_historico', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  propostaId: integer('proposta_id').notNull().references(() => propostas.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  etapaAnterior: text('etapa_anterior'),
  etapaNova: text('etapa_nova').notNull(),
  nota: text('nota'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const propostasRelations = relations(propostas, ({ one, many }) => ({
  empresa: one(empresas, { fields: [propostas.empresaId], references: [empresas.id] }),
  vendedor: one(users, { fields: [propostas.vendedorId], references: [users.id] }),
  convertidoParaOrdem: one(ordens, { fields: [propostas.convertidoParaOrdemId], references: [ordens.id] }),
  arquivos: many(propostaArquivos),
  feedbacks: many(propostaFeedbacks),
  alteracoes: many(propostaAlteracoes),
  historico: many(propostaHistorico),
}))

export const propostaArquivosRelations = relations(propostaArquivos, ({ one }) => ({
  proposta: one(propostas, { fields: [propostaArquivos.propostaId], references: [propostas.id] }),
  enviadoPorUser: one(users, { fields: [propostaArquivos.enviadoPor], references: [users.id] }),
}))

export const propostaFeedbacksRelations = relations(propostaFeedbacks, ({ one }) => ({
  proposta: one(propostas, { fields: [propostaFeedbacks.propostaId], references: [propostas.id] }),
  vendedor: one(users, { fields: [propostaFeedbacks.vendedorId], references: [users.id] }),
}))

export const propostaAlteracoesRelations = relations(propostaAlteracoes, ({ one }) => ({
  proposta: one(propostas, { fields: [propostaAlteracoes.propostaId], references: [propostas.id] }),
  solicitante: one(users, { fields: [propostaAlteracoes.solicitadoPor], references: [users.id] }),
}))

export const propostaHistoricoRelations = relations(propostaHistorico, ({ one }) => ({
  proposta: one(propostas, { fields: [propostaHistorico.propostaId], references: [propostas.id] }),
  user: one(users, { fields: [propostaHistorico.userId], references: [users.id] }),
}))

// ── Revendas (rede de revendedores Odin Compressores, portado do odincrm) ──
// Lista simples de referência (nome, contato, cidade/estado) — não é um
// Kanban, é usada como lookup em propostas/pedidos/máquinas (campo
// `revenda` em texto livre nesses módulos, sem FK — mesmo comportamento do
// odincrm original, que também guarda o nome da revenda como texto solto
// nas propostas/pedidos em vez de referenciar esta tabela por id).
export const revendas = sqliteTable(
  'revendas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    nome: text('nome').notNull(),
    nomeContato: text('nome_contato'),
    telefoneContato: text('telefone_contato'),
    cidade: text('cidade'),
    estado: text('estado'),
    observacoes: text('observacoes'),
    responsavel: text('responsavel'),
    criadoPor: integer('criado_por').references(() => users.id, { onDelete: 'set null' }),
    legacyRevendaId: integer('legacy_revenda_id').unique(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    empresaNomeUnique: unique().on(t.empresaId, t.nome),
  })
)

export const revendasRelations = relations(revendas, ({ one }) => ({
  empresa: one(empresas, { fields: [revendas.empresaId], references: [empresas.id] }),
  criadoPorUser: one(users, { fields: [revendas.criadoPor], references: [users.id] }),
}))

// ── Almoxarifado (estoque de máquinas Odin Compressores, portado do odincrm) ──
// Prefixo `estoque*` pra não colidir com `maquinasCliente` (máquinas já
// instaladas no cliente, pós-venda/manutenção — conceito totalmente
// diferente) nem com o router `maquinas.ts` já existente no Joitec CRM.
export const estoquePortaPallets = sqliteTable(
  'estoque_porta_pallets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    codigo: text('codigo').notNull(),
    andaresCount: integer('andares_count').notNull().default(1),
    observacoes: text('observacoes'),
    legacyRackId: integer('legacy_rack_id').unique(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({ empresaCodigoUnique: unique().on(t.empresaId, t.codigo) })
)

// Capacidade em unidades: uma máquina "pequena" consome 1, uma "grande"
// consome a vaga inteira (2) — mesma regra do odincrm.
export const estoqueVagas = sqliteTable(
  'estoque_vagas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    portaPalletId: integer('porta_pallet_id').notNull().references(() => estoquePortaPallets.id, { onDelete: 'cascade' }),
    andar: integer('andar').notNull(),
    posicao: integer('posicao').notNull(),
    capacidade: integer('capacidade').notNull().default(2),
    legacySlotId: integer('legacy_slot_id').unique(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({ rackAndarPosicaoUnique: unique().on(t.portaPalletId, t.andar, t.posicao) })
)

export const estoqueMaquinas = sqliteTable(
  'estoque_maquinas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    numeroSerie: text('numero_serie').notNull(),
    modelo: text('modelo'),
    voltagem: text('voltagem'),
    pressaoBar: text('pressao_bar'),
    porte: text('porte', { enum: ['pequeno', 'grande'] }).notNull().default('pequeno'),
    status: text('status', { enum: ['estoque', 'reservada', 'alocada', 'vendida'] }).notNull().default('estoque'),
    vagaId: integer('vaga_id').references(() => estoqueVagas.id, { onDelete: 'set null' }),
    ordemId: integer('ordem_id').references(() => ordens.id, { onDelete: 'set null' }),
    dataEntrada: text('data_entrada'),
    observacoes: text('observacoes'),
    criadoPor: integer('criado_por').references(() => users.id, { onDelete: 'set null' }),
    legacyMaquinaId: integer('legacy_maquina_id').unique(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({ empresaSerieUnique: unique().on(t.empresaId, t.numeroSerie) })
)

// Catálogo de referência de modelos — sugere/preenche o campo "modelo" ao
// cadastrar uma máquina em estoque.
export const estoqueCatalogoModelos = sqliteTable(
  'estoque_catalogo_modelos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    categoria: text('categoria').notNull(),
    linha: text('linha'),
    modelo: text('modelo').notNull(),
    especificacoes: text('especificacoes'),
    legacyCatalogoId: integer('legacy_catalogo_id').unique(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({ empresaModeloUnique: unique().on(t.empresaId, t.modelo) })
)

export const estoquePortaPalletsRelations = relations(estoquePortaPallets, ({ one, many }) => ({
  empresa: one(empresas, { fields: [estoquePortaPallets.empresaId], references: [empresas.id] }),
  vagas: many(estoqueVagas),
}))

export const estoqueVagasRelations = relations(estoqueVagas, ({ one, many }) => ({
  portaPallet: one(estoquePortaPallets, { fields: [estoqueVagas.portaPalletId], references: [estoquePortaPallets.id] }),
  maquinas: many(estoqueMaquinas),
}))

export const estoqueMaquinasRelations = relations(estoqueMaquinas, ({ one }) => ({
  empresa: one(empresas, { fields: [estoqueMaquinas.empresaId], references: [empresas.id] }),
  vaga: one(estoqueVagas, { fields: [estoqueMaquinas.vagaId], references: [estoqueVagas.id] }),
  ordem: one(ordens, { fields: [estoqueMaquinas.ordemId], references: [ordens.id] }),
  criadoPorUser: one(users, { fields: [estoqueMaquinas.criadoPor], references: [users.id] }),
}))

export const estoqueCatalogoModelosRelations = relations(estoqueCatalogoModelos, ({ one }) => ({
  empresa: one(empresas, { fields: [estoqueCatalogoModelos.empresaId], references: [empresas.id] }),
}))

// ── Visitas de campo (Odin Compressores, portado do odincrm "FieldTrack") ──
// `visitasClientes` é opcional/informativo (só 3 cadastrados no odincrm
// real) — a maioria das visitas usa os campos de texto livre
// (nomeEmpresa/pessoaContato/telefoneContato) direto na visita, sem vínculo
// a um cliente formal. Prefixo `visitas*` pra não colidir com `clientes`
// (a base de clientes "de verdade" do funil de vendas, conceito diferente).
export const visitasClientes = sqliteTable('visitas_clientes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  nome: text('nome').notNull(),
  cnpj: text('cnpj'),
  nomeContato: text('nome_contato'),
  telefoneContato: text('telefone_contato'),
  endereco: text('endereco'),
  cidade: text('cidade'),
  estado: text('estado'),
  lat: real('lat'),
  lng: real('lng'),
  segmento: text('segmento'),
  observacoes: text('observacoes'),
  vendedorId: integer('vendedor_id').references(() => users.id, { onDelete: 'set null' }),
  criadoPor: integer('criado_por').references(() => users.id, { onDelete: 'set null' }),
  legacyClienteId: integer('legacy_cliente_id').unique(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const visitas = sqliteTable(
  'visitas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    vendedorId: integer('vendedor_id').notNull().references(() => users.id),
    clienteId: integer('cliente_id').references(() => visitasClientes.id, { onDelete: 'set null' }),
    clienteNome: text('cliente_nome'),
    dataVisita: text('data_visita').notNull(),
    checkinEm: text('checkin_em'),
    checkoutEm: text('checkout_em'),
    latCheckin: real('lat_checkin'),
    lngCheckin: real('lng_checkin'),
    nomeEmpresa: text('nome_empresa'),
    pessoaContato: text('pessoa_contato'),
    telefoneContato: text('telefone_contato'),
    endereco: text('endereco'),
    // Texto livre com sugestões no front (Prospecção de clientes | Visita
    // marketing | Manutenção | Pós venda) — igual ao odincrm original.
    objetivo: text('objetivo'),
    // '' (null aqui)=Em andamento | gerar_proposta | follow_up |
    // sem_interesse | nao_encontrado — mesmos valores do odincrm.
    resultado: text('resultado'),
    proximoPasso: text('proximo_passo'),
    dataRetorno: text('data_retorno'),
    observacoes: text('observacoes'),
    planejada: integer('planejada', { mode: 'boolean' }).notNull().default(false),
    propostaItens: text('proposta_itens'),
    propostaPagamento: text('proposta_pagamento'),
    propostaComissao: text('proposta_comissao'),
    propostaRevenda: text('proposta_revenda'),
    convertidoParaPropostaId: integer('convertido_para_proposta_id').references(() => propostas.id, { onDelete: 'set null' }),
    legacyVisitaId: integer('legacy_visita_id').unique(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    empresaVendedorIdx: index('visitas_empresa_vendedor_idx').on(t.empresaId, t.vendedorId),
  })
)

export const visitasClientesRelations = relations(visitasClientes, ({ one, many }) => ({
  empresa: one(empresas, { fields: [visitasClientes.empresaId], references: [empresas.id] }),
  vendedor: one(users, { fields: [visitasClientes.vendedorId], references: [users.id] }),
  visitas: many(visitas),
}))

export const visitasRelations = relations(visitas, ({ one }) => ({
  empresa: one(empresas, { fields: [visitas.empresaId], references: [empresas.id] }),
  vendedor: one(users, { fields: [visitas.vendedorId], references: [users.id] }),
  cliente: one(visitasClientes, { fields: [visitas.clienteId], references: [visitasClientes.id] }),
  propostaConvertida: one(propostas, { fields: [visitas.convertidoParaPropostaId], references: [propostas.id] }),
}))

// ── Configurações (Odin Compressores, portado do odincrm "settings") ──
// Três listas de referência simples — mesmo padrão de `revendas`.
export const condicoesPagamento = sqliteTable(
  'condicoes_pagamento',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    nome: text('nome').notNull(),
    criadoPor: integer('criado_por').references(() => users.id, { onDelete: 'set null' }),
    legacyCondicaoId: integer('legacy_condicao_id').unique(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({ empresaNomeUnique: unique().on(t.empresaId, t.nome) })
)

export const transportadorasOdin = sqliteTable(
  'transportadoras_odin',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    nome: text('nome').notNull(),
    telefoneContato: text('telefone_contato'),
    observacoes: text('observacoes'),
    criadoPor: integer('criado_por').references(() => users.id, { onDelete: 'set null' }),
    legacyTransportadoraId: integer('legacy_transportadora_id').unique(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({ empresaNomeUnique: unique().on(t.empresaId, t.nome) })
)

export const modelosEmailOdin = sqliteTable('modelos_email_odin', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  nome: text('nome').notNull(),
  assunto: text('assunto').notNull(),
  mensagem: text('mensagem').notNull(),
  etapa: text('etapa'),
  criadoPor: integer('criado_por').references(() => users.id, { onDelete: 'set null' }),
  legacyModeloId: integer('legacy_modelo_id').unique(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})
