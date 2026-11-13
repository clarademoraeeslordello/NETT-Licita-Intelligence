-- T-101: integridade que o Drizzle não expressa + privilégios do papel da aplicação.
-- Pré-requisito: papéis nett_app e nett_migrator criados por scripts/db/bootstrap.ts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nett_app') THEN
    RAISE EXCEPTION 'papel nett_app ausente: execute npm run db:bootstrap antes das migrations';
  END IF;
END $$;
--> statement-breakpoint

-- HumanReview é append-only (CONTRACTS §2, invariante 3).
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% é somente inclusão (operação % bloqueada)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER human_reviews_append_only BEFORE UPDATE OR DELETE ON human_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- SourceRecord: captura imutável; só campos de normalização podem mudar (invariante 2).
CREATE FUNCTION source_records_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'source_records é imutável (DELETE bloqueado)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.external_id IS DISTINCT FROM OLD.external_id
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.fetched_at IS DISTINCT FROM OLD.fetched_at THEN
    RAISE EXCEPTION 'source_records: captura bruta é imutável' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER source_records_immutable BEFORE UPDATE OR DELETE ON source_records
  FOR EACH ROW EXECUTE FUNCTION source_records_immutable();
--> statement-breakpoint

-- Privilégios: aplicação faz DML, nunca DDL. Revisões e capturas não são apagáveis pela aplicação.
GRANT USAGE ON SCHEMA public TO nett_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nett_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nett_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nett_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nett_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON human_reviews FROM nett_app;
--> statement-breakpoint
REVOKE DELETE ON source_records FROM nett_app;
