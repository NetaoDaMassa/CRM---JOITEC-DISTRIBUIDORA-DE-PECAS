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
  // Continua vendedor normal (login, carteira, Kanban) — só some do
  // ranking/gráficos do Painel de TV, pra casos tipo alguém de licença ou
  // que o gestor não quer expor no telão por qualquer motivo específico.
  ocultoPainelTv: integer('oculto_painel_tv', { mode: 'boolean' }).notNull().default(false),
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
    enum: ['novo', 'abordagem', 'interessado', 'negociacao', 'fechado', 'faturamento', 'perdido', 'sem_contato', 'consumidor_final'],
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
  logsAcesso: many(logAcessoUsuario),
  atividadesDiarias: many(atividadeDiariaUsuario),
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
