-- T-215 (ADR-024): busca textual indexada. pg_trgm é extensão "trusted" (PostgreSQL ≥ 13): o migrator, dono do banco, a cria.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "opportunity_search" (
	"opportunity_id" uuid PRIMARY KEY NOT NULL,
	"search_text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_search" ADD CONSTRAINT "opportunity_search_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunity_search_trgm_idx" ON "opportunity_search" USING gin ("search_text" gin_trgm_ops);