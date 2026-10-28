CREATE TABLE `suframa_clientes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer,
	`codigo` text NOT NULL,
	`nome` text,
	`telefone` text,
	`nao_precisa_pin` integer DEFAULT false NOT NULL,
	`observacao` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `suframa_notas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`suframa_cliente_id` integer NOT NULL,
	`chave` text NOT NULL,
	`numero_nota` text NOT NULL,
	`mes_emissao` text NOT NULL,
	`cnpj_emitente` text NOT NULL,
	`pin` text,
	`status` text DEFAULT 'pin_solicitado' NOT NULL,
	`observacao` text,
	`criado_por` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`suframa_cliente_id`) REFERENCES `suframa_clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suframa_notas_chave_unq` ON `suframa_notas` (`chave`);
--> statement-breakpoint
CREATE INDEX `idx_suframa_notas_cliente` ON `suframa_notas` (`suframa_cliente_id`);
--> statement-breakpoint
CREATE TABLE `suframa_nota_eventos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nota_id` integer NOT NULL,
	`descricao` text NOT NULL,
	`user_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`nota_id`) REFERENCES `suframa_notas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT OR IGNORE INTO `sidebar_group_items` (`group_id`, `link_to`, `ordem`) SELECT `id`, '/admin/controle-suframa', 999 FROM `sidebar_groups` WHERE upper(`nome`) LIKE '%FINANCEIRO%';
