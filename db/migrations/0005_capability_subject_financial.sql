CREATE TYPE "public"."capability_subject" AS ENUM('company', 'professional');--> statement-breakpoint
ALTER TABLE "company_capabilities" ADD COLUMN "subject" "capability_subject" DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_capabilities" ADD COLUMN "financial_indicators" jsonb;--> statement-breakpoint
ALTER TABLE "company_capabilities" ADD CONSTRAINT "company_capabilities_financial_kind" CHECK ("company_capabilities"."financial_indicators" is null or "company_capabilities"."kind" = 'financial_capacity');--> statement-breakpoint
ALTER TABLE "company_capabilities" ADD CONSTRAINT "company_capabilities_professional_kind" CHECK ("company_capabilities"."subject" = 'company' or "company_capabilities"."kind" in ('certification', 'technical_attestation'));