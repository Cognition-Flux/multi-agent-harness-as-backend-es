CREATE TYPE "public"."vendor_activity_type" AS ENUM('DOCUMENT_UPLOADED', 'DOCUMENT_VERIFIED', 'DOCUMENT_REJECTED', 'DOCUMENT_WAIVED', 'DOCUMENT_RECLASSIFIED', 'DOCUMENT_DELETED', 'MANUAL_REQUIREMENT_GRANTED', 'MANUAL_REQUIREMENT_REVOKED', 'RETRY_REQUESTED', 'STATUS_CHANGED', 'WAIVER_EXPIRED', 'SWEEP_EXPIRED', 'API_CHECK_RUN', 'VENDOR_REGISTERED', 'ACTIVATION_SUBMITTED');--> statement-breakpoint
CREATE TYPE "public"."vendor_compliance_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'PRE_APPROVED', 'NEED_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."vendor_upload_status" AS ENUM('PENDING', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED', 'ERROR');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_check_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"result" jsonb,
	"passed" boolean NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "document_confirmation" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid NOT NULL,
	"document_id" integer NOT NULL,
	"kind" text NOT NULL,
	"question" text NOT NULL,
	"entity_name" text,
	"default_answer" boolean,
	"raised_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"answered_at" timestamp,
	"answer" boolean,
	"outcome" text,
	CONSTRAINT "document_confirmation_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "manual_requirement_grant" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"document_id" integer NOT NULL,
	"category" text NOT NULL,
	"justification" text NOT NULL,
	"granted_by_user_id" text NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"revoked_by_user_id" text,
	"revoke_justification" text,
	CONSTRAINT "manual_requirement_grant_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_uuid_unique" UNIQUE("uuid"),
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "renewal_notification" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"category" text NOT NULL,
	"document_type" text,
	"horizon_days" integer NOT NULL,
	"due_at" date NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"organization_id" integer,
	"vendor_id" integer,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendor" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" integer NOT NULL,
	"legal_name" text NOT NULL,
	"dba_name" text,
	"tin_last4" varchar(4),
	"entity_type" text,
	"naics_code" text,
	"contact_email" text,
	"work_profile" jsonb,
	"dismissed_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"compliance_status" "vendor_compliance_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"compliance_status_metadata" jsonb,
	"requirement_profile_id" integer NOT NULL,
	"signoff_user_id" text,
	"signoff_at" timestamp,
	"next_expiry_at" date,
	"registered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "vendor_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"type" "vendor_activity_type" NOT NULL,
	"actor_user_id" text,
	"document_id" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_document" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"upload_status" "vendor_upload_status" DEFAULT 'PENDING' NOT NULL,
	"file_key" text NOT NULL,
	"file_metadata" jsonb,
	"upload_type" text,
	"source" text DEFAULT 'vendor' NOT NULL,
	"extracted_expiration_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_document_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "vendor_document_extraction" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"version" integer NOT NULL,
	"document_type" text NOT NULL,
	"document_subtype" text,
	"classification_confidence" real,
	"classification_reasoning" text,
	"extracted_data" jsonb NOT NULL,
	"field_confidences" jsonb,
	"validation_rules" jsonb,
	"validation_valid" boolean,
	"requirements_granted" text[] DEFAULT '{}'::text[] NOT NULL,
	"scoped_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"waiver" jsonb,
	"model" text,
	"source" text DEFAULT 'harness' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_requirement_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"required" text[] NOT NULL,
	"mandatory" text[] DEFAULT '{}'::text[] NOT NULL,
	"dismissible" text[] DEFAULT '{}'::text[] NOT NULL,
	"thresholds" jsonb,
	"max_manual_dismissable" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_status_transition" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"source" text NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_tag" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_tag_assignment" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"tag_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_check_evidence" ADD CONSTRAINT "api_check_evidence_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_confirmation" ADD CONSTRAINT "document_confirmation_document_id_vendor_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."vendor_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_requirement_grant" ADD CONSTRAINT "manual_requirement_grant_document_id_vendor_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."vendor_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_notification" ADD CONSTRAINT "renewal_notification_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_requirement_profile_id_vendor_requirement_profile_id_fk" FOREIGN KEY ("requirement_profile_id") REFERENCES "public"."vendor_requirement_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_activity" ADD CONSTRAINT "vendor_activity_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_activity" ADD CONSTRAINT "vendor_activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_document" ADD CONSTRAINT "vendor_document_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_document" ADD CONSTRAINT "vendor_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_document_extraction" ADD CONSTRAINT "vendor_document_extraction_document_id_vendor_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."vendor_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_requirement_profile" ADD CONSTRAINT "vendor_requirement_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_status_transition" ADD CONSTRAINT "vendor_status_transition_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_tag" ADD CONSTRAINT "vendor_tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_tag_assignment" ADD CONSTRAINT "vendor_tag_assignment_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_tag_assignment" ADD CONSTRAINT "vendor_tag_assignment_tag_id_vendor_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."vendor_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_confirmation_doc_idx" ON "document_confirmation" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_requirement_grant_active_uq" ON "manual_requirement_grant" USING btree ("document_id","category") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "renewal_notification_uq" ON "renewal_notification" USING btree ("vendor_id","category","horizon_days","due_at");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vendor_activity_vendor_idx" ON "vendor_activity" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "vendor_document_vendor_idx" ON "vendor_document" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_document_extraction_doc_version_uq" ON "vendor_document_extraction" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_tag_org_name_uq" ON "vendor_tag" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_tag_assignment_uq" ON "vendor_tag_assignment" USING btree ("vendor_id","tag_id");