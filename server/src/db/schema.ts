import { sqliteTable, text, integer, real, unique } from 'drizzle-orm/sqlite-core'
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

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  name: text('name').notNull(),
  // Continua único globalmente (não composto com empresaId) — o login não
  // tem seletor de empresa, resolve o usuário só pelo username.
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'vendor'] }).notNull().default('vendor'),
  // Só verdadeiro pra conta(s) que podem trocar de empresa ativa sem logar de
  // novo (o dono/gestor geral) — ver createContext.
  superAdmin: integer('super_admin', { mode: 'boolean' }).notNull().default(false),
  regiao: text('regiao', {
    enum: ['norte', 'nordeste', 'centro_oeste', 'sudeste', 'sul'],
  }),
  fotoUrl: text('foto_url'),
  temaPreferido: text('tema_preferido', { enum: ['claro', 'escuro'] }).notNull().default('claro'),
  senhaTrocarNoLogin: integer('senha_trocar_no_login', { mode: 'boolean' }).notNull().default(false),
  tentativasLoginFalhas: integer('tentativas_login_falhas').notNull().default(0),
  bloqueadoAte: text('bloqueado_ate'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

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
  codigo: text('codigo').notNull(),
  codigoAntigo: text('codigo_antigo'),
  inscricaoEstadual: text('inscricao_estadual'),
  regiao: text('regiao', {
    enum: ['norte', 'nordeste', 'centro_oeste', 'sudeste', 'sul'],
  }).notNull(),
  estado: text('estado'),
  cidade: text('cidade'),
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
    enum: ['novo', 'abordagem', 'interessado', 'negociacao', 'fechado', 'perdido', 'sem_contato', 'consumidor_final'],
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
  pdfPedidoPath: text('pdf_pedido_path'),
  dataFechamento: text('data_fechamento').notNull().default(sql`(datetime('now'))`),
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
  intervaloFiltroArHoras: integer('intervalo_filtro_ar_horas').notNull().default(1000),
  intervaloFiltroOleoHoras: integer('intervalo_filtro_oleo_horas').notNull().default(2000),
  dataUltimaTrocaFiltroAr: text('data_ultima_troca_filtro_ar'),
  dataUltimaTrocaFiltroOleo: text('data_ultima_troca_filtro_oleo'),
  observacoes: text('observacoes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  deletedAt: text('deleted_at'),
})

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
  resultado: text('resultado', { enum: ['respondeu', 'nao_respondeu', 'numero_errado', 'caixa_postal'] }),
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

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendedorId: integer('vendedor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clienteId: integer('cliente_id').references(() => clientes.id, { onDelete: 'cascade' }),
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
export const compromissos = sqliteTable('compromissos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendedorId: integer('vendedor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clienteId: integer('cliente_id').references(() => clientes.id, { onDelete: 'cascade' }),
  tipo: text('tipo', { enum: ['ligacao', 'visita', 'reuniao', 'outro'] }).notNull().default('outro'),
  titulo: text('titulo').notNull(),
  descricao: text('descricao'),
  dataHora: text('data_hora').notNull(),
  concluido: integer('concluido', { mode: 'boolean' }).notNull().default(false),
  notificado: integer('notificado', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  deletedAt: text('deleted_at'),
})

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

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  clientesCarteira: many(clientes),
  carteiraHistorico: many(carteiraHistorico),
  funis: many(funilMensal),
  contatos: many(registroContato),
  notifications: many(notifications),
  metas: many(metasMensais),
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

export const maquinasClienteRelations = relations(maquinasCliente, ({ one }) => ({
  cliente: one(clientes, { fields: [maquinasCliente.clienteId], references: [clientes.id] }),
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
