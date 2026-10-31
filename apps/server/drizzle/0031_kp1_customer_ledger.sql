-- KP1: 손님 장부 (CUSTOMER_RULES CR-1~CR-6) — 설정·장부 줄(연락처 암호문만)·표지·동의 기록(덧붙이기만)·연결 코드·손님 엑셀 받은 기록.
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 표를 더하기만 한다(방송 일정·알림 표는 0032).
CREATE TABLE IF NOT EXISTS "ledger_settings" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"months" integer NOT NULL,
	"console_badges" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"contact_enc" text NOT NULL,
	"consent_date" text NOT NULL,
	"consent_months" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_markers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"marker" text NOT NULL,
	"line_id" text NOT NULL,
	"source" text NOT NULL,
	"label_platform" text,
	"label_name" text,
	"label_last4" text,
	"linked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_markers_uq" UNIQUE("seller_id","marker")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_consents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"line_id" text NOT NULL,
	"type" text NOT NULL,
	"items" text NOT NULL,
	"wording" text NOT NULL,
	"months" integer NOT NULL,
	"route" text,
	"order_date" text,
	"reason" text,
	"account_id" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"line_id" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"claimed_marker" text,
	"claimed_platform" text,
	"claimed_name" text,
	"claimed_last4" text,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_exports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"account_id" text NOT NULL,
	"contact" boolean NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_settings" DROP CONSTRAINT IF EXISTS "ledger_settings_seller_id_sellers_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_settings" ADD CONSTRAINT "ledger_settings_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" DROP CONSTRAINT IF EXISTS "ledger_lines_seller_id_sellers_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_markers" DROP CONSTRAINT IF EXISTS "ledger_markers_seller_id_sellers_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_markers" ADD CONSTRAINT "ledger_markers_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_markers" DROP CONSTRAINT IF EXISTS "ledger_markers_line_id_ledger_lines_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_markers" ADD CONSTRAINT "ledger_markers_line_id_ledger_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."ledger_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_consents" DROP CONSTRAINT IF EXISTS "ledger_consents_seller_id_sellers_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_consents" ADD CONSTRAINT "ledger_consents_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_consents" DROP CONSTRAINT IF EXISTS "ledger_consents_account_id_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_consents" ADD CONSTRAINT "ledger_consents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_codes" DROP CONSTRAINT IF EXISTS "ledger_codes_seller_id_sellers_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_codes" ADD CONSTRAINT "ledger_codes_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_codes" DROP CONSTRAINT IF EXISTS "ledger_codes_line_id_ledger_lines_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_codes" ADD CONSTRAINT "ledger_codes_line_id_ledger_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."ledger_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_exports" DROP CONSTRAINT IF EXISTS "customer_exports_seller_id_sellers_id_fk";--> statement-breakpoint
ALTER TABLE "customer_exports" ADD CONSTRAINT "customer_exports_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_exports" DROP CONSTRAINT IF EXISTS "customer_exports_account_id_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "customer_exports" ADD CONSTRAINT "customer_exports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_lines_seller_idx" ON "ledger_lines" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_markers_line_idx" ON "ledger_markers" USING btree ("seller_id","line_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_consents_line_idx" ON "ledger_consents" USING btree ("seller_id","line_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_codes_live_uq" ON "ledger_codes" USING btree ("seller_id","code") WHERE state = 'LIVE';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_codes_line_uq" ON "ledger_codes" USING btree ("seller_id","line_id") WHERE state <> 'DONE';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_exports_seller_idx" ON "customer_exports" USING btree ("seller_id","id");
