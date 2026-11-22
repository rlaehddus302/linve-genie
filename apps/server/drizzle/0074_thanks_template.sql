-- 찜 감사 채팅 양식 (D-THANKS-FMT-01): 판매자가 블록으로 정한 감사 글 모양(JSON 배열). 비어 있으면 기본 양식(엔진 감사 문구 그대로). 다시 적용해도 되게 IF NOT EXISTS
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "thanks_template" text;
--> statement-breakpoint
-- 소리 듣기 고르기 없앰 (D-LISTEN-MIC-01): 늘 휴대폰 마이크로 듣는다 — 라이브 소리를 골라 둔 판매자도 마이크로
UPDATE "sellers" SET "listen_source" = 'mic' WHERE "listen_source" <> 'mic';
