-- YT-SRV 감사만 공식 API (D-YT-SRV-15~17).
-- 글 올리는 계정(channel_id)은 구글 연결 없이 이으면 비운다(뜻: 아직 모름) — 처음 공식으로 올릴 때 그때 연결한 채널을 적는다(D-YT-SRV-16). 옛 기록은 그대로.
ALTER TABLE "youtube_links" ALTER COLUMN "channel_id" DROP NOT NULL;--> statement-breakpoint
-- 우리 글은 공식 채팅 ID가 아니라 회차(이은 기록)에 묶는다 — 채팅 ID를 받기 전에 본 글도 거르기·게시 확인에 쓴다(D-YT-SRV-17).
-- author_channel_id = 그 글의 작성자 채널(게시 확인은 글 올리는 계정의 글만). 옛 행은 비어 있다(그때는 글 올리는 계정의 글만 남겼다)
ALTER TABLE "youtube_own_messages" ADD COLUMN IF NOT EXISTS "link_id" text;--> statement-breakpoint
ALTER TABLE "youtube_own_messages" ADD COLUMN IF NOT EXISTS "author_channel_id" text;--> statement-breakpoint
-- 옛 행: 같은 판매자·같은 채팅 ID의 이은 기록 중 그 글보다 먼저 이은 가장 늦은 것
UPDATE "youtube_own_messages" AS m SET "link_id" = (
  SELECT l."id" FROM "youtube_links" AS l
  WHERE l."seller_id" = m."seller_id" AND l."live_chat_id" = m."live_chat_id" AND l."live_chat_id" <> '' AND l."linked_at" <= m."published_at"
  ORDER BY l."linked_at" DESC LIMIT 1
) WHERE m."link_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "youtube_own_messages_link_idx" ON "youtube_own_messages" USING btree ("seller_id","link_id","published_at");
