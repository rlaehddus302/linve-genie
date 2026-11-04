-- 방송 화면에 처음 들어온 때 (D-UX3-25): null이면 앱에서 만드는 중이라 방송 목록에 보이지 않는다. 이미 있던 방송은 모두 보이게 만든 때로 채운다
ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "opened_at" timestamp with time zone;--> statement-breakpoint
UPDATE "broadcasts" SET "opened_at" = "created_at" WHERE "opened_at" IS NULL;
