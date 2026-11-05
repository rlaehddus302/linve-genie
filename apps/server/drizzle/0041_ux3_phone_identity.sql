-- 휴대폰 번호로 같은 사람 묶기 (D-UX3-30)
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "phone_hash" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "phone_label" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_phone_uq" ON "accounts" USING btree ("phone_hash") WHERE phone_hash IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "login_tickets" ADD COLUMN IF NOT EXISTS "phone_hash" text;--> statement-breakpoint
ALTER TABLE "login_tickets" ADD COLUMN IF NOT EXISTS "phone_label" text;--> statement-breakpoint
ALTER TABLE "login_tickets" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "login_tickets" ADD COLUMN IF NOT EXISTS "target_account_id" text;--> statement-breakpoint
ALTER TABLE "login_tickets" ADD CONSTRAINT "login_tickets_target_account_id_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- 0040의 외래 키 이름을 스키마 정의 이름으로 (Postgres 기본 이름 _fkey로 만들어졌다)
ALTER TABLE "login_tickets" RENAME CONSTRAINT "login_tickets_seller_id_fkey" TO "login_tickets_seller_id_sellers_id_fk";--> statement-breakpoint
ALTER TABLE "login_tickets" RENAME CONSTRAINT "login_tickets_account_id_fkey" TO "login_tickets_account_id_accounts_id_fk";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phone_checks" (
	"key" text PRIMARY KEY NOT NULL,
	"seller_id" text,
	"phone_hash" text NOT NULL,
	"phone_label" text NOT NULL,
	"code_hash" text NOT NULL,
	"code_expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sends" integer DEFAULT 1 NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
ALTER TABLE "phone_checks" ADD CONSTRAINT "phone_checks_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phone_checks_created_idx" ON "phone_checks" USING btree ("created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phone_sends" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text,
	"phone_hash" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
ALTER TABLE "phone_sends" ADD CONSTRAINT "phone_sends_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phone_sends_phone_idx" ON "phone_sends" USING btree ("phone_hash","sent_at");
