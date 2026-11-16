ALTER TABLE `links_pagamento` ADD `telefone_fixo` text;
--> statement-breakpoint
ALTER TABLE `links_pagamento` ADD `endereco_entrega` text;
--> statement-breakpoint
ALTER TABLE `links_pagamento` ADD `itens` text;
--> statement-breakpoint
ALTER TABLE `links_pagamento` ADD `cartao` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `links_pagamento` ADD `bandeira` text;
--> statement-breakpoint
ALTER TABLE `links_pagamento` ADD `pix` integer DEFAULT 0 NOT NULL;
