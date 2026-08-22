CREATE TABLE "company_policy_decision" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" integer NOT NULL,
	"company_policy_id" integer,
	"policy_version" integer,
	"action" text NOT NULL,
	"actor_user_id" text,
	"admissible" boolean,
	"violations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thresholds" jsonb,
	"rego_sha256" text,
	"wasm_sha256" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_policy_decision_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
ALTER TABLE "company_policy_decision" ADD CONSTRAINT "company_policy_decision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_policy_decision" ADD CONSTRAINT "company_policy_decision_company_policy_id_company_policy_id_fk" FOREIGN KEY ("company_policy_id") REFERENCES "public"."company_policy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_policy_decision_org_idx" ON "company_policy_decision" USING btree ("organization_id","created_at");