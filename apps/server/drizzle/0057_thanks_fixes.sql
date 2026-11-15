-- 감사 채팅 정정 (D-RETRO-105): 이미 올라간 실시간 채팅 감사의 값이 고쳐지면 그 글을 지우고 고친 글을 새로 올리는 작업. 발송함(outbox) 표는 바꾸지 않는다
CREATE TABLE IF NOT EXISTS "thanks_fixes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL CONSTRAINT "thanks_fixes_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"scope_id" text NOT NULL CONSTRAINT "thanks_fixes_scope_id_scopes_id_fk" REFERENCES "scopes"("id"),
	"broadcast_id" text NOT NULL,
	"source" text NOT NULL,
	"effect_ids" text NOT NULL,
	"old_texts" text NOT NULL,
	"old_message" text,
	"old_remote_ids" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"deleted" boolean,
	"sent_texts" text NOT NULL DEFAULT '[]',
	"new_remote_ids" text NOT NULL DEFAULT '[]',
	"new_texts" text NOT NULL DEFAULT '[]',
	"attempts" integer NOT NULL DEFAULT 0,
	"next_at" timestamp with time zone,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "thanks_fixes_source_uq" UNIQUE ("seller_id", "source")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thanks_fixes_due_idx" ON "thanks_fixes" USING btree ("state", "next_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thanks_fixes_broadcast_idx" ON "thanks_fixes" USING btree ("seller_id", "broadcast_id");
