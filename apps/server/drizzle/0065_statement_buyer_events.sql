-- 정산서 손님 합치기 기록 (D-STMT-JOIN-01): 같은 날 정산서에서 닉네임이 다른 구매자를 한 장으로 묶고(join) 다시 나누는(apart) 판매자 결정. 덧붙이기만 한다. 엔진 이벤트가 아니다
CREATE TABLE IF NOT EXISTS "statement_buyer_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL CONSTRAINT "statement_buyer_events_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"request_id" text NOT NULL,
	"kind" text NOT NULL,
	"date" text NOT NULL,
	"link" text NOT NULL,
	"buyer_ids" text NOT NULL,
	"account_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "statement_buyer_events_request_uq" UNIQUE ("seller_id", "request_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "statement_buyer_events_seller_date_idx" ON "statement_buyer_events" USING btree ("seller_id", "date", "id");
