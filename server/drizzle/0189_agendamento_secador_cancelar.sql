-- Secador (modelo SEC...) não tem venda de peça nem preventiva, mas até
-- 2026-11-26 o código SEC10/SEC30 não era reconhecido e o pedido descia pra
-- carteira da Bruna (Agendamentos). Regra: tem OD → Bruna; só SEC/SEP → não.
-- Cancela os agendamentos AINDA ABERTOS de pedidos só com SEC/SEP e em que ninguém registrou contato — o pedido
-- já está em Concluído, só sai da coluna Agendamentos. Pedido do João.
UPDATE agendamentos_pecas
SET status = 'cancelado', updated_at = datetime('now')
WHERE status = 'aberto'
  AND EXISTS (SELECT 1 FROM ordem_maquinas m WHERE m.ordem_id = agendamentos_pecas.ordem_id)
  AND NOT EXISTS (
    SELECT 1 FROM ordem_maquinas m
    WHERE m.ordem_id = agendamentos_pecas.ordem_id
      AND upper(trim(m.modelo)) NOT LIKE 'SEC%' AND upper(trim(m.modelo)) NOT LIKE 'SEP%'
  )
  AND NOT EXISTS (SELECT 1 FROM agendamento_pecas_contatos c WHERE c.agendamento_id = agendamentos_pecas.id);
