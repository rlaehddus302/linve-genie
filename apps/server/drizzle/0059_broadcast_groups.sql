-- 라이브 합치기 기록 (D-MERGE-LIVE-01): 같은 날 끝난 라이브 여럿을 정산서 하나로 묶고 다시 나누는 일. 덧붙이기만 한다. 엔진 이벤트가 아니다
CREATE TABLE IF NOT EXISTS "broadcast_group_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL CONSTRAINT "broadcast_group_events_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"request_id" text NOT NULL,
	"kind" text NOT NULL,
	"group_id" text NOT NULL,
	"date" text NOT NULL,
	"broadcast_ids" text NOT NULL,
	"account_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "broadcast_group_events_request_uq" UNIQUE ("seller_id", "request_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_group_events_seller_idx" ON "broadcast_group_events" USING btree ("seller_id", "id");
