-- Adiantamento PIX: venda que é garantia não tem comprovante (João,
-- 2026-11-24). O vendedor marca "Não vai ter comprovante — é garantia" e o
-- financeiro confere do mesmo jeito (a trava da NF/expedição só sai aí).
ALTER TABLE adiantamentos_pix ADD COLUMN sem_comprovante_motivo text;
