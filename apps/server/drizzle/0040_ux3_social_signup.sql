-- 간편 로그인으로 바로 가입·앱 안 간편 로그인 (D-UX3-28)
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "terms_agreed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "login_states" ADD COLUMN IF NOT EXISTS "app_challenge" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "login_tickets" (
	"ticket_hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"app_challenge" text,
	"seller_id" text REFERENCES "sellers"("id"),
	"account_id" text REFERENCES "accounts"("id"),
	"provider_user_enc" text,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_tickets_expires_idx" ON "login_tickets" USING btree ("expires_at");
