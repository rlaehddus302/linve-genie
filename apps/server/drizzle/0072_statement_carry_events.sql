-- 지난 주문 같이 보내기 기록 (D-STMT-CARRY-01): 같은 손님의 아직 보내지 않은 지난 주문을 오늘 정산서에 같이 보내기(carry)·빼기(drop)·이미 보냈어요(sent). 덧붙이기만 한다. 엔진 이벤트가 아니다
CREATE TABLE IF NOT EXISTS "statement_carry_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL CONSTRAINT "statement_carry_events_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"request_id" text NOT NULL,
	"kind" text NOT NULL,
	"date" text NOT NULL,
	"buyer" text NOT NULL,
	"past_date" text NOT NULL,
	"past_buyer" text NOT NULL,
	"account_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "statement_carry_events_request_uq" UNIQUE ("seller_id", "request_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "statement_carry_events_seller_past_idx" ON "statement_carry_events" USING btree ("seller_id", "past_date", "id");
