ALTER TYPE "public"."vendor_activity_type" ADD VALUE 'DIRECTIVE_PROPOSED';--> statement-breakpoint
ALTER TYPE "public"."vendor_activity_type" ADD VALUE 'DIRECTIVE_PROPOSAL_RESOLVED';--> statement-breakpoint
CREATE TABLE "directive_proposal" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" integer NOT NULL,
	"vendor_id" integer,
	"base_policy_id" integer NOT NULL,
	"proposed_by" text DEFAULT 'ASSISTANT' NOT NULL,
	"diff" jsonb NOT NULL,
	"proposed_policy" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"gate_verdict" jsonb,
	"raised_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_user_id" text,
	"resolution" text,
	"resolution_note" text,
	"applied_policy_id" integer,
	CONSTRAINT "directive_proposal_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
DROP INDEX "assistant_memory_vendor_fact_live_uq";--> statement-breakpoint
ALTER TABLE "assistant_memory" ALTER COLUMN "vendor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_ingest_queue" ALTER COLUMN "vendor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_memory" ADD COLUMN "organization_id" integer;--> statement-breakpoint
ALTER TABLE "assistant_memory" ADD COLUMN "knob_key" text;--> statement-breakpoint
ALTER TABLE "company_policy" ADD COLUMN "assistant_privilege" text DEFAULT 'CONVERSATIONAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_ingest_queue" ADD COLUMN "organization_id" integer;--> statement-breakpoint
ALTER TABLE "directive_proposal" ADD CONSTRAINT "directive_proposal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directive_proposal" ADD CONSTRAINT "directive_proposal_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directive_proposal" ADD CONSTRAINT "directive_proposal_base_policy_id_company_policy_id_fk" FOREIGN KEY ("base_policy_id") REFERENCES "public"."company_policy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directive_proposal" ADD CONSTRAINT "directive_proposal_applied_policy_id_company_policy_id_fk" FOREIGN KEY ("applied_policy_id") REFERENCES "public"."company_policy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "directive_proposal_org_idx" ON "directive_proposal" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "directive_proposal_open_uq" ON "directive_proposal" USING btree ("vendor_id") WHERE resolved_at IS NULL;--> statement-breakpoint
ALTER TABLE "assistant_memory" ADD CONSTRAINT "assistant_memory_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_ingest_queue" ADD CONSTRAINT "memory_ingest_queue_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_memory_scope_fact_live_uq" ON "assistant_memory" USING btree ("vendor_uuid","fact") WHERE deleted_at IS NULL AND superseded_at IS NULL;