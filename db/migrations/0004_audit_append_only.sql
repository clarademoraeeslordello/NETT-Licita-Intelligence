-- T-108: trilha de auditoria somente inclusão (função forbid_mutation criada na 0001).
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM nett_app;
--> statement-breakpoint
REVOKE TRUNCATE ON human_reviews, source_records FROM nett_app;
