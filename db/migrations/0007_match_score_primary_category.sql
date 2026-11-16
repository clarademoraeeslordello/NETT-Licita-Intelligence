CREATE TYPE "public"."nett_category" AS ENUM('lgpd', 'audit_iso', 'software', 'data_bi_ai', 'security_infra', 'it_hardware');--> statement-breakpoint
ALTER TABLE "match_scores" ADD COLUMN "primary_category" "nett_category";--> statement-breakpoint
CREATE INDEX "match_scores_company_category_idx" ON "match_scores" USING btree ("company_id","primary_category","score");