-- 음성 인식 기록 (D-UX4-156): 받아쓰기 일꾼이 돌려준 최종 글 한 줄씩(가린 글). 끝난 라이브·다른 기기의 들린 말 탭이 읽는다. 날짜 봉인 때 지운다
CREATE TABLE IF NOT EXISTS "voice_heard" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL CONSTRAINT "voice_heard_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"broadcast_id" text NOT NULL,
	"date" text NOT NULL,
	"rehearsal" boolean NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"text" text NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_heard_broadcast_idx" ON "voice_heard" USING btree ("seller_id", "broadcast_id", "at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_heard_date_idx" ON "voice_heard" USING btree ("seller_id", "date");
