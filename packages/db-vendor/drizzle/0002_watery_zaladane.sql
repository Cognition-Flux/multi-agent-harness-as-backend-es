-- better-auth 1.7: account identity is scoped by (issuer, accountId)
-- (SPEC §17 C11). Populated-table-safe: add nullable, backfill the
-- synthetic local-credential issuer, then tighten to NOT NULL.
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account" SET "issuer" = 'local:' || "provider_id" WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id_uq" ON "account" USING btree ("issuer","account_id");
