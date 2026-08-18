CREATE TABLE "assistant_chat_turn" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"vendor_id" integer NOT NULL,
	"message_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_chat_turn" ADD CONSTRAINT "assistant_chat_turn_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_chat_turn_thread_message_uq" ON "assistant_chat_turn" USING btree ("thread_id","message_id");--> statement-breakpoint
CREATE INDEX "assistant_chat_turn_thread_created_idx" ON "assistant_chat_turn" USING btree ("thread_id","created_at");