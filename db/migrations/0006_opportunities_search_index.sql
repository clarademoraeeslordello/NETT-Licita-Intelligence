-- T-204: busca textual indexada (sem varredura completa) e insensível a acento/caixa.
-- Extensões "trusted" do PostgreSQL ≥ 13: o papel migrator (dono do banco) pode criá-las.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
-- unaccent() é STABLE; índice de expressão exige IMMUTABLE. Wrapper com o dicionário qualificado
-- (padrão recomendado) e search_path fixo, para não depender da sessão.
CREATE OR REPLACE FUNCTION public.search_text(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public, pg_temp
AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, value)) $$;--> statement-breakpoint
-- Documento de busca de uma oportunidade: título, objeto, órgão e município. Usado pelo índice e pela consulta
-- (src/server/sources/read/opportunities.ts) — a expressão precisa ser idêntica para o índice ser usado.
CREATE OR REPLACE FUNCTION public.opportunity_search_text(title text, object_description text, agency_name text, municipality text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$ SELECT public.search_text(coalesce(title, '') || ' ' || coalesce(object_description, '') || ' ' || coalesce(agency_name, '') || ' ' || coalesce(municipality, '')) $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS opportunities_search_trgm_idx
  ON opportunities USING gin (public.opportunity_search_text(title, object_description, agency_name, municipality) gin_trgm_ops);--> statement-breakpoint
-- /prices: descrição do item.
CREATE INDEX IF NOT EXISTS opportunity_items_search_trgm_idx
  ON opportunity_items USING gin (public.search_text(description) gin_trgm_ops);
