-- S05: 리허설 범위(D-081)·범위의 지금 seq(D-085)·리허설 발송함 표시·채팅 이어 받기 인덱스. src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
-- 기존 범위는 모두 실제 범위(rehearsal = false)이고, 범위의 지금 seq는 그 범위 이벤트 기록의 마지막 seq로 채운다(이벤트가 없으면 0).
ALTER TABLE "scopes" ADD COLUMN "rehearsal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scopes" ADD COLUMN "seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scopes" DROP CONSTRAINT "scopes_seller_date_uq";--> statement-breakpoint
ALTER TABLE "scopes" ADD CONSTRAINT "scopes_seller_date_rehearsal_uq" UNIQUE("seller_id","date","rehearsal");--> statement-breakpoint
UPDATE "scopes" SET "seq" = COALESCE((SELECT max("events"."seq") FROM "events" WHERE "events"."scope_id" = "scopes"."id" AND "events"."seller_id" = "scopes"."seller_id"), 0);--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "rehearsal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "events_chat_seq_idx" ON "events" USING btree ("scope_id","chat_broadcast","seq");
