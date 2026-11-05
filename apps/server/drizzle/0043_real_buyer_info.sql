-- 방송 뒤 손님 정보 문자 카드 (ORD-14, D-REAL-11): 본문·번호·이름·주소는 판매자 키로 암호화한 sealed에만, 받은 지 7일 뒤 지운다
CREATE TABLE IF NOT EXISTS "buyer_info_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL CONSTRAINT "buyer_info_cards_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"status" text NOT NULL,
	"auto" boolean DEFAULT false NOT NULL,
	"date" text,
	"buyer" text,
	"note" text,
	"last4" text,
	"sealed" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"handled_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buyer_info_cards_seller_idx" ON "buyer_info_cards" USING btree ("seller_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buyer_info_cards_created_idx" ON "buyer_info_cards" USING btree ("created_at");
