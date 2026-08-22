CREATE TABLE "assistant_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" integer NOT NULL,
	"vendor_uuid" text NOT NULL,
	"mem0_memory_id" text,
	"fact" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"superseded_at" timestamp,
	"deleted_at" timestamp,
	CONSTRAINT "assistant_memory_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "memory_ingest_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"vendor_uuid" text NOT NULL,
	"thread_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp,
	"processed_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_memory" ADD CONSTRAINT "assistant_memory_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_ingest_queue" ADD CONSTRAINT "memory_ingest_queue_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_memory_vendor_created_idx" ON "assistant_memory" USING btree ("vendor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_memory_mem0_id_uq" ON "assistant_memory" USING btree ("mem0_memory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_memory_vendor_fact_live_uq" ON "assistant_memory" USING btree ("vendor_id","fact") WHERE deleted_at IS NULL AND superseded_at IS NULL;--> statement-breakpoint
CREATE INDEX "memory_ingest_pending_idx" ON "memory_ingest_queue" USING btree ("processed_at","created_at");