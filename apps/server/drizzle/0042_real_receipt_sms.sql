-- 영수증 문자 보내기 (D-REAL-03): 손님 휴대폰 번호(판매자 키로 암호화)·보낸 기록
CREATE TABLE IF NOT EXISTS "buyer_phones" (
	"seller_id" text NOT NULL CONSTRAINT "buyer_phones_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"key" text NOT NULL,
	"phone_enc" text NOT NULL,
	"last4" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "buyer_phones_uq" UNIQUE ("seller_id", "key")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buyer_phones_updated_idx" ON "buyer_phones" USING btree ("updated_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipt_sms_sends" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL CONSTRAINT "receipt_sms_sends_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"request_id" text NOT NULL,
	"date" text NOT NULL,
	"buyer" text NOT NULL,
	"last4" text NOT NULL,
	"ok" boolean NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"sent_by" text CONSTRAINT "receipt_sms_sends_sent_by_accounts_id_fk" REFERENCES "accounts"("id"),
	CONSTRAINT "receipt_sms_sends_uq" UNIQUE ("seller_id", "request_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_sms_sends_buyer_idx" ON "receipt_sms_sends" USING btree ("seller_id", "date", "buyer", "sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_sms_sends_seller_idx" ON "receipt_sms_sends" USING btree ("seller_id", "sent_at");
--> statement-breakpoint
-- D-REAL-04 우체국 계약소포: 판매자의 인증키·보안키 (암호문, 없으면 null)
ALTER TABLE "parcel_settings" ADD COLUMN IF NOT EXISTS "epost_enc" text;
