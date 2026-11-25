-- Garantia sai sozinha da tela "À conferir" do Adiantamento PIX (João,
-- 2026-11-25): as que já tinham sido marcadas viram conferidas na hora em que
-- o vendedor marcou, por quem marcou.
UPDATE adiantamentos_pix SET conferido_em = coalesce(anexado_em, datetime('now')), conferido_por = anexado_por WHERE sem_comprovante_motivo = 'garantia' AND conferido_em IS NULL;
