-- 감사 채팅 손으로 지우기·고쳐 다시 올리기 (D-THANKSFIX-01~): 판매자가 앱에서 고른 감사 글 하나를 지우거나 고친 글로 다시 올리는 줄을 정정 표에 함께 둔다.
-- 손으로 하는 줄(manual)은 같은 글에 여러 번 생길 수 있어(자동 정정이 [수정]만 올리고 앞 글이 남은 뒤 등) 글 하나에 줄 하나는 자동 줄에만 둔다.
-- 봇(innertube) 길로 올린 글을 나중에 지울 수 있게, 올릴 때 받은 그 글의 메뉴 값(remove_key)을 우리 글 표에 남긴다.
ALTER TABLE "thanks_fixes" ADD COLUMN IF NOT EXISTS "manual" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "thanks_fixes" ADD COLUMN IF NOT EXISTS "manual_text" text;--> statement-breakpoint
ALTER TABLE "thanks_fixes" DROP CONSTRAINT IF EXISTS "thanks_fixes_source_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "thanks_fixes_source_auto_uq" ON "thanks_fixes" USING btree ("seller_id", "source") WHERE "manual" = false;--> statement-breakpoint
ALTER TABLE "youtube_own_messages" ADD COLUMN IF NOT EXISTS "remove_key" text;
