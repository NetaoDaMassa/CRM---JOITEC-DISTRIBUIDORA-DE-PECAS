-- Cartão de Crédito: cada gasto diz se foi pago no cartão ou em dinheiro
-- (João, 2026-11-25). Os já lançados ficam como cartão.
ALTER TABLE cartao_gastos ADD COLUMN forma_pagamento text NOT NULL DEFAULT 'cartao';
