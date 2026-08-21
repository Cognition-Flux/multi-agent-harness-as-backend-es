ALTER TYPE "public"."vendor_activity_type" ADD VALUE 'POLICY_ACTIVATED';--> statement-breakpoint
ALTER TYPE "public"."vendor_activity_type" ADD VALUE 'REQUIREMENT_REFERRED';--> statement-breakpoint
ALTER TYPE "public"."vendor_activity_type" ADD VALUE 'REQUIREMENT_REFERRAL_RESOLVED';--> statement-breakpoint
CREATE TABLE "company_policy" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" integer NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"requirement_profile_id" integer NOT NULL,
	"refereeable_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"activated_at" timestamp,
	"activated_by_user_id" text,
	CONSTRAINT "company_policy_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "company_policy_document" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_policy_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"extract_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"validators" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_referral" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" integer NOT NULL,
	"document_id" integer,
	"category" text NOT NULL,
	"proposed_verdict" text NOT NULL,
	"proposed_by" text DEFAULT 'AGENT' NOT NULL,
	"evidence" jsonb,
	"raised_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_user_id" text,
	"resolution" text,
	"note" text,
	CONSTRAINT "requirement_referral_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
ALTER TABLE "vendor" ADD COLUMN "company_policy_id" integer;--> statement-breakpoint
ALTER TABLE "company_policy" ADD CONSTRAINT "company_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_policy" ADD CONSTRAINT "company_policy_requirement_profile_id_vendor_requirement_profile_id_fk" FOREIGN KEY ("requirement_profile_id") REFERENCES "public"."vendor_requirement_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_policy_document" ADD CONSTRAINT "company_policy_document_company_policy_id_company_policy_id_fk" FOREIGN KEY ("company_policy_id") REFERENCES "public"."company_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_referral" ADD CONSTRAINT "requirement_referral_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_referral" ADD CONSTRAINT "requirement_referral_document_id_vendor_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."vendor_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_policy_org_version_uq" ON "company_policy" USING btree ("organization_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "company_policy_active_uq" ON "company_policy" USING btree ("organization_id") WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "company_policy_document_uq" ON "company_policy_document" USING btree ("company_policy_id","document_type");--> statement-breakpoint
CREATE INDEX "requirement_referral_vendor_idx" ON "requirement_referral" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_referral_open_uq" ON "requirement_referral" USING btree ("vendor_id","category") WHERE resolved_at IS NULL;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_company_policy_id_company_policy_id_fk" FOREIGN KEY ("company_policy_id") REFERENCES "public"."company_policy"("id") ON DELETE no action ON UPDATE no action;