-- KP1: 방송 일정·공개 일정 페이지·방송 알림 수신 동의 (SPEC SCH-01~SCH-03, MESSAGE_RULES MR-6, D-KP1-15·D-KP1-16). 엔진 이벤트와 상관없는 판매자 표다.
-- 다시 돌려도 안전하도록 IF NOT EXISTS / DROP CONSTRAINT IF EXISTS를 쓴다(되감기 시험이 표를 남긴 채 저널만 지운다).
-- 휴대폰 번호 원문은 암호문(phone_enc)으로만, 찾기는 전화번호 키(phone_key)로. 동의 기록에는 번호가 없다. src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
CREATE TABLE IF NOT EXISTS "schedule_pages" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"token_hash" text,
	"token_enc" text,
	"channel_url" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "schedule_pages_token_uq" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_items" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"intro" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alert_subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"phone_key" text,
	"phone_enc" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alert_consents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"subscriber_id" text NOT NULL,
	"type" text NOT NULL,
	"wording" text,
	"route" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_pages" DROP CONSTRAINT IF EXISTS "schedule_pages_seller_id_sellers_id_fk";--> statement-breakpoint
ALTER TABLE "schedule_pages" ADD CONSTRAINT "schedule_pages_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" DROP CONSTRAINT IF EXISTS "schedule_items_seller_id_sellers_id_fk";--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_subscribers" DROP CONSTRAINT IF EXISTS "alert_subscribers_seller_id_sellers_id_fk";--> statement-breakpoint
ALTER TABLE "alert_subscribers" ADD CONSTRAINT "alert_subscribers_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_consents" DROP CONSTRAINT IF EXISTS "alert_consents_seller_id_sellers_id_fk";--> statement-breakpoint
ALTER TABLE "alert_consents" ADD CONSTRAINT "alert_consents_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_consents" DROP CONSTRAINT IF EXISTS "alert_consents_subscriber_id_alert_subscribers_id_fk";--> statement-breakpoint
ALTER TABLE "alert_consents" ADD CONSTRAINT "alert_consents_subscriber_id_alert_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."alert_subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_items_seller_starts_idx" ON "schedule_items" USING btree ("seller_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alert_subscribers_phone_uq" ON "alert_subscribers" USING btree ("seller_id","phone_key") WHERE phone_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_consents_subscriber_idx" ON "alert_consents" USING btree ("seller_id","subscriber_id","id");