--> statement-breakpoint
INSERT INTO `suframa_clientes` (`cliente_id`, `codigo`, `nome`, `telefone`, `nao_precisa_pin`) VALUES ((SELECT c.`id` FROM `clientes` c JOIN `empresas` e ON e.`id` = c.`empresa_id` WHERE c.`codigo` = 'C001855' AND e.`slug` = 'joitec' AND c.`deleted_at` IS NULL LIMIT 1), 'C001855', 'F Moura', '92 8585-9861', 0);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C001855' ORDER BY `id` DESC LIMIT 1), '42260821940961000156550020000037841988664892', '3784', '2026-08', '21940961000156', 'aguardando', NULL);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C001855' ORDER BY `id` DESC LIMIT 1), '42260921940961000156550020000049271067669212', '4927', '2026-09', '21940961000156', 'aguardando', NULL);
--> statement-breakpoint
INSERT INTO `suframa_clientes` (`cliente_id`, `codigo`, `nome`, `telefone`, `nao_precisa_pin`) VALUES ((SELECT c.`id` FROM `clientes` c JOIN `empresas` e ON e.`id` = c.`empresa_id` WHERE c.`codigo` = 'C001162' AND e.`slug` = 'joitec' AND c.`deleted_at` IS NULL LIMIT 1), 'C001162', 'Cláudio R.', '96 9180-3552', 0);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C001162' ORDER BY `id` DESC LIMIT 1), '42260821940961000156550020000037571145459527', '3757', '2026-08', '21940961000156', 'ok', NULL);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C001162' ORDER BY `id` DESC LIMIT 1), '42260821940961000156550020000041741165182590', '4174', '2026-08', '21940961000156', 'ok', NULL);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C001162' ORDER BY `id` DESC LIMIT 1), '42260921940961000156550020000046681373887775', '4668', '2026-09', '21940961000156', 'ok', NULL);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C001162' ORDER BY `id` DESC LIMIT 1), '42260921940961000156550020000050591142933359', '5059', '2026-09', '21940961000156', 'aguardando', NULL);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C001162' ORDER BY `id` DESC LIMIT 1), '42261021940961000156550020000052301127824083', '5230', '2026-10', '21940961000156', 'pin_solicitado', NULL);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C001162' ORDER BY `id` DESC LIMIT 1), '42261054774805000111550020000017681535031950', '1768', '2026-10', '54774805000111', 'pin_solicitado', NULL);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C001162' ORDER BY `id` DESC LIMIT 1), '42261021940961000156550020000055561179689490', '5556', '2026-10', '21940961000156', 'pin_solicitado', NULL);
--> statement-breakpoint
INSERT INTO `suframa_clientes` (`cliente_id`, `codigo`, `nome`, `telefone`, `nao_precisa_pin`) VALUES ((SELECT c.`id` FROM `clientes` c JOIN `empresas` e ON e.`id` = c.`empresa_id` WHERE c.`codigo` = 'C004865' AND e.`slug` = 'joitec' AND c.`deleted_at` IS NULL LIMIT 1), 'C004865', 'Vento Norte', '92 3081-1139', 0);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C004865' ORDER BY `id` DESC LIMIT 1), '42260821940961000156550020000036271478573338', '3627', '2026-08', '21940961000156', 'ok', NULL);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C004865' ORDER BY `id` DESC LIMIT 1), '42260954774805000111550020000016621031448335', '1662', '2026-09', '54774805000111', 'ok', 'No documento estava como nota 4689, mas a chave indica a nota 1662 (Odin Tubos)');
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C004865' ORDER BY `id` DESC LIMIT 1), '42260921940961000156550020000051141128068429', '5114', '2026-09', '21940961000156', 'ok', NULL);
--> statement-breakpoint
INSERT INTO `suframa_clientes` (`cliente_id`, `codigo`, `nome`, `telefone`, `nao_precisa_pin`) VALUES ((SELECT c.`id` FROM `clientes` c JOIN `empresas` e ON e.`id` = c.`empresa_id` WHERE c.`codigo` = 'C000424' AND e.`slug` = 'joitec' AND c.`deleted_at` IS NULL LIMIT 1), 'C000424', 'Agropisco', '92 9121-7468', 0);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C000424' ORDER BY `id` DESC LIMIT 1), '42260721940961000156550020000034311869643812', '3431', '2026-07', '21940961000156', 'ok', NULL);
--> statement-breakpoint
INSERT INTO `suframa_clientes` (`cliente_id`, `codigo`, `nome`, `telefone`, `nao_precisa_pin`) VALUES ((SELECT c.`id` FROM `clientes` c JOIN `empresas` e ON e.`id` = c.`empresa_id` WHERE c.`codigo` = 'C002578' AND e.`slug` = 'joitec' AND c.`deleted_at` IS NULL LIMIT 1), 'C002578', NULL, NULL, 1);
--> statement-breakpoint
INSERT INTO `suframa_clientes` (`cliente_id`, `codigo`, `nome`, `telefone`, `nao_precisa_pin`) VALUES ((SELECT c.`id` FROM `clientes` c JOIN `empresas` e ON e.`id` = c.`empresa_id` WHERE c.`codigo` = 'C004738' AND e.`slug` = 'joitec' AND c.`deleted_at` IS NULL LIMIT 1), 'C004738', 'Tornearia Norte', '92 9130-6010', 0);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C004738' ORDER BY `id` DESC LIMIT 1), '42261021940961000156550020000054231796367963', '5423', '2026-10', '21940961000156', 'pin_solicitado', NULL);
--> statement-breakpoint
INSERT INTO `suframa_clientes` (`cliente_id`, `codigo`, `nome`, `telefone`, `nao_precisa_pin`) VALUES ((SELECT c.`id` FROM `clientes` c JOIN `empresas` e ON e.`id` = c.`empresa_id` WHERE c.`codigo` = 'C012142' AND e.`slug` = 'joitec' AND c.`deleted_at` IS NULL LIMIT 1), 'C012142', NULL, NULL, 1);
--> statement-breakpoint
INSERT INTO `suframa_clientes` (`cliente_id`, `codigo`, `nome`, `telefone`, `nao_precisa_pin`) VALUES ((SELECT c.`id` FROM `clientes` c JOIN `empresas` e ON e.`id` = c.`empresa_id` WHERE c.`codigo` = 'C002462' AND e.`slug` = 'joitec' AND c.`deleted_at` IS NULL LIMIT 1), 'C002462', 'Irrimaq', '95 3224-6824', 0);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C002462' ORDER BY `id` DESC LIMIT 1), '42260721940961000156550020000033641997193084', '3364', '2026-07', '21940961000156', 'ok', NULL);
--> statement-breakpoint
INSERT INTO `suframa_clientes` (`cliente_id`, `codigo`, `nome`, `telefone`, `nao_precisa_pin`) VALUES ((SELECT c.`id` FROM `clientes` c JOIN `empresas` e ON e.`id` = c.`empresa_id` WHERE c.`codigo` = 'C001472' AND e.`slug` = 'joitec' AND c.`deleted_at` IS NULL LIMIT 1), 'C001472', NULL, NULL, 1);
--> statement-breakpoint
INSERT INTO `suframa_clientes` (`cliente_id`, `codigo`, `nome`, `telefone`, `nao_precisa_pin`) VALUES ((SELECT c.`id` FROM `clientes` c JOIN `empresas` e ON e.`id` = c.`empresa_id` WHERE c.`codigo` = 'C001179' AND e.`slug` = 'joitec' AND c.`deleted_at` IS NULL LIMIT 1), 'C001179', 'Clébia Bezerra', NULL, 0);
--> statement-breakpoint
INSERT INTO `suframa_notas` (`suframa_cliente_id`, `chave`, `numero_nota`, `mes_emissao`, `cnpj_emitente`, `status`, `observacao`) VALUES ((SELECT `id` FROM `suframa_clientes` WHERE `codigo` = 'C001179' ORDER BY `id` DESC LIMIT 1), '42260921940961000156550020000049151968290204', '4915', '2026-09', '21940961000156', 'aguardando', NULL);
--> statement-breakpoint
INSERT INTO `suframa_nota_eventos` (`nota_id`, `descricao`) SELECT `id`, 'Importada do documento SUFRAMA (Word)' FROM `suframa_notas`;
