-- SMS3 고치기 2라운드 (D-SMS3-29·D-SMS3-30): 12시간 넘은 방송 때문에 넣지 않은 손님 문자의 표시(방송 ID·마지막 시각·건수 — 본문 없음),
-- 늦게 온 문자에서 나온 문자 확인 카드 표시(late — 넣기의 받은 시각은 created_at). src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
ALTER TABLE "inbox_settings" ADD COLUMN "stale_broadcast_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD COLUMN "stale_last_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD COLUMN "stale_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_cards" ADD COLUMN "late" boolean DEFAULT false NOT NULL;
