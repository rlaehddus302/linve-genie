-- 소리 듣기 고르기 (D-RETRO-70): 판매자가 고른 듣는 곳 — 'mic' 휴대폰 마이크(기본, 지금 동작 그대로) · 'stream' 라이브 소리. 열만 더한다
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "listen_source" text DEFAULT 'mic' NOT NULL;
