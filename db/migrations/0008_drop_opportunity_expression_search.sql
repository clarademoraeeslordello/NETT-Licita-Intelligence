-- T-215 (ADR-024): a busca de oportunidades passou para a tabela opportunity_search (0007). Remove o que ela substitui:
-- o índice de expressão em opportunities e a função que o sustentava. MANTIDOS da 0006: search_text() e o índice de
-- itens (opportunity_items_search_trgm_idx), que o /prices continua usando.
-- Reversão (se necessário): recriar a função e o índice como na 0006.
DROP INDEX IF EXISTS opportunities_search_trgm_idx;--> statement-breakpoint
DROP FUNCTION IF EXISTS public.opportunity_search_text(text, text, text, text);
