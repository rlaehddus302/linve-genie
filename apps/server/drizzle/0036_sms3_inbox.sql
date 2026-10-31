-- SMS3: 문자·입금 알림 자동 받기 (SPEC ORD-13 C-01~C-07·PAY-02, DEPOSIT_RULES DP-9, D-SMS3-04·08·13, D-DEP2-01~07).
-- 받기 설정(토큰 해시만)·받은 id(해시, 24시간)·같은 문자 표지(HMAC, 24시간)·문자 확인 카드(본문은 암호화, 처리하면 지움)·은행 알림 줄·잔액 기록.
-- 입금에 휴대폰 알림 표시(phone_flag)를 더하고, 휴대폰 알림 원천은 판매자마다 하나. 본문·전화번호·토큰 원문은 어느 칸에도 없다.
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 모든 표에 판매자 ID가 있다(SYS-02).
CREATE TABLE "inbox_settings" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"token_hash" text,
	"token_created_at" timestamp with time zone,
	"last_received_at" timestamp with time zone,
	"last_device" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_seen" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"id_hash" text NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_seen_uq" UNIQUE("seller_id","id_hash")
);
--> statement-breakpoint
CREATE TABLE "inbox_sms_seen" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"sig" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"seller_id" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"kind" text NOT NULL,
	"why" text,
	"numbers" text NOT NULL,
	"memo" text,
	"last4" text,
	"sealed" text,
	"received_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bank_alerts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"kind" text NOT NULL,
	"bank" text NOT NULL,
	"amount" integer,
	"name" text,
	"at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bank_balances" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"bank" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"balance" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "phone_flag" text;--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD CONSTRAINT "inbox_settings_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_seen" ADD CONSTRAINT "inbox_seen_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_sms_seen" ADD CONSTRAINT "inbox_sms_seen_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_cards" ADD CONSTRAINT "inbox_cards_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_alerts" ADD CONSTRAINT "bank_alerts_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_balances" ADD CONSTRAINT "bank_balances_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_settings_token_uq" ON "inbox_settings" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "inbox_seen_time_idx" ON "inbox_seen" USING btree ("seen_at");--> statement-breakpoint
CREATE INDEX "inbox_sms_seen_sig_idx" ON "inbox_sms_seen" USING btree ("seller_id","sig");--> statement-breakpoint
CREATE INDEX "inbox_sms_seen_time_idx" ON "inbox_sms_seen" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inbox_cards_open_idx" ON "inbox_cards" USING btree ("seller_id","broadcast_id","status","created_at");--> statement-breakpoint
CREATE INDEX "bank_alerts_seller_idx" ON "bank_alerts" USING btree ("seller_id","received_at");--> statement-breakpoint
CREATE INDEX "bank_balances_seller_idx" ON "bank_balances" USING btree ("seller_id","bank","at");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_sources_phone_uq" ON "deposit_sources" USING btree ("seller_id") WHERE kind = 'PHONE';
