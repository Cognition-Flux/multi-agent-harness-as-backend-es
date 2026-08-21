ALTER TABLE "company_policy" DROP CONSTRAINT "company_policy_requirement_profile_id_vendor_requirement_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "company_policy" DROP COLUMN "requirement_profile_id";