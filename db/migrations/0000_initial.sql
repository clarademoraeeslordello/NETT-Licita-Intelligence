CREATE TYPE "public"."alert_channel" AS ENUM('none', 'in_app', 'email');--> statement-breakpoint
CREATE TYPE "public"."analysis_engine" AS ENUM('llm', 'local_rules');--> statement-breakpoint
CREATE TYPE "public"."analysis_kind" AS ENUM('tender_summary', 'fit_assessment', 'risk_review');--> statement-breakpoint
CREATE TYPE "public"."analysis_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."capability_kind" AS ENUM('product', 'service', 'certification', 'technical_attestation', 'license', 'geographic_coverage', 'financial_capacity');--> statement-breakpoint
CREATE TYPE "public"."company_role" AS ENUM('company_admin', 'consultant', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."company_size" AS ENUM('ME', 'EPP', 'DEMAIS');--> statement-breakpoint
CREATE TYPE "public"."company_status" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('tender_notice', 'annex', 'reference_term', 'price_map', 'minutes', 'company_certificate', 'proposal', 'report', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_origin" AS ENUM('source', 'upload', 'generated');--> statement-breakpoint
CREATE TYPE "public"."gov_sphere" AS ENUM('federal', 'estadual', 'municipal', 'distrital', 'desconhecida');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('material', 'service');--> statement-breakpoint
CREATE TYPE "public"."me_epp_benefit" AS ENUM('none', 'partial', 'total', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."metric_granularity" AS ENUM('day', 'week', 'month');--> statement-breakpoint
CREATE TYPE "public"."normalization_status" AS ENUM('pending', 'normalized', 'skipped', 'error');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('published', 'receiving_proposals', 'closed', 'awarded', 'cancelled', 'suspended', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('triage', 'analysis', 'documentation', 'proposal', 'dispute', 'result');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('approved', 'approved_with_changes', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending_review', 'approved', 'approved_with_changes', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."review_subject" AS ENUM('ai_analysis', 'match_score', 'bid_decision');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('api', 'scraper', 'manual_upload', 'email');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('ok', 'partial', 'error');--> statement-breakpoint
CREATE TYPE "public"."text_status" AS ENUM('pending', 'extracted', 'no_text_layer', 'error');--> statement-breakpoint
CREATE TYPE "public"."tracking_outcome" AS ENUM('won', 'lost', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."uf" AS ENUM('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO');--> statement-breakpoint
CREATE TABLE "ai_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"company_id" uuid,
	"document_ids" uuid[] NOT NULL,
	"kind" "analysis_kind" NOT NULL,
	"status" "analysis_status" DEFAULT 'queued' NOT NULL,
	"engine" "analysis_engine",
	"provider" text,
	"model" text,
	"prompt_version" text NOT NULL,
	"result_schema_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"result" jsonb,
	"confidence" "confidence",
	"warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" numeric(18, 4),
	"duration_ms" integer,
	"error_code" text,
	"error_message" text,
	"review_status" "review_status" DEFAULT 'pending_review' NOT NULL,
	"requested_by_user_id" uuid,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_analyses_documents" CHECK (cardinality("ai_analyses"."document_ids") >= 1),
	CONSTRAINT "ai_analyses_result_on_success" CHECK ("ai_analyses"."status" <> 'succeeded' or "ai_analyses"."result" is not null)
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"cnpj" text NOT NULL,
	"size" "company_size" NOT NULL,
	"status" "company_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_cnpj_unique" UNIQUE("cnpj"),
	CONSTRAINT "companies_cnpj_digits" CHECK ("companies"."cnpj" ~ '^[0-9]{14}$')
);
--> statement-breakpoint
CREATE TABLE "company_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "capability_kind" NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"catalog_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"ufs" "uf"[] DEFAULT '{}'::uf[] NOT NULL,
	"max_contract_value" numeric(18, 4),
	"evidence_document_id" uuid,
	"valid_until" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consultant_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consultant_user_id" uuid NOT NULL,
	"company_id" uuid,
	"granularity" "metric_granularity" NOT NULL,
	"period_start" date NOT NULL,
	"opportunities_triaged" integer DEFAULT 0 NOT NULL,
	"analyses_requested" integer DEFAULT 0 NOT NULL,
	"analyses_reviewed" integer DEFAULT 0 NOT NULL,
	"median_review_latency_hours" numeric(18, 4),
	"bids_submitted" integer DEFAULT 0 NOT NULL,
	"bids_won" integer DEFAULT 0 NOT NULL,
	"bids_lost" integer DEFAULT 0 NOT NULL,
	"value_submitted" numeric(18, 4) DEFAULT '0' NOT NULL,
	"value_won" numeric(18, 4) DEFAULT '0' NOT NULL,
	"win_rate" numeric(18, 4),
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultant_metrics_period_uq" UNIQUE NULLS NOT DISTINCT("consultant_user_id","company_id","granularity","period_start")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"opportunity_id" uuid,
	"kind" "document_kind" NOT NULL,
	"origin" "document_origin" NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"storage_key" text,
	"mime_type" text NOT NULL,
	"size_bytes" integer,
	"sha256" text,
	"page_count" integer,
	"text_status" text_status DEFAULT 'pending' NOT NULL,
	"text_storage_key" text,
	"uploaded_by_user_id" uuid,
	"certificate" jsonb,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "documents_id_company_uq" UNIQUE("id","company_id"),
	CONSTRAINT "documents_scope" CHECK ("documents"."company_id" is not null or "documents"."opportunity_id" is not null),
	CONSTRAINT "documents_certificate" CHECK ("documents"."kind" <> 'company_certificate' or ("documents"."company_id" is not null and "documents"."certificate" is not null)),
	CONSTRAINT "documents_private_key" CHECK ("documents"."company_id" is null or "documents"."storage_key" is null or "documents"."storage_key" like 'companies/' || "documents"."company_id"::text || '/%'),
	CONSTRAINT "documents_public_key" CHECK ("documents"."company_id" is not null or "documents"."storage_key" is null or "documents"."storage_key" like 'public/%')
);
--> statement-breakpoint
CREATE TABLE "human_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"subject_type" "review_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"decision" "review_decision" NOT NULL,
	"corrections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "human_reviews_id_company_uq" UNIQUE("id","company_id"),
	CONSTRAINT "human_reviews_rejected_comment" CHECK ("human_reviews"."decision" <> 'rejected' or length(trim(coalesce("human_reviews"."comment", ''))) > 0),
	CONSTRAINT "human_reviews_changes_corrections" CHECK ("human_reviews"."decision" <> 'approved_with_changes' or jsonb_array_length("human_reviews"."corrections") > 0)
);
--> statement-breakpoint
CREATE TABLE "match_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"search_profile_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"factors" jsonb NOT NULL,
	"caps" text[] DEFAULT '{}'::text[] NOT NULL,
	"algorithm_version" text NOT NULL,
	"opportunity_content_hash" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_scores_profile_opportunity_uq" UNIQUE("search_profile_id","opportunity_id"),
	CONSTRAINT "match_scores_range" CHECK ("match_scores"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role" "company_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_company_id_pk" PRIMARY KEY("user_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_key" text NOT NULL,
	"primary_source_id" uuid NOT NULL,
	"title" text NOT NULL,
	"object_description" text NOT NULL,
	"agency_name" text NOT NULL,
	"agency_cnpj" text,
	"agency_unit" text,
	"municipality" text,
	"uf" "uf",
	"sphere" "gov_sphere" NOT NULL,
	"modality_code" integer,
	"modality_name" text,
	"dispute_mode" text,
	"legal_basis" text,
	"process_number" text,
	"status" "opportunity_status" NOT NULL,
	"published_at" timestamp with time zone,
	"proposals_open_at" timestamp with time zone,
	"proposals_close_at" timestamp with time zone,
	"session_at" timestamp with time zone,
	"estimated_value" numeric(18, 4),
	"awarded_value" numeric(18, 4),
	"confidential_budget" boolean DEFAULT false NOT NULL,
	"price_registration" boolean DEFAULT false NOT NULL,
	"me_epp_benefit" "me_epp_benefit" DEFAULT 'unknown' NOT NULL,
	"url" text NOT NULL,
	"content_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_canonical_key_unique" UNIQUE("canonical_key"),
	CONSTRAINT "opportunities_canonical_key_format" CHECK ("opportunities"."canonical_key" ~ '^[a-z0-9_]+:.+$')
);
--> statement-breakpoint
CREATE TABLE "opportunity_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"description" text NOT NULL,
	"kind" "item_kind" NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit" text NOT NULL,
	"estimated_unit_value" numeric(18, 4),
	"estimated_total_value" numeric(18, 4),
	"judging_criterion" text,
	"me_epp_benefit" "me_epp_benefit" DEFAULT 'unknown' NOT NULL,
	"catalog_code" text,
	"awarded_unit_value" numeric(18, 4),
	"awarded_supplier_cnpj" text,
	"awarded_supplier_name" text,
	"awarded_at" timestamp with time zone,
	CONSTRAINT "opportunity_items_number_uq" UNIQUE("opportunity_id","number"),
	CONSTRAINT "opportunity_items_number_positive" CHECK ("opportunity_items"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "opportunity_trackings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"stage" "pipeline_stage" DEFAULT 'triage' NOT NULL,
	"assigned_consultant_id" uuid,
	"proposal_value" numeric(18, 4),
	"outcome" "tracking_outcome",
	"bid_decision_review_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"discarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_trackings_company_opportunity_uq" UNIQUE("company_id","opportunity_id"),
	CONSTRAINT "opportunity_trackings_bid_decision" CHECK ("opportunity_trackings"."stage" in ('triage', 'analysis', 'documentation') or "opportunity_trackings"."bid_decision_review_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "search_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"include_terms" text[] NOT NULL,
	"exclude_terms" text[] DEFAULT '{}'::text[] NOT NULL,
	"ufs" "uf"[] DEFAULT '{}'::uf[] NOT NULL,
	"modality_codes" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"min_value" numeric(18, 4),
	"max_value" numeric(18, 4),
	"source_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"min_score" integer DEFAULT 50 NOT NULL,
	"alert_channel" "alert_channel" DEFAULT 'none' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_profiles_id_company_uq" UNIQUE("id","company_id"),
	CONSTRAINT "search_profiles_terms" CHECK (cardinality("search_profiles"."include_terms") >= 1),
	CONSTRAINT "search_profiles_score" CHECK ("search_profiles"."min_score" between 0 and 100),
	CONSTRAINT "search_profiles_value_range" CHECK ("search_profiles"."min_value" is null or "search_profiles"."max_value" is null or "search_profiles"."min_value" <= "search_profiles"."max_value")
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"normalization_status" "normalization_status" DEFAULT 'pending' NOT NULL,
	"normalization_error" text,
	"normalized_at" timestamp with time zone,
	"opportunity_id" uuid,
	CONSTRAINT "source_records_version_uq" UNIQUE("source_id","external_id","payload_hash")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"base_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit" jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" "sync_status",
	"last_cursor" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_key_unique" UNIQUE("key"),
	CONSTRAINT "sources_key_format" CHECK ("sources"."key" ~ '^[a-z0-9_]{2,40}$')
);
--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keycloak_sub" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_accounts_keycloak_sub_unique" UNIQUE("keycloak_sub")
);
--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_requested_by_user_id_user_accounts_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_capabilities" ADD CONSTRAINT "company_capabilities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_capabilities" ADD CONSTRAINT "company_capabilities_evidence_fk" FOREIGN KEY ("evidence_document_id","company_id") REFERENCES "public"."documents"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_metrics" ADD CONSTRAINT "consultant_metrics_consultant_user_id_user_accounts_id_fk" FOREIGN KEY ("consultant_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_metrics" ADD CONSTRAINT "consultant_metrics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_user_accounts_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_reviews" ADD CONSTRAINT "human_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_reviews" ADD CONSTRAINT "human_reviews_reviewer_user_id_user_accounts_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_scores" ADD CONSTRAINT "match_scores_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_scores" ADD CONSTRAINT "match_scores_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_scores" ADD CONSTRAINT "match_scores_profile_fk" FOREIGN KEY ("search_profile_id","company_id") REFERENCES "public"."search_profiles"("id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_primary_source_id_sources_id_fk" FOREIGN KEY ("primary_source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_trackings" ADD CONSTRAINT "opportunity_trackings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_trackings" ADD CONSTRAINT "opportunity_trackings_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_trackings" ADD CONSTRAINT "opportunity_trackings_assigned_consultant_id_user_accounts_id_fk" FOREIGN KEY ("assigned_consultant_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_trackings" ADD CONSTRAINT "opportunity_trackings_bid_review_fk" FOREIGN KEY ("bid_decision_review_id","company_id") REFERENCES "public"."human_reviews"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_owner_user_id_user_accounts_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_analyses_input_hash_idx" ON "ai_analyses" USING btree ("input_hash");--> statement-breakpoint
CREATE INDEX "ai_analyses_opportunity_idx" ON "ai_analyses" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "ai_analyses_company_idx" ON "ai_analyses" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_capabilities_company_idx" ON "company_capabilities" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "documents_opportunity_idx" ON "documents" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "documents_company_idx" ON "documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "human_reviews_subject_idx" ON "human_reviews" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "match_scores_company_score_idx" ON "match_scores" USING btree ("company_id","score");--> statement-breakpoint
CREATE INDEX "memberships_company_idx" ON "memberships" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "opportunities_status_close_idx" ON "opportunities" USING btree ("status","proposals_close_at");--> statement-breakpoint
CREATE INDEX "opportunities_uf_idx" ON "opportunities" USING btree ("uf");--> statement-breakpoint
CREATE INDEX "search_profiles_company_idx" ON "search_profiles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "source_records_pending_idx" ON "source_records" USING btree ("normalization_status");--> statement-breakpoint
CREATE INDEX "source_records_opportunity_idx" ON "source_records" USING btree ("opportunity_id");